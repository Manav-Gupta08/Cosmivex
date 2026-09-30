param([int]$Port = 9223, [switch]$VisibilityOnly, [switch]$ConnectOnly, [switch]$MinimizeOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$executable = Join-Path $root 'apps/desktop/src-tauri/target/release/universe-os.exe'
if (-not (Test-Path $executable)) { throw 'Build the desktop release first.' }
$listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $Port
try { $listener.Start() } finally { $listener.Stop() }
$previousArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousEndpoint = $env:UOS_TEST_ENDPOINT
$previousAppPid = $env:UOS_TEST_APP_PID
$previousTestPid = $env:UOS_TEST_PID
$previousParentPid = $env:UOS_TEST_PARENT_PID
$previousChildPid = $env:UOS_TEST_CHILD_PID
$previousCpu = $env:UOS_TEST_CPU
$previousMemory = $env:UOS_TEST_MEMORY_MIB
$workload = $null
$application = $null
Push-Location $root
try {
    $null = [System.IO.Directory]::CreateDirectory((Join-Path $root 'artifacts'))
    $workloadOutput = Join-Path $root 'artifacts/workload-reference.json'
    if (-not $VisibilityOnly -and -not $ConnectOnly -and -not $MinimizeOnly) {
        $workload = Start-Process -FilePath (Get-Command node).Source -ArgumentList (Join-Path $root 'tests/process-workload.mjs') -RedirectStandardOutput $workloadOutput -WindowStyle Hidden -PassThru
        $env:UOS_TEST_PID = [string]$workload.Id
        $env:UOS_TEST_PARENT_PID = [string]$PID
        $workload.Refresh()
        $startedCpu = $workload.TotalProcessorTime.TotalSeconds
        $referenceClock = [System.Diagnostics.Stopwatch]::StartNew()
        Get-Counter '\System\System Up Time' -SampleInterval 1 -MaxSamples 3 | Out-Null
        $workload.Refresh()
        $referenceCpu = ($workload.TotalProcessorTime.TotalSeconds - $startedCpu) / $referenceClock.Elapsed.TotalSeconds / [Environment]::ProcessorCount * 100
        $env:UOS_TEST_CHILD_PID = [string](Get-Content $workloadOutput -Raw | ConvertFrom-Json).childPid
        $env:UOS_TEST_CPU = $referenceCpu.ToString([Globalization.CultureInfo]::InvariantCulture)
        $env:UOS_TEST_MEMORY_MIB = ($workload.WorkingSet64 / 1MB).ToString([Globalization.CultureInfo]::InvariantCulture)
    }
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --remote-debugging-address=127.0.0.1"
    $env:UOS_TEST_ENDPOINT = "http://127.0.0.1:$Port"
    $application = Start-Process -FilePath $executable -PassThru -RedirectStandardError (Join-Path $root 'artifacts/native-close.err')
    $env:UOS_TEST_APP_PID = [string]$application.Id
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArgs
    if ($VisibilityOnly -or $ConnectOnly -or $MinimizeOnly) {
        if ($ConnectOnly) { node tests/visibility-smoke.mjs --connect-only } elseif ($MinimizeOnly) { node tests/visibility-smoke.mjs --minimize-only } else { node tests/visibility-smoke.mjs }
    } else { node tests/runtime-smoke.mjs --native }
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
    $env:UOS_TEST_APP_PID = $previousAppPid
    $env:UOS_TEST_PID = $previousTestPid
    $env:UOS_TEST_PARENT_PID = $previousParentPid
    $env:UOS_TEST_CHILD_PID = $previousChildPid
    $env:UOS_TEST_CPU = $previousCpu
    $env:UOS_TEST_MEMORY_MIB = $previousMemory
    if ($null -ne $workload) {
        if (-not $workload.HasExited) { $workload.Kill(); $workload.WaitForExit() }
        $workload.Dispose()
    }
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