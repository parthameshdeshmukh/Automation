const nodemailer = require('nodemailer');
const { google } = require('googleapis');
require('dotenv').config();

/**
 * Sends an email with a resume attachment using Gmail OAuth2.
 */
async function sendEmail(toEmail, subject, htmlBody, attachmentPath) {
    try {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET,
            'https://developers.google.com/oauthplayground'
        );

        oauth2Client.setCredentials({
            refresh_token: process.env.GMAIL_REFRESH_TOKEN
        });

        const accessToken = await oauth2Client.getAccessToken();

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: process.env.GMAIL_USER,
                clientId: process.env.GMAIL_CLIENT_ID,
                clientSecret: process.env.GMAIL_CLIENT_SECRET,
                refreshToken: process.env.GMAIL_REFRESH_TOKEN,
                accessToken: accessToken.token
            }
        });

        const mailOptions = {
            from: process.env.GMAIL_USER,
            to: toEmail,
            subject: subject,
            html: htmlBody
        };

        // Bypasses CC/BCC for self-notifications, subjects containing "NOTIFICATION", or if DISABLE_CC_BCC is enabled
        const isNotification = toEmail === process.env.GMAIL_USER || subject.includes("NOTIFICATION");
        const disableCcBcc = process.env.DISABLE_CC_BCC === 'true';
        if (!isNotification && !disableCcBcc) {
            const candidateEmail = process.env.CANDIDATE_EMAIL || process.env.GMAIL_USER;
            const teamLeadEmail = process.env.TEAM_LEAD_EMAIL || 'quinn@jpitstaffing.com';
            mailOptions.cc = `${candidateEmail}, ${teamLeadEmail}`;
            mailOptions.bcc = 'kim@jpitstaffing.com';
        }

        if (attachmentPath) {
            mailOptions.attachments = [
                {
                    filename: 'Resume.pdf',
                    path: attachmentPath
                }
            ];
        }

        const result = await transporter.sendMail(mailOptions);
        console.log(`[Email] Successfully sent HTML email to: ${toEmail}`);
        return result;

    } catch (error) {
        console.error(`[Email] Failed to send email to ${toEmail}:`, error.message);
        throw error;
    }
}

module.exports = { sendEmail };
