# Opens the backend and the web app in two PowerShell windows.
# Run from the project folder:  .\scripts\dev.ps1
# If scripts are blocked:        Set-ExecutionPolicy -Scope Process Bypass
$here = $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $here "start-backend.ps1")
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $here "start-frontend.ps1")
Write-Host "Starting... open http://localhost:5173 in your browser." -ForegroundColor Green
