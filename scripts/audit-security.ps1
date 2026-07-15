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

function Get-RequiredFileHash {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing required audit input: $Path"
  }

  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

$auditDir = Join-Path (Resolve-Path .) "release\audit"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null

$sourceCommit = (& cmd.exe /c "git rev-parse --verify HEAD 2>nul")
if ($LASTEXITCODE -ne 0 -or -not $sourceCommit) {
  throw "Security audit reports must be tied to a real Git commit."
}

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

& $python -m pip_audit -r python-backend\packaging-requirements.lock.txt --format json --output (Join-Path $auditDir "python-packaging-audit.json")
if ($LASTEXITCODE -ne 0) {
  throw "packaging pip-audit failed with exit code $LASTEXITCODE"
}

$provenance = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceCommit = $sourceCommit
  inputs = [ordered]@{
    packageLockSha256 = Get-RequiredFileHash "package-lock.json"
    cargoLockSha256 = Get-RequiredFileHash "src-tauri\Cargo.lock"
    requirementsLockSha256 = Get-RequiredFileHash "python-backend\requirements.lock.txt"
    packagingRequirementsLockSha256 = Get-RequiredFileHash "python-backend\packaging-requirements.lock.txt"
  }
}

$provenance | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path (Join-Path $auditDir "provenance.json")

Write-Host "Security audit reports written to $auditDir"
