const nodemailer = require('nodemailer');
const { google } = require('googleapis');
require('dotenv').config();

/**
 * Sends an email with a resume attachment using Gmail OAuth2.
 */
async function sendEmail(toEmail, subject, text, attachmentPath) {
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
            text: text,
            attachments: [
                {
                    filename: 'Resume.pdf',
                    path: attachmentPath
                }
            ]
        };

        const result = await transporter.sendMail(mailOptions);
        console.log(`[Email] Successfully sent email to: ${toEmail}`);
        return result;

    } catch (error) {
        console.error(`[Email] Failed to send email to ${toEmail}:`, error.message);
        throw error;
    }
}

module.exports = { sendEmail };
