import { expect, it, vi } from 'vitest'
import { GpuTimer } from '../../apps/desktop/universe/gpu-timer'

it('bounds pending GPU queries, polls without blocking, and deletes every query', () => {
  let available = false
  let disjoint = false
  const context = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    getExtension: () => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 }),
    isContextLost: () => false,
    getParameter: () => disjoint,
    createQuery: vi.fn(() => ({})), beginQuery: vi.fn(), endQuery: vi.fn(), deleteQuery: vi.fn(),
    getQueryParameter: (_query: unknown, field: number) => field === 1 ? available : 2e6,
  }
  const record = vi.fn()
  const timer = new GpuTimer(context as unknown as WebGL2RenderingContext, record)
  for (let index = 0; index < 20; index++) { timer.begin(performance.now()); timer.end() }
  expect(context.createQuery).toHaveBeenCalledTimes(4)
  expect(record).not.toHaveBeenCalled()
  available = true
  timer.begin(performance.now())
  timer.end()
  expect(record).toHaveBeenCalledTimes(4)
  expect(record).toHaveBeenCalledWith(2, expect.any(Number), expect.any(Number))
  disjoint = true
  timer.begin(performance.now())
  expect(context.deleteQuery).toHaveBeenCalledTimes(5)
  timer.dispose()
  expect(context.deleteQuery).toHaveBeenCalledTimes(5)
})

it('does not submit queries when GPU timers are unavailable', () => {
  const context = { getExtension: () => null, createQuery: vi.fn() }
  const timer = new GpuTimer(context as unknown as WebGL2RenderingContext, vi.fn())
  expect(timer.supported).toBe(false)
  timer.begin(0)
  timer.end()
  timer.dispose()
  expect(context.createQuery).not.toHaveBeenCalled()
})