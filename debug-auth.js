const { google } = require('googleapis');
require('dotenv').config();

async function debugAuth() {
    console.log('--- Auth Debug Tool ---');
    console.log('Checking .env loading...');
    console.log('User:', process.env.GMAIL_USER);
    console.log('Client ID starts with:', process.env.GMAIL_CLIENT_ID ? process.env.GMAIL_CLIENT_ID.substring(0, 15) + '...' : 'MISSING');
    console.log('Client Secret ends with:', process.env.GMAIL_CLIENT_SECRET ? '...' + process.env.GMAIL_CLIENT_SECRET.slice(-5) : 'MISSING');
    
    const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN
    });

    console.log('\nAttempting to get a fresh Access Token...');
    try {
        const { token } = await oauth2Client.getAccessToken();
        console.log('✅ SUCCESS! Your credentials are valid.');
        console.log('Access Token acquired.');
    } catch (error) {
        console.log('❌ FAILED.');
        console.error('Error Name:', error.name);
        console.error('Error Message:', error.message);
        
        if (error.message.includes('unauthorized_client')) {
            console.log('\n--- ANALYSIS ---');
            console.log('Google is saying: "I don\'t know this Client ID or the Secret is wrong."');
            console.log('1. Go to Google Cloud Console.');
            console.log('2. Find the client you created.');
            console.log('3. RE-COPY the Secret and ID and paste them into .env again.');
            console.log('4. Ensure there are NO extra characters or spaces.');
        }
    }
}

debugAuth();
