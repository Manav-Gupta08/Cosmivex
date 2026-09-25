# UNIVERSE OS

Native, Windows-first computer observability as a navigable 3D universe.
Performance first. Real observations only. No AI functionality.

## Current milestone

Phase 1 foundation is implemented and verified in the actual Windows application.
It includes the C++20 engine, Tauri 2 host, versioned acknowledged IPC, React /
TypeScript / Zustand shell, and a demand-rendered Three.js / R3F reference scene.

**No OS telemetry collectors are enabled yet.** The empty navigation grid is not
a process universe or synthetic workload. The native sequence, uptime, and profile
interval are actual C++ engine state. Process stars start in Phase 2. Network,
filesystem, SQLite recording, replay, LOD benchmarks, and effects are later phases.

The complete [architecture and implementation plan](docs/architecture.md) covers
Windows APIs, privilege limits, event identity, transport, universe model, SQLite
schema, retention, performance budgets, and all twelve delivery phases.
See [Phase 1 verification](docs/phase-1.md) for measured results and open limits.

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

Screenshots and measured samples are generated under ignored `artifacts/`.
The icon sources are generated locally by `scripts/generate-icon.ps1`; generated
PNG/ICO assets are committed so building does not require regenerating them.

## Operation and efficiency

- Drag to orbit, right-drag to pan, scroll to zoom; crosshair resets the camera.
- Diagnostics are optional. They show core state, actual draw counts and received
  health-payload throughput. GPU timing, CPU attribution, and memory readouts are
  explicitly unavailable in-app until those measurements are implemented.
- Eco: 5 s health cadence, 30 fps draw ceiling, pixel ratio 1, no MSAA.
- Normal: 2 s health cadence, 60 fps draw ceiling, pixel ratio 1, no MSAA.
- Cinematic: 2 s health cadence, 60 fps draw ceiling, pixel ratio 2, MSAA.
- All modes stop drawing at rest and suspend the render loop while hidden. An idle
  scene correctly reports no new frames. Diagnostic refresh runs only while open.
- Quality switches into/out of Cinematic recreate the canvas and currently reset
  the camera. No effects or telemetry-frequency claims beyond core health in v0.1.
- A fixed 48-byte C ABI health record and one latest-state mailbox feed one
  acknowledged channel frame. No event backlog, history writes, or OS scans.

## Privacy and Git workflow

No packet payload capture, file-content reading, process control, filesystem
mutation, elevated tracing, AI APIs, or history database in Phase 1. WebView2 may
maintain its standard application profile/cache; that is separate from telemetry
history. All fonts and assets are packaged locally. Diagnostic test fixtures are
test-only and never included as production system observations.

Git remains local. The repository identity was set once to `Manav-Gupta08` /
`manavgupta0808@gmail.com`. Group commits by meaningful features, not tiny edits.
Only local add/commit/minor tags and read-only Git operations are part of the
workflow. No branches, remotes, or pushes. Major tags require explicit approval.