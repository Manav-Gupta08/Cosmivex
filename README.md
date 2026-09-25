# UNIVERSE OS

Native, Windows-first computer observability as a navigable 3D universe.
Performance first. Real observations only. No AI functionality.

## Current milestone

Phase 3 is implemented and verified in the actual Windows application. Real
Windows processes appear as instanced stars in selectable, inferred galaxies.
Switch between the galaxy universe and process hierarchy, search by name/PID,
inspect processes or groups, and navigate validated parent links. Relationships,
membership, CPU and working-set measurements come from C++, not the renderer.

Process metadata collection is enabled by default and can be switched off in the
bottom bar. Missing CPU/memory values remain unavailable; an exited selection
retains its last observation with an explicit status. No synthetic process data
is supplied to the application. Grouping is conservative: only connected processes
with validated ancestry and identical observed executable paths share a galaxy.
It is not an OS application registry; cross-image helpers can remain separate.
Network, filesystem, SQLite recording, replay, LOD benchmarks, and effects remain
later phases. The reference grid is a navigation aid, not an observed entity.

The complete [architecture and implementation plan](docs/architecture.md) covers
Windows APIs, privilege limits, event identity, transport, universe model, SQLite
schema, retention, performance budgets, and all twelve delivery phases.
See [Phase 3 verification](docs/phase-3.md) for current results and open limits;
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

Screenshots and measured samples are generated under ignored `artifacts/`.
The icon sources are generated locally by `scripts/generate-icon.ps1`; generated
PNG/ICO assets are committed so building does not require regenerating them.

## Operation and efficiency

- Drag to orbit, right-drag to pan, scroll to zoom; crosshair resets the camera.
- Click a process star, or search a name/exact PID and press Enter, to focus and
  inspect it. The list button opens at most 50 rows at a time with sorting/paging.
- Use Universe/Hierarchy to switch spatial layouts. The process list can use
  hierarchy order; depth is shown in the inspector. Missing or reused parent PIDs
  stay unresolved rather than attaching to unrelated current processes.
- Click a galaxy ring or use the galaxy list to inspect its observed image path,
  root, members and aggregates. CPU/memory sample coverage is shown explicitly.
  These are inferred same-image ancestry groups, not verified product boundaries.
- Diagnostics are optional. They show core state, actual draw counts and received
  health-payload throughput. GPU timing, CPU attribution, and memory readouts are
  explicitly unavailable in-app until those measurements are implemented.
- Eco: 2 s wait between process collections, 30 fps draw ceiling, pixel ratio 1,
  no MSAA. With collection off, health cadence reduces to 5 s.
- Normal: 1 s wait between collections, 60 fps draw ceiling, pixel ratio 1, no MSAA.
- Cinematic: 1 s wait between collections, 60 fps draw ceiling, pixel ratio 2, MSAA.
- With collection off, Normal/Cinematic publish health only every 2 s.
- All modes stop drawing at rest and suspend the render loop while hidden. An idle
  scene correctly reports no new frames. Diagnostic refresh runs only while open.
- Quality switches into/out of Cinematic recreate the canvas and currently reset
  the camera. CPU/memory visual scaling and effects remain a later phase.
- One immutable latest process snapshot and one acknowledged channel frame prevent
  event backlog. The snapshot includes the matching native hierarchy and groups.
  Metric-only updates reuse layouts and GPU matrices; parent links use a batched
  geometry, and galaxies/processes use instancing. Native collection happens
  outside the shared-state lock. Successful image queries are lifetime-cached.
- CPU uses 0-100% of total logical processor capacity; working set is not private
  memory. Sampling may miss short-lived processes. At most 4,096 processes are
  collected; any truncation is explicit. No history writes.

## Privacy and Git workflow

No packet payload capture, file-content reading, process control, filesystem
mutation, elevated tracing, AI APIs, or history database. WebView2 may
maintain its standard application profile/cache; that is separate from telemetry
history. All fonts and assets are packaged locally. Diagnostic test fixtures are
test-only and never included as production system observations.