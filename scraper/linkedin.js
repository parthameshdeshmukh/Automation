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
async function scrapeLinkedInPosts(keywords, targetEmailsCount = 25) {
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
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Wait briefly to see if we are redirected to login
        await page.waitForTimeout(3000);
        
        if (page.url().includes('/login') || page.url().includes('session_redirect')) {
            console.log('[Scraper] Session expired or missing. Attempting password login...');
            console.log('\n=============================================================');
            console.log('🛑 [ACTION REQUIRED] LinkedIn is blocking automated login!');
            console.log('Please log in MANUALLY in the Chrome window that just opened.');
            console.log('Solve any CAPTCHAs if asked. The script will automatically');
            console.log('resume once you reach the main LinkedIn feed.');
            console.log('=============================================================\n');

            // Wait up to 3 minutes for the user to manually log in and reach the feed
            await page.waitForURL('**/feed/**', { timeout: 180000 });
            
            // Save cookies for next time
            if (!fs.existsSync(path.dirname(authFilePath))) {
                fs.mkdirSync(path.dirname(authFilePath), { recursive: true });
            }
            await context.storageState({ path: authFilePath });
        }

        // 3. Search for posts across multiple pages
        const dateFilter = process.env.DATE_FILTER || 'past-24h';
        console.log(`[Scraper] Searching for "${keywords}" in ${dateFilter} across multiple pages...`);
        let allPosts = [];
        let maxPages = process.env.MAX_PAGES ? parseInt(process.env.MAX_PAGES) : 5; // Limit up to 5 pages

        for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
            try {
            console.log(`[Scraper] --- Scraping Page ${currentPage} ---`);
            const queryKeywords = keywords.replace(/\+/g, 'AND');
            const searchUrl = `https://www.linkedin.com/search/results/content/?datePosted=%22${dateFilter}%22&keywords=${encodeURIComponent(queryKeywords)}&sortBy=%22date_posted%22&page=${currentPage}`;
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Wait briefly for results to populate
            await page.waitForTimeout(2500);

            // Scroll down to ensure lazy-loaded posts in this page are loaded
            let previousHeight = 0;
            let attemptsWithNoGrowth = 0;

            for (let i = 0; i < 3; i++) { // Reduced scroll attempts (search result page only has 10 posts)
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.keyboard.press('End');
                
                const randomWait = Math.floor(Math.random() * 800) + 800; // Reduced scroll delay (0.8s to 1.6s)
                await page.waitForTimeout(randomWait);

                const currentHeight = await page.evaluate(() => document.body.scrollHeight);
                if (currentHeight === previousHeight) {
                    attemptsWithNoGrowth++;
                    if (attemptsWithNoGrowth >= 2) break;
                } else {
                    attemptsWithNoGrowth = 0;
                    previousHeight = currentHeight;
                }

                // Click "See more" buttons to ensure full text extraction
                await page.evaluate(() => {
                    const seeMoreButtons = document.querySelectorAll('button[class*="see-more"], .see-more-text, .feed-shared-inline-show-more-text__see-more-less-toggle');
                    seeMoreButtons.forEach(btn => {
                        if (btn && typeof btn.click === 'function') btn.click();
                    });
                });
            }

            // Extract posts from the current page
            const pagePosts = await page.evaluate(async () => {
                // Find all post containers on the search result page
                const containers = Array.from(document.querySelectorAll('[role="listitem"][componentkey*="FeedType_FLAGSHIP_SEARCH"], .reusable-search__entity-result-list > li, li.reusable-search__result-container'));
                const results = [];
                
                for (let i = 0; i < containers.length; i++) {
                    const container = containers[i];
                    
                    // Find and click "see more" inside this specific container to expand the full post
                    const seeMoreElements = Array.from(container.querySelectorAll('button, span, a, [role="button"]'));
                    const seeMoreBtn = seeMoreElements.find(el => {
                        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                        return txt.includes('see more') || txt.includes('…see more') || txt.includes('...see more');
                    });
                    if (seeMoreBtn && typeof seeMoreBtn.click === 'function') {
                        seeMoreBtn.click();
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                    
                    // Find the expandable text box inside this specific post container
                    const box = container.querySelector('[data-testid="expandable-text-box"]');
                    if (!box) continue;
                    
                    const text = box.innerText || box.textContent;
                    if (!text) continue;
                    
                    let postUrl = "Not available";
                    let authorName = "Unknown Author";
                    
                    // Try to find the author name by looking for connection level pattern: "Name • connection"
                    const allElements = Array.from(container.querySelectorAll('*'));
                    for (const el of allElements) {
                        const val = (el.innerText || el.textContent).trim();
                        const match = val.match(/^([^\n•]+)(?:\n)*\s*•\s*(1st|2nd|3rd|Following|Group)/i);
                        if (match && match[1].trim().length > 0) {
                            authorName = match[1].trim();
                            break;
                        }
                    }
                    
                    // Click control menu button to extract the exact updateUrn from the report link
                    const menuBtn = container.querySelector('button[aria-label^="Open control menu"]');
                    if (menuBtn) {
                        // Make sure any previously opened report link/dropdown is dismissed
                        const existingReport = document.querySelector('a[href*="report-in-modal"]');
                        if (existingReport) {
                            document.body.click();
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }

                        menuBtn.click();
                        
                        // Wait up to 1000ms for the dropdown report link to appear
                        await new Promise(resolve => {
                            let attempts = 0;
                            const interval = setInterval(() => {
                                const reportLink = document.querySelector('a[href*="report-in-modal"]');
                                attempts++;
                                if (reportLink || attempts > 20) {
                                    clearInterval(interval);
                                    resolve();
                                }
                            }, 50);
                        });
                        
                        const reportLink = document.querySelector('a[href*="report-in-modal"]');
                        if (reportLink) {
                            const href = reportLink.href;
                            const match = href.match(/updateUrn=([^&]+)/) || href.match(/entityUrn=([^&]+)/);
                            if (match) {
                                const urn = decodeURIComponent(match[1]);
                                postUrl = `https://www.linkedin.com/feed/update/${urn}/`;
                            }
                        }
                        
                        // Close menu button by clicking it again
                        menuBtn.click();
                        
                        // Wait up to 500ms for the report link to disappear from DOM before moving to the next post
                        await new Promise(resolve => {
                            let attempts = 0;
                            const interval = setInterval(() => {
                                const reportLink = document.querySelector('a[href*="report-in-modal"]');
                                attempts++;
                                if (!reportLink || attempts > 10) {
                                    clearInterval(interval);
                                    resolve();
                                }
                            }, 50);
                        });
                    }
                    
                    // Fallback: Try to get URN for the post if menu click failed
                    if (postUrl === "Not available") {
                        const tsLink = container.querySelector('.update-components-actor__sub-description a, .feed-shared-actor__sub-description a, a[class*="sub-description"]');
                        if (tsLink && tsLink.href && (tsLink.href.includes('/feed/update/') || tsLink.href.includes('activity'))) {
                            postUrl = tsLink.href.split('?')[0];
                        } else {
                            const links = Array.from(container.querySelectorAll('a'));
                            const outer = container.outerHTML;
                            const urnMatch = outer.match(/urn:li:(activity|ugcPost|share|feed):[0-9]+/);
                            if (urnMatch) {
                                postUrl = `https://www.linkedin.com/feed/update/${urnMatch[0]}/`;
                            } else {
                                const postLinkEl = links.find(l => {
                                     const href = l.href;
                                     // Make sure it's a specific post link, not a general company posts feed
                                     return (href.includes('/feed/update/') || href.includes('activity')) && 
                                            !href.includes('/company/');
                                 });
                                 if (postLinkEl) {
                                     const urlMatch = postLinkEl.href.match(/highlightedUpdateUrn=([^&]+)/);
                                     if (urlMatch) {
                                         postUrl = `https://www.linkedin.com/feed/update/${decodeURIComponent(urlMatch[1])}/`;
                                     } else {
                                         postUrl = postLinkEl.href.split('?')[0];
                                     }
                                 }
                            }
                        }
                    }
                    
                    results.push({ text, postUrl, authorName });
                }
                
                return results;
            });

            if (pagePosts.length === 0) {
                console.log(`[Scraper] No posts found on page ${currentPage}. Ending pagination.`);
                break;
            }

            allPosts.push(...pagePosts);
            console.log(`[Scraper] Found ${pagePosts.length} posts on page ${currentPage}. Total so far: ${allPosts.length}`);

            // Check if we have gathered enough emails to satisfy the target
            const { extractEmails } = require('../utils/extractEmail');
            const mapped = allPosts.map(p => ({ ...p, keywords }));
            const currentLeadsCount = extractEmails(mapped).length;
            if (currentLeadsCount >= targetEmailsCount) {
                console.log(`[Scraper] Reached target of ${targetEmailsCount} emails (found ${currentLeadsCount}) on page ${currentPage}. Stopping pagination.`);
                break;
            }

            // If we found less than ~10 posts, it's likely the last page of results
            // Commented out to ensure pagination continues up to MAX_PAGES as requested by the user
            /*
            if (pagePosts.length < 5) {
               console.log(`[Scraper] Few results returned on page ${currentPage}, likely last page.`);
               break;
            }
            */
            
            // Wait a bit before moving to the next page to mimic human behavior
            const betweenPageWait = Math.floor(Math.random() * 3000) + 2000;
            await page.waitForTimeout(betweenPageWait);
            } catch (pageError) {
                console.error(`[Scraper] Warning: Error scraping page ${currentPage}:`, pageError.message);
                console.log(`[Scraper] Breaking pagination loop and returning posts collected so far.`);
                break;
            }
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
