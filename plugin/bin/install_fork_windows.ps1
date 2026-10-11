# Installs this fork into Typora, deploying plugin/ as a directory junction that
# points back at the repository, so edits take effect without copying.
#
# Run from an elevated PowerShell:
#   .\install_fork_windows.ps1
#   .\install_fork_windows.ps1 -TyporaPath "C:\Program Files\Typora"

param(
    [string]$TyporaPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Typora Plugin (fork) Installer"

# --- Self elevation ---
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Administrator privileges are required. Attempting to elevate..."
    try {
        $scriptPath = $MyInvocation.MyCommand.Definition
        $argList = @("-ExecutionPolicy", "Bypass", "-NoProfile", "-File", "`"$scriptPath`"")
        if ($TyporaPath) { $argList += @("-TyporaPath", "`"$TyporaPath`"") }
        Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs
    } catch {
        Write-Host "`n[ERROR] Elevation failed or was cancelled. Cannot continue." -ForegroundColor Red
        try { $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") | Out-Null } catch {}
        exit 1
    }
    exit
}

function Write-Step($text) { Write-Host $text -ForegroundColor Yellow }
function Write-Ok($text) { Write-Host "      -> $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "      -> $text" }

try {
    # ---------- 1. Locate the repository ----------
    Write-Step "[1/6] Locating repository"
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))
    $sourcePlugin = Join-Path $repoRoot "plugin"
    if (-not (Test-Path -LiteralPath $sourcePlugin -PathType Container)) {
        throw "Could not find the 'plugin' directory in the repository at '$repoRoot'."
    }
    Write-Info "Repository: $repoRoot"

    # ---------- 2. Locate Typora ----------
    Write-Step "[2/6] Locating Typora"
    $candidates = @()
    if ($TyporaPath) {
        $candidates += $TyporaPath
    } else {
        $candidates += @(
            "C:\Program Files\Typora",
            "C:\Program Files (x86)\Typora",
            (Join-Path $env:LOCALAPPDATA "Programs\Typora")
        )
        # Registry lookup as a fallback for custom install locations
        foreach ($hive in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
                            "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*")) {
            try {
                Get-ItemProperty $hive -ErrorAction SilentlyContinue |
                    Where-Object { $_.DisplayName -like "*Typora*" -and $_.InstallLocation } |
                    ForEach-Object { $candidates += $_.InstallLocation }
            } catch {}
        }
    }

    $rootDir = $null
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not $candidate) { continue }
        $probe = $candidate
        if ($probe -like "*.exe") { $probe = Split-Path -Parent $probe }
        if (Test-Path -LiteralPath (Join-Path $probe "resources\window.html")) {
            $rootDir = $probe
            break
        }
    }
    if (-not $rootDir) {
        throw "Could not locate Typora. Pass its install directory explicitly, e.g. -TyporaPath 'C:\Program Files\Typora'."
    }
    $resourcesDir = Join-Path $rootDir "resources"
    $windowHtml = Join-Path $resourcesDir "window.html"
    $windowHtmlBak = Join-Path $resourcesDir "window.html.bak"
    $targetPlugin = Join-Path $resourcesDir "plugin"
    Write-Info "Typora: $rootDir"

    # ---------- 3. Validate window.html ----------
    Write-Step "[3/6] Validating window.html"
    $frameScript = $null
    if (Test-Path -LiteralPath (Join-Path $resourcesDir "appsrc")) {
        $frameScript = '<script src="./appsrc/window/frame.js" defer="defer"></script>'
        Write-Info "'appsrc' found (new-style Typora)"
    } elseif (Test-Path -LiteralPath (Join-Path $resourcesDir "app")) {
        $frameScript = '<script src="./app/window/frame.js" defer="defer"></script>'
        Write-Info "'app' found (old-style Typora)"
    } else {
        throw "Neither 'app' nor 'appsrc' exists under '$resourcesDir'."
    }
    $fileContent = Get-Content -LiteralPath $windowHtml -Encoding UTF8 -Raw
    $pluginScript = '<script src="./plugin/index.js" defer="defer"></script>'
    $alreadyInjected = $fileContent -match [Regex]::Escape($pluginScript)
    if (-not $alreadyInjected -and -not ($fileContent -match [Regex]::Escape($frameScript))) {
        throw "window.html does not contain the expected script tag: $frameScript"
    }
    Write-Ok "window.html looks compatible"

    # ---------- 4. Deploy plugin/ as a junction ----------
    Write-Step "[4/6] Deploying plugin directory"
    $existing = Get-Item -LiteralPath $targetPlugin -Force -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing.LinkType -eq "Junction" -or $existing.LinkType -eq "SymbolicLink") {
            $current = $existing.Target
            if ($current -is [array]) { $current = $current[0] }
            if ($current -and ([System.IO.Path]::GetFullPath($current) -eq $sourcePlugin)) {
                Write-Ok "Junction already points at the repository"
            } else {
                throw "'$targetPlugin' is a link pointing at '$current', not at '$sourcePlugin'. Remove it manually and re-run."
            }
        } else {
            throw "'$targetPlugin' already exists as a real directory. Move it away (e.g. rename to plugin.bak) and re-run, so it can be replaced by a junction."
        }
    } else {
        New-Item -ItemType Junction -Path $targetPlugin -Target $sourcePlugin | Out-Null
        Write-Ok "Created junction: $targetPlugin -> $sourcePlugin"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $targetPlugin "index.js"))) {
        throw "Deployment check failed: '$(Join-Path $targetPlugin 'index.js')' is missing."
    }

    # ---------- 5. Back up window.html ----------
    if ($alreadyInjected) {
        Write-Step "[5/6] Injection already present, skipping"
    } else {
        Write-Step "[5/6] Backing up window.html"
        Copy-Item -LiteralPath $windowHtml -Destination $windowHtmlBak -Force
        Write-Ok "Backup written to $windowHtmlBak"
    }

    # ---------- 6. Inject the loader ----------
    if ($alreadyInjected) {
        Write-Step "[6/6] Injection already present, skipping"
    } else {
        Write-Step "[6/6] Injecting plugin loader"
        $replacement = $frameScript + $pluginScript
        $newFileContent = $fileContent -replace [Regex]::Escape($frameScript), $replacement
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($windowHtml, $newFileContent, $utf8NoBom)
        Write-Ok "Injected '$pluginScript'"
    }

    Write-Host ""
    Write-Host "Done. Restart Typora." -ForegroundColor Green
    Write-Host "Note: the built-in updater is disabled by this fork (see FORK.md); update via git instead." -ForegroundColor Cyan
} catch {
    Write-Host ""
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Installation failed." -ForegroundColor Red
} finally {
    Write-Host ""
    Write-Host "Press any key to exit..."
    try { $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") | Out-Null } catch {}
}
