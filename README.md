# Automated HR Outreach & Acquisition Pipeline

> A high-performance Node.js automation system that completely bypasses traditional Applicant Tracking Systems (ATS) by intelligently scraping live LinkedIn feeds, extracting direct recruiter contacts, and securely executing targeted email outreach.

![Project Status](https://img.shields.io/badge/Status-Active-success)
![Nodejs](https://img.shields.io/badge/Node.js-v18+-green)
![Playwright](https://img.shields.io/badge/Playwright-Stealth-blue)

## 📌 The Problem
The standard job application model is highly inefficient. Candidates spend hours searching the crowded "Jobs" board, applying through black-box systems, and waiting weeks for a response—often losing out to candidates who applied days earlier.

## 🚀 The Solution
This project flips the model. Instead of relying on crowded job boards, this system actively monitors the live LinkedIn timeline for recruiters urgently looking to hire. It extracts their direct contact information and instantly executes a personalized application via Gmail. By automating this, the candidate becomes Applicant #1 directly in the recruiter's inbox.

---

## 🏗️ Technical Architecture & Flow

This pipeline is broken into 5 distinct, resilient phases:

1. **Authentication Phase (Stealth):** Uses Playwright with persistent cookie-based sessions (`userDataDir`) to securely bypass login screens and 2FA, mimicking a human opening their browser.
2. **Teleport & Infinite Scroll Phase:** Constructs highly filtered, direct query URLs (e.g., `"Java Contract" + Past 24 Hours`). Safely scrolls the timeline using randomized human-like delays and complex DOM height calculations to detect the end of the feed.
3. **Regex Extraction & Sanitization Phase:** Scrapes raw DOM text and utilizes Regular Expressions to extract hidden emails from posts. Crucially, it filters out noise—excluding generic support emails or posts containing candidate phrases (e.g., "looking for a job").
4. **Execution Phase (OAuth 2.0):** Connects to the Gmail API via OAuth 2.0 (ensuring passwords are never stored) to compose tailored emails and attach local PDF resumes.
5. **Database & Safety Phase (Idempotency):** Writes successful contacts to a local JSON Database (`sent_history.json`). This ensures the script aggressively prevents duplicate messaging and correctly handles rate-limiting queues (`failed_emails.json`).

---

## 🔥 Key Features

* **Advanced Anti-Bot Evasion:** Uses `puppeteer-extra-plugin-stealth`, randomized human delays, and cookie injections to prevent shadow-banning.
* **Smart Context Filtering:** Doesn't just blindly scrape. Built-in algorithms ignore generic company emails and competitors.
* **Safe Delivery with OAuth 2.0:** Uses strict modern security protocols (Refresh Tokens) rather than insecure App Passwords to handle email execution.
* **Anti-Spam Architecture:** Local database tracks outreach history, so the script can safely run repeatedly without spamming the same HR manager twice.
* **Error Resilience:** Features a retry queue mechanism to gracefully catch network or rate-limit errors and prevent process crashes.

---

## 🛠️ Setup Instructions

### 1. Prerequisites
- **Node.js** installed on your machine.
- A **Google Cloud Project** with Gmail API enabled.
- A **LinkedIn account**.

### 2. Installation
```bash
# 1. Install dependencies
npm install

# 2. Install Playwright chromium browser
npx playwright install chromium
```

### 3. Environment Configuration
Create a `.env` file in the root directory based on `.env.example`:
```env
LINKEDIN_EMAIL=your_email@gmail.com
LINKEDIN_PASSWORD=your_password

# Search configuration
SEARCH_KEYWORDS="Java Developer Contract"

# Gmail API OAuth 2.0 configuration
GMAIL_USER=your_email@gmail.com
GMAIL_CLIENT_ID=your_client_id
GMAIL_CLIENT_SECRET=your_client_secret
GMAIL_REFRESH_TOKEN=your_refresh_token
```
*Note: Use the [Google OAuth2 Playground](https://developers.google.com/oauthplayground) to securely generate your Refresh Token with `https://www.googleapis.com/auth/gmail.send` scope.*

### 4. Running the System
Place your resume as `resume.pdf` in the root folder, then execute:
```bash
node main.js
```

---

## ⚠️ Security & Ethics Considerations
* **Rate Limits:** Both LinkedIn and Google have daily operational limits. The script has built-in delays (10+ seconds between emails) to abide by these constraints safely.
* **No Spam:** The regex and sanitization phases are strictly designed to only extract emails from people actively asking for resumes.
