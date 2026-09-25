import { beforeEach, describe, expect, it } from 'vitest'
import { coreFrameSchema, type CoreFrame } from '../../shared/protocol/core'
import { useCoreStore } from '../../apps/desktop/src/state/core'

const fixture: CoreFrame = { subscriptionId: 1, protocolVersion: 1, abiVersion: 1, sequence: '1', uptimeMs: 0, observedAtUnixMs: 1790000000000, intervalMs: 2000, profile: 'normal', enabledCollectors: 0 }

describe('native wire contract and latest-state store', () => {
  beforeEach(() => useCoreStore.getState().begin())
  it('accepts compatible bounded health messages', () => {
    expect(coreFrameSchema.parse(fixture)).toEqual(fixture)
  })
  it('rejects incompatible versions, invalid profiles, unsafe numbers and fake collectors', () => {
    for (const patch of [{ protocolVersion: 2 }, { profile: 'turbo' }, { uptimeMs: NaN }, { enabledCollectors: 1 }, { sequence: '18446744073709551616' }, { sequence: 'invalid' }, { sequence: '' }, { sequence: '-1' }, { profile: 'eco' }, { uptimeMs: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(coreFrameSchema.safeParse({ ...fixture, ...patch }).success).toBe(false)
    }
  })
  it('ignores duplicate and reordered frames without extra updates', () => {
    const store = useCoreStore.getState()
    store.receive({ ...fixture, sequence: '9007199254740993' }, 100, 1000)
    const current = useCoreStore.getState()
    store.receive({ ...fixture, sequence: '9007199254740992' }, 100, 2000)
    expect(useCoreStore.getState()).toBe(current)
    expect(useCoreStore.getState().bytesReceived).toBe(100)
  })
  it('accepts a new subscription and retains last data with an explicit error', () => {
    const store = useCoreStore.getState()
    store.receive({ ...fixture, sequence: '20' }, 100, 1000)
    store.receive({ ...fixture, subscriptionId: 2 }, 100, 2000)
    expect(useCoreStore.getState().frame?.sequence).toBe('1')
    store.fail('Disconnected')
    expect(useCoreStore.getState().status).toBe('error')
    expect(useCoreStore.getState().frame).not.toBeNull()
  })
})