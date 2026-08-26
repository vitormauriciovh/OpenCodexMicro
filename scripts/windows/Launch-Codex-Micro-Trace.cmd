@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-Codex-Micro-Trace.ps1" %*
if errorlevel 1 (
  echo.
  echo Launch failed. Read the message above.
  pause
)
