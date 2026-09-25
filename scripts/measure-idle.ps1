param([int]$WarmupSeconds = 30, [int]$SampleSeconds = 60)
$ErrorActionPreference = 'Stop'
if ($WarmupSeconds -lt 1 -or $SampleSeconds -lt 5) { throw 'Use at least 1 second warmup and 5 seconds sampling.' }
$root = Split-Path $PSScriptRoot -Parent
$executable = Join-Path $root 'apps/desktop/src-tauri/target/release/universe-os.exe'
if (-not (Test-Path $executable)) { throw 'Build the desktop release first.' }
$application = Start-Process -FilePath $executable -PassThru
try {
    Get-Counter '\System\System Up Time' -SampleInterval 1 -MaxSamples ($WarmupSeconds + 1) | Out-Null
    $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)
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
    $samples = New-Object 'System.Collections.Generic.List[object]'
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $lastTime = 0.0
    Get-Counter '\System\System Up Time' -SampleInterval 1 -MaxSamples ($SampleSeconds + 1) | ForEach-Object {
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
                if ($processId -eq $application.Id) { $hostCpu += $percent } else { $webviewCpu += $percent }
            }
            $previous[$processId] = $cpu
            $workingSet += $process.WorkingSet64
            $privateBytes += $process.PrivateMemorySize64
            if ($processId -eq $application.Id) { $hostPrivate = $process.PrivateMemorySize64 }
            $process.Dispose()
        }
        if ($lastTime -gt 0) {
            $samples.Add([pscustomobject]@{ seconds = $now; hostCpuPercent = $hostCpu; webviewCpuPercent = $webviewCpu; totalCpuPercent = $hostCpu + $webviewCpu; workingSetMiB = $workingSet / 1MB; privateMiB = $privateBytes / 1MB; hostPrivateMiB = $hostPrivate / 1MB })
        }
        $lastTime = $now
    }
    $finalIds = @(Get-CimInstance Win32_Process | Where-Object { $ids.Contains([int]$_.ParentProcessId) -or $_.ProcessId -eq $application.Id } | Select-Object -ExpandProperty ProcessId)
    if (@($finalIds | Where-Object { -not $ids.Contains([int]$_) }).Count -gt 0) { throw 'Process tree changed; rerun with a longer warmup.' }
    if ($application.HasExited) { throw 'Application exited during measurement.' }
    $sortedCpu = @($samples.totalCpuPercent | Sort-Object)
    $breakdown = @(foreach ($processId in $ids) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $process) { continue }
        $metadata = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
        $role = if ($processId -eq $application.Id) { 'native-host' } elseif ($metadata.CommandLine -match '--type=([^ ]+)') { $Matches[1] } else { 'webview-browser' }
        [pscustomobject]@{ role = $role; workingSetMiB = $process.WorkingSet64 / 1MB; privateMiB = $process.PrivateMemorySize64 / 1MB }
        $process.Dispose()
    })
    $result = [ordered]@{
        capturedAt = (Get-Date).ToUniversalTime().ToString('o')
        build = 'release-x64'
        profile = 'normal'
        warmupSeconds = $WarmupSeconds
        sampleSeconds = $SampleSeconds
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
        privateMeanMiB = ($samples.privateMiB | Measure-Object -Average).Average
        hostPrivateMeanMiB = ($samples.hostPrivateMiB | Measure-Object -Average).Average
        processesAtEnd = $breakdown
        samples = $samples
    }
    $artifacts = Join-Path $root 'artifacts'
    $null = [System.IO.Directory]::CreateDirectory($artifacts)
    $result | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $artifacts 'idle-release.json') -Encoding UTF8
    $result.Remove('samples')
    $result | ConvertTo-Json
} finally {
    $application.Refresh()
    if (-not $application.HasExited) {
        $null = $application.CloseMainWindow()
        if (-not $application.WaitForExit(5000)) { $application.Kill() }
    }
    $application.Dispose()
}