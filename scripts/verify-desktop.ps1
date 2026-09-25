param([int]$Port = 9223)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$executable = Join-Path $root 'apps/desktop/src-tauri/target/release/universe-os.exe'
if (-not (Test-Path $executable)) { throw 'Build the desktop release first.' }
$listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $Port
try { $listener.Start() } finally { $listener.Stop() }
$previousArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousEndpoint = $env:UOS_TEST_ENDPOINT
$application = $null
Push-Location $root
try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --remote-debugging-address=127.0.0.1"
    $env:UOS_TEST_ENDPOINT = "http://127.0.0.1:$Port"
    $application = Start-Process -FilePath $executable -PassThru
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArgs
    node tests/runtime-smoke.mjs --native
    if ($LASTEXITCODE -ne 0) { throw 'Native WebView smoke test failed.' }
    $application.Refresh()
    if ($application.HasExited) { throw 'Desktop exited unexpectedly during inspection.' }
    if (-not $application.CloseMainWindow()) { throw 'No responsive native window to close.' }
    if (-not $application.WaitForExit(5000)) { throw 'Native shutdown exceeded 5 seconds.' }
    $application.Dispose()
    $application = Start-Process -FilePath $executable -PassThru
    if (-not $application.WaitForInputIdle(15000)) { throw 'Reopened desktop failed to become responsive.' }
    Write-Output 'PASS: native IPC, rendering, profiles, reload, shutdown, and reopen.'
} finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArgs
    $env:UOS_TEST_ENDPOINT = $previousEndpoint
    if ($null -ne $application) {
        $application.Refresh()
        if (-not $application.HasExited) {
            $null = $application.CloseMainWindow()
            if (-not $application.WaitForExit(5000)) { $application.Kill() }
        }
        $application.Dispose()
    }
    Pop-Location
}