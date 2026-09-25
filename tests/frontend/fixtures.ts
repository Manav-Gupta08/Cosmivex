import type { CoreFrame, ProcessRecord, GalaxyRecord, NetworkSnapshot, ConnectionRecord } from '../../shared/protocol/core'
import type { CorePacket, WireChunk } from '../../shared/protocol/stream'

export const processFixture: ProcessRecord = {
  id: '42:1', pid: 42, parentPid: 1, name: 'fixture.exe', threadCount: 3,
  parentId: null, parentStatus: 'missing', galaxyId: 'g:42:1', depth: 0,
  creationFiletime: '134032608000000000', createdAtUnixMs: 1758787200000,
  cpuPercent: null, workingSetBytes: '1048576', timingError: 0, memoryError: 0,
  cpuLevel: null, memoryLevel: 0,
}
export const galaxyFixture: GalaxyRecord = {
  id: 'g:42:1', rootId: '42:1', label: 'fixture.exe', executablePath: 'C:\\test\\fixture.exe', imageError: 0,
  processCount: 1, cpuSampleCount: 0, memorySampleCount: 1, cpuPercent: null, workingSetBytes: '1048576',
}
export const coreFixture: CoreFrame = {
  subscriptionId: 1, protocolVersion: 6, abiVersion: 1, sequence: '1', uptimeMs: 0,
  observedAtUnixMs: 1790000000000, intervalMs: 2000, profile: 'normal', enabledCollectors: 0,
  processes: { observedAtUnixMs: 0, logicalCpus: 1, error: 0, truncated: false, collectionMs: 0, rows: [], galaxies: [], modelBuildMs: 0 },
  network: { enabled: false, observedAtUnixMs: 0, collectionMs: 0, tableErrors: [0, 0, 0, 0], interfaceError: 0, truncated: false, connections: [], interfaces: [] },
}

export const connectionFixture: ConnectionRecord = { id: 'n:1', pid: 42, family: 4, protocol: 'TCP', state: 'ESTABLISHED',
  localAddress: '127.0.0.1', localPort: 45000, remoteAddress: '127.0.0.1', remotePort: 45001,
  ownerCreation: processFixture.creationFiletime, ownerError: 0, observations: 1 }
export const networkFixture: NetworkSnapshot = { ...coreFixture.network, enabled: true, observedAtUnixMs: coreFixture.observedAtUnixMs, connections: [connectionFixture] }

export function packetFixture(frame: CoreFrame = coreFixture): CorePacket {
  return { ...frame, kind: 'snapshot', baseSequence: null,
    processes: { ...frame.processes, removed: [], removedGalaxies: [] },
    events: { throughSequence: '0', evictedCount: '0', gapCount: '0', rows: [] },
  }
}

export function chunkFixture(packet: CorePacket = packetFixture(), transferId = '1'): WireChunk {
  const payload = JSON.stringify(packet)
  return { kind: 'chunk', protocolVersion: 6, subscriptionId: packet.subscriptionId, transferId, chunkIndex: 0, chunkCount: 1,
    totalBytes: new TextEncoder().encode(payload).byteLength, payload }
}