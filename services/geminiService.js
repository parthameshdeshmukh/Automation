const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// ============================================================
// EXACT TEXT FROM Deepika_Varma_Resume.docx
// These strings are used as "find" targets in the Word COM automation.
// They MUST match character-for-character with the .docx content.
// ============================================================
const ORIGINAL_RESUME_SENTENCES = {

    // ── SECTION 1: PROFESSIONAL SUMMARY (Paragraph 4) ──────────────────────
    // Only this one paragraph is the "summary" that gets rewritten.
    summary: "Results-driven Full Stack Developer with 4+ years of hands-on experience designing, developing, and deploying scalable, secure, and cloud-native applications. Strong expertise in Python-based backend systems, modern frontend frameworks, microservices architecture, and DevOps automation.",

    // ── SECTION 2: TECHNICAL STACK – Technologies column only ───────────────
    // Domain column ("Backend", "Frontend", etc.) is NEVER touched.
    // Only the Technologies values are replaced.
    stack_backend:   "Python, Flask, FastAPI, REST, Microservices, OOP, AsyncIO",
    stack_frontend:  "React, Angular, JS (ES6+), HTML5, CSS3, REST Integration",
    stack_db:        "PostgreSQL, MySQL, MongoDB, Redis, Alembic",
    stack_cloudops:  "AWS (EC2, S3, RDS, Lambda, ECS), Docker, Kubernetes (basics), Terraform, CI/CD",
    stack_messaging: "Kafka, Event-Driven Architecture",
    stack_testing:   "Pytest, Unittest, JUnit, Postman",
    stack_tools:     "Git, GitHub Actions, Jenkins, Swagger",
    stack_security:  "OAuth2, JWT, OWASP, ELK, Prometheus, Grafana, CloudWatch",

    // ── SECTION 3: PROJECT SUMMARIES (bullet bodies only) ───────────────────
    // Project headings (Paragraph 92 / 97) are NEVER changed.
    // Only the 4 bullet sentences under each project are rewritten.
    // Project 1 – E-Commerce Order Management Platform
    project1_bullet1: "Developed backend product features for order, payment, and shipment services using Java, Golang, and Python (Flask), deploying containerized microservices via Docker and ECS with Terraform, following Infrastructure as Code best practices.",
    project1_bullet2: "Architected asynchronous workflows using Redis queues and Apache Kafka to enable real-time fraud detection, payment confirmations, and inventory updates, mirroring Forage\u2019s need for resilient, decoupled systems at scale.",
    project1_bullet3: "Designed and version-controlled PostgreSQL schemas with Alembic, leveraging indexed read-heavy queries and Redis caching to reduce checkout flow latency by 45% during peak traffic.",
    project1_bullet4: "Instrumented service health and performance observability using Prometheus and Grafana, contributing to on-call rotation readiness and ensuring uptime across core transactional APIs.",

    // Project 2 – Community Connect – Blockchain App
    project2_bullet1: "Developed decentralized Ethereum-based smart contracts using Solidity and Truffle to manage user authentication, group memberships, and token-based reward systems.",
    project2_bullet2: "Built a responsive front-end using React and Web3.js, integrating MetaMask to securely handle wallet-based login, transaction signing, and on-chain user interactions.",
    project2_bullet3: "Enabled group forums and event announcements through smart contract state updates, allowing tamper-proof public posting.",
    project2_bullet4: "Conducted end-to-end deployment and testing on Ethereum ensuring gas optimization and contract reliability."
};

// ── FALLBACK: returns original text unchanged ────────────────────────────────
// ── FALLBACK: returns original text unchanged ────────────────────────────────
function getFallbackSentences(originalSentences = ORIGINAL_RESUME_SENTENCES) {
    const result = { isFallback: true };
    for (const key in originalSentences) {
        result[key] = {
            original: originalSentences[key],
            tailored: originalSentences[key]
        };
    }
    return result;
}

