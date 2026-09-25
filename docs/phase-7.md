# Phase 7: scoped filesystem observation

Native filesystem milestone in progress; IPC, spatial browsing and runtime/resource
qualification follow. Prior CPU-outlier and memory-budget concerns remain open.

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
that cannot be entered or selected as the root.