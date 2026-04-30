/**
 * Checks if email looks like a genuine recruiter/hiring manager and not a support address.
 */
function isValidCandidateEmail(email) {
    const blockList = ['support', 'info', 'careers', 'help', 'no-reply', 'admin', 'example'];
    const lowerEmail = email.toLowerCase();
    
    const isBlocked = blockList.some(blockedWord => lowerEmail.includes(blockedWord));
    
    if (isBlocked) {
        console.log(`[Processor] Skipping generic/blocked email type: ${email}`);
        return false;
    }
    return true;
}

/**
 * Processes text to extract unique, valid email addresses along with their Job Description.
 * @param {string[]} postTexts - Array of post contents.
 * @returns {Array<{email: string, jd: string}>} - Clean list of objects containing email and jd.
 */
function extractEmails(postTexts) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailToJDMap = new Map();

    postTexts.forEach(text => {
        // Context Check: exclude posts that sound like a candidate asking for a job
        const lowerText = text.toLowerCase();
        if (lowerText.includes("my portfolio") || lowerText.includes("hire me") || lowerText.includes("looking for job")) {
            return; // likely another candidate, not HR
        }

        const matches = text.match(emailRegex);
        if (matches) {
            matches.forEach(email => {
                const lowerEmail = email.toLowerCase();
                // Store the first JD found for this email
                if (!emailToJDMap.has(lowerEmail)) {
                    // Clean JD: Remove hashtags and unnecessary data
                    let cleanJD = text.replace(/#[\w-]+\b/g, ''); 
                    cleanJD = cleanJD.replace(/\bhashtag\b/gi, '');
                    cleanJD = cleanJD.replace(/https?:\/\/[^\s]+/g, '');
                    cleanJD = cleanJD.replace(/\n{3,}/g, '\n\n').trim();
                    emailToJDMap.set(lowerEmail, cleanJD);
                }
            });
        }
    });

    const validResults = [];
    for (const [email, jd] of emailToJDMap.entries()) {
        if (isValidCandidateEmail(email)) {
            validResults.push({ email, jd });
        }
    }
    
    console.log(`[Processor] Extracted ${validResults.length} valid unique emails (out of ${emailToJDMap.size} found).`);
    return validResults;
}

module.exports = extractEmails;
