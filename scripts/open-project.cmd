@echo off
REM ============================================================
REM  open-project.cmd - pick a project folder, then open the workbench on it
REM
REM  This is the double-click entry for non-technical users.
REM  The folder dialog + launching live entirely in PowerShell so that
REM  Chinese / spaced paths never cross the cmd.exe encoding boundary.
REM
REM  Alternative: drag a folder onto editable-studio.cmd
REM ============================================================
setlocal
chcp 65001 >nul 2>nul

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] PowerShell not found.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pick-folder.ps1"

set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
