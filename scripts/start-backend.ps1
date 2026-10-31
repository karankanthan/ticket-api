# Starts the FastAPI backend on http://localhost:8000 for local development.
# Run from the project folder:  .\scripts\start-backend.ps1
param(
    [int]$Port = 8000,
    # Where the manager's email links point. The TicketFlow web app serves /act/<token>.
    [string]$PublicBaseUrl = "http://localhost:5173"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "Creating the Python virtual environment..." -ForegroundColor Cyan
    python -m venv .venv
    & $python -m pip install -r requirements-dev.txt
}

# A value in .env or the shell wins over the default above.
if (-not $env:PUBLIC_BASE_URL) { $env:PUBLIC_BASE_URL = $PublicBaseUrl }

Write-Host "Backend: http://localhost:$Port  (API docs: http://localhost:$Port/docs)" -ForegroundColor Green
& $python -m uvicorn app.main:app --port $Port --reload --reload-dir app
