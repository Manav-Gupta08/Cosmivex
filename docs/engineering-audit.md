# Engineering audit

Date: 2026-09-30. Baseline: `02fb415`. Status: OPEN, not release acceptance.
Latest verification: 2026-10-01, through `aeb039b`.
Scope: the Universe OS specification and resource-efficiency requirements.
Existing architecture is retained. No budgets are
waived. This report distinguishes source inspection, prior measurements, new
regressions, and tests that have not run. Absence of a detected leak is not proof
of leak freedom.

## Audit method

The initial pass inspected the owning implementation for Windows collection,
C++ scheduling/normalization/model/events, ABI ownership, Rust conversion and
delivery, SQLite writer/readers, Zustand updates, React shell/replay/diagnostics,
instanced scenes and timers, plus existing test entry points. This is a
cross-subsystem source audit, not a claim of exhaustive path or race coverage.
Third-party WebView/Tauri/Three internals require separate targeted verification.

Initial classifications use PASS, WARNING, FAIL, NOT IMPLEMENTED and
NOT VERIFIABLE. The final requirement matrix uses PARTIAL for WARNING, as
requested. PASS is scoped to the stated property and evidence, never an entire
subsystem merely because its tests pass. Existing results are historical evidence
from [Performance results](performance.md), not new measurements made during this audit.

## Initial findings

| ID | Severity | Initial status | Root cause / evidence | Impact and required check |
| --- | --- | --- | --- | --- |
| A01 | High | FAIL | `core/src/engine.cpp`: every configuration wake samples enabled processes; filesystem requests increment the same revision | Navigation can exceed process sampling frequency; reproduce with retained snapshot timestamps before/after a filesystem command |
| A02 | High | FAIL | `src-tauri/src/lib.rs`: history queries and recording transitions are synchronous commands | Database busy waits, migration/initial writes and writer joins can block the host event thread; move blocking operations off that thread with bounded ownership and test failure/concurrent transitions |
| A03 | High | WARNING | `bridge.rs`: recording start/stop is a multi-step operation without a lifecycle lock | Concurrent calls can race if commands become asynchronous; do not merely add `async` and introduce concurrent writers |
| A04 | High | WARNING | `NetworkScene.tsx` and `GalaxySystems.tsx`: replace uploaded BufferAttributes on updates | Previous GPU buffers may be orphaned from geometry disposal; reproduce create/delete buffer accounting before calling this a confirmed leak |
| A05 | High | FAIL | Existing local orbit CPU 5.63-5.82%, parse/apply p95 6.8-7.9 ms | Exceeds <3% CPU and <2 ms parse/apply budgets; require attributed profiles and repeated before/after native trials |
| A06 | High | NOT VERIFIABLE | No one-hour or four-hour evidence | Cannot sign off memory, handle, thread, GPU or storage stabilization |
| A07 | Medium | FAIL | `storage.rs`: `execute` recompiles sample UPSERT for each process/metric; buckets updated on each sample | Duplicate SQL preparation and write work; benchmark cached preparation and in-memory aggregation separately |
| A08 | Medium | FAIL | `storage.rs`: fixed 24h/256MiB constants; no size/event-count/retention UI | User-configurable retention and storage reporting absent; WAL limit is not a hard aggregate file-size cap |
| A09 | Medium | WARNING | Retention deletes occur in the checkpoint transaction; abandoned open sessions are not marked closed | Large deletes may monopolize writer; crash-session cleanup and WAL growth need sustained tests |
| A10 | Medium | FAIL | `Shell.tsx` footer unconditionally says History off | Incorrect collection disclosure while recording; verify enabled/error/disabled UI states |
| A11 | Medium | WARNING | Bridge serializes and sends under delivery mutex | Ack/subscribe can wait for encoding; no measured lock-wait distribution yet |
| A12 | Medium | WARNING | Process model rebuilt each sample; ABI copies all process/network rows for each health frame | Stable IDs/delta IPC do not eliminate upstream allocations; profile conversion and topology separately |
| A13 | Medium | FAIL | Cinematic InterfaceFlow creates Color, arrays and matchMedia queries inside useFrame | Avoidable per-frame allocations; use persistent objects/preferences and verify rendered behavior |
| A14 | Medium | WARNING | Diagnostics calculates GPU percentiles on every render; Shell subscribes to entire frame | Avoidable sorting/renders on telemetry changes; profile React and time metric snapshots |
| A15 | Medium | FAIL | Replay scene lacks live scene's minimized pause, frame limiter and context-loss recovery | Live-view tests do not qualify replay lifecycle; add replay-specific recovery/visibility tests |
| A16 | Medium | WARNING | Filesystem uses overlapped watch but synchronous bounded directory enumeration and cancellation drain | No explicit scan stop token or upper time bound on OS calls; disappearing/stalled media shutdown needs verification |
| A17 | Medium | WARNING | Historical query uses separate connections for anchor and deltas; stale UI requests are ignored but not cancelled | Retention/concurrent scrubbing can race or waste work; transaction-consistent bounded query needed |
| A18 | Medium | FAIL | Missing individual threads, system/per-core CPU, physical memory and disk collectors | Master telemetry/visual mapping coverage incomplete; do not fabricate missing fields |
| A19 | Medium | WARNING | Five visibility close/reopen passes after earlier unexplained hangs | Successful revalidation is not a root-cause fix; suspend/resume/crash soak remains open |
| A20 | Low | WARNING | Test pressure producer is Rust and aggregate scene is separate Three scene | Useful bounded bridge/GPU evidence, not real OS 50k/s or full live 100k scene certification |

