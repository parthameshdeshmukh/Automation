require('dotenv').config();
const scrapeLinkedInPosts = require('./scraper/linkedin');
const extractEmails = require('./utils/extractEmail');
const { sendEmail } = require('./services/gmailService');
const { logToGoogleSheets } = require('./services/sheetsService');
const fs = require('fs');
const path = require('path');

const SENT_DB_PATH = path.join(__dirname, 'sent_history.json');
const FAILED_DB_PATH = path.join(__dirname, 'failed_emails.json');

function loadDatabase(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveDatabase(filePath, dataArray) {
    fs.writeFileSync(filePath, JSON.stringify(dataArray, null, 2));
}

function hasAlreadyBeenSent(email) {
    const sentHistory = loadDatabase(SENT_DB_PATH);
    return sentHistory.includes(email);
}

async function main() {
    console.log('--- LinkedIn Automation Started ---');

    try {
        const keywords = process.env.SEARCH_KEYWORDS || 'Java Developer and Contract';
        const resumePath = path.resolve(process.env.RESUME_PATH || './resume.pdf');

        // Check if resume exists
        if (!fs.existsSync(resumePath)) {
            console.error(`[Main] Error: Resume file not found at ${resumePath}. Please place your resume.pdf in the project root.`);
            return;
        }

        // 1. Scrape Posts
        const posts = await scrapeLinkedInPosts(keywords);
        
        if (posts.length === 0) {
            console.log('[Main] No posts found. Exiting.');
            return;
        }

        // 2. Extract Emails
        const extractedData = extractEmails(posts);

        if (extractedData.length === 0) {
            console.log('[Main] No email addresses found in the posts. Exiting.');
            return;
        }

        // 3. Send Emails
        console.log(`[Main] Preparing to send ${extractedData.length} emails...`);
        
        const sentHistory = loadDatabase(SENT_DB_PATH);
        let failedEmails = loadDatabase(FAILED_DB_PATH);
        
        const APPLIED_LOG_PATH = path.join(__dirname, 'applied_jobs_log.json');
        let appliedJobsLog = loadDatabase(APPLIED_LOG_PATH);

        for (const data of extractedData) {
            const email = data.email;
            const jd = data.jd;
            const postUrl = data.postUrl;

            // Check if we already messaged them
            if (hasAlreadyBeenSent(email)) {
                console.log(`[Main] Already messaged ${email}. Skipping.`);
                continue;
            }

            const emailSubject = "Application for Java Developer Role - via LinkedIn";
            
            // Format JD for HTML by replacing newlines with <br>
            const jdHtml = jd.replace(/\n\n/g, '<br><br>');

            let emailBodyHtml = `
            <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                <p>Hi,</p>
                <p>I am writing to express my interest in the Java Developer role you recently shared on LinkedIn.</p>
                <p>With a strong background in Java development, I am confident that my technical skills and experience make me a great fit for your team.</p>
                <p>I have attached my resume for your review. For your reference, I have also included a copy of the job description from your post below.</p>
            `;

            if (postUrl && postUrl !== 'Not available') {
                emailBodyHtml += `<p>You can also view the original LinkedIn post here: <a href="${postUrl}">${postUrl}</a></p>`;
            }

            emailBodyHtml += `
                <p>Thank you for your time and consideration. I look forward to the opportunity to discuss my qualifications with you.</p>
                <p>Best regards,<br><strong>Prathamesh Deshmukh</strong></p>
                
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                
                <h3 style="color: #555;">Job Description Reference:</h3>
                <div style="background-color: #f4f6f8; padding: 15px; border-left: 4px solid #0a66c2; border-radius: 4px; color: #444; font-size: 0.95em;">
                    ${jdHtml}
                </div>
            </div>`;

            try {
                // Pass emailBodyHtml instead of plaintext emailBody. We won't attach jd as a txt file anymore.
                await sendEmail(email, emailSubject, emailBodyHtml, resumePath);
                
                // Add to our history and save so we never email them again
                sentHistory.push(email);
                saveDatabase(SENT_DB_PATH, sentHistory);

                // Add to our JD log so the user knows what they applied for
                appliedJobsLog.push({ 
                    email: email, 
                    date: new Date().toISOString(), 
                    jd: jd 
                });
                saveDatabase(APPLIED_LOG_PATH, appliedJobsLog);


                // Save to Google Sheets
                await logToGoogleSheets(email, jd);

                // Delay between sends (10s to avoid rate limits)
                await new Promise(resolve => setTimeout(resolve, 10000));
            } catch (err) {
                console.error(`[Main] Skipping ${email} due to error.`);
                
                // Add to failed database
                if (!failedEmails.includes(email)) {
                    failedEmails.push(email);
                    saveDatabase(FAILED_DB_PATH, failedEmails);
                }
            }
        }

        console.log('--- Process Successfully Completed ---');

    } catch (error) {
        console.error('[Main] Critical failure:', error.message);
    }
}

main();
