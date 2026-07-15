param(
  [string]$OutputPath = "release\tauri.release.conf.json"
)

$ErrorActionPreference = "Stop"

if (-not $env:SAYIT_UPDATE_ENDPOINT) {
  throw "Set SAYIT_UPDATE_ENDPOINT to the production HTTPS updater manifest endpoint."
}

$endpoint = $env:SAYIT_UPDATE_ENDPOINT.Trim()

if ($endpoint -notmatch "^https://") {
  throw "SAYIT_UPDATE_ENDPOINT must be an HTTPS URL."
}

if ($endpoint -match "\s") {
  throw "SAYIT_UPDATE_ENDPOINT must not contain whitespace."
}

if ($endpoint -match "example\.com|localhost|127\.0\.0\.1") {
  throw "SAYIT_UPDATE_ENDPOINT must not point at a placeholder or local host."
}

$config = [ordered]@{
  plugins = [ordered]@{
    updater = [ordered]@{
      endpoints = @($endpoint)
    }
  }
}

$resolvedOutputPath = [IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
$outputDir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$config | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -Path $resolvedOutputPath
Write-Host "Wrote release Tauri config: $resolvedOutputPath"
