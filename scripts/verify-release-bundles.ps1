param(
  [string]$BundleDir = "src-tauri\target\release\bundle"
)

$ErrorActionPreference = "Stop"

function Add-Failure {
  param([string]$Message)
  $script:failures += $Message
}

$failures = @()
$minimumInstallerBytes = 50MB
$resolvedBundleDir = [IO.Path]::GetFullPath((Join-Path (Get-Location) $BundleDir))

if (-not (Test-Path -LiteralPath $resolvedBundleDir)) {
  Add-Failure "Bundle directory does not exist: $resolvedBundleDir"
} else {
  $installers = @(
    Get-ChildItem -LiteralPath $resolvedBundleDir -Recurse -File |
      Where-Object { $_.Extension -in @(".exe", ".msi") }
  )
  $updaterArchives = @(
    Get-ChildItem -LiteralPath $resolvedBundleDir -Recurse -File |
      Where-Object { $_.Name -match "\.(zip|tar\.gz)$" }
  )
  $updaterSignatures = @(
    Get-ChildItem -LiteralPath $resolvedBundleDir -Recurse -File -Filter "*.sig"
  )

  if ($installers.Count -eq 0) {
    Add-Failure "No Windows installer artifacts were produced."
  }

  foreach ($installer in $installers) {
    if ($installer.Length -lt $minimumInstallerBytes) {
      Add-Failure "Installer is too small to contain offline backend resources: $($installer.FullName)"
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
    if ($signature.Status -ne "Valid") {
      Add-Failure "Installer Authenticode signature is not valid: $($installer.FullName) [$($signature.Status)]"
    }
  }

  if ($updaterArchives.Count -eq 0) {
    Add-Failure "No updater archives were produced."
  }

  foreach ($archive in $updaterArchives) {
    if (-not (Test-Path -LiteralPath "$($archive.FullName).sig")) {
      Add-Failure "Missing updater signature for archive: $($archive.FullName)"
    }
  }

  if ($updaterSignatures.Count -eq 0) {
    Add-Failure "No updater signature files were produced."
  }
}

if ($failures.Count -gt 0) {
  Write-Error "Release bundle verification failed:`n- $($failures -join "`n- ")"
  exit 1
}

Write-Host "Release bundle verification passed."
