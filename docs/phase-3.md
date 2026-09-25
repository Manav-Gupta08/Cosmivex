# Phase 3: process ancestry and galaxies

Status: implemented and runtime-verified on Windows 11 x64, 2026-09-25. This is the
third incremental milestone, not a completed Universe OS. The working-set budget
deviation remains open.

## Evidence and boundaries

A parent PID alone is not a safe relationship: its owner can exit and the PID can
be reused. The C++ model resolves an edge only if both observed creation times are
known and the candidate parent strictly predates the child. Root, missing parent,
unavailable creation time, newer/equal timestamp and self-parent states remain
explicit. This is validation of an observed parent PID, not proof against deliberate
Windows parent-process spoofing. Equal timestamps are conservatively unresolved.

Galaxies are **inferred same-image ancestry groups**, not an OS application registry.
A child inherits a galaxy only over a validated parent edge when both observed full
executable paths match exactly. Different paths, missing paths and disconnected
roots stay separate, even when names match. This avoids merging unrelated programs
or claiming that every descendant of Explorer belongs to Explorer. Cross-image
helpers can therefore be separate galaxies; the hierarchy still shows their real
validated parent relationship. Case/path aliases can split a group conservatively.
This is an executable-path identity, not a content hash or signature assertion.

QueryFullProcessImageNameW uses the existing minimal query handle. Successful paths
are cached only against PID plus creation time, and dead entries are removed each
collection. Failures remain nullable with Win32 error codes. No file content is
opened, no administrator permission is requested, and paths are local metadata.
Paths above the bounded 16 KiB UTF-8 representation are unavailable, not truncated
into misleading identities. An on-disk rename after process startup may leave the
cached observed path unchanged until a new lifetime is sampled.

The model sorts by creation time and resolves parents iteratively, never recursively.
CPU/working-set aggregates retain sample counts so missing metrics are not treated
as zero. Summed working sets can double-count shared pages and are not application
private memory. Geometry, camera, and color remain presentation responsibilities;
relationships, membership, and aggregate measurements are owned by C++.

## Native checks

- Reused parent PID, missing timestamps, self-parent and equal timestamps rejected.
- Same executable name at different paths does not merge; disconnected instances
  at the same path remain distinct; cross-image hierarchy edges are retained.
- Partial aggregate coverage and values verified.
- A 4,096-process deep chain resolves without recursion (about 0.50 ms in one local
  Release test run; not a general performance guarantee).
- Real test executable and its controlled child share a queried image path, resolve
  to the correct parent, and belong to the same inferred galaxy. Existing collection,
  cancellation, handle lifetime and process exit tests also run.

## Transport and lifetime

The native normalized snapshot owns the universe model built from those exact rows.
C ABI readers validate sizes and indices for model headers, relationships and
galaxies. Snapshot handles keep process strings and model data alive across newer
collections. Rust copies borrowed strings before releasing the handle, validates
references and shares decoded snapshots with Arc. Executable paths are serialized
once per galaxy, not once per member. No extra query from React is introduced.

Protocol 3 adds parent identity/status, depth, group identity and group aggregate
coverage. Frontend validation rejects dangling parent/group references, duplicate
IDs, self-links, inconsistent depths and membership counts. Depth checks also
reject cycles. Protocol 2 clients fail explicitly rather than partially applying
a new graph. The existing acknowledged one-frame-in-flight transport is retained.

Process observation generations are no longer reset to zero when collection is
disabled; old IDs cannot attach to unrelated new lifetimes after a sampling reset.
Resource-profile changes preserve the active identity tracker. Strong creation
identities also survive observed name changes. Regression tests cover these rules.

## UI and rendering

- Universe view places observed processes around their native galaxy root. Rings
  are selectable group boundaries, with restrained colors shared by members.
- Hierarchy view uses D3's radial tree layout on the validated native parent IDs.
  Its temporary layout origin is not an observed process and is never rendered.
- Process instances, galaxy instances and parent link vertices are batched. Normal
  universe view shows parent links only around a selection; hierarchy shows all
  validated links. No fake relationships are created to fill missing ancestry.
- A topology key preserves both layouts and GPU matrices across metric-only
  updates. Camera motion remains independent of telemetry; background topology
  changes do not reset an unselected camera. Both layouts use responsive framing.
- Process and galaxy selection are exclusive. Inspectors link to members, parents
  and their galaxy. Exited groups/selections retain explicitly labeled last data.
