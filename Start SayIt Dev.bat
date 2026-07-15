@echo off
setlocal

cd /d "%~dp0"

echo Cleaning up stale SayIt dev processes...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\stop-sayit-dev.ps1"
if errorlevel 1 (
  echo.
  echo Failed to clean up stale SayIt processes.
  pause
  exit /b 1
)

echo.
echo Starting SayIt...
npm run tauri dev

endlocal
