require('dotenv').config();
const scrapeLinkedInPosts = require('./scraper/linkedin');
const { extractEmails } = require('./utils/extractEmail');
const { sendEmail } = require('./services/gmailService');
const { logToGoogleSheets } = require('./services/sheetsService');
const { generateResumePoints } = require('./services/geminiService');
const { generateDynamicResume } = require('./services/compilePdfService');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const SENT_DB_PATH = path.join(DATA_DIR, 'sent_history.json');
const FAILED_DB_PATH = path.join(DATA_DIR, 'failed_emails.json');

function loadDatabase(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
        let raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/^\uFFFE/, '').trim();
        if (!raw || raw === '') return [];
        return JSON.parse(raw);
    } catch (e) {
        console.warn(`[DB] Warning: Could not parse ${filePath} (${e.message}). Resetting to [].`);
        fs.writeFileSync(filePath, '[]', 'utf8');
        return [];
    }
}

function saveDatabase(filePath, dataArray) {
    fs.writeFileSync(filePath, JSON.stringify(dataArray, null, 2));
}

function hasAlreadyBeenSent(email) {
    const sentHistory = loadDatabase(SENT_DB_PATH);
    return sentHistory.includes(email);
}

function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const result = {};
        content.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const match = trimmed.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let val = match[2].trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.substring(1, val.length - 1);
                }
                result[key] = val;
            }
        });
        return result;
    } catch (e) {
        console.warn(`[Main] Warning: Could not parse env file ${filePath}:`, e.message);
        return {};
    }
}

