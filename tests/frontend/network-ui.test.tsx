import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NetworkBrowser, NetworkInspector } from '../../apps/desktop/src/Network'
import { useCoreStore } from '../../apps/desktop/src/state/core'
import { coreFixture, networkFixture, processFixture, galaxyFixture } from './fixtures'

beforeEach(() => {
  const store = useCoreStore.getState()
  store.begin()
  store.receive({ ...coreFixture, network: networkFixture, processes: { ...coreFixture.processes, rows: [processFixture], galaxies: [galaxyFixture] } }, 100, 1000)
})
afterEach(cleanup)

it('inspects real endpoint fields without claiming per-connection traffic', () => {
  render(<NetworkBrowser close={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'TCP 127.0.0.1:45000 to 127.0.0.1:45001, PID 42' }))
  cleanup()
  render(<NetworkInspector />)
  expect(screen.getByTestId('network-state')).toHaveTextContent('ESTABLISHED')
  expect(screen.getByTestId('network-remote')).toHaveTextContent('127.0.0.1:45001')
  expect(screen.getByText('Not available')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open process (42)' }))
  expect(useCoreStore.getState().selected?.id).toBe(processFixture.id)
})

it('does not link an owner after PID reuse and retains vanished observation', () => {
  const store = useCoreStore.getState()
  store.selectConnection('n:1')
  store.receive({ ...coreFixture, sequence: '2', network: { ...networkFixture, connections: [] } }, 100, 2000)
  render(<NetworkInspector />)
  expect(screen.getByTestId('network-status')).toHaveTextContent('No longer observed')
  expect(screen.queryByRole('button', { name: 'Open process (42)' })).not.toBeInTheDocument()
})