require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const { generateDynamicResume } = require('../services/compilePdfService');

async function runDiagnostics() {
    console.log('==================================================');
    console.log('🔍 SYSTEM DIAGNOSTICS & DEBUG TOOL STARTING...');
    console.log('==================================================\n');

    let allTestsPassed = true;

    // --- TEST 1: ENVIRONMENT VARIABLES ---
    console.log('[DEBUG] 1. Checking Environment Variables in .env...');
    const requiredEnv = [
        'LINKEDIN_EMAIL', 'LINKEDIN_PASSWORD',
        'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_USER',
        'GOOGLE_SHEETS_ID', 'GEMINI_API_KEY'
    ];
    let missingEnv = [];
    for (const key of requiredEnv) {
        if (!process.env[key]) {
            missingEnv.push(key);
        }
    }
    if (missingEnv.length > 0) {
        console.error(`❌ FAILED: Missing variables in .env: ${missingEnv.join(', ')}`);
        allTestsPassed = false;
    } else {
        console.log('✅ PASSED: All required environment variables are set.');
    }
    console.log('--------------------------------------------------');

    // --- TEST 2: GEMINI API CONNECTION ---
    console.log('[DEBUG] 2. Testing Gemini AI API Connectivity...');
    if (process.env.GEMINI_API_KEY) {
        try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const result = await model.generateContent("Verify connection: Respond with exactly 'Connection verified!'");
            const responseText = result.response.text().trim();
            console.log(`[Gemini Response]: "${responseText}"`);
            if (responseText.toLowerCase().includes('connection verified')) {
                console.log('✅ PASSED: Gemini API is fully operational.');
            } else {
                console.warn('⚠️ WARNING: Gemini responded, but the text was unexpected.');
            }
        } catch (error) {
            console.error('❌ FAILED: Gemini API connection error:', error.message);
            allTestsPassed = false;
        }
    } else {
        console.warn('⚠️ SKIPPED: GEMINI_API_KEY is not defined.');
    }
    console.log('--------------------------------------------------');

    // --- TEST 3: LaTeX PDF COMPILER ---
    console.log('[DEBUG] 3. Checking Local pdflatex Installation...');
    let latexInstalled = false;
    try {
        const { stdout } = await execPromise('pdflatex --version');
        console.log(`[pdflatex version information]:\n${stdout.split('\n')[0]}`);
        console.log('✅ PASSED: pdflatex is installed and accessible in the system PATH.');
        latexInstalled = true;
    } catch (error) {
        console.error('❌ FAILED: pdflatex is not installed or not in PATH.');
        console.error('👉 Make sure MiKTeX (Windows) or TeX Live is installed and added to your environmental variables path.');
        allTestsPassed = false;
    }
    console.log('--------------------------------------------------');

    // --- TEST 4: DYNAMIC LaTeX COMPILATION ---
    console.log('[DEBUG] 4. Testing PDF Resume Compilation...');
    if (latexInstalled) {
        try {
            const dummyData = {
                summary: "This is a test summary for diagnostics.",
                highlightedPoints: [
                    "Point one for diagnostics.",
                    "Point two for diagnostics.",
                    "Point three for diagnostics."
                ],
                skills: {
                    languages: "JavaScript, HTML",
                    frontend: "React",
                    backend: "Node.js",
                    databases: "MongoDB",
                    tools: "Git",
                    concepts: "REST APIs"
                },
                projects: {
                    project1: ["Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5"],
                    project2: ["Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4"],
                    project3: ["Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4"]
                }
            };
            const compiledPath = await generateDynamicResume(dummyData);
            console.log(`[LaTeX Output]: PDF created at ${compiledPath}`);
            if (fs.existsSync(compiledPath)) {
                console.log('✅ PASSED: Resume compiled to PDF successfully.');
                fs.unlinkSync(compiledPath); // cleanup test file
            } else {
                throw new Error("PDF file was not found after compilation finished.");
            }
        } catch (error) {
            console.error('❌ FAILED: LaTeX compilation test failed:', error.message);
            allTestsPassed = false;
        }
    } else {
        console.warn('⚠️ SKIPPED: LaTeX PDF compilation test skipped because pdflatex is not available.');
    }
    console.log('--------------------------------------------------');

    // --- TEST 5: GMAIL OAUTH2 AUTHORIZATION ---
    console.log('[DEBUG] 5. Testing Gmail OAuth2 Credentials...');
    let oauthPassed = false;
    if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN) {
        try {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GMAIL_CLIENT_ID,
                process.env.GMAIL_CLIENT_SECRET,
                'https://developers.google.com/oauthplayground'
            );
            oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
            const tokenResponse = await oauth2Client.getAccessToken();
            if (tokenResponse && tokenResponse.token) {
                console.log('✅ PASSED: Gmail OAuth2 access token retrieved successfully.');
                oauthPassed = true;
            } else {
                throw new Error("No token returned by OAuth client.");
            }
        } catch (error) {
            console.error('❌ FAILED: Gmail OAuth2 error:', error.message);
            console.error('👉 Make sure GMAIL_CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN are correct and not expired.');
            allTestsPassed = false;
        }
    } else {
        console.warn('⚠️ SKIPPED: Gmail OAuth credentials not fully set.');
    }
    console.log('--------------------------------------------------');

    // --- TEST 6: GOOGLE SHEETS API CONNECTION ---
    console.log('[DEBUG] 6. Testing Google Sheets API Read Access...');
    if (oauthPassed && process.env.GOOGLE_SHEETS_ID) {
        try {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GMAIL_CLIENT_ID,
                process.env.GMAIL_CLIENT_SECRET,
                'https://developers.google.com/oauthplayground'
            );
            oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
            const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
            const response = await sheets.spreadsheets.get({
                spreadsheetId: process.env.GOOGLE_SHEETS_ID
            });
            console.log(`[Sheets Response]: Title: "${response.data.properties.title}"`);
            console.log('✅ PASSED: Google Sheets API connection is healthy.');
        } catch (error) {
            console.error('❌ FAILED: Google Sheets API connection error:', error.message);
            allTestsPassed = false;
        }
    } else {
        console.warn('⚠️ SKIPPED: Google Sheets API test skipped (Requires OAuth credentials pass and Sheet ID).');
    }
    console.log('==================================================');
    if (allTestsPassed) {
        console.log('🏆 STATUS: ALL INTEGRATIONS ARE WORKING CORRECTLY!');
        console.log('You can safely run the application now using: npm start');
    } else {
        console.error('🛑 STATUS: SOME CHECKS FAILED. Please resolve errors listed above.');
    }
    console.log('==================================================');
}

runDiagnostics();
