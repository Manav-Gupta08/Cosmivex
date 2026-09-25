import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GalaxyBrowser, GalaxyInspector } from '../../apps/desktop/src/Galaxies'
import { ProcessInspector } from '../../apps/desktop/src/Processes'
import { useCoreStore } from '../../apps/desktop/src/state/core'
import { coreFixture, galaxyFixture, processFixture } from './fixtures'

beforeEach(() => {
  const store = useCoreStore.getState()
  store.begin()
  store.receive({ ...coreFixture, enabledCollectors: 1, intervalMs: 1000, processes: { ...coreFixture.processes, rows: [processFixture], galaxies: [galaxyFixture] } }, 100, 1000)
})
afterEach(cleanup)

it('selects a galaxy and shows factual aggregates and the observed executable', () => {
  render(<GalaxyBrowser close={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'fixture.exe' }))
  cleanup()
  render(<GalaxyInspector />)
  expect(screen.getByTestId('galaxy-status')).toHaveTextContent('Inferred galaxy')
  expect(screen.getByTestId('galaxy-root-pid')).toHaveTextContent('42')
  expect(screen.getByText('C:\\test\\fixture.exe')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'fixture.exe, PID 42' }))
  expect(useCoreStore.getState().selected?.pid).toBe(42)
})

it('navigates from process details to its native galaxy', () => {
  useCoreStore.getState().select(processFixture.id)
  render(<ProcessInspector />)
  fireEvent.click(screen.getByRole('button', { name: 'Open galaxy' }))
  expect(useCoreStore.getState().selectedGalaxy?.id).toBe(galaxyFixture.id)
})

it('keeps a vanished galaxy labeled as its last observation', () => {
  const store = useCoreStore.getState()
  store.selectGalaxy(galaxyFixture.id)
  store.receive({ ...coreFixture, enabledCollectors: 1, intervalMs: 1000, sequence: '2' }, 100, 2000)
  render(<GalaxyInspector />)
  expect(screen.getByTestId('galaxy-status')).toHaveTextContent('No longer observed')
})