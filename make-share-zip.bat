@echo off
cd /d "%~dp0"
rem Packages the app for sharing WITHOUT your API keys (.env) or your run logs.
set OUT=%~dp0TestGen-Dashboard.zip
if exist "%OUT%" del "%OUT%"
powershell -NoProfile -Command "$t=Join-Path $env:TEMP 'testgen_share'; $d=Join-Path $t 'TestGen'; if(Test-Path $t){Remove-Item $t -Recurse -Force}; New-Item -ItemType Directory -Path $d,(Join-Path $d 'logs') | Out-Null; foreach($i in 'src','public','samples','README.md','setup-and-run.bat','.env.example','.gitignore'){ Copy-Item $i $d -Recurse }; Compress-Archive -Path $d -DestinationPath '%OUT%'; Remove-Item $t -Recurse -Force"
echo.
echo Created: %OUT%
echo (no .env, no logs - safe to share)
pause
