const { google } = require('googleapis');
require('dotenv').config();

/**
 * Appends a row to Google Sheets with application details.
 */
async function logToGoogleSheets(email, jd, dateOverride = null, postUrl = "Not available") {
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
        const safeJd = jd.length > 40000 ? jd.substring(0, 40000) + '... (Truncated)' : jd;

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEETS_ID,
            range: 'Sheet1!A:E', // Appending to columns A, B, C, D, E
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [
                    [dateStr, email, safeJd, "Applied successfully", postUrl]
                ]
            }
        });

        console.log(`[Sheets] Successfully added row for ${email} to Google Sheets.`);
    } catch (error) {
        console.error(`[Sheets] Error updating Google Sheets for ${email}:`, error.message);
        console.log('[Sheets] HINT: Did you remember to add the Google Sheets scope in OAuth Playground?');
    }
}

module.exports = { logToGoogleSheets };
