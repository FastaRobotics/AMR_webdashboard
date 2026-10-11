<#
.SYNOPSIS
    Runs the fake backend (simulated robots, no ROS required).

.DESCRIPTION
    Creates fake_backend/.venv on first use, installs the dependencies and starts
    uvicorn on port 8000 — the address the dashboard's .env already points at.

.EXAMPLE
    pwsh -File fake_backend/run.ps1
    pwsh -File fake_backend/run.ps1 -Port 8001 -NoReload
#>
param(
    [int]$Port = 8000,
    [switch]$NoReload,
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $here

try {
    $venv = Join-Path $here ".venv"
    $python = Join-Path $venv "Scripts\python.exe"

    if (-not (Test-Path $python)) {
        Write-Host "==> creating virtual environment in $venv"
        python -m venv $venv
    }

    if (-not $SkipInstall) {
        # Keep pip's scratch space next to the venv: some sandboxed/restricted
        # environments deny writes to the machine-wide TEMP, which makes pip hang.
        $pipTemp = Join-Path $here ".piptmp"
        New-Item -ItemType Directory -Force -Path $pipTemp | Out-Null
        $env:TMPDIR = $pipTemp
        $env:TEMP = $pipTemp
        $env:TMP = $pipTemp

        Write-Host "==> installing requirements"
        & $python -m pip install --disable-pip-version-check --no-cache-dir --quiet -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw "pip install -r requirements.txt failed" }

        Write-Host "==> installing optional WebRTC support (aiortc)"
        & $python -m pip install --disable-pip-version-check --no-cache-dir --quiet -r requirements-webrtc.txt
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "aiortc could not be installed; /streaming/* will answer 501. Everything else works."
        }
    }

    $env:FAKE_PORT = "$Port"
    $arguments = @("-m", "uvicorn", "api:app", "--host", "0.0.0.0", "--port", "$Port")
    if (-not $NoReload) { $arguments += "--reload" }

    Write-Host "==> starting fake backend on http://127.0.0.1:$Port"
    & $python @arguments
}
finally {
    Pop-Location
}
