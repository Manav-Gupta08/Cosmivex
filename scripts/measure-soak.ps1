param(
    [ValidateRange(30, 86400)][int]$DurationSeconds = 14400,
    [ValidateRange(1, 60)][int]$IntervalSeconds = 15,
    [ValidateRange(0, 300)][int]$WarmupSeconds = 30
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$executable = Join-Path $root 'apps/desktop/src-tauri/target/release/universe-os.exe'
if (-not (Test-Path $executable)) { throw 'Build the release executable first.' }
$artifacts = Join-Path $root 'artifacts'
$null = [System.IO.Directory]::CreateDirectory($artifacts)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
$prefix = Join-Path $artifacts "soak-$DurationSeconds-$stamp"
$config = Get-Content (Join-Path $root 'apps/desktop/src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$history = Join-Path (Join-Path $env:APPDATA $config.identifier) 'history.sqlite'
$executableHash = (Get-FileHash $executable -Algorithm SHA256).Hash
if (-not ('UniverseSoakWindow' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UniverseSoakWindow {
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
}
'@
}
$samples = [System.Collections.Generic.List[object]]::new()
$previous = @{}
$application = $null
$output = [System.IO.StreamWriter]::new("$prefix.jsonl", $false, [System.Text.UTF8Encoding]::new($false))
$output.AutoFlush = $true
$originalBrowserArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$originalQualification = $env:UOS_QUALIFICATION
$failure = $null
$shutdownPassed = $false
$clock = [System.Diagnostics.Stopwatch]::new()
$capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
$lastProgress = -600.0
try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $null
    $env:UOS_QUALIFICATION = $null
    $application = Start-Process -FilePath $executable -PassThru
    $null = $application.Handle
    $started = $application.StartTime
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $originalBrowserArgs
    $env:UOS_QUALIFICATION = $originalQualification
    if ($WarmupSeconds -gt 0) {
        Get-Counter '\System\System Up Time' -SampleInterval 1 -MaxSamples ($WarmupSeconds + 1) | Out-Null
    }
    $application.Refresh()
    $windowHandle = $application.MainWindowHandle
    if ($windowHandle -eq [IntPtr]::Zero) { throw 'Native soak window missing after warmup.' }
    $clock.Start()
    $count = [int][Math]::Ceiling($DurationSeconds / [double]$IntervalSeconds) + 1
    Get-Counter '\System\System Up Time' -SampleInterval $IntervalSeconds -MaxSamples $count | ForEach-Object {
        $application.Refresh()
        if ($application.HasExited) { throw 'Native host exited during the soak.' }
        $metadata = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -ge $started } | Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine)
        $ids = [System.Collections.Generic.HashSet[int]]::new()
        $null = $ids.Add($application.Id)
        do {
            $added = $false
            foreach ($entry in $metadata) {
                if ($ids.Contains([int]$entry.ParentProcessId) -and $ids.Add([int]$entry.ProcessId)) { $added = $true }
            }
        } while ($added)
        $now = $clock.Elapsed.TotalSeconds
        $current = @{}
        $processes = @(foreach ($entry in $metadata) {
            $processId = [int]$entry.ProcessId
            if (-not $ids.Contains($processId)) { continue }
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($null -eq $process) { continue }
            try {
                $identity = "$processId/$($entry.CreationDate.Ticks)"
                $cpuSeconds = $process.TotalProcessorTime.TotalSeconds
                $cpuPercent = $null
                if ($previous.ContainsKey($identity)) {
                    $elapsed = $now - $previous[$identity].seconds
                    if ($elapsed -gt 0) { $cpuPercent = [Math]::Max(0.0, ($cpuSeconds - $previous[$identity].cpuSeconds) / $elapsed / [Environment]::ProcessorCount * 100) }
                }
                $current[$identity] = @{ seconds = $now; cpuSeconds = $cpuSeconds }
                $role = if ($processId -eq $application.Id) { 'native-host' } elseif ($entry.CommandLine -match '--type=([^ ]+)') { $Matches[1] } else { 'webview-browser' }
                [pscustomobject]@{ id = $processId; role = $role; cpuPercent = $cpuPercent; workingSetMiB = $process.WorkingSet64 / 1MB; privateCommitMiB = $process.PrivateMemorySize64 / 1MB; pagedMiB = $process.PagedMemorySize64 / 1MB; handles = $process.HandleCount; threads = $process.Threads.Count }
            } catch {
                if ($processId -eq $application.Id) { throw }
            } finally { $process.Dispose() }
        })
        $previous = $current
        $database = @(foreach ($suffix in @('', '-wal', '-shm')) {
            $file = Get-Item "$history$suffix" -ErrorAction SilentlyContinue
            [pscustomobject]@{ suffix = $suffix; bytes = if ($null -eq $file) { 0L } else { $file.Length } }
        })
        $sample = [pscustomobject]@{
            atUnixMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            seconds = $now
            minimized = [UniverseSoakWindow]::IsIconic($windowHandle)
            foreground = [UniverseSoakWindow]::GetForegroundWindow() -eq $windowHandle
            processCount = $processes.Count
            totalCpuPercent = ($processes.cpuPercent | Measure-Object -Sum).Sum
            workingSetMiB = ($processes.workingSetMiB | Measure-Object -Sum).Sum
            privateCommitMiB = ($processes.privateCommitMiB | Measure-Object -Sum).Sum
            pagedMiB = ($processes.pagedMiB | Measure-Object -Sum).Sum
            handles = ($processes.handles | Measure-Object -Sum).Sum
            threads = ($processes.threads | Measure-Object -Sum).Sum
            databaseBytes = ($database.bytes | Measure-Object -Sum).Sum
            database = $database
            processes = $processes
        }
        $samples.Add($sample)
        $output.WriteLine(($sample | ConvertTo-Json -Depth 5 -Compress))
        if ($now - $lastProgress -ge 600) {
            Write-Output ("Soak {0:N0}/{1}s: {2} processes, private {3:N1} MiB, {4} handles, {5} threads" -f $now, $DurationSeconds, $sample.processCount, $sample.privateCommitMiB, $sample.handles, $sample.threads)
            $lastProgress = $now
        }
    }
    if ($samples.Count -lt 2 -or $samples[$samples.Count - 1].seconds - $samples[0].seconds -lt $DurationSeconds) { throw 'Measured sample span is shorter than requested.' }
    $application.Refresh()
    if (-not [UniverseSoakWindow]::PostMessageW($windowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Could not request native soak window shutdown.' }
    if (-not $application.WaitForExit(5000)) { throw 'Native soak shutdown exceeded five seconds.' }
    $shutdownPassed = $true
} catch {
    $failure = $_.Exception.Message
} finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $originalBrowserArgs
    $env:UOS_QUALIFICATION = $originalQualification
    $clock.Stop()
    $output.Dispose()
    if ($null -ne $application) {
        $application.Refresh()
        if (-not $application.HasExited) {
            $null = $application.CloseMainWindow()
            if (-not $application.WaitForExit(5000)) { $application.Kill(); $application.WaitForExit() }
        }
        $application.Dispose()
    }
    $summary = [ordered]@{
        capturedAt = $capturedAt
        executableSha256 = $executableHash
        workload = 'normal-live-idle-recording-off-no-cdp'
        requestedSeconds = $DurationSeconds
        warmupSeconds = $WarmupSeconds
        intervalSeconds = $IntervalSeconds
        sampleCount = $samples.Count
        minimizedSamples = @($samples | Where-Object minimized).Count
        foregroundSamples = @($samples | Where-Object foreground).Count
        measuredSpanSeconds = if ($samples.Count -gt 1) { $samples[$samples.Count - 1].seconds - $samples[0].seconds } else { 0 }
        completed = $null -eq $failure -and $shutdownPassed -and $samples.Count -eq $count
        shutdownPassed = $shutdownPassed
        failure = $failure
        cpuModel = (Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)
        osVersion = [Environment]::OSVersion.VersionString
        logicalCpus = [Environment]::ProcessorCount
        caveats = @('Idle live view only; no synthetic telemetry or history writes requested.', 'PrivateMemorySize64 is private committed process memory; summed working sets may double-count shared pages.', 'CPU includes only processes present at sample times; exited-between-sample processes are missed.', 'GPU memory, queue depth and JS object counts are not collected by this sampler.', 'Database sizes include pre-existing user history; no database content is read or changed by the sampler.', 'Completion is not a leak-free verdict; inspect the full time series and workload coverage.')
    }
    $cpuValues = @($samples | Select-Object -Skip 1 -ExpandProperty totalCpuPercent | Sort-Object)
    $summary['cpuPercent'] = @{ mean = ($cpuValues | Measure-Object -Average).Average; p95 = if ($cpuValues.Count) { $cpuValues[[int][Math]::Ceiling($cpuValues.Count * 0.95) - 1] } else { $null } }
    foreach ($metric in @('workingSetMiB', 'privateCommitMiB', 'pagedMiB', 'handles', 'threads', 'databaseBytes')) {
        $values = @($samples | Select-Object -ExpandProperty $metric)
        $summary[$metric] = @{
            first = $values | Select-Object -First 1
            last = $values | Select-Object -Last 1
            peak = ($values | Measure-Object -Maximum).Maximum
            firstTenMinuteMean = if ($samples.Count) { ($samples | Where-Object { $_.seconds -le $samples[0].seconds + 600 } | Measure-Object -Property $metric -Average).Average } else { $null }
            lastTenMinuteMean = if ($samples.Count) { ($samples | Where-Object { $_.seconds -ge $samples[$samples.Count - 1].seconds - 600 } | Measure-Object -Property $metric -Average).Average } else { $null }
        }
    }
    $summary | ConvertTo-Json -Depth 5 | Set-Content "$prefix-summary.json" -Encoding UTF8
    Write-Output "Soak report: $prefix-summary.json"
}
if ($failure) { throw $failure }