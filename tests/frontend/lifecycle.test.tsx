import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useCoreStore } from '../../apps/desktop/src/state/core'
import { Activity } from '../../apps/desktop/src/Activity'
import { coreFixture, processFixture, galaxyFixture, packetFixture } from './fixtures'
import type { ProcessEvent } from '../../shared/protocol/stream'

const event: ProcessEvent = { sequence: '1', observedAtUnixMs: coreFixture.observedAtUnixMs, previousObservedAtUnixMs: coreFixture.observedAtUnixMs - 1000,
  monotonicNs: '1', processId: '42:1', pid: 42, kind: 'PROCESS_CREATED', reason: 'observation', name: 'fixture.exe' }
const frame = { ...coreFixture, enabledCollectors: 1 as const, intervalMs: 1000 as const,
  processes: { ...coreFixture.processes, rows: [processFixture], galaxies: [galaxyFixture] } }
beforeEach(() => useCoreStore.getState().begin())
afterEach(cleanup)

it('does not animate baseline/replayed snapshot observations', () => {
  const packet = { ...packetFixture(frame), events: { throughSequence: '1', evictedCount: '0', gapCount: '0', rows: [event] } }
  useCoreStore.getState().receive(frame, 100, 1000, packet)
  expect(useCoreStore.getState().effects).toHaveLength(0)
  render(<Activity close={() => {}} />)
  expect(screen.getByText('First observed')).toBeInTheDocument()
})

it('uses observed positions for bounded birth/death effects and stays idle otherwise', () => {
  const store = useCoreStore.getState()
  store.receive(coreFixture, 100, 1000, packetFixture())
  const next = { ...frame, sequence: '2' }
  const packet = { ...packetFixture(next), kind: 'delta' as const, baseSequence: '1', events: { throughSequence: '1', evictedCount: '0', gapCount: '0', rows: [event] } }
  store.receive(next, 100, 2000, packet)
  expect(useCoreStore.getState().effects[0].kind).toBe('PROCESS_CREATED')
  const final = { ...coreFixture, enabledCollectors: 1 as const, intervalMs: 1000 as const, sequence: '3' }
  store.receive(final, 100, 3000, { ...packetFixture(final), kind: 'delta', baseSequence: '2', events: { ...packet.events, throughSequence: '2', rows: [{ ...event, sequence: '2', kind: 'PROCESS_TERMINATED' }] } })
  expect(useCoreStore.getState().effects[0].kind).toBe('PROCESS_TERMINATED')
  store.receive({ ...final, sequence: '4' }, 100, 5000)
  const effects = useCoreStore.getState().effects
  store.receive({ ...final, sequence: '5' }, 100, 6000)
  expect(useCoreStore.getState().effects).toBe(effects)
})

it('suppresses effects across gaps and bounds the journal', () => {
  const store = useCoreStore.getState()
  store.receive(coreFixture, 100, 1000)
  const rows = Array.from({ length: 256 }, (_, index) => ({ ...event, sequence: String(index + 2) }))
  store.receive({ ...frame, sequence: '2' }, 100, 2000, { ...packetFixture(frame), kind: 'delta', baseSequence: '1', events: { throughSequence: '257', evictedCount: '1', gapCount: '1', rows } })
  expect(useCoreStore.getState().events).toHaveLength(256)
  expect(useCoreStore.getState().effects).toHaveLength(0)
  expect(useCoreStore.getState().missedEvents).toBe('1')
})

it('counts an explicit same-sequence full resync without rebuilding layout', () => {
  const store = useCoreStore.getState()
  store.receive(frame, 100, 1000, packetFixture(frame))
  const layout = useCoreStore.getState().layout
  store.receive(frame, 100, 2000, packetFixture(frame))
  expect(useCoreStore.getState().fullSnapshots).toBe(2)
  expect(useCoreStore.getState().layout).toBe(layout)
})