# Performance Results

Recorded on Windows 11 x64 between September 25 and October 1, 2026.
These are local measurements, not hardware-independent guarantees. The application
has passed functional checks, but several resource targets remain unmet.
See [Engineering Audit](engineering-audit.md) for outstanding implementation and
verification work.

## Test Environment

| Component | Recorded configuration |
| --- | --- |
| Processor | Intel Core i7-6700, 3.40 GHz, 8 logical processors |
| Operating system | Windows 11, build 26200 |
| WebView | Microsoft Edge WebView2 153.0.4234.48 |
| Native build | Release x64, C++20, MSVC; Rust 1.98.1 |
| JavaScript tooling | Node.js 24.16.0, npm 11.13.0; Vitest 5 |
| Display checks | 1360 x 820 desktop and 400 x 740 narrow viewport |

Unless noted otherwise, idle tests used the Normal profile, closed diagnostics,
no remote debugger, a 30-second warmup and 60 one-second samples. Process collection
was enabled after the basic-shell baseline. Network collection was enabled in
later builds. Recording was off; filesystem tests without a selected root did
not measure active-watch overhead. Most runs included the native host and six
WebView subprocesses. Other system activity was not controlled.

CPU percentages are normalized to total logical processor capacity. Host CPU
includes both C++ and Rust. Summed working sets can count shared pages more than
once; they are not unique physical-memory usage. Private memory is a separate
metric, not a replacement for the working-set target. Collection durations and
JavaScript timings are wall-clock costs, not isolated thread CPU measurements.

## Review Targets

| Metric | Target | Evidence and current limitation |
| --- | --- | --- |
| Idle whole-app CPU | <1% mean | Most short idle runs meet this; tails and one unexplained high-CPU run remain |
| Normal interaction CPU | <3% mean | Local-pointer orbit: 5.63-5.82%; target missed |
| Initial summed working set | <250 MiB | First startup sample: 429.3 MiB; target missed |
| Native baseline private memory | <32 MiB | Short idle means: 5.31-7.10 MiB; not a long-run bound |
| Moving frame interval | About 16.7 ms p95 | Local-pointer orbit: 17.3-17.4 ms; target missed |
| CPU draw submission | <=4 ms p95 | Latest orbit: 0.7-0.8 ms; earlier diagnostics-open run: 4.2 ms |
| GPU execution | <=8 ms p95 | Latest orbit: 1.84-4.63 ms where timer queries are supported |
| Frontend parse/apply | <2 ms p95 | Latest orbit: 6.8-7.9 ms; target missed |
| Normal IPC | <1 MiB/s | Measured snapshot envelopes: 44,770-46,820 B/s; complete framing/command traffic not measured |
| Native aggregation | <5 ms p95 | Isolated cost probes exist; representative p95 not established |

Demand-rendered idle frames may remain at zero. That is expected behavior, not
a frame-rate failure. No completed four-hour stability result is available.

## Historical Idle Measurements

Rows describe the features present in each measured build. They are independent
live runs with different process populations, not controlled comparisons.

### CPU

All values are percentages of whole-machine CPU capacity. A dash means that the
original record did not provide that value.

| Build or workload | Mean | Median | p95 | p99 | Host mean | WebView mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Basic shell, collectors off | 0.114 | 0 | 0.384 | 1.701 | 0.0063 | 0.108 |
| Process collection | 0.527 | 0.378 | 1.134 | 1.697 | 0.287 | 0.240 |
| Process hierarchy and groups | 0.611 | 0.567 | 1.132 | 1.699 | 0.302 | 0.309 |
| Delta delivery and static lifecycle markers | 0.623 | 0.566 | 1.144 | 1.513 | 0.348 | 0.275 |
| Resource visuals, initial run | 6.322 | 6.389 | 8.188 | 9.198 | 0.381 | 5.942 |
| Resource visuals, repeat A | 0.800 | 0.756 | 1.485 | 1.915 | 0.320 | 0.480 |
| Resource visuals, repeat B | 0.930 | 0.959 | 1.536 | 1.919 | 0.319 | 0.612 |
| Network collection, initial run | 0.768 | 0.744 | 1.512 | 2.079 | 0.321 | 0.448 |
| Network collection, final run | 0.930 | 0.768 | 1.699 | 2.114 | 0.341 | 0.590 |
| Filesystem support, no root selected | 0.750 | 0.576 | 1.535 | 2.111 | 0.259 | - |
| Local history support, recording off | 0.727 | 0.576 | 1.342 | 1.530 | 0.276 | 0.451 |
| Replay support, replay closed | 0.883 | 0.768 | 1.703 | 1.921 | 0.351 | 0.532 |
| Bounded renderer, recording off | 0.844 | 0.749 | 1.676 | 2.090 | 0.381 | 0.464 |
| Keyboard and focus updates | 0.997 | 0.933 | 2.080 | 2.441 | 0.408 | 0.589 |