Paths abbreviated above are relative to `apps/desktop` unless rooted at `core`.
These are baseline findings. The optimization log below records subsequent fixes;
unresolved qualification work is not erased by a local regression pass.

## Requirement matrix

Each row includes implementation, evidence/files and applicable tests. Related
clauses of the two specifications are grouped; missing optional detail is not
silently converted into a PASS.

| Requirement | Implementation / files | Status | Evidence / tests / gap |
| --- | --- | --- | --- |
| Real observed entities, no production synthetic telemetry | C++ collectors; opt-in separate pressure state | PASS | Native process/network/filesystem smoke; pressure fixture never applied to live store/history |
| Windows 11; C++20, Tauri2, React/TS/Vite, R3F/Drei/Zustand/SQLite | CMake, Cargo, package manifests | PASS | Existing release build and native tests; no platform migration proposed |
| Platform abstraction, no UI OS collection | `core/include/universe`, Windows collectors, `native.rs` | PASS | Portable record/interfaces and opaque ABI; frontend issues configuration only |
| Core ownership of history/storage | C++ events/model; Rust SQLite writer | PARTIAL | Justified host ownership exists but accepted design's C++ storage location is not actual implementation |
| Process identity/name/PID/parent/path/creation/CPU/working set/count | `process.cpp`, `model.cpp`, `process.rs` | PASS | Process/model/resources tests; protected measurements nullable; creation-validated parents |
| Process exact exit/state/crash inference | Poll-derived disappearance and intervals | PARTIAL | No exact exit/crash classification; intentionally no invented crash effects |
| Individual thread telemetry and planets | Count only | NOT IMPLEMENTED | No thread collector/identity/orbiting-thread scene |
| Overall/per-core CPU and frequency | No dedicated collector | NOT IMPLEMENTED | Per-process CPU must not be mislabeled system CPU |
| Total/used/available physical memory | Per-process working set only | NOT IMPLEMENTED | Summed process working set is not physical-memory utilization |
| Disk capacity/read/write telemetry and effects | No disk collector | NOT IMPLEMENTED | No disk streams or storage-device visualization |
| Network endpoints, interfaces, protocol/state/rates | `network.cpp`, `NetworkScene.tsx` | PASS | Native TCP/UDP smoke and network tests; rates are interface-level, not per connection |
| Network lifecycle event normalization | Snapshot observations stored | PARTIAL | No NETWORK_CONNECTED/DISCONNECTED event journal |
| Filesystem create/modify/delete/move, read-only scope | Overlapped direct-child watch, `filesystem.cpp` | PASS | Filesystem tests/smoke; explicit gap on overflow, reparse navigation rejected |
| Timestamped stable events and bounded aggregation | EventJournal, NetworkTracker, file revisions | PASS | Changes/network/filesystem unit tests; poll precision/identity limitations disclosed |
| Configurable sampling independent of UI | Profiles/toggles, separate process/network deadlines on shared worker | PARTIAL | A01 timestamp regression failed before and passes after fix; arbitrary interval controls and sustained request stress remain unverified |
| Application galaxies/process stars/child relationships | Validated ancestry/image grouping and layouts | PARTIAL | Model/frontend picking tests; inferred groups not complete application identity; no child moon geometry |
| All views share factual model | Universe/hierarchy/network/filesystem from core store | PASS | Integration tests; no duplicate UI collectors |
| Camera orbit/pan/zoom/focus/reset/clipping | `Scene.tsx`, CameraControls | PASS | Runtime and keyboard checks on live view |
| Search names/PIDs/files/directories/IPs/ports/applications | View-specific search and selection | PARTIAL | Process/network tests; cross-view application search and automatic galaxy focus incomplete |
| Every major entity selectable and factual inspector | Instanced picking and metadata panels | PARTIAL | Live process/galaxy/network/file tests; thread inspection absent |
| Minimal spatial UI, restrained identity, useful without effects | Full scene, optional panels, resource switch | PARTIAL | Prior desktop/narrow screenshots and axe checks; complete aesthetic acceptance subjective |
| Profiles Eco/Normal/Cinematic | Native intervals, 30/60 draw cap, DPR limits | PARTIAL | Profiles tested; Eco history buckets remain 10s, not planned 30s |
| GPU instancing/pooling/LOD/batched changes | Process 4096 slots x2, far 1024; bounded effects | PARTIAL | LOD/resource tests; only two process levels, no thread detail; LOD distance is from origin |
| Frustum/offscreen CPU reduction | Mesh bounds/culling, far selection | PARTIAL | Per-object CPU update culling absent; batched frustum culling is not per-instance throttling |
| No avoidable frame allocations | Refs in effects; allocations in interface flow/timer queue | FAIL | A13; profile allocation rate before/after |
| No unnecessary React updates | Zustand selectors and stable IDs/layout/resources | PARTIAL | State tests; broad Shell frame subscription and diagnostic sorting remain |
| Pause hidden/minimized/background work | Shared RenderBudget in live and replay scenes | PARTIAL | Native replay and live minimized draws/restore pass; merely backgrounded cinematic work and sustained replay soak remain unqualified |
| Restrained configurable effect budgets | 32 lifecycle rings/900ms, 256 interface flow slots | PASS | Effect tests and profile/reduced-motion branches; no bloom/shadows/postprocessing in hot path |
| Idle <1%, Normal <3% | Existing process-tree sampler | FAIL | Earlier idle 0.844%; normal orbit 5.63-5.82%; no new audit baseline yet |
| 60FPS/~16.67ms stable frame budget | Demand rendering, GPU timer | FAIL | Moving cadence p95 17.3-17.4ms; exact presentation p99 unavailable |
| Attributed CPU/performance monitor | Collector wall ms; host/WebView CPU sampler | PARTIAL | C++ telemetry/event/IPC/React attribution and live CPU/memory readouts missing |
| Low initial memory | Tauri/WebView whole process tree | FAIL | Earlier first sample 429.3MiB; target 250MiB; not exact launch peak |
| No busy waits, intentional recurring work | Condition variable, mailbox wait, owned JS timers | PARTIAL | No uncontrolled production spin found; OS waits and scheduling coupling require checks |
| Thread purpose/minimal count/cancellation | One C++ worker, Rust bridge, optional writer | PARTIAL | Lifecycle tests; runtime framework thread inventory not captured |
| RAII ownership and no known leaks | Snapshot/Engine Drop, jthread, process HANDLE wrapper, line-buffer disposal | PARTIAL | A04 installed Three buffer create/delete accounting passes; no long-run GPU-memory proof |
| All application queues bounded/backpressure | Latest mailbox, one delivery, one writer item, 256 events | PASS | Queue bounds inspected and slow-consumer tests; framework task queue not included in this claim |
| Every queue observed peak/memory cost | Most lengths not exported | NOT VERIFIABLE | Only isolated delivery/journal peaks recorded; production occupancy instrumentation absent |
| Compact deltas not per-frame complete states | C++ diff -> bounded JSON -> chunk ack | PASS | Stream tests; 16MiB transfer/256KiB chunk; changed network snapshots still full tables |
| No redundant serialization/copying | Delta encoding with full ABI conversion | PARTIAL | A11/A12; nested escaped JSON, writer separately encodes; profile costs before binary decision |
| IPC bounds, malformed input, gaps and reload | Schema, assembler, C ABI checks and resync | PASS | Native/TS transport tests; callback work timing excludes outer Tauri decoding |
| SQLite background batching/prepared statements | Optional writer transactions, cached sample SQL, two admitted blocking history jobs | PARTIAL | A02/A03/A07 focused tests and native recording/replay pass; resource buckets still UPSERTed each sample; contention responsiveness not measured |
| Retention, bounded storage, configurable duration and display | 24h pruning/256MiB max pages, fixed policy | FAIL | Retention tests cover anchors; controls/count/size absent; no total DB+WAL hard bound proof |
| Bounded consistent historical reconstruction | One read transaction, anchor plus <=256 deltas | PARTIAL | A17 concurrent-deletion snapshot regression passes; cancellation/parsed-object budget and non-process replay views remain incomplete |
| History process/network/resource/filesystem inspection | Records metadata, process timeline render | PARTIAL | Counts and event kinds shown; no full historical network/filesystem visual inspectors |
| Filesystem churn aggregation, no raw-event objects | 64KiB notify buffer,256 events,4096 entries | PARTIAL | Decoder/gap tests; npm-install/build/extraction long stress not measured |
| Process model incremental allocation behavior | Stable identities/delta comparison; full native model rebuild | PARTIAL | Process/model tests; unchanged topology still sorted natively each sample |
| Network expired objects/bounded visual lifetime | Current snapshot/4096 endpoint instances, explicit line-buffer replacement cleanup | PARTIAL | A04 accounting and native endpoint removal/picking pass; sustained GPU-memory churn remains unmeasured |
| Startup/shutdown/reload/recovery | Native stop/join, renderer boundary/live recovery | PARTIAL | Earlier unexplained close hangs; crash/suspend/resume and replay recovery unqualified |
| Error matrix: exit/denied/malformed/IPC/DB/overflow | Unit and native integration tests | PARTIAL | No complete fault injection for disappearing interfaces, stale removable media, long DB contention |
| Production logging low volume | Bridge error stderr then worker exits | PASS | No per-sample production logging found; no metadata packet logging |
| Cache size/invalidation/lifetime | Last snapshot maps, PID+creation image cache, singleton file cache | PARTIAL | Bounded by entity caps; retained capacities and GPU caches need soak measurements |
| Locks fine-grained, no global pipeline mutex | Engine lock excludes OS collection; delivery/record locks | PARTIAL | Journal runs under engine lock, encoding under delivery lock; no contention profile |
| Least privilege/no file contents/no packet payloads/no external inference services | Restricted capabilities and metadata APIs | PASS | Config/API inspection and native tests; pressure commands env-gated, no payload collector |
| Benchmark 10k/50k/100k and 50k events/s | Isolated scale/pressure scripts | PARTIAL | Prior six 60s aggregate runs,120s producer; not complete live high-count scene or end-to-end OS events |
| Matrix 25/100/500/1000+, churn/network/files/idle/restored | Scattered synthetic and live tests | PARTIAL | No unified measured CPU/RAM/handles/threads/IPC/DB matrix |
| One-hour and four-hour stability | No completed run | NOT VERIFIABLE | Must collect actual elapsed-time evidence, not extrapolate short trials |
| Profile before/after each optimization | Previous CPU profiles and workloads exist | PARTIAL | Need fresh attributed baseline and comparative trials for each audit fix |
| Completion only after all audits and long-run gates | This open report | FAIL | Explicitly not accepted; no completion tag or feature deletion for benchmark compliance |

