import { create } from 'zustand'
import type { CoreFrame, ProcessRecord, GalaxyRecord, ConnectionRecord, NetworkInterfaceRecord, FileEntryRecord } from '../../../../shared/protocol/core'
import { buildLayout, type UniverseLayout, type ViewMode, type Position } from '../../universe/layout'
import type { CorePacket, ProcessEvent } from '../../../../shared/protocol/stream'
import { updateResourceLevels, type ResourceLevels } from '../../universe/resources'
import { buildNetworkLayout, matchingConnections, type NetworkLayout } from '../../universe/network-layout'
import { buildFileSystemLayout, type FileSystemLayout } from '../../universe/filesystem-layout'

export interface LifecycleEffect { sequence: string; kind: 'PROCESS_CREATED' | 'PROCESS_TERMINATED' | 'RESOURCE_SPIKE'; universe: Position; hierarchy: Position; startedAt: number }

const emptyLayout = buildLayout({ observedAtUnixMs: 0, logicalCpus: 1, error: 0, truncated: false, collectionMs: 0, rows: [], galaxies: [], modelBuildMs: 0 })
const emptyNetworkLayout = buildNetworkLayout({ enabled: false, observedAtUnixMs: 0, collectionMs: 0, tableErrors: [0, 0, 0, 0], interfaceError: 0, truncated: false, connections: [], interfaces: [] })
const emptyFileSystemLayout: FileSystemLayout = { key: '', positions: new Map(), directories: new Set() }

function matchingIds(frame: CoreFrame | null, query: string): string[] {
  const search = query.trim().toLowerCase()
  return frame?.processes.rows.filter(process => !search || (/^[0-9]+$/.test(search)
    ? String(process.pid) === search : process.name.toLowerCase().includes(search))).map(process => process.id) ?? []
}

function reuseIds(previous: string[], next: string[]): string[] {
  return previous.length === next.length && previous.every((id, index) => id === next[index]) ? previous : next
}

interface CoreState {
  status: 'connecting' | 'connected' | 'disconnected' | 'stale' | 'error'
  frame: CoreFrame | null
  bytesReceived: number
  lastReceivedAt: number | null
  error: string | null
  processIds: string[]
  query: string
  selected: ProcessRecord | null
  selectedGalaxy: GalaxyRecord | null
  selectedConnection: ConnectionRecord | null
  selectedInterface: NetworkInterfaceRecord | null
  networkIds: string[]
  networkLayout: NetworkLayout
  selectedFile: FileEntryRecord | null
  fileLayout: FileSystemLayout
  selectFile: (id: string | null) => void
  layout: UniverseLayout
  viewMode: ViewMode
  focusRevision: number
  events: ProcessEvent[]
  eventCursor: string
  evictedEvents: string
  missedEvents: string
  effects: LifecycleEffect[]
  lastDelivery: 'snapshot' | 'delta' | null
  fullSnapshots: number
  deltaBatches: number
  changedRows: number
  lastPayloadBytes: number
  resourceLevels: ReadonlyMap<string, ResourceLevels>
  resourceVisuals: boolean
  setResourceVisuals: (enabled: boolean) => void
  setQuery: (query: string) => void
  select: (id: string | null) => void
  selectGalaxy: (id: string | null) => void
  selectConnection: (id: string | null) => void
  selectInterface: (id: string | null) => void
  setViewMode: (mode: ViewMode) => void
  begin: () => void
  receive: (frame: CoreFrame, bytes: number, now: number, packet?: CorePacket) => void
  fail: (message: string) => void
}