### Memory

Values are mean MiB over the same idle runs.

| Build or workload | Summed working set | Summed private memory | Host private memory |
| --- | ---: | ---: | ---: |
| Basic shell, collectors off | 369.9 | 158.6 | 6.17 |
| Process collection | 386.2 | 169.8 | 5.31 |
| Process hierarchy and groups | 397.9 | 179.6 | 5.44 |
| Delta delivery and static lifecycle markers | 403.3 | 180.8 | 6.19 |
| Resource visuals, initial run | 436.7 | 201.0 | 6.09 |
| Resource visuals, repeat A | 399.5 | 179.1 | 6.13 |
| Resource visuals, repeat B | 409.7 | 190.0 | 5.96 |
| Network collection, initial run | 406.3 | 186.0 | 6.57 |
| Network collection, final run | 408.0 | 189.1 | 6.72 |
| Filesystem support, no root selected | 397.2 | 183.9 | 6.66 |
| Local history support, recording off | 395.6 | 184.6 | 6.79 |
| Replay support, replay closed | 410.3 | 185.0 | 6.95 |
| Bounded renderer, recording off | 403.0 | 184.2 | 7.10 |
| Keyboard and focus updates | 404.3 | 186.3 | 6.97 |

The first four captures were recorded on September 25 at 06:02:32, 06:29:43,
07:15:14 and 08:30:27 UTC. Resource-visual captures were at 09:12:28, 09:17:36
and 09:20:23 UTC; network captures were at 10:02:36 and 10:13:00 UTC.

No application code changed between the three resource-visual runs. The 6.322%
CPU result remains unexplained. Repeat A/B renderer means were 0.296%/0.332%;
GPU-process CPU means were 0.034%/0.110%. Those repeats do not establish the cause
of the earlier WebView load. An earlier animated-marker run measured 0.892% mean,
3.002% p95 and 4.846% p99 CPU before Normal markers became demand-rendered.

The earliest draft CPU sampler selected an integer `Math.Max` overload and rounded
fractional values. Its CPU result was invalid and is excluded from these tables.

## Measured Rendering and Collection Costs

### Framebuffer Configuration

The basic-shell Normal framebuffer was changed from pixel ratio 1.5 with MSAA
to pixel ratio 1 without MSAA. Higher quality remained available in Cinematic.

| Metric | Original framebuffer | Lower-cost framebuffer |
| --- | ---: | ---: |
| Mean summed working set | 481.0 MiB | 369.9 MiB |
| Mean private memory | 269.0 MiB | 158.6 MiB |
| GPU-process private memory | 171.1 MiB | 59.8 MiB at end |

Private memory fell by approximately 41%; GPU-process private memory fell by
approximately 65%. Rendering checks continued to pass. These measurements do not
establish a universal WebView memory floor. The early executable was 8,648,192
bytes, approximately 8.25 MiB, before a final incremental rebuild.

### Live Runtime Samples

