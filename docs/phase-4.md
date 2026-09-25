# Phase 4: lifecycle and bounded change delivery

Status: implemented and verified in the Windows desktop on 2026-09-25. This is the
Phase 4 milestone, not completion of Universe OS. Persistent history, replay,
resource mapping and later collectors remain out of scope. The inherited
working-set budget deviation is still open.

## Native semantics

- First complete observation is a baseline, not thousands of process births.
- Consecutive complete snapshots produce PROCESS_CREATED (first observed),
  PROCESS_TERMINATED (no longer observed), and coalesced PROCESS_UPDATED events.
- Every event has an increasing engine-session sequence, UTC observation time,
  prior observation time and monotonic timestamp. Polling does not establish an
  exact termination time, crash cause, or completeness for short-lived processes.
- PID reuse with different known creation times produces removal/appearance of
  distinct lifetimes. A weak/strong identity transition is an identity update,
  not a fabricated termination and birth.
- Collection errors and truncation emit a gap once per interrupted interval.
  Recovery establishes a new baseline. Intentional pause is recorded separately;
  it does not imply process termination.
- The native recent journal retains at most 256 events. Sequence bounds and
  eviction counts make missed consumer history detectable. This is bounded RAM
  observation history, not SQLite persistence or timeline replay.
- Native diffs compare meaningful process fields, resolved parent/group identities,
  and group aggregates. CPU timing counters and collection timestamps alone do
  not force unchanged process rows back through IPC. Removals use lifetime IDs,
  never PID alone.

Tests cover baseline, appearance, PID reuse, identity/permission change, gaps,
pause/resume, unchanged and metric-only diffs, and a 4,096-process burst. On the
local Release build, burst normalization plus unchanged diff took about 2.6 ms
in one test run; this is not a general throughput guarantee.

## Bounded transport

The immutable C++ process snapshot now also owns its event window. C ABI readers
check struct sizes and row indices. An owned delta handle returns process/group
upsert indices and lifetime-keyed removals. Rust retains native snapshot handles
through Arc so the base remains valid while a slower consumer catches up. Native
code, not React or Rust, decides which process/group fields changed.

Protocol 4 delivers a complete state first, then changes against the last fully
acknowledged state. Each transfer includes a sequence, optional base sequence,
collection metadata, process/group patches and event cursor/window information.
Unchanged metadata and timing counters are not retransmitted as full process rows.
The existing JSON representation is retained; no profiling result justified an
additional binary format at this stage.

- UTF-8-safe payload chunks are at most 256 KiB. JSON-escaped envelopes are under
  the architecture's 1 MiB per-message hard cap; tests include escaped and multibyte
  content across boundaries.
- A capped writer rejects serialized transfers over 16 MiB before growing past
  that transfer buffer budget. Browser reassembly enforces the same logical size
  cap, chunk count, subscription, transfer ID, ordering and exact byte count.
- Only one chunk is in flight. Matching transfer ID and chunk index acknowledge
  it; duplicate, stale or foreign acknowledgements cannot advance the stream.
- Only the final acknowledgement promotes the pending state to the delta base.
  Intermediate OS observations continue replacing the latest snapshot. The event
  ring separately retains observed transitions, including those hidden by state
  coalescing, up to its explicit capacity.
- Resync discards a pending transfer/base and sends a current full state with a
  new transfer ID. UI state is not mutated by partial chunks or invalid deltas.
  Duplicate changes, unknown removals, wrong bases and invalid graph references
  are rejected. Repeated failed automatic recovery is bounded and exposes an error.
- Event evictions and consumer cursor gaps are explicit. Eviction counts describe
  ring retention, not proof that all consumers missed those events. The UI shows
  actual detected missed journal entries separately.
- Subscription attempts are serialized in the frontend so late async cleanup
  cannot replace a newer subscription. The bridge's heavier commands execute off
  the window thread. Tauri remains the only live transport, with no loopback server.

A full decoded state still exists in both native/host and frontend memory; this is
delta delivery, not a claim of zero-copy operation. The 16 MiB cap is encoded
transfer/reassembly size, not total WebView heap or total application memory.

## Lifecycle experience

The optional Recent activity panel shows factual observed events, their observation
time/interval, process name and PID. It retains at most 256 records and displays
25 per page; metadata-only updates are hidden by default. Existing live processes
can be selected from the list; vanished ones are not offered as live objects.
The journal is volatile and does not implement SQLite recording or time travel.

Native appearance/disappearance events use existing observed positions in the
scene. New markers use the new layout; disappearance markers use the last observed
layout. No position is fabricated for a process never present in a rendered state.
At most 32 markers are retained, each lasting at most 900 ms. Snapshot/recovery,
event gaps, old events, collection pause, Eco and reduced-motion do not animate
birth/death. Native state changes still appear when effects are disabled.

Normal mode renders markers at appearance and expiry only. Cinematic opts into
animated pulses during their short lifetime. Metrics-only updates and empty effect
batches keep stable GPU/layout references, preserving demand-rendered idle behavior.
Diagnostics expose full-state/delta counts, changed process rows, event cursor,
journal evictions, current effect count and a manual full-state resync control.

