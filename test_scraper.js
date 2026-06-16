const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');
const path = require('path');

const authFilePath = path.join(__dirname, '.auth', 'state.json');

async function test() {
    console.log("Loading state from:", authFilePath);
    if (!fs.existsSync(authFilePath)) {
        console.error("Auth file does not exist! Please make sure cookies are saved.");
        return;
    }
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: authFilePath });
    const page = await context.newPage();
    
    try {
        console.log("Navigating to LinkedIn search page...");
        const queryKeywords = 'Python';
        const searchUrl = `https://www.linkedin.com/search/results/content/?datePosted="past-24h"&keywords=${encodeURIComponent(queryKeywords)}&sortBy="date_posted"&page=1`;
        
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);
        
        // Scroll down a bit to load containers
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(3000);

        // Save the full HTML to inspect the page content
        const html = await page.content();
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        fs.writeFileSync(path.join(tempDir, 'search_page.html'), html, 'utf8');
        console.log("Saved page HTML to temp/search_page.html");

        const elementCounts = await page.evaluate(() => {
            return {
                listitems: document.querySelectorAll('[role="listitem"]').length,
                searchListitems: document.querySelectorAll('[role="listitem"][componentkey*="FeedType_FLAGSHIP_SEARCH"]').length,
                reusableSearchList: document.querySelectorAll('.reusable-search__entity-result-list > li').length,
                reusableSearchContainer: document.querySelectorAll('li.reusable-search__result-container').length,
                allLi: document.querySelectorAll('li').length,
                feedUpdates: document.querySelectorAll('.feed-shared-update-v2').length,
                searchContentEntities: document.querySelectorAll('[data-chameleon-result-urn]').length,
                allArticles: document.querySelectorAll('article').length
            };
        });
        console.log("Element counts on page:", JSON.stringify(elementCounts, null, 2));

        const results = await page.evaluate(() => {
            const containers = Array.from(document.querySelectorAll('[role="listitem"][componentkey*="FeedType_FLAGSHIP_SEARCH"], .reusable-search__entity-result-list > li, li.reusable-search__result-container'));
            return containers.map((c, idx) => {
                const textWithTestId = c.querySelector('[data-testid="expandable-text-box"]') ? "YES" : "NO";
                
                // Find potential text elements
                const box = c.querySelector('[data-testid="expandable-text-box"]');
                const boxClass = box ? box.className : '';
                
                // Check other common container structures
                const feedSharedText = c.querySelector('.feed-shared-text');
                const feedSharedTextYesNo = feedSharedText ? "YES" : "NO";
                const commentary = c.querySelector('[class*="update-v2__commentary"]');
                const commentaryYesNo = commentary ? "YES" : "NO";
                
                const pText = c.innerText || c.textContent;
                
                return {
                    index: idx,
                    hasExpandableTextBox: textWithTestId,
                    hasFeedSharedText: feedSharedTextYesNo,
                    hasCommentary: commentaryYesNo,
                    textLength: pText ? pText.length : 0,
                    textExcerpt: pText ? pText.substring(0, 150).replace(/\n/g, ' ') : ''
                };
            });
        });
        
        console.log(`Found ${results.length} containers on page:`);
        console.log(JSON.stringify(results, null, 2));
        
    } catch (e) {
        console.error("Error during test:", e.message);
    } finally {
        await browser.close();
    }
}

test();
