$ErrorActionPreference = "Stop"

function Invoke-Checked {
  & $args[0] @($args[1..($args.Count - 1)])
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $($args -join ' ')"
  }
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
    throw "Missing required SBOM input: $Path"
  }

  return Get-FileSha256 $Path
}

$sbomDir = Join-Path (Resolve-Path .) "release\sbom"
New-Item -ItemType Directory -Force -Path $sbomDir | Out-Null
$releaseToolsRequirementsLock = "python-backend\release-tools-requirements.lock.txt"

$sourceCommit = (& cmd.exe /c "git rev-parse --verify HEAD 2>nul")
if ($LASTEXITCODE -ne 0 -or -not $sourceCommit) {
  throw "SBOM reports must be tied to a real Git commit."
}

$npmSbom = & npm.cmd sbom --package-lock-only --sbom-format cyclonedx
if ($LASTEXITCODE -ne 0) {
  throw "npm sbom failed with exit code $LASTEXITCODE"
}
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText(
  (Join-Path $sbomDir "npm.cdx.json"),
  ($npmSbom -join [Environment]::NewLine),
  $utf8WithoutBom
)

$installRustReleaseTools = Join-Path $PSScriptRoot "install-rust-release-tools.ps1"
Invoke-Checked powershell -NoProfile -ExecutionPolicy Bypass -File $installRustReleaseTools

Push-Location src-tauri
try {
  $cargoMetadata = (& cargo metadata --no-deps --format-version 1) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or @($cargoMetadata.packages).Count -ne 1) {
    throw "Expected exactly one Cargo package when determining the Rust SBOM filename."
  }

  $rustSbomSource = "$($cargoMetadata.packages[0].name).cdx.json"
  Invoke-Checked cargo cyclonedx --format json
  if (-not (Test-Path -LiteralPath $rustSbomSource)) {
    throw "cargo-cyclonedx did not create the expected SBOM: $rustSbomSource"
  }
  Move-Item -Force -LiteralPath $rustSbomSource -Destination (Join-Path $sbomDir "rust.cdx.json")
}
finally {
  Pop-Location
}

if (Test-Path ".packaging\python-sidecar-venv\Scripts\cyclonedx-py.exe") {
  Invoke-Checked .\.packaging\python-sidecar-venv\Scripts\cyclonedx-py.exe environment .\.packaging\python-sidecar-venv\Scripts\python.exe --output-file (Join-Path $sbomDir "python.cdx.json")
} elseif (Test-Path ".packaging\python-sidecar-venv\Scripts\python.exe") {
  Invoke-Checked .\.packaging\python-sidecar-venv\Scripts\python.exe -m pip install --require-hashes -r $releaseToolsRequirementsLock
  Invoke-Checked .\.packaging\python-sidecar-venv\Scripts\cyclonedx-py.exe environment .\.packaging\python-sidecar-venv\Scripts\python.exe --output-file (Join-Path $sbomDir "python.cdx.json")
} else {
  throw "Packaging venv is missing; run scripts/build-python-sidecar.ps1 before Python SBOM generation."
}

$provenance = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceCommit = $sourceCommit
  inputs = [ordered]@{
    packageLockSha256 = Get-RequiredFileHash "package-lock.json"
    cargoLockSha256 = Get-RequiredFileHash "src-tauri\Cargo.lock"
    requirementsLockSha256 = Get-RequiredFileHash "python-backend\requirements.lock.txt"
    modelRequirementsLockSha256 = Get-RequiredFileHash "python-backend\model-requirements.lock.txt"
    packagingRequirementsLockSha256 = Get-RequiredFileHash "python-backend\packaging-requirements.lock.txt"
    releaseToolsRequirementsLockSha256 = Get-RequiredFileHash "python-backend\release-tools-requirements.lock.txt"
  }
}

$provenance | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path (Join-Path $sbomDir "provenance.json")