// ── SLEEP helper ─────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── RETRY wrapper with exponential back-off ──────────────────────────────────
async function callGeminiWithRetry(model, prompt, maxRetries = 4) {
    let attempt = 0;
    while (attempt <= maxRetries) {
        try {
            const result = await model.generateContent(prompt);
            return result;
        } catch (err) {
            const isDailyQuotaExceeded = err.message && 
                err.message.toLowerCase().includes('quota') && 
                (err.message.toLowerCase().includes('day') || err.message.toLowerCase().includes('daily'));
            if (isDailyQuotaExceeded) {
                console.warn(`[Gemini] Daily quota exceeded. Failing fast to trigger model fallback...`);
                throw err;
            }

            const is429 = err.message && err.message.includes('429');
            // Extract retry-after from error message if present
            const retryMatch = err.message && err.message.match(/retry in (\d+(?:\.\d+)?)s/i);
            const retryAfterMs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) * 1000 : 0;

            if (is429 && attempt < maxRetries) {
                const backoffMs = retryAfterMs > 0
                    ? retryAfterMs + 2000                       // honour server hint + 2s buffer
                    : Math.min(60000, 5000 * Math.pow(2, attempt)); // 5s, 10s, 20s, 40s, 60s cap

                console.warn(`[Gemini] Rate-limited (429). Waiting ${Math.round(backoffMs / 1000)}s before retry ${attempt + 1}/${maxRetries}...`);
                await sleep(backoffMs);
                attempt++;
            } else {
                throw err; // non-429 or exhausted retries
            }
        }
    }
}

// ── API Key Rotation and Initialization ─────────────────────────────────────
let currentKeyIndex = 0;

// ── Unified fallback caller with key rotation ──────────────────────────────
async function callGeminiWithFallback(prompt, isJson = false, maxRetries = 2) {
    const apiKeysList = process.env.GEMINI_API_KEY 
        ? process.env.GEMINI_API_KEY.split(',').map(k => k.trim()).filter(k => k.length > 0)
        : [];
        
    if (apiKeysList.length === 0) {
        throw new Error('GoogleGenerativeAI is not initialized (GEMINI_API_KEY is missing).');
    }

    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const modelsToTry = [modelName, 'gemini-2.5-flash', 'gemini-flash-latest'];
    
    let lastError = null;

    // Loop over the API keys starting from the current index, up to apiKeysList.length attempts
    for (let kAttempt = 0; kAttempt < apiKeysList.length; kAttempt++) {
        const activeKey = apiKeysList[currentKeyIndex];
        const client = new GoogleGenerativeAI(activeKey);

        for (const mName of modelsToTry) {
            try {
                console.log(`[Gemini] Calling model: ${mName} using key index ${currentKeyIndex}...`);
                const modelConfig = { model: mName };
                if (isJson) {
                    modelConfig.generationConfig = { responseMimeType: 'application/json' };
                }
                const model = client.getGenerativeModel(modelConfig);
                const result = await callGeminiWithRetry(model, prompt, maxRetries);
                return result.response.text().trim();
            } catch (err) {
                lastError = err;
                const isQuota = err.message && err.message.toLowerCase().includes('quota');
                if (isQuota) {
                    console.warn(`[Gemini] Model ${mName} hit rate limit/quota using key index ${currentKeyIndex}.`);
                    break; // break the model loop to try the next API key!
                } else {
                    throw err; // non-quota error, fail immediately
                }
            }
        }

        // If we broke out of the model loop due to quota/rate limit, rotate the API key index
        if (apiKeysList.length > 1) {
            currentKeyIndex = (currentKeyIndex + 1) % apiKeysList.length;
            console.log(`[Gemini] Quota/limit hit. Rotated to next API key index: ${currentKeyIndex}`);
        }
    }
    throw lastError; // if all keys/models failed, throw the last error
}

// ── MAIN EXPORT: generateResumePoints ────────────────────────────────────────
async function generateResumePoints(jobDescription, roleName = 'Software Engineer', originalSentences = ORIGINAL_RESUME_SENTENCES, candidateProfile = null) {
    if (!process.env.GEMINI_API_KEY) {
        console.warn('[Gemini] No GEMINI_API_KEY found in .env. Returning fallback sentences.');
        return getFallbackSentences(originalSentences);
    }

    const profile = candidateProfile || {
        name: "Deepika Varma",
        experience: "4+ years",
        workAuth: "Green Card / EAD"
    };

    try {
        // ── DYNAMIC PROMPT DESIGN ────────────────────────────────────────────
        const promptKeys = Object.keys(originalSentences).map(k => `  "${k}": "..."`).join(',\n');
        
        let prompt = `
You are an expert technical resume writer specializing in US staffing/consulting submissions.
The candidate is ${profile.name} – with ${profile.experience} of experience, work authorization: ${profile.workAuth}.

TARGET ROLE: "${roleName}"

JOB DESCRIPTION:
"""
${jobDescription}
"""

TASK — Make ONLY the following changes to tailor the candidate's resume content to this job description. Do NOT change anything else:

We have selected specific sections of their resume to replace. You must return tailored versions for EACH key in the JSON below.

=== RESUME SECTIONS TO TAILOR ===
`;

        for (const key in originalSentences) {
            prompt += `\nKey: "${key}"\nOriginal Content: "${originalSentences[key]}"\n`;
        }

        prompt += `
=== GENERAL RULES ===
- For each section, rewrite the content to emphasize the skills, keywords, and outcomes most relevant to the Job Description.
- Stay within the candidate's real background and technologies; do NOT hallucinate niche frameworks or skills they do not have.
- Maintain the approximate length and structure of the original sentence (e.g. if the original is a single sentence, the tailored version must be a single sentence).
- Do NOT use double-quotes inside any string value (use single quotes if needed).

OUTPUT FORMAT — return ONLY a raw JSON object matching this exact schema:
{
${promptKeys}
}

Do NOT wrap in markdown fences. Do NOT include any other text outside the JSON.
`;

        const responseTextRaw = await callGeminiWithFallback(prompt, true, 4);
        let responseText = responseTextRaw;

        // Strip markdown fences if model wraps anyway
        if (responseText.startsWith('```')) {
            responseText = responseText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
        }

        const data = JSON.parse(responseText);
        const resultObject = { isFallback: false };

        for (const key in originalSentences) {
            const tailoredValue = data[key];
            resultObject[key] = {
                original: originalSentences[key],
                // If Gemini returned a value, use it; otherwise fall back to original
                tailored: tailoredValue
                    ? tailoredValue.trim().replace(/^"|"$/g, '')
                    : originalSentences[key]
            };
        }

        console.log(`[Gemini] ✅ Successfully tailored resume for role: "${roleName}"`);
        return resultObject;

    } catch (error) {
        console.error(`[Gemini] ❌ Error tailoring resume for "${roleName}", using fallback:`, error.message);
        return getFallbackSentences(originalSentences);
    }
}

