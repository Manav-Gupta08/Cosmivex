# Phase 7: scoped filesystem observation

Status: implemented and functionally verified on Windows 11 x64. This is not a
performance sign-off or completion of Universe OS. The prior CPU outlier and
working-set budget concern remain open.

## Native contract

- No collection until the user explicitly selects a local absolute root. One
  displayed directory is enumerated/watched, non-recursively. Navigation uses
  observed scope/entry tokens and cannot go above the selected root.
- Handle-based GetFileInformationByHandleEx supplies names, types, file IDs,
  creation identity, last-write time, attributes and file length. No contents are
  opened. Directory length is not represented as recursive size.
- Short-name aliases normalize before final-handle validation. Device/UNC/relative
  paths, remote drives, alternate streams and reparse traversal are rejected.
  Handles share read/write/delete access so observation does not block normal work.
- ReadDirectoryChangesW uses one 64 KiB overlapped buffer. Idle polls reuse the
  snapshot, with no repeated enumeration. Stop cancels/completes IO before freeing
  resources. Completed notifications cause metadata reconciliation.
- At most 4,096 entries and 256 recent events. Overflow/malformed notifications
  produce a gap/rescan, not invented changes. Adjacent rename halves pair; unpaired
  halves remain explicit. Modification bursts coalesce per notification batch.
- Read-only, volatile metadata: no file editor, disk scan, persistent history or
  recursive change journal.

## Native tests

Tests use only their own temporary directory: real create/modify/rename/delete,
idle reuse, scoped child/up navigation, stale tokens, root limits, malformed/empty
notifications, unpaired rename, stop, and a real standard-user directory junction
that cannot be entered or selected as the root. A 300-file creation burst exercises
event eviction/gap handling; over 4,096 entries exercises the listing bound.

## Integration and browsing

- A filesystem root is opt-in, independently of process and network collection.
  The host passes open/navigate/stop commands to the native worker. Navigation
  requires the current scope and an observed entry token; the root cannot be
  escaped using a path supplied by the renderer. Stopping clears the watch and
  displayed filesystem state.
- The engine attaches the bounded filesystem state to its immutable snapshot.
  Bounds-checked C ABI readers and Rust validation reject invalid metadata. On
  the existing acknowledged protocol 7 stream, a new filesystem snapshot is
  sent when its revision changes or on full resync; process-only deltas retain
  the previous filesystem state. Frontend validation applies each full/delta
  state atomically and rejects an invalid patch.
- The File System view exposes an absolute-root input, parent/child navigation,
  paged entries and recent changes, exact metadata inspection, and directly
  selectable instanced file/directory objects. Reparse directories are visible
  as metadata but cannot be entered. Errors, truncation and event gaps are
  surfaced instead of silently inventing missing records. The scene is mounted
  only in its view; no persistent history or content preview is provided.

## Running application checks

- All 7 native CTest executables pass, including engine/ABI and filesystem
  scope, rename, overflow and large-directory checks. All 11 Rust tests and
  Clippy pass. All 51 frontend tests pass with two Vitest workers and a
  15-second per-test timeout; lint and strict TypeScript/production build pass.
- Release 0.7.0 native WebView smoke passes: a controlled temporary directory
  produced real create/modify/rename/delete observations, scoped navigation,
  direct file picking and a stable idle revision. File contents were unchanged.
  Process, network, resource and lifecycle regression probes, narrow viewport,
  nonblank canvas, reload and clean shutdown/reopen also pass with no page errors.
  Run the native smoke and overhead benchmark separately: simultaneous desktop
  instances caused a process-scene selection assertion to fail in one run.

## Performance evidence and limits

Uninstrumented Normal release, default view, no filesystem root selected:
30-second warmup and 60 one-second samples over the native host and six WebView
processes on an i7-6700 / 8 logical processors, Windows 11 build 26200. CPU is
normalized to total logical processor capacity; other system activity was not
controlled. Mean CPU was 0.750%, median 0.576%, p95 1.535%, p99 2.111%.
Native host mean CPU was 0.259%. Summed working set was 397.2 MiB, summed
private memory 183.9 MiB, native host private memory 6.66 MiB. This is a
no-root baseline, not an active-watch overhead benchmark. One runtime diagnostic
sample showed a 0.35 ms directory scan with two entries, not a representative
large-directory cost or a sustained measurement.

The 250 MiB summed working-set review target is still exceeded; shared pages
may be counted more than once, and private memory is a different metric. The
Phase 5 unexplained 6.322% CPU run remains unresolved despite this lower idle
sample. Very large directories, notification loss under sustained writes, active
watch overhead, network shares and reparse traversal are not qualified or
supported as an unrestricted filesystem index. SQLite history, replay and
large-count LOD remain future phases.