## CPU report

Historical whole-app normalized CPU: idle mean 0.844%, p95 1.676%; local-input
normal orbit mean 5.63-5.82%, p95 7.22-7.95%. Selection/focus/replay means
8.87/7.01/4.36%. These workloads include automation and diagnostics overhead.
Host/WebView role data exists in artifacts, but host is C++ plus Rust, not
C++ telemetry alone. C++ event, ABI conversion, IPC encode, React render,
WebGL driver CPU and lock-wait costs are NOT separately verified. Collector
wall duration is not CPU time. High-load attributed CPU remains unmeasured.

## Sampling and thread report

| Owner | Purpose / frequency | Blocking/cancellation | Bound / cost evidence |
| --- | --- | --- | --- |
| C++ jthread | Processes 1s Normal/Cinematic,2s Eco; network2s/5s target | Engine condition variable; stop token between OS records | Process4096,endpoint4096,interface128; collection wall times only |
| Same C++ worker | Filesystem notify poll on engine wakes, rescan after notification/request | Overlapped64KiB buffer; synchronous scan; CancelIoEx/drain on close | Direct children4096,event256; A01/A16 |
| Rust core-bridge | Wait for native revision, maximum30s wait timeout | Stop engine wakes mailbox; join in shutdown | One replaceable latest value; converts every delivered health |
| Optional history-writer | Receive Health, transact,60s checkpoint/prune | Bounded receiver; drop sender then join | One waiting Health plus active writer snapshot; no separate timer |
| Tauri/Tokio/WebView threads | UI/IPC/runtime/renderer/GPU/utility | Framework-owned | Total/thread-role counts and wake rates NOT VERIFIED |
| Frontend | No app Web Worker | Browser event loop | No worker pool needed for current implementation |
| Qualification producer | Opt-in Rust blocking task,20ms ticks,5-120s | Fixed duration,5s drain | Not production persistent worker; cancellation on close not separately tested |

