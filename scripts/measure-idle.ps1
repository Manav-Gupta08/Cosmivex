param([int]$WarmupSeconds = 30, [int]$SampleSeconds = 60, [switch]$Orbit, [switch]$Minimized, [switch]$Startup, [ValidateSet('selection', 'focus', 'replay')][string]$Interaction)
$ErrorActionPreference = 'Stop'
$controlled = $Orbit -or [bool]$Interaction
if ($WarmupSeconds -lt 1 -or $SampleSeconds -lt 5) { throw 'Use at least 1 second warmup and 5 seconds sampling.' }
if ($controlled -and $WarmupSeconds -lt 20) { throw 'Controlled workloads require at least 20 seconds of warmup for the native WebView to connect.' }
if ($Interaction -and ($Orbit -or $Minimized -or $Startup)) { throw 'Choose one controlled workload.' }
if ($Orbit -and $Minimized) { throw 'Choose either orbit or minimized sampling.' }
if ($Startup -and ($Orbit -or $Minimized)) { throw 'Startup memory sampling must run without orbit or minimization.' }
if ($Minimized) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UniverseMeasureWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
}
'@
}
$root = Split-Path $PSScriptRoot -Parent
$executable = Join-Path $root 'apps/desktop/src-tauri/target/release/universe-os.exe'
if (-not (Test-Path $executable)) { throw 'Build the desktop release first.' }
$artifacts = Join-Path $root 'artifacts'
if ($controlled) {
    $null = [System.IO.Directory]::CreateDirectory($artifacts)
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 9224)
    try { $listener.Start() } finally { $listener.Stop() }
    $driverOutput = Join-Path $artifacts 'orbit-workload.out'
    $driverError = Join-Path $artifacts 'orbit-workload.err'
    Remove-Item $driverOutput, $driverError -ErrorAction SilentlyContinue
}
$originalBrowserArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
if ($controlled) { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1' }
try { $application = Start-Process -FilePath $executable -PassThru }
finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $originalBrowserArgs }
$launchClock = [System.Diagnostics.Stopwatch]::StartNew()
$driver = $null
try {
    if ($controlled) {
        $driverArguments = if ($Interaction) { @('tests/interaction-workload.mjs', ($WarmupSeconds + $SampleSeconds + 15), $Interaction) } else { @('tests/orbit-workload.mjs', ($WarmupSeconds + $SampleSeconds + 15)) }
        $driver = Start-Process -FilePath 'node' -WorkingDirectory $root -ArgumentList $driverArguments -RedirectStandardOutput $driverOutput -RedirectStandardError $driverError -PassThru -WindowStyle Hidden
        $null = $driver.Handle
    }
    if (-not $Startup) { Get-Counter '\System\System Up Time' -SampleInterval 1 -MaxSamples ($WarmupSeconds + 1) | Out-Null }
    if ($controlled -and ($driver.HasExited -or -not (Select-String -Path $driverOutput -Pattern 'ORBIT_READY|INTERACTION_READY' -Quiet))) { throw "Workload driver did not start: $(Get-Content $driverError -Raw)" }
    if ($Minimized) {
        $application.Refresh()
        $window = $application.MainWindowHandle
        if ($window -eq [IntPtr]::Zero) { throw 'Native application window was not found.' }
        $null = [UniverseMeasureWindow]::ShowWindowAsync($window, 6)
        Get-Counter '\System\System Up Time' -SampleInterval 1 -MaxSamples 2 | Out-Null
        if (-not [UniverseMeasureWindow]::IsIconic($window)) { throw 'Native application window did not minimize.' }
    }
    $processes = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -ge $application.StartTime } | Select-Object ProcessId, ParentProcessId, Name)
    $ids = New-Object 'System.Collections.Generic.HashSet[int]'
    $null = $ids.Add($application.Id)
    do {
        $added = $false
        foreach ($item in $processes) {
            if ($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $added = $true }
        }
    } while ($added)
    $logicalCpus = [Environment]::ProcessorCount
    $previous = @{}
    $cpuTotals = @{}
    $samples = New-Object 'System.Collections.Generic.List[object]'
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $lastTime = 0.0
    $sampleStartUnixMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Get-Counter '\System\System Up Time' -SampleInterval 1 -MaxSamples ($SampleSeconds + 1) | ForEach-Object {
        if ($Startup) {
            $startupProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -ge $application.StartTime } | Select-Object ProcessId, ParentProcessId)
            do {
                $added = $false
                foreach ($item in $startupProcesses) {
                    if ($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $added = $true }
                }
            } while ($added)
        }
        $now = $clock.Elapsed.TotalSeconds
        $seconds = $now - $lastTime
        $hostCpu = 0.0
        $webviewCpu = 0.0
        $workingSet = 0L
        $privateBytes = 0L
        $hostPrivate = 0L
        foreach ($processId in $ids) {
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($null -eq $process) { continue }
            $cpu = $process.TotalProcessorTime.TotalSeconds
            if ($previous.ContainsKey($processId)) {
                $percent = [Math]::Max(0.0, ($cpu - $previous[$processId]) / $seconds / $logicalCpus * 100)
                $cpuTotals[$processId] = [double]$cpuTotals[$processId] + $percent
                if ($processId -eq $application.Id) { $hostCpu += $percent } else { $webviewCpu += $percent }
            }
            $previous[$processId] = $cpu
            $workingSet += $process.WorkingSet64
            $privateBytes += $process.PrivateMemorySize64
            if ($processId -eq $application.Id) { $hostPrivate = $process.PrivateMemorySize64 }
            $process.Dispose()
        }
        if ($lastTime -gt 0) {
            $samples.Add([pscustomobject]@{ seconds = $now; sinceLaunchSeconds = $launchClock.Elapsed.TotalSeconds; processCount = $ids.Count; hostCpuPercent = $hostCpu; webviewCpuPercent = $webviewCpu; totalCpuPercent = $hostCpu + $webviewCpu; workingSetMiB = $workingSet / 1MB; privateMiB = $privateBytes / 1MB; hostPrivateMiB = $hostPrivate / 1MB })
        }
        $lastTime = $now
    }
    $sampleEndUnixMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($Minimized -and -not [UniverseMeasureWindow]::IsIconic($window)) { throw 'Native application window was restored during sampling.' }
    $finalIds = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -ge $application.StartTime -and ($ids.Contains([int]$_.ParentProcessId) -or $_.ProcessId -eq $application.Id) } | Select-Object -ExpandProperty ProcessId)
    if (@($finalIds | Where-Object { -not $ids.Contains([int]$_) }).Count -gt 0) { throw 'Process tree changed; rerun with a longer warmup.' }
    if ($application.HasExited) { throw 'Application exited during measurement.' }
    if ($Interaction) {
        if (-not $driver.WaitForExit(30000) -or $driver.ExitCode -ne 0) { throw "Interaction driver failed: $(Get-Content $driverError -Raw)" }
        $interactionEvidence = Get-Content $driverOutput | Select-Object -Last 1 | ConvertFrom-Json
        $aligned = @($interactionEvidence.samples | Where-Object { $_.atUnixMs -ge $sampleStartUnixMs -and $_.atUnixMs -le $sampleEndUnixMs } | Select-Object -ExpandProperty milliseconds | Sort-Object)
        if ($aligned.Count -lt 3) { throw 'Too few interactions in the CPU window.' }
        $interactionEvidence | Add-Member -NotePropertyName aligned -NotePropertyValue ([pscustomobject]@{ operations = $aligned.Count; medianMs = $aligned[[int][Math]::Floor($aligned.Count / 2)]; p95Ms = $aligned[[int][Math]::Ceiling($aligned.Count * 0.95) - 1]; p99Ms = $aligned[[int][Math]::Ceiling($aligned.Count * 0.99) - 1] })
    }
    if ($Orbit) {
        if (-not $driver.WaitForExit(30000)) { throw "Orbit driver timed out: $(Get-Content $driverOutput -Raw) $(Get-Content $driverError -Raw)" }
        if ((Get-Item $driverError).Length -gt 0) { throw "Orbit driver failed: $(Get-Content $driverError -Raw)" }
        $orbitEvidence = Get-Content $driverOutput | Select-Object -Last 1 | ConvertFrom-Json
        if (-not $orbitEvidence.changed -or $orbitEvidence.frames -le $orbitEvidence.drags) { throw 'Orbit driver did not confirm camera movement and rendered frames.' }
        $ipcWindow = @($orbitEvidence.ipcReadings | Where-Object { $_.atUnixMs -ge $sampleStartUnixMs -and $_.atUnixMs -le $sampleEndUnixMs })
        if ($ipcWindow.Count -lt [Math]::Max(3, $SampleSeconds - 3)) { throw "Orbit IPC readings do not cover the process sample window ($($ipcWindow.Count) readings)." }
        $ipcRates = @(for ($index = 1; $index -lt $ipcWindow.Count; $index++) {
            $elapsed = ($ipcWindow[$index].atUnixMs - $ipcWindow[$index - 1].atUnixMs) / 1000.0
            if ($elapsed -gt 0) { [Math]::Max(0.0, ($ipcWindow[$index].bytes - $ipcWindow[$index - 1].bytes) / $elapsed) }
        })
        $orbitEvidence | Add-Member -NotePropertyName ipcAligned -NotePropertyValue ([pscustomobject]@{ readings = $ipcWindow.Count; meanBytesPerSecond = ($ipcRates | Measure-Object -Average).Average; p95BytesPerSecond = @($ipcRates | Sort-Object)[[Math]::Min($ipcRates.Count - 1, [int][Math]::Ceiling($ipcRates.Count * 0.95) - 1)] })
    }
    $sortedCpu = @($samples.totalCpuPercent | Sort-Object)
    $breakdown = @(foreach ($processId in $ids) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $process) { continue }
        $metadata = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
        $role = if ($processId -eq $application.Id) { 'native-host' } elseif ($metadata.CommandLine -match '--type=([^ ]+)') { $Matches[1] } else { 'webview-browser' }
        [pscustomobject]@{ role = $role; meanCpuPercent = [double]$cpuTotals[$processId] / $samples.Count; workingSetMiB = $process.WorkingSet64 / 1MB; privateMiB = $process.PrivateMemorySize64 / 1MB }
        $process.Dispose()
    })
    $result = [ordered]@{
        capturedAt = (Get-Date).ToUniversalTime().ToString('o')
        build = 'release-x64'
        appVersion = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
        profile = 'normal'
        workload = if ($Interaction) { "$Interaction-native-cdp" } elseif ($Startup) { 'startup-memory-no-cdp' } elseif ($Orbit) { 'active-orbit-native-cdp' } elseif ($Minimized) { 'minimized' } else { 'idle' }
        warmupSeconds = if ($Startup) { 0 } else { $WarmupSeconds }
        sampleSeconds = $SampleSeconds
        sampleStartUnixMs = $sampleStartUnixMs
        sampleEndUnixMs = $sampleEndUnixMs
        logicalCpus = $logicalCpus
        cpuModel = (Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)
        osVersion = [Environment]::OSVersion.VersionString
        processCount = $ids.Count
        cpuMeanPercent = ($samples.totalCpuPercent | Measure-Object -Average).Average
        cpuMedianPercent = $sortedCpu[[int][Math]::Floor($sortedCpu.Count / 2)]
        cpuP95Percent = $sortedCpu[[Math]::Min($sortedCpu.Count - 1, [int][Math]::Ceiling($sortedCpu.Count * 0.95) - 1)]
        cpuP99Percent = $sortedCpu[[Math]::Min($sortedCpu.Count - 1, [int][Math]::Ceiling($sortedCpu.Count * 0.99) - 1)]
        hostCpuMeanPercent = ($samples.hostCpuPercent | Measure-Object -Average).Average
        webviewCpuMeanPercent = ($samples.webviewCpuPercent | Measure-Object -Average).Average
        workingSetMeanMiB = ($samples.workingSetMiB | Measure-Object -Average).Average
        workingSetPeakSampleMiB = ($samples.workingSetMiB | Measure-Object -Maximum).Maximum
        firstSampleSecondsAfterLaunch = $samples[0].sinceLaunchSeconds
        firstSampleWorkingSetMiB = $samples[0].workingSetMiB
        privateMeanMiB = ($samples.privateMiB | Measure-Object -Average).Average
        hostPrivateMeanMiB = ($samples.hostPrivateMiB | Measure-Object -Average).Average
        processesAtEnd = $breakdown
        samples = $samples
    }
    if ($Orbit) { $result['orbit'] = $orbitEvidence }
    if ($Interaction) { $result['interaction'] = $interactionEvidence }
    $null = [System.IO.Directory]::CreateDirectory($artifacts)
    $outputName = if ($Interaction) { "$Interaction-release.json" } elseif ($Startup) { 'startup-release.json' } elseif ($Orbit) { 'orbit-release.json' } elseif ($Minimized) { 'minimized-release.json' } else { 'idle-release.json' }
    $result | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $artifacts $outputName) -Encoding UTF8
    $archiveName = [System.IO.Path]::GetFileNameWithoutExtension($outputName) + '-' + (Get-Date -Format 'yyyyMMdd-HHmmssfff') + '.json'
    Copy-Item (Join-Path $artifacts $outputName) (Join-Path $artifacts $archiveName)
    $result.Remove('samples')
    $result | ConvertTo-Json
} finally {
    if ($null -ne $driver) {
        $driver.Refresh()
        if (-not $driver.HasExited) { $driver.Kill() }
        $driver.Dispose()
    }
    $application.Refresh()
    if (-not $application.HasExited) {
        $null = $application.CloseMainWindow()
        if (-not $application.WaitForExit(5000)) { $application.Kill() }
    }
    $application.Dispose()
}