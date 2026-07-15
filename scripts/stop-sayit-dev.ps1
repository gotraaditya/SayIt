$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$escapedProjectRoot = [regex]::Escape($projectRoot)

$processes = Get-CimInstance Win32_Process | Where-Object {
  $commandLine = $_.CommandLine
  if (-not $commandLine) {
    return $false
  }

  $isSayItProcess = $commandLine -match $escapedProjectRoot
  $isDevProcess =
    $commandLine -match "vite[\\/]bin[\\/]vite\.js" -or
    $commandLine -match "@tauri-apps[\\/]cli[\\/]tauri\.js.* dev" -or
    $commandLine -match "npm-cli\.js.* run tauri dev" -or
    $commandLine -match "cmd\.exe.* tauri dev" -or
    $commandLine -match "target[\\/]debug[\\/]tauri-app\.exe" -or
    $commandLine -match "python\.exe.*uvicorn app:app" -or
    $commandLine -match "python\.exe.*backend_server\.py"
  $isSayItProcess -and $isDevProcess
} | Select-Object -ExpandProperty ProcessId -Unique

foreach ($processId in $processes) {
  if ($processId -eq $PID) {
    continue
  }

  if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
    continue
  }

  & taskkill /PID $processId /T /F | Out-String | Write-Output
}

if (-not $processes) {
  Write-Output "No SayIt dev processes found."
}