The audit fix waits until the earliest health/process/network deadline. This
removes the prior Eco5s network deadline's quantization to roughly6s by process
ticks, and filesystem requests no longer advance process sampling. Work duration
still affects cadence; frequency is not a hard real-time guarantee. Per-source
expected CPU cost has not been measured separately; do not guess those values.
History commands now admit at most two blocking jobs; extra requests fail fast
instead of creating an application wait queue. Framework pool thread counts still
need measured inventory. A recording-transition mutex serializes start/stop/join.

## Memory and leak report

Historical startup first sample5.84s429.3MiB, sampled peak441.1MiB; idle403MiB;
orbit~491MiB; selection523.5MiB; focus484.9MiB; replay519.6MiB summed working set.
Shared pages may be counted multiple times. Stress JS heap13.6-50.7MB over120s
showed collection drops, not proof of stable total process memory.
Private/committed memory, handles, threads, sockets, GPU allocations, DB resources
and object counts have no one-hour/four-hour growth evidence. A04 is now a verified
explicit-cleanup defect: installed Three removes only currently attached
attributes on geometry disposal. Equal-sized updates now reuse attributes;
resizes dispose before replacement. A fake-GL test balances buffer creates and
deletes across100 resizes, not a measurement of total GPU memory.
Native process handles use RAII; directory monitor
owns handle/event/overlapped buffers and cancels/drains before closing. Snapshot
handles are shared only for immutable state/diff/writer lifetime. Rust caches and
native trackers replace previous maps rather than retaining all historical IDs.

