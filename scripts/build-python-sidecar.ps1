param(
  [string]$Python = "python",
  [string]$RepoId = "hexgrad/Kokoro-82M"
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  & $args[0] @($args[1..($args.Count - 1)])
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $($args -join ' ')"
  }
}

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$backendDir = Join-Path $root "python-backend"
$modelsDir = Join-Path $backendDir "models\kokoro"
$voicesDir = Join-Path $modelsDir "voices"
$runtimeDir = Join-Path $root "python-backend-runtime"
$buildVenv = Join-Path $root ".packaging\python-sidecar-venv"
$requirementsLock = Join-Path $backendDir "requirements.lock.txt"
$requiredVoices = @(
  "af_alloy",
  "af_bella",
  "af_heart",
  "af_jessica",
  "af_nicole",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_fenrir",
  "am_michael",
  "am_onyx"
)

New-Item -ItemType Directory -Force -Path $modelsDir, $voicesDir, $runtimeDir | Out-Null

if (-not (Test-Path $requirementsLock)) {
  throw "Missing $requirementsLock. Regenerate it with pip-compile --allow-unsafe --generate-hashes before packaging."
}

if (-not (Test-Path $buildVenv)) {
  Invoke-Checked $Python -m venv $buildVenv
}

$venvPython = Join-Path $buildVenv "Scripts\python.exe"
Invoke-Checked $venvPython -m pip install --upgrade pip
Invoke-Checked $venvPython -m pip install --require-hashes -r $requirementsLock
Invoke-Checked $venvPython -m pip install pyinstaller huggingface_hub

$downloadScriptPath = Join-Path $root ".packaging\download_kokoro_assets.py"
$downloadScript = @'
import os
from pathlib import Path
from huggingface_hub import HfApi, hf_hub_download
from huggingface_hub.errors import EntryNotFoundError, RemoteEntryNotFoundError

repo_id = os.environ["SAYIT_KOKORO_REPO"]
models_dir = Path(os.environ["SAYIT_MODELS_DIR"])
voices = os.environ["SAYIT_VOICES"].split(",")

for filename in ["config.json", "kokoro-v1_0.pth"]:
    path = hf_hub_download(repo_id=repo_id, filename=filename, local_dir=models_dir)
    print(path)

notice = models_dir / "KOKORO_LICENSE_NOTICE.txt"
try:
    path = hf_hub_download(repo_id=repo_id, filename="LICENSE", local_dir=models_dir)
    notice.write_text(f"Bundled Kokoro model assets from {repo_id}.\nLicense file: LICENSE\n", encoding="utf-8")
    print(path)
except (EntryNotFoundError, RemoteEntryNotFoundError):
    info = HfApi().model_info(repo_id)
    license_name = getattr(getattr(info, "card_data", None), "license", None) or "not specified in downloaded metadata"
    notice.write_text(
        f"Bundled Kokoro model assets from {repo_id}.\n"
        f"No top-level LICENSE file was present in the Hugging Face repository at packaging time.\n"
        f"Model card license metadata: {license_name}\n"
        f"Review the model card before distribution: https://huggingface.co/{repo_id}\n",
        encoding="utf-8",
    )

for voice in voices:
    path = hf_hub_download(repo_id=repo_id, filename=f"voices/{voice}.pt", local_dir=models_dir)
    print(path)
'@
Set-Content -Encoding utf8 -Path $downloadScriptPath -Value $downloadScript

$env:SAYIT_KOKORO_REPO = $RepoId
$env:SAYIT_MODELS_DIR = $modelsDir
$env:SAYIT_VOICES = ($requiredVoices -join ",")
Invoke-Checked $venvPython $downloadScriptPath

$hashFile = Join-Path $modelsDir "SHA256SUMS.txt"
Get-ChildItem -Path $modelsDir -Recurse -File |
  Where-Object {
    $_.Name -ne "SHA256SUMS.txt" -and
    $_.FullName.Substring($modelsDir.Length).TrimStart("\", "/") -notmatch "^\.cache[\\/]"
  } |
  Sort-Object FullName |
  ForEach-Object {
    $relative = $_.FullName.Substring($modelsDir.Length).TrimStart("\", "/").Replace("\", "/")
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
    "$hash  $relative"
  } | Set-Content -Encoding utf8 -Path $hashFile

$distDir = Join-Path $root ".packaging\pyinstaller-dist"
$buildDir = Join-Path $root ".packaging\pyinstaller-build"
Invoke-Checked $venvPython -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name sayit-backend `
  --distpath $distDir `
  --workpath $buildDir `
  --specpath (Join-Path $root ".packaging") `
  (Join-Path $backendDir "backend_server.py")

Copy-Item -Force -Path (Join-Path $distDir "sayit-backend.exe") -Destination (Join-Path $runtimeDir "sayit-backend.exe")
Write-Host "Built $runtimeDir\sayit-backend.exe"
Write-Host "Prepared offline Kokoro assets in $modelsDir"
