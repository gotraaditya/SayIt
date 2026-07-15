$ErrorActionPreference = "Stop"

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$generateReleaseConfig = Join-Path $root "scripts\generate-release-config.ps1"
$tempDir = Join-Path ([IO.Path]::GetTempPath()) "sayit-release-script-tests-$([Guid]::NewGuid())"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

function Invoke-GenerateReleaseConfig {
  param([string]$Endpoint)

  $previousEndpoint = $env:SAYIT_UPDATE_ENDPOINT
  $previousErrorActionPreference = $ErrorActionPreference
  $env:SAYIT_UPDATE_ENDPOINT = $Endpoint
  try {
    $ErrorActionPreference = "Continue"
    powershell -NoProfile -ExecutionPolicy Bypass -File $generateReleaseConfig -OutputPath (Join-Path $tempDir "tauri.release.conf.json") *> $null
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    if ($null -eq $previousEndpoint) {
      Remove-Item Env:\SAYIT_UPDATE_ENDPOINT -ErrorAction SilentlyContinue
    } else {
      $env:SAYIT_UPDATE_ENDPOINT = $previousEndpoint
    }
  }
}

try {
  $invalidEndpoints = @(
    "http://updates.sayit.example.com/releases/latest.json",
    "https://example.com/releases/latest.json",
    "https://localhost/releases/latest.json",
    "https://127.0.0.1/releases/latest.json",
    "https://192.168.1.10/releases/latest.json",
    "https://user:pass@updates.sayit.example/releases/latest.json",
    "https://updates.sayit.example/releases/latest.json",
    "https://updates.sayit.invalid/releases/latest.json",
    "https://updates/releases/latest.json",
    "https://updates.sayit.example/releases/latest.json#fragment"
  )

  foreach ($endpoint in $invalidEndpoints) {
    $exitCode = Invoke-GenerateReleaseConfig $endpoint
    if ($exitCode -eq 0) {
      throw "Expected updater endpoint to be rejected: $endpoint"
    }
  }

  $validEndpoint = "https://updates.sayit.app/releases/latest.json"
  $exitCode = Invoke-GenerateReleaseConfig $validEndpoint
  if ($exitCode -ne 0) {
    throw "Expected updater endpoint to be accepted: $validEndpoint"
  }

  $output = Get-Content -Raw -Path (Join-Path $tempDir "tauri.release.conf.json") | ConvertFrom-Json
  if (@($output.plugins.updater.endpoints)[0] -ne $validEndpoint) {
    throw "Generated release config did not contain the validated updater endpoint."
  }

  Write-Host "Release script tests passed."
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
