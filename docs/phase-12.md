# Phase 12: representative performance qualification and deviations

Phase 11 is functionally verified. The native release orbit, idle and
minimized runs below record what has been measured and what remains unverified.
Active orbit misses the CPU and cadence review budgets; the Diagnostics-open
run also misses the CPU submission budget. This is a qualification record,
not a claim that all performance gates pass or a release tag.

## Latest verified evidence

These results supersede earlier missing-measurement and replay-risk statements
below. Hardware remains Windows 11 build 26200, i7-6700, eight logical CPUs,
WebView2 153. No review budget has been revised or waived.

Replay's intermittent empty timeline was reproduced: selecting the already
selected session cleared loaded state but did not retrigger its effect. The
handler now leaves that selection unchanged. A red/green regression and three
subsequent full native workflows passed, including the final rebuilt release.

Two local-pointer orbit trials used 30 seconds of warmup and 60 one-second
whole-app samples each, recording off, Diagnostics open, normal profile.
Local pointer dispatch removes repeated CDP input commands; these are not
controlled A/B comparisons with the earlier remote-input runs.

| Metric | Trial 1 | Trial 2 |
| --- | ---: | ---: |
| Whole-app CPU mean | 5.82% | 5.63% |
| Whole-app CPU p95 | 7.95% | 7.22% |
| Summed working set mean | 490.9 MiB | 490.5 MiB |
| CPU submission p95 | 0.8 ms | 0.7 ms |
| CPU frame callbacks/render p95 | 0.9 ms | 0.8 ms |
| GPU execution p95 | 4.63 ms | 1.84 ms |
| Paired CPU + GPU work p95 | 5.26 ms | 2.90 ms |
| Moving interval p95 | 17.3 ms | 17.4 ms |
| GPU-query completion upper bound p95 | 17.7 ms | 17.6 ms |
| Parse/apply p95 | 7.9 ms | 6.8 ms |
| Chunk validation/assembly p95 | 5.8 ms | 5.4 ms |
| Reconstruction p95 | 0.9 ms | 1.0 ms |
| Store update p95 | 2.1 ms | 1.8 ms |
| Aligned JSON-envelope RX mean | 46,820 B/s | 44,770 B/s |

GPU queries are asynchronous and bounded to four pending samples. CPU + GPU
work is summed for the same frame before calculating p95, not the sum of two
percentiles. CPU and GPU can overlap, so this is a conservative work sum,
not exact presentation latency. Query completion includes the delay until a
later frame polls it; idle pauses can inflate it. Neither cadence nor query
completion is an exact total CPU/GPU/presentation measurement. Instrumentation
does not request idle frames. Frame samples retain the most recent 4,096.
Frame/parse percentiles cover their recent sample window rather than exactly
the sampler's 60-second CPU window; byte-rate readings are time-aligned.

Parse/apply now accumulates work over every accepted chunk in a transfer,
excluding delivery waits, with an exact multi-chunk timing regression. It
starts at the parsed Tauri callback, so native serialization and Tauri's own
outer JSON decoding are outside its scope. Byte totals include serialized
snapshot JSON envelopes and escaped payload text, not just payload bytes.
ACK commands, other commands and Tauri/WebView transport framing are excluded.
Full transport-byte accounting and exact presentation latency remain open.

Selection, focus and replay each received a separate 30-second warmup and
60-sample whole-app run:

| Workload | CPU mean / p95 | Working set mean | Aligned operations | Action p95 |
| --- | ---: | ---: | ---: | ---: |
| Selection | 8.87% / 14.47% | 523.5 MiB | 62 | 606 ms |
| Focus | 7.01% / 9.07% | 484.9 MiB | 67 | 748 ms |
| Replay | 4.36% / 6.18% | 519.6 MiB | 61 | 1,086 ms |

Full JSON reports retain per-second CPU/memory and per-operation durations.
Action timing includes CDP, the expected visible state, and two animation
frames. It is not isolated input latency or a camera-settled/GPU measurement.
Selection/focus use observed processes; replay uses real recorded checkpoints.

