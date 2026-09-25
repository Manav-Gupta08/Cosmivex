# Universe OS: architecture and implementation plan

Status: accepted starting design, before Phase 1 implementation. Windows 11 x64 first.
Performance and factual provenance take precedence over effects and feature count.

## 1. Boundaries and repository

```text
apps/desktop/
  src/                 React UI, Zustand view state, transport adapter
  universe/            R3F scene, camera, later instanced buffers and LOD
  src-tauri/           Rust host, C ABI ownership, channel delivery, capabilities
core/
  include/universe/    public portable C ABI and common contracts
  src/                engine scheduling and latest-state mailbox
  platform/windows/   Windows collectors (introduced in Phase 2)
  telemetry/          normalization and aggregation (introduced with collectors)
  universe/           observed entity graph and grouping (Phase 3)
  storage/            SQLite writer and migrations (Phase 8)
  tests/              native executable tests
shared/protocol/      versioned transport definitions and validation
tests/                frontend and runtime integration tests
scripts/              repeatable build, smoke, and measurement commands
docs/                 architecture, acceptance gates, measured results
```

Create modules when used, not empty placeholder trees. CMake owns C++ compilation;
Cargo's CMake build dependency links the same static library. Rust owns application
lifetime and IPC, not telemetry, event semantics, or the universe model. No extra
sidecar process, loopback server, socket, or redundant native JSON parse in v1.
Tradeoff: a native memory fault can bring down the host; isolate in a sidecar only
if measured fault-containment requirements outweigh extra copies/process cost.

Data path: Windows collectors -> normalized events -> bounded aggregator -> common
observed model -> compact snapshots/deltas -> C ABI -> Rust -> Tauri channel ->
validated TypeScript store -> GPU buffers. SQLite has a separate bounded writer
queue; its failure must not stall live observation. Nothing queries the OS from JS.

## 2. Windows APIs and privilege limits

| Domain | Preferred API | Standard-user availability / limitations |
| --- | --- | --- |
| Process enumeration / parents / counts | CreateToolhelp32Snapshot, Process32FirstW/NextW | Generally enumerable; snapshots race exits; protected details may be inaccessible. |
| Process identity / CPU / path | OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION), GetProcessTimes, QueryFullProcessImageNameW | Best effort per process; no SeDebugPrivilege. CPU is a delta, first sample unknown. |
| Working set / private memory | K32GetProcessMemoryInfo | Rights vary by field/Windows version; return unavailable and reason, never zero for access denied. |
| Threads | Thread32First/Next, OpenThread, GetThreadTimes | Enumeration usually possible; timing/creation info subject to access. Counts are not individual identities. |
| Overall CPU | GetSystemTimes | No elevation; subtract idle from kernel+user deltas. Normalize process CPU by logical processor count; document denominator. |
| Per-core CPU / frequency | PDH PdhAddEnglishCounterW, Processor Information counters; CallNtPowerInformation | Usually readable; capability-test counters and frequency, processor groups, and unavailable values. |
| System memory | GlobalMemoryStatusEx, GetPerformanceInfo | Usually readable; physical used = total - available, not sum of process working sets. |
| Disk capacity / IO | GetDiskFreeSpaceExW, PDH LogicalDisk/PhysicalDisk, GetProcessIoCounters | Capacity/counters usually readable. Process IO is not necessarily physical disk IO. Do not label it as disk throughput. |
| Connections | GetExtendedTcpTable / GetExtendedUdpTable (IPv4 and IPv6) | Usually readable with owner PID. UDP rows are endpoints, not established remote connections. |
| Interfaces / traffic | GetAdaptersAddresses, GetIfTable2 / GetIfEntry2 | Interface byte deltas available; per-connection byte counts NOT provided by TCP/UDP tables. |
| Directory metadata / changes | FindFirstFileExW / FindNextFileW, ReadDirectoryChangesW with overlapped IO and IOCP | Only explicitly selected, accessible roots. No file contents. Bound recursion and avoid following reparse points by default. |
| Lifecycle / high resolution tracing | ETW StartTrace / EnableTraceEx2 / ProcessTrace | Kernel/system providers often need admin or delegated trace rights. Optional later; never require for baseline. |
| Exit status | GetExitCodeProcess on retained permitted handles | Best effort. Enumeration disappearance proves only no longer observed, not crash or exact exit time. |

