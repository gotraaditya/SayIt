param(
  [Parameter(Mandatory = $true)]
  [string]$BinaryPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $BinaryPath)) {
  throw "Cannot sign missing binary: $BinaryPath"
}

if ($env:SAYIT_ALLOW_UNSIGNED -eq "1") {
  Write-Warning "SAYIT_ALLOW_UNSIGNED=1 is set; leaving unsigned: $BinaryPath"
  exit 0
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
  throw "signtool.exe is required for release signing. Install the Windows SDK or set SAYIT_ALLOW_UNSIGNED=1 for local-only builds."
}

$timestampUrl = if ($env:SAYIT_SIGN_TIMESTAMP_URL) {
  $env:SAYIT_SIGN_TIMESTAMP_URL
} else {
  "http://timestamp.digicert.com"
}

$args = @("sign", "/fd", "SHA256", "/tr", $timestampUrl, "/td", "SHA256")

if ($env:SAYIT_SIGN_CERT_PATH) {
  if (-not (Test-Path -LiteralPath $env:SAYIT_SIGN_CERT_PATH)) {
    throw "SAYIT_SIGN_CERT_PATH does not exist: $env:SAYIT_SIGN_CERT_PATH"
  }
  $args += @("/f", $env:SAYIT_SIGN_CERT_PATH)
  if ($env:SAYIT_SIGN_CERT_PASSWORD) {
    $args += @("/p", $env:SAYIT_SIGN_CERT_PASSWORD)
  }
} elseif ($env:SAYIT_SIGN_CERT_THUMBPRINT) {
  $args += @("/sha1", $env:SAYIT_SIGN_CERT_THUMBPRINT)
} else {
  throw "Set SAYIT_SIGN_CERT_PATH or SAYIT_SIGN_CERT_THUMBPRINT before release signing."
}

$args += $BinaryPath
& $signtool.Source @args
if ($LASTEXITCODE -ne 0) {
  throw "signtool failed with exit code $LASTEXITCODE"
}