The startup probe discovered the growing native process tree without warmup.
Its first sample was at 5.84 seconds: 429.3 MiB summed working set; ten samples
peaked at 441.1 MiB and averaged 433.7 MiB. Host-private mean was 6.52 MiB.
CIM discovery overhead means this is neither memory at process creation nor
an exact first-ready peak. Summed process working sets can double-count shared
pages. The 250 MiB whole-app review target is still not met.

Native aggregate rendering at 10k/50k/100k and two viewport sizes passed six
60-second trials with 1,024 displayed instances, screenshots, pixel and picking
checks. Topology still took up to 497 ms. See Phase 10 for workload limitations.
The two-minute Rust-to-WebView pressure run generated six million synthetic
events at 49,994/s with 250 ms delayed acks, one pending transfer maximum, a
256-event ring, explicit gaps, and a drained final cursor. It delivered
111,360 rows and reported 5,888,640 gaps; JSON envelopes totalled 36,288,148
bytes (302,367 B/s), isolated parse/apply p95 was 4.9 ms, and 120 heap samples
ranged from 13.6-50.7 MB with collection drops. This is not lossless throughput,
production OS collection at that rate, or a total-native-memory soak proof.
The ordinary-launch command rejection check passed.

The rebuilt final host passed the full native workflow plus CDP-only,
minimize-only, and five consecutive visibility/camera tests with ordinary
shutdown within five seconds and reopening. Earlier shutdown failures were
not conclusively explained: orderly worker shutdown completed in probes,
but window destruction/application-exit experiments still timed out and were
reverted. No forced termination counts as a pass. Retain the intermittent
history as a reliability risk rather than claim a proven teardown fix.

Final source gates: 67 frontend tests, 20 release Rust tests, seven CTest
executables, lint, release Clippy, and production/native release build pass.
The existing large frontend bundle warning remains. No completion tag was
created. Active CPU, parse/apply and moving-cadence budgets still fail;
full-detail 100k interaction, long-duration total-memory behavior, exact
presentation timing, and full IPC framing remain unqualified. These require
further engineering or explicit acceptance decisions, not a silent target
change.

## Earlier measurements

The following records retain the earlier remote-CDP input and diagnostic
experiments. Their missing GPU/interaction/pressure statements are superseded
by the latest evidence above; earlier numbers are not overwritten.

## Active orbit baseline

From the repository root after `npm run desktop:build`, run
`.\scripts\measure-idle.ps1 -Orbit`. The existing sampler launches its own
release app in the normal profile, enables loopback CDP on port 9224 for that
child only, and starts a separate Playwright controller. The controller selects
Universe view at 1360x820 and repeatedly drags the real canvas. It verifies a
changed screenshot and advancing frame counter; it does not inject synthetic
telemetry into the app. The sampler waits 30 seconds before recording 60
one-second samples of the native host and descendant WebView2 processes, then
closes only its own app. The controller runs beyond the sample window so that
orbit continues throughout sampling. Results with per-second samples and
process-role breakdown are written to ignored `artifacts/orbit-release.json`;
the idle script without `-Orbit` still writes `artifacts/idle-release.json`.
Use `-WarmupSeconds` and `-SampleSeconds` for a shorter smoke check (orbit
requires at least 20 and 5 seconds, respectively).

