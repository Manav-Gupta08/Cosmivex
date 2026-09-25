import type { CoreFrame, ProcessRecord, GalaxyRecord } from '../../shared/protocol/core'
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
  subscriptionId: 1, protocolVersion: 5, abiVersion: 1, sequence: '1', uptimeMs: 0,
  observedAtUnixMs: 1790000000000, intervalMs: 2000, profile: 'normal', enabledCollectors: 0,
  processes: { observedAtUnixMs: 0, logicalCpus: 1, error: 0, truncated: false, collectionMs: 0, rows: [], galaxies: [], modelBuildMs: 0 },
}

export function packetFixture(frame: CoreFrame = coreFixture): CorePacket {
  return { ...frame, kind: 'snapshot', baseSequence: null,
    processes: { ...frame.processes, removed: [], removedGalaxies: [] },
    events: { throughSequence: '0', evictedCount: '0', gapCount: '0', rows: [] },
  }
}

export function chunkFixture(packet: CorePacket = packetFixture(), transferId = '1'): WireChunk {
  const payload = JSON.stringify(packet)
  return { kind: 'chunk', protocolVersion: 5, subscriptionId: packet.subscriptionId, transferId, chunkIndex: 0, chunkCount: 1,
    totalBytes: new TextEncoder().encode(payload).byteLength, payload }
}