# Phase 8: opt-in SQLite history

Status: implemented and functionally verified in the Windows 11 x64 release
application. Recording is off by default and never opened at startup. This is
not Phase 9 replay or a performance sign-off for sustained recording.

## Storage and control

- The diagnostics checkbox explicitly starts/stops a session in the user's
	Tauri app-data directory (`history.sqlite`). It does not change process,
	network or filesystem collection. The session starts at the current event
	cursor, so earlier observations are not presented as a complete history.
- One background writer consumes an at-most-one-pending-snapshot queue outside
	the native collection and UI delivery path. The next available process event
	window records a gap if intervening events were lost. The window is bounded;
	skipped network/filesystem intermediate states are not reconstructible.
- Prepared, transactional writes record process events, changed network and
	filesystem snapshots, per-process 10-second CPU/working-set min/max/mean
	buckets, a latest-value process index, and full JSON checkpoints at session
	start and about every 60 seconds. Checkpoints are limited to 16 MiB. No
	packet payloads or file contents are recorded, but metadata is sensitive.
- Schema version 1 is migrated in a transaction and newer versions are rejected.
	Foreign keys, WAL, NORMAL synchronous mode and a 250 ms busy timeout are
	enabled. A 256 MiB SQLite page limit and 16 MiB journal size limit reduce
	growth; auxiliary WAL files and partial time windows are not hard-capped by
	the database page limit. Disk/write errors turn recording off and surface an
	error while live observation remains available.
- Expired closed sessions are deleted after 24 hours. For an ongoing session,
	retention keeps the most recent checkpoint at or before the cutoff and the
	events needed after it. Pruning occurs on checkpoint writes, not continuously;
	no hot-path vacuum is performed.
- A separate read-only connection exposes at most 50 recent sessions or 100
	events from one session and a timestamp. The UI lists sessions; bounded
	event queries are IPC-only until Phase 9. Queries cannot supply a database
	path or mutate the live stream. Replay and timeline navigation are not here.

## Verification

- All 19 Rust host tests pass, including migration/reopen, foreign keys,
	future-version refusal, event deduplication and gaps, transactional rollback
  on forced write error and actual SQLite disk-full, corrupt-file rejection,
  bucket aggregation, retention boundary, read-only queries, invalid directory,
  opt-in bridge shutdown and session closure.
	Clippy is clean. All 7 native CTest executables, 51 frontend tests (two
	workers/15-second timeout), frontend lint and strict production build pass.
- Release 0.8.0 native WebView smoke enabled recording, observed a controlled
	process PID through the history query, disabled recording and verified a
	closed session. Prior process/resource/network/filesystem probes, renderer
	recovery and close/reopen also pass with no page errors. This smoke creates
	a small real session in the user's app-data history; it does not delete user
	data. Browser preview leaves recording disabled.

## Overhead and limits

Uninstrumented Normal 0.8.0 release with recording **off**, 30-second warmup
and 60 one-second samples on an i7-6700 / 8 logical processors, Windows 11
build 26200, host plus six WebView processes. Whole-app CPU mean 0.727%,
median 0.576%, p95 1.342%, p99 1.530%; host mean 0.276%, WebView mean
0.451%. Summed working set 395.6 MiB, summed private memory 184.6 MiB,
host private memory 6.79 MiB. Other system activity was not controlled.
Active recording CPU, sustained write rate, full-database failure and long-run
WAL growth are not qualified by this default-idle sample.

The 250 MiB summed working-set review target remains missed, and the Phase 5
unexplained 6.322% CPU sample remains unresolved. Shared pages may count more
than once; private memory measures something else. History is best effort when
the writer is backpressured; do not use it as an audit log. Phase 9 will cover
historical reconstruction, timeline and explicit replay mode.