One 60-second run on Windows 11 build 26200, i7-6700 (8 logical CPUs), release
0.9.0, recording off, 30-second warmup: seven-process whole-app CPU mean
10.622%, median 10.524%, p95 12.417%, p99 13.810%. Native host mean 0.466%; WebView
descendants mean 10.155%. Summed working set mean 469.4 MiB, summed private mean
238.8 MiB, native host private mean 6.87 MiB. The controller completed 673 drags
and observed 6,056 rendered frames and a changed canvas across its 105-second
run (these frame counts include warmup and time after the CPU sample). This
continuous drag workload exceeds the <3% normal-interaction CPU review budget;
the observed working set also exceeds the 250 MiB initial review target, though
this is an active rather than initial measurement. No controlled idle/active
pair or repeated trials were run, and background system activity was not
controlled. CDP remote debugging and the external Playwright driver can affect
the app's measured WebView load; the driver itself is excluded from the app
process tree. Process discovery also excludes descendants older than the app
launch to avoid attributing pre-existing WebView processes after parent PID
reuse. Do not attribute the entire CPU excess to ordinary user orbit.

## Instrumented orbit follow-up

After rebuilding the 0.9.0 release with bounded renderer diagnostics, a
separate 30-second warmup / 60-second active sample on the same machine recorded
whole-app CPU mean 11.878%, median 11.614%, p95 15.193%, p99 18.135% across seven
processes; host mean 0.460%, WebView descendants mean 11.417%. Summed working set
mean was 475.2 MiB and private memory mean was 234.7 MiB. The orbit controller
completed 657 drags and observed 5,759 frames over its 105-second workload.
The renderer's most recent 4,096 submitted frames had a CPU submission p95 of
1.00 ms, below the 4 ms CPU submission review budget for this workload. This
uses `performance.now()` around `gl.render`; it is not total frame time and
does not measure GPU completion. It is a bounded recent-frame window that
overlaps but does not exactly match the 60-second process sample. GPU time
remains unavailable.

The cumulative store received about 44.5 KiB/s of snapshot payload during the
105-second controller window (below the 1 MiB/s normal IPC review budget).
This is an average of bytes accepted by the frontend, not total transport
traffic, a per-second distribution, or a sample aligned exactly with process
CPU. The later aligned run below addresses payload distribution, not transport
overhead. The external controller and CDP caveats above still apply; a normal
uncontrolled user session is not qualified by this run.

## Minimized versus visible idle

Run `.\scripts\measure-idle.ps1 -Minimized` after building the release app.
The sampler launches a fresh native app, warms it up for 30 seconds, minimizes
only its own window through Win32 and checks `IsIconic` before and after taking 60
one-second process-tree CPU and memory samples. No CDP controller is attached.
The JSON result is stored in ignored `artifacts/minimized-release.json`. The
plain sampler command launches a separate visible app with the same warmup and
sample windows and stores `artifacts/idle-release.json`.

On the same i7-6700/Windows 11 machine and rebuilt 0.9.0 release, each run had
seven app processes. The final minimized run had CPU mean 0.890%, median 0.756%,
p95 1.714%, p99 2.060%; host mean 0.370%, WebView descendants mean 0.520%. Visible idle CPU
mean 0.865%, median 0.754%, p95 1.686%, p99 2.065%; host mean 0.321%, WebView
descendants mean 0.544%. Mean summed working set was 411.0 MiB minimized and
411.9 MiB visible; mean private memory was 181.0 and 179.9 MiB, respectively.
An earlier full minimized run measured 0.831% CPU and 405.4 MiB working set;
these differences indicate run-to-run variation, not a repeatable improvement.
This is two sequential runs, not simultaneous paired samples. Neither run
measures frame count or proves `document.hidden`, rendering pause or restore
recovery; Windows confirmed only the minimized window state. Both measured
working sets exceed the 250 MiB *initial* review budget, but these are
post-warmup observations and cannot establish initial-memory compliance.

## Moving cadence and native recovery

A rebuilt release run on the same machine recorded 60 seconds of active orbit
after 30 seconds warmup: whole-app CPU mean 12.896%, p95 15.205%, seven-process
working set mean 469.6 MiB. The 105-second controller completed 676 drags and
5,914 frames; recent 4,096 moving-frame intervals had p95 32.2 ms, above the
16.7 ms normal cadence review budget. CPU submission p95 was 1.00 ms, and
snapshot payload averaged 46.3 KiB/s across the controller run. These are
intervals between actual moving frame submissions, excluding known camera
sleep gaps; they include scheduling and driver effects but are not total
CPU+GPU render times or GPU timer queries. The full moving interval window
overlaps but is not aligned to the 60-second process sample. The earlier
short check also measured 32.7 ms p95.

