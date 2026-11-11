@echo off
setlocal
cd /d "%~dp0"

where deno >nul 2>&1
if errorlevel 1 (
    echo Deno is required. Install Deno and run this file again.
    pause
    exit /b 1
)

echo Starting SKPass at http://localhost:9000
echo Press Ctrl+C to stop the server.
deno run --allow-net --allow-read jsr:@std/http/file-server web --port 9000
if errorlevel 1 (
    echo The server failed to start or stopped with an error.
    pause
    exit /b 1
)