// ── generateQuestionAnswer ────────────────────────────────────────────────────
async function generateQuestionAnswer(questionText, jobDescription, profile) {
    if (!process.env.GEMINI_API_KEY) {
        console.warn('[Gemini] No GEMINI_API_KEY found. Returning generic fallback.');
        return 'I am excited about this opportunity and my experience in software development aligns well with the requirements of this role.';
    }

    try {
        const prompt = `
You are a job applicant filling out a job application.
Candidate Details:
- Name: ${profile.firstName} ${profile.lastName}
- Email: ${profile.email}
- Phone: ${profile.phone}
- LinkedIn: ${profile.linkedin}
- Experience: ${process.env.CANDIDATE_EXPERIENCE || '4+ years'}
- Work Authorization: ${process.env.CANDIDATE_WORK_AUTH || 'Green Card / EAD'}

Job Description:
"""
${jobDescription}
"""

Application Question:
"${questionText}"

Write a concise, professional, and convincing answer to this question from the first-person perspective of the candidate.
Keep the response brief, ideally between 2 and 4 sentences.
Do NOT include any formatting tags, markdown, greetings, or sign-offs. Return ONLY the plain text answer.
`;

        const responseText = await callGeminiWithFallback(prompt, false, 2);
        return responseText;
    } catch (err) {
        console.error('[Gemini] Error generating custom question answer:', err.message);
        return `I am highly interested in this opportunity. My background in software engineering, specifically in building robust applications with modern technologies, aligns well with the skills sought for this position.`;
    }
}

// ── selectOptionFromDropdown ──────────────────────────────────────────────────
async function selectOptionFromDropdown(questionText, optionsList, profile) {
    if (!process.env.GEMINI_API_KEY) {
        console.warn('[Gemini] No GEMINI_API_KEY found. Returning first option as fallback.');
        return 0;
    }

    try {
        const prompt = `
You are an AI assistant helping a candidate autofill a job application form.
Candidate Details:
- Name: ${profile.firstName} ${profile.lastName}
- Email: ${profile.email}
- Phone: ${profile.phone}
- Work Authorization: ${process.env.CANDIDATE_WORK_AUTH || 'Green Card / EAD'}
- Experience: ${process.env.CANDIDATE_EXPERIENCE || '4+ years'}

The form has a question or dropdown labeled: "${questionText}"
The available options are:
${optionsList.map((opt, idx) => `${idx}: "${opt}"`).join('\n')}

Based on the candidate's profile, select the most appropriate option.
Output ONLY the index number (e.g. 0, 1, 2) of the chosen option. Do not include any other text, explanation, or punctuation.
`;

        const responseText = await callGeminiWithFallback(prompt, false, 2);
        const match = responseText.match(/\d+/);
        if (match) {
            const idx = parseInt(match[0], 10);
            if (idx >= 0 && idx < optionsList.length) return idx;
        }
        return 0;
    } catch (err) {
        console.error('[Gemini] Error choosing option:', err.message);
        return 0;
    }
}

module.exports = {
    generateResumePoints,
    generateQuestionAnswer,
    selectOptionFromDropdown
};
