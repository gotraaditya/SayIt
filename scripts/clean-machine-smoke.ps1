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
  [string]$DesktopLogPath,
  [string]$BackendLogPath,
  [string]$ReportPath = "release\clean-machine-smoke.json"
)

$ErrorActionPreference = "Stop"

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
$minimumInstallerBytes = 50MB
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$requiredVoices = @(
  "af_heart",
  "af_bella",
  "af_nicole",
  "af_sky",
  "af_alloy",
  "af_jessica",
  "am_adam",
  "am_michael",
  "am_onyx",
  "am_echo",
  "am_fenrir"
)

function Resolve-RequiredEvidenceFile {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not $Path) {
    throw "Clean-machine smoke requires ${Label}. Pass the installed-app log path."
  }

  if ([IO.Path]::IsPathRooted($Path)) {
    $resolved = [IO.Path]::GetFullPath($Path)
  } else {
    $resolved = [IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
  }
  if (-not (Test-Path -LiteralPath $resolved)) {
    throw "Clean-machine smoke ${Label} does not exist: $resolved"
  }

  $item = Get-Item -LiteralPath $resolved
  if ($item.Length -le 0) {
    throw "Clean-machine smoke ${Label} is empty: $resolved"
  }

  return $item
}

function Assert-LogContains {
  param(
    [string]$Content,
    [string]$Fragment,
    [string]$Label
  )

  if (-not $Content.Contains($Fragment)) {
    throw "${Label} is missing required evidence: $Fragment"
  }
}

if (-not (Test-Path -LiteralPath $InstallerPath)) {
  throw "Installer does not exist: $InstallerPath"
}

Push-Location $root
try {
  $sourceCommit = (& cmd.exe /c "git rev-parse --verify HEAD 2>nul")
  if ($LASTEXITCODE -ne 0 -or -not $sourceCommit) {
    throw "Clean-machine smoke report must be tied to a real Git commit."
  }
} finally {
  Pop-Location
}

$installer = Get-Item -LiteralPath $InstallerPath
if ($installer.Extension -notin @(".exe", ".msi")) {
  throw "Clean-machine smoke must be recorded against a Windows .exe or .msi installer: $($installer.FullName)"
}

if ($installer.Length -lt $minimumInstallerBytes) {
  throw "Installer is too small to contain SayIt's offline backend resources: $($installer.Length) bytes"
}

$installerSignature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
if ($installerSignature.Status -ne "Valid") {
  throw "Clean-machine smoke must be recorded against a validly signed installer: $($installerSignature.Status)"
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
  Write-Host "9. Pass -DesktopLogPath and -BackendLogPath from the installed app log directory."
  throw "Clean-machine smoke evidence is incomplete. Missing confirmations: $($failed -join ', ')"
}

$desktopLog = Resolve-RequiredEvidenceFile $DesktopLogPath "desktop diagnostic log"
$backendLog = Resolve-RequiredEvidenceFile $BackendLogPath "backend diagnostic log"
$desktopLogContent = Get-Content -Raw -Path $desktopLog.FullName
$backendLogContent = Get-Content -Raw -Path $backendLog.FullName

Assert-LogContains $desktopLogContent "SayIt desktop setup started." "Desktop diagnostic log"
Assert-LogContains $desktopLogContent "Backend ready:" "Desktop diagnostic log"
Assert-LogContains $desktopLogContent "Backend process exited:" "Desktop diagnostic log"
Assert-LogContains $desktopLogContent "Backend restart succeeded:" "Desktop diagnostic log"
Assert-LogContains $backendLogContent "Kokoro TTS model loaded." "Backend diagnostic log"
foreach ($voice in $requiredVoices) {
  Assert-LogContains $backendLogContent "voice=$voice" "Backend diagnostic log"
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  machineName = $env:COMPUTERNAME
  userName = $env:USERNAME
  sourceCommit = $sourceCommit
  installerPath = $installer.FullName
  installerSize = $installer.Length
  installerSha256 = Get-FileSha256 $installer.FullName
  installerSignatureStatus = $installerSignature.Status.ToString()
  diagnosticLogs = [ordered]@{
    desktopLogPath = $desktopLog.FullName
    desktopLogSha256 = Get-FileSha256 $desktopLog.FullName
    backendLogPath = $backendLog.FullName
    backendLogSha256 = Get-FileSha256 $backendLog.FullName
  }
  checks = $checks
}

if ([IO.Path]::IsPathRooted($ReportPath)) {
  $resolvedReportPath = [IO.Path]::GetFullPath($ReportPath)
} else {
  $resolvedReportPath = [IO.Path]::GetFullPath((Join-Path (Get-Location) $ReportPath))
}
$reportDir = Split-Path -Parent $resolvedReportPath
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path $resolvedReportPath
Write-Host "Wrote clean-machine smoke report: $resolvedReportPath"
