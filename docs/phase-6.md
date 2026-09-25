# Phase 6: network observation

Status: implemented and functionally verified on Windows 11 x64, 2026-09-25.
This is not a performance sign-off or completion of Universe OS. The Phase 5 CPU
outlier and working-set budget concern remain open.

## Collection contract

- Windows GetExtendedTcpTable/GetExtendedUdpTable collect IPv4 and IPv6 owner-PID
  metadata. TCP listeners have no claimed remote peer. UDP records are local
  endpoints, not established remote connections. IP literals/ports are displayed;
  no reverse DNS, packet payload capture or external lookup is performed.
- GetIfTable2 supplies interface metadata and cumulative byte counters. Rates use
  monotonic deltas, are unavailable at the first sample, and reset on counter
  rollback, interface loss/down state or collection failure. These are interface
  rates, never attributed to individual TCP/UDP rows.
- Owner creation time is queried once per distinct PID per scan with limited query
  rights. A process born after collection began is not assigned as an old row's
  owner. Linking to process stars additionally requires matching creation identity.
- Table buffer retries are bounded to three and 4 MiB each. Snapshots cap at 4,096
  connection/endpoint rows and 128 interfaces, exposing truncation and separate
  table/interface errors. Collection supports cancellation. No elevation is requested.
- Connection identity includes family/protocol/endpoints and observed owner identity;
  state changes preserve identity. Indistinguishable rows coalesce with a count;
  conflicting states become unknown, not a guessed state. Generation IDs do not
  reset. A close/reopen entirely between polls can remain indistinguishable.

## Native tests

Real loopback IPv4/IPv6 TCP listeners, established peers, owner PIDs/creation time,
UDP endpoints and closure are checked. Synthetic fixtures validate exact interface
rate deltas, missing first rates, rollback, down interfaces, owner PID reuse,
generation reset safety and duplicate coalescing. Fixtures are test-only.

One local scan observed 210 rows in about 7.7 ms before integration. This is a
single measurement, not a whole-app budget guarantee.

## Integration and control

The C++ engine schedules network collection outside its shared-state lock, on the
existing worker, independently from the process collector. Normal/Cinematic use
a 2-second minimum network interval; Eco uses 5 seconds. The deadline is checked
at existing worker wakes, so intervals include scheduler/collector cost and Eco
can be closer to 6 seconds while the process sampler wakes every 2 seconds.
Profile changes request a fresh network sample; disabled collection clears its
displayed state and stops queries. Process-off/network-on operation is tested.

Network data is retained in the immutable snapshot with the process/universe state.
Bounds-checked C ABI accessors expose the network header, connections and interfaces.
Rust validates sizes, protocols, address lengths, finite rates and UDP semantics.
Both collectors are enabled by default by the host; the bare native engine starts
disabled for explicit configuration and isolated tests.

Protocol 6 preserves the acknowledged, bounded chunk transport. Process deltas
continue as before; a new full network snapshot is included only when its sample
time/enabled state changes or a full resync is requested. A null network patch
means retain the previous sample. Frontend reconstruction validates the complete
network snapshot and preserves its reference on process-only deltas. This is not
yet per-connection delta encoding; the 4,096-row/128-interface and transfer caps
bound the payload. No renderer-side OS queries are introduced.

Connection owner PIDs remain factual table metadata. A UI link back to a process
requires matching observed PID and creation FILETIME; PID alone cannot attach an
old connection to a reused process. No ancestry/application ownership is inferred
from the remote IP. Exact literal addresses include IPv6 scope IDs where present.

## Spatial network view

- Observed TCP peer endpoints use selectable torus instances and static, batched
  curved bridges to the local computer reference. Listener/UDP objects have no
  fabricated peer or bridge. State/color does not claim traffic volume.
- Interfaces have separately selectable nodes, cumulative counters, operational
  state and receive/send rates. Normal/Eco show static measured activity; Cinematic
  permits bounded moving markers for interfaces with positive observed rates.
  No packet payload or individual TCP-stream byte attribution is implied.
- The topology layout is stable across counter-only updates. Network geometry is
  mounted only in Network view; process/galaxy geometry is unmounted there. Displayed
  instance counters clear when their scene is unmounted, avoiding stale counts.
- IP/port/PID/protocol/state search, 50-row endpoint/interface lists, exact inspection,
  camera focus, direct endpoint picking and process-owner navigation are available.
  Switching views clears cross-domain filters so an owner process is not hidden by
  the old port query. Last observations remain labeled after disappearance.
- Network collection can be toggled without stopping process collection, and vice
  versa. Partial table errors and truncation remain visible. Connection traffic is
  explicitly `Not available`; interface traffic scope is `Interface / all processes`.

