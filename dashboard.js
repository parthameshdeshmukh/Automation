const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CANDIDATES_DIR = path.join(__dirname, 'candidates');

// Helper to send JSON response
function sendJson(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// Helper to send text error
function sendError(res, message, status = 500) {
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(message);
}

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.pdf': 'application/pdf',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    console.log(`[Dashboard] ${req.method} ${pathname}`);

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // --- API ROUTES ---

    // 1. GET /api/candidates - return candidate profiles + stats
    if (req.method === 'GET' && pathname === '/api/candidates') {
        try {
            if (!fs.existsSync(CANDIDATES_DIR)) {
                return sendJson(res, []);
            }
            const items = fs.readdirSync(CANDIDATES_DIR);
            const candidates = [];

            for (const name of items) {
                const cDir = path.join(CANDIDATES_DIR, name);
                if (!fs.statSync(cDir).isDirectory()) continue;

                const profilePath = path.join(cDir, 'profile.json');
                const leadsPath = path.join(cDir, 'scraped_leads.json');

                if (fs.existsSync(profilePath)) {
                    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
                    let leadsCount = 0;
                    if (fs.existsSync(leadsPath)) {
                        try {
                            const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
                            leadsCount = Array.isArray(leads) ? leads.length : 0;
                        } catch (_) {}
                    }
                    candidates.push({
                        name: name,
                        profile: profile,
                        scrapedLeadsCount: leadsCount
                    });
                }
            }
            return sendJson(res, candidates);
        } catch (err) {
            return sendJson(res, { error: err.message }, 500);
        }
    }

    // 2. GET /api/leads?candidate=name
    if (req.method === 'GET' && pathname === '/api/leads') {
        const candidateName = parsedUrl.query.candidate;
        if (!candidateName) {
            return sendJson(res, { error: 'Missing candidate query parameter' }, 400);
        }
        try {
            const leadsPath = path.join(CANDIDATES_DIR, candidateName, 'scraped_leads.json');
            if (fs.existsSync(leadsPath)) {
                const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
                return sendJson(res, leads);
            }
            return sendJson(res, []);
        } catch (err) {
            return sendJson(res, { error: err.message }, 500);
        }
    }

    // 3. GET /api/outreach - return sent log + failed list
    if (req.method === 'GET' && pathname === '/api/outreach') {
        try {
            const appliedLogPath = path.join(DATA_DIR, 'applied_jobs_log.json');
            const failedLogPath = path.join(DATA_DIR, 'failed_emails.json');

            let applied = [];
            let failed = [];

            if (fs.existsSync(appliedLogPath)) {
                try {
                    applied = JSON.parse(fs.readFileSync(appliedLogPath, 'utf8'));
                } catch (_) {}
            }
            if (fs.existsSync(failedLogPath)) {
                try {
                    failed = JSON.parse(fs.readFileSync(failedLogPath, 'utf8'));
                } catch (_) {}
            }

            return sendJson(res, { applied, failed });
        } catch (err) {
            return sendJson(res, { error: err.message }, 500);
        }
    }

    // 4. GET /api/pdf?file=path - stream local pdf file
    if (req.method === 'GET' && pathname === '/api/pdf') {
        const fileLoc = parsedUrl.query.file;
        if (!fileLoc) {
            return sendError(res, 'File parameter required', 400);
        }
        
        // Safety validation: resolve absolute path, ensure it's inside workspace, and is a .pdf file
        const resolvedPath = path.resolve(fileLoc);
        if (!resolvedPath.startsWith(path.resolve(__dirname)) || !resolvedPath.toLowerCase().endsWith('.pdf')) {
            return sendError(res, 'Access denied or invalid file type', 403);
        }

        if (!fs.existsSync(resolvedPath)) {
            return sendError(res, 'File not found', 404);
        }

        res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${path.basename(resolvedPath)}"`
        });
        const stream = fs.createReadStream(resolvedPath);
        stream.pipe(res);
        return;
    }

    // 5. POST /api/clear-leads?candidate=name - clear lead workspace
    if (req.method === 'POST' && pathname === '/api/clear-leads') {
        const candidateName = parsedUrl.query.candidate;
        if (!candidateName) {
            return sendJson(res, { error: 'Missing candidate query parameter' }, 400);
        }
        try {
            const leadsPath = path.join(CANDIDATES_DIR, candidateName, 'scraped_leads.json');
            fs.writeFileSync(leadsPath, '[]', 'utf8');
            console.log(`[Dashboard] Cleared scraped leads queue for candidate: ${candidateName}`);
            return sendJson(res, { success: true });
        } catch (err) {
            return sendJson(res, { error: err.message }, 500);
        }
    }

    // --- STATIC FILE SERVER ---

    // Standard static serving logic
    let relativeFilePath = pathname === '/' ? '/index.html' : pathname;
    const staticFilePath = path.join(__dirname, 'public', relativeFilePath);

    // Safety checks for directory traversal
    if (!staticFilePath.startsWith(path.join(__dirname, 'public'))) {
        return sendError(res, 'Access Denied', 403);
    }

    if (fs.existsSync(staticFilePath) && fs.statSync(staticFilePath).isFile()) {
        const ext = path.extname(staticFilePath);
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(staticFilePath);
        stream.pipe(res);
    } else {
        // Simple SPA fallback to index.html if file doesn't exist
        const indexHtmlPath = path.join(__dirname, 'public', 'index.html');
        if (fs.existsSync(indexHtmlPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fs.createReadStream(indexHtmlPath).pipe(res);
        } else {
            sendError(res, '404 File Not Found', 404);
        }
    }
});

server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🖥️  DASHBOARD RUNNING: http://localhost:${PORT}`);
    console.log(`==================================================\n`);
});
