$ErrorActionPreference = "Stop"

function Invoke-Checked {
  & $args[0] @($args[1..($args.Count - 1)])
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $($args -join ' ')"
  }
}

function Get-RequiredFileHash {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing required SBOM input: $Path"
  }

  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

$sbomDir = Join-Path (Resolve-Path .) "release\sbom"
New-Item -ItemType Directory -Force -Path $sbomDir | Out-Null
$releaseToolsRequirementsLock = "python-backend\release-tools-requirements.lock.txt"

$sourceCommit = (& cmd.exe /c "git rev-parse --verify HEAD 2>nul")
if ($LASTEXITCODE -ne 0 -or -not $sourceCommit) {
  throw "SBOM reports must be tied to a real Git commit."
}

Invoke-Checked npx.cmd --yes @cyclonedx/cyclonedx-npm --output-file (Join-Path $sbomDir "npm.cdx.json")

Push-Location src-tauri
try {
  if (-not (Get-Command cargo-cyclonedx -ErrorAction SilentlyContinue)) {
    Invoke-Checked cargo install cargo-cyclonedx
  }
  Invoke-Checked cargo cyclonedx --format json
  Move-Item -Force -LiteralPath "tauri-app.cdx.json" -Destination (Join-Path $sbomDir "rust.cdx.json")
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
    packagingRequirementsLockSha256 = Get-RequiredFileHash "python-backend\packaging-requirements.lock.txt"
    releaseToolsRequirementsLockSha256 = Get-RequiredFileHash "python-backend\release-tools-requirements.lock.txt"
  }
}

$provenance | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path (Join-Path $sbomDir "provenance.json")
