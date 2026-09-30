@echo off
setlocal
cd /d "%~dp0"
title TestGen - Setup and Run

echo ==============================================
echo   TestGen - AI Test Studio  (first-time setup)
echo ==============================================
echo.

rem ---- 1. Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Trying to install it automatically...
  where winget >nul 2>nul
  if errorlevel 1 goto nonode
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  echo.
  echo Node.js installed. Please CLOSE this window and double-click setup-and-run.bat again.
  pause
  exit /b 0
)
:hasnode
for /f "tokens=*" %%v in ('node -v') do echo Node.js %%v found.
goto env

:nonode
echo Could not auto-install. Please install Node.js LTS from https://nodejs.org
echo then double-click this file again.
start "" https://nodejs.org
pause
exit /b 1

rem ---- 2. API keys ----
:env
if exist ".env" (
  echo .env found - using your saved API keys.
  goto run
)
echo.
echo Enter your API key(s). Press Enter to skip one.
echo Get keys at: https://console.x.ai  (Grok)  or  https://openrouter.ai/keys
echo Keys stay on this computer only (saved in the .env file).
echo.
set "XAI="
set "OR="
set /p XAI=Grok / xAI API key:
set /p OR=OpenRouter API key:
> .env echo XAI_API_KEY=%XAI%
>> .env echo OPENROUTER_API_KEY=%OR%
echo Saved.

rem ---- 3. Run ----
:run
if not exist "logs" mkdir logs
echo.
echo Starting dashboard at http://localhost:3000  (close this window to stop)
start "" http://localhost:3000
node src\server.js
pause
