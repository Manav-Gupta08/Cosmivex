import type { CoreFrame, ProcessRecord } from '../../shared/protocol/core'

export const processFixture: ProcessRecord = {
  id: '42:1', pid: 42, parentPid: 1, name: 'fixture.exe', threadCount: 3,
  creationFiletime: '134032608000000000', createdAtUnixMs: 1758787200000,
  cpuPercent: null, workingSetBytes: '1048576', timingError: 0, memoryError: 0,
}
export const coreFixture: CoreFrame = {
  subscriptionId: 1, protocolVersion: 2, abiVersion: 1, sequence: '1', uptimeMs: 0,
  observedAtUnixMs: 1790000000000, intervalMs: 2000, profile: 'normal', enabledCollectors: 0,
  processes: { observedAtUnixMs: 0, logicalCpus: 1, error: 0, truncated: false, collectionMs: 0, rows: [] },
}