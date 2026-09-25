# Phase 5: CPU energy and memory size

In progress. Native mapping and spike detection are implemented and tested;
transport, rendering, live workload validation and overhead checks follow.

## Mapping policy

The C++ core derives two visual levels (0-31) from actual process measurements.
These are presentation inputs, not new OS measurements. Exact CPU percentages
and working-set bytes remain unchanged in the inspector and transport.

- CPU energy: square root of machine CPU fraction, quantized to 32 levels.
- Memory size: log1p(working set / 16 MiB) / log(257), saturated at 4 GiB,
  quantized to 32 levels. Larger working sets still have exact numeric readouts.
- Missing/invalid measurements have level -1 natively (null on the wire), not
  level zero. Measured zero remains a valid minimum level.
- A 0.75-level deadband around the prior visual level suppresses boundary jitter.
  The prior level is retained only for the same observed process lifetime.

CPU spike policy: two consecutive distinct samples at >=10% of total machine
CPU, rearm after <=6%, and at least 30 monotonic seconds between signals for the
same tracked lifetime. Unknown data breaks the sustained-sample requirement.
Events include the actual CPU value and threshold. This is a monitor policy, not
a crash detector, health diagnosis, or proof that the workload is undesirable.
No speculative memory leak or disk/network activity detector is added.

## Native checks

Tests cover bounded/monotonic mapping, missing vs zero, invalid CPU values, extreme
memory saturation, visual hysteresis, consecutive-sample detection, duplicate
timestamps, cooldown, unavailable intervals, journal integration and appearance
changes entering the native delta. One local Release run mapped 100,000 samples
in about 4.6 ms; this is a cost probe, not an end-to-end performance guarantee.