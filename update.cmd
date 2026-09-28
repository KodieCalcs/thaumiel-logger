@echo off
rem git pull, then install.cmd: gets the newest version and puts it in your game folder.
cd /d "%~dp0"
git pull --ff-only
if errorlevel 1 (
  echo.
  echo "git pull" did not work. If you changed files in this folder, undo those changes and try again.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0packaging\install.ps1"
echo.
pause
