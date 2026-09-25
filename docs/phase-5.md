# Phase 5: CPU energy and memory size

Status: implemented and functionally verified in the actual Windows application,
2026-09-25. Performance remains provisional: the working-set target is missed and
one high-CPU measurement remains unexplained. This is not completion of Universe OS.

## Mapping policy

The C++ core derives two visual levels (0-31) from actual process measurements.
These are presentation inputs, not new OS measurements. Exact CPU percentages
and working-set bytes remain unchanged in the inspector and transport.

- CPU energy: square root of machine CPU fraction, quantized to 32 levels.
- Memory size: log1p(working set / 16 MiB) / log(257), saturated at 4 GiB,
  quantized to 32 levels. Larger working sets still have exact numeric readouts.
- Missing/invalid measurements have level -1 natively (null on the wire), not
  level zero. Measured zero remains a valid minimum level.
- A 0.75-level deadband around the prior visual level suppresses boundary jitter.
  The prior level is retained only for the same observed process lifetime.

CPU spike policy: two consecutive distinct samples at >=10% of total machine
CPU, rearm after <=6%, and at least 30 monotonic seconds between signals for the
same tracked lifetime. Unknown data breaks the sustained-sample requirement.
Events include the actual CPU value and threshold. This is a monitor policy, not
a crash detector, health diagnosis, or proof that the workload is undesirable.
No speculative memory leak or disk/network activity detector is added.

## Native checks

Tests cover bounded/monotonic mapping, missing vs zero, invalid CPU values, extreme
memory saturation, visual hysteresis, consecutive-sample detection, duplicate
timestamps, cooldown, unavailable intervals, journal integration and appearance
changes entering the native delta. One local Release run mapped 100,000 samples
in about 4.6 ms; this is a cost probe, not an end-to-end performance guarantee.

## Transport and renderer

Resource visual and spike-value C ABI accessors preserve the existing structure
layouts and validate sizes/indices. Rust validates visual levels against the
availability of their source measurements, and validates finite measured spike
values/thresholds. Protocol 5 adds nullable cpuLevel/memoryLevel and nullable event
resourceValue/resourceThreshold, while retaining bounded chunked deltas and resync.
Protocol 4 clients fail version negotiation explicitly.

The frontend preserves a resource-level map across raw metric updates when the
quantized levels did not change. Visual changes never invoke hierarchy/galaxy
relayout. Filled and unknown-memory instances share sphere geometry; unknown memory
uses wireframe and neutral size. Unknown CPU uses a neutral color distinct from
measured zero. Known CPU modulates material intensity (0.45-1.8); known memory
modulates size (0.85-3.0 times the base radius), with selection scale separate.

Only changed instance matrices/colors are written. Pending update ranges are merged
instead of dropped, so hidden windows neither lose pending changes nor accumulate
an unbounded upload queue. Geometry bounding spheres update on positions/size/count,
not color-only changes. The renderer invalidates on meaningful visual changes.
Disabling Resource visuals also removes the resource-level subscription from the
star component; a raw metric update cannot force a hidden mapping rerender.

Sustained CPU signals reuse the bounded 32-effect pool and 900 ms duration. Normal
uses a fixed marker, Cinematic animates, and Eco/reduced-motion suppress effects.
Turning resource visuals off suppresses resource-spike markers but keeps measured
spike records and exact inspector data. No continuous rotation, bloom or new
per-process DOM/component tree is introduced.

## Functional checks

- 5 CTest executables pass: resource mapping/spikes plus core, lifecycle/deltas,
  hierarchy and real Windows collector tests.
- 9 Rust tests pass, including actual native resource availability through the ABI,
  retained snapshots, bounded serialization/chunks and stream recovery. Clippy clean.
- 39 frontend tests pass, covering protocol consistency, resource-level reuse,
  bounded appearance, merged GPU update ranges, no metric-driven relayout,
  spike readouts/effects, toggles and earlier phases' regression tests.
- Strict TypeScript build and frontend lint pass. Release 0.5.0 built and ran.
- Native smoke retains the held-acknowledgement recovery, real parent/child and
  galaxy checks, process/ring picking, both layouts, toggles, close/reopen and
  WebGL loss/recovery. Zero JavaScript page errors.
- The controlled resource probe is a real Node process with 16 MiB initially
  touched, up to eight CPU worker threads selected for the machine, then 384 MiB
  touched allocation. It has a 90-second bound and exits on IPC disconnect. The
  test affects only its own processes; no system metrics are injected into the app.
- In the final runtime check, selected-star mean RGB brightness increased from
  419.1 to 547.3 with CPU load. With CPU returned to idle, selected-star pixel area
  increased from 22,941 to 37,092 after memory allocation; reported working set was
  454.8 MiB including runtime overhead. The mapping toggle changed appearance but
  left the >300 MiB exact working-set measurement intact. The same probe produced
  exactly one visible sustained-CPU event, with its actual value and 10% threshold.