## Running application checks

- 6 CTest executables pass, including actual IPv4 and IPv6 TCP/UDP tests, owner
  creation identity, close/removal, interface rates/resets, cancellation, duplicate
  coalescing, and independent engine sampling/ABI bounds.
- 10 Rust tests pass, including actual network records through the native ABI,
  process-off/network-on behavior and previous stream/resource tests. Clippy clean.
- 45 frontend tests pass, covering network schema constraints, atomic sample
  preservation, stable layout, safe owner matching, inspection and earlier phases.
- Strict TypeScript production build and frontend lint pass. Release 0.6.0 built
  and launched without an elevation prompt. No JS page errors in native smoke.
- Native loopback test (final run): owner PID 8, TCP client port 61229 to server
  port 61228, UDP port 62092, all matched from OS observations. TCP state was
  ESTABLISHED; UDP was BOUND with no remote endpoint. UDP closure reached the UI.
  These are captured test-run values, not hard-coded production data.
- Process-owner navigation, direct torus picking, endpoint/interface paging,
  independent toggles, interface scope readouts, 1360x820 and 400x740 screenshots,
  nonblank canvas checks and narrow-panel overflow checks passed.
- Prior resource pixel/spike tests, paused-renderer lifecycle recovery, galaxy and
  hierarchy navigation, WebGL loss/recovery and clean close/reopen continue to pass.

## Performance evidence

Uninstrumented Normal release, default Universe view, both collectors enabled,
resource visuals enabled, diagnostics closed. Intel i7-6700 / 8 logical processors,
Windows 11 build 26200, WebView2 153.0.4234.48. Each run: 30-second warmup, then 60
one-second samples over the native host plus six WebView processes. CPU normalized
by total logical processor capacity. Other system activity was not controlled.

| Metric | First sample | Final release sample |
| --- | --- | --- |
| Captured UTC | 10:02:36 | 10:13:00 |
| Mean CPU | 0.768% | 0.930% |
| Median / p95 / p99 CPU | 0.744% / 1.512% / 2.079% | 0.768% / 1.699% / 2.114% |
| Native host mean CPU | 0.321% | 0.341% |
| WebView mean CPU | 0.448% | 0.590% |
| Summed working set | 406.3 MiB | 408.0 MiB |
| Summed private memory | 186.0 MiB | 189.1 MiB |
| Native host private memory | 6.57 MiB | 6.72 MiB |

The final instrumented Network-view profile recorded 12 draws over about 17 seconds,
222 endpoint instances, 151 TCP bridges and 9 draw calls. Script time was 0.081 s
over a 15.16 s window (total tracked task time 0.424 s). A subsequent Universe-view
window recorded 0.047 s script time over 15.09 s. These are renderer profiles with
CDP attached, not whole-app CPU percentages or GPU times. Native network scan in
that run was about 6.4 ms. The live sample population varies.

## Remaining limits

- Summed working set still exceeds the 250 MiB review target. Shared pages can be
  counted more than once; private memory is separate, not a replacement metric.
  CPU means are below 1% in these samples, while p95/p99 exceed it. The Phase 5
  unexplained 6.322% CPU run remains unresolved, not erased by these later results.
- No per-connection bytes, packet capture, DNS/hostname enrichment, GeoIP,
  application-layer attribution or inferred remote service identity. Interface
  counters may include traffic through virtual/tunnel adapters and can double-count
  traffic if users sum interfaces; no machine-wide total is claimed.
- Polling can miss brief connections or a close/reopen with an identical tuple
  between samples. Connection IDs are observed generations, not kernel socket IDs.
  Protected/exited process owners can remain unavailable. No exact disconnect or
  network lifecycle event journal/history is claimed in this milestone.
- Network snapshots remain full replacements at their own cadence, not connection
  deltas. Large populations require later LOD, benchmark and transport qualification.
- Cinematic flow is implemented only for available positive interface rates; the
  controlled socket tests validate metadata, not per-adapter packet accounting or
  an external-traffic animation benchmark. No remote traffic is generated merely
  to make the scene animate.
- Rate availability resets conservatively on interface failure/down/counter reset.
  Very large hosts, localized Windows counter tools, long-duration leaks, active
  Cinematic GPU cost and cross-platform collectors are not qualified here.
- Filesystem observation, SQLite, replay and later optimization phases remain.

The native collector is committed separately as `1cc338d`. The runtime-verified
visual/IPC integration follows as another feature commit with minor tag `v0.6.0`.
No major tag, branch, remote or push is created.