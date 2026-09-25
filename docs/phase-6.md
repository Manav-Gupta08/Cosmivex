# Phase 6: network observation

Native collector milestone in progress; visual integration and overhead qualification
follow. The Phase 5 CPU outlier and working-set budget concern remain open.

## Collection contract

- Windows GetExtendedTcpTable/GetExtendedUdpTable collect IPv4 and IPv6 owner-PID
  metadata. TCP listeners have no claimed remote peer. UDP records are local
  endpoints, not established remote connections. IP literals/ports are displayed;
  no reverse DNS, packet payload capture or external lookup is performed.
- GetIfTable2 supplies interface metadata and cumulative byte counters. Rates use
  monotonic deltas, are unavailable at the first sample, and reset on counter
  rollback, interface loss/down state or collection failure. These are interface
  rates, never attributed to individual TCP/UDP rows.
- Owner creation time is queried once per distinct PID per scan with limited query
  rights. A process born after collection began is not assigned as an old row's
  owner. Linking to process stars additionally requires matching creation identity.
- Table buffer retries are bounded to three and 4 MiB each. Snapshots cap at 4,096
  connection/endpoint rows and 128 interfaces, exposing truncation and separate
  table/interface errors. Collection supports cancellation. No elevation is requested.
- Connection identity includes family/protocol/endpoints and observed owner identity;
  state changes preserve identity. Indistinguishable rows coalesce with a count;
  conflicting states become unknown, not a guessed state. Generation IDs do not
  reset. A close/reopen entirely between polls can remain indistinguishable.

## Native tests

Real loopback IPv4/IPv6 TCP listeners, established peers, owner PIDs/creation time,
UDP endpoints and closure are checked. Synthetic fixtures validate exact interface
rate deltas, missing first rates, rollback, down interfaces, owner PID reuse,
generation reset safety and duplicate coalescing. Fixtures are test-only.

One local scan observed 210 rows in about 7.7 ms before integration. This is a
single measurement, not a whole-app budget guarantee.