const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Applies targeted text replacements to Deepika_Varma_Resume.docx and
 * exports it as PDF via MS Word COM.
 *
 * Strategy for long strings (> 255 chars — Word COM Find.Text limit):
 *   We do two passes inside PowerShell:
 *   Pass 1 – SHORT strings (≤ 255 chars): use Word COM Selection.Find
 *   Pass 2 – LONG strings  (> 255 chars):  open the .docx as a ZIP,
 *             do plain XML string replacement on word/document.xml,
 *             then let Word open that modified file for PDF export.
 *
 * Only 3 resume sections are ever modified:
 *   1. Professional Summary  (key: summary)
 *   2. Technical Stack rows  (keys: stack_*)
 *   3. Project bullet bodies (keys: project*_bullet*)
 */
function escapeLatex(text) {
    if (typeof text !== 'string') return text;
    
    // Replace backslash first
    let escaped = text.replace(/\\/g, '\\textbackslash{}');
    
    // Escape special symbols: &, %, $, #, _, {, }
    escaped = escaped.replace(/([&%$#_{}])/g, '\\$1');
    
    // Escape tilde and circumflex
    escaped = escaped.replace(/~/g, '\\textasciitilde{}');
    escaped = escaped.replace(/\^/g, '\\textasciicircum{}');
    
    return escaped;
}

async function compileLatexResume(resumeData, templatePath) {
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const uid = Date.now() + '_' + Math.floor(Math.random() * 1000);
    const tempTexPath = path.join(tempDir, `temp_resume_${uid}.tex`).replace(/\\/g, '/');
    const outputDir = tempDir.replace(/\\/g, '/');
    const expectedPdfPath = path.join(tempDir, `temp_resume_${uid}.pdf`).replace(/\\/g, '/');

    // Helper files that pdflatex creates
    const auxPath = path.join(tempDir, `temp_resume_${uid}.aux`).replace(/\\/g, '/');
    const logPath = path.join(tempDir, `temp_resume_${uid}.log`).replace(/\\/g, '/');
    const outPath = path.join(tempDir, `temp_resume_${uid}.out`).replace(/\\/g, '/');

    try {
        let latexContent = fs.readFileSync(templatePath, 'utf8');

        for (const key in resumeData) {
            if (key === 'isFallback') continue;
            const valueObj = resumeData[key];
            let replacementText = valueObj.tailored || valueObj.original || '';

            // Escape LaTeX special characters
            replacementText = escapeLatex(replacementText);

            // Special handling for skills prefix bolding
            if (key.startsWith('skills_') && replacementText.includes(':')) {
                const colonIndex = replacementText.indexOf(':');
                const prefix = replacementText.substring(0, colonIndex).trim();
                const rest = replacementText.substring(colonIndex + 1).trim();
                replacementText = `\\textbf{${prefix}:} ${rest}`;
            }

            const placeholder = `{{${key}}}`;
            latexContent = latexContent.split(placeholder).join(replacementText);
        }

        fs.writeFileSync(tempTexPath, latexContent, 'utf8');

        console.log(`[LaTeX-Automation] Compiling PDF via pdflatex (${path.basename(expectedPdfPath)})...`);
        
        // Execute pdflatex command in nonstopmode
        const cmd = `pdflatex -interaction=nonstopmode -output-directory="${outputDir}" "${tempTexPath}"`;
        const { stdout, stderr } = await execPromise(cmd, { maxBuffer: 1024 * 1024 * 10 });
        
        if (stdout) {
            console.log('[LaTeX-Automation] stdout:\n' + stdout.trim());
        }
        if (stderr) {
            console.warn('[LaTeX-Automation] stderr:\n' + stderr.trim());
        }

        if (!fs.existsSync(expectedPdfPath)) {
            if (fs.existsSync(logPath)) {
                console.error('[LaTeX-Automation] pdflatex compilation failed. Log file content:\n' + fs.readFileSync(logPath, 'utf8'));
            }
            throw new Error('PDF was not created - check pdflatex logs.');
        }

        return expectedPdfPath;

    } catch (error) {
        if (fs.existsSync(logPath)) {
            console.error('[LaTeX-Automation] pdflatex log output on error:\n' + fs.readFileSync(logPath, 'utf8'));
        }
        console.error('[LaTeX-Automation] Error compiling PDF:', error.message);
        throw error;
    } finally {
        // Clean up temporary files
        [tempTexPath, auxPath, logPath, outPath].forEach(f => {
            try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
        });
    }
}

/**
 * Applies targeted text replacements to Deepika_Varma_Resume.docx and
 * exports it as PDF via MS Word COM. Or compiles a LaTeX template if .tex.
 */
async function generateDynamicResume(resumeData, resumeTemplatePath = null) {
    const inputDocxPath = path.resolve(
        (resumeTemplatePath || process.env.RESUME_PATH || './Deepika_Varma_Resume.docx').replace(/^"|"$/g, '')
    );
    if (!fs.existsSync(inputDocxPath)) {
        throw new Error(`Original resume not found at: ${inputDocxPath}`);
    }

    if (inputDocxPath.endsWith('.tex')) {
        return compileLatexResume(resumeData, inputDocxPath);
    }

    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const uid           = Date.now() + '_' + Math.floor(Math.random() * 1000);
    const tempDocxPath  = path.join(tempDir, `temp_resume_${uid}.docx`);
    const outputPdfPath = path.join(tempDir, `temp_resume_${uid}.pdf`);
    const jsonPath      = path.join(tempDir, `temp_sentences_${uid}.json`);
    const ps1Path       = path.join(tempDir, `compile_docx_${uid}.ps1`);


    try {
        // Normalize newlines to vertical tabs (\v) for Word COM compatibility
        const normalizedData = {};
        for (const key in resumeData) {
            if (key === 'isFallback') {
                normalizedData[key] = resumeData[key];
                continue;
            }
            normalizedData[key] = {
                original: resumeData[key].original ? resumeData[key].original.replace(/\r?\n/g, '\v') : '',
                tailored: resumeData[key].tailored ? resumeData[key].tailored.replace(/\r?\n/g, '\v') : ''
            };
        }
        fs.writeFileSync(jsonPath, JSON.stringify(normalizedData, null, 2), 'utf8');

        const srcEsc  = inputDocxPath.replace(/\\/g, '\\\\');
        const tmpEsc  = tempDocxPath.replace(/\\/g, '\\\\');
        const pdfEsc  = outputPdfPath.replace(/\\/g, '\\\\');
        const jsonEsc = jsonPath.replace(/\\/g, '\\\\');

        // ── PowerShell script ───────────────────────────────────────────────
        const ps = `
$ErrorActionPreference = 'Stop'

$srcPath  = "${srcEsc}"
$tmpPath  = "${tmpEsc}"
$pdfPath  = "${pdfEsc}"
$jsonPath = "${jsonEsc}"

# ─── Load replacement map ───────────────────────────────────────────────────
$map = Get-Content -Raw -Path $jsonPath | ConvertFrom-Json

# Copy original to temp docx
Copy-Item $srcPath $tmpPath -Force

function Normalize-Quotes($s) {
    $s = $s -replace [char]0x2018, "'"
    $s = $s -replace [char]0x2019, "'"
    $s = $s -replace [char]0x201C, '"'
    $s = $s -replace [char]0x201D, '"'
    return $s
}

$word = $null
$doc = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible       = $false
    $word.DisplayAlerts = 0

    $doc = $word.Documents.Open($tmpPath)

    Write-Host "[Compile] Applying replacements via paragraph-based Word COM..."

    foreach ($prop in $map.PSObject.Properties) {
        if ($prop.Name -eq 'isFallback') { continue }
        $orig = $prop.Value.original
        $tail = $prop.Value.tailored
        if ([string]::IsNullOrWhiteSpace($orig)) { continue }
        if ($orig -eq $tail) { continue }   # skip unchanged

        # Normalize quotes in find text
        $findText = Normalize-Quotes $orig
        
        # Search for a unique prefix under 150 characters, stopping before the first vertical tab
        $searchLen = [Math]::Min(150, $findText.Length)
        $firstTabIdx = $findText.IndexOf([char]11)
        if ($firstTabIdx -ge 0 -and $firstTabIdx -lt $searchLen) {
            $searchLen = $firstTabIdx
        }
        if ($searchLen -eq 0) {
            $searchLen = [Math]::Min(150, $findText.Length)
        }
        $uniquePrefix = $findText.Substring(0, $searchLen)

        $word.Selection.HomeKey(6)   # wdStory
        $f = $word.Selection.Find
        $f.ClearFormatting()
        $f.Text           = $uniquePrefix
        $f.Forward        = $true
        $f.Wrap           = 0
        $f.MatchCase      = $false
        $f.MatchWholeWord = $false

        if ($f.Execute()) {
            $range = $word.Selection.Paragraphs.Item(1).Range
            $range.End = $range.End - 1  # Exclude trailing paragraph/cell mark
            $range.Text = $tail
            Write-Host "  [COM-Replace] Replaced: $($uniquePrefix.Substring(0,[Math]::Min(60,$uniquePrefix.Length)))..."
        } else {
            Write-Host "  [COM-Replace] WARNING no match found for prefix: $($uniquePrefix.Substring(0,[Math]::Min(60,$uniquePrefix.Length)))..."
        }
    }

    # Export to PDF
    $doc.SaveAs([ref]$pdfPath, [ref]17)   # wdFormatPDF = 17
    Write-Host "[Compile] PDF exported → $pdfPath"
} finally {
    if ($doc -ne $null) {
        $doc.Close([ref]0)                 # wdDoNotSaveChanges
    }
    if ($word -ne $null) {
        $word.Quit()
    }
}
`;

        fs.writeFileSync(ps1Path, ps, 'utf8');

        console.log(`[Word-Automation] Compiling PDF (${path.basename(outputPdfPath)})...`);
        const { stdout, stderr } = await execPromise(
            `powershell -ExecutionPolicy Bypass -File "${ps1Path}"`,
            { maxBuffer: 1024 * 1024 * 10 }
        );
        if (stdout) console.log('[Word-Automation]\n' + stdout.trim());
        if (stderr) console.warn('[Word-Automation] stderr:\n' + stderr.trim());

        if (!fs.existsSync(outputPdfPath)) {
            throw new Error('PDF was not created — check Word COM logs above.');
        }

        return outputPdfPath;

    } catch (error) {
        console.error('[Word-Automation] Error compiling PDF:', error.message);
        throw error;
    } finally {
        [tempDocxPath, jsonPath, ps1Path].forEach(f => {
            try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
        });
    }
}

module.exports = { generateDynamicResume };
