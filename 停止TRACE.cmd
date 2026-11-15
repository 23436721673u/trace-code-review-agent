@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3 "%~dp0desktop_launcher.pyw" --stop