## Validation

- 4 CTest executables pass: existing engine/model/collector checks plus the native
  lifecycle/diff suite. Includes initial baselines, PID reuse, weak/strong identity
  changes, errors, truncation, pause/resume, retained handles and a bounded 4,096
  event burst. An unchanged 4,096-row snapshot produces no process upserts.
- 9 Rust tests pass: actual native events/diffs, protocol encoding, UTF-8 chunk
  reconstruction, pre-growth size rejection, one in-flight chunk, final-ack base
  advancement, duplicate acknowledgements, resync and subscription replacement.
- 32 frontend tests pass: chunk ordering/size limits, no partial application,
  wrong-base recovery, full-state replacement, graph integrity, same-sequence
  resync, event retention, gap/baseline effect suppression and existing UI tests.
- Strict TypeScript build, frontend lint, Rust Clippy and release executable build.
- Actual native WebView: normal delta delivery, forced full-state resync, profile
  controls, collection pause/resume, reload, process/group inspection and picking,
  hierarchy/universe views, WebGL failure/recovery and clean close/reopen pass.
- Stalled consumer: CDP pauses WebView JavaScript for roughly 4.5 seconds while a
  real short-lived Node process starts and exits. After resume, both appearance
  and disappearance appear in Recent activity although the UI was stalled.
  This exercises the actual C++ collector and acknowledgement flow, not a mocked
  process stream. Initial attempted function interception did not affect Tauri
  internals; the final test uses a real debugger pause instead.
- Final controlled workload: PID 1780 measured 1.90% machine CPU vs 2.21% from a
  separate Windows reference interval, and 122.5 MiB working set vs 122.90 MiB.
  Sampling intervals differ; tolerances are intentional. No arbitrary process is
  stopped by the tests, only their own bounded workloads.
- Native screenshots/pixel checks at 1360x820 and 400x740, including the activity
  panel. Idle frame counter stabilizes after navigation/events; zero JS page errors.
  Artifacts and raw measurements are local under ignored `artifacts/`.

## Measured overhead

Release 0.4.0, Normal, collection enabled, default Universe view, diagnostics closed,
no debugger attached. Same Intel i7-6700 / 8 logical CPU machine, Windows 11 build
26200 and WebView2 153.0.4234.48. 30-second warmup + 60 one-second samples; native
host plus six WebView subprocesses. Final capture: 2026-09-25T08:30:27Z.

| Metric | Phase 4 final | Phase 3 reference |
| --- | --- | --- |
| Whole-app mean CPU | 0.623% | 0.611% |
| CPU median / p95 / p99 | 0.566% / 1.144% / 1.513% | 0.567% / 1.132% / 1.699% |
| Native host mean CPU | 0.348% | 0.302% |
| WebView mean CPU | 0.275% | 0.309% |
| Summed working set | 403.3 MiB | 397.9 MiB |
| Summed private memory | 180.8 MiB | 179.6 MiB |
| Native host private memory | 6.19 MiB | 5.44 MiB |

The instrumented runtime sample reported 268 processes/202 groups, 8 draws, 27
changed process rows, 17 delta batches and ~16.7 KB/s received wire payload. The
Phase 3 reference sample sent ~123 KB/s full-snapshot payload. These are different
live populations/intervals and envelope accounting, not a controlled throughput
benchmark, but demonstrate meaningful reduction in delivered data.

An earlier Phase 4 run with animated Normal-mode pulses averaged 0.892% CPU,
3.002% p95 and 4.846% p99. Normal-mode markers were changed to demand rendering;
the final sample above returned close to the Phase 3 baseline. This is a measured
before/after observation, not isolated proof of causality: other OS activity and
process churn were not controlled. Cinematic still intentionally allows higher
rendering activity. No GPU frame-time claim is made.

## Remaining limits

- The 250 MiB summed working-set review target remains missed. Shared pages can be
  counted more than once; private memory is separate, not a substitute. Mean CPU
  is below 1%, while p95/p99 exceed the approximate idle target.
- Polling can miss processes entirely between samples. It cannot determine exact
  death time, crash cause or continuous thread activity. No crash effects are used.
- Very slow consumers can outlive the 256-event window; the gap is reported and
  current state reconciles. This is not lossless persistent event logging.
- Snapshot cap remains 4,096 processes. Large aggregate transfers above 16 MiB
  fail explicitly rather than allocate an unbounded stream; no automatic reduction
  of field fidelity is performed silently.
- No 50k-events/sec certification, large-count GPU benchmark, multi-hour soak,
  per-thread core CPU attribution, or GPU timer queries yet. Synthetic burst tests
  are correctness/boundedness checks, not those later performance qualifications.
- Phase 5 resource-to-energy/mass mapping, later collectors, SQLite and replay are
  not implemented here. Recent activity is not a timeline/replay substitute.

Native feature commit: `d8c2ec9`. Streaming/lifecycle UI integration is a separate
verified feature commit with minor tag `v0.4.0`; no major tag, branch, remote or push.