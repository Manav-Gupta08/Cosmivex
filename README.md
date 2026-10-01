# Universe OS

Universe OS is a Windows desktop application that turns live system activity into an interactive 3D view. Processes appear as stars, related processes form galaxies, and network connections become spatial links. Search, select, and inspect objects to understand what is running and how it is connected.

It is a system observability tool, not an operating system. A native C++ core collects Windows metadata, while a Tauri desktop host and React interface present the observations.

## What It Does

- **Process monitoring:** View running processes, PIDs, executable paths, parent relationships, CPU usage, and working-set memory. Switch between galaxy and hierarchy views.
- **Resource visualization:** Process brightness reflects measured CPU activity, while size reflects memory usage. Inspectors retain the underlying numeric values.
- **Network inspection:** Explore IPv4/IPv6 TCP connections, UDP endpoints, owning processes, and interface traffic rates. Search by address, port, PID, protocol, or state.
- **Directory observation:** Choose a local directory to browse its direct children and observe creation, modification, deletion, and rename activity. File contents are not read.
- **Local history:** Enable SQLite recording from diagnostics, then browse recorded sessions and replay historical process states without replacing the live view.
- **Interactive navigation:** Orbit, pan, zoom, search, and focus on selected objects. Eco, Normal, and Cinematic profiles control collection and rendering behavior.
- **Diagnostics:** Inspect collector timing, rendering costs, transport activity, and recording status.

Process groups are inferred from observed ancestry and executable identity. They are not a complete application registry. Unavailable measurements are shown as unavailable rather than estimated.

## Requirements

- Windows 11 x64.
- Node.js 22.12 or later and npm.
- Rust stable with the Windows MSVC toolchain.
- Visual Studio Build Tools with **Desktop development with C++** and a Windows SDK.
- CMake 3.24 or later, available on `PATH`.
- Microsoft Edge WebView2 Runtime.

The application runs under a standard user account. Protected processes and inaccessible directories may expose limited metadata.

## Getting Started

Open PowerShell in the repository root and install the dependencies:

```powershell
npm ci
```

Start the native desktop application in development mode:

```powershell
npm run desktop:dev
```

This starts the frontend development server and builds the native host. The first build also downloads Rust dependencies and compiles the C++ core.

### Build a Release

```powershell
npm run desktop:build
```

Launch the resulting executable:

```powershell
& .\apps\desktop\src-tauri\target\release\universe-os.exe
```

The build produces a standalone unsigned executable, not an installer.

### Browser Preview

```powershell
npm run dev
```

Open [http://127.0.0.1:1420](http://127.0.0.1:1420). The browser preview shows the interface but cannot collect native system telemetry. It reports the native core as unavailable.

Run the browser preview and desktop development command separately: both use the same frontend server port.

## Using the Application

1. Use the Universe or Hierarchy view to explore processes. Search by name or PID and select an object to inspect its recorded measurements and relationships.
2. Switch to Network to inspect endpoints, connections, and interfaces. Traffic rates belong to interfaces, not individual connections.
3. Open File System and choose a directory to begin scoped, read-only observation.
4. Open diagnostics to review performance or enable **Record local history**. Use **Historical replay** to inspect saved sessions.

Process and network collection start enabled and can be switched off independently. Directory observation and history recording are opt-in.

## Privacy and Scope

Collection is read-only and uses local Windows metadata APIs. The application does not inspect file contents, capture packet payloads, terminate processes, or modify watched files. History is stored locally in the application's data directory only when recording is enabled.

Process observations are sampled, so short-lived processes can be missed. Live process collection is capped at 4,096 entries, and directory observation is non-recursive. Individual-thread visualization, system-wide CPU and physical-memory views, and disk telemetry are not yet implemented.

Performance qualification is ongoing. CPU, memory, and parsing targets are not all met, and completed long-duration stability evidence remains outstanding. See the [performance report](docs/performance.md) for measured results and limitations.

## Technology

| Component                   | Technology                        |
| --------------------------- | --------------------------------- |
| Native collection and model | C++20, Windows APIs, CMake        |
| Desktop host and IPC        | Rust, Tauri 2                     |
| Interface                   | React, TypeScript, Vite, Zustand  |
| 3D rendering                | Three.js, React Three Fiber, Drei |
| Local persistence           | SQLite through rusqlite           |

## Development Checks

Run frontend checks from the repository root:

```powershell
npm test
npm run lint
npm run build
```

Build and test the native core:

```powershell
cmake -S core -B build/core -A x64
cmake --build build/core --config Release --parallel 4
ctest --test-dir build/core -C Release --output-on-failure
```

Test the Rust host:

```powershell
cargo test --release --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

After building the desktop release, run the native integration checks:

```powershell
.\scripts\verify-desktop.ps1
```

## Documentation

- [Architecture](docs/architecture.md): component boundaries, data flow, APIs, and design criteria.
- [Performance results](docs/performance.md): benchmark methods, measurements, and known limitations.
- [Engineering audit](docs/engineering-audit.md): implementation coverage, verified fixes, and remaining work.

## Author

**Manav Gupta**

CyberSecurity Student | Software Developer | Backend Engineer

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Manav Gupta.