## Queue and cache report

| Structure | Capacity / overflow | Ownership / observed peak |
| --- | --- | --- |
| Native latest health/model | One current immutable snapshot | Engine; retained consumers may hold older snapshots |
| Filesystem commands | One optional request; latest replaces pending | Engine; no unbounded queue |
| Process event ring |256;evict oldest,sequence/eviction counter | EventJournal; prior stress peak256 |
| File notifications / recent events |64KiB/256;explicit gap/rescan and oldest eviction | Monitor; decoder transient bound by64KiB |
| Delivery | One pending transfer16MiB, chunks256KiB | Bridge; isolated observed peak1 |
| Writer | One waiting Health; full drops attempted newer item | Recording; cursor detects lost events, dropped item count not exposed |
| Replay |256 packets/16MiB delta aggregate; checkpoint separately16MiB; shared two-job admission | Query-local read transaction; parsed-object expansion still lacks explicit global byte accounting |
| History command admission | Two active blocking jobs; reject excess immediately | Host-owned RAII permits include queries and recording transitions; release-on-error unit test passes |
| Process/image/model/network caches | Current entity caps4096/128 | Collector/tracker/layout; new snapshot replaces old |
| Filesystem Rust cache | One revision/Arc | Engine wrapper; replaces on changed revision |
| Metrics |4096 recent samples per metric | Module arrays; percentile sorting allocates copies |
| Lifecycle/flow instances |32/256 | Scene lifetime; expires900ms/current positive interface rate |

## Storage report

