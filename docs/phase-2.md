# Phase 2: real process telemetry

Work in progress. Native collector milestone implemented; desktop integration is
the next milestone. Phase 1 remains the currently tagged desktop release.

## Native collector

- Windows Toolhelp supplies the observed PID, executable name, parent PID and
  thread count. Names are UTF-8. No executable path or file contents are read.
- GetProcessTimes supplies creation identity and cumulative CPU ticks.
- K32GetProcessMemoryInfo supplies working set, not private bytes. Minimal query
  rights are tried first; a read/query handle is requested only if needed.
- CPU = delta(kernel + user ticks) / elapsed monotonic time / all active logical
  CPUs. Display range is 0-100% of machine capacity, not per-core percentage.
- First sample, changed creation identity, inaccessible timing, or a backwards
  counter produces unavailable CPU. Permission errors are retained as Win32 codes.
- Every observed lifetime receives an engine-local generation. Without creation
  time identity is weak: an unobserved exit/reuse between polls cannot be detected.
- Snapshot failure is explicit, not an apparently valid empty list. Collection is
  cancelable, capped at 4,096 records and marks truncation. No handle cache, history
  writes, driver, elevated tracing, or renderer dependency.

## Native validation

CTest covers exact synthetic CPU deltas, identity reuse, missing/denied fields,
counter rollback, disappearance, collection failure, real own-process identity
compared with an independent OS call, cancellation, repeated handle cleanup, and a
controlled child process appearing with the correct parent PID then disappearing.
Synthetic observations exist only in native tests. Test workloads use their own
short-lived child process and never manipulate unrelated processes.

Run `ctest --test-dir build/core -C Release --output-on-failure`. Runtime throughput
and whole-app overhead must be measured again after integration.