| Workload | Observed cost or result |
| --- | --- |
| Process-only view, about 260-265 processes | 5 draws; 57-59 KB/s snapshot payload; 15-20 ms collection; one submission sample 0.3-0.4 ms |
| Grouped view, 264 processes / 199 groups | 8 draws; about 123 KB/s full snapshots; 19 ms collection; 0.21 ms model build; one submission sample 0.7 ms |
| Delta view, 268 processes / 202 groups | 8 draws; 27 changed rows; 17 delta batches; about 16.7 KB/s received payload |
| Resource mapping off, 262 processes / 200 groups | 8 draws; 21 changed rows; about 16.4 KB/s; mapping on usually adds an unknown-memory batch for 9 draws |
| Network collector, standalone scan | 210 rows in about 7.7 ms |
| Network view profile | 222 endpoints, 151 bridges, 9 draw calls; 12 draws over about 17 s; scan about 6.4 ms |
| Small directory observation | 2 entries; one 0.35 ms scan, not sustained watch overhead |

The reduction from roughly 123 KB/s full snapshots to 16.7 KB/s deltas was
measured with different live populations and intervals. It is evidence of lower
delivered data, not a controlled throughput ratio.

A resource profile captured 17 draws over about 17 s and 0.241 s script time in
a 15.3 s window. Turning mapping off produced only one additional draw over 15 s.
After camera settling, four resource samples produced four draws; with mapping
disabled, the frame counter settled to zero new frames. The network profile used
0.081 s script time in 15.16 s, with 0.424 s total tracked task time. The subsequent
Universe profile used 0.047 s script time in 15.09 s. These CDP profiles are not
whole-app CPU or GPU-time measurements.

The controlled resource workload increased selected-star brightness from 419.1
to 547.3 mean RGB and pixel area from 22,941 to 37,092 after allocation, with a
454.8 MiB observed working set and one sustained CPU-spike event. It used up to
eight CPU workers and 384 MiB touched allocation, with a 90-second bound. Pixel
tests confirm a visible response, not photometric or physical calibration.

Independent process checks recorded CPU pairs of 1.92%/2.10%, 1.92%/2.18%,
1.89%/2.20% and 1.90%/2.21% (application/Windows reference). Corresponding working
sets were 121.4/121.75, 121.6/121.48, 123.0/123.00 and 122.5/122.90 MiB.
Sampling intervals differed; comparisons intentionally used tolerances.

## Active Interaction

### Local-Pointer Orbit

Two Normal-profile trials used recording off, diagnostics open, 30 s warmup and
60 one-second whole-app samples. Pointer events were dispatched locally in the
browser, avoiding repeated remote CDP input commands. These are not controlled
A/B comparisons with the earlier remote-input measurements.

| Metric | Trial A | Trial B |
| --- | ---: | ---: |
| Whole-app CPU mean / p95 | 5.82% / 7.95% | 5.63% / 7.22% |
| Mean summed working set | 490.9 MiB | 490.5 MiB |
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
| Aligned snapshot JSON-envelope RX mean | 46,820 B/s | 44,770 B/s |

GPU queries are asynchronous, with at most four pending samples. CPU and GPU work
are paired per frame before calculating p95; their execution may overlap, so the
sum is not presentation latency. Query completion includes the delay until another
frame polls it. Instrumentation does not request extra idle frames. Timing arrays
retain the most recent 4,096 samples, which need not exactly match the CPU window.

Parse/apply includes accepted-chunk validation and assembly, reconstruction and
store update, but excludes inter-chunk waits, native serialization and Tauri's
outer JSON decoding. Component percentiles must not be added together. Envelope
RX includes escaped snapshot payloads but excludes ACKs, other commands and
Tauri/WebView framing. Exact presentation timing and complete IPC accounting are
still unmeasured.

### Selection, Focus and Replay

Each workload had a separate 30 s warmup and 60-sample run.

| Workload | CPU mean / p95 | Working-set mean | Aligned operations | Action p95 |
| --- | ---: | ---: | ---: | ---: |
| Selection | 8.87% / 14.47% | 523.5 MiB | 62 | 606 ms |
| Focus | 7.01% / 9.07% | 484.9 MiB | 67 | 748 ms |
| Replay | 4.36% / 6.18% | 519.6 MiB | 61 | 1,086 ms |

Actions include CDP overhead, waiting for the expected visible state, and two
animation frames. They are not isolated input-latency or camera-settled timings.
Selection/focus used observed processes; replay used recorded checkpoints.

