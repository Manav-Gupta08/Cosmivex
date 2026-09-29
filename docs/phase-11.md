# Phase 11: restrained effects and accessibility (in progress)

The native universe retains its existing factual reference geometry, instance
colors and 900 ms lifecycle rings. Rings remain capped at 32, disabled in Eco
and under reduced motion, and do not require continuous idle rendering. No
postprocessing, bloom, particles or synthetic telemetry were introduced.

## Keyboard and focus

- The 3D canvas is a keyboard tab stop with a visible focus outline and a
  screen-reader label naming its controls. When focused, arrows orbit and
  `+`/`-` zoom via the same camera controller used by pointer interactions.
  Alt/Ctrl/Meta shortcuts, text fields and other controls are not intercepted.
- Closing Diagnostics, Process/Network/Filesystem list, Galaxy list or Recent
  activity returns focus to its still-visible trigger. Process and Galaxy list
  selection uses the same close callbacks.

## Verification

57 frontend tests, frontend lint and production build pass. Browser preview
smoke confirms focused orbit and zoom keys change the canvas independently of
its focus ring; it also checks nonblank desktop/narrow canvases, stable idle
frames and no page errors. The rebuilt Windows release WebView smoke passes
native telemetry, network/filesystem, replay, keyboard and pointer camera
navigation, recovery and desktop/narrow canvas checks (566/770 lit pixels).
Earlier smoke runs failed existing network endpoint- and galaxy-picking
assertions before reaching the keyboard path; unchanged retries passed. These
checks do not certify screen-reader output
across assistive technologies or full WCAG conformance.

Normal release with recording off, i7-6700 / 8 logical CPUs, Windows 11 build
26200, 30 s warmup then 60 one-second samples: whole-app CPU mean 0.997%,
median 0.933%, p95 2.080%, p99 2.441%; host mean 0.408% and WebView tree mean
0.589%. Seven-process summed working set mean 404.3 MiB, private mean 186.3
MiB, host private mean 6.97 MiB. System activity was not controlled. The idle
CPU mean is borderline against the <1% target, and working set still exceeds
the 250 MiB review target. Active GPU/frame and sustained-load qualification
remain open in Phase 10/12; do not tag this phase as fully qualified yet.