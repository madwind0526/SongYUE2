@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo Checking for an existing SongYUE2 server on ports 4311/5176...

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4311" ^| findstr "LISTENING"') do (
    echo Found existing backend on port 4311 ^(PID %%P^) - stopping it...
    taskkill /F /PID %%P >nul 2>&1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5176" ^| findstr "LISTENING"') do (
    echo Found existing dev server on port 5176 ^(PID %%P^) - stopping it...
    taskkill /F /PID %%P >nul 2>&1
)

set "AI_MUSIC_PROBE_DIR=C:\Claude\ai-music-probe"
set "AI_PROBE_RUNNING="
if exist "%AI_MUSIC_PROBE_DIR%\start.bat" (
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8792" ^| findstr "LISTENING"') do set "AI_PROBE_RUNNING=1"
    if defined AI_PROBE_RUNNING (
        echo AI Music Probe already running on port 8792.
    ) else (
        echo Starting AI Music Probe...
        start "AI Music Probe" /min cmd /c ""%AI_MUSIC_PROBE_DIR%\start.bat""
    )
) else (
    echo AI Music Probe not found at %AI_MUSIC_PROBE_DIR% - skipping.
)

echo Starting SongYUE2...
call npm run dev
