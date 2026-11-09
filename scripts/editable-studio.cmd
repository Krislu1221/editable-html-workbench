@echo off
REM ============================================================
REM  editable-studio.cmd - Windows one-click launcher
REM  Usage: editable-studio.cmd [project-root] [port] [--no-open]
REM
REM  NOTE: keep this file ASCII-only. cmd.exe renders UTF-8 Chinese
REM        text as mojibake under the default OEM codepage (936).
REM ============================================================
setlocal
REM Node writes UTF-8; switch the console to 65001 so Chinese logs are readable.
chcp 65001 >nul 2>nul

set "SCRIPT_DIR=%~dp0"

REM Root defaults to the package root (parent of \scripts), NOT the
REM current directory: double-clicking a .cmd sets CWD to its own
REM folder, which would make the workbench serve only \scripts.
set "ROOT=%~1"
if "%ROOT%"=="" set "ROOT=%SCRIPT_DIR%.."
set "PORT=%~2"
if "%PORT%"=="" set "PORT=8899"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo         Install the LTS build from https://nodejs.org/ and retry.
  pause
  exit /b 1
)

node "%SCRIPT_DIR%editable-studio.mjs" --root "%ROOT%" --port %PORT% %3 %4 %5 %6 %7 %8 %9
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
