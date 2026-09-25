import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { connectCore } from '../../apps/desktop/src/transport'
import { useCoreStore } from '../../apps/desktop/src/state/core'

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  channel: undefined as { onmessage: (value: unknown) => void } | undefined,
}))
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: mock.invoke,
  Channel: class {
    onmessage = (_value: unknown) => {}
    constructor() { mock.channel = this }
  },
}))
const fixture = { subscriptionId: 7, protocolVersion: 1, abiVersion: 1, sequence: '1', uptimeMs: 0, observedAtUnixMs: 1790000000000, intervalMs: 2000, profile: 'normal', enabledCollectors: 0 }

beforeEach(() => {
  vi.useFakeTimers()
  mock.invoke.mockReset().mockResolvedValue(7)
})
afterEach(() => { vi.useRealTimers() })

it('acknowledges validated frames and reports a stalled native stream', async () => {
  const dispose = connectCore()
  await Promise.resolve()
  mock.channel?.onmessage(fixture)
  expect(mock.invoke).toHaveBeenCalledWith('ack_core', { subscriptionId: 7, sequence: '1' })
  expect(useCoreStore.getState().status).toBe('connected')
  await vi.advanceTimersByTimeAsync(6000)
  expect(useCoreStore.getState().status).toBe('stale')
  mock.channel?.onmessage({ ...fixture, sequence: '2' })
  expect(useCoreStore.getState().status).toBe('connected')
  dispose()
  expect(mock.invoke).toHaveBeenCalledWith('unsubscribe_core', { subscriptionId: 7 })
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects malformed frames without acknowledging or crashing', async () => {
  const dispose = connectCore()
  await Promise.resolve()
  mock.channel?.onmessage({ ...fixture, sequence: 'invalid' })
  expect(useCoreStore.getState().status).toBe('error')
  expect(useCoreStore.getState().frame).toBeNull()
  expect(mock.invoke).not.toHaveBeenCalledWith('ack_core', expect.anything())
  dispose()
})

it('cleans up a subscription that resolves after disposal', async () => {
  let finish: ((id: number) => void) | undefined
  mock.invoke.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve }))
  const dispose = connectCore()
  dispose()
  finish?.(7)
  await Promise.resolve()
  expect(mock.invoke).toHaveBeenCalledWith('unsubscribe_core', { subscriptionId: 7 })
  mock.channel?.onmessage(fixture)
  expect(useCoreStore.getState().frame).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('surfaces native initialization failures', async () => {
  mock.invoke.mockRejectedValueOnce(new Error('Core initialization failed'))
  const dispose = connectCore()
  await Promise.resolve()
  await Promise.resolve()
  expect(useCoreStore.getState().error).toContain('Core initialization failed')
  dispose()
})