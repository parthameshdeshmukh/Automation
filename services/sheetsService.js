const { google } = require('googleapis');
require('dotenv').config();

/**
 * Appends a row to Google Sheets with application details.
 */
async function logToGoogleSheets(email, jd, subject, htmlBody, pdfPath, postUrl = "Not available", dateOverride = null) {
    if (!process.env.GOOGLE_SHEETS_ID) {
        console.log('[Sheets] GOOGLE_SHEETS_ID is not set in .env. Skipping Google Sheets logging.');
        return;
    }

    try {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET,
            'https://developers.google.com/oauthplayground'
        );

        oauth2Client.setCredentials({
            refresh_token: process.env.GMAIL_REFRESH_TOKEN
        });

        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        
        const dateStr = dateOverride || new Date().toLocaleString();
        
        // Truncate JD slightly just to ensure it fits in a cell if it's extremely long
        const safeJd = jd.length > 30000 ? jd.substring(0, 30000) + '... (Truncated)' : jd;
        const safeHtml = htmlBody.length > 30000 ? htmlBody.substring(0, 30000) + '... (Truncated)' : htmlBody;

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEETS_ID,
            range: 'Sheet1!A:H', // Appending to columns A through H
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [
                    [dateStr, email, safeJd, "Pending n8n processing", postUrl, subject, safeHtml, pdfPath]
                ]
            }
        });

        console.log(`[Sheets] Successfully added row for ${email} with PDF path ${pdfPath} to Google Sheets.`);
    } catch (error) {
        console.error(`[Sheets] Error updating Google Sheets for ${email}:`, error.message);
        console.log('[Sheets] HINT: Did you remember to add the Google Sheets scope in OAuth Playground?');
    }
}

module.exports = { logToGoogleSheets };
