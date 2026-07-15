param(
  [string]$OutputPath = "release\tauri.release.conf.json"
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

function Assert-ProductionUpdaterEndpoint {
  param([string]$Endpoint)

  $uri = $null
  if (-not [System.Uri]::TryCreate($Endpoint, [System.UriKind]::Absolute, [ref]$uri)) {
    throw "SAYIT_UPDATE_ENDPOINT must be an absolute HTTPS URL."
  }

  if ($uri.Scheme -ne [System.Uri]::UriSchemeHttps) {
    throw "SAYIT_UPDATE_ENDPOINT must be an HTTPS URL."
  }

  if ($uri.UserInfo) {
    throw "SAYIT_UPDATE_ENDPOINT must not contain embedded credentials."
  }

  if ($uri.Fragment) {
    throw "SAYIT_UPDATE_ENDPOINT must not contain a URL fragment."
  }

  if ($Endpoint -match "\s") {
    throw "SAYIT_UPDATE_ENDPOINT must not contain whitespace."
  }

  $uriHost = $uri.Host
  if (-not $uriHost -or $uriHost -notmatch "\.") {
    throw "SAYIT_UPDATE_ENDPOINT must use a production fully-qualified host."
  }

  if ($uriHost -match "(^|[.])example\.(com|net|org)$|\.example$|(^|[.])localhost$|\.local(domain)?$|\.test$|\.invalid$") {
    throw "SAYIT_UPDATE_ENDPOINT must not point at a placeholder or local host."
  }

  $ipAddress = $null
  if ([System.Net.IPAddress]::TryParse($uriHost, [ref]$ipAddress) -and (Test-PrivateOrLocalIpAddress $ipAddress)) {
    throw "SAYIT_UPDATE_ENDPOINT must not point at a local, private, or reserved IP address."
  }
}

if (-not $env:SAYIT_UPDATE_ENDPOINT) {
  throw "Set SAYIT_UPDATE_ENDPOINT to the production HTTPS updater manifest endpoint."
}

$endpoint = $env:SAYIT_UPDATE_ENDPOINT.Trim()
Assert-ProductionUpdaterEndpoint $endpoint

$config = [ordered]@{
  plugins = [ordered]@{
    updater = [ordered]@{
      endpoints = @($endpoint)
    }
  }
}

if ([IO.Path]::IsPathRooted($OutputPath)) {
  $resolvedOutputPath = [IO.Path]::GetFullPath($OutputPath)
} else {
  $resolvedOutputPath = [IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
}
$outputDir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$config | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -Path $resolvedOutputPath
Write-Host "Wrote release Tauri config: $resolvedOutputPath"
