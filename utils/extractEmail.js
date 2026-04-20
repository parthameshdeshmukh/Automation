/**
 * Processes text to extract unique, valid email addresses.
 * @param {string[]} postTexts - Array of post contents.
 * @returns {string[]} - Clean list of unique email addresses.
 */
function extractEmails(postTexts) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const allEmails = [];

    postTexts.forEach(text => {
        const matches = text.match(emailRegex);
        if (matches) {
            allEmails.push(...matches);
        }
    });

    // Remove duplicates and convert to lowercase for consistency
    const uniqueEmails = [...new Set(allEmails.map(email => email.toLowerCase()))];
    
    console.log(`[Processor] Extracted ${uniqueEmails.length} unique emails.`);
    return uniqueEmails;
}

module.exports = extractEmails;
