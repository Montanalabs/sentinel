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

REM Add to the user PATH if not already present.
echo %PATH% | find /i "%SENTINEL_INSTALL_DIR%" >nul
if errorlevel 1 (
  setx PATH "%PATH%;%SENTINEL_INSTALL_DIR%" >nul
  echo Added %SENTINEL_INSTALL_DIR% to your PATH ^(open a new terminal to pick it up^).
)

echo.
echo Run:  sentinel --help
endlocal
