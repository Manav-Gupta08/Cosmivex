import { create } from 'zustand'
import type { CoreFrame, ProcessRecord, GalaxyRecord } from '../../../../shared/protocol/core'
import { buildLayout, type UniverseLayout, type ViewMode } from '../../universe/layout'

const emptyLayout = buildLayout({ observedAtUnixMs: 0, logicalCpus: 1, error: 0, truncated: false, collectionMs: 0, rows: [], galaxies: [], modelBuildMs: 0 })

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
  layout: UniverseLayout
  viewMode: ViewMode
  focusRevision: number
  setQuery: (query: string) => void
  select: (id: string | null) => void
  selectGalaxy: (id: string | null) => void
  setViewMode: (mode: ViewMode) => void
  begin: () => void
  receive: (frame: CoreFrame, bytes: number, now: number) => void
  fail: (message: string) => void
}

export const useCoreStore = create<CoreState>((set) => ({
  status: 'connecting', frame: null, bytesReceived: 0, lastReceivedAt: null, error: null,
  processIds: [], query: '', selected: null, focusRevision: 0,
  selectedGalaxy: null, layout: emptyLayout, viewMode: 'universe',
  setQuery: query => set(state => ({ query, processIds: reuseIds(state.processIds, matchingIds(state.frame, query)) })),
  select: id => set(state => ({ selected: state.frame?.processes.rows.find(process => process.id === id) ?? null, selectedGalaxy: null, focusRevision: state.focusRevision + 1 })),
  selectGalaxy: id => set(state => ({ selectedGalaxy: state.frame?.processes.galaxies.find(group => group.id === id) ?? null, selected: null, focusRevision: state.focusRevision + 1 })),
  setViewMode: viewMode => set({ viewMode }),
  begin: () => set({ status: 'connecting', frame: null, error: null, bytesReceived: 0, lastReceivedAt: null, processIds: [], selected: null, selectedGalaxy: null, query: '', layout: emptyLayout }),
  receive: (frame, bytes, now) => set(state => {
    if (state.frame?.subscriptionId === frame.subscriptionId && BigInt(state.frame.sequence) >= BigInt(frame.sequence)) return state
    return {
      status: 'connected', frame, bytesReceived: state.bytesReceived + bytes, lastReceivedAt: now, error: null,
      processIds: reuseIds(state.processIds, matchingIds(frame, state.query)),
      selected: frame.processes.rows.find(process => process.id === state.selected?.id) ?? state.selected,
      selectedGalaxy: frame.processes.galaxies.find(group => group.id === state.selectedGalaxy?.id) ?? state.selectedGalaxy,
      layout: buildLayout(frame.processes, state.layout),
    }
  }),
  fail: error => set({ status: 'error', error }),
}))