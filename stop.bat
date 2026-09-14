@echo off
setlocal enabledelayedexpansion
echo Stopping SongYUE2...

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4311" ^| findstr "LISTENING"') do (
    echo Stopping backend on port 4311 ^(PID %%P^)...
    taskkill /F /PID %%P >nul 2>&1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    echo Stopping dev server on port 5173 ^(PID %%P^)...
    taskkill /F /PID %%P >nul 2>&1
)

echo Done.
