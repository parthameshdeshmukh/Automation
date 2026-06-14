const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('No API Key found');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

(async () => {
    try {
        // We can access the generative model list using the client library's internal client or similar,
        // but let's just do a direct fetch since the listModels is available on the API.
        // Actually, the JS SDK does not expose listModels easily without googleapis,
        // but we can query it directly with a fetch request!
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.models) {
            console.log('Available Models:');
            data.models.forEach(m => {
                console.log(`- ${m.name} (supports: ${m.supportedGenerationMethods.join(', ')})`);
            });
        } else {
            console.log('No models list returned:', JSON.stringify(data));
        }
    } catch (err) {
        console.error('Error fetching models:', err.message);
    }
})();
