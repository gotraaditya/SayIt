param(
  [string]$CargoAuditVersion = "0.22.2",
  [string]$CargoCyclonedxVersion = "0.5.9"
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  & $args[0] @($args[1..($args.Count - 1)])
  $exitCode = $LASTEXITCODE

  $ErrorActionPreference = $oldPreference

  if ($exitCode -ne 0) {
    throw "Command failed with exit code ${exitCode}: $($args -join ' ')"
  }
}

function Test-CargoSubcommandVersion {
  param(
    [string]$Subcommand,
    [string]$ExpectedVersion
  )

  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $output = & cargo $Subcommand --version 2>$null
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $oldPreference

  if ($exitCode -ne 0) {
    return $false
  }

  return ($output -join "`n") -match "\b$([regex]::Escape($ExpectedVersion))\b"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo is not installed; cannot install Rust release tools."
}

if (-not (Test-CargoSubcommandVersion "audit" $CargoAuditVersion)) {
  Invoke-Checked cargo install cargo-audit --version $CargoAuditVersion --locked --force
}

if (-not (Test-CargoSubcommandVersion "cyclonedx" $CargoCyclonedxVersion)) {
  Invoke-Checked cargo install cargo-cyclonedx --version $CargoCyclonedxVersion --locked --force
}
