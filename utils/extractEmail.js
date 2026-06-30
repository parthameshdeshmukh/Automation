/**
 * Checks if email looks like a genuine recruiter/hiring manager and not a support address.
 */
function isValidCandidateEmail(email) {
    const blockList = ['support', 'info', 'careers', 'help', 'no-reply', 'admin', 'example'];
    const lowerEmail = email.toLowerCase();
    
    const parts = lowerEmail.split('@');
    if (parts.length < 2) return false;
    const username = parts[0];
    
    const isBlocked = blockList.some(blockedWord => {
        return username === blockedWord || 
               username.startsWith(blockedWord + '.') || 
               username.startsWith(blockedWord + '_') || 
               username.startsWith(blockedWord + '-');
    });
    
    if (isBlocked) {
        console.log(`[Processor] Skipping generic/blocked email type: ${email}`);
        return false;
    }
    return true;
}

/**
 * Helper to translate obfuscated emails (e.g. john [at] company.com) to standard ones.
 */
function deobfuscateText(text) {
    if (!text) return '';
    return text
        .replace(/\s*\[at\]\s*/gi, '@')
        .replace(/\s*\(at\)\s*/gi, '@')
        .replace(/\s*\{at\}\s*/gi, '@')
        .replace(/\s+at\s+/gi, '@')
        .replace(/\s*\[dot\]\s*/gi, '.')
        .replace(/\s*\(dot\)\s*/gi, '.')
        .replace(/\s*\{dot\}\s*/gi, '.')
        .replace(/\s+dot\s+/gi, '.');
}

/**
 * Processes text to extract unique, valid email addresses along with their Job Description and Post Link.
 * @param {Array<{text: string, postUrl: string}>} posts - Array of post objects.
 * @returns {Array<{email: string, jd: string, postUrl: string}>} - Clean list of objects containing email, jd, and postUrl.
 */
function extractEmails(posts) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const results = [];
    const seenUrls = new Set();

    posts.forEach(postObj => {
        const text = postObj.text || '';
        const postUrl = postObj.postUrl || 'Not available';
        
        if (postUrl !== 'Not available') {
            if (seenUrls.has(postUrl.toLowerCase())) return;
            seenUrls.add(postUrl.toLowerCase());
        }

        // Context Check: exclude posts that sound like a candidate asking for a job
        const lowerText = text.toLowerCase();
        if (lowerText.includes("my portfolio") || lowerText.includes("hire me") || lowerText.includes("looking for job")) {
            return; // likely another candidate, not HR
        }

        // De-obfuscate a copy of the text for email matching
        const textForExtraction = deobfuscateText(text);

        const matches = textForExtraction.match(emailRegex);
        let extractedEmail = 'Not available';
        if (matches) {
            for (const email of matches) {
                if (isValidCandidateEmail(email)) {
                    extractedEmail = email.toLowerCase();
                    break;
                }
            }
        }

        // Clean JD: Remove hashtags, URLs, and emojis from original text
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
            
        results.push({
            email: extractedEmail,
            hrmail: extractedEmail,
            jd: cleanJD,
            postUrl: postUrl,
            keywords: postObj.keywords
        });
    });

    const withEmail = results.filter(r => r.email !== 'Not available').length;
    console.log(`[Processor] Extracted ${results.length} total posts. ${withEmail} had valid emails, ${results.length - withEmail} did not.`);
    return results;
}

function extractFormLinks(posts) {
    const formRegex = /https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:google\.com\/forms|forms\.gle|typeform\.com|jotform\.com|forms\.office\.com|surveyheart\.com|linktr\.ee|forms\.app|formstack\.com|docs\.google\.com\/spreadsheets)\/[^\s]+/gi;
    const formKeywords = ['form', 'apply', 'register', 'link', 'doc', 'sheet', 'registration', 'gform'];
    const urlRegex = /https?:\/\/[^\s]+/gi;

    const results = [];
    const seenLinks = new Set();

    posts.forEach(postObj => {
        const text = postObj.text || '';
        const postUrl = postObj.postUrl || 'Not available';
        const authorName = postObj.authorName || 'Unknown Author';
        
        // Context Check: exclude posts that sound like a candidate asking for a job
        const lowerText = text.toLowerCase();
        if (lowerText.includes("my portfolio") || lowerText.includes("hire me") || lowerText.includes("looking for job")) {
            return;
        }

        // Try to find explicit form URLs
        const foundUrls = [];
        let match;
        while ((match = formRegex.exec(text)) !== null) {
            foundUrls.push(match[0]);
        }

        // If no explicit form URL, look for any URL if keywords are present
        if (foundUrls.length === 0) {
            const hasKeyword = formKeywords.some(kw => lowerText.includes(kw));
            if (hasKeyword) {
                // Reset regex index
                urlRegex.lastIndex = 0;
                let urlMatch;
                while ((urlMatch = urlRegex.exec(text)) !== null) {
                    const url = urlMatch[0];
                    if (!url.includes('linkedin.com/feed') && !url.includes('linkedin.com/posts')) {
                        foundUrls.push(url);
                    }
                }
            }
        }

        if (foundUrls.length > 0) {
            foundUrls.forEach(url => {
                // Clean up trailing punctuation
                let cleanUrl = url.replace(/[.,;:)\]]+$/, '');
                const key = `${postUrl}_${cleanUrl}`;
                if (!seenLinks.has(key)) {
                    seenLinks.add(key);

                    // Clean JD: Remove hashtags, URLs, and emojis
                    let cleanJD = text.replace(/#[\w-]+\b/g, ''); 
                    cleanJD = cleanJD.replace(/\bhashtag\b/gi, '');
                    cleanJD = cleanJD.replace(/https?:\/\/[^\s]+/g, '');
                    cleanJD = cleanJD.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
                    
                    cleanJD = cleanJD
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0)
                        .join('\n\n');

                    results.push({
                        company: authorName,
                        postUrl: postUrl,
                        jd: cleanJD,
                        formUrl: cleanUrl
                    });
                }
            });
        }
    });

    console.log(`[Processor] Extracted ${results.length} registration/form links.`);
    return results;
}

module.exports = { extractEmails, extractFormLinks };