### Earlier Remote-Input Runs

These results preserve the earlier experiments, including unsuccessful results.
Each full sample used 30 s warmup and 60 s process sampling. Most controller
workloads lasted 105 s, including time outside the CPU sample window.

| Configuration | CPU mean / p95 | Working-set mean | Submission p95 | Moving interval p95 |
| --- | ---: | ---: | ---: | ---: |
| Discrete orbit baseline | 10.622% / 12.417% | 469.4 MiB | - | - |
| Added submission instrumentation | 11.878% / 15.193% | 475.2 MiB | 1.0 ms | - |
| Moving-cadence measurement | 12.896% / 15.205% | 469.6 MiB | 1.0 ms | 32.2 ms |
| Continuous held-pointer sweeps | 11.970% / 13.731% | 485.7 MiB | 1.0 ms | 32.5 ms |
| Diagnostics open, aligned payload | 10.347% / 14.479% | 505.1 MiB | 4.2 ms | 36.0 ms |
| Frame-limiter tolerance adjustment | 12.46% / - | 506.2 MiB | 1.2 ms | 18.5 ms |
| Avoided redundant frame validation | 12.20% / - | 504.7 MiB | 1.4 ms | 23.5 ms |

Additional recorded details:

- Discrete baseline: median CPU 10.524%, p99 13.810%; host 0.466%, WebView
  10.155%; private memory 238.8 MiB, host private 6.87 MiB; 673 drags / 6,056 frames.
- Submission-instrumented run: median CPU 11.614%, p99 18.135%; host 0.460%,
  WebView 11.417%; private memory 234.7 MiB; 657 drags / 5,759 frames;
  snapshot payload about 44.5 KiB/s across the controller window.
- Cadence run: 676 drags / 5,914 frames; payload about 46.3 KiB/s. An earlier
  short check measured 32.7 ms moving interval p95.
- Held-pointer run: 364 sweeps / 5,768 frames; private memory 225.7 MiB;
  payload about 48.3 KiB/s. A five-second check measured 25.5 ms cadence p95,
  which did not predict the longer result.
- Diagnostics-open aligned payload: 60 readings, mean 53,468 B/s and
  p95 105,740 B/s. These older counters measured payload, not full envelopes.
- Parse/apply initially measured 16.6 ms p95. After avoiding another complete
  schema traversal, one run measured 11.8 ms, with assembly 7.5 ms,
  reconstruction 1.4 ms and store update 2.8 ms. Aligned payload mean was
  41,466 B/s, p95 69,664 B/s.

Remote debugging, the open diagnostics panel and external input drivers affect
the workload. Driver CPU is outside the measured app tree. Independent trials
and uncontrolled process churn prevent attributing every change to the relevant
code adjustment. None of these runs establishes ordinary-user CPU compliance.

## Audit Revalidation: October 1

The release was rebuilt after moving four diagnostic frame-percentile
calculations into the existing one-second metric snapshot. A regression counted
21 calls per function across initialization plus20 unrelated rerenders before
the change, and one afterward. The timer updates each value once per second and
stops on unmount. This is a measured reduction in redundant work, not a claim
of a proportional whole-application CPU improvement.

Fresh local-input orbit and idle trials used30s warmup and60s sampling on the
same i7-6700/eight-logical-CPU Windows machine. Builds and other benchmarks were
not run alongside these measurements.

| Metric | Idle | Local-input orbit |
| --- | ---: | ---: |
| Mean normalized whole-app CPU | 0.788% | 5.559% |
| CPU p95 | 1.536% | 7.183% |
| Host mean CPU | 0.322% | 0.400% |
| WebView mean CPU | 0.466% | 5.159% |
| Mean summed working set | 398.36 MiB | 466.27 MiB |
| Mean private memory | 171.95 MiB | 228.58 MiB |

