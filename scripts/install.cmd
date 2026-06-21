@echo off
REM Sentinel installer for Windows (CMD).
REM   curl -fsSL https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.cmd -o install.cmd ^&^& install.cmd
REM
REM Downloads the standalone sentinel.exe from GitHub Releases into %LOCALAPPDATA%\Sentinel\bin.
REM No Node.js required.
setlocal enabledelayedexpansion

if "%SENTINEL_REPO%"=="" set "SENTINEL_REPO=montanalabs/sentinel"
if "%SENTINEL_VERSION%"=="" set "SENTINEL_VERSION=latest"
if "%SENTINEL_INSTALL_DIR%"=="" set "SENTINEL_INSTALL_DIR=%LOCALAPPDATA%\Sentinel\bin"

set "ASSET=sentinel-win-x64.exe"
if "%SENTINEL_VERSION%"=="latest" (
  set "URL=https://github.com/%SENTINEL_REPO%/releases/latest/download/%ASSET%"
) else (
  set "URL=https://github.com/%SENTINEL_REPO%/releases/download/%SENTINEL_VERSION%/%ASSET%"
)

echo Installing sentinel (%SENTINEL_VERSION%) for Windows x64...
if not exist "%SENTINEL_INSTALL_DIR%" mkdir "%SENTINEL_INSTALL_DIR%"

curl -fSL --progress-bar "%URL%" -o "%SENTINEL_INSTALL_DIR%\sentinel.exe"
if errorlevel 1 (
  echo error: download failed: %URL%
  exit /b 1
)

echo.
echo Installed to %SENTINEL_INSTALL_DIR%\sentinel.exe

REM Add to the USER PATH via PowerShell's .NET API. Do NOT `setx PATH "%PATH%;..."`: %PATH% is the
REM merged system+user PATH, so that copies the whole system PATH into the user PATH, and setx
REM silently truncates at 1024 chars — together they can corrupt the user's PATH.
echo %PATH% | find /i "%SENTINEL_INSTALL_DIR%" >nul
if errorlevel 1 (
  powershell -NoProfile -Command "$p=[Environment]::GetEnvironmentVariable('Path','User'); if ($p -notlike '*%SENTINEL_INSTALL_DIR%*') { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';%SENTINEL_INSTALL_DIR%').TrimStart(';')), 'User') }" >nul 2>nul
  echo Added %SENTINEL_INSTALL_DIR% to your user PATH ^(open a new terminal to pick it up^).
)

echo.
echo Run:  sentinel --help
endlocal
