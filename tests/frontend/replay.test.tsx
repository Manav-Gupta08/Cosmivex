import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Replay } from '../../apps/desktop/src/Replay'
import { coreFixture } from './fixtures'

vi.mock('../../apps/desktop/universe/ReplayScene', () => ({ ReplayScene: () => null }))
vi.mock('../../apps/desktop/src/transport', () => ({
  readHistorySessions: async () => [{ id: 'recorded-session', startedMs: 1000, endedMs: 2000 }],
  readHistoryCheckpoints: async () => [1000, 2000],
  readHistoryCheckpoint: async (_session: string, atMs: number) => ({ frame: coreFixture, observedMs: atMs, gap: false }),
  readHistoryEvents: async () => [],
}))

it('retains the loaded timeline when the selected session is selected again', async () => {
  render(<Replay close={() => {}} />)
  await screen.findByRole('complementary', { name: 'Recorded details' })
  fireEvent.change(screen.getByRole('combobox', { name: 'History session' }), { target: { value: 'recorded-session' } })
  await waitFor(() => expect(screen.getByRole('complementary', { name: 'Recorded details' })).toBeVisible())
  expect(screen.getByRole('slider', { name: 'Replay checkpoint' })).toBeEnabled()
})