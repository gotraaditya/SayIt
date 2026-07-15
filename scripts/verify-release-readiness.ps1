param(
  [switch]$SkipCleanMachineSmoke,
  [string]$ConfigPath
)

$ErrorActionPreference = "Stop"

function Add-Failure {
  param([string]$Message)
  $script:failures += $Message
}

function Test-PlaceholderSecret {
  param([string]$Value)

  if (-not $Value) {
    return $true
  }

  $trimmed = $Value.Trim()
  return $trimmed.Length -lt 64 -or $trimmed -match "^(dummy|test|placeholder|changeme|secret)$"
}

function Read-JsonEvidence {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    Add-Failure "Missing ${Label}: $Path"
    return $null
  }

  try {
    return Get-Content -Raw -Path $Path | ConvertFrom-Json
  } catch {
    Add-Failure "${Label} is not valid JSON: $Path"
    return $null
  }
}

function Test-TextEvidence {
  param(
    [string]$Path,
    [string]$Label,
    [string[]]$RequiredFragments
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    Add-Failure "Missing ${Label}: $Path"
    return
  }

  $content = Get-Content -Raw -Path $Path
  foreach ($fragment in $RequiredFragments) {
    if (-not $content.Contains($fragment)) {
      Add-Failure "${Label} is missing required release gate: $fragment"
    }
  }
}

function Get-RequiredFileHash {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    Add-Failure "Missing required release input for hashing: $Path"
    return $null
  }

  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

$failures = @()
$minimumInstallerBytes = 50MB
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$tauriConfigPath = Join-Path $root "src-tauri\tauri.conf.json"
$tauriConfig = Get-Content -Raw -Path $tauriConfigPath | ConvertFrom-Json
$currentHeadCommit = $null

Push-Location $root
try {
  $insideGitWorkTree = (& cmd.exe /c "git rev-parse --is-inside-work-tree 2>nul")
  if ($LASTEXITCODE -ne 0 -or $insideGitWorkTree -ne "true") {
    Add-Failure "Release must be built from a Git worktree."
  } else {
    $headCommit = (& cmd.exe /c "git rev-parse --verify HEAD 2>nul")
    if ($LASTEXITCODE -ne 0 -or -not $headCommit) {
      Add-Failure "Release must be built from a real Git commit; HEAD is missing."
    } elseif ($env:GITHUB_SHA -and $headCommit -ne $env:GITHUB_SHA) {
      Add-Failure "Git HEAD does not match GITHUB_SHA."
    } else {
      $currentHeadCommit = $headCommit
    }

    $dirtyTrackedChanges = (& cmd.exe /c "git status --porcelain --untracked-files=no 2>nul")
    if ($LASTEXITCODE -ne 0) {
      Add-Failure "Unable to inspect Git worktree cleanliness."
    } elseif ($dirtyTrackedChanges) {
      Add-Failure "Release must be built from a clean Git worktree with no tracked uncommitted changes."
    }
  }
} finally {
  Pop-Location
}

Test-TextEvidence (Join-Path $root ".github\workflows\ci.yml") "CI workflow" @(
  "npm ci",
  "npm test -- --run",
  "python-backend\venv\Scripts\python.exe -m unittest discover -s python-backend -p `"test_*.py`"",
  "cargo test",
  "scripts/audit-security.ps1",
  "scripts/build-python-sidecar.ps1",
  "npm run verify:release-assets",
  "scripts/generate-sbom.ps1"
)

Test-TextEvidence (Join-Path $root ".github\workflows\release.yml") "Release workflow" @(
  "environment: release",
  "scripts/build-python-sidecar.ps1",
  "npm run verify:release-assets",
  "npm test -- --run",
  "python-backend\venv\Scripts\python.exe -m unittest discover -s python-backend -p `"test_*.py`"",
  "cargo test",
  "scripts/audit-security.ps1",
  "scripts/generate-sbom.ps1",
  "scripts/generate-release-config.ps1",
  "scripts/verify-release-readiness.ps1 -SkipCleanMachineSmoke -ConfigPath release\tauri.release.conf.json",
  "npx tauri build --config release\tauri.release.conf.json",
  "npm run verify:release-bundles",
  "actions/upload-artifact"
)

if ($ConfigPath) {
  $resolvedConfigPath = [IO.Path]::GetFullPath((Join-Path (Get-Location) $ConfigPath))
  if (-not (Test-Path -LiteralPath $resolvedConfigPath)) {
    Add-Failure "Release config override does not exist: $resolvedConfigPath"
  } else {
    $overrideConfig = Get-Content -Raw -Path $resolvedConfigPath | ConvertFrom-Json
    if ($overrideConfig.plugins.updater.endpoints) {
      $tauriConfig.plugins.updater.endpoints = $overrideConfig.plugins.updater.endpoints
    }
  }
}