export const useCoreStore = create<CoreState>((set) => ({
  status: 'connecting', frame: null, bytesReceived: 0, lastReceivedAt: null, error: null,
  processIds: [], query: '', selected: null, focusRevision: 0,
  selectedGalaxy: null, layout: emptyLayout, viewMode: 'universe',
  selectedConnection: null, selectedInterface: null, networkIds: [], networkLayout: emptyNetworkLayout,
  selectedFile: null, fileLayout: emptyFileSystemLayout,
  selectFile: id => set(state => ({ selectedFile: state.frame?.filesystem.entries.find(entry => entry.id === id) ?? null, selected: null, selectedGalaxy: null, selectedConnection: null, selectedInterface: null, focusRevision: state.focusRevision + 1 })),
  events: [], eventCursor: '0', evictedEvents: '0', missedEvents: '0', effects: [], lastDelivery: null, fullSnapshots: 0, deltaBatches: 0, changedRows: 0, lastPayloadBytes: 0,
  resourceLevels: new Map(), resourceVisuals: true,
  setResourceVisuals: resourceVisuals => set({ resourceVisuals }),
  setQuery: query => set(state => ({ query, processIds: reuseIds(state.processIds, matchingIds(state.frame, query)), networkIds: state.frame ? reuseIds(state.networkIds, matchingConnections(state.frame.network, query)) : [] })),
  select: id => set(state => ({ selected: state.frame?.processes.rows.find(process => process.id === id) ?? null, selectedGalaxy: null, selectedConnection: null, selectedInterface: null, focusRevision: state.focusRevision + 1 })),
  selectGalaxy: id => set(state => ({ selectedGalaxy: state.frame?.processes.galaxies.find(group => group.id === id) ?? null, selected: null, selectedConnection: null, selectedInterface: null, focusRevision: state.focusRevision + 1 })),
  selectConnection: id => set(state => ({ selectedConnection: state.frame?.network.connections.find(row => row.id === id) ?? null, selectedInterface: null, selected: null, selectedGalaxy: null, focusRevision: state.focusRevision + 1 })),
  selectInterface: id => set(state => ({ selectedInterface: state.frame?.network.interfaces.find(row => row.id === id) ?? null, selectedConnection: null, selected: null, selectedGalaxy: null, focusRevision: state.focusRevision + 1 })),
  setViewMode: viewMode => set(state => ({ viewMode, selected: null, selectedGalaxy: null, selectedConnection: null, selectedInterface: null, selectedFile: null,
    query: '', processIds: reuseIds(state.processIds, matchingIds(state.frame, '')), networkIds: state.frame ? reuseIds(state.networkIds, matchingConnections(state.frame.network, '')) : [] })),
  begin: () => set({ status: 'connecting', frame: null, error: null, bytesReceived: 0, lastReceivedAt: null, processIds: [], selected: null, selectedGalaxy: null, query: '', layout: emptyLayout,
    events: [], eventCursor: '0', evictedEvents: '0', missedEvents: '0', effects: [], lastDelivery: null, fullSnapshots: 0, deltaBatches: 0, changedRows: 0, lastPayloadBytes: 0, resourceLevels: new Map(), selectedConnection: null, selectedInterface: null, networkIds: [], networkLayout: emptyNetworkLayout, selectedFile: null, fileLayout: emptyFileSystemLayout }),
  receive: (frame, bytes, now, packet) => set(state => {
    if (state.frame?.subscriptionId === frame.subscriptionId && (BigInt(state.frame.sequence) > BigInt(frame.sequence)
      || (state.frame.sequence === frame.sequence && packet?.kind !== 'snapshot'))) return state
    const layout = buildLayout(frame.processes, state.layout)
    const incoming = packet?.events.rows ?? []
    let gap = BigInt(packet?.events.gapCount ?? '0')
    if (packet?.kind === 'snapshot' && state.eventCursor !== '0' && incoming.length) {
      const missing = BigInt(incoming[0].sequence) - BigInt(state.eventCursor) - 1n
      if (missing > gap) gap = missing
    }
    const eventMap = new Map((packet?.kind === 'snapshot' ? [] : state.events).map(event => [event.sequence, event]))
    incoming.forEach(event => eventMap.set(event.sequence, event))
    const events = [...eventMap.values()].sort((left, right) => BigInt(left.sequence) < BigInt(right.sequence) ? -1 : 1).slice(-256)
    const effects = frame.enabledCollectors && frame.profile !== 'eco' ? state.effects.filter(effect => now - effect.startedAt < 900) : []
    if (packet?.kind === 'delta' && gap === 0n && frame.enabledCollectors && frame.profile !== 'eco'
        && !incoming.some(event => ['BASELINE', 'EVENT_GAP', 'COLLECTION_PAUSED'].includes(event.kind))) {
      for (const event of incoming) {
        if (!event.processId || BigInt(event.sequence) <= BigInt(state.eventCursor)
            || !['PROCESS_CREATED', 'PROCESS_TERMINATED', 'RESOURCE_SPIKE'].includes(event.kind)
            || frame.observedAtUnixMs - event.observedAtUnixMs > frame.intervalMs * 2) continue
        const source = event.kind === 'PROCESS_TERMINATED' ? state.layout : layout
        const universe = source.universe.get(event.processId)
        const hierarchy = source.hierarchy.get(event.processId)
        if (universe && hierarchy) effects.push({ sequence: event.sequence, kind: event.kind as LifecycleEffect['kind'], universe, hierarchy, startedAt: now })
      }
    }
    const nextEffects = effects.slice(-32)
    const stableEffects = state.effects.length === nextEffects.length && state.effects.every((effect, index) => effect === nextEffects[index]) ? state.effects : nextEffects
    return {
      status: 'connected', frame, bytesReceived: state.bytesReceived + bytes, lastReceivedAt: now, error: null,
      processIds: reuseIds(state.processIds, matchingIds(frame, state.query)),
      selected: frame.processes.rows.find(process => process.id === state.selected?.id) ?? state.selected,
      selectedGalaxy: frame.processes.galaxies.find(group => group.id === state.selectedGalaxy?.id) ?? state.selectedGalaxy,
      selectedConnection: frame.network.connections.find(row => row.id === state.selectedConnection?.id) ?? state.selectedConnection,
      selectedInterface: frame.network.interfaces.find(row => row.id === state.selectedInterface?.id) ?? state.selectedInterface,
      networkIds: reuseIds(state.networkIds, matchingConnections(frame.network, state.query)),
      networkLayout: buildNetworkLayout(frame.network, state.networkLayout),
      selectedFile: frame.filesystem.scope !== state.frame?.filesystem.scope ? null : frame.filesystem.entries.find(entry => entry.id === state.selectedFile?.id) ?? state.selectedFile,
      fileLayout: buildFileSystemLayout(frame.filesystem, state.fileLayout),
      layout, events, effects: stableEffects, eventCursor: packet?.events.throughSequence ?? state.eventCursor,
      evictedEvents: packet?.events.evictedCount ?? state.evictedEvents, missedEvents: (BigInt(state.missedEvents) + gap).toString(),
      lastDelivery: packet?.kind ?? 'snapshot', fullSnapshots: state.fullSnapshots + (packet?.kind === 'delta' ? 0 : 1),
      deltaBatches: state.deltaBatches + (packet?.kind === 'delta' ? 1 : 0),
      changedRows: packet ? packet.processes.rows.length + packet.processes.removed.length : frame.processes.rows.length,
      lastPayloadBytes: bytes,
      resourceLevels: updateResourceLevels(state.resourceLevels, frame.processes.rows),
    }
  }),
  fail: error => set({ status: 'error', error }),
}))