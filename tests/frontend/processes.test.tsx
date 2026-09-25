import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProcessBrowser, ProcessInspector } from '../../apps/desktop/src/Processes'
import { useCoreStore } from '../../apps/desktop/src/state/core'
import { processPosition } from '../../apps/desktop/universe/layout'
import { coreFixture, processFixture, galaxyFixture } from './fixtures'

beforeEach(() => {
  useCoreStore.getState().begin()
  useCoreStore.getState().receive({ ...coreFixture, enabledCollectors: 1, intervalMs: 1000, processes: { ...coreFixture.processes, observedAtUnixMs: 1790000000000, rows: [processFixture], galaxies: [galaxyFixture] } }, 100, 1000)
})
afterEach(cleanup)

it('keeps instance identities unchanged across metric-only updates', () => {
  const before = useCoreStore.getState()
  before.receive({ ...before.frame!, sequence: '2', processes: { ...before.frame!.processes, rows: [{ ...processFixture, cpuPercent: 5, cpuLevel: 7 }] } }, 100, 2000)
  expect(useCoreStore.getState().processIds).toBe(before.processIds)
  expect(processPosition(processFixture.id)).toEqual(processPosition(processFixture.id))
})

it('searches names and PIDs and selects exact observed data', () => {
  useCoreStore.getState().setQuery('42')
  render(<ProcessBrowser close={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'fixture.exe' }))
  expect(useCoreStore.getState().selected?.pid).toBe(42)
  cleanup()
  render(<ProcessInspector />)
  expect(screen.getByTestId('process-cpu')).toHaveTextContent('Unavailable')
  expect(screen.getByTestId('process-memory')).toHaveTextContent('1 MiB')
})

it('preserves the selected last observation after a process disappears', () => {
  const store = useCoreStore.getState()
  store.select(processFixture.id)
  store.receive({ ...store.frame!, sequence: '2', processes: { ...store.frame!.processes, rows: [], galaxies: [] } }, 100, 2000)
  render(<ProcessInspector />)
  expect(screen.getByTestId('process-status')).toHaveTextContent('No longer observed')
  expect(screen.getByTestId('process-pid')).toHaveTextContent('42')
})

it('limits the process list DOM to 50 records per page', () => {
  const store = useCoreStore.getState()
  const rows = Array.from({ length: 120 }, (_, index) => ({ ...processFixture, id: `${index}:1`, galaxyId: `g:${index}:1`, pid: index, name: `fixture-${index}.exe` }))
  const galaxies = rows.map(row => ({ ...galaxyFixture, id: row.galaxyId, rootId: row.id, label: row.name }))
  store.receive({ ...store.frame!, sequence: '2', processes: { ...store.frame!.processes, rows, galaxies } }, 100, 2000)
  render(<ProcessBrowser close={() => {}} />)
  expect(screen.getAllByRole('row')).toHaveLength(51)
  fireEvent.click(screen.getByRole('button', { name: 'Next processes' }))
  expect(screen.getAllByRole('row')).toHaveLength(51)
})