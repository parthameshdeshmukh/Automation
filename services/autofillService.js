const fs = require('fs');
const path = require('path');
const { generateQuestionAnswer, selectOptionFromDropdown } = require('./geminiService');
const readline = require('readline');

/**
 * Resolves the label text for an input by climbing up the DOM tree
 */
async function findLabelForInput(input) {
    try {
        const labelText = await input.evaluate(node => {
            if (node.id) {
                const label = document.querySelector(`label[for="${node.id}"]`);
                if (label && label.innerText.trim()) return label.innerText.trim();
            }
            let parent = node.parentElement;
            for (let i = 0; i < 4; i++) {
                if (!parent) break;
                const label = parent.querySelector('label');
                if (label && label.innerText.trim()) {
                    return label.innerText.trim();
                }
                const header = parent.querySelector('[class*="label"], [class*="title"], [class*="heading"], [class*="question"]');
                if (header && header.innerText.trim()) {
                    return header.innerText.trim();
                }
                parent = parent.parentElement;
            }
            return '';
        });
        if (labelText) return labelText;
    } catch (e) {}
    return '';
}

/**

 * Robust helper to fill fields by searching label text and various fallback selectors
 */
async function fillFieldByLabelOrSelector(formContext, labelText, selectors, value) {
    if (!value) return;

    // 1. Try Playwright's native getByLabel
    try {
        const locator = formContext.getByLabel(labelText, { exact: false });
        if (await locator.count() > 0 && await locator.first().isVisible()) {
            await locator.first().fill(value);
            console.log(`  [Autofill] Filled "${labelText}" via label locator.`);
            return;
        }
    } catch (e) {}

    // 2. Try CSS selectors list
    for (const selector of selectors) {
        try {
            const locator = formContext.locator(selector);
            if (await locator.count() > 0 && await locator.first().isVisible()) {
                await locator.first().fill(value);
                console.log(`  [Autofill] Filled "${labelText}" via selector "${selector}".`);
                return;
            }
        } catch (e) {}
    }

    // 3. Try matching label tag text and finding associated input next to it or using 'for' attribute
    try {
        const labels = formContext.locator(`label:has-text("${labelText}")`);
        const count = await labels.count();
        for (let i = 0; i < count; i++) {
            const label = labels.nth(i);
            const text = await label.innerText();
            if (text.toLowerCase().includes(labelText.toLowerCase())) {
                const forAttr = await label.getAttribute('for');
                if (forAttr) {
                    const input = formContext.locator(`#${forAttr}`);
                    if (await input.count() > 0 && await input.first().isVisible()) {
                        await input.first().fill(value);
                        console.log(`  [Autofill] Filled "${labelText}" via label 'for' attribute.`);
                        return;
                    }
                }
                const inputInside = label.locator('input, textarea, select');
                if (await inputInside.count() > 0 && await inputInside.first().isVisible()) {
                    await inputInside.first().fill(value);
                    console.log(`  [Autofill] Filled "${labelText}" nested in label.`);
                    return;
                }
            }
        }
    } catch (e) {}

    console.log(`  [Autofill] Warning: Could not fill field "${labelText}".`);
}

/**
 * Programmatically uploads the candidate's resume PDF
 */
async function uploadResume(formContext, filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        console.warn(`  [Autofill] Resume file not found at: ${filePath}. Skipping upload.`);
        return;
    }
    const resolvedPath = path.resolve(filePath);
    console.log(`  [Autofill] Uploading resume from: ${resolvedPath}...`);

    const selectors = [
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][name*="resume"]',
        'input[type="file"][id*="resume"]',
        'input[type="file"]'
    ];

    for (const selector of selectors) {
        try {
            const fileInput = formContext.locator(selector);
            if (await fileInput.count() > 0) {
                await fileInput.first().setInputFiles(resolvedPath);
                console.log(`  [Autofill] Uploaded resume via file input selector: "${selector}".`);
                return;
            }
        } catch (e) {}
    }
    console.warn(`  [Autofill] Could not find any valid resume file input.`);
}

/**
 * Handle custom drop-downs (like US authorization or sponsorship)
 */
async function handleDropdownSelection(formContext, labelText, searchTerms, optionText) {
    try {
        const labels = formContext.locator(`label:has-text("${labelText}")`);
        if (await labels.count() > 0) {
            const label = labels.first();
            const forAttr = await label.getAttribute('for');
            let select = null;
            if (forAttr) {
                select = formContext.locator(`#${forAttr}`);
            } else {
                select = label.locator('select');
            }

            if (select && await select.count() > 0 && await select.first().isVisible()) {
                // Find option matching optionText
                const options = select.locator('option');
                const optCount = await options.count();
                for (let i = 0; i < optCount; i++) {
                    const txt = await options.nth(i).innerText();
                    if (txt.toLowerCase().includes(optionText.toLowerCase())) {
                        const val = await options.nth(i).getAttribute('value');
                        await select.selectOption(val);
                        console.log(`  [Autofill] Selected "${txt}" for dropdown "${labelText}".`);
                        return;
                    }
                }
            }
        }
    } catch (e) {
        console.error(`  [Autofill] Error selecting dropdown "${labelText}":`, e.message);
    }
}

/**
 * Main application form autofiller
 */
/**
 * Detects if the page has a login/sign-up wall and prompts the user to authenticate
 */
async function checkLoginWall(page) {
    const passwordFields = await page.locator('input[type="password"]').count();
    const currentUrl = page.url().toLowerCase();
    const isLoginPage = passwordFields > 0 || currentUrl.includes('/login') || currentUrl.includes('/signin') || currentUrl.includes('/sign-in') || currentUrl.includes('/register') || currentUrl.includes('/signup');

    if (isLoginPage) {
        console.log('\n========================================================================');
        console.log('🛑 [Action Required] Login / Sign Up Detected');
        console.log(`   URL: ${page.url()}`);
        console.log('   - This portal requires you to sign in or create an account first.');
        console.log('   - Please sign in / sign up in the Chrome browser window.');
        console.log('👉 Press ENTER in this terminal once you have logged in and reached the application form.');
        console.log('👉 Type "skip" and press ENTER to skip this application.');
        console.log('========================================================================\n');

        const rlInterface = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const loginDone = await new Promise(resolve => rlInterface.question('Logged in? [Enter to run autofill / "skip"]: ', ans => {
            rlInterface.close();
            resolve(ans);
        }));

        if (loginDone.trim().toLowerCase() === 'skip') {
            throw new Error('Application skipped by user at login stage.');
        }
        console.log('  [Autofill] Resuming autofill on logged-in page...');
        await page.waitForTimeout(5000); // Wait for page to settle after login
        return true;
    }
    return false;
}

/**
 * Helpers for Q&A Cache
 */
