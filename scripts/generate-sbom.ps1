$ErrorActionPreference = "Stop"

function Invoke-Checked {
  & $args[0] @($args[1..($args.Count - 1)])
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $($args -join ' ')"
  }
}

$sbomDir = Join-Path (Resolve-Path .) "release\sbom"
New-Item -ItemType Directory -Force -Path $sbomDir | Out-Null

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
  Invoke-Checked .\.packaging\python-sidecar-venv\Scripts\python.exe -m pip install cyclonedx-bom
  Invoke-Checked .\.packaging\python-sidecar-venv\Scripts\cyclonedx-py.exe environment .\.packaging\python-sidecar-venv\Scripts\python.exe --output-file (Join-Path $sbomDir "python.cdx.json")
} else {
  throw "Packaging venv is missing; run scripts/build-python-sidecar.ps1 before Python SBOM generation."
}
