# Phase 10: large-count renderer work (in progress)

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

Frontend: 54 tests, lint and production TypeScript/Vite build pass. Native:
seven CTest executables, 20 release Rust tests and release Clippy pass. The
rebuilt release WebView smoke passes live process/resource, network, filesystem,
history, renderer recovery and desktop/narrow canvas checks (566/790 lit
pixels; no page errors). Its first run timed out waiting for replay to load a
newly recorded session; an unchanged second run passed, so intermittent
replay latency remains a risk. Browser preview had working WebGL at 1360x820
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
remain sized for the real 4,096-process cap. No end-to-end 50k-events/s
producer, long-duration slow-consumer/queue-overflow soak, sustained churn,
frame p95, GPU timer query, active whole-app CPU/memory/IPC or native LOD
interaction measurement has been run for this phase. Current whole-app working
set of 403.0 MiB exceeds the 250 MiB review target. Do not use these synthetic
timings as evidence that
those gates pass; postpone a Phase 10 release tag until representative native
qualification is recorded.