$endpoints = @($tauriConfig.plugins.updater.endpoints)
if ($endpoints.Count -eq 0) {
  Add-Failure "Updater endpoints are missing."
}
foreach ($endpoint in $endpoints) {
  if ($endpoint -notmatch "^https://") {
    Add-Failure "Updater endpoint must use HTTPS: $endpoint"
  }
  if ($endpoint -match "(^|[./])example\.(com|net|org)([:/]|$)|localhost|127\.0\.0\.1|\.local(domain)?\.|\.test([:/]|$)|\.invalid([:/]|$)") {
    Add-Failure "Updater endpoint is not production-ready: $endpoint"
  }
}

if (-not $tauriConfig.bundle.createUpdaterArtifacts) {
  Add-Failure "Tauri updater artifact generation is disabled."
}

if (-not $tauriConfig.bundle.windows.signCommand) {
  Add-Failure "Windows signing command is not configured."
}

if ($env:SAYIT_ALLOW_UNSIGNED -eq "1") {
  Add-Failure "SAYIT_ALLOW_UNSIGNED=1 is only allowed for local builds, not release readiness."
}

if ($env:SAYIT_SIGN_CERT_PATH) {
  if (-not (Test-Path -LiteralPath $env:SAYIT_SIGN_CERT_PATH)) {
    Add-Failure "SAYIT_SIGN_CERT_PATH does not exist: $env:SAYIT_SIGN_CERT_PATH"
  } elseif ((Get-Item -LiteralPath $env:SAYIT_SIGN_CERT_PATH).Length -le 0) {
    Add-Failure "SAYIT_SIGN_CERT_PATH points to an empty file."
  }
} elseif ($env:SAYIT_SIGN_CERT_THUMBPRINT) {
  if ($env:SAYIT_SIGN_CERT_THUMBPRINT -notmatch "^[0-9A-Fa-f]{40}$") {
    Add-Failure "SAYIT_SIGN_CERT_THUMBPRINT must be a 40-character SHA-1 certificate thumbprint."
  }
} else {
  Add-Failure "Set SAYIT_SIGN_CERT_PATH or SAYIT_SIGN_CERT_THUMBPRINT for release signing."
}

