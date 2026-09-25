# UNIVERSE OS

Native, Windows-first computer observability as a navigable 3D universe.
Performance first. Real observations only. No AI functionality.

## Current milestone

Phase 6 is implemented and functionally verified in the actual Windows application. Real
Windows processes appear as instanced stars in selectable, inferred galaxies.
Switch between the galaxy universe and process hierarchy, search by name/PID,
inspect processes or groups, and navigate validated parent links. Relationships,
membership, CPU and working-set measurements come from C++, not the renderer.
Native lifecycle observations now feed a bounded recent-activity journal and
chunked delta stream. The UI can resynchronize without applying partial graphs;
process appearances/disappearances have restrained, profile-aware markers.
Observed CPU now drives star brightness and working-set memory drives bounded
star size. Sustained CPU spikes have measured values and restrained markers.
Exact readouts remain unchanged; performance qualification still has open concerns.
The Network view now displays actual IPv4/IPv6 TCP connections and UDP endpoints,
with searchable IPs/ports/PIDs, creation-checked process links, interface counters
and traffic rates. TCP peers use spatial bridges. Traffic flow belongs to measured
interfaces, not to individual connections whose byte counts are unavailable.

Process and network metadata collection are independently enabled by default and
can be switched off in their view's bottom bar. Missing CPU/memory values remain unavailable; an exited selection
retains its last observation with an explicit status. No synthetic process data
is supplied to the application. Grouping is conservative: only connected processes
with validated ancestry and identical observed executable paths share a galaxy.
It is not an OS application registry; cross-image helpers can remain separate.
Filesystem, SQLite recording, replay, and large-count LOD benchmarks remain
later phases. The reference grid is a navigation aid, not an observed entity.

The complete [architecture and implementation plan](docs/architecture.md) covers
Windows APIs, privilege limits, event identity, transport, universe model, SQLite
schema, retention, performance budgets, and all twelve delivery phases.
See [Phase 6 verification](docs/phase-6.md) for current results and open concerns;
[Phase 5 verification](docs/phase-5.md) preserves resource-mapping results and the unresolved CPU outlier;
[Phase 4 verification](docs/phase-4.md) preserves the streaming/lifecycle baseline;
[Phase 3 verification](docs/phase-3.md) preserves the hierarchy/grouping baseline;
[Phase 2 verification](docs/phase-2.md) preserves the process-telemetry baseline and
[Phase 1 verification](docs/phase-1.md) preserves the foundation baseline.

## Prerequisites

- Windows 11 x64, ordinary user account; no administrator prompt is required.
- Node.js 22.12+ and npm. Verified with Node 24.16.0 / npm 11.13.0.
- Rust stable MSVC x64 toolchain. Verified with Rust 1.98.1.
- Visual Studio C++ Build Tools, Desktop development with C++, Windows SDK.
- CMake 3.24+; verified with CMake 4.4.3 and MSVC 19.51 (VS 2026).
- Microsoft Edge WebView2 Runtime; verified with version 153.0.4234.48.
- Microsoft Edge browser for the browser-only Playwright smoke test.

Run all commands from the repository root in PowerShell. Initial builds download
dependencies; the installed application does not require a network service.

```powershell
npm ci
npm run desktop:dev
```

Build the standalone, unsigned release executable (not an installer):

```powershell
npm run desktop:build
& .\apps\desktop\src-tauri\target\release\universe-os.exe
```

Frontend-only preview:

```powershell
npm run dev
```

Open http://127.0.0.1:1420. This browser preview deliberately reports that the
native core is unavailable. Do not run it simultaneously with `desktop:dev`, which
starts its own Vite server on the same reserved port. If occupied, stop the old
server or change both Vite's port and Tauri's devUrl together; never kill an
unrelated process to claim the port.

## Validation

```powershell
cmake -S core -B build/core -A x64
cmake --build build/core --config Release --parallel 4
ctest --test-dir build/core -C Release --output-on-failure
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --quiet -j 4
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --quiet -j 4 -- -D warnings
npm test
npm run lint
npm run build
npm run desktop:build
.\scripts\verify-desktop.ps1
.\scripts\measure-idle.ps1
```

With `npm run dev` already running, `node tests/runtime-smoke.mjs` validates the
browser-only state. `verify-desktop.ps1` launches and closes its own release app,
temporarily enables loopback WebView2 debugging for that child only, exercises real
IPC and rendering, closes it, and verifies reopening. Port 9223 must be available;
use `-Port 9224` when occupied. No debugging port is enabled in ordinary launches.
The verifier starts its own bounded parent/child CPU/memory workload, compares its observed PID,
parent PID, CPU and working set with Windows reference measurements, then ends
that specific test process and verifies disappearance. It also checks real galaxy
membership, direct ring picking, parent navigation, and both spatial layouts.
It does not stop unrelated
processes. The workload is test-only and exits on its own after two minutes.
The verifier also pauses WebView JavaScript with CDP while a separate short-lived
test process appears and exits. It resumes the renderer and verifies that native
collection continued and the lifecycle observations were retained. Debugging is
enabled only for this verification child, never an ordinary application launch.
The resource probe separately ramps real CPU and allocated memory, measures the
selected star's pixel brightness/area, checks a sustained spike, and verifies
the resource-visual toggle. It is bounded to 90 seconds and affects only its own
test process. Worker count is capped at eight and allocation at 384 MiB.
Network tests use only controlled loopback TCP/UDP sockets. They verify endpoints,
state, PID, process-owner navigation, removal, direct network picking, independent
collection controls and interface inspection. They do not contact remote services.

