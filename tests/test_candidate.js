require('dotenv').config();
const { generateResumePoints } = require('../services/geminiService');
const { generateDynamicResume } = require('../services/compilePdfService');
const fs = require('fs');
const path = require('path');

const mockJds = {
    deepika: {
        role: "Java Backend Engineer",
        jd: "Role: Java Developer. Requirements: 4+ years Java, Spring Boot, Microservices, REST APIs, AWS, SQL, Kafka. Experience with Prometheus/Grafana is a plus."
    },
    shilpa: {
        role: "Sr. Healthcare Business Analyst",
        jd: "Role: Senior Business Analyst - Healthcare. Requirements: 8+ years experience, extensive knowledge of claims adjudication, member enrollment, billing processes, and EHR/EMR integrations. Must be skilled in creating BRDs, FRDs, User Stories, and conducting UAT."
    },
    yeshwanth: {
        role: "Full Stack Engineer",
        jd: "Role: Full Stack Python Developer. Requirements: 3+ years experience, strong Python/Flask, AWS (IAM, Lambda, EC2), CI/CD Jenkins, SonarQube integration, and Docker containerization. Frontend experience with React, HTML, CSS is preferred."
    }
};

async function testCandidate(candidateName) {
    console.log(`\n==================================================`);
    console.log(`🧪 TESTING CANDIDATE: ${candidateName.toUpperCase()}`);
    console.log(`==================================================`);

    const candidateDir = path.join(__dirname, '..', 'candidates', candidateName);
    const profilePath = path.join(candidateDir, 'profile.json');
    const sentencesPath = path.join(candidateDir, 'sentences.json');
    let candidateResumePath = path.join(candidateDir, 'resume.tex');
    if (!fs.existsSync(candidateResumePath)) {
        candidateResumePath = path.join(candidateDir, 'resume.docx');
    }

    if (!fs.existsSync(profilePath) || !fs.existsSync(sentencesPath) || !fs.existsSync(candidateResumePath)) {
        console.error(`❌ FAILED: Missing configuration files for candidate "${candidateName}" in ${candidateDir}`);
        return false;
    }

    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const sentences = JSON.parse(fs.readFileSync(sentencesPath, 'utf8'));
    const mockData = mockJds[candidateName] || mockJds.deepika;

    console.log(`[Test] Target Role: "${mockData.role}"`);
    console.log(`[Test] Candidate Name: "${profile.name}"`);

    // Allot specific Gemini API Key for each candidate
    const globalKeys = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
    let candidateKey = '';
    if (candidateName.toLowerCase() === 'deepika') {
        candidateKey = globalKeys[0] || '';
    } else if (candidateName.toLowerCase() === 'shilpa') {
        candidateKey = globalKeys[1] || '';
    } else if (candidateName.toLowerCase() === 'yeshwanth') {
        candidateKey = globalKeys[2] || '';
    }

    const originalGeminiKey = process.env.GEMINI_API_KEY;
    if (candidateKey) {
        console.log(`[Test] [${candidateName}] Using allocated Gemini API Key: ${candidateKey.substring(0, 10)}...`);
        process.env.GEMINI_API_KEY = candidateKey;
    }

    try {
        console.log(`[Test] Calling Gemini to generate tailored points...`);
        const aiData = await generateResumePoints(mockData.jd, mockData.role, sentences, profile);
        console.log(`[Test] isFallback: ${aiData.isFallback}`);

        // Verify summary changes
        const summaryObj = aiData.summary || aiData.summary_s1;
        if (summaryObj) {
            console.log(`[Test] Original Summary: "${summaryObj.original.substring(0, 80)}..."`);
            console.log(`[Test] Tailored Summary: "${summaryObj.tailored.substring(0, 80)}..."`);
        }

        console.log(`[Test] Compiling tailored resume to PDF...`);
        const pdfPath = await generateDynamicResume(aiData, candidateResumePath);
        
        if (fs.existsSync(pdfPath)) {
            const size = fs.statSync(pdfPath).size;
            console.log(`✅ SUCCESS: PDF resume created at: ${pdfPath} (Size: ${size} bytes)`);
            
            // Copy to local test output
            const localCopyPath = path.join(__dirname, `test_${candidateName}_tailored.pdf`);
            fs.copyFileSync(pdfPath, localCopyPath);
            console.log(`[Test] Saved local copy to: ${localCopyPath}`);
            
            // Clean up temp pdf file
            fs.unlinkSync(pdfPath);
            return true;
        } else {
            console.error(`❌ FAILED: PDF file was not created.`);
            return false;
        }
    } catch (err) {
        console.error(`❌ FAILED with error:`, err.message);
        return false;
    } finally {
        process.env.GEMINI_API_KEY = originalGeminiKey;
    }
}

(async () => {
    console.log('API Key Status:', process.env.GEMINI_API_KEY ? 'FOUND' : 'MISSING');
    
    const candidates = ['deepika', 'shilpa', 'yeshwanth'];
    let allPassed = true;

    for (const c of candidates) {
        const passed = await testCandidate(c);
        if (!passed) allPassed = false;
    }

    console.log(`\n==================================================`);
    if (allPassed) {
        console.log(`🏆 ALL CANDIDATE TESTS PASSED SUCCESSFULLY!`);
    } else {
        console.error(`🛑 SOME CANDIDATE TESTS FAILED.`);
        process.exit(1);
    }
    console.log(`==================================================`);
})().catch(err => {
    console.error('Test suite failed:', err.message);
    process.exit(1);
});