SQLite lives in user app data and is opt-in. WAL, synchronous=NORMAL,
250ms busy timeout, one writer connection and separate reader connections.
Main database max-page budget256MiB; journal_size_limit16MiB controls retained
journal size, not a strict WAL peak while readers pin pages. Every accepted
health is transacted; resource bucket10s UPSERTs still run for each process
sample, full checkpoint60s, deltas between, entities on checkpoint. Network and
filesystem observation JSON duplicates some information in replay packets.
Resource UPSERT SQL now uses rusqlite's bounded connection statement cache;
this reduces repeated SQL compilation, not write frequency or disk bytes.
Prune at full checkpoints retains preceding replay anchor, removes aged closed
sessions/data. Live database bytes/event count/write volume not newly measured.
Retention configuration, chunked cleanup, crashed-session reconciliation and
runtime size/count reporting are not implemented. No claim of zero disk writes:
WebView profile/cache writes are outside the history toggle.

## IPC report

C++ ABI borrows bounded snapshot strings during Rust conversion; Rust copies
records and retains native snapshots for C++ diff. JSON packet is embedded in
JSON chunk envelopes. Sender ack gating prevents unlimited channel production.
Earlier normal envelope RX44.8-46.8KB/s; pressure302KB/s. These exclude ACKs,
other commands and WebView framing. Mean message size, peak message rate and
native serialization/lock CPU are NOT VERIFIED. Process deltas reduce transfer
size; changed network samples carry full tables. Binary remains a measured
design option, not an assumed remedy.

## Rendering and UI report

Live demand canvas, normal60/Eco30 ceiling, DPR1/2. Process two4096-slot meshes,
far1024 selected membership; galaxies4096 rings, endpoints4096,interfaces128,
files/directories4096 each. No per-entity React DOM; lists page50. Attributes
use sparse ranges for process resources; topology/link/network updates rebuild
arrays. Frustum culling is mesh-level. Current live CPU submission p950.7-0.8ms,
GPU1.84-4.63ms, paired CPU+GPU work2.90-5.26ms, cadence17.3-17.4ms. Paired work
is not presentation latency. Exact frame p99, allocation profile, visible versus
total instance counts, GPU usage percentage/memory are not qualified. Prior
aggregate tests were separate scenes, not full live high-count UI tests.

Recurring JS timers: transport watchdog10s startup/interval-derived stale delay;
Diagnostics1s metrics and2s recording status; Replay1.2s playback; lifecycle
expiry timeout900ms; filesystem highlight expiry5s. Effects clear their owned
timers on dependency change/unmount. Pending native history reads are ignored
when stale, not cancelled. Replay continues live store subscription in Shell.
Live and replay now share frame submission limits, native minimized-state handling
and context-loss detection. Replay exposes renderer retry while retaining recorded
details. Native tests verify no redraw for selection while minimized, redraw on
restore, nonblank desktop/narrow rendering, and context-loss/retry. Temporary
production probe counters were removed before final release validation.
No independent continuous animation except active camera/cinematic data effects.

## Concurrency and lifecycle report

Engine mutex protects flags, requests, publication and journal updates; OS
collection is off-lock. Configuration revision rejects an obsolete sample.
Bridge uses separate delivery/recording/worker locks; worker releases recording
lock before acquiring delivery. Recording worker joins outside recording lock.
Encoding/send under delivery lock and multi-step recording transitions require
different follow-up: encoding lock duration is still unmeasured; recording
transitions now have a dedicated lifecycle lock and reject starts after shutdown.
Four concurrent starts leave exactly one open session in the regression test.
Native immutable snapshot ownership permits cross-thread reads;
destroy requires exclusive Engine ownership. Shutdown drops recording sender,
joins writer, signals engine stop, joins bridge; Engine Drop joins C++ jthread.
Filesystem cancellation waits for overlapped completion. No suspend/resume or
deadlock/priority-inversion profile has been completed. Five prior strict
visibility shutdown passes do not erase earlier unexplained failures.

## Verification plan and optimization log

1. Reproduce A01 with existing native engine test; enforce independent collector
   deadlines and verify filesystem requests stay responsive without extra scans.
2. Reproduce A04 with WebGL buffer creation/deletion accounting; fix only verified
   resource ownership defects and stress repeated topology/selection changes.
