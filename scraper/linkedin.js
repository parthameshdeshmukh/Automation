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

        // 3. Search for posts across multiple pages
        console.log(`[Scraper] Searching for "${keywords}" in past 24 hours across multiple pages...`);
        let allPosts = [];
        // let maxPages = process.env.MAX_PAGES ? parseInt(process.env.MAX_PAGES) : 5; // Default to 5 pages
        let maxPages = 1; // Temporarily limited to 1 page per user request

        for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
            console.log(`[Scraper] --- Scraping Page ${currentPage} ---`);
            const searchUrl = `https://www.linkedin.com/search/results/content/?datePosted=%22past-24h%22&keywords=${encodeURIComponent(keywords)}&sortBy=%22date_posted%22&page=${currentPage}`;
            await page.goto(searchUrl);
            
            // Wait for results container or handle timeout (could mean no more results)
            const hasResults = await page.waitForSelector('.search-results-container', { timeout: 15000 })
                .then(() => true)
                .catch(() => false);

            if (!hasResults) {
                console.log(`[Scraper] No search results container on page ${currentPage}. Ending pagination.`);
                break;
            }

            // Scroll down a to ensure lazy-loaded posts in this page are loaded
            let previousHeight = 0;
            let attemptsWithNoGrowth = 0;

            for (let i = 0; i < 5; i++) { // Limited scroll per page
                await page.keyboard.press('End');
                
                const randomWait = Math.floor(Math.random() * 2000) + 1500;
                await page.waitForTimeout(randomWait);

                const currentHeight = await page.evaluate(() => document.body.scrollHeight);
                if (currentHeight === previousHeight) {
                    attemptsWithNoGrowth++;
                    if (attemptsWithNoGrowth >= 2) break;
                } else {
                    attemptsWithNoGrowth = 0;
                    previousHeight = currentHeight;
                }
            }

            // Extract posts from the current page
            const pagePosts = await page.evaluate(() => {
                // Also adding 'span.break-words' to cover different linkedin post markup variants
                const postElements = document.querySelectorAll('.update-components-text span[dir="ltr"], .feed-shared-update-v2__description span[dir="ltr"]');
                return Array.from(postElements).map(el => {
                    let postUrl = "Not available";
                    const container = el.closest('[data-urn]');
                    if (container) {
                        const urn = container.getAttribute('data-urn');
                        if (urn) {
                            postUrl = `https://www.linkedin.com/feed/update/${urn}/`;
                        }
                    } else {
                        // Fallback: try finding an anchor with activity/share link
                        const linkEl = el.closest('.feed-shared-update-v2, .search-results-container')?.querySelector('a[href*="urn:li:activity"], a[href*="urn:li:share"]');
                        if (linkEl) postUrl = linkEl.href.split('?')[0];
                    }
                    return { text: el.innerText, postUrl: postUrl };
                });
            });

            if (pagePosts.length === 0) {
                console.log(`[Scraper] No posts found on page ${currentPage}. Ending pagination.`);
                break;
            }

            allPosts.push(...pagePosts);
            console.log(`[Scraper] Found ${pagePosts.length} posts on page ${currentPage}. Total so far: ${allPosts.length}`);

            // If we found less than ~10 posts, it's likely the last page of results
            if (pagePosts.length < 5) {
               console.log(`[Scraper] Few results returned on page ${currentPage}, likely last page.`);
               break;
            }
            
            // Wait a bit before moving to the next page to mimic human behavior
            const betweenPageWait = Math.floor(Math.random() * 3000) + 2000;
            await page.waitForTimeout(betweenPageWait);
        }

        console.log(`[Scraper] Successfully scraped ${allPosts.length} posts across all accessed pages.`);
        return allPosts;

    } catch (error) {
        console.error('[Scraper] Error during scraping:', error.message);
        return [];
    } finally {
        await browser.close();
    }
}

module.exports = scrapeLinkedInPosts;
