@echo off

setlocal

set "PROJECT_ROOT=%~dp0\.."
cd /d "%PROJECT_ROOT%"

if "%1"=="--no-open" (
  set "OPEN_BROWSER=0"
) else (
  set "OPEN_BROWSER=1"
)

if not "%PORT%"=="" (
  set "DEV_PORT=%PORT%"
) else (
  set "DEV_PORT=3000"
)

set "PORT=%DEV_PORT%"
call npm run dev:open

endlocal