3. Move A02 blocking commands off UI with serialized recording lifecycle (A03),
   then test rapid start/stop, errors, contention and shutdown.
4. Benchmark A07 prepared statements before/after; separately design true batched
   resource persistence without losing historical samples or changing replay.
5. Profile native worker/bridge and React/WebGL allocation/CPU ownership; optimize
   proven hotspots and rerun matched30s warmup/60s workload trials sequentially.
6. Complete missing fault/workload matrix, then run actual1h and4h sessions,
   capturing process-tree private/working/committed memory,handles,threads,
   queue peaks,DB+WAL bytes and GPU counters where supported. Compare plateau
   windows after warmup and investigate sustained growth, not only endpoints.

### Verified local changes

| Finding | Change | Discriminating evidence | Remaining qualification |
| --- | --- | --- | --- |
| A01 | Independent process deadline; wait for earliest collector deadline | Filesystem-stop-between-Eco-samples timestamp assertion failed before, passed after | Repeated request bursts; attributed whole-app CPU benefit |
| A02/A03 | Bounded blocking history commands and serialized recording transitions | Two-permit release/error test; four concurrent starts; start-after-shutdown rejection; native record/replay/close passes | Injected long DB contention responsiveness and shutdown races |
| A04 | Reuse equal-sized line attributes; dispose installed buffers before resize | Installed Three buffer-manager accounting:100 resizes and final dispose balance creates/deletes; native picking/context recovery passes | Sustained GPU-memory/object growth and driver behavior |
| A07 | Cached prepared resource UPSERT | Same40,000-operation in-memory benchmark;4000 rows and40000 aggregate samples in each trial | Disk write volume and in-memory bucket batching not changed |
| A10 | Footer says History opt-in rather than a false fixed History off | Shell regression verifies policy label; diagnostics retains confirmed status | Does not add a live footer status or redundant polling |
| A17 | One SQLite read transaction for anchor and delta chain | Concurrent deletion cannot change retained snapshot; new reader sees deletion | In-flight query cancellation and parsed-memory budget remain open |
| A15 | Share render budget, minimize handling and context-loss recovery with replay | Four controller/timer tests; native replay minimize/restore/context retry and live visibility/close/reopen pass on clean release | Earlier restore-probe failures remain unexplained; sustained replay/suspend coverage remains open |

SQL benchmark command:

```powershell
cargo test --release --manifest-path apps/desktop/src-tauri/Cargo.toml --lib storage::tests::profile_resource_sample_writes -- --ignored --nocapture
```

Five baseline times(ms):627.228,627.303,810.160,631.762,614.397.
Five cached times(ms):104.515,95.965,104.863,98.141,186.769.
Median627.303 ->104.515ms,83.34% lower. Fresh in-memory databases,1000 process
identities,two metrics,20 samples,one transaction per sample. This isolates SQL
preparation/execution and explicitly excludes filesystem latency; it is not an
83% whole-app CPU improvement or evidence of reduced storage traffic.

Audit validation to this point:70 frontend tests,21 Rust tests plus one ignored
opt-in benchmark,frontend lint and native release build pass. Full native
workflow passes: real process/resource/network/filesystem checks,record/replay,
desktop/narrow nonblank pixels,context recovery,ordinary shutdown within5s/reopen.
The later A17 storage change passes all8 normal storage tests; its release rebuild
and second full native workflow also pass. No page errors were observed.
Clippy passed before A17 but a subsequent check and sequential retry were blocked
by a rustc1.98.1/Clippy internal panic decoding an Option discriminant in metadata.
This is not a clean final lint pass. The compiler suggests a Clippy bug report;
On2026-10-01 Clippy passes again with warnings denied, without a source/cache
workaround. The earlier compiler panic is retained as an unexplained toolchain
failure, not claimed as a project-code fix. Current host tests also pass.

The earlier full C++ rebuild was blocked by a missing installed Windows SDK header:
`C:/Program Files (x86)/Windows Kits/10/Include/10.0.26100.0/shared/minwindef.h`.
Retrying only the filesystem target reproduced C1083, so that run's passing
filesystem test was not newly rebuilt evidence. On2026-10-01 the full C++ build
and all7 CTest suites pass, including filesystem. No project code or system SDK
files were altered by this audit to hide the failure. Its transient cause is
unproven. Existing Vite large-chunk warning remains.

