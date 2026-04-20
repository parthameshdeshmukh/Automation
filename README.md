# LinkedIn & Gmail Automation System

This project automates the process of finding job posts on LinkedIn, extracting recruiter emails, and sending job applications with resume attachments via Gmail.

## 🚀 Features
- **Scraper**: Uses Playwright to search for LinkedIn posts.
- **Email Extractor**: Regex-based extraction from post content.
- **Gmail Integration**: Automated email sending via Gmail API (OAuth2).

## 🛠️ Setup Instructions

### 1. Prerequisites
- **Node.js** installed on your machine.
- A **Google Cloud Project** with Gmail API enabled.
- A **LinkedIn account**.

### 2. Installation
1. Clone or download this project.
2. Run `npm install` in the project directory.
3. Install Playwright browsers: `npx playwright install chromium`

### 3. Environment Configuration
1. Rename `.env.example` to `.env`.
2. Fill in your **LinkedIn** credentials.
3. Fill in your **Gmail API** credentials:
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Create a project, enable **Gmail API**.
   - Create **OAuth 2.0 Client IDs** (Web application).
   - Authorized redirect URI: `https://developers.google.com/oauthplayground`.
   - Use [OAuth2 Playground](https://developers.google.com/oauthplayground) to get your **Refresh Token**.
     - Select "Gmail API v1" -> `https://www.googleapis.com/auth/gmail.send`.
     - Authorize, Exchange authorization code for tokens.
     - Copy the Refresh Token to `.env`.

### 4. Preparation
- Place a file named `resume.pdf` in the project root directory.
- Update the email body in `main.js` (line 35) with your name and details.

### 5. Running the Project
```bash
node main.js
```

## ⚠️ Security & Ethics Note
- **Login**: If your LinkedIn account has 2FA enabled, the browser will open (non-headless) and you may need to manually enter the code or solve a captcha.
- **Rate Limits**: LinkedIn and Gmail have rate limits. This script includes small delays, but use it responsibly.
- **Anti-Spam**: Only send emails to recruiters who have explicitly shared their email IDs for hiring purposes.
