require('dotenv').config();
const scrapeLinkedInPosts = require('./scraper/linkedin');
const { extractEmails } = require('./utils/extractEmail');
const { sendEmail } = require('./services/gmailService');
const { logToGoogleSheets } = require('./services/sheetsService');
const { generateResumePoints } = require('./services/geminiService');
const { generateDynamicResume } = require('./services/compilePdfService');
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
    const roleResumesCache = {}; // Cache for storing tailored resume data per role

    try {
        const searchCriteria = [
            'JAVA DEVELOPER + C2C',
            'BUSINESS ANALYST + C2C',
            'PROJECT MANAGER + C2C',
            'DATA ANALYST + C2C'
        ];
        // Check if base template exists
        const templatePath = path.resolve('./resume_template.tex');
        if (!fs.existsSync(templatePath)) {
            console.error(`[Main] Error: Resume template not found at ${templatePath}.`);
            return;
        }

        const sentHistory = loadDatabase(SENT_DB_PATH);
        let failedEmails = loadDatabase(FAILED_DB_PATH);
        const APPLIED_LOG_PATH = path.join(__dirname, 'applied_jobs_log.json');
        let appliedJobsLog = loadDatabase(APPLIED_LOG_PATH);

        let allScrapedPosts = [];
        for (const keywords of searchCriteria) {
            console.log(`\n=== Searching for: ${keywords} ===`);
            try {
                const posts = await scrapeLinkedInPosts(keywords);
                if (posts.length > 0) {
                    const mapped = posts.map(p => ({ ...p, keywords }));
                    allScrapedPosts.push(...mapped);
                }
            } catch (err) {
                console.error(`[Main] Scraper failed for ${keywords}:`, err.message);
            }
        }

        if (allScrapedPosts.length === 0) {
            console.log('[Main] No posts found for any search criteria.');
            return;
        }

        // 2. Extract Emails from the combined set of posts
        const extractedData = extractEmails(allScrapedPosts);

        if (extractedData.length === 0) {
            console.log('[Main] No email addresses found across all keywords.');
            return;
        }

        // Limit the number of emails sent collectively (default: 250)
        const maxEmails = process.env.MAX_EMAILS ? parseInt(process.env.MAX_EMAILS) : 250;
        const testLimitData = extractedData.slice(0, maxEmails);

        // 3. Send Emails
        console.log(`[Main] Preparing to send ${testLimitData.length} emails collectively...`);

        for (let i = 0; i < testLimitData.length; i++) {
            const data = testLimitData[i];
            const email = data.email;
            const jd = data.jd;
            const postUrl = data.postUrl;
            const keywords = data.keywords || 'Software Engineer';

            console.log(`[Main] Processing email ${i + 1} of ${testLimitData.length} to: ${email}...`);
            console.log(`[Main] Extracted Post URL: ${postUrl}`);

            // Ensure the post has a valid URL before sending to guarantee every mail has a post link
            if (!postUrl || postUrl === 'Not available' || !postUrl.startsWith('http')) {
                console.log(`[Main] Skipping email to ${email} because the LinkedIn post URL is not available.`);
                continue;
            }

            // Check if we already messaged them
            if (hasAlreadyBeenSent(email)) {
                console.log(`[Main] Already messaged ${email}. Skipping.`);
                continue;
            }

            // Extract role from keywords (e.g. "JAVA DEVELOPER + C2C" -> "JAVA DEVELOPER")
            const roleName = keywords.split(' + ')[0] || keywords.split(' and ')[0] || 'Software Engineer';
            
            const candidateName = process.env.CANDIDATE_NAME || 'Prathamesh Deshmukh';
            const candidateEmail = process.env.CANDIDATE_EMAIL || 'prathameshdeshmukh480@gmail.com';
            const candidatePhone = process.env.CANDIDATE_PHONE || '9321284257';
            const candidateLinkedin = process.env.CANDIDATE_LINKEDIN || 'https://www.linkedin.com/in/prathamesh-deshmukh-297a81259/';
            const candidateLocation = process.env.CANDIDATE_LOCATION || 'Ulwe, Navi Mumbai';
            const candidateWorkAuth = process.env.CANDIDATE_WORK_AUTH || 'Indian Citizen';
            const candidateExperience = process.env.CANDIDATE_EXPERIENCE || 'Fresher';
            const candidateSalary = process.env.CANDIDATE_SALARY || 'Open';
            const teamLeadEmail = process.env.TEAM_LEAD_EMAIL || 'quinn@jpitstaffing.com';

            const emailSubject = `Submission "${roleName}" Local to "${candidateLocation}"`;
            
            const jdHtml = jd;

            const emailBodyHtml = `
            <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                <p>Hi,</p>
                <p>Hope you are doing well,</p>
                <p>Kindly find attached resume and below details:</p>
                <p style="margin: 0;">Full Name: ${candidateName}</p>
                <p style="margin: 0;">Email Address : ${candidateEmail}</p>
                <p style="margin: 0;">Phone: ${candidatePhone}</p>
                <p style="margin: 0;">LinkedIn: <a href="${candidateLinkedin}">${candidateLinkedin}</a></p>
                <p style="margin: 0;">Current Location: ${candidateLocation}</p>
                <p style="margin: 0;">Open to Relocate: Yes</p>
                <p style="margin: 0;">Work Authorization: ${candidateWorkAuth}</p>
                <p style="margin: 0;">Availability: Immediate</p>
                <p style="margin: 0;">Total Experience: ${candidateExperience}</p>
                <p style="margin: 0;">Salary: ${candidateSalary}</p>
                <br>
                <p style="margin: 0;">Regards</p>
                <p style="margin: 0;">${candidateName}</p>
                <p style="margin: 0;">${teamLeadEmail}</p>
                
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                
                <h3 style="color: #555;">Job description as per linkedin post</h3>
                <p style="margin: 0 0 10px 0;">Source LinkedIn Post: <a href="${postUrl}">${postUrl}</a></p>
                <div style="background-color: #f4f6f8; padding: 15px; border-left: 4px solid #0a66c2; border-radius: 4px; color: #444; font-size: 0.95em; white-space: pre-wrap;">
                    ${jdHtml}
                </div>
            </div>`;

            try {
                // 1. Generate Custom AI Resume Data from the JD (Disabled caching so every JD gets tailored)
                console.log(`[Main] Generating new AI-tailored resume content for role: ${roleName}...`);
                const aiResumeData = await generateResumePoints(jd);
                if (aiResumeData && aiResumeData.summary.startsWith("Full Stack Developer (Fresher) with a strong foundation")) {
                    console.warn(`[Main] Warning: Gemini API failed or was rate-limited. Using default/fallback resume template for ${email}`);
                } else {
                    console.log(`[Main] Successfully generated customized resume content for ${email}`);
                }

                // 2. Compile the custom LaTeX Resume
                console.log(`[Main] Compiling LaTeX Resume for ${email}...`);
                const finalResumePath = await generateDynamicResume(aiResumeData);

                // 3. Send Email with the dynamically generated PDF
                await sendEmail(email, emailSubject, emailBodyHtml, finalResumePath);
                
                // Add to our history and save so we never email them again
                sentHistory.push(email);
                saveDatabase(SENT_DB_PATH, sentHistory);

                // Add to our JD log so the user knows what they applied for
                appliedJobsLog.push({ 
                    email: email, 
                    date: new Date().toISOString(), 
                    jd: jd,
                    postUrl: postUrl
                });
                saveDatabase(APPLIED_LOG_PATH, appliedJobsLog);

                // Save to Google Sheets
                await logToGoogleSheets(email, jd, null, postUrl);
            } catch (err) {
                console.error(`[Main] Skipping ${email} due to error:`, err.message);
                
                // Add to failed database
                if (!failedEmails.includes(email)) {
                    failedEmails.push(email);
                    saveDatabase(FAILED_DB_PATH, failedEmails);
                }
            }

            // Add a delay between sending individual emails to avoid spam/rate limits
            if (i < testLimitData.length - 1) {
                console.log(`[Main] Waiting 10 seconds before processing next email...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }

        console.log('--- Process Successfully Completed ---');

    } catch (error) {
        console.error('[Main] Critical failure:', error.message);
    }
}

main();
