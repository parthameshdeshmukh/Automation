const { sendEmail } = require('./services/gmailService');
require('dotenv').config();

async function runTest() {
    console.log('--- Starting Gmail Test ---');
    console.log('Sending test email to:', process.env.GMAIL_USER);
    
    try {
        await sendEmail(
            process.env.GMAIL_USER, 
            'Gmail API Integration Test', 
            'Hello! This is a test email from your automation script. If you received this, your credentials are working correctly!',
            './resume.pdf' // Assuming this exists as seen in your folder
        );
        console.log('--- Test Successful! ---');
    } catch (error) {
        console.error('--- Test Failed ---');
        console.error('Error Details:', error.message);
        console.log('\nPossible fixes:');
        console.log('1. Check if your .env file exists and has no typos.');
        console.log('2. Ensure your Refresh Token was exchanged correctly in the Playground.');
        console.log('3. Make sure you added https://developers.google.com/oauthplayground to your Redirect URIs.');
    }
}

runTest();
