# Sentinel installer for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.ps1 | iex
#
# Downloads the standalone sentinel.exe from GitHub Releases into %LOCALAPPDATA%\Sentinel\bin and
# adds it to your user PATH. No Node.js required.
$ErrorActionPreference = 'Stop'

$Repo = if ($env:SENTINEL_REPO) { $env:SENTINEL_REPO } else { 'montanalabs/sentinel' }
$Version = if ($env:SENTINEL_VERSION) { $env:SENTINEL_VERSION } else { 'latest' }
$InstallDir = if ($env:SENTINEL_INSTALL_DIR) { $env:SENTINEL_INSTALL_DIR } else { "$env:LOCALAPPDATA\Sentinel\bin" }

$arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { throw 'unsupported architecture' }
$asset = "sentinel-win-$arch.exe"
$url = if ($Version -eq 'latest') {
  "https://github.com/$Repo/releases/latest/download/$asset"
} else {
  "https://github.com/$Repo/releases/download/$Version/$asset"
}

Write-Host "Installing sentinel ($Version) for win-$arch..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$dest = Join-Path $InstallDir 'sentinel.exe'
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing

# Add to the user PATH if missing.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$InstallDir", 'User')
  Write-Host "Added $InstallDir to your user PATH (open a new terminal to pick it up)."
}

Write-Host "`nInstalled to $dest"
Write-Host "Run:  sentinel --help"