Orbit CPU submission/frame-work p95 were0.6/0.6ms; GPU execution3.68ms;
paired CPU+GPU4.04ms; moving interval16.9ms; parse/apply4.0ms. Orbit's renderer
and GPU processes used2.259% and2.569% mean normalized CPU respectively.
Active CPU, parse/apply and memory budgets remain unmet. Differences from earlier
trials also reflect changing process/network activity and are not an isolated
before/after attribution. Raw reports:
`artifacts/idle-release-20261001-124111186.json` and
`artifacts/orbit-release-20261001-124314003.json`.

Archived WebView CPU profiles measured Network script execution0.062759s over
15.1728s and Universe0.058458s over15.08585s. These are idle views, not active
camera or Cinematic allocation profiles. CDP instrumentation and start-up frames
affect observations; immediately opened diagnostics include cold samples and
cannot be treated as settled p95 measurements. Profile summaries are
`artifacts/profile-2026-10-01T07-08-04-928Z.json` (Network/Universe) and
`artifacts/profile-2026-10-01T07-09-00-133Z.json` (resource visuals on/off).
Profiles are now timestamped so new runs do not replace historical captures.

A fresh120s isolated pressure run generated6,000,000 events at49,993.38/s,
retained256, delivered114,688 and explicitly reported5,885,312 gaps. Maximum
pending transfers remained1; the final acknowledged cursor reached6,000,000
and drained to0 pending. Envelope rate311,399B/s; parse/apply p954.1ms.
Ordinary launches rejected both qualification commands. Evidence:
`artifacts/pressure-release-1790838948307.json`. This is bounded coalescing,
not lossless delivery, OS collector throughput, or recording-write qualification.

Six fresh 60-second aggregate-rendering trials passed nonblank pixels and
selected-instance picking, each displaying 1,024 instances. No builds or other
benchmarks overlapped these trials; other system activity was not controlled.

| Viewport | Input count | Topology, ms | Selection, ms | CPU submission p95, ms | GPU p95, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1360 x 820 | 10,000 | 45.2 | 4.1 | 0.3 | 0.902 |
| 1360 x 820 | 50,000 | 164.4 | 17.0 | 0.3 | 0.831 |
| 1360 x 820 | 100,000 | 334.9 | 21.7 | 0.3 | 0.806 |
| 400 x 740 | 10,000 | 62.5 | 4.9 | 0.3 | 0.657 |
| 400 x 740 | 50,000 | 139.0 | 19.0 | 0.3 | 0.640 |
| 400 x 740 | 100,000 | 217.1 | 38.9 | 0.3 | 0.666 |

Each trial rendered 3,597-3,598 frames with moving interval p95 of 16.8 ms.
Evidence: `artifacts/scale-audit.log` and `artifacts/scale-release.json`.
This remains aggregate-scene qualification, not full-detail live rendering at
100,000 entities. Topology rebuilds still exceed the frame budget.

The subsequent native workflow reproduced a replay restore-test failure.
Win32 reported success on a newly resolved process window handle while Tauri
still reported the actual main window minimized. Retaining the original HWND
and independently checking Tauri state corrected the test target. A separate
submission guard prevents selection rerenders from drawing while minimized;
visibility listeners now remain stable across callback changes. No polling
workaround or temporary controller instrumentation remains.

The clean release through `1c2f809` passes all 71 frontend tests, lint, the
release build, replay-only and live-visibility checks, and the full native
workflow with ordinary shutdown/reopen. Full-workflow nonblank-pixel counts
were 497 desktop and 792 narrow, with no page errors. The soak harness now
retains its original HWND for visibility and normal WM_CLOSE shutdown; its
30-second check completed a 30.905-second span and passed shutdown
(`artifacts/soak-30-20261001-131736145-summary.json`). These checks are not
hour-scale stability results. Earlier unrelated shutdown hangs remain unproven.

## Startup and Minimized Behavior

Startup was sampled without warmup while discovering new descendants. The first
sample at 5.84 s showed 429.3 MiB working set; ten samples peaked at 441.1 MiB
and averaged 433.7 MiB. Host-private mean was 6.52 MiB. CIM discovery overhead
means this is neither memory at process creation nor an exact first-ready peak.

