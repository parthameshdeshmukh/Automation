const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { logToGoogleSheets } = require('./services/sheetsService');

async function syncOldData() {
    const APPLIED_LOG_PATH = path.join(__dirname, 'applied_jobs_log.json');
    if (!fs.existsSync(APPLIED_LOG_PATH)) {
        console.log("No applied_jobs_log.json found.");
        return;
    }

    const appliedJobs = JSON.parse(fs.readFileSync(APPLIED_LOG_PATH, 'utf8'));
    console.log(`Found ${appliedJobs.length} previous applications. Syncing to Google Sheets...`);

    for (let i = 0; i < appliedJobs.length; i++) {
        const job = appliedJobs[i];
        try {
            // Clean JD again just in case the old JSON has hashtags
            let cleanJD = job.jd.replace(/#[\w-]+\b/g, ''); 
            cleanJD = cleanJD.replace(/\bhashtag\b/gi, '');
            cleanJD = cleanJD.replace(/https?:\/\/[^\s]+/g, '');
            cleanJD = cleanJD.replace(/\n{3,}/g, '\n\n').trim();

            const dateObj = new Date(job.date);
            const formattedDate = dateObj.toLocaleString(); // Format like the standard script

            await logToGoogleSheets(job.email, cleanJD, formattedDate);
            console.log(`[${i+1}/${appliedJobs.length}] Synced ${job.email}`);

            // Wait 2 seconds between requests to avoid hitting Google Sheets API rate limits
            await new Promise(res => setTimeout(res, 2000));
        } catch (err) {
            console.error(`Failed to sync ${job.email}:`, err.message);
        }
    }
    console.log("✅ Sync complete!");
}

syncOldData();