- CPU/memory/spike screenshots and 400x740 resource inspector checks passed. Pixel
  tests compare a selected-star color mask in a fixed viewport; they verify visible
  response, not photometric calibration or exact physical size.
- After the camera reported sleeping, four telemetry samples produced four draws.
  With resource visuals disabled, the frame counter settled to zero new frames.
  The first test incorrectly counted camera interpolation as steady-state drawing;
  explicit camera wake/sleep metrics resolved that. A subsequent test exposed and
  fixed the unnecessary disabled-mode resource subscription.

## Performance results

Release 0.5.0, Normal, process collection and resource mapping enabled, diagnostics
closed, no debugger attached. Intel i7-6700, eight logical processors, Windows 11
build 26200, WebView2 153.0.4234.48. Each run uses 30-second warmup then 60 one-second
samples over the native host and six WebView subprocesses. CPU is machine-normalized.

| Metric | First run | Attributed repeat 1 | Attributed repeat 2 |
| --- | --- | --- | --- |
| Capture UTC | 09:12:28 | 09:17:36 | 09:20:23 |
| Mean CPU | 6.322% | 0.800% | 0.930% |
| Median CPU | 6.389% | 0.756% | 0.959% |
| p95 CPU | 8.188% | 1.485% | 1.536% |
| p99 CPU | 9.198% | 1.915% | 1.919% |
| Native host mean CPU | 0.381% | 0.320% | 0.319% |
| WebView mean CPU | 5.942% | 0.480% | 0.612% |
| Summed working set | 436.7 MiB | 399.5 MiB | 409.7 MiB |
| Summed private memory | 201.0 MiB | 179.1 MiB | 190.0 MiB |
| Native host private memory | 6.09 MiB | 6.13 MiB | 5.96 MiB |

**The first high-CPU result is not explained or declared fixed.** No application
code changed between these runs. Per-process CPU attribution was added to the
sampler after the first result. In the two repeats, renderer CPU averaged 0.296%
and 0.332%, GPU-process CPU 0.034% and 0.110%; neither reproduced the earlier
aggregate WebView load. There is insufficient evidence to attribute that run to a
particular subprocess, graphics driver, background activity or application defect.

A separate, instrumented fresh-launch profile captured 17 draws over roughly 17
seconds, 0.241 seconds of script time over a 15.3-second window, and only one
additional draw over 15 seconds after turning mapping off. This rules out a
continuous JS render loop in that captured run, not every possible cause of the
earlier result. Profiles are available in ignored `artifacts/`; rerun with
`node tests/profile-resources.mjs` (loopback port 9224 must be free). The profiling
helper launches its own app and refuses to attach to an occupied port.

The latest functional diagnostic sample (mapping off for the idle assertion)
showed 262 processes, 200 groups, 8 draw calls, 21 changed rows and ~16.4 KB/s
wire payload. With resource mapping on, unknown-memory instances use an additional
batch, normally 9 draw calls. These samples are not a controlled benchmark across
identical process populations. The Phase 4 mean reference was 0.623% CPU.

## Open limits

- Repeated mean CPU is below 1%, but tails exceed the approximate idle target and
  the unexplained 6.322% run remains an open performance concern. Do not call this
  fully performance-qualified. Longer controlled and cold-start profiling is needed.
- Summed working set still exceeds 250 MiB. Shared pages may be counted repeatedly;
  private memory is reported separately and does not replace the budget.
- Resource visuals intentionally cause data-cadence redraws, unlike a completely
  static Phase 4 scene. Toggle mapping off or use Eco when reducing work matters.
- Size is based on working set, not unique/private memory; visual saturation above
  4 GiB is deliberate. Brightness/size are artistic encodings, not OS mechanics.
- Quantization/hysteresis may retain a nearby visual level while exact values
  change. Native readouts are never smoothed or replaced by the visual level.
- Spike policy is fixed and machine-normalized in this version. It does not detect
  memory leaks, crashes, global CPU pressure, or per-core load. Unavailable fields
  and collection gaps reset sustained evidence; polling can still miss brief work.
- The real spike probe is verified on this eight-logical-CPU machine; its eight
  worker cap may not reach the 10% machine threshold on very large hosts.
- Existing 4,096-process, 256-event, 32-effect and transfer-size limits remain.
  Large-object LOD, system-wide/per-core telemetry, GPU timer queries, long soaks,
  network/filesystem collectors, SQLite and replay are not implemented by this phase.

Commit cadence: `cc6933d` records the tested native resource model. The verified
visual/transport integration is a separate commit with minor tag `v0.5.0`.
No major tag, branch, remote or push is created.