| Metric | Visible idle | Minimized |
| --- | ---: | ---: |
| CPU mean / median | 0.865% / 0.754% | 0.890% / 0.756% |
| CPU p95 / p99 | 1.686% / 2.065% | 1.714% / 2.060% |
| Host / WebView mean CPU | 0.321% / 0.544% | 0.370% / 0.520% |
| Mean summed working set | 411.9 MiB | 411.0 MiB |
| Mean private memory | 179.9 MiB | 181.0 MiB |

Both runs used seven app processes, no CDP and the usual warmup/sample windows.
An earlier minimized run measured 0.831% mean CPU and 405.4 MiB working set.
Variation does not demonstrate a repeatable minimization saving. These resource
samples confirmed Win32 minimized state, not frame pause by themselves.

Separate native tests verified zero new frames over three seconds minimized and
keyboard-camera interaction after restore. WebView2 did not set `document.hidden`
for Windows minimization on this machine; the renderer also uses native state.
Live and replay now share minimized pause, frame limits and context-loss recovery.

Ordinary warmed app shutdown was measured at 0.11 s, 0.09 s with a debugging port
but no CDP attachment, and 0.08 s after Win32 minimize/restore without CDP. Earlier
combined CDP/minimize tests exceeded the five-second gate, including after worker
shutdown completed. Temporary window-destruction, application-exit and listener
changes did not establish a fix and were removed. Later full workflows and five
consecutive visibility runs passed strict ordinary shutdown/reopen. Clean replay
and live visibility checks passed again on October 1. Earlier failures remain a
reliability risk; forced cleanup is never a shutdown pass.

## Large-Count Benchmarks

Synthetic inputs remain separate from live observations and SQLite. The live
collector cap is 4,096 processes; distant rendering selects at most 1,024 while
retaining the selected identity. Near/far thresholds are 60/75 world units.

### JavaScript Layout and Selection

Values are approximate mean milliseconds from separate Vitest/jsdom runs, not
GPU timings. Inputs contain one group, deterministic IDs and no OS collectors,
events, connections or files.

| Input count | Initial topology before / after | Original far selection | Cached layout before / after |
| ---: | ---: | ---: | ---: |
| 10,000 | 16.6 / 13.0 | 3.65 | 2.07 / 0.25 |
| 50,000 | 99.4 / 90.9 | 26.8 | 12.75 / 2.13 |
| 100,000 | 238.5 / 233.2 | 59.0 | 30.4 / 3.98 |

| Input count | Later topology rerun | Later selection rerun | Later cached layout |
| ---: | ---: | ---: | ---: |
| 50,000 | 105.60 | 36.84 | 5.01 |
| 100,000 | 249.13 | 77.74 | 4.92 |

After replacing complete selection sorting with a bounded max-heap:

| Input count | Topology | Far selection | Cached layout |
| ---: | ---: | ---: | ---: |
| 10,000 | 15.19 | 1.24 | 0.290 |
| 50,000 | 97.04 | 4.00 | 2.157 |
| 100,000 | 212.48 | 7.01 | 4.277 |

At 4,096 buffer slots, eight sparse color edits averaged 0.079 ms, eight sparse
matrix edits 0.23 ms, and a dense color update 1.01 ms; a later dense run averaged
1.15 ms. Vitest warned about module-export getter overhead during dense-color
tests. These are noisy JavaScript costs, not GPU upload bandwidth.

Other native probes measured a 4,096-process deep ancestry chain at about 0.50 ms,
a 4,096-process burst normalization plus unchanged diff at about 2.6 ms, and
100,000 resource mappings at about 4.6 ms. Each was a local Release cost probe.

### Native WebView Aggregate Rendering

Six 60-second trials covered 10,000 / 50,000 / 100,000 inputs at both viewport
sizes. Each displayed 1,024 instances through a separate Three.js aggregate scene
using production layout and selection logic.

| Metric | Recorded range across six trials |
| --- | --- |
| Frames | 3,595-3,598 per trial |
| CPU submission p95 | 0.4-0.8 ms |
| GPU execution p95 | 0.638-0.887 ms |
| Moving interval p95 | 16.8 ms |
| Topology rebuild | 54.5-497 ms |
| Pixel, selected-member picking and screenshot checks | Passed |