For investigating WebView CPU, `node tests/profile-resources.mjs` starts its own
release app with loopback CDP on port 9224, captures 15-second CPU profiles with
resource visuals on/off, and writes profiles to `artifacts/`. It rejects an occupied
port. This is a diagnostic run, not the uninstrumented release overhead benchmark.
Add `--network` to compare Network and Universe renderer profiles instead.

Screenshots and measured samples are generated under ignored `artifacts/`.
The icon sources are generated locally by `scripts/generate-icon.ps1`; generated
PNG/ICO assets are committed so building does not require regenerating them.

## Operation and efficiency

- Drag to orbit, right-drag to pan, scroll to zoom; crosshair resets the camera.
- Click a process star, or search a name/exact PID and press Enter, to focus and
  inspect it. The list button opens at most 50 rows at a time with sorting/paging.
- Use Universe/Hierarchy/Network to switch spatial layouts. The process list can use
  hierarchy order; depth is shown in the inspector. Missing or reused parent PIDs
  stay unresolved rather than attaching to unrelated current processes.
- Click a galaxy ring or use the galaxy list to inspect its observed image path,
  root, members and aggregates. CPU/memory sample coverage is shown explicitly.
  These are inferred same-image ancestry groups, not verified product boundaries.
- Network search accepts IP literals, ports, PIDs, TCP/UDP and states. The network
  list pages endpoints and interfaces in batches of 50. A connection owner link is
  offered only when its creation identity matches an observed process.
- TCP listeners and UDP binds have no invented remote peer. Per-connection traffic
  is explicitly unavailable. Interface traffic is aggregate across all processes;
  first samples and counter resets have unavailable rates, not false zeroes.
- Network samples target at most once per 2 s in Normal/Cinematic and 5 s in Eco,
  checked on the existing worker cadence; actual intervals include scheduling and
  collection time. Network collection continues when process collection is off.
  Normal/Eco use static traffic indicators; Cinematic animates only interfaces with
  observed nonzero traffic. Reduced motion suppresses animated flow.
- Diagnostics are optional. They show core state, actual draw counts and received
  wire-payload throughput, delta/full-state counts and event cursors. The resync
  button requests a fresh complete state. GPU timing, CPU attribution, and memory readouts are
  explicitly unavailable in-app until those measurements are implemented.
- Eco: 2 s wait between process collections, 30 fps draw ceiling, pixel ratio 1,
  no MSAA. With collection off, health cadence reduces to 5 s.
- Normal: 1 s wait between collections, 60 fps draw ceiling, pixel ratio 1, no MSAA.
- Cinematic: 1 s wait between collections, 60 fps draw ceiling, pixel ratio 2, MSAA.
- With both collectors off, Normal/Cinematic publish health only every 2 s.
- Normal/Eco render on changes; Cinematic can animate while measured interface
  traffic is flowing. Hidden render loops pause. With no active effects, an idle
  scene with unchanged visual levels reports no new frames. Changed resource levels
  request draws at the telemetry cadence, not a continuous loop. Diagnostic refresh
  runs only while open; camera motion is reported separately from data-driven draws.
- CPU energy uses a square-root scale; memory uses a logarithmic scale capped
  visually at 4 GiB. Native levels are quantized to 0-31 with hysteresis. Exact
  CPU and working set remain visible even beyond a visual cap. Unknown CPU uses
  a neutral color, and unknown memory a neutral-size wireframe, not a zero reading.
- The Resource visuals checkbox in diagnostics disables the mapping without
  disabling collection or changing measurements. GPU matrix/color ranges update
  only where appearance changed; topology layout remains independent of metrics.
- Recent activity retains at most 256 observed events in memory and shows 25 per
  page. "First observed" / "No longer observed" are sampling statements, not exact
  OS lifecycle timestamps or crash diagnoses. Startup/recovery uses a baseline;
  pause and incomplete collection are explicit, not mass termination events.
- Normal mode uses short demand-rendered lifecycle markers. Cinematic animates
  pulses for at most 900 ms; Eco and reduced-motion settings suppress them. At most
  32 effects can exist at once. Old/replayed events do not create fresh effects.
- Sustained CPU spikes require two consecutive samples at >=10% of total machine
  CPU, rearm below or at 6%, and a 30-second cooldown. This is an explicit monitor
  policy, not a crash or health diagnosis. Recent activity shows value and threshold.
- Quality switches into/out of Cinematic recreate the canvas and currently reset
  the camera. Resource levels themselves do not require continuous interpolation.
- One immutable latest process snapshot and one acknowledged channel chunk prevent
  event backlog. The snapshot includes the matching native hierarchy and groups.
  C++ computes process deltas against the last fully acknowledged state. Protocol 6 uses
  256 KiB UTF-8-safe payload chunks (under 1 MiB encoded per message), a 16 MiB
  serialization/reassembly limit, atomic application and wrong-base resync.
  Metric updates reuse layouts; unchanged visual levels reuse GPU matrices/colors.
  Changed levels upload merged instance ranges. Parent links use a batched
  geometry, and galaxies/processes use instancing. Native collection happens
  outside the shared-state lock. Successful image queries are lifetime-cached.
  A network snapshot is attached only when sampled or toggled, not to every
  process-only delta. Its topology layout is reused across interface counter changes.
- CPU uses 0-100% of total logical processor capacity; working set is not private
  memory. Sampling may miss short-lived processes. At most 4,096 processes are
  collected; any truncation is explicit. No history writes.

## Privacy and Git workflow

No packet payload capture, file-content reading, process control, filesystem
mutation, elevated tracing, AI APIs, or history database. The recent event journal
is bounded volatile metadata, not persistent history/replay. WebView2 may
maintain its standard application profile/cache; that is separate from telemetry
history. All fonts and assets are packaged locally. Diagnostic test fixtures are
test-only and never included as production system observations.