- Galaxy/process lists are paged to 50 rows; galaxy member lists to 12. Search
  filters groups through matching observed members. Hierarchy-ordered lists cap
  visual indentation, while the full native depth remains in process details.
- Paths, unavailable metrics, partial aggregate coverage and unresolved parent
  reasons are visible. Working-set sums are not presented as private memory.

## Running application checks

Release 0.3.0 built and launched without elevation. Checks passed:

- 3 CTest executables: engine/ABI, hierarchy/grouping, real Windows collection.
- 4 Rust tests: real decoded process/group data, ABI layouts, bounded channels.
- 22 frontend tests: graph contract, topology reuse, selection/navigation, missing
  values, transport failure/cleanup, pagination and the previous phase regressions.
- Strict TypeScript production build, frontend lint and Rust Clippy.
- Actual WebView2 runtime: connected protocol 3, native profiles, collection
  toggles, reload, shutdown/reopen, WebGL loss and recovery, zero page errors.
- Controlled Node parent/child: observed two-member galaxy rooted at the actual
  parent PID; child parent PID and validated parent identity match the launcher;
  member -> parent -> galaxy navigation resolves the same real objects.
- Independent CPU/memory check: parent PID 17960 showed 1.89% machine CPU vs 2.20%
  in the Windows reference interval, and 123.0 MiB working set vs 123.00 MiB.
  Intervals are not simultaneous; the test uses tolerances. Only the test workload
  is ended, and its observed exit is verified.
- Direct process-star and galaxy-ring clicks, both spatial modes, hierarchy edges,
  1360x820 and 400x740 canvas-pixel checks, narrow panel overflow checks, and idle
  frame-count stability. Captures are under ignored local `artifacts/`.

The production app contains no synthetic workload or fixture data. The verifier's
child exits when its test parent disconnects, and both are bounded to two minutes.

## Performance sample

Release 0.3.0, Normal profile, process collection enabled, default Universe view,
diagnostics closed and no debugger attached. Intel i7-6700, 8 logical processors,
Windows 11 build 26200, WebView2 153.0.4234.48. 30-second warmup followed by 60
one-second samples of the native host and its six WebView subprocesses. Captured
2026-09-25T07:15:14Z; CPU normalized by total logical processor capacity.

| Metric | Phase 3 | Phase 2 reference |
| --- | --- | --- |
| Whole-app mean CPU | 0.611% | 0.527% |
| CPU median / p95 / p99 | 0.567% / 1.132% / 1.699% | 0.378% / 1.134% / 1.697% |
| Native host mean CPU | 0.302% | 0.287% |
| WebView mean CPU | 0.309% | 0.240% |
| Summed working set | 397.9 MiB | 386.2 MiB |
| Summed private memory | 179.6 MiB | 169.8 MiB |
| Native host private memory | 5.44 MiB | 5.31 MiB |

During the separate instrumented runtime test: 264 processes, 199 conservative
groups, 8 draw calls, ~123 KB/s snapshot payload, ~19 ms collection and ~0.21 ms
native model build. CPU submission was ~0.7 ms in one draw sample, not GPU timing.
Metrics-only idle frames remain stable. These are single-run observations, not
controlled statistical comparisons or active-frame-rate certification.

## Open limits

- Mean idle CPU remains below 1%; p95/p99 exceed it. The 250 MiB summed working-set
  target is still missed. Shared pages can be counted more than once; private
  memory is reported separately, not used to conceal the working-set deviation.
- Conservative grouping produces many singleton galaxies and splits cross-image
  helpers. No publisher/product metadata or speculative application ownership.
- Path aliases/casing or cached rename history may split same-image groups. Missing
  parent observations and equal creation timestamps remain unresolved. Polling can
  miss short-lived processes; validation cannot prove unspoofed Windows ancestry.
- The 4,096-process bound remains. Delta transport, chunking to the planned 1 MiB
  cap, large-object LOD, long-duration memory testing and GPU timing are still open.
- Galaxy layout is a deterministic presentation, not a physical model. Dense
  groups and very deep trees need later LOD/label and collision-management work.
- CPU/memory brightness/mass mapping, lifecycle effects, network, filesystem,
  SQLite history and replay remain later phases. No Phase 4 event pipeline claim.

Commit cadence: `26d3849` records the independently tested native ancestry/grouping
feature. The visual/IPC integration follows as a separate verified feature commit
with minor tag `v0.3.0`. No major tag, branch, remote or push is created.