Interfaces: IProcessCollector, ICpuCollector, IMemoryCollector, INetworkCollector,
IFileSystemCollector, IDiskCollector return portable records plus collection status,
duration, observation time, and errors. Capabilities distinguish disabled,
unsupported, access_denied, stale, and available. No Windows headers outside the
platform implementation. Baseline polling can miss short-lived processes; state
this limitation. Never claim an exact OS birth/death timestamp from poll time.

## 3. Native ABI and Tauri protocol

Phase 1: opaque engine handle, create/destroy, stop, wait-for-new-health,
set-profile. Fixed-width C fields, struct size and ABI version checks. C++ owns
all allocations and catches exceptions at every ABI boundary. Caller owns output
structs; no C++ STL objects, exceptions, or borrowed strings cross into Rust.
Destroy only after stop and joining all waiters. The library is thread-safe for
wait/profile/stop; destroy requires exclusive ownership.

The C++ worker sleeps on a condition variable (2 s normal/cinematic; 5 s eco).
It publishes a single replaceable health snapshot. A slow reader cannot grow a
queue. Health reports the real engine sequence, monotonic uptime, clock timestamp,
configured interval, collector capability count, and ABI version, not OS activity.

Rust blocks on the mailbox off the UI thread. `subscribe_core` installs one channel
for the main window; new subscriptions replace old ones. At most one channel frame
is in flight until `ack_core(subscriptionId, sequence)` arrives. Intermediate
health states coalesce. No acknowledgement means no further channel accumulation.
`unsubscribe_core(subscriptionId)` cannot remove a newer subscription. Reloads
receive a fresh snapshot; stale sequence numbers are ignored. Command validation
rejects protocol mismatches and unknown profiles. Errors are surfaced in the UI.

Phase 2+ envelope: protocolVersion, sessionId, sequence (decimal string),
baseSequence, kind (snapshot/delta/gap/error), observedAtUnixMs, monotonicNs (string),
capabilities, upserts, removals, relationships, metrics, droppedEventCount.
All 64-bit identifiers/counters become strings across JSON; finite bounded numbers
only for measurements. JSON is the initial WebView representation, native ABI is
already compact. Switch to binary only after serialization/parse profiles exceed
budget. Enforce size bounds before allocating, 256 KiB batch target, 1 MiB hard cap;
chunk full snapshots with generation IDs and atomic commit, never half-apply them.
On a gap or wrong base sequence, request a new snapshot and discard old deltas.

Phase 1 health wire contract is implemented separately in shared/protocol. Future
commands: subscribe, ack, resync, inspectEntity, setCollectorConfig, queryHistory,
selectWatchRoot. No kill-process, filesystem-write, shell-execution, packet capture,
remote-origin IPC permission, or administrative elevation command.

## 4. Events, identity, and aggregation

Event envelope: eventId = sessionId + source sequence; entityId; kind; observedAt;
optional sourceAt; monotonic time; source collector; confidence/availability;
payload schema version. Use UTC for display and persistence, monotonic clock for
rates/order. Preserve source ordering; a timestamp alone is not a unique identity.

Kinds: PROCESS_CREATED/TERMINATED/UPDATED, THREAD_CREATED/TERMINATED, CPU_SAMPLE,
MEMORY_SAMPLE, DISK_SAMPLE, NETWORK_CONNECTED/DISCONNECTED/TRAFFIC,
FILE_CREATED/MODIFIED/DELETED/MOVED, RESOURCE_SPIKE, COLLECTOR_ERROR, EVENT_GAP.
Unavailable measurements carry null plus a reason. Poll-derived lifecycle events
carry an observation interval and inferred flag; no fake exactness or crash effects.

Process identity: session + PID + creation FILETIME when available, otherwise a
collector-assigned observation generation marked weak. Never PID alone. Validate
parent creation precedes child; unresolved/reused parents remain unknown. Threads
use owner identity + TID + creation time/generation. File identities use volume ID
and file ID where obtainable, otherwise normalized path + generation; rename pairing
can be incomplete. Connection identity includes family, protocol, endpoints, owner
identity and observed generation. No reverse DNS unless explicitly enabled.

Latest-value metrics coalesce per entity; preserve lifecycle transitions in bounded
queues. Initial raw queue budget 8 MiB, writer queue 8 MiB, latest model separate.
On overflow count loss and emit EVENT_GAP; reconcile snapshots, never silently
claim completeness. Use hysteresis/cooldown for spikes. No filesystem callback,
collector thread, or DB writer blocks on frontend consumption.

