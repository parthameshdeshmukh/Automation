require('dotenv').config();
const { generateResumePoints } = require('../services/geminiService');
const { generateDynamicResume } = require('../services/compilePdfService');
const fs = require('fs');
const path = require('path');

const mockJd = [
    'Position: Senior Java Developer',
    'Requirements:',
    '- 4+ years of professional backend engineering in Java, Spring Boot',
    '- Microservices, REST APIs, PostgreSQL, Redis, Docker, AWS',
    '- Experience with Kafka for event-driven messaging',
    '- Observability with Prometheus and Grafana',
    '- Strong OOP, clean code, and CI/CD practices'
].join('\n');

const mockRole = 'Java Developer';

(async () => {
    console.log('=== Testing Gemini Prompt + Word COM PDF ===');
    console.log('API Key:', process.env.GEMINI_API_KEY ? 'FOUND' : 'MISSING');

    const data = await generateResumePoints(mockJd, mockRole);
    console.log('isFallback:', data.isFallback);

    if (!data.isFallback) {
        console.log('\n--- PROFESSIONAL SUMMARY ---');
        console.log('ORIGINAL:', data.summary.original.substring(0, 100) + '...');
        console.log('TAILORED:', data.summary.tailored.substring(0, 100) + '...');

        console.log('\n--- STACK: Backend ---');
        console.log('ORIGINAL:', data.stack_backend.original);
        console.log('TAILORED:', data.stack_backend.tailored);

        console.log('\n--- PROJECT1 BULLET1 ---');
        console.log('ORIGINAL:', data.project1_bullet1.original.substring(0, 100) + '...');
        console.log('TAILORED:', data.project1_bullet1.tailored.substring(0, 100) + '...');
    }

    console.log('\n[Compiling PDF via MS Word COM...]');
    const pdfPath = await generateDynamicResume(data);
    const exists = fs.existsSync(pdfPath);
    console.log('PDF created:', exists, '| Path:', pdfPath);

    if (exists) {
        const size = fs.statSync(pdfPath).size;
        console.log('PDF size (bytes):', size);
        const outCopy = path.join(__dirname, 'test_output.pdf');
        fs.copyFileSync(pdfPath, outCopy);
        fs.unlinkSync(pdfPath);
        console.log('Saved copy as:', outCopy);
    }

    console.log('=== Test Complete ===');
})().catch(e => {
    console.error('TEST FAILED:', e.message);
    process.exit(1);
});
