@echo off
rem Makes a shareable copy of a battle: <battle folder>\Share\combat-log.csv + summary.json.
rem Double-click: choose from your recent battles. Or drag a "Battle N" folder onto this file.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo This needs Node.js, a free program that runs the log reader.
  echo Install the "LTS" version from https://nodejs.org , then double-click this file again.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node "%~dp0logger-tools\share.mjs" %*
echo.
pause
