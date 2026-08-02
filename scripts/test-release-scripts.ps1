$ErrorActionPreference = "Stop"

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$generateReleaseConfig = Join-Path $root "scripts\generate-release-config.ps1"
$signWindows = Join-Path $root "scripts\sign-windows.ps1"
$verifyReleaseReadiness = Join-Path $root "scripts\verify-release-readiness.ps1"
$verifyReleaseBundles = Join-Path $root "scripts\verify-release-bundles.ps1"
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

function Invoke-SignWindows {
  param(
    [string]$TimestampUrl,
    [string]$Thumbprint
  )

  $previousTimestampUrl = $env:SAYIT_SIGN_TIMESTAMP_URL
  $previousThumbprint = $env:SAYIT_SIGN_CERT_THUMBPRINT
  $previousCertPath = $env:SAYIT_SIGN_CERT_PATH
  $previousAllowUnsigned = $env:SAYIT_ALLOW_UNSIGNED
  $previousErrorActionPreference = $ErrorActionPreference
  $binaryPath = Join-Path $tempDir "fake-sayit.exe"
  Set-Content -Encoding ascii -Path $binaryPath -Value "not a real executable"

  $env:SAYIT_SIGN_TIMESTAMP_URL = $TimestampUrl
  $env:SAYIT_SIGN_CERT_THUMBPRINT = $Thumbprint
  Remove-Item Env:\SAYIT_SIGN_CERT_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\SAYIT_ALLOW_UNSIGNED -ErrorAction SilentlyContinue

  try {
    $ErrorActionPreference = "Continue"
    $output = powershell -NoProfile -ExecutionPolicy Bypass -File $signWindows -BinaryPath $binaryPath 2>&1 | Out-String -Width 4096
    return [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = $output
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    if ($null -eq $previousTimestampUrl) {
      Remove-Item Env:\SAYIT_SIGN_TIMESTAMP_URL -ErrorAction SilentlyContinue
    } else {
      $env:SAYIT_SIGN_TIMESTAMP_URL = $previousTimestampUrl
    }
    if ($null -eq $previousThumbprint) {
      Remove-Item Env:\SAYIT_SIGN_CERT_THUMBPRINT -ErrorAction SilentlyContinue
    } else {
      $env:SAYIT_SIGN_CERT_THUMBPRINT = $previousThumbprint
    }
    if ($null -eq $previousCertPath) {
      Remove-Item Env:\SAYIT_SIGN_CERT_PATH -ErrorAction SilentlyContinue
    } else {
      $env:SAYIT_SIGN_CERT_PATH = $previousCertPath
    }
    if ($null -eq $previousAllowUnsigned) {
      Remove-Item Env:\SAYIT_ALLOW_UNSIGNED -ErrorAction SilentlyContinue
    } else {
      $env:SAYIT_ALLOW_UNSIGNED = $previousAllowUnsigned
    }
  }
}

function Invoke-ReleaseReadinessWithUpdaterKey {
  param(
    [string]$UpdaterKey,
    [switch]$UseKeyFile
  )

  $previousUpdaterKey = $env:TAURI_SIGNING_PRIVATE_KEY
  $previousUpdaterKeyPath = $env:TAURI_SIGNING_PRIVATE_KEY_PATH
  $previousErrorActionPreference = $ErrorActionPreference
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue

  if ($UseKeyFile) {
    $keyPath = Join-Path $tempDir "tauri-updater.key"
    Set-Content -Encoding utf8 -Path $keyPath -Value $UpdaterKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $keyPath
  } else {
    $env:TAURI_SIGNING_PRIVATE_KEY = $UpdaterKey
  }

  try {
    $ErrorActionPreference = "Continue"
    $output = powershell -NoProfile -ExecutionPolicy Bypass -File $verifyReleaseReadiness 2>&1 | Out-String -Width 4096
    return [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = $output
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    if ($null -eq $previousUpdaterKey) {
      Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    } else {
      $env:TAURI_SIGNING_PRIVATE_KEY = $previousUpdaterKey
    }
    if ($null -eq $previousUpdaterKeyPath) {
      Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
    } else {
      $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $previousUpdaterKeyPath
    }
  }
}

function Invoke-VerifyReleaseBundles {
  param([string]$BundleDir)

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = powershell -NoProfile -ExecutionPolicy Bypass -File $verifyReleaseBundles -BundleDir $BundleDir 2>&1 | Out-String -Width 4096
    return [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = $output
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
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

  $absoluteReleaseConfigPath = Join-Path $tempDir "absolute.tauri.release.conf.json"
  $previousEndpoint = $env:SAYIT_UPDATE_ENDPOINT
  $env:SAYIT_UPDATE_ENDPOINT = $validEndpoint
  try {
    $ErrorActionPreference = "Continue"
    powershell -NoProfile -ExecutionPolicy Bypass -File $generateReleaseConfig -OutputPath $absoluteReleaseConfigPath *> $null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $absoluteReleaseConfigPath)) {
      throw "Expected release config generation to support absolute OutputPath."
    }

    $readinessOutput = powershell -NoProfile -ExecutionPolicy Bypass -File $verifyReleaseReadiness -SkipCleanMachineSmoke -ConfigPath $absoluteReleaseConfigPath 2>&1 | Out-String -Width 4096
    if ($LASTEXITCODE -eq 0) {
      throw "Expected readiness to fail without signing secrets while accepting absolute ConfigPath."
    }
    if ($readinessOutput.Contains("Updater endpoints are missing.") -or $readinessOutput.Contains("Release config override does not exist")) {
      throw "Expected readiness to load the absolute ConfigPath override."
    }
  } finally {
    $ErrorActionPreference = "Stop"
    if ($null -eq $previousEndpoint) {
      Remove-Item Env:\SAYIT_UPDATE_ENDPOINT -ErrorAction SilentlyContinue
    } else {
      $env:SAYIT_UPDATE_ENDPOINT = $previousEndpoint
    }
  }

  $validThumbprint = "0123456789abcdef0123456789abcdef01234567"
  $invalidTimestampUrls = @(
    "ftp://timestamp.example.org",
    "http://localhost/timestamp",
    "http://192.168.1.20/timestamp",
    "https://user:pass@timestamp.sayit.app/timestamp",
    "https://timestamp.sayit.invalid/timestamp",
    "https://timestamp/timestamp",
    "https://timestamp.sayit.app/timestamp#fragment"
  )

  foreach ($timestampUrl in $invalidTimestampUrls) {
    $result = Invoke-SignWindows $timestampUrl $validThumbprint
    if ($result.ExitCode -eq 0 -or -not $result.Output.Contains("SAYIT_SIGN_TIMESTAMP_URL")) {
      throw "Expected signing timestamp URL to be rejected before signtool: $timestampUrl"
    }
  }

  $invalidThumbprintResult = Invoke-SignWindows "http://timestamp.digicert.com" "not-a-thumbprint"
  if ($invalidThumbprintResult.ExitCode -eq 0 -or -not $invalidThumbprintResult.Output.Contains("SAYIT_SIGN_CERT_THUMBPRINT")) {
    throw "Expected invalid signing thumbprint to be rejected before signtool."
  }

  $publicUpdaterKey = "untrusted comment: minisign public key: 54DEADBEEFDEADBEEFDEADBEEFDEADBE RWT000000000000000000000000000000000000000000000000000000000000000"
  $publicUpdaterKeyResult = Invoke-ReleaseReadinessWithUpdaterKey $publicUpdaterKey
  if ($publicUpdaterKeyResult.ExitCode -eq 0 -or -not $publicUpdaterKeyResult.Output.Contains("TAURI_SIGNING_PRIVATE_KEY must be a private updater signing key")) {
    throw "Expected public updater key text to be rejected."
  }

  $placeholderUpdaterKeyResult = Invoke-ReleaseReadinessWithUpdaterKey "placeholder"
  if ($placeholderUpdaterKeyResult.ExitCode -eq 0 -or -not $placeholderUpdaterKeyResult.Output.Contains("TAURI_SIGNING_PRIVATE_KEY looks like a placeholder")) {
    throw "Expected placeholder updater key text to be rejected."
  }

  $publicUpdaterKeyFileResult = Invoke-ReleaseReadinessWithUpdaterKey $publicUpdaterKey -UseKeyFile
  if ($publicUpdaterKeyFileResult.ExitCode -eq 0 -or -not $publicUpdaterKeyFileResult.Output.Contains("TAURI_SIGNING_PRIVATE_KEY_PATH must be a private updater signing key")) {
    throw "Expected public updater key file to be rejected."
  }

  $absoluteMissingBundleDir = Join-Path $tempDir "missing-bundles"
  $bundleResult = Invoke-VerifyReleaseBundles $absoluteMissingBundleDir
  if (
    $bundleResult.ExitCode -eq 0 -or
    -not $bundleResult.Output.Contains("Bundle directory does not exist:") -or
    -not $bundleResult.Output.Contains($absoluteMissingBundleDir)
  ) {
    throw "Expected release bundle verifier to preserve absolute BundleDir paths."
  }

  Write-Host "Release script tests passed."
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
