$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [string]$Command,
    [string[]]$Arguments,
    [string]$ReportPath
  )

  $resolved = Get-Command $Command -ErrorAction SilentlyContinue
  if (-not $resolved) {
    throw "$Command is not installed; cannot run $Command $($Arguments -join ' ')"
  }

  if ($ReportPath) {
    & $Command @Arguments > $ReportPath
  } else {
    & $Command @Arguments
  }

  if ($LASTEXITCODE -ne 0) {
    throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Resolve-PythonForAudit {
  $candidates = @(
    ".packaging\python-sidecar-venv\Scripts\python.exe",
    "python-backend\venv\Scripts\python.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return $python.Source
  }

  throw "No Python interpreter is available for pip-audit."
}

$auditDir = Join-Path (Resolve-Path .) "release\audit"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null

Invoke-Checked npm.cmd @("audit", "--audit-level=moderate", "--json") (Join-Path $auditDir "npm-audit.json")

Push-Location src-tauri
try {
  Invoke-Checked cargo @("audit", "--json") (Join-Path $auditDir "rust-audit.json")
}
finally {
  Pop-Location
}

$python = Resolve-PythonForAudit
& $python -m pip install --upgrade pip-audit
if ($LASTEXITCODE -ne 0) {
  throw "pip-audit installation failed with exit code $LASTEXITCODE"
}

& $python -m pip_audit -r python-backend\requirements.lock.txt --format json --output (Join-Path $auditDir "python-audit.json")
if ($LASTEXITCODE -ne 0) {
  throw "pip-audit failed with exit code $LASTEXITCODE"
}

Write-Host "Security audit reports written to $auditDir"
