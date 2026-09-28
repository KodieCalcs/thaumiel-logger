@echo off
rem Builds thaumiel + the combat logger and copies it into your game folder.
rem The first time, it asks where the game folder is and downloads Zig and Node.js (one time).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0packaging\install.ps1" %*
echo.
pause
