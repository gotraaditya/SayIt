param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [switch]$FreshMachine,
  [switch]$InstalledSuccessfully,
  [switch]$NetworkDisconnected,
  [switch]$SingleInstanceValidated,
  [switch]$OfflineSpeechValidated,
  [switch]$AllVoicesValidated,
  [switch]$BackendRestartValidated,
  [switch]$BackendExitValidated,
  [string]$ReportPath = "release\clean-machine-smoke.json"
)

$ErrorActionPreference = "Stop"
$minimumInstallerBytes = 50MB

if (-not (Test-Path -LiteralPath $InstallerPath)) {
  throw "Installer does not exist: $InstallerPath"
}

$installer = Get-Item -LiteralPath $InstallerPath
if ($installer.Extension -notin @(".exe", ".msi")) {
  throw "Clean-machine smoke must be recorded against a Windows .exe or .msi installer: $($installer.FullName)"
}

if ($installer.Length -lt $minimumInstallerBytes) {
  throw "Installer is too small to contain SayIt's offline backend resources: $($installer.Length) bytes"
}

$checks = [ordered]@{
  freshMachine = [bool]$FreshMachine
  installedSuccessfully = [bool]$InstalledSuccessfully
  networkDisconnected = [bool]$NetworkDisconnected
  singleInstanceValidated = [bool]$SingleInstanceValidated
  offlineSpeechValidated = [bool]$OfflineSpeechValidated
  allVoicesValidated = [bool]$AllVoicesValidated
  backendRestartValidated = [bool]$BackendRestartValidated
  backendExitValidated = [bool]$BackendExitValidated
}

$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key })
if ($failed.Count -gt 0) {
  Write-Host "Clean-machine smoke test checklist"
  Write-Host "1. Run this on a fresh Windows VM without the development venv."
  Write-Host "2. Install: $InstallerPath"
  Write-Host "3. Disconnect network."
  Write-Host "4. Start SayIt and confirm only one instance remains when launched twice."
  Write-Host "5. Select text and press the configured shortcut."
  Write-Host "6. Confirm speech works offline and all advertised voices preview."
  Write-Host "7. Kill sayit-backend.exe and confirm SayIt restarts it."
  Write-Host "8. Confirm sayit-backend.exe exits when SayIt exits or crashes."
  throw "Clean-machine smoke evidence is incomplete. Missing confirmations: $($failed -join ', ')"
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  machineName = $env:COMPUTERNAME
  userName = $env:USERNAME
  installerPath = $installer.FullName
  installerSize = $installer.Length
  installerSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer.FullName).Hash.ToLowerInvariant()
  checks = $checks
}

$resolvedReportPath = [IO.Path]::GetFullPath((Join-Path (Get-Location) $ReportPath))
$reportDir = Split-Path -Parent $resolvedReportPath
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path $resolvedReportPath
Write-Host "Wrote clean-machine smoke report: $resolvedReportPath"