A follow-up with the pointer held down for continuous back-and-forth camera
movement (rather than discrete button-up drags) still missed the cadence
budget: a 30-second warmup and 60-second sample measured 11.970% mean CPU,
13.731% CPU p95, 485.7 MiB mean seven-process working set and 225.7 MiB mean
private memory. The 105-second controller produced 5,768 frames over 364
continuous sweeps; recent moving-frame interval p95 was 32.5 ms, CPU
submission p95 was 1.00 ms, and snapshot payload averaged 48.3 KiB/s. A
five-second short smoke had yielded 25.5 ms p95, but did not predict the full
run. Both orbit modes use CDP, and neither is a GPU-completion measurement.

Native WebView2 does not set `document.hidden` when the Windows app is
minimized on this machine. The renderer now checks Tauri's minimized state on
window focus and resize events as well as the browser visibility event. The
focused release WebView check observed zero additional rendered frames over
three seconds while minimized and a changed canvas from keyboard orbit after
restoration. This proves pause and resumed interaction for that run, not
general background/occlusion behavior. Early focused checks passed rendering
but timed out during automated close. The later default full native workflow
passes ordinary shutdown and reopen; replay loading remains intermittent.

The rebuilt release, frontend lint and all 64 frontend tests pass. All seven
release CTest executables and 20 Rust library tests pass, including the
isolated journal and bridge pressure cases documented in Phase 10. These do
do not exercise a sustained 50k-events/s producer through collection, IPC and
the native WebView. An early no-CDP, never-minimized release app became
unresponsive when closed immediately after input idle, while the warmed
ordinary app closed promptly. Removing the synchronous `Destroyed` shutdown
callback in a reversible build did not change that immediate-close hang; it
was restored. A debug-profile Rust test rebuild hit an unrelated linker-cache error
(`LNK1103`, corrupted `quick_xml` debug information); all 20 Rust tests pass
in the release profile. No native source change remains from the probe.
Further isolation: a 30-second warmed ordinary release app (no CDP) closed in
0.11 seconds; with a loopback debugging port but no CDP attachment it closed
in 0.09 seconds. CDP attach/detach without a minimize operation passed the
verifier's close-and-reopen gate. Win32 minimize/restore without CDP closed in
0.08 seconds. The timeout is confined to the combined CDP-driven visibility
workflow in these checks, not established for ordinary warmed app operation.
Under CDP, viewport resizing without minimization also passed close/reopen.
With CDP and a Win32 minimize/restore but no Diagnostics or screenshots,
the verifier still exceeded its five-second close gate. Removing the native
minimized-state listener in a reversible build did not remove that timeout;
it also allowed four frames in a three-second minimized interval, so the
listener was restored. Posting the normal Windows close message before CDP
disconnect did not resolve the timeout. Reproduce the distinction with
`.\scripts\verify-desktop.ps1 -ConnectOnly` (passes) and
`.\scripts\verify-desktop.ps1 -MinimizeOnly` (times out); each cleans up only
its own app. This is an automated WebView2/CDP interaction, not a demonstrated
ordinary-user shutdown failure.

## Aligned payload and workflow verification

With Diagnostics open during a continuous orbit, the WebView recorded
timestamped cumulative payload readings while the release sampler measured
the same seven-process app for 60 seconds after a 30-second warmup. The
60 readings within the CPU window gave a payload receive-rate mean of
53,468 B/s and p95 of 105,740 B/s (under the 1 MiB/s payload review budget).
Whole-app CPU mean was 10.347%, p95 14.479%, summed working set mean 505.1 MiB;
CPU submission p95 was 4.2 ms and moving-frame interval p95 36 ms over the
recent frame window. An open Diagnostics panel and CDP impose overhead; the
byte rate counts received payload only, not full transport or OS-level traffic.
The app was still live and no synthetic process rows were injected.
The submission result exceeds the 4 ms review budget in this run, while the
moving interval exceeds 16.7 ms; neither is a GPU completion measurement.

