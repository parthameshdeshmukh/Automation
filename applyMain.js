require('dotenv').config();
const scrapeLinkedInJobs = require('./scraper/linkedinJobs');
const { autofillJobApplication } = require('./services/autofillService');
const { logToGoogleSheets } = require('./services/sheetsService');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');
const path = require('path');

const { generateDynamicResume } = require('./services/compilePdfService');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const FOUND_JOBS_PATH = path.join(DATA_DIR, 'found_jobs.json');
const authFilePath = path.join(__dirname, '.auth', 'state.json');

async function main() {
    const args = process.argv.slice(2);
    let runMode = 'both'; // 'scrape', 'apply', or 'both'
    let targetCandidate = null;

    // Parse arguments: e.g. node applyMain.js both shilpa
    for (const arg of args) {
        if (arg.startsWith('--candidate=')) {
            targetCandidate = arg.split('=')[1].toLowerCase();
        } else if (['scrape', 'apply', 'both'].includes(arg.toLowerCase())) {
            runMode = arg.toLowerCase();
        } else if (!arg.startsWith('-')) {
            targetCandidate = arg.toLowerCase();
        }
    }

    if (!targetCandidate && process.env.ACTIVE_CANDIDATE) {
        targetCandidate = process.env.ACTIVE_CANDIDATE.toLowerCase();
    }
    if (!targetCandidate) {
        targetCandidate = 'deepika'; // default fallback
    }

    console.log(`=== LinkedIn External Portal Job Applier [Candidate: ${targetCandidate.toUpperCase()}] ===`);

    const candidateDir = path.join(__dirname, 'candidates', targetCandidate);
    const profilePath = path.join(candidateDir, 'profile.json');
    if (!fs.existsSync(profilePath)) {
        console.error(`[Main] Error: Profile not found for candidate "${targetCandidate}" at ${profilePath}`);
        return;
    }

    const rawProfile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const fullName = rawProfile.name;
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Search keywords and location can be custom or read from the candidate's profile/env
    const keyword = process.env.JOB_SEARCH_KEYWORD || (rawProfile.searchCriteria && rawProfile.searchCriteria[0] ? rawProfile.searchCriteria[0].replace(/"/g, '').split(' AND ')[0] : 'Java Developer');
    const location = process.env.JOB_SEARCH_LOCATION || 'United States';

    const profile = {
        firstName,
        lastName,
        email: rawProfile.email || '',
        phone: rawProfile.phone || '',
        linkedin: rawProfile.linkedin || '',
        github: rawProfile.github || '',
        portfolio: rawProfile.portfolio || '',
        resumePath: '',
        requiresSponsorship: rawProfile.workAuth ? !rawProfile.workAuth.toLowerCase().includes('us citizen') : true
    };

    // Compile static resume PDF for the candidate
    const sentencesPath = path.join(candidateDir, 'sentences.json');
    const sentences = fs.existsSync(sentencesPath) ? JSON.parse(fs.readFileSync(sentencesPath, 'utf8')) : {};
    const staticData = { isFallback: true };
    for (const key in sentences) {
        staticData[key] = { original: sentences[key], tailored: sentences[key] };
    }
    
    let candidateResumePath = path.join(candidateDir, 'resume.tex');
    if (!fs.existsSync(candidateResumePath)) {
        candidateResumePath = path.join(candidateDir, 'resume.docx');
    }

    console.log(`[Main] Compiling static resume template to PDF for ${fullName}...`);
    try {
        const compiledPdfPath = await generateDynamicResume(staticData, candidateResumePath);
        profile.resumePath = compiledPdfPath;
        console.log(`[Main] Using compiled PDF resume for application: ${profile.resumePath}`);
    } catch (err) {
        console.error(`[Main] Failed to compile resume PDF:`, err.message);
        return;
    }

    console.log(`[Main] Applicant Name: "${fullName}" (${firstName} | ${lastName})`);
    console.log(`[Main] Email: "${profile.email}", Phone: "${profile.phone}"`);

    let jobs = [];

    // Phase 1: Scrape Jobs (if runMode is 'scrape' or 'both')
    if (runMode === 'scrape' || runMode === 'both') {
        console.log('\n--- Step 1-3: Searching & Filtering LinkedIn Jobs ---');
        try {
            const pagesToCheck = process.env.MAX_PAGES ? parseInt(process.env.MAX_PAGES, 10) : 2;
            console.log(`[Main] Scraping up to ${pagesToCheck} pages of jobs.`);
            jobs = await scrapeLinkedInJobs(keyword, location, pagesToCheck, profile);
            fs.writeFileSync(FOUND_JOBS_PATH, JSON.stringify(jobs, null, 2));
            console.log(`[Main] Saved ${jobs.length} jobs to ${FOUND_JOBS_PATH}`);
        } catch (err) {
            console.error('[Main] Scraper failed:', err.message);
            if (runMode === 'both') return;
        }
    } else {
        // Load existing jobs
        if (fs.existsSync(FOUND_JOBS_PATH)) {
            jobs = JSON.parse(fs.readFileSync(FOUND_JOBS_PATH, 'utf8'));
            console.log(`[Main] Loaded ${jobs.length} existing jobs from ${FOUND_JOBS_PATH}`);
        } else {
            console.log(`[Main] No saved jobs found at ${FOUND_JOBS_PATH}. Please run in scrape mode first.`);
            return;
        }
    }

    // Phase 2: Autofill Jobs (if runMode is 'apply' or 'both')
    if (runMode === 'apply' || runMode === 'both') {
        console.log('\n--- Step 4-5: Detecting Portals & Autofilling Forms ---');

        const applyLimit = process.env.PORTAL_APPLY_LIMIT ? parseInt(process.env.PORTAL_APPLY_LIMIT, 10) : 10;
        const onlyEasyApply = process.env.ONLY_EASY_APPLY === 'true';
        const autofillJobs = jobs.filter(job => {
            if (!job.portalUrl) return false;
            if (job.applied) return false; // Skip if already applied in scraping phase!
            const url = job.portalUrl.toLowerCase();
            if (onlyEasyApply && !job.isEasyApply) return false;
            return (url.startsWith('http') || url.startsWith('file')) && 
                   !url.includes('linkedin.com/safety') && 
                   !url.includes('chrome-error:') &&
                   !url.includes('chromewebdata');
        }).slice(0, applyLimit);

        console.log(`[Main] Out of ${jobs.length} jobs, selected ${autofillJobs.length} valid external portals for auto-filling.`);

        if (autofillJobs.length === 0) {
            console.log('[Main] No valid external portal jobs to apply to. Process finished.');
            return;
        }

        // Initialize browser context for form filling
        const browser = await chromium.launch({ headless: false });
        let context;
        if (fs.existsSync(authFilePath)) {
            context = await browser.newContext({ storageState: authFilePath });
        } else {
            context = await browser.newContext();
        }
        
        const page = await context.newPage();

        for (let i = 0; i < autofillJobs.length; i++) {
            const job = autofillJobs[i];
            console.log(`\n[Main] Processing Application ${i + 1} of ${autofillJobs.length}`);
            console.log(`       Company: "${job.company}", Title: "${job.title}"`);
            console.log(`       URL: ${job.portalUrl}`);

            try {
                await autofillJobApplication(page, job.portalUrl, profile, job.description);
                console.log(`[Main] Autofill finished for: "${job.title}" at "${job.company}".`);
                
                // Track application in Google Sheets
                const sheetSubject = `Autofilled Portal: ${job.title} at ${job.company}`;
                const autoSubmitEnabled = process.env.AUTO_SUBMIT === 'true';
                const sheetBody = autoSubmitEnabled 
                    ? `Autofilled candidate profile, uploaded resume.pdf, and automatically triggered form submission.`
                    : `Autofilled candidate profile and uploaded resume.pdf. Waiting for applicant manual submit.`;
                await logToGoogleSheets(profile.email, job.description, sheetSubject, sheetBody, profile.resumePath, job.portalUrl);
            } catch (fillErr) {
                if (fillErr.message.includes('skipped by user')) {
                    console.log(`[Main] Application for "${job.title}" at "${job.company}" was skipped by the user.`);
                } else {
                    console.error(`[Main] Failed to autofill job at ${job.portalUrl}:`, fillErr.message);
                }
            }
        }

        await browser.close();
        console.log('\n--- Autofill Process Completed ---');
    }
}

main();
