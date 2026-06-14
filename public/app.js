document.addEventListener('DOMContentLoaded', () => {
    // Global data references
    let currentCandidate = null;
    let candidatesData = [];
    let leadsData = [];
    let outreachData = [];
    
    // Elements
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabSections = document.querySelectorAll('.tab-section');
    const refreshBtn = document.getElementById('refresh-btn');
    const pageTitle = document.getElementById('page-title');
    const pageSubtitle = document.getElementById('page-subtitle');
    
    // Stats Elements
    const statsCandidates = document.getElementById('stats-candidates');
    const statsLeads = document.getElementById('stats-leads');
    const statsSent = document.getElementById('stats-sent');
    const statsFailed = document.getElementById('stats-failed');
    const aiProgressBar = document.getElementById('ai-progress');
    const aiCustomizedText = document.getElementById('ai-customized-text');
    const fallbackText = document.getElementById('fallback-text');
    
    // Candidates elements
    const candidatesSelector = document.getElementById('candidates-selector');
    const profilePanel = document.getElementById('candidate-profile-panel');
    const candName = document.getElementById('cand-profile-name');
    const candMeta = document.getElementById('cand-profile-meta');
    const candEmail = document.getElementById('cand-profile-email');
    const candPhone = document.getElementById('cand-profile-phone');
    const candAuth = document.getElementById('cand-profile-auth');
    const candCriteria = document.getElementById('cand-profile-criteria');
    const leadsTableBody = document.getElementById('leads-table-body');
    const searchLeadsInput = document.getElementById('search-leads');
    const clearLeadsBtn = document.getElementById('clear-leads-btn');
    
    // History & Failed elements
    const historyTableBody = document.getElementById('history-table-body');
    const failedTableBody = document.getElementById('failed-table-body');
    const searchHistoryInput = document.getElementById('search-history');
    const searchFailedInput = document.getElementById('search-failed');
    
    // PDF Modal elements
    const pdfModal = document.getElementById('pdf-modal');
    const pdfIframe = document.getElementById('pdf-iframe');
    const closePdfModal = document.getElementById('close-pdf-modal');
    const pdfModalTitle = document.getElementById('pdf-modal-title');

    // --- TAB NAVIGATION ---
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            
            navButtons.forEach(b => b.classList.remove('active'));
            tabSections.forEach(s => s.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`tab-${targetTab}`).classList.add('active');
            
            // Header updates
            if (targetTab === 'overview') {
                pageTitle.textContent = 'Dashboard Overview';
                pageSubtitle.textContent = 'Real-time stats and candidate pipeline monitoring';
            } else if (targetTab === 'candidates') {
                pageTitle.textContent = 'Candidates & Scraped Leads';
                pageSubtitle.textContent = 'Inspect profiles and local lead queues';
            } else if (targetTab === 'history') {
                pageTitle.textContent = 'Outreach History';
                pageSubtitle.textContent = 'Success logs for sent emails';
            } else if (targetTab === 'failed') {
                pageTitle.textContent = 'Failed Delivery Logs';
                pageSubtitle.textContent = 'Review email accounts that hit limits or errored';
            }
        });
    });

    // --- REFRESH ACTION ---
    refreshBtn.addEventListener('click', loadAllData);

    // --- API CALLS & LOAD DATA ---
    async function loadAllData() {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '🔄 Loading...';
        
        try {
            await Promise.all([
                loadCandidates(),
                loadOutreachLogs()
            ]);
            
            // If candidates exist and none is currently selected, select the first one
            if (candidatesData.length > 0 && !currentCandidate) {
                selectCandidate(candidatesData[0]);
            } else if (currentCandidate) {
                // Keep the selection updated
                const updated = candidatesData.find(c => c.name === currentCandidate.name);
                if (updated) selectCandidate(updated);
            }
        } catch (err) {
            console.error('Error loading dashboard data:', err);
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 Refresh Data';
        }
    }

    // Load candidates list
    async function loadCandidates() {
        const res = await fetch('/api/candidates');
        candidatesData = await res.json();
        renderCandidatesList();
        updateGlobalStats();
    }

    // Load history and failed logs
    async function loadOutreachLogs() {
        const res = await fetch('/api/outreach');
        outreachData = await res.json();
        renderHistoryTable();
        renderFailedTable();
        updateGlobalStats();
    }

    // Load specific candidate's leads list
    async function loadCandidateLeads(name) {
        const res = await fetch(`/api/leads?candidate=${encodeURIComponent(name)}`);
        leadsData = await res.json();
        renderLeadsTable();
    }

    // --- RENDER CANDIDATES & STATS ---
    function renderCandidatesList() {
        candidatesSelector.innerHTML = '';
        if (candidatesData.length === 0) {
            candidatesSelector.innerHTML = '<p class="empty-state">No candidates found in candidates/ directory.</p>';
            return;
        }
        
        candidatesData.forEach(c => {
            const item = document.createElement('div');
            item.className = `candidate-item ${currentCandidate && currentCandidate.name === c.name ? 'active' : ''}`;
            
            // Format name nicely (e.g. deepika -> Deepika)
            const capitalizedName = c.name.charAt(0).toUpperCase() + c.name.slice(1);
            
            item.innerHTML = `
                <h4>${capitalizedName}</h4>
                <p>${c.profile.experience || 'N/A'} • ${c.scrapedLeadsCount} leads queued</p>
            `;
            
            item.addEventListener('click', () => selectCandidate(c));
            candidatesSelector.appendChild(item);
        });
    }

    function selectCandidate(candidate) {
        currentCandidate = candidate;
        
        // Highlight active candidate item
        const items = candidatesSelector.querySelectorAll('.candidate-item');
        candidatesSelector.querySelectorAll('.candidate-item').forEach((item, index) => {
            if (candidatesData[index] && candidatesData[index].name === candidate.name) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
        
        // Render profile card details
        profilePanel.style.display = 'block';
        const capitalizedName = candidate.name.charAt(0).toUpperCase() + candidate.name.slice(1);
        candName.textContent = capitalizedName;
        candMeta.textContent = `${candidate.profile.experience || 'N/A'} Experience | ${candidate.profile.location || 'N/A'}`;
        candEmail.textContent = candidate.profile.email || 'N/A';
        candPhone.textContent = candidate.profile.phone || 'N/A';
        candAuth.textContent = candidate.profile.workAuth || 'N/A';
        candCriteria.textContent = (candidate.profile.searchCriteria || []).join('; ') || 'N/A';
        
        // Load the lead queue list for this candidate
        loadCandidateLeads(candidate.name);
    }

    function updateGlobalStats() {
        statsCandidates.textContent = candidatesData.length;
        
        // Sum total leads across all candidates
        const totalLeads = candidatesData.reduce((sum, c) => sum + c.scrapedLeadsCount, 0);
        statsLeads.textContent = totalLeads;
        
        // Outreach logs count
        const sentCount = outreachData.applied ? outreachData.applied.length : 0;
        const failedCount = outreachData.failed ? outreachData.failed.length : 0;
        
        statsSent.textContent = sentCount;
        statsFailed.textContent = failedCount;
        
        // AI customization statistics
        if (sentCount > 0) {
            // Check fallback status on sent items
            const fallbacks = outreachData.applied.filter(item => item.isFallback === true || item.isFallback === 'true').length;
            const customized = sentCount - fallbacks;
            
            const pct = Math.round((customized / sentCount) * 100);
            aiProgressBar.style.width = `${pct}%`;
            
            aiCustomizedText.innerHTML = `<strong>AI Customized:</strong> ${customized} (${pct}%)`;
            fallbackText.innerHTML = `<strong>Static Fallback:</strong> ${fallbacks} (${100 - pct}%)`;
        } else {
            aiProgressBar.style.width = '0%';
            aiCustomizedText.innerHTML = '<strong>AI Customized:</strong> 0 (0%)';
            fallbackText.innerHTML = '<strong>Static Fallback:</strong> 0 (0%)';
        }
    }

    // --- RENDER TABLES ---

    // 1. Leads Table
    function renderLeadsTable() {
        leadsTableBody.innerHTML = '';
        const filterText = searchLeadsInput.value.toLowerCase().trim();
        
        const filtered = leadsData.filter(lead => {
            const email = (lead.email || '').toLowerCase();
            const jd = (lead.jd || '').toLowerCase();
            const kw = (lead.keywords || '').toLowerCase();
            return email.includes(filterText) || jd.includes(filterText) || kw.includes(filterText);
        });
        
        if (filtered.length === 0) {
            leadsTableBody.innerHTML = `<tr><td colspan="4" class="empty-state">No matching scraped leads found in queue.</td></tr>`;
            return;
        }
        
        filtered.forEach((lead, index) => {
            const row = document.createElement('tr');
            
            const emailText = lead.email || 'N/A';
            const keywordsText = lead.keywords || 'N/A';
            const urlText = lead.postUrl && lead.postUrl !== 'Not available' 
                ? `<a href="${lead.postUrl}" target="_blank" class="link-action">Post Link 🔗</a>` 
                : '<span class="badge gray">None</span>';
                
            row.innerHTML = `
                <td><strong>${emailText}</strong></td>
                <td><span class="badge blue">${keywordsText}</span></td>
                <td>${urlText}</td>
                <td>
                    <button class="btn-action" data-toggle="lead-jd-${index}">Expand Job Description 🔽</button>
                    <div id="lead-jd-${index}" class="expandable-jd" style="display: none;">${escapeHtml(lead.jd || 'No description extracted.')}</div>
                </td>
            `;
            
            leadsTableBody.appendChild(row);
        });
        
        // Add expand toggle handlers
        leadsTableBody.querySelectorAll('.btn-action').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-toggle');
                const targetEl = document.getElementById(targetId);
                if (targetEl.style.display === 'none') {
                    targetEl.style.display = 'block';
                    btn.textContent = 'Collapse Job Description 🔼';
                } else {
                    targetEl.style.display = 'none';
                    btn.textContent = 'Expand Job Description 🔽';
                }
            });
        });
    }

    // 2. Outreach History Log Table
    function renderHistoryTable() {
        historyTableBody.innerHTML = '';
        if (!outreachData.applied || outreachData.applied.length === 0) {
            historyTableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No successful outreach events logged yet.</td></tr>`;
            return;
        }
        
        const filterText = searchHistoryInput.value.toLowerCase().trim();
        
        // Filter history list
        const filtered = outreachData.applied.filter(item => {
            const candName = (item.candidate || '').toLowerCase();
            const email = (item.email || '').toLowerCase();
            const jd = (item.jd || '').toLowerCase();
            return candName.includes(filterText) || email.includes(filterText) || jd.includes(filterText);
        });
        
        if (filtered.length === 0) {
            historyTableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No matching sent outreach logs found.</td></tr>`;
            return;
        }
        
        // Reverse array to show newest first
        [...filtered].reverse().forEach((item, index) => {
            const row = document.createElement('tr');
            
            // Format dates
            const dateStr = item.date ? new Date(item.date).toLocaleString() : 'N/A';
            
            // Gemini status badge
            const isFallback = item.isFallback === true || item.isFallback === 'true';
            const apiStatusHtml = isFallback 
                ? '<span class="badge orange">Static / Fallback</span>' 
                : '<span class="badge green">AI Customized</span>';
                
            // Resume PDF link
            const pdfAction = item.pdfPath 
                ? `<button class="btn-action preview-pdf-btn" data-path="${encodeURIComponent(item.pdfPath)}">View PDF 📄</button>` 
                : '<span class="badge gray">None</span>';
                
            const postUrlHtml = item.postUrl && item.postUrl !== 'Not available'
                ? `<a href="${item.postUrl}" target="_blank" class="link-action">Post Link 🔗</a>`
                : '<span class="badge gray">None</span>';
                
            row.innerHTML = `
                <td><span style="color: var(--text-secondary); font-size: 0.8rem">${dateStr}</span></td>
                <td><strong>${item.candidate ? item.candidate.toUpperCase() : 'N/A'}</strong></td>
                <td><strong>${item.email || 'N/A'}</strong></td>
                <td>${apiStatusHtml}</td>
                <td>${postUrlHtml}</td>
                <td>${pdfAction}</td>
                <td>
                    <button class="btn-action" data-toggle="hist-jd-${index}">Expand JD 🔽</button>
                    <div id="hist-jd-${index}" class="expandable-jd" style="display: none;">${escapeHtml(item.jd || 'No details.')}</div>
                </td>
            `;
            
            historyTableBody.appendChild(row);
        });
        
        // Add handlers for PDF buttons
        historyTableBody.querySelectorAll('.preview-pdf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const pdfPath = decodeURIComponent(btn.getAttribute('data-path'));
                openPdfViewer(pdfPath);
            });
        });

        // Add handlers for JD expand
        historyTableBody.querySelectorAll('.btn-action[data-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-toggle');
                const targetEl = document.getElementById(targetId);
                if (targetEl.style.display === 'none') {
                    targetEl.style.display = 'block';
                    btn.textContent = 'Collapse JD 🔼';
                } else {
                    targetEl.style.display = 'none';
                    btn.textContent = 'Expand JD 🔽';
                }
            });
        });
    }

    // 3. Failed Log Table
    function renderFailedTable() {
        failedTableBody.innerHTML = '';
        if (!outreachData.failed || outreachData.failed.length === 0) {
            failedTableBody.innerHTML = `<tr><td colspan="3" class="empty-state">No failed outreach logs registered!</td></tr>`;
            return;
        }
        
        const filterText = searchFailedInput.value.toLowerCase().trim();
        const filtered = outreachData.failed.filter(email => email.toLowerCase().includes(filterText));
        
        if (filtered.length === 0) {
            failedTableBody.innerHTML = `<tr><td colspan="3" class="empty-state">No matching emails found.</td></tr>`;
            return;
        }
        
        filtered.forEach(email => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${email}</strong></td>
                <td><span class="badge red">Failed</span></td>
                <td>
                    <span style="font-size: 0.8rem; color: var(--text-secondary)">
                        Check if the email format is correct, or if the server was blocked/rate-limited by Google SMTP server limits.
                    </span>
                </td>
            `;
            failedTableBody.appendChild(row);
        });
    }

    // --- CLEAR LEADS ACTION ---
    clearLeadsBtn.addEventListener('click', async () => {
        if (!currentCandidate) return;
        const capitalizedName = currentCandidate.name.charAt(0).toUpperCase() + currentCandidate.name.slice(1);
        if (confirm(`Are you sure you want to CLEAR all scraped leads for candidate ${capitalizedName}? This will empty their lead queue.`)) {
            try {
                const res = await fetch(`/api/clear-leads?candidate=${encodeURIComponent(currentCandidate.name)}`, {
                    method: 'POST'
                });
                const result = await res.json();
                if (result.success) {
                    alert(`Lead queue cleared successfully for ${capitalizedName}!`);
                    loadAllData();
                } else {
                    alert(`Failed to clear: ${result.error}`);
                }
            } catch (err) {
                alert(`Error clearing queue: ${err.message}`);
            }
        }
    });

    // --- FILTER SEARCHES ---
    searchLeadsInput.addEventListener('input', renderLeadsTable);
    searchHistoryInput.addEventListener('input', renderHistoryTable);
    searchFailedInput.addEventListener('input', renderFailedTable);

    // --- PDF MODAL CONTROLLER ---
    function openPdfViewer(pdfPath) {
        pdfModalTitle.textContent = `Tailored Resume: ${pdfPath.split('\\').pop().split('/').pop()}`;
        pdfIframe.src = `/api/pdf?file=${encodeURIComponent(pdfPath)}`;
        pdfModal.classList.add('active');
    }

    closePdfModal.addEventListener('click', () => {
        pdfModal.classList.remove('active');
        pdfIframe.src = ''; // Clear iframe contents
    });

    // Close on overlay click
    window.addEventListener('click', (e) => {
        if (e.target === pdfModal) {
            pdfModal.classList.remove('active');
            pdfIframe.src = '';
        }
    });

    // Escaping helper
    function escapeHtml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // --- INITIAL DATA LOAD ---
    loadAllData();
});