## 5. Universe model

Core stores factual entities: Computer, ApplicationGroup, Process, Thread,
Directory, File, NetworkInterface, NetworkEndpoint, Connection. Entity fields:
stable ID, kind, label, observed lifetime, availability, metric references, source.
Edges: parent_process, owns_thread, contains_path, owns_connection, connects_to,
member_of_application; include provenance and confidence.

Application grouping uses validated root/ancestry and executable identity, not
name alone. Explicitly mark inferred group boundaries; services/orphans remain
visible. Process hierarchy view and universe view share IDs, not separate datasets.

Core universe mapping assigns stable galaxy membership, hierarchy, mass/energy
inputs and layout seeds. Renderer computes presentation positions, camera,
interpolation, colors, and LOD. CPU -> energy; memory -> logarithmic/clamped size;
connection -> bridge; observed traffic -> flow. Unknown CPU does not imply idle.
Threads are rendered individually only when individually observed, not synthesized
from a count. Decorations and navigation reference geometry are never entities.

GPU plan: typed buffers, pooled slots, instanced spheres/points, batched edges,
bounded label DOM, distance/frustum culling, galaxy aggregates, selected-object
detail, GPU resource disposal. Layout updates only on topology changes. Picking
resolves instance IDs back to stable model IDs. Start with demand rendering and
no bloom; add continuous effects only when data and measured budget justify them.

## 6. SQLite design (Phase 8, not opened in Phase 1)

