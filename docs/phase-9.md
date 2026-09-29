# Phase 9: historical reconstruction and replay

Status: implemented and functionally verified in the Windows 11 x64 release
application. Replay is an explicit, read-only mode; live native collection and
its subscriber continue separately. Recording remains opt-in and off by default.

## Reconstruction

- New sessions record bounded protocol-7 full/delta packets in SQLite between
  periodic full checkpoints. The writer uses its last committed native state as
  the delta base and skips duplicate sequences. Its single-slot queue may skip
  observations; a missing sequence or recorded event gap is surfaced in replay.
- A separate read-only connection selects the latest full checkpoint at or
  before the requested timestamp, then returns at most 256 ordered packets
  totaling at most 16 MiB. The same strict frontend packet parser and atomic
  graph application used by the live stream reconstruct the selected state.
  Broken chains, malformed metadata and mismatched timestamps reject the seek.
- The timeline lists at most 2,048 recent distinct recorded timestamps per
  session. Seeking chooses an observed state, not an interpolated instant.
  Old Phase 8 sessions without intermediate packets remain usable at their
  exact full-checkpoint times. Event evidence is limited to 100 records per
  query and cannot claim a complete interval beyond that bound.
- Retention keeps the full checkpoint preceding the 24-hour boundary, plus
  subsequent packets; an intermediate packet is never used as an anchor.
  Disk errors still stop recording, not live monitoring. No playback action
  changes native process, network or filesystem collection.

## Interface and tests

The History replay tool opens its own full-viewport 3D process scene, bounded
process search/inspection, recorded endpoint/directory counts, recent changes,
session selector and checkpoint slider with play/pause and single-step buttons.
The as-observed timestamp is always shown; gaps carry an incomplete-interval
warning. Returning to live does not replace the live Zustand frame or clear
its collection settings. Browser-only preview disables the replay entry.

- 20 Rust host tests pass, including exact checkpoint and intermediate packet
  reads, migration/retention and disk-error regressions. Clippy clean.
- 7 native CTest executables and 53 frontend tests pass. Strict TypeScript,
  frontend lint and production build pass.
- Native release 0.9.0 smoke recorded a controlled process, closed the session,
  sought full and intermediate states, rendered nonblank replay canvases at
  1360x820 and 400x740 without horizontal overflow, then returned to a live
  connection. Prior native process, resource, network, filesystem, lifecycle
  and renderer recovery checks also passed with no page errors. The smoke
  creates test sessions in the user's app-data history; it does not delete them.

## Performance and limits

Uninstrumented Normal release, recording off and replay closed, on i7-6700 /
8 logical CPUs, Windows 11 build 26200. After 30 seconds warmup, 60 one-second
samples over native host plus six WebView processes: mean CPU 0.883%, median
0.768%, p95 1.703%, p99 1.921%; host mean 0.351%, WebView mean 0.532%.
Summed working set 410.3 MiB; private memory 185.0 MiB, host private 6.95 MiB.
Other system activity was not controlled. This is not a replay or sustained
recording benchmark. The 250 MiB summed working-set target remains unmet, and
the Phase 5 unexplained 6.322% CPU outlier is unresolved.

Large populations, long sessions, active playback CPU, storage growth and
per-connection/file historical rendering have not been qualified. Replay
renders historical process instances and exposes recorded network/filesystem
counts; it does not draw historical connection or file geometry. Recording is
best-effort under backpressure, not an audit log. LOD and large-count
qualification belong to the subsequent phases.