import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Shell from '../../apps/desktop/src/Shell'
import { Diagnostics } from '../../apps/desktop/src/Diagnostics'
import * as metrics from '../../apps/desktop/universe/metrics'
import { useCoreStore } from '../../apps/desktop/src/state/core'
import { coreFixture, processFixture, galaxyFixture, networkFixture, connectionFixture, filesystemFixture, fileFixture } from './fixtures'

vi.mock('../../apps/desktop/universe/Scene', () => ({
  UniverseScene: () => <div aria-label="Test viewport" />,
}))
vi.mock('../../apps/desktop/src/Replay', () => ({
  Replay: ({ close }: { close: () => void }) => <main aria-label="Historical replay"><button onClick={close}>Return to live</button></main>,
}))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); useCoreStore.getState().setViewMode('universe') })

it('samples frame percentiles only on the diagnostics refresh', () => {
  vi.useFakeTimers()
  useCoreStore.getState().fail('Browser preview')
  const percentiles = [vi.spyOn(metrics, 'frameCpuP95'), vi.spyOn(metrics, 'gpuP95'), vi.spyOn(metrics, 'frameWorkP95'), vi.spyOn(metrics, 'completionP95')]
  const view = render(<Diagnostics close={() => {}} />)
  for (let index = 0; index < 20; index++) view.rerender(<Diagnostics close={() => {}} />)
  for (const percentile of percentiles) expect(percentile).toHaveBeenCalledTimes(1)
  act(() => vi.advanceTimersByTime(1000))
  for (const percentile of percentiles) expect(percentile).toHaveBeenCalledTimes(2)
  view.unmount()
  act(() => vi.advanceTimersByTime(1000))
  for (const percentile of percentiles) expect(percentile).toHaveBeenCalledTimes(2)
})

it('does not fabricate telemetry or enable native profiles in a browser', async () => {
  render(<Shell />)
  await screen.findByLabelText('Test viewport')
  expect(screen.getByRole('status')).toHaveTextContent('Browser preview')
  expect(screen.getByRole('button', { name: 'Eco profile' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Historical replay' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Native core unavailable')
  expect(screen.getByRole('contentinfo')).toHaveTextContent('History opt-in')
  expect(screen.getByRole('contentinfo')).not.toHaveTextContent('History off')
})

it('opens and closes factual diagnostics', async () => {
  render(<Shell />)
  await screen.findByLabelText('Test viewport')
  fireEvent.click(screen.getByRole('button', { name: 'Engine diagnostics' }))
  expect(screen.getByRole('complementary')).toBeInTheDocument()
  expect(screen.getByTestId('sequence')).toHaveTextContent('Unavailable')
  expect(screen.getByRole('checkbox', { name: 'Record local history' })).toBeDisabled()
  expect(screen.getByRole('complementary')).toHaveTextContent('History off')
  fireEvent.click(screen.getByRole('button', { name: 'Close diagnostics' }))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Engine diagnostics' })).toHaveFocus()
})

it.each([
  ['Process list', 'Close process list'],
  ['Galaxy list', 'Close galaxy list'],
  ['Recent activity', 'Close activity'],
])('returns focus to %s when its panel closes', async (trigger, close) => {
  render(<Shell />)
  await screen.findByLabelText('Test viewport')
  fireEvent.click(screen.getByRole('button', { name: trigger }))
  fireEvent.click(screen.getByRole('button', { name: close }))
  expect(screen.getByRole('button', { name: trigger })).toHaveFocus()
})

it('returns focus to the process list when closing process details', async () => {
  render(<Shell />)
  await screen.findByLabelText('Test viewport')
  const store = useCoreStore.getState()
  store.receive({ ...coreFixture, processes: { ...coreFixture.processes, rows: [processFixture], galaxies: [galaxyFixture] } }, 100, 1000)
  store.select(processFixture.id)
  const close = await screen.findByRole('button', { name: 'Close process details' })
  close.focus()
  fireEvent.click(close)
  expect(screen.getByRole('button', { name: 'Process list' })).toHaveFocus()
})

it.each([
  ['universe', 'galaxy', 'Close galaxy details', 'Galaxy list'],
  ['network', 'connection', 'Close network details', 'Network list'],
  ['filesystem', 'file', 'Close file details', 'Filesystem list'],
] as const)('returns focus after closing %s details', async (mode, selection, closeLabel, triggerLabel) => {
  render(<Shell />)
  await screen.findByLabelText('Test viewport')
  const store = useCoreStore.getState()
  store.receive({ ...coreFixture, processes: { ...coreFixture.processes, rows: [processFixture], galaxies: [galaxyFixture] }, network: networkFixture, filesystem: filesystemFixture }, 100, 1000)
  store.setViewMode(mode)
  if (selection === 'galaxy') store.selectGalaxy(galaxyFixture.id)
  else if (selection === 'connection') store.selectConnection(connectionFixture.id)
  else store.selectFile(fileFixture.id)
  const close = await screen.findByRole('button', { name: closeLabel })
  close.focus()
  fireEvent.click(close)
  expect(screen.getByRole('button', { name: triggerLabel })).toHaveFocus()
})

it('returns focus to Historical replay after leaving recorded mode', async () => {
  render(<Shell />)
  await screen.findByLabelText('Test viewport')
  act(() => {
    const store = useCoreStore.getState()
    store.begin()
    store.receive({ ...coreFixture, subscriptionId: 42, sequence: '42' }, 100, 1000)
  })
  const replay = screen.getByRole('button', { name: 'Historical replay' })
  expect(replay).toBeEnabled()
  fireEvent.click(replay)
  const close = await screen.findByRole('button', { name: 'Return to live' })
  close.focus()
  fireEvent.click(close)
  expect(await screen.findByRole('button', { name: 'Historical replay' })).toHaveFocus()
})