Focused local commits: `ddd1ee5` sampling, `fc33a78` GPU line ownership,
`6d443b2` history concurrency, `8067b07` SQL/replay consistency, `723cd18`
history disclosure, and `aeb039b` shared rendering lifecycle. None waives a
resource budget or signifies overall acceptance.

### Long-run evidence collection

`scripts/measure-soak.ps1` writes one flushed JSONL record per sample, alongside
an end-of-run summary and release executable SHA256. Process discovery runs each
sample and keys CPU deltas by PID+creation time. It records per-role CPU,working
set,private commit,paged memory,handles,threads,foreground/minimized state and
history DB/WAL/SHM sizes. Summary includes CPU mean/p95 and early/late10-minute
resource averages. Full measured span and ordinary shutdown within5s are required
for completion; completion is not a leak-free verdict.

Two30s sampler smoke runs completed, including ordinary close. These validate
the harness only and do not replace either required duration. The previous
one-hour attempt was interrupted after roughly470 seconds, with no completion
summary; it does not satisfy either long-run requirement. No completed hour-scale
result is available. A subsequent two-hour measurement was scheduled as
a fresh7200s run after release validation, without concurrent builds/benchmarks:

```powershell
.\scripts\measure-soak.ps1 -DurationSeconds 7200
```

This additional two-hour test does not replace the required four-hour session.
The7200s attempt on2026-10-01 was subsequently interrupted: its JSONL contains
280 samples spanning4218.735s (70.31min), with no completion summary and no
recorded ordinary shutdown. The app was no longer running when inspected.
Mean normalized app CPU was0.7810%; private commit174.35 ->188.53MiB,
peak206.46MiB; final3022 handles/137 threads versus3063/155 initially.
Database+WAL+SHM bytes remained7,880,704. This is partial evidence only, not a
passed two-hour run, a leak-free verdict, or completed one-hour lifecycle test.
Raw evidence: `artifacts/soak-7200-20261001-102149285.jsonl`.

The original duration commands remain:

```powershell
.\scripts\measure-soak.ps1 -DurationSeconds 3600
.\scripts\measure-soak.ps1 -DurationSeconds 14400
```

This workload is Normal live idle with history off and no CDP. It cannot certify
active replay/recording/churn,queues,JS object counts or GPU allocation stability.
Recording-off database sizes include pre-existing user history. Sampler overhead
is outside app CPU; short-lived processes entirely between samples can be missed.
Visibility is recorded, not assumed. No acceptance tag is warranted, and missing
features are not removed to meet a benchmark.

## Remaining risks

### Testing handoff

The committed release through `aeb039b` is available for interactive testing.
The previously recorded70 frontend/21 Rust/7 native tests and native lifecycle
checks passed when that release was built; they are not new results from this
handoff. A subsequent Vitest run crashes before reporting tests with Windows
access violation0xC0000005 (3221225477/-1073741819), including a single forked
worker run. Node ESM, npm, bundler/test API imports and TypeScript work. No
faulting module or cause has been established. Captured output is in
`artifacts/diagnostics-test.log`. A proposed A14 diagnostics sampling edit was
removed because it could not be behavior-validated; application sources and
tests were confirmed identical to the last validated commit. TypeScript passes.

Remaining acceptance work includes:

- Meet and remeasure active CPU, startup memory, parse/apply and frame budgets.
- Complete uninterrupted long-run tests with shutdown, including four hours;
   add sustained recording/replay/churn and GPU/queue/resource growth coverage.
- Resolve A08/A09 storage controls/reporting and retention/crash-session work;
   A11/A12 lock/conversion costs; A13/A14 frame allocations/diagnostic work;
   A16 filesystem cancellation and the remaining fault/concurrency matrix.
- Implement missing individual-thread entities, system/per-core CPU/frequency,
   physical-memory and disk telemetry, network lifecycle events, and full
   historical network/filesystem inspectors. These are product features, not
   cosmetic testing adjustments; current views must not imply those data exist.

The original product includes substantial telemetry/interaction not yet built.
The current implementation is not in strict master-spec compliance. This audit
must remain open until attributed profiling, all repaired-path tests, resource
lifetime checks, error/stress matrix and long-duration runs are complete.
Neither compilation nor short-run success satisfies those gates.