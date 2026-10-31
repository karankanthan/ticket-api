# Starts the TicketFlow web app on http://localhost:5173 for local development.
# API calls are forwarded to the backend by Vite's proxy (see frontend/vite.config.ts).
# Run from the project folder:  .\scripts\start-frontend.ps1
param(
    [int]$Port = 5173,
    [string]$BackendUrl = "http://127.0.0.1:8000"
)

$ErrorActionPreference = "Stop"
$frontend = Join-Path (Split-Path -Parent $PSScriptRoot) "frontend"
Set-Location $frontend

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing frontend packages..." -ForegroundColor Cyan
    npm install
}

$env:VITE_BACKEND_URL = $BackendUrl
Write-Host "TicketFlow: http://localhost:$Port  (backend: $BackendUrl)" -ForegroundColor Green
npx vite --port $Port --strictPort
