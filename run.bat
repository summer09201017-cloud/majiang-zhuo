@echo off
rem 麻將桌 —— 起一個本機伺服器並開瀏覽器(零相依,不需要 npm install)
cd /d "%~dp0"
set PORT=8931
start "" http://127.0.0.1:%PORT%/
python -m http.server %PORT% --bind 127.0.0.1
