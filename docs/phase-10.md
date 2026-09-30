# Phase 10: bounded large-count renderer work

Status: bounded aggregate rendering and isolated native pressure verified;
full-detail interactive 10k/50k/100k qualification is not claimed. The live collector
is capped at 4,096 processes. Phase 12 records representative live behavior
and remaining limits.

The live Windows collector still caps observed processes at 4,096. The synthetic
workload in `tests/frontend/large-count.bench.ts` runs only under Vitest; it
does not publish frames to the native engine, Zustand store or SQLite history.
Run it with `npm exec --workspace apps/desktop -- vitest bench ../../tests/frontend/large-count.bench.ts --run --reporter=verbose`.

## Implemented

- Process stars remain in two reusable 4,096-slot instanced meshes. Far views
  select at most 1,024 stable identity-hashed instances; a selected observed
  process is always included, and zooming within 60 world units restores all
  observed stars. The 75-unit exit threshold avoids oscillation. Picking maps
  displayed instance slots back to process IDs. Galaxy aggregates remain shown.
- Matrix/color attributes retain at most eight disjoint dirty ranges before
  falling back to a single encompassing upload. Distant resource edits no
  longer automatically upload all intermediate instances.
- Metric-only layout checks compare existing topology records instead of
  allocating a process-sized joined string on every update.
- Far selection uses a bounded max-heap, preserving identity hash ordering,
  tie-breaking and selected membership without sorting the complete input.
  Exact membership is tested against full sorting, including reversed input.

## Latest qualification

After the heap change, the 12-case Vitest benchmark measured mean topology /
selection / cached layout costs of 15.19 / 1.24 / 0.290 ms at 10k,
97.04 / 4.00 / 2.157 ms at 50k, and 212.48 / 7.01 / 4.277 ms at 100k.
These replace the older selection implementation results below, not their
measurement scope or caveats.

`node tests/scale-workload.mjs 60` ran six native WebView2 aggregate-view trials:
10k/50k/100k inputs at 1360x820 and 400x740, each rendering 1,024 instances for
60 seconds. All produced 3,595-3,598 frames, nonblank pixel checks, retained
selected-member ray picking, and screenshots. CPU submission p95 was
0.4-0.8 ms, GPU execution p95 0.638-0.887 ms, and moving interval p95 16.8 ms.
Topology rebuilding took 54.5-497 ms and is not a per-frame operation. This
test uses production layout/selection with a separate Three instanced scene,
not the complete live renderer. Two short frontend tests ran during the narrow
viewport portion; other system load was not controlled. No isolated topology
performance or 100k full-detail claim follows from this run.

The opt-in Rust producer now drives the production delivery/chunk/ack path
into the real WebView assembler without modifying live observations or SQLite.
A 120-second slow-consumer trial generated 6,000,000 events in 120.014 seconds
(49,994/s), retained 256, allowed at most one pending transfer, delivered
111,360 rows, and reported 5,888,640 explicit gaps. The final cursor drained
to 6,000,000 with zero pending transfers. A separate 60-second trial also
passed. This demonstrates nominal 50k/s latest-state coalescing under delayed
acks, not lossless delivery, OS collection at that rate, or a long-term total
process-memory bound. Ordinary launches reject both qualification commands.
See Phase 12 for complete measurement scope and remaining budgets.

## Synthetic measurements

Windows 11 x64, i7-6700, 8 logical processors, Vitest 5/jsdom, uninstrumented
Node/Vite transform, single run; these are JS operation latencies, not GPU frame
times or native release timings. Inputs are deterministic process IDs in one
galaxy, with no events, connections, files, collector or WebView. Approximate
mean milliseconds (separate runs and warmups; not paired trials):

| Entities | Topology rebuild before / after | Far selection | Cached metric-only before / after |
| ---: | ---: | ---: | ---: |
| 10,000 | 16.6 / 13.0 | 3.65 | 2.07 / 0.25 |
| 50,000 | 99.4 / 90.9 | 26.8 | 12.75 / 2.13 |
| 100,000 | 238.5 / 233.2 | 59.0 | 30.4 / 3.98 |

At the 4,096-instance buffer size, eight sparse color updates averaged about
0.079 ms; a dense 4,096-color update averaged about 1.01 ms. Eight sparse
matrix updates averaged about 0.23 ms. Vitest warned about module-export
getter overhead during the dense-color case; these are noisy JS measurements,
not measured GPU transfer bandwidth. Upload-range correctness and selected
identity are covered by frontend tests.

A later 12-case rerun on the same machine measured 50k topology rebuild at
105.60 ms, far selection at 36.84 ms and cached metric-only layout at 5.01 ms.
At 100k those means were 249.13, 77.74 and 4.92 ms, respectively. Dense
4,096-color upload averaged 1.15 ms, with the same Vitest getter warning.
These single-run means are not a native WebView frame-time distribution.

## Synthetic event pressure

Release C++ journal test generates a 4,096-process initial burst and six
successive 4,096-PID reuse snapshots, producing 49,152 additional lifecycle
events in roughly 25 ms (about 1.94 million synthetic events/s on this run).
The ring remains at 256 recent events, its eviction count and sequence cursor
agree, and a slow consumer's earlier window remains immutable. A separate
release Rust bridge test advances the latest state 50,000 times without an
acknowledgement: only the original transfer is emitted until the ack, after
which the bridge sends the newest state. These tests bypass OS collection,
serialization into a live WebView, IPC parsing and history writes; they do not
prove sustained end-to-end event throughput or bounded total app memory.

## Verification to date

Frontend: 64 tests, lint and production TypeScript/Vite build pass. Native:
seven CTest executables, 20 release Rust tests and release Clippy pass. The
rebuilt release WebView smoke passes live process/resource, network, filesystem,
history, renderer recovery and desktop/narrow canvas checks (566/790 lit
pixels; no page errors). Its first run timed out waiting for replay to load a
newly recorded session; an unchanged second run passed, and a later full native
run also passed after the idle stability check paused live collectors.
That earlier replay failure was subsequently reproduced as a same-session
selection clearing the timeline without rerunning its load effect; a guarded
selection handler and regression test fixed it. Browser preview had working WebGL at 1360x820
and 400x740 without horizontal overflow; it has no native process data.

Normal release, recording off, 30 s warmup then 60 one-second samples on the
same i7-6700/8-logical-CPU Windows 11 machine: whole-app CPU mean 0.844%, median
0.749%, p95 1.676%, p99 2.090%; host mean 0.381% and WebView tree mean
0.464%. Seven-process summed working set mean 403.0 MiB, private mean
184.2 MiB, host private mean 7.10 MiB. Other system activity was not
controlled; this is idle only, not an orbit or large-count profile.

## Outstanding qualification

This is not a 10k/50k/100k interactive renderer certification: 100k topology
rebuilds remain far above the 16.7 ms frame target, and the two GPU buffers
remain sized for the real 4,096-process cap. The latest qualification above
adds bounded native aggregate rendering, GPU queries and two-minute isolated
bridge/WebView pressure. Long-duration total-memory soak and full-detail
high-count interaction remain unqualified. Phase 12 adds active orbit and
selection/focus/replay CPU/memory distributions and JSON-envelope IPC bytes
at the real observed process count. The idle working set of 403.0 MiB
already exceeds the 250 MiB review target. Do not use synthetic timings as
evidence that untested interactive or end-to-end pressure gates pass; no
Phase 10 release tag is claimed.