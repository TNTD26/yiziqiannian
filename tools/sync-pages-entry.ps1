# Sync the three entry files after editing START.html.
#
#   START.html      - source of truth (ship copy #1)
#   <alias>.html    - byte-identical copy of START.html (ship copy #2)
#   index.html      - START.html + the PAGES-OG block (GitHub Pages entry)
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\sync-pages-entry.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\sync-pages-entry.ps1 -Check
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less scripts as ANSI.

param([switch]$Check)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Text([string]$p) { [IO.File]::ReadAllText($p, $utf8) }
function Write-Text([string]$p, [string]$t) { [IO.File]::WriteAllText($p, $t, $utf8) }
function Hash-Bytes([string]$p) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($p))) }
    finally { $sha.Dispose() }
}

$startPath = Join-Path $root 'START.html'
$indexPath = Join-Path $root 'index.html'
if (-not (Test-Path -LiteralPath $startPath)) { throw "START.html not found under $root" }
if (-not (Test-Path -LiteralPath $indexPath)) { throw "index.html not found under $root" }

# The alias is the only other .html at the repo root (its filename is non-ASCII).
$aliasCandidates = @(Get-ChildItem -LiteralPath $root -Filter '*.html' -File |
    Where-Object { $_.Name -ne 'START.html' -and $_.Name -ne 'index.html' })
if ($aliasCandidates.Count -ne 1) {
    throw ("expected exactly 1 alias html at repo root, found {0}: {1}" -f
        $aliasCandidates.Count, ($aliasCandidates.Name -join ', '))
}
$aliasPath = $aliasCandidates[0].FullName

$start = Read-Text $startPath
$index = Read-Text $indexPath

# 1) alias must be byte-identical to START.html
$aliasSame = (Hash-Bytes $startPath) -eq (Hash-Bytes $aliasPath)

# 2) rebuild index.html = START.html + the marked PAGES-OG block
$m = [regex]::Match($index, '(?s)  <!-- PAGES-OG:BEGIN.*?<!-- PAGES-OG:END -->\r?\n')
if (-not $m.Success) { throw 'index.html is missing the PAGES-OG:BEGIN / PAGES-OG:END block' }
$block = $m.Value

$anchor = '  <meta property="og:type" content="website">'
$anchorPattern = [regex]::Escape($anchor) + '(\r?\n)'
if ($start -notmatch $anchorPattern) { throw "anchor line not found in START.html: $anchor" }

# keep START.html's own line-ending style for the injected block
$eol = if ($start.Contains("`r`n")) { "`r`n" } else { "`n" }
$block = ($m.Value -replace "`r`n", "`n").Replace("`n", $eol)

$expectedIndex = [regex]::Replace($start, $anchorPattern, {
        param($mm)
        $mm.Groups[1].Value + $mm.Groups[2].Value + $block
    }, 1)

$indexSame = ($expectedIndex -eq $index)

Write-Host ("alias ({0}): {1}" -f $aliasCandidates[0].Name, $(if ($aliasSame) { 'in sync' } else { 'OUT OF SYNC' }))
Write-Host ("index (index.html): {0}" -f $(if ($indexSame) { 'in sync' } else { 'OUT OF SYNC' }))

if ($Check) {
    if ($aliasSame -and $indexSame) { Write-Host 'OK'; exit 0 }
    Write-Host 'FAILED' -ForegroundColor Red
    exit 1
}

if (-not $aliasSame) {
    [IO.File]::WriteAllBytes($aliasPath, [IO.File]::ReadAllBytes($startPath))
    Write-Host ("  wrote {0}" -f $aliasCandidates[0].Name)
}
if (-not $indexSame) {
    Write-Text $indexPath $expectedIndex
    Write-Host '  wrote index.html'
}
Write-Host 'done'