Two short frontend tests overlapped the narrow-view portion; other system load
was not controlled. This is not complete live-renderer or full-detail 100,000-item
qualification. Topology rebuilds remain well above a single-frame budget.

## Event Pressure

The C++ journal test generated an initial 4,096-process burst and six PID-reuse
snapshots, producing 49,152 additional lifecycle events in about 25 ms, roughly
1.94 million synthetic events/s. The ring stayed at 256 entries, cursors and
evictions agreed, and an older retained snapshot remained immutable. A Rust unit
test advanced the latest state 50,000 times without ACK; only the first transfer
was emitted until acknowledgment, followed by the latest state. These tests
exclude OS collection, live WebView parsing and history writes.

The opt-in Rust-to-WebView pressure test exercised delivery, chunking, ACKs and
the real frontend assembler with 250 ms delayed ACKs:

| Metric | 120-second trial |
| --- | ---: |
| Generated events | 6,000,000 |
| Measured producer duration | 120.014 s |
| Effective generated rate | About 49,994 events/s |
| Retained journal entries | 256 |
| Journal evictions | 5,999,744 |
| Delivered rows | 111,360 |
| Explicit consumer gaps | 5,888,640 |
| Maximum pending transfers | 1 |
| Final cursor / pending transfers | 6,000,000 / 0 |
| Serialized snapshot envelopes | 36,288,148 bytes |
| Mean envelope rate | 302,367 B/s |
| Isolated parse/apply p95 | 4.9 ms |
| JS heap across 120 samples | Approximately 13.6-50.7 MB, with collection drops |

A separate 60-second trial and ordinary-launch command rejection also passed.
This demonstrates bounded latest-state coalescing near a nominal 50,000 events/s,
not lossless delivery, OS collection at that rate or stable total native memory.

## SQLite Statement Reuse

Five baseline and five cached-statement trials used fresh in-memory databases,
1,000 process identities, two metrics and 20 samples, with one transaction per
sample. Every trial verified 4,000 aggregate rows and 40,000 total samples.

| Trial | Repeated preparation, ms | Cached statement, ms |
| --- | ---: | ---: |
| A | 627.228 | 104.515 |
| B | 627.303 | 95.965 |
| C | 810.160 | 104.863 |
| D | 631.762 | 98.141 |
| E | 614.397 | 186.769 |
| Median | 627.303 | 104.515 |

The median fell 83.34%. This isolates SQL preparation/execution, excludes disk
latency and does not imply an 83% whole-app improvement or reduced write frequency.
Resource buckets are still updated for each accepted process sample.

## Long-Run Evidence

The sampler saves flushed JSONL records with PID/creation-time identity, per-role
CPU, working set, private commit, handles, threads, window state and DB/WAL/SHM
sizes. Completed summaries also contain executable SHA256 and early/late ten-minute
averages. A full sample span and ordinary shutdown within five seconds are required
for completion. GPU memory, queue occupancy and JS object counts are not captured.

Short 30-second sampler checks passed, including ordinary close. An attempted
one-hour run was interrupted after about 470 s without a completion summary.
The subsequent two-hour attempt also ended early:

| Metric | October 1 interrupted run |
| --- | ---: |
| Samples | 280 |
| Measured span | 4,218.735 s / 70.31 min |
| Mean normalized app CPU | 0.7810% |
| Private commit, first / last / peak | 174.35 / 188.53 / 206.46 MiB |
| Handles, first / last | 3,063 / 3,022 |
| Threads, first / last | 155 / 137 |
| DB + WAL + SHM, first / last | 7,880,704 / 7,880,704 bytes |
| Completion summary / ordinary shutdown result | Not recorded |

The run used Normal live idle, recording off and no CDP. Its raw file is
`artifacts/soak-7200-20261001-102149285.jsonl`. It is partial evidence, not a passed
two-hour test, a completed one-hour lifecycle test or proof of leak freedom.
No four-hour session has completed. Recording-off database stability does not
establish behavior during sustained writes; sizes include pre-existing history.