One native writer, prepared statements, batched transactions, foreign keys,
WAL, synchronous=NORMAL, short busy timeout; bounded read queries on a separate
connection. Local user app-data location. Metadata can still be sensitive; no
paths/IPs in routine logs. History disabled by default until user consent/config.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, started_ms INTEGER NOT NULL, ended_ms INTEGER,
  protocol_version INTEGER NOT NULL, app_version TEXT NOT NULL
);
CREATE TABLE entities (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  id TEXT NOT NULL, kind TEXT NOT NULL, first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL, metadata_json TEXT NOT NULL,
  PRIMARY KEY(session_id, id)
);
CREATE TABLE events (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, observed_ms INTEGER NOT NULL, source_ms INTEGER,
  entity_id TEXT, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY(session_id, sequence)
);
CREATE INDEX event_time ON events(session_id, observed_ms);
CREATE INDEX event_entity ON events(session_id, entity_id, observed_ms);
CREATE TABLE resource_samples (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  bucket_ms INTEGER NOT NULL, entity_id TEXT NOT NULL, metric TEXT NOT NULL,
  minimum REAL, maximum REAL, mean REAL, count INTEGER NOT NULL,
  PRIMARY KEY(session_id, bucket_ms, entity_id, metric)
);
CREATE TABLE checkpoints (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, observed_ms INTEGER NOT NULL,
  codec TEXT NOT NULL, state BLOB NOT NULL,
  PRIMARY KEY(session_id, sequence)
);
CREATE INDEX checkpoint_time ON checkpoints(session_id, observed_ms);
PRAGMA user_version = 1;
```

Versioned migrations run transactionally. Metadata history lives in event payloads;
the entities table is a latest-value index, NOT the source for historical replay.
Start with 24-hour / 256 MiB configurable retention, 10-second metric buckets and
60-second checkpoints. Retain a checkpoint preceding the retention boundary plus
events needed to reconstruct from it. Chunk deletion while idle, bounded WAL
checkpoints, no vacuum in the hot path. Record gaps in history. Read-only replay
reconstructs checkpoint + ordered events and never alters OS state. Disk-full or
corruption disables recording with an explicit warning while live mode continues.

## 7. Performance budgets and measurement

Targets are hypotheses, not claims. Release x64, documented hardware and workload,
30 s warmup then 60 s sampling; report median/p95/p99 and variability. Whole-app
CPU includes host, WebView renderer, GPU and utility processes; normalize to total
logical CPU capacity. Native CPU and WebView CPU must also be separately reported.

| Budget | Eco | Normal | Cinematic |
| --- | --- | --- | --- |
| Process metrics interval (later) | 2 s | 1 s | 1 s |
| Health interval (Phase 1) | 5 s | 2 s | 2 s |
| Max visual batches (later) | 2/s | 5/s | 5/s |
| Active render ceiling | 30 fps | 60 fps | 60 fps |
| Pixel ratio cap | 1 | 1 | 2 |
| History buckets (later) | 30 s | 10 s | 10 s |

All profiles: render only on changes in Phase 1, no background animation, pause
rendering when hidden. Demand-rendered idle FPS is zero, not a performance failure.
Idle whole-app CPU target <1%; normal interaction/monitoring <3% CPU. Native
baseline private memory <32 MiB; whole-app initial working-set target <250 MiB,
measure WebView baseline separately. These are review budgets, not universal SLAs.
Normal rendering p95 <=16.7 ms total, CPU submission <=4 ms, GPU <=8 ms where
timer query available. IPC <1 MiB/s normal, parse+apply p95 <2 ms, native aggregation
p95 <5 ms, collector interval overrun and dropped counts exposed.

Phase 1: <=1 in-flight IPC frame, constant-size native mailbox, no history writes,
no OS scans, no per-frame React setState. Monitor actual received bytes/sec and
rendered frames/draw calls. Unknown GPU time, per-core CPU, and memory readouts
remain unavailable until measured, never invented. Native worker time can later
use GetThreadTimes; whole-process counters do not isolate the C++ core from Rust.

Benchmark mode (later, explicitly synthetic and isolated from live/history):
10k/50k/100k entities, 50k events/s producer, slow consumer, queue overflow, PID
reuse, rapid spawn/exit. Record build/hardware/profile/seed and frame/CPU/memory/
IPC metrics. Test idle, orbit, selection, focus, replay, hidden/minimized and
recovery. Reject unbounded memory growth, preserve interaction by aggregation.

## 8. Delivery and Phase 1 acceptance

1. Phase 1: native library, thread-safe bounded health handoff, Tauri bridge,
   versioned protocol, React/R3F shell, native failure/disconnection states.
2. Phase 2: real process PID/name/CPU/memory, permission/race tests, first instanced
   stars; compare sampled values with native tools before declaring completion.
3. Phase 3: identity-safe hierarchy, inferred galaxy grouping and selection.
4. Phase 4: normalized lifecycle updates, aggregation, backpressure and recovery.
5. Phase 5: calibrated CPU/memory mapping and low-noise spike events.
6. Phase 6: TCP/UDP/interface telemetry and factual connection bridges.
7. Phase 7: opt-in read-only directory browsing/watch metadata and overflow recovery.
8. Phase 8: SQLite writer, migrations, retention, disk-error tests.
9. Phase 9: historical reconstruction, timeline and explicit replay mode.
10. Phase 10: measured large-count LOD, pooling and GPU optimization.
11. Phase 11: restrained atmosphere/effects, accessibility and polish.
12. Phase 12: representative performance qualification and documented limits.

Phase 1 gates, all required before moving on:

- Clean documented Windows builds: CMake Release tests, Cargo tests, frontend
  typecheck/tests/production build, Tauri release executable.
- Native ABI rejects invalid version/size/profile, uses monotonic sequences,
  coalesces slow consumers, wakes waiters on stop and releases threads/handles.
- Real C++ frame reaches Rust then React; profile changes return native-confirmed
  intervals; channel ack prevents queue growth; reload/unsubscribe are safe.
- Actual desktop window launches without admin, keeps responsive during updates,
  closes cleanly, and can reopen. No fake telemetry or production test fixtures.
- Full-bleed nonblank 3D reference scene, orbit/pan/zoom/reset, desktop and narrow
  viewport inspection, keyboard-accessible controls, renderer-failure fallback.
- Browser-only run explicitly disconnected, with no fake native success. No
  collectors/process objects/history/network/filesystem controls falsely enabled.
- Measure initial native and whole-app idle overhead; document method, build,
  duration, results, gaps and any budget deviation. Compilation alone is not done.
- Commit the coherent verified foundation and annotate minor tag v0.1.0. No major
  version tag until the user requests one. No branches, remotes, or pushes.

## References

- https://v2.tauri.app/develop/calling-frontend/#channels
- https://v2.tauri.app/security/capabilities/
- https://learn.microsoft.com/windows/win32/toolhelp/taking-a-snapshot-and-viewing-processes
- https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes
- https://learn.microsoft.com/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedtcptable
- https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-readdirectorychangesw