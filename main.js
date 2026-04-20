require('dotenv').config();
const scrapeLinkedInPosts = require('./scraper/linkedin');
const extractEmails = require('./utils/extractEmail');
const { sendEmail } = require('./services/gmailService');
const fs = require('fs');
const path = require('path');

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
        const emails = extractEmails(posts);

        if (emails.length === 0) {
            console.log('[Main] No email addresses found in the posts. Exiting.');
            return;
        }

        // 3. Send Emails
        console.log(`[Main] Preparing to send ${emails.length} emails...`);
        
        const emailSubject = "Application for Java Developer Role - via LinkedIn Post";
        const emailBody = `Hi,

I saw your recent post on LinkedIn regarding the Java Developer position. I'm very interested in this opportunity and believe my background in Java development makes me a strong candidate.

Please find my resume attached for your review. I look forward to hearing from you.

Best regards,
Prathamesh Deshmukh `;

        for (const email of emails) {
            try {
                await sendEmail(email, emailSubject, emailBody, resumePath);
                // Respectful delay between sends
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (err) {
                console.error(`[Main] Skipping ${email} due to error.`);
            }
        }

        console.log('--- Process Successfully Completed ---');

    } catch (error) {
        console.error('[Main] Critical failure:', error.message);
    }
}

main();