## Validation Record

Historical native smoke checks covered actual process identity and metrics,
network loopback endpoints, temporary-directory create/modify/rename/delete,
history recording/replay, camera interaction, reload, context loss and shutdown.
Desktop/narrow nonblank-pixel results included 205/473 for the initial shell,
566/790 for bounded rendering and 570/756 for keyboard/focus verification. These
are downsampled pixel counts, not rendering quality scores. Browser axe checks
found no WCAG 2 A/AA or 2.1 AA rule violations in the tested shell/panels; that is
not complete accessibility certification.

| Feature coverage at time of validation | Frontend tests | Rust tests | CTest executables |
| --- | ---: | ---: | ---: |
| Basic native shell | 10 | 2 | 1 |
| Process collection | 15 | 3 | 2 |
| Hierarchy and groups | 22 | 4 | 3 |
| Delta delivery and lifecycle | 32 | 9 | 4 |
| Resource visualization | 39 | 9 | 5 |
| Network | 45 | 10 | 6 |
| Filesystem | 51 | 11 | 7 |
| Recording | 51 | 19 | 7 |
| Replay | 53 | 20 | 7 |
| Keyboard and focus | 62 | 20 | 7 |
| Renderer benchmarks | 64 | 20 | 7 |
| Interaction qualification | 67 | 20 | 7 |
| Shared replay render controller, October 1 | 70 | 21, plus 1 ignored benchmark | 7 |

The last validated release through `aeb039b` passed frontend lint, TypeScript,
Clippy, full native build and replay/live visibility checks. Subsequent Vitest
startup crashed with Windows access violation `0xC0000005`, including a single
forked worker. Node ESM, npm, bundler/test API imports and TypeScript worked; the
faulting module was not established. A diagnostic-only experiment was removed,
leaving the validated application source unchanged. An earlier missing SDK header,
Clippy metadata panic and debug Rust linker-cache error were followed by successful
release checks; their transient causes remain unexplained. Vite's large-chunk
warning remains; the early renderer chunk was about 960 KB minified / 253 KB gzip
and the initial UI chunk about 323 KB / 99 KB gzip.

## Reproducing Measurements

Run from the repository root in PowerShell after `npm run desktop:build`.
Use one workload at a time; avoid overlapping builds, tests and measurement apps.

```powershell
.\scripts\measure-idle.ps1
.\scripts\measure-idle.ps1 -Minimized
.\scripts\measure-idle.ps1 -Startup -SampleSeconds 10
$env:UOS_ORBIT_INPUT = 'local'
.\scripts\measure-idle.ps1 -Orbit
Remove-Item Env:UOS_ORBIT_INPUT
.\scripts\measure-idle.ps1 -Interaction selection
.\scripts\measure-idle.ps1 -Interaction focus
.\scripts\measure-idle.ps1 -Interaction replay
.\scripts\measure-soak.ps1 -DurationSeconds 3600
.\scripts\measure-soak.ps1 -DurationSeconds 7200
.\scripts\measure-soak.ps1 -DurationSeconds 14400
node tests/profile-resources.mjs
node tests/profile-resources.mjs --network
node tests/pressure-workload.mjs 5 --disabled
node tests/pressure-workload.mjs 120
node tests/scale-workload.mjs 60
npm exec --workspace apps/desktop -- vitest bench ../../tests/frontend/large-count.bench.ts --run --reporter=verbose
cargo test --release --manifest-path apps/desktop/src-tauri/Cargo.toml --lib storage::tests::profile_resource_sample_writes -- --ignored --nocapture
```

Idle tests do not attach CDP. Orbit/profiling use loopback port 9224; isolated
pressure and scale apps use 9225 and 9226. Synthetic pressure requires the
test launch's `UOS_QUALIFICATION=1`; ordinary launches reject those commands.
The disabled-mode check verifies this guard. Native runtime tests use port 9223
and create small real history sessions in the user's app-data directory.

Samples, profiles and screenshots are local, ignored outputs under `artifacts/`.
Historical summaries above remain useful when those machine-local files are not
available. Reproduction on another machine may produce materially different costs.