const QA_CACHE_PATH = path.join(__dirname, '..', 'data', 'qa_cache.json');
function loadQACache() {
    try {
        if (fs.existsSync(QA_CACHE_PATH)) {
            return JSON.parse(fs.readFileSync(QA_CACHE_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('  [Autofill] Failed to load QA cache:', e.message);
    }
    return {};
}
function saveQACache(cache) {
    try {
        fs.writeFileSync(QA_CACHE_PATH, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.error('  [Autofill] Failed to save QA cache:', e.message);
    }
}
function cleanQuestionKey(q) {
    return q.toLowerCase()
            .replace(/[^a-z0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
}

// Static mapping helper for text fields
function getStaticAnswer(label, profile) {
    const cleanLabel = label.toLowerCase();
    
    // 1. Name fields
    if (/first\s*name|given\s*name|forename|^first$|fname/i.test(cleanLabel)) {
        return profile.firstName;
    }
    if (/last\s*name|family\s*name|surname|^last$|lname/i.test(cleanLabel)) {
        return profile.lastName;
    }
    if (/full\s*name|^name$/i.test(cleanLabel)) {
        return `${profile.firstName} ${profile.lastName}`.trim();
    }
    
    // 2. Contact details
    if (/email|e-mail/i.test(cleanLabel)) {
        return profile.email;
    }
    if (/phone|telephone|mobile|cell|contact\s*number/i.test(cleanLabel)) {
        return profile.phone;
    }
    if (/linkedin/i.test(cleanLabel)) {
        return profile.linkedin;
    }
    if (/github/i.test(cleanLabel)) {
        return profile.github;
    }
    if (/portfolio|website|homepage/i.test(cleanLabel)) {
        return profile.portfolio;
    }
    if (/location|city|address|country|state|residency|residence/i.test(cleanLabel)) {
        return process.env.CANDIDATE_LOCATION || 'Mumbai';
    }
    
    // 3. Common questions
    if (/salary|compensation|remuneration|pay\s*expectation|desired\s*pay/i.test(cleanLabel)) {
        return process.env.CANDIDATE_SALARY || 'Open';
    }
    if (/start\s*date|notice\s*period|earliest\s*start|availability|how\s*soon/i.test(cleanLabel)) {
        return 'Immediate';
    }
    if (/years\s*of\s*experience|experience\s*in\s*years|^experience$/i.test(cleanLabel)) {
        return process.env.CANDIDATE_EXPERIENCE || 'Fresher';
    }
    if (/work\s*authorization|legally\s*authorized/i.test(cleanLabel)) {
        return 'Yes';
    }
    if (/sponsorship|require\s*visa|visa\s*sponsorship/i.test(cleanLabel)) {
        return profile.requiresSponsorship ? 'Yes' : 'No';
    }
    
    return null;
}

// Static dropdown selection matching helper
function getStaticDropdownSelection(label, optionList, profile) {
    const cleanLabel = label.toLowerCase();
    
    // Sponsorship
    if (/sponsorship|require\s*visa|visa\s*sponsorship/i.test(cleanLabel)) {
        const target = profile.requiresSponsorship ? 'yes' : 'no';
        const found = optionList.find(o => o.text.toLowerCase() === target || o.text.toLowerCase().startsWith(target));
        if (found) return found;
    }
    
    // Legally authorized
    if (/legally\s*authorized|authorized\s*to\s*work|right\s*to\s*work|work\s*authorization/i.test(cleanLabel)) {
        const found = optionList.find(o => o.text.toLowerCase() === 'yes' || o.text.toLowerCase().startsWith('yes'));
        if (found) return found;
    }
    
    // Voluntary Disclosures (Gender, Race, Veteran, Disability)
    if (/gender|sex/i.test(cleanLabel) && !/trans/i.test(cleanLabel)) {
        const found = optionList.find(o => /decline|prefer\s*not|choose\s*not/i.test(o.text));
        if (found) return found;
    }
    
    if (/race|ethnic/i.test(cleanLabel)) {
        const found = optionList.find(o => /decline|prefer\s*not|choose\s*not/i.test(o.text));
        if (found) return found;
    }
    
    if (/veteran/i.test(cleanLabel)) {
        const found = optionList.find(o => /decline|prefer\s*not|choose\s*not|not\s*a\s*veteran|^no$/i.test(o.text));
        if (found) return found;
    }
    
    if (/disabilit/i.test(cleanLabel)) {
        const found = optionList.find(o => /decline|prefer\s*not|choose\s*not|no\s*.*disability|^no$/i.test(o.text));
        if (found) return found;
    }
    
    return null;
}

// Readline terminal question helper
function askTerminal(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(question, ans => {
        rl.close();
        resolve(ans);
    }));
}

// Submit button click helper
async function attemptFormSubmission(page, formContext) {
    const submitBtnSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        '#submit_app',
        '#btn-submit',
        'button:has-text("Submit Application")',
        'button:has-text("Submit")',
        'button:has-text("Apply")',
        'button:has-text("Send Application")',
        'a:has-text("Submit Application")',
        'a:has-text("Submit")'
    ];
    
    for (const selector of submitBtnSelectors) {
        try {
            let btn = formContext.locator(selector);
            if (await btn.count() > 0 && await btn.first().isVisible() && !(await btn.first().isDisabled())) {
                console.log(`  [Autofill] Found submit button in context: "${selector}". Clicking...`);
                await btn.first().click();
                return true;
            }
            btn = page.locator(selector);
            if (await btn.count() > 0 && await btn.first().isVisible() && !(await btn.first().isDisabled())) {
                console.log(`  [Autofill] Found submit button on page: "${selector}". Clicking...`);
                await btn.first().click();
                return true;
            }
        } catch (e) {}
    }
    return false;
}

async function dismissEasyApplyModal(page) {
    console.log('  [EasyApply] Attempting to close/dismiss Easy Apply modal...');
    const dismissBtnSelectors = [
        'button[aria-label="Dismiss"]',
        'button.artdeco-modal__dismiss',
        'button:has-text("Dismiss")'
    ];
    for (const selector of dismissBtnSelectors) {
        try {
            const btn = page.locator(selector);
            if (await btn.count() > 0 && await btn.first().isVisible()) {
                await btn.first().click();
                console.log(`  [EasyApply] Clicked dismiss button via selector "${selector}".`);
                await page.waitForTimeout(1500);
                
                // Check if a "Discard draft?" confirmation dialog is opened
                const discardBtn = page.locator('button[data-control-name="discard_application_confirm_btn"], button:has-text("Discard")');
                if (await discardBtn.count() > 0 && await discardBtn.first().isVisible()) {
                    await discardBtn.first().click();
                    console.log('  [EasyApply] Clicked Discard button in draft confirmation.');
                    await page.waitForTimeout(1500);
                }
                break;
            }
        } catch (e) {
            console.error('  [EasyApply] Error clicking dismiss button:', e.message);
        }
    }
}

/**
 * Automates the step-by-step LinkedIn Easy Apply modal inside the active page context
 */
async function applyLinkedInEasyApply(page, profile, jobDescription) {
    try {
        // 1. Locate and click the Easy Apply button
        const easyApplyButtonSelectors = [
        'button.jobs-apply-button',
        'button:has-text("Easy Apply")',
        'button[aria-label*="Easy Apply"]'
    ];
    
    let easyApplyClicked = false;
    for (const selector of easyApplyButtonSelectors) {
        try {
            const btn = page.locator(selector);
            if (await btn.count() > 0 && await btn.first().isVisible()) {
                await btn.first().click();
                console.log(`  [EasyApply] Clicked Easy Apply button via selector "${selector}".`);
                easyApplyClicked = true;
                break;
            }
        } catch (e) {}
    }
    
    if (!easyApplyClicked) {
        console.warn('  [EasyApply] Warning: Could not find or click the Easy Apply button. Checking if modal is already open...');
    }
    
    await page.waitForTimeout(3000);
    
    // 2. Locate the Easy Apply modal context
    const modalSelector = 'div.jobs-easy-apply-modal, div[role="dialog"]';
    const hasModal = await page.locator(modalSelector).count() > 0;
    if (!hasModal) {
        console.error('  [EasyApply] Error: Could not locate Easy Apply modal on the page.');
        return false;
    }
    
    console.log('  [EasyApply] Modal located. Starting step-by-step form-filling loop...');
    
    const maxModalSteps = 10;
    let currentStep = 1;
    
    while (currentStep <= maxModalSteps) {
        const modal = page.locator(modalSelector).first();
        if (!(await modal.isVisible())) {
            console.log('  [EasyApply] Modal is no longer visible. Breaking loop.');
            break;
        }
        
        console.log(`  [EasyApply] --- Processing Screen/Step ${currentStep} ---`);
        const formContext = modal;
        
        // A. Upload Resume
        await uploadResume(formContext, profile.resumePath);
        
        // B. Fill Text Inputs
        const qaCache = loadQACache();
        try {
            const inputs = await formContext.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), textarea').all();
            for (const input of inputs) {
                if (await input.isVisible() && (await input.inputValue()) === '') {
                    let fieldLabel = await findLabelForInput(input);
                    if (!fieldLabel) {
                        fieldLabel = await input.getAttribute('placeholder') || await input.getAttribute('name') || await input.getAttribute('aria-label') || '';
                    }
                    if (fieldLabel) {
                        const cleanLabel = fieldLabel.replace(/\*/g, '').replace(/\n/g, ' ').trim();
                        if (!cleanLabel) continue;
                        
                        let answerToFill = null;
                        const staticVal = getStaticAnswer(cleanLabel, profile);
                        if (staticVal !== null) {
                            answerToFill = staticVal;
                            console.log(`  [EasyApply] Local Match: Found answer for "${cleanLabel}": "${staticVal}"`);
                        } else {
                            const cacheKey = cleanQuestionKey(cleanLabel);
                            if (qaCache[cacheKey]) {
                                answerToFill = qaCache[cacheKey];
                                console.log(`  [EasyApply] Cache Match: Found answer for "${cleanLabel}": "${answerToFill.substring(0, 60)}..."`);
                            } else {
                                console.log(`  [EasyApply] AI Fallback: Querying Gemini for field: "${cleanLabel}"`);
                                const prompt = `You are an AI assistant helping to autofill a job application form.
We have the following candidate profile:
Name: ${profile.firstName} ${profile.lastName}
Email: ${profile.email}
Phone: ${profile.phone}
LinkedIn: ${profile.linkedin}
GitHub: ${profile.github}
Portfolio: ${profile.portfolio}

The form has an empty field with the label/placeholder: "${cleanLabel}".
If this field corresponds to one of the profile details (like First Name, Last Name, Full Name, Email, Phone, LinkedIn, GitHub, Portfolio/Website), output ONLY the corresponding value from the profile.
If it is a custom question, generate a brief, professional answer based on the candidate's profile and this job description:
"${jobDescription.substring(0, 1000)}"

Output only the direct text to be filled into the field, with no extra explanations or quotes.`;
                                const answer = await generateQuestionAnswer(prompt, jobDescription, profile);
                                if (answer && answer.trim()) {
                                    answerToFill = answer.trim().replace(/^"|"$/g, '');
                                    qaCache[cacheKey] = answerToFill;
                                    saveQACache(qaCache);
                                    console.log(`  [EasyApply] AI Fallback: Found answer for "${cleanLabel}": "${answerToFill.substring(0, 60)}..."`);
                                }
                            }
                        }
                        
                        if (answerToFill !== null) {
                            const isCombobox = (await input.getAttribute('role')) === 'combobox' || 
                                               cleanLabel.toLowerCase().includes('location') || 
                                               (await input.getAttribute('placeholder') || '').toLowerCase().includes('typing');
                            if (isCombobox) {
                                console.log(`  [EasyApply] Combobox detected for "${cleanLabel}". Filling "${answerToFill}"...`);
                                await input.click();
                                await input.focus();
                                await input.fill('');
                                await page.keyboard.type(answerToFill, { delay: 100 });
                                await page.waitForTimeout(2000);
                                
                                let optionClicked = false;
                                const optionSelectors = [`[role="option"]`, `.option`, `[class*="option"]`, `li`, `button`, `div`];
                                for (const selector of optionSelectors) {
                                    try {
                                        const elements = await page.locator(selector).all();
                                        for (const el of elements) {
                                            if (await el.isVisible()) {
                                                const text = await el.innerText();
                                                if (text.toLowerCase().includes(answerToFill.toLowerCase()) || 
                                                    (answerToFill.toLowerCase() === 'mumbai' && text.toLowerCase().includes('india'))) {
                                                    console.log(`  [EasyApply] Found matching dropdown option: "${text}". Clicking...`);
                                                    await el.click();
                                                    optionClicked = true;
                                                    break;
                                                }
                                            }
                                        }
                                    } catch (err) {}
                                    if (optionClicked) break;
                                }
                                if (!optionClicked) {
                                    console.log(`  [EasyApply] Trying keyboard navigation for combobox...`);
                                    await input.focus();
                                    await page.keyboard.press('ArrowDown');
                                    await page.waitForTimeout(500);
                                    await page.keyboard.press('Enter');
                                    await page.waitForTimeout(500);
                                }
                            } else {
                                await input.fill(answerToFill);
                                console.log(`  [EasyApply] Filled "${cleanLabel}" with: "${answerToFill.substring(0, 60)}..."`);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('  [EasyApply] Error filling inputs:', e.message);
        }
        
        // C. Fill Dropdowns
        try {
            const selectElements = await formContext.locator('select').all();
            for (const select of selectElements) {
                if (await select.isVisible() && !(await select.isDisabled())) {
                    let labelText = await findLabelForInput(select);
                    if (!labelText) {
                        labelText = await select.getAttribute('name') || await select.getAttribute('aria-label') || '';
                    }
                    const currentVal = await select.inputValue();
                    if (currentVal && currentVal !== 'select' && currentVal !== '' && currentVal !== '--') {
                        continue;
                    }
                    const options = await select.locator('option').all();
                    const optionList = [];
                    for (const opt of options) {
                        const val = await opt.getAttribute('value') || '';
                        const txt = await opt.innerText() || '';
                        if (txt.trim() && val.trim() && val !== 'select' && !txt.toLowerCase().includes('select')) {
                            optionList.push({ value: val, text: txt.trim() });
                        }
                    }
                    if (optionList.length > 0 && labelText) {
                        const cleanLabel = labelText.replace(/\*/g, '').replace(/\n/g, ' ').trim();
                        const staticMatch = getStaticDropdownSelection(cleanLabel, optionList, profile);
                        if (staticMatch) {
                            await select.selectOption(staticMatch.value);
                            console.log(`  [EasyApply] Local Dropdown Match: Selected "${staticMatch.text}" for "${cleanLabel}"`);
                            continue;
                        }
                        console.log(`  [EasyApply] AI Dropdown: Querying Gemini for choice in: "${cleanLabel}"`);
                        const optionTexts = optionList.map(o => o.text);
                        const chosenIdx = await selectOptionFromDropdown(cleanLabel, optionTexts, profile);
                        if (chosenIdx >= 0 && chosenIdx < optionList.length) {
                            await select.selectOption(optionList[chosenIdx].value);
                            console.log(`  [EasyApply] AI Dropdown: Selected "${optionList[chosenIdx].text}" for "${cleanLabel}"`);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('  [EasyApply] Error filling dropdowns:', e.message);
        }
        
        // D. Fill Radios
        try {
            const radios = await formContext.locator('input[type="radio"]').all();
            const radioGroups = {};
            for (const radio of radios) {
                if (await radio.isVisible()) {
                    const name = await radio.getAttribute('name');
                    if (name) {
                        if (!radioGroups[name]) radioGroups[name] = [];
                        radioGroups[name].push(radio);
                    }
                }
            }
            for (const name in radioGroups) {
                const groupRadios = radioGroups[name];
                let isAnyChecked = false;
                for (const radio of groupRadios) {
                    if (await radio.isChecked()) {
                        isAnyChecked = true;
                        break;
                    }
                }
                if (isAnyChecked) continue;
                
                let groupQuestion = await groupRadios[0].evaluate(node => {
                    let parent = node.parentElement;
                    while (parent && parent.tagName !== 'FORM') {
                        if (parent.tagName === 'FIELDSET') {
                            const legend = parent.querySelector('legend');
                            if (legend) return legend.textContent.trim();
                        }
                        parent = parent.parentElement;
                    }
                    return '';
                });
                
                const options = [];
                for (const radio of groupRadios) {
                    const idAttr = await radio.getAttribute('id');
                    let radioLabelText = '';
                    if (idAttr) {
                        const label = formContext.locator(`label[for="${idAttr}"]`);
                        if (await label.count() > 0) {
                            radioLabelText = await label.first().innerText();
                        }
                    }
                    if (!radioLabelText) {
                        radioLabelText = await radio.evaluate(node => {
                            const parent = node.parentElement;
                            return parent ? parent.textContent.trim() : '';
                        });
                    }
                    options.push({ radio, text: radioLabelText.trim() });
                }
                if (!groupQuestion && options.length > 0) groupQuestion = name;
                
                if (options.length > 0 && groupQuestion) {
                    const cleanLabel = groupQuestion.replace(/\*/g, '').replace(/\n/g, ' ').trim();
                    const staticMatch = getStaticDropdownSelection(cleanLabel, options, profile);
                    if (staticMatch) {
                        await staticMatch.radio.click({ force: true });
                        console.log(`  [EasyApply] Local Radio Match: Clicked "${staticMatch.text}" for "${cleanLabel}"`);
                        continue;
                    }
                    console.log(`  [EasyApply] AI Radio: Querying Gemini for choice in: "${cleanLabel}"`);
                    const optionTexts = options.map(o => o.text);
                    const chosenIdx = await selectOptionFromDropdown(cleanLabel, optionTexts, profile);
                    if (chosenIdx >= 0 && chosenIdx < options.length) {
                        await options[chosenIdx].radio.click({ force: true });
                        console.log(`  [EasyApply] AI Radio: Clicked "${options[chosenIdx].text}" for "${cleanLabel}"`);
                    }
                }
            }
        } catch (e) {
            console.error('  [EasyApply] Error filling radios:', e.message);
        }
        
        // E. Fill Checkboxes
        try {
            const checkboxes = await formContext.locator('input[type="checkbox"]').all();
            for (const checkbox of checkboxes) {
                if (await checkbox.isVisible() && !(await checkbox.isChecked())) {
                    let labelText = await findLabelForInput(checkbox);
                    if (!labelText) {
                        labelText = await checkbox.evaluate(node => {
                            const parent = node.parentElement;
                            return parent ? parent.textContent.trim() : '';
                        });
                    }
                    const cleanLabel = labelText.toLowerCase();
                    const isRequired = await checkbox.getAttribute('required') !== null;
                    if (isRequired || cleanLabel.includes('agree') || cleanLabel.includes('consent') || cleanLabel.includes('terms') || cleanLabel.includes('policy') || cleanLabel.includes('acknowledge') || cleanLabel.includes('certify') || cleanLabel.includes('understand') || cleanLabel.includes('correct') || cleanLabel.includes('authorized') || cleanLabel.includes('declaration')) {
                        await checkbox.check({ force: true });
                        console.log(`  [EasyApply] Checked checkbox: "${labelText.trim().substring(0, 60)}..."`);
                    }
                }
            }
        } catch (e) {
            console.error('  [EasyApply] Error filling checkboxes:', e.message);
        }
        
        // F. Custom buttons
        try {
            const buttons = await formContext.locator('button').all();
            const parentMap = new Map();
            for (const btn of buttons) {
                if (await btn.isVisible()) {
                    const btnText = (await btn.innerText()).trim();
                    if (!btnText) continue;
                    const lowerText = btnText.toLowerCase();
                    if (lowerText.includes('next') || lowerText.includes('review') || lowerText.includes('continue') || lowerText.includes('submit') || lowerText.includes('upload') || lowerText.includes('cancel') || lowerText.includes('dismiss')) {
                        continue;
                    }
                    const parentId = await btn.evaluate(node => {
                        const parent = node.parentElement;
                        if (!parent) return null;
                        return `${parent.tagName}_${parent.className}_${parent.innerText.substring(0, 100)}`;
                    });
                    if (parentId) {
                        if (!parentMap.has(parentId)) {
                            parentMap.set(parentId, { buttons: [] });
                        }
                        parentMap.get(parentId).buttons.push({ btn, text: btnText });
                    }
                }
            }
            for (const [parentId, group] of parentMap.entries()) {
                if (group.buttons.length < 2) continue;
                let isAnyChecked = false;
                for (const item of group.buttons) {
                    const isActive = await item.btn.evaluate(node => {
                        const className = node.className.toLowerCase();
                        return className.includes('active') || className.includes('selected') || className.includes('checked') || node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-selected') === 'true';
                    });
                    if (isActive) {
                        isAnyChecked = true;
                        break;
                    }
                }
                if (isAnyChecked) continue;
                
                const questionText = await group.buttons[0].btn.evaluate(node => {
                    let parent = node.parentElement;
                    for (let i = 0; i < 4; i++) {
                        if (!parent) break;
                        const label = parent.querySelector('label');
                        if (label && label.innerText.trim()) return label.innerText.trim();
                        const title = parent.querySelector('[class*="label"], [class*="title"], [class*="heading"], [class*="question"]');
                        if (title && title.innerText.trim()) return title.innerText.trim();
                        parent = parent.parentElement;
                    }
                    return '';
                });
                if (questionText) {
                    const cleanLabel = questionText.replace(/\*/g, '').replace(/\n/g, ' ').trim();
                    const optionTexts = group.buttons.map(b => b.text);
                    const mockOptionList = group.buttons.map(b => ({ text: b.text, value: b.text }));
                    const staticMatch = getStaticDropdownSelection(cleanLabel, mockOptionList, profile);
                    if (staticMatch) {
                        const matchedBtn = group.buttons.find(b => b.text === staticMatch.value);
                        if (matchedBtn) {
                            await matchedBtn.btn.click();
                            console.log(`  [EasyApply] Local Button Match: Clicked "${matchedBtn.text}" for "${cleanLabel}"`);
                            continue;
                        }
                    }
                    console.log(`  [EasyApply] AI Custom Buttons: Querying Gemini for choice in: "${cleanLabel}"`);
                    const chosenIdx = await selectOptionFromDropdown(cleanLabel, optionTexts, profile);
                    if (chosenIdx >= 0 && chosenIdx < group.buttons.length) {
                        await group.buttons[chosenIdx].btn.click();
                        console.log(`  [EasyApply] Clicked "${group.buttons[chosenIdx].text}" for "${cleanLabel}"`);
                    }
                }
            }
        } catch (e) {
            console.error('  [EasyApply] Error filling custom buttons:', e.message);
        }
        
        // G. Check Action / Navigation Buttons
        const submitBtn = formContext.locator('button:has-text("Submit application"), button[aria-label*="Submit application"]').first();
        const nextBtn = formContext.locator('button:has-text("Next"), button:has-text("Review"), button:has-text("Continue"), button[aria-label*="Next"], button[aria-label*="Review"]').first();
        
        const isSubmitVisible = (await submitBtn.count() > 0) && (await submitBtn.isVisible());
        const isNextVisible = (await nextBtn.count() > 0) && (await nextBtn.isVisible());
        
        if (isSubmitVisible) {
            console.log('  [EasyApply] Found "Submit application" button!');
            const autoSubmit = process.env.AUTO_SUBMIT === 'true';
            if (autoSubmit) {
                console.log('  [EasyApply] AUTO_SUBMIT is true. Submitting application...');
                await submitBtn.click();
                await page.waitForTimeout(5000);
                console.log('  [EasyApply] Form submitted successfully.');
            } else {
                console.log('  [EasyApply] AUTO_SUBMIT is false. Pausing for review before manual submit.');
            }
            break;
        } else if (isNextVisible) {
            console.log('  [EasyApply] Advancing to next screen...');
            await nextBtn.click();
            await page.waitForTimeout(2000);
            currentStep++;
        } else {
            console.warn('  [EasyApply] Warning: No "Next" or "Submit" button found on current screen. Ending automatic progression.');
            break;
        }
    }
    
    // H. Trigger standard human review window
    console.log('\n========================================================================');
    console.log('👉 [Action Required] Review LinkedIn Easy Apply Progress');
    console.log('   - Review/correct any fields or upload missing files in the browser.');
    console.log('   - Solve any CAPTCHAs and manually submit if not done.');
    console.log('👉 Press ENTER in this terminal when you are ready to proceed.');
    console.log('👉 Type "skip" and press ENTER to skip logging this application.');
    console.log('========================================================================\n');
    
    const responseInput = await askTerminal('Ready? [Enter to continue / "skip"]: ');
    if (responseInput.trim().toLowerCase() === 'skip') {
        throw new Error('Application skipped by user in review stage.');
    }
    return true;
    } finally {
        await dismissEasyApplyModal(page);
    }
}

/**
 * Main application form autofiller
 */
async function autofillJobApplication(page, portalUrl, profile, jobDescription) {
    console.log(`[Autofill] Navigating to job portal URL: ${portalUrl}`);
    await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Check for login or sign-up wall initially
    await checkLoginWall(page);

    const isLinkedInEasyApply = portalUrl.toLowerCase().includes('linkedin.com/jobs');
    if (isLinkedInEasyApply) {
        console.log('[Autofill] Detected LinkedIn Easy Apply job URL.');
        await applyLinkedInEasyApply(page, profile, jobDescription);
        return;
    }

    const lowercaseUrl = portalUrl.toLowerCase();
    
    // Check for Greenhouse iframe (specifically for embedded form widgets, ignoring analytics/tracking iframes)
    const greenhouseIframeSelector = 'iframe[src*="embed/job_app"]';
    const hasGreenhouseIframe = await page.locator(greenhouseIframeSelector).count() > 0;
    
    let isGreenhouse = lowercaseUrl.includes('greenhouse.io') || 
                       hasGreenhouseIframe || 
                       (await page.locator('#application_form, #grnhse_app, [class*="greenhouse"]').count() > 0);
                       
    let isLever = lowercaseUrl.includes('lever.co') || 
                  (await page.locator('.application-form, [class*="lever"]').count() > 0);

    let isWorkday = lowercaseUrl.includes('myworkdayjobs.com') || 
                    lowercaseUrl.includes('myworkdaysite.com') || 
                    lowercaseUrl.includes('workday') ||
                    (await page.locator('[class*="workday"], [id*="workday"]').count() > 0);

    let formContext = page;

    if (isGreenhouse) {
        console.log('[Autofill] Detected Greenhouse application board.');
        
        if (hasGreenhouseIframe) {
            console.log('  [Autofill] Switching selector context to Greenhouse iframe...');
            formContext = page.frameLocator(greenhouseIframeSelector).first();
        }

        // 1. Upload Resume
        await uploadResume(formContext, profile.resumePath);
        await page.waitForTimeout(4000); // Wait for potential parsing/processing

        // 2. Contact details
        await fillFieldByLabelOrSelector(formContext, 'First Name', ['#first_name', 'input[name*="first_name"]', 'input[id*="first_name"]'], profile.firstName);
        await fillFieldByLabelOrSelector(formContext, 'Last Name', ['#last_name', 'input[name*="submit_application[last_name]"]', 'input[id*="last_name"]'], profile.lastName);
        await fillFieldByLabelOrSelector(formContext, 'Email', ['#email', 'input[type="email"]', 'input[name*="email"]'], profile.email);
        await fillFieldByLabelOrSelector(formContext, 'Phone', ['#phone', 'input[type="tel"]', 'input[name*="phone"]'], profile.phone);

        // 3. Profiles / Links
        await fillFieldByLabelOrSelector(formContext, 'LinkedIn', ['input[autocomplete*="linkedin"]', 'input[placeholder*="linkedin"]', 'input[id*="linkedin"]'], profile.linkedin);
        await fillFieldByLabelOrSelector(formContext, 'GitHub', ['input[autocomplete*="github"]', 'input[placeholder*="github"]', 'input[id*="github"]'], profile.github);
        await fillFieldByLabelOrSelector(formContext, 'Portfolio', ['input[placeholder*="portfolio"]', 'input[id*="website"]', 'input[placeholder*="website"]'], profile.portfolio);

        // 4. Try to handle common Greenhouse dropdowns
        if (profile.requiresSponsorship) {
            await handleDropdownSelection(formContext, 'sponsorship', ['sponsorship'], 'Yes');
            await handleDropdownSelection(formContext, 'authorized to work', ['authorized'], 'Yes');
        } else {
            await handleDropdownSelection(formContext, 'sponsorship', ['sponsorship'], 'No');
            await handleDropdownSelection(formContext, 'authorized to work', ['authorized'], 'Yes');
        }

    } else if (isLever) {
        console.log('[Autofill] Detected Lever application board.');
        
        // 1. Upload Resume (Lever usually parses resume immediately to fill name/email/phone/etc.)
        await uploadResume(formContext, profile.resumePath);
        await page.waitForTimeout(5000); // Allow Lever's backend parser to finish populating fields

        // 2. Auto-fill/Override standard contact inputs
        const fullName = `${profile.firstName} ${profile.lastName}`;
        await fillFieldByLabelOrSelector(formContext, 'Full Name', ['input[name="name"]', 'input[id*="name"]'], fullName);
        await fillFieldByLabelOrSelector(formContext, 'Email', ['input[name="email"]', 'input[type="email"]'], profile.email);
        await fillFieldByLabelOrSelector(formContext, 'Phone', ['input[name="phone"]', 'input[type="tel"]'], profile.phone);

        // 3. Profiles / Links
        await fillFieldByLabelOrSelector(formContext, 'LinkedIn URL', ['input[name="urls[LinkedIn]"]', 'input[placeholder*="linkedin.com"]'], profile.linkedin);
        await fillFieldByLabelOrSelector(formContext, 'GitHub URL', ['input[name="urls[GitHub]"]', 'input[placeholder*="github.com"]'], profile.github);
        await fillFieldByLabelOrSelector(formContext, 'Portfolio', ['input[name="urls[Portfolio]"]', 'input[name="urls[Website]"]', 'input[placeholder*="portfolio"]'], profile.portfolio);

    } else {
        // Workday or Custom/Generic portal
        if (isWorkday) {
            console.log('[Autofill] Detected Workday portal. Navigating to application form...');
            const passwordFields = await page.locator('input[type="password"]').count();
            const hasFormInputs = await page.locator('input[type="text"], input[type="email"]').count() > 2;
            
            if (passwordFields === 0 && !hasFormInputs) {
                const applyBtnSelectors = [
                    '[data-automation-id="applyButton"]',
                    '[data-automation-id="adventureButton"]',
                    'a:has-text("Apply")',
                    'button:has-text("Apply")'
                ];
                let applyClicked = false;
                for (const sel of applyBtnSelectors) {
                    try {
                        const btn = page.locator(sel);
                        if (await btn.count() > 0 && await btn.first().isVisible()) {
                            await btn.first().click();
                            console.log('  [Workday] Clicked Apply button.');
                            applyClicked = true;
                            break;
                        }
                    } catch (e) {}
                }
                
                if (applyClicked) {
                    await page.waitForTimeout(3000);
                    const applyManuallySelectors = [
                        '[data-automation-id="applyManually"]',
                        'a:has-text("Apply Manually")',
                        'button:has-text("Apply Manually")',
                        'span:has-text("Apply Manually")'
                    ];
                    for (const sel of applyManuallySelectors) {
                        try {
                            const btn = page.locator(sel);
                            if (await btn.count() > 0 && await btn.first().isVisible()) {
                                await btn.first().click();
                                console.log('  [Workday] Clicked Apply Manually.');
                                break;
                            }
                        } catch (e) {}
                    }
                    await page.waitForTimeout(5000);
                }
            }
            
            // Check for login wall
            await checkLoginWall(page);
        } else {
            console.log('[Autofill] Unknown/Custom portal type. Attempting generic form filling...');
            const hasEmailInput = await page.locator('input[type="email"], input[name*="email"], input[id*="email"]').count() > 0;
            const hasFileInput = await page.locator('input[type="file"]').count() > 0;
            const formInputCount = await page.locator('input[type="text"], input[type="email"], input[type="file"], textarea').count();

            if (formInputCount === 0 || (!hasEmailInput && !hasFileInput)) {
                console.log('  [Autofill] No standard application inputs found. Searching for Apply button...');
                const applyBtnSelectors = [
                    'button:has-text("Apply")', 'a:has-text("Apply")', 'input[value*="Apply"]',
                    'button:has-text("Candidatar")', 'a:has-text("Candidatar")',
                    'button:has-text("Start Application")', 'a:has-text("Start Application")',
                    'button:has-text("Apply Now")', 'a:has-text("Apply Now")'
                ];
                for (const selector of applyBtnSelectors) {
                    try {
                        const btn = page.locator(selector);
                        if (await btn.count() > 0 && await btn.first().isVisible()) {
                            console.log(`  [Autofill] Found and clicking Apply button: "${selector}"`);
                            const [newPage] = await Promise.all([
                                page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
                                btn.first().click()
                            ]);

                            if (newPage) {
                                console.log('  [Autofill] Switched context to newly opened tab.');
                                formContext = newPage;
                                await newPage.waitForLoadState('domcontentloaded').catch(() => {});
                                await newPage.waitForTimeout(5000);
                            } else {
                                await page.waitForTimeout(5000);
                            }
                            await checkLoginWall(formContext);
                            break;
                        }
                    } catch (e) {}
                }
            }
        }

        // Generic / Workday form-filling steps
        await uploadResume(formContext, profile.resumePath);
        await page.waitForTimeout(3000);

        const fullName = `${profile.firstName} ${profile.lastName}`;
        await fillFieldByLabelOrSelector(formContext, 'First Name', ['input[name*="first_name"]', 'input[id*="first"]', 'input[name*="firstName"]', 'input[placeholder*="First Name"]'], profile.firstName);
        await fillFieldByLabelOrSelector(formContext, 'Last Name', ['input[name*="last_name"]', 'input[id*="last"]', 'input[name*="lastName"]', 'input[placeholder*="Last Name"]'], profile.lastName);
        await fillFieldByLabelOrSelector(formContext, 'Full Name', ['input[name*="name"]', 'input[id*="name"]', 'input[placeholder*="Full Name"]'], fullName);
        await fillFieldByLabelOrSelector(formContext, 'Email', ['input[type="email"]', 'input[name*="email"]', 'input[placeholder*="Email"]'], profile.email);
        await fillFieldByLabelOrSelector(formContext, 'Phone', ['input[type="tel"]', 'input[name*="phone"]', 'input[placeholder*="Phone"]'], profile.phone);
        await fillFieldByLabelOrSelector(formContext, 'LinkedIn', ['input[name*="linkedin"]', 'input[placeholder*="LinkedIn"]'], profile.linkedin);
        await fillFieldByLabelOrSelector(formContext, 'GitHub', ['input[name*="github"]', 'input[placeholder*="GitHub"]'], profile.github);
    }

    // Helpers for Q&A Cache
    const QA_CACHE_PATH = path.join(__dirname, '..', 'data', 'qa_cache.json');
    function loadQACache() {
        try {
            if (fs.existsSync(QA_CACHE_PATH)) {
                return JSON.parse(fs.readFileSync(QA_CACHE_PATH, 'utf8'));
            }
        } catch (e) {
            console.error('  [Autofill] Failed to load QA cache:', e.message);
        }
        return {};
    }
    function saveQACache(cache) {
        try {
            fs.writeFileSync(QA_CACHE_PATH, JSON.stringify(cache, null, 2));
        } catch (e) {
            console.error('  [Autofill] Failed to save QA cache:', e.message);
        }
    }
    function cleanQuestionKey(q) {
        return q.toLowerCase()
                .replace(/[^a-z0-9]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
    }

    // Static mapping helper for text fields
    function getStaticAnswer(label, profile) {
        const cleanLabel = label.toLowerCase();
        
        // 1. Name fields
        if (/first\s*name|given\s*name|forename|^first$|fname/i.test(cleanLabel)) {
            return profile.firstName;
        }
        if (/last\s*name|family\s*name|surname|^last$|lname/i.test(cleanLabel)) {
            return profile.lastName;
        }
        if (/full\s*name|^name$/i.test(cleanLabel)) {
            return `${profile.firstName} ${profile.lastName}`.trim();
        }
        
        // 2. Contact details
        if (/email|e-mail/i.test(cleanLabel)) {
            return profile.email;
        }
        if (/phone|telephone|mobile|cell|contact\s*number/i.test(cleanLabel)) {
            return profile.phone;
        }
        if (/linkedin/i.test(cleanLabel)) {
            return profile.linkedin;
        }
        if (/github/i.test(cleanLabel)) {
            return profile.github;
        }
        if (/portfolio|website|homepage/i.test(cleanLabel)) {
            return profile.portfolio;
        }
        if (/location|city|address|country|state|residency|residence/i.test(cleanLabel)) {
            return process.env.CANDIDATE_LOCATION || 'Mumbai';
        }
        
        // 3. Common questions
        if (/salary|compensation|remuneration|pay\s*expectation|desired\s*pay/i.test(cleanLabel)) {
            return process.env.CANDIDATE_SALARY || 'Open';
        }
        if (/start\s*date|notice\s*period|earliest\s*start|availability|how\s*soon/i.test(cleanLabel)) {
            return 'Immediate';
        }
        if (/years\s*of\s*experience|experience\s*in\s*years|^experience$/i.test(cleanLabel)) {
            return process.env.CANDIDATE_EXPERIENCE || 'Fresher';
        }
        if (/work\s*authorization|legally\s*authorized/i.test(cleanLabel)) {
            return 'Yes';
        }
        if (/sponsorship|require\s*visa|visa\s*sponsorship/i.test(cleanLabel)) {
            return profile.requiresSponsorship ? 'Yes' : 'No';
        }
        
        return null;
    }

    // Static dropdown selection matching helper
    function getStaticDropdownSelection(label, optionList, profile) {
        const cleanLabel = label.toLowerCase();
        
        // Sponsorship
        if (/sponsorship|require\s*visa|visa\s*sponsorship/i.test(cleanLabel)) {
            const target = profile.requiresSponsorship ? 'yes' : 'no';
            const found = optionList.find(o => o.text.toLowerCase() === target || o.text.toLowerCase().startsWith(target));
            if (found) return found;
        }
        
        // Legally authorized
        if (/legally\s*authorized|authorized\s*to\s*work|right\s*to\s*work|work\s*authorization/i.test(cleanLabel)) {
            const found = optionList.find(o => o.text.toLowerCase() === 'yes' || o.text.toLowerCase().startsWith('yes'));
            if (found) return found;
        }
        
        // Voluntary Disclosures (Gender, Race, Veteran, Disability)
        if (/gender|sex/i.test(cleanLabel) && !/trans/i.test(cleanLabel)) {
            const found = optionList.find(o => /decline|prefer\s*not|choose\s*not/i.test(o.text));
            if (found) return found;
        }
        
        if (/race|ethnic/i.test(cleanLabel)) {
            const found = optionList.find(o => /decline|prefer\s*not|choose\s*not/i.test(o.text));
            if (found) return found;
        }
        
        if (/veteran/i.test(cleanLabel)) {
            const found = optionList.find(o => /decline|prefer\s*not|choose\s*not|not\s*a\s*veteran|^no$/i.test(o.text));
            if (found) return found;
        }
        
        if (/disabilit/i.test(cleanLabel)) {
            const found = optionList.find(o => /decline|prefer\s*not|choose\s*not|no\s*.*disability|^no$/i.test(o.text));
            if (found) return found;
        }
        
        return null;
    }

    // Readline terminal question helper
    function askTerminal(question) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        return new Promise(resolve => rl.question(question, ans => {
            rl.close();
            resolve(ans);
        }));
    }

    // Submit button click helper
    async function attemptFormSubmission(page, formContext) {
        const submitBtnSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            '#submit_app',
            '#btn-submit',
            'button:has-text("Submit Application")',
            'button:has-text("Submit")',
            'button:has-text("Apply")',
            'button:has-text("Send Application")',
            'a:has-text("Submit Application")',
            'a:has-text("Submit")'
        ];
        
        for (const selector of submitBtnSelectors) {
            try {
                // Search inside the frame/context
                let btn = formContext.locator(selector);
                if (await btn.count() > 0 && await btn.first().isVisible() && !(await btn.first().isDisabled())) {
                    console.log(`  [Autofill] Found submit button in context: "${selector}". Clicking...`);
                    await btn.first().click();
                    return true;
                }
                // Fallback to main page if not found in frame
                btn = page.locator(selector);
                if (await btn.count() > 0 && await btn.first().isVisible() && !(await btn.first().isDisabled())) {
                    console.log(`  [Autofill] Found submit button on page: "${selector}". Clicking...`);
                    await btn.first().click();
                    return true;
                }
            } catch (e) {}
        }
        return false;
    }


    // 1. Fill Standard / Hidden Text Inputs and Textareas
    console.log('  [Autofill] AI & Local Matching Fallback: Scanning for empty visible text inputs...');
    const qaCache = loadQACache();
    try {
        const inputs = await formContext.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), textarea').all();
        for (const input of inputs) {
            if (await input.isVisible() && (await input.inputValue()) === '') {
                // Get label or placeholder text to identify the field
                let fieldLabel = await findLabelForInput(input);
                if (!fieldLabel) {
                    fieldLabel = await input.getAttribute('placeholder') || await input.getAttribute('name') || await input.getAttribute('aria-label') || '';
                }

                if (fieldLabel) {
                    const cleanLabel = fieldLabel.replace(/\*/g, '').replace(/\n/g, ' ').trim();
                    if (!cleanLabel) continue;

                    let answerToFill = null;

                    // A. Check Static Match
                    const staticVal = getStaticAnswer(cleanLabel, profile);
                    if (staticVal !== null) {
                        answerToFill = staticVal;
                        console.log(`  [Autofill] Local Match: Found answer for "${cleanLabel}": "${staticVal}"`);
                    } else {
                        // B. Check Q&A Cache
                        const cacheKey = cleanQuestionKey(cleanLabel);
                        if (qaCache[cacheKey]) {
                            answerToFill = qaCache[cacheKey];
                            console.log(`  [Autofill] Cache Match: Found answer for "${cleanLabel}": "${answerToFill.substring(0, 60)}..."`);
                        } else {
                            // C. Fallback to Gemini
                            console.log(`  [Autofill] AI Fallback: Querying Gemini for field: "${cleanLabel}"`);
                            const prompt = `You are an AI assistant helping to autofill a job application form.
We have the following candidate profile:
Name: ${profile.firstName} ${profile.lastName}
Email: ${profile.email}
Phone: ${profile.phone}
LinkedIn: ${profile.linkedin}
GitHub: ${profile.github}
Portfolio: ${profile.portfolio}

The form has an empty field with the label/placeholder: "${cleanLabel}".
If this field corresponds to one of the profile details (like First Name, Last Name, Full Name, Email, Phone, LinkedIn, GitHub, Portfolio/Website), output ONLY the corresponding value from the profile.
If it is a custom question, generate a brief, professional answer based on the candidate's profile and this job description:
"${jobDescription.substring(0, 1000)}"

Output only the direct text to be filled into the field, with no extra explanations or quotes.`;

                            const answer = await generateQuestionAnswer(prompt, jobDescription, profile);
                            if (answer && answer.trim()) {
                                answerToFill = answer.trim().replace(/^"|"$/g, '');
                                
                                // Save to cache
                                qaCache[cacheKey] = answerToFill;
                                saveQACache(qaCache);
                                console.log(`  [Autofill] AI Fallback: Found answer for "${cleanLabel}": "${answerToFill.substring(0, 60)}..."`);
                            }
                        }
                    }

                    if (answerToFill !== null) {
                        // Check if this input is a combobox or location autocomplete
                        const isCombobox = (await input.getAttribute('role')) === 'combobox' || 
                                           cleanLabel.toLowerCase().includes('location') || 
                                           (await input.getAttribute('placeholder') || '').toLowerCase().includes('typing');
                        if (isCombobox) {
                            console.log(`  [Autofill] Combobox detected for "${cleanLabel}". Filling "${answerToFill}" and selecting dropdown option...`);
                            await input.click();
                            await input.focus();
                            await input.fill('');
                            await page.keyboard.type(answerToFill, { delay: 100 });
                            await page.waitForTimeout(2000);
                            
                            let optionClicked = false;
                            const optionSelectors = [
                                `[role="option"]`,
                                `.option`,
                                `[class*="option"]`,
                                `li`,
                                `button`,
                                `div`
                            ];
                            
                            for (const selector of optionSelectors) {
                                try {
                                    const elements = await page.locator(selector).all();
                                    for (const el of elements) {
                                        if (await el.isVisible()) {
                                            const text = await el.innerText();
                                            if (text.toLowerCase().includes(answerToFill.toLowerCase()) || 
                                                (answerToFill.toLowerCase() === 'mumbai' && text.toLowerCase().includes('india'))) {
                                                console.log(`  [Autofill] Found matching dropdown option: "${text}". Clicking...`);
                                                await el.click();
                                                optionClicked = true;
                                                break;
                                            }
                                        }
                                    }
                                } catch (err) {}
                                if (optionClicked) break;
                            }
                            
                            if (!optionClicked) {
                                console.log(`  [Autofill] Could not find dropdown option for "${answerToFill}". Trying keyboard navigation...`);
                                await input.focus();
                                await page.keyboard.press('ArrowDown');
                                await page.waitForTimeout(500);
                                await page.keyboard.press('Enter');
                                await page.waitForTimeout(500);
                            }
                        } else {
                            await input.fill(answerToFill);
                            console.log(`  [Autofill] Filled "${cleanLabel}" with: "${answerToFill.substring(0, 60)}..."`);
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('  [Autofill] Error during inputs filling:', e.message);
    }

    // 2. Fill Dropdown Select elements
    console.log('  [Autofill] Dropdowns Fallback: Scanning for visible select dropdowns...');
    try {
        const selectElements = await formContext.locator('select').all();
        for (const select of selectElements) {
            if (await select.isVisible() && !(await select.isDisabled())) {
                let labelText = '';
                const idAttr = await select.getAttribute('id');
                if (idAttr) {
                    const label = formContext.locator(`label[for="${idAttr}"]`);
                    if (await label.count() > 0) {
                        labelText = await label.first().innerText();
                    }
                }
                if (!labelText) {
                    labelText = await select.getAttribute('name') || await select.getAttribute('aria-label') || '';
                }

                // Check if dropdown has a currently selected value that is valid (not placeholder/empty)
                const currentVal = await select.inputValue();
                if (currentVal && currentVal !== 'select' && currentVal !== '' && currentVal !== '--') {
                    // Already filled
                    continue;
                }

                const options = await select.locator('option').all();
                const optionList = [];
                for (const opt of options) {
                    const val = await opt.getAttribute('value') || '';
                    const txt = await opt.innerText() || '';
                    if (txt.trim() && val.trim() && val !== 'select' && !txt.toLowerCase().includes('select')) {
                        optionList.push({ value: val, text: txt.trim() });
                    }
                }

                if (optionList.length > 0 && labelText) {
                    const cleanLabel = labelText.replace(/\*/g, '').replace(/\n/g, ' ').trim();
                    
                    // A. Check Local Dropdown match (Gender, Race, sponsorship, etc)
                    const staticMatch = getStaticDropdownSelection(cleanLabel, optionList, profile);
                    if (staticMatch) {
                        await select.selectOption(staticMatch.value);
                        console.log(`  [Autofill] Local Dropdown Match: Selected "${staticMatch.text}" for "${cleanLabel}"`);
                        continue;
                    }

                    // B. Query Gemini Choice
                    console.log(`  [Autofill] AI Dropdown: Querying Gemini for choice in: "${cleanLabel}"`);
                    const optionTexts = optionList.map(o => o.text);
                    const chosenIdx = await selectOptionFromDropdown(cleanLabel, optionTexts, profile);
                    if (chosenIdx >= 0 && chosenIdx < optionList.length) {
                        await select.selectOption(optionList[chosenIdx].value);
                        console.log(`  [Autofill] AI Dropdown: Selected "${optionList[chosenIdx].text}" for "${cleanLabel}"`);
                    }
                }
            }
        }
    } catch (e) {
        console.error('  [Autofill] Error during dropdown filling:', e.message);
    }

    // 3. Fill Radio Buttons
    console.log('  [Autofill] Radios Fallback: Scanning for visible radio button groups...');
    try {
        const radios = await formContext.locator('input[type="radio"]').all();
        const radioGroups = {};
        for (const radio of radios) {
            if (await radio.isVisible()) {
                const name = await radio.getAttribute('name');
                if (name) {
                    if (!radioGroups[name]) {
                        radioGroups[name] = [];
                    }
                    radioGroups[name].push(radio);
                }
            }
        }

        for (const name in radioGroups) {
            const groupRadios = radioGroups[name];
            
            // Check if any radio in the group is already checked
            let isAnyChecked = false;
            for (const radio of groupRadios) {
                if (await radio.isChecked()) {
                    isAnyChecked = true;
                    break;
                }
            }
            if (isAnyChecked) continue; // Already selected

            // Find group label or question text
            let groupQuestion = await groupRadios[0].evaluate(node => {
                let parent = node.parentElement;
                while (parent && parent.tagName !== 'FORM') {
                    if (parent.tagName === 'FIELDSET') {
                        const legend = parent.querySelector('legend');
                        if (legend) return legend.textContent.trim();
                    }
                    parent = parent.parentElement;
                }
                return '';
            });

            const options = [];
            for (const radio of groupRadios) {
                const idAttr = await radio.getAttribute('id');
                let radioLabelText = '';
                if (idAttr) {
                    const label = formContext.locator(`label[for="${idAttr}"]`);
                    if (await label.count() > 0) {
                        radioLabelText = await label.first().innerText();
                    }
                }
                if (!radioLabelText) {
                    radioLabelText = await radio.evaluate(node => {
                        const parent = node.parentElement;
                        return parent ? parent.textContent.trim() : '';
                    });
                }
                options.push({ radio, text: radioLabelText.trim() });
            }

            if (!groupQuestion && options.length > 0) {
                // Fallback
                groupQuestion = name;
            }

            if (options.length > 0 && groupQuestion) {
                const cleanLabel = groupQuestion.replace(/\*/g, '').replace(/\n/g, ' ').trim();
                
                // A. Check Local Dropdown match (for yes/no, disclosures)
                const staticMatch = getStaticDropdownSelection(cleanLabel, options, profile);
                if (staticMatch) {
                    await staticMatch.radio.click();
                    console.log(`  [Autofill] Local Radio Match: Clicked "${staticMatch.text}" for "${cleanLabel}"`);
                    continue;
                }

                // B. Query Gemini Choice
                console.log(`  [Autofill] AI Radio: Querying Gemini for choice in: "${cleanLabel}"`);
                const optionTexts = options.map(o => o.text);
                const chosenIdx = await selectOptionFromDropdown(cleanLabel, optionTexts, profile);
                if (chosenIdx >= 0 && chosenIdx < options.length) {
                    await options[chosenIdx].radio.click();
                    console.log(`  [Autofill] AI Radio: Clicked "${options[chosenIdx].text}" for "${cleanLabel}"`);
                }
            }
        }
    } catch (e) {
        console.error('  [Autofill] Error during radio button filling:', e.message);
    }

    // 4. Fill Checkboxes
    console.log('  [Autofill] Checkboxes Fallback: Checking terms and policy consent checkboxes...');
    try {
        const checkboxes = await formContext.locator('input[type="checkbox"]').all();
        for (const checkbox of checkboxes) {
            if (await checkbox.isVisible() && !(await checkbox.isChecked())) {
                let labelText = '';
                const idAttr = await checkbox.getAttribute('id');
                if (idAttr) {
                    const label = formContext.locator(`label[for="${idAttr}"]`);
                    if (await label.count() > 0) {
                        labelText = await label.first().innerText();
                    }
                }
                if (!labelText) {
                    labelText = await checkbox.evaluate(node => {
                        const parent = node.parentElement;
                        return parent ? parent.textContent.trim() : '';
                    });
                }
                
                const cleanLabel = labelText.toLowerCase();
                const isRequired = await checkbox.getAttribute('required') !== null;
                if (isRequired || 
                    cleanLabel.includes('agree') || 
                    cleanLabel.includes('consent') || 
                    cleanLabel.includes('terms') || 
                    cleanLabel.includes('policy') || 
                    cleanLabel.includes('acknowledge') || 
                    cleanLabel.includes('certify') || 
                    cleanLabel.includes('understand') || 
                    cleanLabel.includes('correct') ||
                    cleanLabel.includes('authorized') ||
                    cleanLabel.includes('declaration')) {
                    
                    await checkbox.check();
                    console.log(`  [Autofill] Checked checkbox: "${labelText.trim().substring(0, 60)}..."`);
                }
            }
        }
    } catch (e) {
        console.error('  [Autofill] Error during checkbox filling:', e.message);
    }

    // 4.5 Fill Custom Button Choices (Yes/No button groups)
    console.log('  [Autofill] Custom Button Choices: Scanning for button-based Yes/No or choice groups...');
    try {
        const buttons = await formContext.locator('button').all();
        const parentMap = new Map();
        for (const btn of buttons) {
            if (await btn.isVisible()) {
                const btnText = (await btn.innerText()).trim();
                if (!btnText) continue;
                
                // Skip submit/apply or upload buttons
                const lowerText = btnText.toLowerCase();
                if (lowerText.includes('submit') || 
                    lowerText.includes('upload') || 
                    lowerText.includes('apply') || 
                    lowerText.includes('attach') || 
                    lowerText.includes('sign in') || 
                    lowerText.includes('log in') || 
                    lowerText.includes('register') || 
                    lowerText.includes('create account')) {
                    continue;
                }
                
                // Get a unique identifier for the parent element
                const parentId = await btn.evaluate(node => {
                    const parent = node.parentElement;
                    if (!parent) return null;
                    return `${parent.tagName}_${parent.className}_${parent.innerText.substring(0, 100)}`;
                });
                
                if (parentId) {
                    if (!parentMap.has(parentId)) {
                        parentMap.set(parentId, { parent: btn.locator('xpath=..'), buttons: [] });
                    }
                    parentMap.get(parentId).buttons.push({ btn, text: btnText });
                }
            }
        }
        
        for (const [parentId, group] of parentMap.entries()) {
            if (group.buttons.length < 2) continue; // Must be a choice group
            
            // Check if any button in the group is already selected/active
            let isAnyChecked = false;
            for (const item of group.buttons) {
                const isActive = await item.btn.evaluate(node => {
                    const className = node.className.toLowerCase();
                    return className.includes('active') || 
                           className.includes('selected') || 
                           className.includes('checked') || 
                           node.getAttribute('aria-checked') === 'true' || 
                           node.getAttribute('aria-selected') === 'true';
                });
                if (isActive) {
                    isAnyChecked = true;
                    break;
                }
            }
            if (isAnyChecked) {
                console.log(`  [Autofill] Group under parent already has a selection. Skipping.`);
                continue;
            }
            
            // Find the question/label text for this button group by walking up the DOM
            const questionText = await group.buttons[0].btn.evaluate(node => {
                let parent = node.parentElement;
                for (let i = 0; i < 4; i++) {
                    if (!parent) break;
                    const label = parent.querySelector('label');
                    if (label && label.innerText.trim()) return label.innerText.trim();
                    
                    const title = parent.querySelector('[class*="label"], [class*="title"], [class*="heading"], [class*="question"]');
                    if (title && title.innerText.trim()) return title.innerText.trim();
                    
                    parent = parent.parentElement;
                }
                return '';
            });
            
            if (questionText) {
                const cleanLabel = questionText.replace(/\*/g, '').replace(/\n/g, ' ').trim();
                const optionTexts = group.buttons.map(b => b.text);
                
                console.log(`  [Autofill] Found custom button group under question: "${cleanLabel}" with options: [${optionTexts.join(', ')}]`);
                
                // Check static local dropdown/choice match
                const mockOptionList = group.buttons.map(b => ({ text: b.text, value: b.text }));
                const staticMatch = getStaticDropdownSelection(cleanLabel, mockOptionList, profile);
                if (staticMatch) {
                    const matchedBtn = group.buttons.find(b => b.text === staticMatch.value);
                    if (matchedBtn) {
                        await matchedBtn.btn.click();
                        console.log(`  [Autofill] Local Button Match: Clicked "${matchedBtn.text}" for "${cleanLabel}"`);
                        continue;
                    }
                }
                
                // Query Gemini Choice
                console.log(`  [Autofill] AI Custom Buttons: Querying Gemini for choice in: "${cleanLabel}"`);
                const chosenIdx = await selectOptionFromDropdown(cleanLabel, optionTexts, profile);
                if (chosenIdx >= 0 && chosenIdx < group.buttons.length) {
                    await group.buttons[chosenIdx].btn.click();
                    console.log(`  [Autofill] AI Custom Buttons: Clicked "${group.buttons[chosenIdx].text}" for "${cleanLabel}"`);
                }
            }
        }
    } catch (e) {
        console.error('  [Autofill] Error during custom button choice filling:', e.message);
    }

    // 5. Automated Submission
    const autoSubmit = process.env.AUTO_SUBMIT === 'true';
    if (autoSubmit) {
        console.log('\n[Autofill] AUTO_SUBMIT is true. Attempting form submission...');
        const submitted = await attemptFormSubmission(page, formContext);
        if (submitted) {
            console.log('  [Autofill] Clicked submit/apply button. Waiting 8 seconds to check for redirection/success...');
            await page.waitForTimeout(8000);
        } else {
            console.warn('  [Autofill] Warning: Could not locate a visible submit button.');
        }
    } else {
        console.log('\n[Autofill] AUTO_SUBMIT is false. Form submission skipped.');
    }

    // 6. Interactive Prompt review window
    console.log('\n========================================================================');
    console.log('👉 [Action Required] Review Autofill Progress');
    console.log('   - Review/correct any fields in the browser.');
    console.log('   - Solve any CAPTCHAs and manually submit the form if not done.');
    console.log('👉 Press ENTER in this terminal when you are ready to proceed.');
    console.log('👉 Type "skip" and press ENTER to skip logging this application.');
    console.log('========================================================================\n');

    const responseInput = await askTerminal('Ready? [Enter to continue / "skip"]: ');
    if (responseInput.trim().toLowerCase() === 'skip') {
        throw new Error('Application skipped by user in review stage.');
    }
}

module.exports = {
    autofillJobApplication,
    applyLinkedInEasyApply
};
