# Phase 4: lifecycle and bounded change delivery

In progress: the native lifecycle journal and snapshot differ are tested;
desktop streaming and visual integration are the next milestone.

## Native semantics

- First complete observation is a baseline, not thousands of process births.
- Consecutive complete snapshots produce PROCESS_CREATED (first observed),
  PROCESS_TERMINATED (no longer observed), and coalesced PROCESS_UPDATED events.
- Every event has an increasing engine-session sequence, UTC observation time,
  prior observation time and monotonic timestamp. Polling does not establish an
  exact termination time, crash cause, or completeness for short-lived processes.
- PID reuse with different known creation times produces removal/appearance of
  distinct lifetimes. A weak/strong identity transition is an identity update,
  not a fabricated termination and birth.
- Collection errors and truncation emit a gap once per interrupted interval.
  Recovery establishes a new baseline. Intentional pause is recorded separately;
  it does not imply process termination.
- The native recent journal retains at most 256 events. Sequence bounds and
  eviction counts make missed consumer history detectable. This is bounded RAM
  observation history, not SQLite persistence or timeline replay.
- Native diffs compare meaningful process fields, resolved parent/group identities,
  and group aggregates. CPU timing counters and collection timestamps alone do
  not force unchanged process rows back through IPC. Removals use lifetime IDs,
  never PID alone.

Tests cover baseline, appearance, PID reuse, identity/permission change, gaps,
pause/resume, unchanged and metric-only diffs, and a 4,096-process burst. On the
local Release build, burst normalization plus unchanged diff took about 2.6 ms
in one test run; this is not a general throughput guarantee.