async function processCandidate(candidateName, candidateDir, sentHistory, failedEmails, appliedJobsLog, APPLIED_LOG_PATH, forceScrape = false, runMode = 'both') {
    console.log(`\n==================================================`);
    console.log(`👤 PROCESSING CANDIDATE: ${candidateName.toUpperCase()} (Mode: ${runMode.toUpperCase()})`);
    console.log(`==================================================`);

    const profilePath = path.join(candidateDir, 'profile.json');
    const sentencesPath = path.join(candidateDir, 'sentences.json');
    let candidateResumePath = path.join(candidateDir, 'resume.tex');
    if (!fs.existsSync(candidateResumePath)) {
        candidateResumePath = path.join(candidateDir, 'resume.docx');
    }
    const candidateLeadsPath = path.join(candidateDir, 'scraped_leads.json');
    const candidateEnvPath = path.join(candidateDir, '.env');

    if (!fs.existsSync(profilePath) || !fs.existsSync(sentencesPath) || !fs.existsSync(candidateResumePath)) {
        console.error(`[Main] Error: Missing files for candidate ${candidateName} in ${candidateDir}. Skipping.`);
        return;
    }

    const pJson = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const sentences = JSON.parse(fs.readFileSync(sentencesPath, 'utf8'));
    const candidateEnv = parseEnvFile(candidateEnvPath);

    // Allot specific Gemini API Key for each candidate
    const globalKeys = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
    let candidateKey = '';
    if (candidateName.toLowerCase() === 'deepika') {
        candidateKey = globalKeys[0] || '';
    } else if (candidateName.toLowerCase() === 'shilpa') {
        candidateKey = globalKeys[1] || '';
    } else if (candidateName.toLowerCase() === 'yeshwanth') {
        candidateKey = globalKeys[2] || '';
    }

    // Override if candidate has a specific key in their local .env file
    if (candidateEnv.GEMINI_API_KEY) {
        candidateKey = candidateEnv.GEMINI_API_KEY.trim();
    }

    if (candidateKey) {
        console.log(`[Main] [${candidateName}] Using allocated Gemini API Key: ${candidateKey.substring(0, 10)}...`);
        process.env.GEMINI_API_KEY = candidateKey;
    }

    // Override MAX_PAGES if candidate has a specific one in their local .env file
    if (candidateEnv.MAX_PAGES) {
        console.log(`[Main] [${candidateName}] Overriding MAX_PAGES to: ${candidateEnv.MAX_PAGES}`);
        process.env.MAX_PAGES = candidateEnv.MAX_PAGES;
    }

    // Resolve candidate profile
    const profile = {
        name: pJson.name || candidateEnv.CANDIDATE_NAME || process.env.CANDIDATE_NAME || 'Deepika Varma',
        email: pJson.email || candidateEnv.CANDIDATE_EMAIL || process.env.CANDIDATE_EMAIL || '',
        phone: pJson.phone || candidateEnv.CANDIDATE_PHONE || process.env.CANDIDATE_PHONE || '',
        location: pJson.location || candidateEnv.CANDIDATE_LOCATION || process.env.CANDIDATE_LOCATION || '',
        workAuth: pJson.workAuth || candidateEnv.CANDIDATE_WORK_AUTH || process.env.CANDIDATE_WORK_AUTH || '',
        experience: pJson.experience || candidateEnv.CANDIDATE_EXPERIENCE || process.env.CANDIDATE_EXPERIENCE || '',
        salary: pJson.salary || candidateEnv.CANDIDATE_SALARY || process.env.CANDIDATE_SALARY || '',
        linkedin: pJson.linkedin || candidateEnv.CANDIDATE_LINKEDIN || process.env.CANDIDATE_LINKEDIN || '',
        teamLeadEmail: pJson.teamLeadEmail || candidateEnv.TEAM_LEAD_EMAIL || process.env.TEAM_LEAD_EMAIL || 'quinn@jpitstaffing.com',
        searchCriteria: pJson.searchCriteria || (candidateEnv.SEARCH_KEYWORDS ? [candidateEnv.SEARCH_KEYWORDS] : (process.env.SEARCH_KEYWORDS ? [process.env.SEARCH_KEYWORDS] : []))
    };

    const searchCriteria = profile.searchCriteria || [];
    if (searchCriteria.length === 0) {
        console.warn(`[Main] No search criteria configured for candidate ${candidateName}. Skipping.`);
        return;
    }

    const emailsPerCandidate = parseInt(candidateEnv.EMAILS_PER_CANDIDATE || process.env.EMAILS_PER_CANDIDATE || '20', 10);
    const maxEmails = parseInt(candidateEnv.MAX_EMAILS || process.env.MAX_EMAILS || '250', 10);
    const maxPerKeyword = parseInt(candidateEnv.MAX_EMAILS_PER_KEYWORD || process.env.MAX_EMAILS_PER_KEYWORD || '30', 10);
    const tailorResume = (candidateEnv.TAILOR_RESUME || process.env.TAILOR_RESUME || 'true') === 'true';
    const sendEmailViaNode = (candidateEnv.SEND_EMAIL_VIA_NODE || process.env.SEND_EMAIL_VIA_NODE) !== 'false';
    const skipSentCheck = (candidateEnv.SKIP_SENT_CHECK || process.env.SKIP_SENT_CHECK) === 'true';
    const emailDelayMs = parseInt(candidateEnv.EMAIL_DELAY_MS || process.env.EMAIL_DELAY_MS || '10000', 10);

    const targetLeadsCount = parseInt(candidateEnv.SCRAPE_TARGET_LEADS || process.env.SCRAPE_TARGET_LEADS || '25', 10);

    let candidateSentCount = 0;
    let leads = [];

    // Phase 1: Scrape leads (if runMode is 'scrape' or 'both')
    if (runMode === 'scrape' || runMode === 'both') {
        // If we are not forcing scrape and the leads file exists, load it first to see if we already have enough
        if (fs.existsSync(candidateLeadsPath) && !forceScrape) {
            console.log(`[Main] [${candidateName}] Found existing leads file: ${candidateLeadsPath}`);
            try {
                leads = JSON.parse(fs.readFileSync(candidateLeadsPath, 'utf8'));
                if (candidateName === 'shilpa') {
                    leads = leads.map(l => ({
                        email: l.email,
                        jd: l.jd,
                        postUrl: l.postUrl
                    }));
                }
                console.log(`[Main] [${candidateName}] Loaded ${leads.length} leads from JSON.`);
            } catch (e) {
                console.error(`[Main] [${candidateName}] Error parsing ${candidateLeadsPath}:`, e.message);
                leads = [];
            }
        }

        // If leads are fewer than target or we are forcing scrape, run scraper
        if (leads.length < targetLeadsCount || forceScrape) {
            if (forceScrape) {
                leads = []; // reset leads if forcing scrape
            }
            console.log(`[Main] [${candidateName}] Scraping LinkedIn for leads (Target: ${targetLeadsCount} leads, current: ${leads.length})...`);
            
            for (const keywords of searchCriteria) {
                const remainingTarget = targetLeadsCount - leads.length;
                if (remainingTarget <= 0) {
                    console.log(`[Main] [${candidateName}] Reached target lead count of ${targetLeadsCount}. Skipping remaining search criteria.`);
                    break;
                }

                console.log(`\n=== Searching LinkedIn for: ${keywords} (Targeting ${remainingTarget} more leads) ===`);
                let posts = [];
                try {
                    posts = await scrapeLinkedInPosts(keywords, remainingTarget);
                } catch (err) {
                    console.error(`[Main] Scraper failed for ${keywords}:`, err.message);
                    continue;
                }

                if (posts.length === 0) {
                    console.log(`[Main] No posts found for keyword: ${keywords}`);
                    continue;
                }

                const mapped = posts.map(p => ({ ...p, keywords }));
                const extractedData = extractEmails(mapped);

                if (extractedData.length === 0) {
                    console.log(`[Main] No email addresses extracted for keyword: ${keywords}`);
                    continue;
                }

                // Add unique leads (avoid duplicates)
                for (const lead of extractedData) {
                    if (!leads.some(l => l.email.toLowerCase() === lead.email.toLowerCase())) {
                        if (candidateName === 'shilpa') {
                            leads.push({
                                email: lead.email,
                                jd: lead.jd,
                                postUrl: lead.postUrl
                            });
                        } else {
                            leads.push(lead);
                        }
                    }
                }
                console.log(`[Main] Collected ${leads.length} unique leads so far.`);
            }

            // Save scraped leads to local JSON
            try {
                fs.writeFileSync(candidateLeadsPath, JSON.stringify(leads, null, 2), 'utf8');
                console.log(`[Main] [${candidateName}] Successfully saved ${leads.length} leads to ${candidateLeadsPath}`);
            } catch (err) {
                console.error(`[Main] [${candidateName}] Failed to save leads to file:`, err.message);
            }
        }
    } else {
        // runMode is 'send' / 'apply'
        if (fs.existsSync(candidateLeadsPath)) {
            try {
                leads = JSON.parse(fs.readFileSync(candidateLeadsPath, 'utf8'));
                if (candidateName === 'shilpa') {
                    leads = leads.map(l => ({
                        email: l.email,
                        jd: l.jd,
                        postUrl: l.postUrl
                    }));
                }
                console.log(`[Main] [${candidateName}] Loaded ${leads.length} leads from JSON.`);
            } catch (e) {
                console.error(`[Main] [${candidateName}] Error parsing ${candidateLeadsPath}:`, e.message);
                return;
            }
        } else {
            console.error(`[Main] [${candidateName}] Error: No cached leads found at ${candidateLeadsPath}. Please run in scrape mode first.`);
            return;
        }
    }

    if (runMode === 'scrape') {
        console.log(`[Main] [${candidateName}] Scrape phase complete. Skipping email delivery.`);
        return;
    }

    if (leads.length === 0) {
        console.log(`[Main] [${candidateName}] No leads available to send emails. Skipping candidate.`);
        return;
    }

    console.log(`[Main] [${candidateName}] Starting delivery for ${leads.length} leads (Limit: ${emailsPerCandidate} emails)...`);

    let keywordSentCounts = {};

    for (let i = 0; i < leads.length; i++) {
        if (candidateSentCount >= emailsPerCandidate) {
            console.log(`[Main] [${candidateName}] Reached email target of ${emailsPerCandidate}. Stopping delivery for this candidate.`);
            break;
        }

        const data = leads[i];
        const email = data.email;
        const jd = data.jd;
        const postUrl = data.postUrl;
        const keywords = data.keywords || (searchCriteria[0] || 'Software Engineer');

        const keywordSentCount = keywordSentCounts[keywords] || 0;
        if (keywordSentCount >= maxPerKeyword) {
            console.log(`[Main] [${candidateName}] Reached maximum email target for keyword "${keywords}" of ${maxPerKeyword}. Skipping lead.`);
            continue;
        }

        console.log(`[Main] [${candidateName}] [${keywords}] Processing email ${i + 1} of ${leads.length} to: ${email}...`);
        console.log(`[Main] Extracted Post URL: ${postUrl}`);

        // Ensure the post has a valid URL before sending to guarantee every mail has a post link
        if (!postUrl || postUrl === 'Not available' || !postUrl.startsWith('http')) {
            console.log(`[Main] Skipping email to ${email} because the LinkedIn post URL is not available.`);
            continue;
        }

        // Check if we already messaged them (unless SKIP_SENT_CHECK is enabled)
        if (!skipSentCheck && hasAlreadyBeenSent(email)) {
            console.log(`[Main] Already messaged ${email}. Skipping.`);
            continue;
        }

        // Extract role from keywords
        const quoteMatch = keywords.match(/"([^"]+)"/);
        const roleName = quoteMatch ? quoteMatch[1] : (keywords.split(' + ')[0] || keywords.split(' and ')[0] || 'Software Engineer');

        const emailSubject = `submission on ${roleName}`;
        const jdHtml = jd;

        const linkedinHtml = (profile.linkedin && profile.linkedin.trim() !== '')
            ? `<p style="margin: 0;">LinkedIn: <a href="${profile.linkedin}">${profile.linkedin}</a></p>`
            : '';

        const emailBodyHtml = `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
            <p>Hi,</p>
            <p>Hope you are doing well,</p>
            <p>Kindly find attached resume and below details:</p>
            <p style="margin: 0;">Full Name: ${profile.name}</p>
            <p style="margin: 0;">Email Address : ${profile.email}</p>
            <p style="margin: 0;">Phone: ${profile.phone}</p>
            ${linkedinHtml}
            <p style="margin: 0;">Current Location: ${profile.location}</p>
            <p style="margin: 0;">Open to Relocate: Yes</p>
            <p style="margin: 0;">Work Authorization: ${profile.workAuth}</p>
            <p style="margin: 0;">Availability: Immediate</p>
            <p style="margin: 0;">Total Experience: ${profile.experience}</p>
            <p style="margin: 0;">Salary: ${profile.salary}</p>
            <br>
            <p style="margin: 0;">Regards</p>
            <p style="margin: 0;">${profile.name}</p>
            <p style="margin: 0;">${profile.teamLeadEmail || 'quinn@jpitstaffing.com'}</p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <h3 style="color: #555;">Job description as per linkedin post</h3>
            <p style="margin: 0 0 10px 0;">Source LinkedIn Post: <a href="${postUrl}">${postUrl}</a></p>
            <div style="background-color: #f4f6f8; padding: 15px; border-left: 4px solid #0a66c2; border-radius: 4px; color: #444; font-size: 0.95em; white-space: pre-wrap;">
                ${jdHtml}
            </div>
        </div>`;

        try {
            let finalResumePath = '';
            let aiResumeData = null;
            if (tailorResume) {
                // 1. Generate Custom AI Resume Data from the JD
                console.log(`[Main] Generating new AI-tailored resume content for role: ${roleName}...`);
                aiResumeData = await generateResumePoints(jd, roleName, sentences, profile);
                if (aiResumeData && aiResumeData.isFallback) {
                    console.warn(`[Main] Warning: Gemini API failed or was rate-limited. Using default/fallback "${roleName}" resume template for ${email}`);
                } else {
                    console.log(`[Main] Successfully generated customized resume content for ${email}`);
                }

                // 2. Compile the tailored Word → PDF via Word COM
                console.log(`[Main] Compiling tailored Word resume → PDF for ${email}...`);
                finalResumePath = await generateDynamicResume(aiResumeData, candidateResumePath);
            } else {
                // Use static resume compiled from template
                const staticData = { isFallback: true };
                for (const key in sentences) {
                    staticData[key] = { original: sentences[key], tailored: sentences[key] };
                }
                console.log(`[Main] TAILOR_RESUME is disabled. Compiling static resume template for ${email}...`);
                finalResumePath = await generateDynamicResume(staticData, candidateResumePath);
            }

            // 3. Send Email or delegate to n8n
            const n8nMountedPath = process.env.N8N_MOUNTED_PATH || '/workspace';
            const n8nPdfPath = `${n8nMountedPath}/${path.basename(finalResumePath)}`;
            const pdfPathForSheets = (!sendEmailViaNode) ? n8nPdfPath : finalResumePath;

            if (!sendEmailViaNode) {
                console.log(`[Main] SEND_EMAIL_VIA_NODE is false. Delegating email to n8n queue via Sheets logging.`);
            } else {
                console.log(`[Main] Sending email directly from Node.js using Gmail API...`);
                await sendEmail(email, emailSubject, emailBodyHtml, finalResumePath, profile.email);
            }
            
            // Increment count
            candidateSentCount++;
            keywordSentCounts[keywords] = (keywordSentCounts[keywords] || 0) + 1;

            // Add to our history and save so we never email them again
            sentHistory.push(email);
            saveDatabase(SENT_DB_PATH, sentHistory);

            // Add to our JD log so the user knows what they applied for
            appliedJobsLog.push({ 
                candidate: candidateName,
                email: email, 
                date: new Date().toISOString(), 
                jd: jd,
                postUrl: postUrl,
                pdfPath: pdfPathForSheets,
                isFallback: aiResumeData ? aiResumeData.isFallback : true
            });
            saveDatabase(APPLIED_LOG_PATH, appliedJobsLog);

            // Save to Google Sheets (including email subject, html body, and PDF path for n8n)
            await logToGoogleSheets(email, jd, emailSubject, emailBodyHtml, pdfPathForSheets, postUrl);
        } catch (err) {
            console.error(`[Main] Skipping ${email} due to error:`, err.message);
            
            // Add to failed database
            if (!failedEmails.includes(email)) {
                failedEmails.push(email);
                saveDatabase(FAILED_DB_PATH, failedEmails);
            }
        }

        // Add a delay between sending individual emails to avoid spam/rate limits
        if (i < leads.length - 1 && candidateSentCount < emailsPerCandidate) {
            console.log(`[Main] Waiting ${emailDelayMs / 1000} seconds before processing next email...`);
            await new Promise(resolve => setTimeout(resolve, emailDelayMs));
        }
    }
}

