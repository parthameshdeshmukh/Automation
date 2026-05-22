const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Replaces the placeholders in the LaTeX template and compiles it to PDF.
 */
async function generateDynamicResume(resumeData) {
    const templatePath = path.join(__dirname, '..', 'resume_template.tex');
    const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 1000);
    const tempTexFileName = `temp_resume_${uniqueId}.tex`;
    const tempPdfFileName = `temp_resume_${uniqueId}.pdf`;
    
    const tempTexPath = path.join(__dirname, '..', tempTexFileName);
    const outputPdfPath = path.join(__dirname, '..', tempPdfFileName);

    try {
        let texContent = fs.readFileSync(templatePath, 'utf8');

        // Escape LaTeX special characters in the points
        const escapeLatex = (str) => {
            if (!str) return '';
            return str.replace(/\\/g, '\\textbackslash{}')
                      .replace(/([&%$#_{}])/g, '\\$1')
                      .replace(/~/g, '\\textasciitilde{}')
                      .replace(/\^/g, '\\textasciicircum{}');
        };

        // Format points/bullet arrays for LaTeX itemize
        const formatBulletList = (pointsArray) => {
            if (!Array.isArray(pointsArray)) return '';
            return pointsArray.map(p => `\\resumeItem{${escapeLatex(p)}}`).join('\n');
        };

        // Replace placeholders
        texContent = texContent.replace('{{DYNAMIC_SUMMARY}}', escapeLatex(resumeData.summary));
        texContent = texContent.replace('{{DYNAMIC_POINTS}}', formatBulletList(resumeData.highlightedPoints));
        
        // Skills placeholders
        const skills = resumeData.skills || {};
        texContent = texContent.replace('{{DYNAMIC_LANGUAGES}}', escapeLatex(skills.languages));
        texContent = texContent.replace('{{DYNAMIC_FRONTEND}}', escapeLatex(skills.frontend));
        texContent = texContent.replace('{{DYNAMIC_BACKEND}}', escapeLatex(skills.backend));
        texContent = texContent.replace('{{DYNAMIC_DATABASES}}', escapeLatex(skills.databases));
        texContent = texContent.replace('{{DYNAMIC_TOOLS}}', escapeLatex(skills.tools));
        texContent = texContent.replace('{{DYNAMIC_CONCEPTS}}', escapeLatex(skills.concepts));

        // Projects placeholders
        const projects = resumeData.projects || {};
        texContent = texContent.replace('{{DYNAMIC_PROJECT1_POINTS}}', formatBulletList(projects.project1));
        texContent = texContent.replace('{{DYNAMIC_PROJECT2_POINTS}}', formatBulletList(projects.project2));
        texContent = texContent.replace('{{DYNAMIC_PROJECT3_POINTS}}', formatBulletList(projects.project3));

        // Write to temp file
        fs.writeFileSync(tempTexPath, texContent);

        // Compile using local pdflatex (requires MiKTeX or TeX Live installed)
        console.log(`[LaTeX] Compiling dynamic resume PDF (${tempPdfFileName})...`);
        await execPromise(`pdflatex -interaction=nonstopmode ${tempTexFileName}`, { cwd: path.join(__dirname, '..') });

        // Cleanup temp tex file and auxiliary files
        if (fs.existsSync(tempTexPath)) {
            fs.unlinkSync(tempTexPath);
        }
        const auxFiles = ['.aux', '.log', '.out'].map(ext => path.join(__dirname, '..', `temp_resume_${uniqueId}${ext}`));
        auxFiles.forEach(file => { if (fs.existsSync(file)) fs.unlinkSync(file); });

        return outputPdfPath;
    } catch (error) {
        console.error('[LaTeX] Error compiling PDF:', error.message);
        // Ensure cleanup of temp files even on error
        if (fs.existsSync(tempTexPath)) {
            try { fs.unlinkSync(tempTexPath); } catch (_) {}
        }
        const auxFiles = ['.aux', '.log', '.out'].map(ext => path.join(__dirname, '..', `temp_resume_${uniqueId}${ext}`));
        auxFiles.forEach(file => { if (fs.existsSync(file)) { try { fs.unlinkSync(file); } catch (_) {} } });
        
        throw new Error("LaTeX compilation failed. Please ensure MiKTeX is installed and added to PATH.");
    }
}

module.exports = { generateDynamicResume };
