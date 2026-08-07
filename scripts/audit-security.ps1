$ErrorActionPreference = "Stop"

# Explicitly scan for embedded public/private keys before running the other audits
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $repoRoot) { $repoRoot = Convert-Path . }

# Exclude large/third-party folders that we don't want to scan
$excludeDirs = @('.git', 'node_modules', '.packaging', 'python-backend\venv', 'python-backend.venv', 'target')

# Patterns that commonly indicate an embedded public/private key
$patterns = @(
  '-----BEGIN ' + 'PUBLIC KEY-----',
  '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  '-----BEGIN ' + 'PRIVATE KEY-----',
  '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----'
)

$matches = @()
Get-ChildItem -Path $repoRoot -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $excludeDirs -notcontains $_.Directory.Name } |
  ForEach-Object {
    foreach ($p in $patterns) {
      if (Select-String -Path $_.FullName -Pattern $p -SimpleMatch -Quiet) {
        $matches += [PSCustomObject]@{ File = $_.FullName; Pattern = $p }
        break
      }
    }
  }

if ($matches.Count -gt 0) {
  Write-Host "ERROR: Found disallowed key material in the repository:"
  foreach ($m in $matches) {
    Write-Host " - $($m.File) contains pattern: $($m.Pattern)"
  }
  # Fail CI with non-zero exit code
  Exit 1
}


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

function Get-FileSha256([string]$Path) {
  if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  } else {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $fs = [System.IO.File]::OpenRead($Path)
      try {
        $bytes = $sha.ComputeHash($fs)
      } finally {
        $fs.Dispose()
      }
    } finally {
      $sha.Dispose()
    }
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  }
}

function Get-RequiredFileHash {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing required audit input: $Path"
  }

  return Get-FileSha256 $Path
}

$auditDir = Join-Path (Resolve-Path .) "release\audit"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null

$sourceCommit = (& cmd.exe /c "git rev-parse --verify HEAD 2>nul")
if ($LASTEXITCODE -ne 0 -or -not $sourceCommit) {
  throw "Security audit reports must be tied to a real Git commit."
}

$installRustReleaseTools = Join-Path $PSScriptRoot "install-rust-release-tools.ps1"
& $installRustReleaseTools
if ($LASTEXITCODE -ne 0) {
  throw "Rust release tool installation failed with exit code $LASTEXITCODE"
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
$modelRequirementsLock = "python-backend\model-requirements.lock.txt"
$releaseToolsRequirementsLock = "python-backend\release-tools-requirements.lock.txt"
& $python -m pip install --require-hashes -r $releaseToolsRequirementsLock
if ($LASTEXITCODE -ne 0) {
  throw "release audit tool installation failed with exit code $LASTEXITCODE"
}

& $python -m pip_audit -r python-backend\requirements.lock.txt --no-deps --format json --output (Join-Path $auditDir "python-audit.json")
if ($LASTEXITCODE -ne 0) {
  throw "pip-audit failed with exit code $LASTEXITCODE"
}

& $python -m pip_audit -r $modelRequirementsLock --no-deps --format json --output (Join-Path $auditDir "python-model-audit.json")
if ($LASTEXITCODE -ne 0) {
  throw "model pip-audit failed with exit code $LASTEXITCODE"
}

& $python -m pip_audit -r python-backend\packaging-requirements.lock.txt --no-deps --format json --output (Join-Path $auditDir "python-packaging-audit.json")
if ($LASTEXITCODE -ne 0) {
  throw "packaging pip-audit failed with exit code $LASTEXITCODE"
}

& $python -m pip_audit -r $releaseToolsRequirementsLock --no-deps --format json --output (Join-Path $auditDir "python-release-tools-audit.json")
if ($LASTEXITCODE -ne 0) {
  throw "release tools pip-audit failed with exit code $LASTEXITCODE"
}

$provenance = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceCommit = $sourceCommit
  inputs = [ordered]@{
    packageLockSha256 = Get-RequiredFileHash "package-lock.json"
    cargoLockSha256 = Get-RequiredFileHash "src-tauri\Cargo.lock"
    requirementsLockSha256 = Get-RequiredFileHash "python-backend\requirements.lock.txt"
    modelRequirementsLockSha256 = Get-RequiredFileHash $modelRequirementsLock
    packagingRequirementsLockSha256 = Get-RequiredFileHash "python-backend\packaging-requirements.lock.txt"
    releaseToolsRequirementsLockSha256 = Get-RequiredFileHash "python-backend\release-tools-requirements.lock.txt"
  }
}

$provenance | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path (Join-Path $auditDir "provenance.json")

Write-Host "Security audit reports written to $auditDir"
