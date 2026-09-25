# Phase 2: real process telemetry

Status: Phase 2 implemented and verified on Windows 11 x64, 2026-09-25. This is a
process-observation milestone, not completion of Universe OS. The inherited
working-set budget deviation remains open.

## Native collector

- Windows Toolhelp supplies the observed PID, executable name, parent PID and
  thread count. Names are UTF-8. No executable path or file contents are read.
- GetProcessTimes supplies creation identity and cumulative CPU ticks.
- K32GetProcessMemoryInfo supplies working set, not private bytes. Minimal query
  rights are tried first; a read/query handle is requested only if needed.
- CPU = delta(kernel + user ticks) / elapsed monotonic time / all active logical
  CPUs. Display range is 0-100% of machine capacity, not per-core percentage.
- First sample, changed creation identity, inaccessible timing, or a backwards
  counter produces unavailable CPU. Permission errors are retained as Win32 codes.
- Every observed lifetime receives an engine-local generation. Without creation
  time identity is weak: an unobserved exit/reuse between polls cannot be detected.
- Snapshot failure is explicit, not an apparently valid empty list. Collection is
  cancelable, capped at 4,096 records and marks truncation. No handle cache, history
  writes, driver, elevated tracing, or renderer dependency.

## Native validation

CTest covers exact synthetic CPU deltas, identity reuse, missing/denied fields,
counter rollback, disappearance, collection failure, real own-process identity
compared with an independent OS call, cancellation, repeated handle cleanup, and a
controlled child process appearing with the correct parent PID then disappearing.
Synthetic observations exist only in native tests. Test workloads use their own
short-lived child process and never manipulate unrelated processes.

Run `ctest --test-dir build/core -C Release --output-on-failure`. Runtime throughput
and whole-app results from the integration are below.

## Integration and visualization

The engine collects off-lock and publishes an immutable shared snapshot. The C ABI
uses owned snapshot handles, bounds-checked POD row access and UTF-8 string views
valid until release. Rust copies strings while the handle is alive and keeps its
decoded snapshot in an Arc, avoiding deep copies when channel frames are cloned.
Acquisition checks the health sequence, so configuration races retry rather than
pairing process rows with mismatched health. Stop requests cancel collection.

Protocol 2 adds process snapshots to the acknowledged stream. Protocol 1 clients
are rejected explicitly. PID/parent/thread count use bounded integers, CPU is
nullable, and byte counts/creation FILETIME are decimal strings to preserve 64-bit
precision. Creation times are also converted to Unix milliseconds for display.
Each snapshot reports collection time, observation time, errors and truncation.
The existing one-frame-in-flight rule and latest-state coalescing are retained.

Process collection starts enabled in the desktop, but the native engine remains
configurable and its API starts disabled. The visible checkbox switches collection
on/off and clears the displayed process universe when off. Eco waits 2 seconds
between scans; Normal/Cinematic wait 1 second. Actual cadence includes collection
duration. Switching collection resets CPU baselines.

Process IDs drive a deterministic presentation layout and one instanced sphere
batch. This layout does not claim a hierarchy or application relationship. GPU
matrix buffers update only for changed identities, search filtering or selection,
not each CPU sample. Geometry/materials are shared and disposed with the scene.
Camera focus and star picking use the same IDs as search and the list. The process
list renders at most 50 rows, supports name/PID/CPU/memory sorting, and pages.
An exited selection remains inspectable as a last observation. Loss of collection
or IPC is not mislabeled as process termination. Parent PID is shown as observed,
not resolved to an unverified current parent name.

## Verification results

- CMake Release: 2 test executables pass, including real child creation/exit,
  snapshot lifetime after replacement, invalid bounds, cancellation and handle cleanup.
- Cargo: 3 tests pass, including actual own-process records through the C ABI.
- Frontend: 15 tests pass for wire validation, transport failures/cleanup, duplicate
  rejection, stable instance IDs, process search/selection, null metrics, stale
  selections and pagination. Strict TypeScript build and both linters pass.
- Release Tauri executable built and ran without elevation. Native smoke covers
  profile round-trips, collection toggling, reload, close/reopen and WebGL recovery.
- A controlled Node process uses 64 MiB of touched memory and roughly 15% of one
  core. The inspector reported PID 17908, 1.92% machine CPU and 121.4 MiB working
  set; independent Windows readings were 2.10% and 121.75 MiB. A second run measured
  1.92% vs 2.18%, and 121.6 vs 121.48 MiB. Intervals are not simultaneous, so tests
  use tolerances, not equality. Parent PID matches the test launcher.
- The verifier ends only its own workload and observes `No longer observed` in
  the inspector. Clicking the focused real star selects that same PID.
- 1360x820 and 400x740 screenshots captured; nonblank pixel checks, process panel
  overflow checks, camera movement, direct picking and idle frame stability pass.
  No JavaScript page errors. Artifacts are local and ignored by Git.
- At approximately 260-265 processes: 5 draw calls total (1 instanced process batch
  plus 4 reference objects), 57-59 KB/s snapshot payload, about 15-20 ms collection
  duration. One observed CPU draw-submission sample was 0.3-0.4 ms, not GPU timing.

## Resource measurement

Release 0.2.0, Normal, collection enabled, diagnostics closed, no debugging port.
Intel i7-6700, 8 logical processors, Windows 11 build 26200, WebView2 153.0.4234.48.
30-second warmup and 60 one-second samples; seven application processes. Captured
2026-09-25T06:29:43Z. CPU normalized by total logical CPU capacity.

| Metric | Phase 2 | Phase 1 reference |
| --- | --- | --- |
| Whole-app mean CPU | 0.527% | 0.114% |
| CPU median / p95 / p99 | 0.378% / 1.134% / 1.697% | 0% / 0.384% / 1.701% |
| Native host mean CPU (C++ + Rust) | 0.287% | 0.0063% |
| WebView mean CPU | 0.240% | 0.108% |
| Summed working set | 386.2 MiB | 369.9 MiB |
| Summed private memory | 169.8 MiB | 158.6 MiB |
| Native host private memory | 5.31 MiB | 6.17 MiB |

These are single-run observations, not controlled statistical comparisons or
guarantees. Process populations and other machine activity can differ. Mean idle
CPU remains below 1%, but p95/p99 exceed it. The 250 MiB summed working-set target
is still missed; shared pages may be counted more than once. Private memory is
reported separately, not substituted for that target.

## Remaining scope and limits

- No galaxy grouping, process-tree edges, individual thread bodies, process state
  inference, event history or lifecycle effects yet. CPU/memory currently appear
  as factual readouts; they do not modulate brightness/size until Phase 5.
- Collection is capped at 4,096 records. Full snapshots are bounded by row count
  and field length, not yet chunked to the architecture's eventual 1 MiB transport
  cap. Large-count/chunk/delta work remains necessary before raising this limit.
- No permission escalation. Protected process metrics can be unavailable; UI
  shows their Win32 error codes. Weak identities cannot detect reuse between polls.
- First CPU sample is unavailable. Missed short-lived processes and sampling races
  are inherent in the baseline poller; no exact termination timestamp is claimed.
- No active-frame-rate qualification, GPU timer query, multi-hour leak soak, or
  10k/50k/100k synthetic renderer benchmark yet. Those remain later gates.
- Commit cadence: the standalone native collector is a separate feature commit
  (`3b356ed`); native-to-visual integration is committed only after runtime checks.

Next major phase: validated process ancestry and application grouping. Keep the
current profile/IPC budgets and remeasure before adding animation or higher detail.