## Renderer and transport follow-up

The normal-profile frame limiter now accepts demand callbacks within 2 ms of
the nominal 60 Hz interval instead of 0.5 ms. A full, separate 30-second
warmup / 60-second release orbit with Diagnostics open measured moving-frame
interval p95 18.5 ms, CPU submission p95 1.2 ms, whole-app CPU mean 12.46%
and working set mean 506.2 MiB. This improved on the earlier 36 ms cadence
but still misses the 16.7 ms review budget; CPU is higher. The open panel,
CDP driver and independent trial noise prevent attributing all changes to
the limiter. The full native workflow passed after this renderer change.

Frontend native-channel instrumentation now records bounded recent p95
latencies for packet validation, frame reconstruction and store update. The
first full run measured parse+apply p95 16.6 ms, above the 2 ms review budget.
Reconstructed frames now retain the existing graph/interval invariants while
reusing already validated packet and prior-frame fields instead of running
another full schema traversal. Stream regressions cover invalid galaxy counts
and profile intervals. One full 60-second orbit after this change measured
parse+apply p95 11.8 ms (assembly 7.5 ms, reconstruction 1.4 ms, store update
2.8 ms); moving interval p95 23.5 ms, submission p95 1.4 ms, CPU mean 12.20%
and summed working set mean 504.7 MiB. Aligned snapshot payload rate averaged
41,466 B/s with p95 69,664 B/s. P95 component values are independent
distributions and must not be summed. This is one release run, not a controlled
paired comparison; the 2 ms parse+apply and 16.7 ms moving-frame budgets still
fail. The native workflow subsequently passed, though two attempts stalled
at replay load and another picked the opposite endpoint of a controlled local
TCP pair. The smoke accepts either endpoint for that spatial pick and prints
native checkpoint availability only if replay loading times out again.

The full rebuilt release WebView smoke passes live process/resources, network,
filesystem, recording and read-only replay, desktop/narrow canvases, demand
render idle with both native collectors paused, renderer recovery, ordinary
shutdown and reopen. Earlier runs hit intermittent network-picking and replay
loading assertions; they are not erased by the passing run. A separate
`-VisibilityOnly` check passes minimized frame pause (zero new frames in three
seconds) and restored keyboard orbit, then intentionally terminates only its
own CDP diagnostic process because the combined CDP/minimize path fails the
ordinary close check. Ordinary shutdown is verified in the default run.
Release CTest (7), Rust library tests (20), frontend tests (64) and the
isolated 10k/50k/100k Vitest benchmarks (12) pass. The synthetic 100k topology
rebuild averaged 249 ms and far selection 78 ms in this rerun; these are not
native 100k WebView frame timings or sustained end-to-end producer results.

## Remaining gates

- Measure total frame-time p95 and GPU timer data where supported. Moving
  cadence p95 misses the 16.7 ms review budget under the continuous CDP orbit
  workload; GPU completion remains unavailable.
- Frontend parse+apply p95 misses the 2 ms review budget; packet assembly and
  validation now dominate the measured receive path. Repeated controlled
  trials are needed before attributing a stable gain to reconstruction changes.
- Measure total transport traffic (including envelope overhead) separately
  from the now-aligned frontend payload distribution.
- Compare selection, focus and replay under timed native release workloads;
  qualify Phase 10's bounded behavior under sustained collector
  and slow-consumer pressure without mixing synthetic data into live state.
- Repeat controlled runs and assess CDP measurement overhead before claiming
  the <3% CPU and <250 MiB initial working-set review budgets pass or fail for
  ordinary operation. The earlier idle result is documented in Phase 11.