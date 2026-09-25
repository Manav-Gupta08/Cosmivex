import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { connectCore } from '../../apps/desktop/src/transport'
import { useCoreStore } from '../../apps/desktop/src/state/core'
import { coreFixture, packetFixture, chunkFixture } from './fixtures'

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
const fixture = { ...coreFixture, subscriptionId: 7 }

beforeEach(() => {
  vi.useFakeTimers()
  mock.invoke.mockReset().mockResolvedValue(7)
})
afterEach(() => { vi.useRealTimers() })

it('acknowledges validated frames and reports a stalled native stream', async () => {
  const dispose = connectCore()
  await Promise.resolve()
  mock.channel?.onmessage(chunkFixture(packetFixture(fixture)))
  expect(mock.invoke).toHaveBeenCalledWith('ack_core', { subscriptionId: 7, transferId: '1', chunkIndex: 0 })
  expect(useCoreStore.getState().status).toBe('connected')
  await vi.advanceTimersByTimeAsync(6000)
  expect(useCoreStore.getState().status).toBe('stale')
  mock.channel?.onmessage(chunkFixture(packetFixture({ ...fixture, sequence: '2' }), '2'))
  expect(useCoreStore.getState().status).toBe('connected')
  dispose()
  expect(mock.invoke).toHaveBeenCalledWith('unsubscribe_core', { subscriptionId: 7 })
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects malformed frames without acknowledging or crashing', async () => {
  const dispose = connectCore()
  await Promise.resolve()
  mock.channel?.onmessage({ ...chunkFixture(packetFixture(fixture)), transferId: 'invalid' })
  expect(useCoreStore.getState().status).toBe('error')
  expect(useCoreStore.getState().frame).toBeNull()
  expect(mock.invoke).not.toHaveBeenCalledWith('ack_core', expect.anything())
  dispose()
})

it('cleans up a subscription that resolves after disposal', async () => {
  let finish: ((id: number) => void) | undefined
  mock.invoke.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve }))
  const dispose = connectCore()
  await Promise.resolve()
  dispose()
  finish?.(7)
  await Promise.resolve()
  expect(mock.invoke).toHaveBeenCalledWith('unsubscribe_core', { subscriptionId: 7 })
  mock.channel?.onmessage(chunkFixture(packetFixture(fixture)))
  expect(useCoreStore.getState().frame).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('surfaces native initialization failures', async () => {
  mock.invoke.mockRejectedValueOnce(new Error('Core initialization failed'))
  const dispose = connectCore()
  await vi.advanceTimersByTimeAsync(0)
  expect(useCoreStore.getState().error).toContain('Core initialization failed')
  dispose()
})

it('resynchronizes a wrong delta base without changing visible state', async () => {
  const dispose = connectCore()
  await Promise.resolve()
  mock.channel?.onmessage(chunkFixture(packetFixture(fixture)))
  const prior = useCoreStore.getState().frame
  const wrong = { ...packetFixture({ ...fixture, sequence: '9' }), kind: 'delta' as const, baseSequence: '8' }
  mock.channel?.onmessage(chunkFixture(wrong, '2'))
  expect(useCoreStore.getState().frame).toBe(prior)
  expect(mock.invoke).toHaveBeenCalledWith('resync_core', { subscriptionId: 7 })
  mock.channel?.onmessage(chunkFixture(packetFixture({ ...fixture, sequence: '10' }), '3'))
  expect(useCoreStore.getState().status).toBe('connected')
  expect(useCoreStore.getState().frame?.sequence).toBe('10')
  dispose()
})

it('acknowledges intermediate chunks but applies only the complete packet', async () => {
  const dispose = connectCore()
  await Promise.resolve()
  const chunk = chunkFixture(packetFixture(fixture))
  const middle = Math.floor(chunk.payload.length / 2)
  mock.channel?.onmessage({ ...chunk, payload: chunk.payload.slice(0, middle), chunkCount: 2 })
  expect(useCoreStore.getState().frame).toBeNull()
  expect(mock.invoke).toHaveBeenCalledWith('ack_core', { subscriptionId: 7, transferId: '1', chunkIndex: 0 })
  mock.channel?.onmessage({ ...chunk, payload: chunk.payload.slice(middle), chunkIndex: 1, chunkCount: 2 })
  expect(useCoreStore.getState().frame?.sequence).toBe('1')
  dispose()
})