const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const authFilePath = path.join(__dirname, '.auth', 'state.json');

async function setupAuth() {
    console.log('Opening browser for manual LinkedIn login...');
    console.log('You might see bot detection, captchas, or 2FA.');
    console.log('Please log in manually inside the opened browser window.');
    
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await page.goto('https://www.linkedin.com/login');

        // wait indefinitely for the user to login and land on the feed
        console.log('Waiting for you to log in... (Waiting for linkedin.com/feed/ to load)');
        await page.waitForURL('https://www.linkedin.com/feed/**', { timeout: 0 });
        
        console.log('Login successful! Saving session cookies...');

        // Create the directory if it doesn't exist
        const authDir = path.dirname(authFilePath);
        if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
        }

        // Save session state
        await context.storageState({ path: authFilePath });
        
        console.log(`\nSession saved to ${authFilePath}!`);
        console.log(`Future scrapes will automatically use this session and skip login.\n`);
    } catch (error) {
        console.error('Error during setup:', error);
    } finally {
        await browser.close();
    }
}

setupAuth();
