const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const authFilePath = path.join(__dirname, '..', '.auth', 'state.json');

/**
 * Scrapes LinkedIn posts based on keywords.
 */
async function scrapeLinkedInPosts(keywords) {
    console.log(`[Scraper] Starting LinkedIn scraper for: "${keywords}"`);
    
    const browser = await chromium.launch({ headless: false }); // Visible for manual login/2FA if needed
    
    let context;
    if (fs.existsSync(authFilePath)) {
        console.log('[Scraper] Using saved session cookies to bypass login!');
        context = await browser.newContext({ storageState: authFilePath });
    } else {
        console.log('[Scraper] No saved session found, creating new context...');
        context = await browser.newContext();
    }
    
    const page = await context.newPage();

    try {
        // 1. Navigate to LinkedIn
        await page.goto('https://www.linkedin.com/feed/');
        
        // Wait briefly to see if we are redirected to login
        await page.waitForTimeout(3000);
        
        if (page.url().includes('/login') || page.url().includes('session_redirect')) {
            console.log('[Scraper] Session expired or missing. Attempting password login...');
            // Try standard login (using stealth typing to avoid bot detection)
            await page.goto('https://www.linkedin.com/login');
            
            // Randomize typing speed to look like a human
            await page.type('#username', process.env.LINKEDIN_EMAIL, { delay: Math.floor(Math.random() * 100) + 50 });
            await page.waitForTimeout(500 + Math.random() * 1000); 
            await page.type('#password', process.env.LINKEDIN_PASSWORD, { delay: Math.floor(Math.random() * 100) + 50 });
            await page.waitForTimeout(500 + Math.random() * 1000);
            await page.click('button[type="submit"]');

            console.log('[Scraper] Waiting for feed to load (check for 2FA on browser if stuck)...');
            await page.waitForURL('**/feed/**', { timeout: 60000 });
            
            // Save cookies for next time
            if (!fs.existsSync(path.dirname(authFilePath))) {
                fs.mkdirSync(path.dirname(authFilePath), { recursive: true });
            }
            await context.storageState({ path: authFilePath });
        }

        // 3. Search for posts
        console.log(`[Scraper] Searching for "${keywords}"...`);
        const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keywords)}&origin=GLOBAL_SEARCH_HEADER`;
        await page.goto(searchUrl);
        await page.waitForSelector('.search-results-container');

        // 4. Extract post content
        console.log('[Scraper] Extracting post contents...');
        
        // Scroll a bit to load more content
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await page.waitForTimeout(2000);
        }

        const posts = await page.evaluate(() => {
            const postElements = document.querySelectorAll('.update-components-text span[dir="ltr"]');
            return Array.from(postElements).map(el => el.innerText);
        });

        console.log(`[Scraper] Successfully scraped ${posts.length} posts.`);
        return posts;

    } catch (error) {
        console.error('[Scraper] Error during scraping:', error.message);
        return [];
    } finally {
        await browser.close();
    }
}

module.exports = scrapeLinkedInPosts;
