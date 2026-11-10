@echo off
rem Xiju plugin: install auto-update (runs update.ps1 every 30 minutes)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" -Install
pause
