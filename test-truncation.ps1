$ErrorActionPreference = "Stop"
$failures = @()
foreach ($i in 1..50) {
    $failures += "Error $i"
}
$failures += "MY_SPECIAL_ERROR_KEY"
Write-Error "Failed:`n- $($failures -join "`n- ")"
