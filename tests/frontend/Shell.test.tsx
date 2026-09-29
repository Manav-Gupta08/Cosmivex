import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Shell from '../../apps/desktop/src/Shell'

vi.mock('../../apps/desktop/universe/Scene', () => ({
  UniverseScene: () => <div aria-label="Test viewport" />,
}))
afterEach(cleanup)

it('does not fabricate telemetry or enable native profiles in a browser', async () => {
  render(<Shell />)
  await screen.findByLabelText('Test viewport')
  expect(screen.getByRole('status')).toHaveTextContent('Browser preview')
  expect(screen.getByRole('button', { name: 'Eco profile' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Historical replay' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Native core unavailable')
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
})