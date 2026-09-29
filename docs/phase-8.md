# Phase 8: SQLite history

Status: storage foundation only. Recording is not connected to the native
stream, no database is opened at startup, and no UI consent control exists yet.
History remains disabled. This is not completion of Phase 8.

The host now has a bundled SQLite dependency and an explicit storage open
function. On first open it creates the version-1 sessions, entities, events,
resource_samples and checkpoints tables and their indexes in one transaction.
Reopening an existing version-1 database retains its data; a database with a
newer schema version is rejected rather than downgraded. Each connection uses
foreign keys, WAL, NORMAL synchronous mode and a 250 ms busy timeout. The
caller must supply a path and explicitly invoke the function.

Three focused tests cover persistent/idempotent migration, enforced foreign
keys, WAL, missing-parent disk failure, and newer-version rejection. All 14
host tests and strict Clippy pass after the addition.

Next milestones: explicit opt-in and app-data path selection, one bounded
writer fed by acknowledged observations, transactional event/metric/checkpoint
recording, retention with recoverable reconstruction boundary, disk-full and
corruption handling that leaves live mode running, and read-only query tests.
No history, replay or performance claims are made for this foundation.