if ($env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
  if (-not (Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
    Add-Failure "TAURI_SIGNING_PRIVATE_KEY_PATH does not exist: $env:TAURI_SIGNING_PRIVATE_KEY_PATH"
  } elseif ((Get-Item -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY_PATH).Length -le 0) {
    Add-Failure "TAURI_SIGNING_PRIVATE_KEY_PATH points to an empty file."
  }
} elseif ($env:TAURI_SIGNING_PRIVATE_KEY) {
  if (Test-PlaceholderSecret $env:TAURI_SIGNING_PRIVATE_KEY) {
    Add-Failure "TAURI_SIGNING_PRIVATE_KEY looks like a placeholder rather than a real updater signing key."
  }
} else {
  Add-Failure "Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH for updater artifact signing."
}

$sbomDir = Join-Path $root "release\sbom"
$sbomProvenance = Read-JsonEvidence (Join-Path $sbomDir "provenance.json") "SBOM provenance"
if ($sbomProvenance) {
  if (-not $sbomProvenance.sourceCommit) {
    Add-Failure "SBOM provenance is missing sourceCommit."
  } elseif ($currentHeadCommit -and $sbomProvenance.sourceCommit -ne $currentHeadCommit) {
    Add-Failure "SBOM provenance sourceCommit does not match current Git HEAD."
  }

  $expectedSbomInputs = @{
    packageLockSha256 = Get-RequiredFileHash (Join-Path $root "package-lock.json")
    cargoLockSha256 = Get-RequiredFileHash (Join-Path $root "src-tauri\Cargo.lock")
    requirementsLockSha256 = Get-RequiredFileHash (Join-Path $root "python-backend\requirements.lock.txt")
  }

  foreach ($name in $expectedSbomInputs.Keys) {
    if ($expectedSbomInputs[$name] -and $sbomProvenance.inputs.$name -ne $expectedSbomInputs[$name]) {
      Add-Failure "SBOM provenance input hash does not match: $name"
    }
  }
}

foreach ($name in @("npm.cdx.json", "rust.cdx.json", "python.cdx.json")) {
  $sbom = Read-JsonEvidence (Join-Path $sbomDir $name) "SBOM file"
  if ($sbom) {
    if ($sbom.bomFormat -ne "CycloneDX") {
      Add-Failure "SBOM file is not a CycloneDX BOM: release\sbom\$name"
    }
    if (@($sbom.components).Count -eq 0) {
      Add-Failure "SBOM file has no components: release\sbom\$name"
    }
  }
}

$auditDir = Join-Path $root "release\audit"
$auditProvenance = Read-JsonEvidence (Join-Path $auditDir "provenance.json") "vulnerability audit provenance"
if ($auditProvenance) {
  if (-not $auditProvenance.sourceCommit) {
    Add-Failure "Vulnerability audit provenance is missing sourceCommit."
  } elseif ($currentHeadCommit -and $auditProvenance.sourceCommit -ne $currentHeadCommit) {
    Add-Failure "Vulnerability audit provenance sourceCommit does not match current Git HEAD."
  }

  $expectedAuditInputs = @{
    packageLockSha256 = Get-RequiredFileHash (Join-Path $root "package-lock.json")
    cargoLockSha256 = Get-RequiredFileHash (Join-Path $root "src-tauri\Cargo.lock")
    requirementsLockSha256 = Get-RequiredFileHash (Join-Path $root "python-backend\requirements.lock.txt")
  }

  foreach ($name in $expectedAuditInputs.Keys) {
    if ($expectedAuditInputs[$name] -and $auditProvenance.inputs.$name -ne $expectedAuditInputs[$name]) {
      Add-Failure "Vulnerability audit provenance input hash does not match: $name"
    }
  }
}

$npmAudit = Read-JsonEvidence (Join-Path $auditDir "npm-audit.json") "vulnerability audit report"
if ($npmAudit) {
  if ($npmAudit.auditReportVersion -lt 2) {
    Add-Failure "npm audit report version is not supported."
  }
  if ($npmAudit.metadata.vulnerabilities.total -ne 0) {
    Add-Failure "npm audit report contains known vulnerabilities."
  }
}

$rustAudit = Read-JsonEvidence (Join-Path $auditDir "rust-audit.json") "vulnerability audit report"
if ($rustAudit) {
  if ($rustAudit.vulnerabilities.found -ne $false -or $rustAudit.vulnerabilities.count -ne 0) {
    Add-Failure "Rust audit report contains known vulnerabilities."
  }
}

$pythonAudit = Read-JsonEvidence (Join-Path $auditDir "python-audit.json") "vulnerability audit report"
if ($pythonAudit) {
  $pythonVulnerabilities = @(
    $pythonAudit.dependencies |
      Where-Object { $_.vulns -and @($_.vulns).Count -gt 0 }
  )
  if ($pythonVulnerabilities.Count -gt 0) {
    Add-Failure "Python audit report contains known vulnerabilities."
  }

  $unexpectedSkips = @(
    $pythonAudit.dependencies |
      Where-Object { $_.skip_reason -and $_.name -ne "torch" }
  )
  if ($unexpectedSkips.Count -gt 0) {
    Add-Failure "Python audit report contains unexpected skipped dependencies."
  }
}

if (-not $SkipCleanMachineSmoke) {
  $smokeReportPath = Join-Path $root "release\clean-machine-smoke.json"
  if (-not (Test-Path -LiteralPath $smokeReportPath)) {
    Add-Failure "Missing clean-machine smoke report: release\clean-machine-smoke.json"
  } else {
    $smokeReport = Get-Content -Raw -Path $smokeReportPath | ConvertFrom-Json
    try {
      $generatedAt = [DateTimeOffset]::Parse($smokeReport.generatedAt)
      if ($generatedAt -lt (Get-Date).ToUniversalTime().AddDays(-14)) {
        Add-Failure "Clean-machine smoke report is older than 14 days."
      }
    } catch {
      Add-Failure "Clean-machine smoke report has an invalid generatedAt timestamp."
    }

    if (-not $smokeReport.sourceCommit) {
      Add-Failure "Clean-machine smoke report is missing sourceCommit."
    } elseif ($currentHeadCommit -and $smokeReport.sourceCommit -ne $currentHeadCommit) {
      Add-Failure "Clean-machine smoke sourceCommit does not match current Git HEAD."
    }

    if (-not (Test-Path -LiteralPath $smokeReport.installerPath)) {
      Add-Failure "Clean-machine smoke installer no longer exists: $($smokeReport.installerPath)"
    } else {
      $installer = Get-Item -LiteralPath $smokeReport.installerPath
      $installerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer.FullName).Hash.ToLowerInvariant()
      if ($installer.Extension -notin @(".exe", ".msi")) {
        Add-Failure "Clean-machine smoke installer is not a Windows .exe or .msi installer."
      }
      if ($installer.Length -lt $minimumInstallerBytes) {
        Add-Failure "Clean-machine smoke installer is too small to contain offline backend resources."
      }
      if ($installer.Length -ne $smokeReport.installerSize) {
        Add-Failure "Clean-machine smoke installer size no longer matches the report."
      }
      if ($installerHash -ne $smokeReport.installerSha256) {
        Add-Failure "Clean-machine smoke installer hash no longer matches the report."
      }
      $installerSignature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
      if ($installerSignature.Status -ne "Valid") {
        Add-Failure "Clean-machine smoke installer Authenticode signature is not valid: $($installerSignature.Status)"
      }
      if ($smokeReport.installerSignatureStatus -ne "Valid") {
        Add-Failure "Clean-machine smoke report did not record a valid installer signature."
      }
    }

    foreach ($property in @(
      "freshMachine",
      "installedSuccessfully",
      "networkDisconnected",
      "singleInstanceValidated",
      "offlineSpeechValidated",
      "allVoicesValidated",
      "backendRestartValidated",
      "backendExitValidated"
    )) {
      if ($smokeReport.checks.$property -ne $true) {
        Add-Failure "Clean-machine smoke report did not confirm: $property"
      }
    }
  }
}

if ($failures.Count -gt 0) {
  Write-Error "Release readiness failed:`n- $($failures -join "`n- ")"
  exit 1
}

Write-Host "Release readiness checks passed."
