
$ErrorActionPreference = 'Stop'

$srcPath  = "C:\\Users\\prath\\OneDrive\\Desktop\\JP IT Task\\Assesment 2\\candidates\\deepika\\resume.docx"
$tmpPath  = "C:\\Users\\prath\\OneDrive\\Desktop\\JP IT Task\\Assesment 2\\temp\\temp_resume_1781550252349_759.docx"
$pdfPath  = "C:\\Users\\prath\\OneDrive\\Desktop\\JP IT Task\\Assesment 2\\temp\\temp_resume_1781550252349_759.pdf"
$jsonPath = "C:\\Users\\prath\\OneDrive\\Desktop\\JP IT Task\\Assesment 2\\temp\\temp_sentences_1781550252349_759.json"

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
