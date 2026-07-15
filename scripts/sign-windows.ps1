param(
  [Parameter(Mandatory = $true)]
  [string]$BinaryPath
)

$ErrorActionPreference = "Stop"

function Test-PrivateOrLocalIpAddress {
  param([System.Net.IPAddress]$Address)

  if ([System.Net.IPAddress]::IsLoopback($Address)) {
    return $true
  }

  $bytes = $Address.GetAddressBytes()
  if ($Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
    return (
      $bytes[0] -eq 10 -or
      ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
      ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or
      ($bytes[0] -eq 169 -and $bytes[1] -eq 254) -or
      $bytes[0] -eq 0 -or
      $bytes[0] -ge 224
    )
  }

  if ($Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) {
    return (
      $Address.IsIPv6LinkLocal -or
      $Address.IsIPv6SiteLocal -or
      (($bytes[0] -band 0xfe) -eq 0xfc)
    )
  }

  return $true
}

function Assert-ProductionTimestampUrl {
  param([string]$TimestampUrl)

  $uri = $null
  if (-not [System.Uri]::TryCreate($TimestampUrl, [System.UriKind]::Absolute, [ref]$uri)) {
    throw "SAYIT_SIGN_TIMESTAMP_URL must be an absolute HTTP or HTTPS URL."
  }

  if ($uri.Scheme -notin @([System.Uri]::UriSchemeHttp, [System.Uri]::UriSchemeHttps)) {
    throw "SAYIT_SIGN_TIMESTAMP_URL must be an HTTP or HTTPS URL."
  }

  if ($uri.UserInfo) {
    throw "SAYIT_SIGN_TIMESTAMP_URL must not contain embedded credentials."
  }

  if ($uri.Fragment) {
    throw "SAYIT_SIGN_TIMESTAMP_URL must not contain a URL fragment."
  }

  if ($TimestampUrl -match "\s") {
    throw "SAYIT_SIGN_TIMESTAMP_URL must not contain whitespace."
  }

  $uriHost = $uri.Host
  if (-not $uriHost -or $uriHost -notmatch "\.") {
    throw "SAYIT_SIGN_TIMESTAMP_URL must use a production fully-qualified host."
  }

  if ($uriHost -match "(^|[.])example\.(com|net|org)$|\.example$|(^|[.])localhost$|\.local(domain)?$|\.test$|\.invalid$") {
    throw "SAYIT_SIGN_TIMESTAMP_URL must not point at a placeholder or local host."
  }

  $ipAddress = $null
  if ([System.Net.IPAddress]::TryParse($uriHost, [ref]$ipAddress) -and (Test-PrivateOrLocalIpAddress $ipAddress)) {
    throw "SAYIT_SIGN_TIMESTAMP_URL must not point at a local, private, or reserved IP address."
  }
}

if (-not (Test-Path -LiteralPath $BinaryPath)) {
  throw "Cannot sign missing binary: $BinaryPath"
}

if ($env:SAYIT_ALLOW_UNSIGNED -eq "1") {
  Write-Warning "SAYIT_ALLOW_UNSIGNED=1 is set; leaving unsigned: $BinaryPath"
  exit 0
}

$timestampUrl = if ($env:SAYIT_SIGN_TIMESTAMP_URL) {
  $env:SAYIT_SIGN_TIMESTAMP_URL
} else {
  "http://timestamp.digicert.com"
}

Assert-ProductionTimestampUrl $timestampUrl

if ($env:SAYIT_SIGN_CERT_PATH) {
  if (-not (Test-Path -LiteralPath $env:SAYIT_SIGN_CERT_PATH)) {
    throw "SAYIT_SIGN_CERT_PATH does not exist: $env:SAYIT_SIGN_CERT_PATH"
  }
  if ((Get-Item -LiteralPath $env:SAYIT_SIGN_CERT_PATH).Length -le 0) {
    throw "SAYIT_SIGN_CERT_PATH points to an empty file."
  }
  if ([IO.Path]::GetExtension($env:SAYIT_SIGN_CERT_PATH) -notin @(".pfx", ".p12")) {
    throw "SAYIT_SIGN_CERT_PATH must point to a .pfx or .p12 certificate bundle."
  }
} elseif ($env:SAYIT_SIGN_CERT_THUMBPRINT) {
  if ($env:SAYIT_SIGN_CERT_THUMBPRINT -notmatch "^[0-9A-Fa-f]{40}$") {
    throw "SAYIT_SIGN_CERT_THUMBPRINT must be a 40-character SHA-1 certificate thumbprint."
  }
} else {
  throw "Set SAYIT_SIGN_CERT_PATH or SAYIT_SIGN_CERT_THUMBPRINT before release signing."
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
  throw "signtool.exe is required for release signing. Install the Windows SDK or set SAYIT_ALLOW_UNSIGNED=1 for local-only builds."
}

$args = @("sign", "/fd", "SHA256", "/tr", $timestampUrl, "/td", "SHA256")

if ($env:SAYIT_SIGN_CERT_PATH) {
  $args += @("/f", $env:SAYIT_SIGN_CERT_PATH)
  if ($env:SAYIT_SIGN_CERT_PASSWORD) {
    $args += @("/p", $env:SAYIT_SIGN_CERT_PASSWORD)
  }
} elseif ($env:SAYIT_SIGN_CERT_THUMBPRINT) {
  $args += @("/sha1", $env:SAYIT_SIGN_CERT_THUMBPRINT)
}

$args += $BinaryPath
& $signtool.Source @args
if ($LASTEXITCODE -ne 0) {
  throw "signtool failed with exit code $LASTEXITCODE"
}
