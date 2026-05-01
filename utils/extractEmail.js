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
 * Processes text to extract unique, valid email addresses along with their Job Description and Post Link.
 * @param {Array<{text: string, postUrl: string}>} posts - Array of post objects.
 * @returns {Array<{email: string, jd: string, postUrl: string}>} - Clean list of objects containing email, jd, and postUrl.
 */
function extractEmails(posts) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailToDataMap = new Map();

    posts.forEach(postObj => {
        const text = postObj.text || '';
        const postUrl = postObj.postUrl || 'Not available';
        
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
                if (!emailToDataMap.has(lowerEmail)) {
                    // Clean JD: Remove hashtags, URLs, and emojis
                    let cleanJD = text.replace(/#[\w-]+\b/g, ''); 
                    cleanJD = cleanJD.replace(/\bhashtag\b/gi, '');
                    cleanJD = cleanJD.replace(/https?:\/\/[^\s]+/g, '');
                    // Remove Emojis
                    cleanJD = cleanJD.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
                    
                    // Normalize spacing and format as structured paragraphs
                    cleanJD = cleanJD
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0) // Remove empty lines
                        .join('\n\n'); // Join with double breaks for paragraph structure
                        
                    emailToDataMap.set(lowerEmail, { jd: cleanJD, postUrl: postUrl });
                }
            });
        }
    });

    const validResults = [];
    for (const [email, data] of emailToDataMap.entries()) {
        if (isValidCandidateEmail(email)) {
            validResults.push({ email, jd: data.jd, postUrl: data.postUrl });
        }
    }
    
    console.log(`[Processor] Extracted ${validResults.length} valid unique emails (out of ${emailToDataMap.size} found).`);
    return validResults;
}

module.exports = extractEmails;
