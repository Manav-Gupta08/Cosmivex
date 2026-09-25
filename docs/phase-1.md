# Phase 1: implementation and verification

Date: 2026-09-25. Windows 11 build 26200, x64. Foundation functional/runtime gates
passed; memory budget deviation remains open. No later phase is claimed complete.

## Delivered

- C++20 static library with a portable versioned C ABI, fixed-size health snapshot,
  condition-variable scheduling, latest-only coalescing and prompt joined shutdown.
- Tauri 2 Rust host linked via CMake, matched MSVC runtime linkage, local command
  permissions, restrictive CSP, packaged assets, standard-user launch.
- Channel subscription/replacement, matching-sequence acknowledgement, one frame
  in flight, stale-state detection, version checks and explicit initialization errors.
- Strict TypeScript wire validation, Zustand latest-state store, duplicate rejection,
  lifecycle cleanup and no fabricated measurements in browser-only mode.
- Full-bleed R3F reference viewport, smooth camera controls, reset, clipping/zoom
  limits, demand drawing, hidden-window suspension, profile-dependent draw ceilings,
  optional diagnostics and recoverable renderer failure.
- Architecture/API/permissions/event/universe/history design before implementation.

## Verified gates

| Check | Result |
| --- | --- |
| CMake Release / CTest | Pass: ABI sizes/version/invalid arguments, real clock/heartbeat, 10,000 coalesced updates, native profiles, stop/wait/destroy. |
| Cargo native integration | 2 tests pass: real C++ frame serialization, bounded channel and subscription replacement. |
| Frontend | 10 tests pass: wire contract, sequence ordering, no fake browser telemetry, diagnostics, ack/stale recovery, malformed input, late disposal, initialization failure. |
| TypeScript / production Vite | Pass, strict types. |
| Frontend lint / Rust Clippy | Pass, no warnings. |
| Windows release | Built and launched; executable 8,648,192 bytes before final incremental metadata-free source rebuild (approximately 8.25 MiB). |
| Real C++ -> Rust -> WebView | Pass: native sequences advance, profile choices are confirmed by native intervals, reload resubscribes. |
| Camera / rendering | Pass: orbit changes canvas pixels; reset works; frame counter becomes stable at rest. |
| Desktop / narrow viewport | Pass: 1360x820 and 400x740, screenshots inspected, no horizontal overflow including diagnostics. |
| Canvas pixel check | Final native run: 205 lit downsampled pixels desktop; 473 narrow. No blank canvas. |
| Renderer failure | Forced WebGL loss shows error; native status survives; retry creates a working canvas. |
| Native lifecycle | Responsive close within 5 s and successful reopening. |
| Browser fallback | Disconnected, profiles disabled, no invented entities; camera/idle/recovery checks pass. |
| JS runtime errors | Zero page errors in native and browser smoke tests. |

Raw screenshots and benchmark samples are in local ignored `artifacts/`. Tests
use the real Windows executable; browser screenshots alone were not used to claim
native success. The reference rings/grid are navigation aids, not telemetry.

## Measured overhead

Release x64, Normal profile, no collectors, diagnostics closed, no CDP attached.
Intel Core i7-6700 at 3.40 GHz, 8 logical processors, WebView2 153.0.4234.48.
30-second warmup then 60 one-second samples. Seven processes: native host plus
WebView browser, renderer, GPU, two utilities and crash handler. CPU is normalized
against total logical CPU capacity. Other machine activity was not controlled.

Final sample captured 2026-09-25T06:02:32Z:

| Metric | Measured |
| --- | --- |
| Whole-app CPU mean / median | 0.114% / 0% |
| Whole-app CPU p95 / p99 | 0.384% / 1.701% |
| Native host CPU mean (C++ + Rust) | 0.0063% |
| WebView subprocess CPU mean | 0.108% |
| Whole-app summed working set, mean | 369.9 MiB |
| Whole-app summed private memory, mean | 158.6 MiB |
| Native host private memory, mean | 6.17 MiB |
| GPU subprocess private memory at end | 59.8 MiB |

Measured optimization: the original Normal framebuffer used pixel ratio 1.5 and
MSAA. Under the same method it averaged 481.0 MiB summed working set, 269.0 MiB
private memory, and 171.1 MiB GPU subprocess private memory. Pixel ratio 1 with no
MSAA reduced private memory by about 41% and GPU process private memory by about
65%, while runtime rendering checks continued to pass. Higher quality is opt-in
via Cinematic. Summed working sets can double-count shared pages; this is not
unique physical RAM consumption. Private memory is reported separately, not
substituted for the working-set budget.

The first draft CPU sampler rounded fractions because PowerShell selected an
integer Math.Max overload. That draft's CPU result is invalid and superseded by
the floating-point measurements above. One-second CPU samples still have Windows
accounting granularity; zero median is not proof of zero execution cost.

## Open limits and next gate

- **Working-set review target missed:** 369.9 MiB > 250 MiB. Native overhead is low,
  but WebView2 imposes a substantial baseline. This remains a tracked performance
  deviation, not a silently relaxed target. CPU average/p95 meet the idle target;
  rare one-second p99 spikes exceed 1% in this single run.
- This is an initial idle baseline, not certification: no controlled multi-run
  statistics, long-duration memory soak, active 60/30 fps qualification, GPU timer
  queries, isolated C++ thread CPU, or 10k/50k/100k entity benchmark yet.
- Current UI reports draw submission CPU time, not GPU duration. Health payload
  receive bytes exclude Tauri framing and acknowledgement overhead.
- The lazy Three.js chunk is ~960 KB minified (~253 KB gzip); Vite's default 500 KB
  warning remains visible. The initial UI chunk is ~323 KB (~99 KB gzip). Splitting
  the renderer delays its loading; it does not claim to remove its runtime cost.
- R3F currently triggers a Three.Clock deprecation warning in development. There
  are no page errors; replacing dependency internals is not part of this phase.
- Rust stable 1.98.1 is verified. The manifest's lower declared minimum has not
  been independently certified against the locked transitive dependency graph.
- Process/threads/resources/network/filesystem/history/replay remain unimplemented.
  Observability usefulness and live telemetry correctness begin in Phase 2.

Next phase requires real standard-user Windows process collection, identity-safe
CPU deltas, unavailable-field semantics, and comparison against OS observations.
Recheck resource budgets after enabling that collector, before increasing fidelity.

## Native safety contract

Rust's Engine is Send/Sync because the C ABI synchronizes wait/profile/stop through
one native mutex. Arc keeps the handle alive while the bridge worker waits. Shutdown
sets the stopping flag, wakes the native condition variable, joins the bridge, and
only then permits destruction. C++ joins its worker before destroying synchronization
members. C++ allocations are freed in C++; caller-owned POD output contains no
borrowed pointers. Tests exercise the real boundary, not a substituted engine.