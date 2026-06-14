const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { applyLinkedInEasyApply } = require('../services/autofillService');
const { logToGoogleSheets } = require('../services/sheetsService');

const authFilePath = path.join(__dirname, '..', '.auth', 'state.json');

/**
 * Scrapes LinkedIn Jobs and extracts external apply portal links.
 * Checks first 2-3 pages.
 */
async function scrapeLinkedInJobs(keyword, location, pagesToCheck = 2, profile = null) {
    console.log(`[JobsScraper] Starting job scraper for keyword: "${keyword}", location: "${location}"`);

    const browser = await chromium.launch({ headless: false }); // Needs to be visible for redirects & manual logins
    let context;
    if (fs.existsSync(authFilePath)) {
        console.log('[JobsScraper] Using saved session cookies to bypass login.');
        context = await browser.newContext({ storageState: authFilePath });
    } else {
        console.log('[JobsScraper] No saved session found, creating new context.');
        context = await browser.newContext();
    }

    const page = await context.newPage();
    const jobsList = [];

    try {
        // 1. Check Login / Feed
        console.log('[JobsScraper] Checking LinkedIn session status...');
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        if (page.url().includes('/login') || page.url().includes('session_redirect')) {
            console.log('[JobsScraper] Session expired or missing. Waiting for manual login...');
            console.log('\n=============================================================');
            console.log('🛑 [ACTION REQUIRED] LinkedIn is blocking automated login!');
            console.log('Please log in MANUALLY in the Chrome window that just opened.');
            console.log('Solve any CAPTCHAs. Once you reach the main feed, the script will resume.');
            console.log('=============================================================\n');

            await page.waitForURL('**/feed/**', { timeout: 180000 });
            
            // Save cookies
            if (!fs.existsSync(path.dirname(authFilePath))) {
                fs.mkdirSync(path.dirname(authFilePath), { recursive: true });
            }
            await context.storageState({ path: authFilePath });
            console.log('[JobsScraper] Session cookies updated.');
        }

        // 2. Loop through pages
        for (let pageIdx = 0; pageIdx < pagesToCheck; pageIdx++) {
            const startParam = pageIdx * 25;
            // f_TPR=r86400 (Past 24 hours)
            const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&f_TPR=r86400&start=${startParam}`;
            console.log(`[JobsScraper] --- Scraping Page ${pageIdx + 1} (${searchUrl}) ---`);

            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(4000);

            // Scroll the job list panel to load all lazy-loaded job cards
            console.log('[JobsScraper] Scrolling jobs list panel...');
            await page.evaluate(async () => {
                const listPanel = document.querySelector('.jobs-search-results-list');
                if (listPanel) {
                    for (let i = 0; i < 4; i++) {
                        listPanel.scrollTop = listPanel.scrollHeight;
                        await new Promise(resolve => setTimeout(resolve, 800));
                    }
                }
            });

            // Get all job cards in the list
            const jobCardSelector = '.jobs-search-results-list__list-item, .job-card-container';
            const cardCount = await page.locator(jobCardSelector).count();
            console.log(`[JobsScraper] Found ${cardCount} job cards on page ${pageIdx + 1}.`);

            if (cardCount === 0) {
                console.log('[JobsScraper] No job cards found on this page. Ending pagination loop.');
                break;
            }

            for (let cardIdx = 0; cardIdx < cardCount; cardIdx++) {
                try {
                    const card = page.locator(jobCardSelector).nth(cardIdx);
                    
                    // Click card to open details on the right panel
                    await card.click();
                    await page.waitForTimeout(1500);

                    // Extract job metadata
                    const titleText = await card.locator('.job-card-list__title, .job-card-container__link').first().innerText().catch(() => 'Unknown Title');
                    const companyText = await card.locator('.job-card-container__primary-description, .job-card-container__company-name, .job-card-list__company-name').first().innerText().catch(() => 'Unknown Company');
                    const jobId = await card.getAttribute('data-job-id').catch(() => 'unknown');

                    const cleanTitle = titleText.trim().replace(/\n/g, ' ');
                    const cleanCompany = companyText.trim().replace(/\n/g, ' ');

                    console.log(`[JobsScraper] [Job ${cardIdx + 1}] Title: "${cleanTitle}", Company: "${cleanCompany}"`);

                    // Check details panel for Apply Button
                    const applyBtnSelector = '.jobs-apply-button button, button[class*="jobs-apply-button"]';
                    const applyBtnCount = await page.locator(applyBtnSelector).count();
                    
                    if (applyBtnCount === 0) {
                        console.log(`[JobsScraper] [Job ${cardIdx + 1}] No Apply button found. Skipping.`);
                        continue;
                    }

                    const applyBtn = page.locator(applyBtnSelector).first();
                    const applyBtnText = await applyBtn.innerText();
                    const isEasyApply = applyBtnText.toLowerCase().includes('easy apply');

                    let redirectUrl = null;
                    let jobDescription = '';

                    // Extract job description (needed for AI questions later)
                    const descSelector = '.jobs-description__content, .jobs-description-content__text, #job-details';
                    if (await page.locator(descSelector).count() > 0) {
                        jobDescription = await page.locator(descSelector).first().innerText();
                    }

                    const onlyEasyApply = process.env.ONLY_EASY_APPLY === 'true';

                    if (isEasyApply) {
                        console.log(`[JobsScraper] [Job ${cardIdx + 1}] Easy Apply detected. Autofilling immediately...`);
                        redirectUrl = `https://www.linkedin.com/jobs/view/${jobId}/`;

                        let appliedSuccess = false;
                        if (profile) {
                            try {
                                appliedSuccess = await applyLinkedInEasyApply(page, profile, jobDescription);
                            } catch (applyErr) {
                                console.error(`[JobsScraper] [Job ${cardIdx + 1}] Easy Apply failed/skipped:`, applyErr.message);
                            }
                        } else {
                            console.warn(`[JobsScraper] [Job ${cardIdx + 1}] Cannot apply immediately: no profile provided.`);
                        }

                        if (appliedSuccess) {
                            console.log(`[JobsScraper] [Job ${cardIdx + 1}] Easy Apply succeeded. Logging application.`);
                            const sheetSubject = `LinkedIn Easy Apply: ${cleanTitle} at ${cleanCompany}`;
                            const autoSubmitEnabled = process.env.AUTO_SUBMIT === 'true';
                            const sheetBody = autoSubmitEnabled 
                                ? `Autofilled LinkedIn Easy Apply modal and automatically triggered form submission.`
                                : `Autofilled LinkedIn Easy Apply modal. Waiting for applicant manual submit.`;
                            try {
                                await logToGoogleSheets(profile.email, jobDescription, sheetSubject, sheetBody, profile.resumePath, redirectUrl);
                            } catch (sheetErr) {
                                console.error('[JobsScraper] Error logging to Google Sheets:', sheetErr.message);
                            }
                        }

                        jobsList.push({
                            jobId,
                            title: cleanTitle,
                            company: cleanCompany,
                            portalUrl: redirectUrl,
                            description: jobDescription,
                            isEasyApply: true,
                            applied: appliedSuccess
                        });
                    } else {
                        if (onlyEasyApply) {
                            console.log(`[JobsScraper] [Job ${cardIdx + 1}] External Apply detected. Skipping because ONLY_EASY_APPLY is true.`);
                            continue;
                        }
                        console.log(`[JobsScraper] [Job ${cardIdx + 1}] External Apply detected. Triggering redirect...`);

                        // Click Apply and capture the redirect URL in a new tab/window
                        try {
                            const [popup] = await Promise.all([
                                context.waitForEvent('page', { timeout: 15000 }),
                                applyBtn.click()
                            ]);

                            // Wait for popup url to load/change away from linkedin intermediate redirect urls if possible
                            await popup.waitForLoadState('domcontentloaded').catch(() => {});
                            await popup.waitForTimeout(3000); // Wait for redirect to land on destination

                            redirectUrl = popup.url();
                            console.log(`[JobsScraper] [Job ${cardIdx + 1}] Successfully captured external URL: ${redirectUrl}`);

                            // Close popup
                            await popup.close();
                        } catch (clickErr) {
                            console.error(`[JobsScraper] [Job ${cardIdx + 1}] Error clicking/resolving redirect:`, clickErr.message);
                        }

                        if (redirectUrl && !redirectUrl.includes('linkedin.com/safety')) {
                            jobsList.push({
                                jobId,
                                title: cleanTitle,
                                company: cleanCompany,
                                portalUrl: redirectUrl,
                                description: jobDescription,
                                isEasyApply: false,
                                applied: false
                            });
                        }
                    }

                } catch (cardErr) {
                    console.error(`[JobsScraper] Error processing job card at index ${cardIdx}:`, cardErr.message);
                }
            }

            // Short human-like delay between pages
            await page.waitForTimeout(3000);
        }

    } catch (err) {
        console.error('[JobsScraper] Critical scraper error:', err.message);
    } finally {
        await browser.close();
    }

    return jobsList;
}

module.exports = scrapeLinkedInJobs;