async function main() {
    console.log('--- LinkedIn Automation Started ---');

    try {
        const sentHistory = loadDatabase(SENT_DB_PATH);
        let failedEmails = loadDatabase(FAILED_DB_PATH);
        const APPLIED_LOG_PATH = path.join(DATA_DIR, 'applied_jobs_log.json');
        let appliedJobsLog = loadDatabase(APPLIED_LOG_PATH);

        // Determine candidate(s) to run for
        const args = process.argv.slice(2);
        let targetCandidate = null;
        let forceScrape = false;
        let runMode = 'both'; // 'scrape', 'send', 'apply', or 'both'

        for (const arg of args) {
            if (arg.startsWith('--candidate=')) {
                targetCandidate = arg.split('=')[1].toLowerCase();
            } else if (arg === '--force-scrape') {
                forceScrape = true;
            } else if (['scrape', 'send', 'apply', 'both'].includes(arg.toLowerCase())) {
                const val = arg.toLowerCase();
                runMode = (val === 'apply') ? 'send' : val;
            } else if (!arg.startsWith('-')) {
                targetCandidate = arg.toLowerCase();
            }
        }
        if (!targetCandidate && process.env.ACTIVE_CANDIDATE) {
            targetCandidate = process.env.ACTIVE_CANDIDATE.toLowerCase();
        }

        const candidatesBaseDir = path.join(__dirname, 'candidates');
        let candidatesToProcess = [];

        if (targetCandidate) {
            const candidateDir = path.join(candidatesBaseDir, targetCandidate);
            if (!fs.existsSync(candidateDir)) {
                console.error(`[Main] Error: Candidate directory not found for "${targetCandidate}" at ${candidateDir}`);
                return;
            }
            candidatesToProcess.push({ name: targetCandidate, dir: candidateDir });
        } else {
            if (!fs.existsSync(candidatesBaseDir)) {
                console.error(`[Main] Error: Candidates directory not found at ${candidatesBaseDir}`);
                return;
            }
            const items = fs.readdirSync(candidatesBaseDir);
            for (const item of items) {
                const fullPath = path.join(candidatesBaseDir, item);
                if (fs.statSync(fullPath).isDirectory()) {
                    if (fs.existsSync(path.join(fullPath, 'profile.json'))) {
                        candidatesToProcess.push({ name: item, dir: fullPath });
                    }
                }
            }
        }

        if (candidatesToProcess.length === 0) {
            console.log('[Main] No candidates to process.');
            return;
        }

        console.log(`[Main] Candidates to process: ${candidatesToProcess.map(c => c.name).join(', ')}`);

        for (const candidate of candidatesToProcess) {
            const originalGeminiKey = process.env.GEMINI_API_KEY;
            const originalMaxPages = process.env.MAX_PAGES;
            try {
                await processCandidate(candidate.name, candidate.dir, sentHistory, failedEmails, appliedJobsLog, APPLIED_LOG_PATH, forceScrape, runMode);
            } finally {
                process.env.GEMINI_API_KEY = originalGeminiKey;
                process.env.MAX_PAGES = originalMaxPages;
            }
        }

        console.log('--- Process Successfully Completed ---');

    } catch (error) {
        console.error('[Main] Critical failure:', error.message);
    }
}

main();
