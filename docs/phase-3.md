# Phase 3: process ancestry and galaxies

Native model milestone implemented; visual integration and runtime qualification
are in progress. Phase 2 remains the latest tagged desktop until those gates pass.

## Evidence and boundaries

A parent PID alone is not a safe relationship: its owner can exit and the PID can
be reused. The C++ model resolves an edge only if both observed creation times are
known and the candidate parent strictly predates the child. Root, missing parent,
unavailable creation time, newer/equal timestamp and self-parent states remain
explicit. This is validation of an observed parent PID, not proof against deliberate
Windows parent-process spoofing. Equal timestamps are conservatively unresolved.

Galaxies are **inferred same-image ancestry groups**, not an OS application registry.
A child inherits a galaxy only over a validated parent edge when both observed full
executable paths match exactly. Different paths, missing paths and disconnected
roots stay separate, even when names match. This avoids merging unrelated programs
or claiming that every descendant of Explorer belongs to Explorer. Cross-image
helpers can therefore be separate galaxies; the hierarchy still shows their real
validated parent relationship. Case/path aliases can split a group conservatively.
This is an executable-path identity, not a content hash or signature assertion.

QueryFullProcessImageNameW uses the existing minimal query handle. Successful paths
are cached only against PID plus creation time, and dead entries are removed each
collection. Failures remain nullable with Win32 error codes. No file content is
opened, no administrator permission is requested, and paths are local metadata.
Paths above the bounded 16 KiB UTF-8 representation are unavailable, not truncated
into misleading identities. An on-disk rename after process startup may leave the
cached observed path unchanged until a new lifetime is sampled.

The model sorts by creation time and resolves parents iteratively, never recursively.
CPU/working-set aggregates retain sample counts so missing metrics are not treated
as zero. Summed working sets can double-count shared pages and are not application
private memory. Geometry, camera, and color remain presentation responsibilities;
relationships, membership, and aggregate measurements are owned by C++.

## Native checks

- Reused parent PID, missing timestamps, self-parent and equal timestamps rejected.
- Same executable name at different paths does not merge; disconnected instances
  at the same path remain distinct; cross-image hierarchy edges are retained.
- Partial aggregate coverage and values verified.
- A 4,096-process deep chain resolves without recursion (about 0.50 ms in one local
  Release test run; not a general performance guarantee).
- Real test executable and its controlled child share a queried image path, resolve
  to the correct parent, and belong to the same inferred galaxy. Existing collection,
  cancellation, handle lifetime and process exit tests also run.