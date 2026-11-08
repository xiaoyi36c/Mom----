@echo off
cd /d c:\Users\XOS\Desktop\electron-app
set PATH=F:\node;%PATH%
call F:\node\node.exe "c:\Users\XOS\Desktop\electron-app\node_modules\electron-builder\cli.js" --win
echo BUILD_EXIT=%ERRORLEVEL%
