@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo Checking for an existing SongYUE2 server on ports 4311/5173...

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4311" ^| findstr "LISTENING"') do (
    echo Found existing backend on port 4311 ^(PID %%P^) - stopping it...
    taskkill /F /PID %%P >nul 2>&1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    echo Found existing dev server on port 5173 ^(PID %%P^) - stopping it...
    taskkill /F /PID %%P >nul 2>&1
)

echo Starting SongYUE2...
call npm run dev
