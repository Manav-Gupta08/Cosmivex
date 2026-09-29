import { beforeEach, describe, expect, it } from 'vitest'
import { coreFrameSchema, parseHistoricalCheckpoint, processSnapshotSchema } from '../../shared/protocol/core'
import { useCoreStore } from '../../apps/desktop/src/state/core'
import { coreFixture as fixture, processFixture, galaxyFixture } from './fixtures'

describe('native wire contract and latest-state store', () => {
  beforeEach(() => useCoreStore.getState().begin())
  it('accepts compatible bounded health messages', () => {
    expect(coreFrameSchema.parse(fixture)).toEqual(fixture)
  })
  it('validates replay checkpoints without altering live observations', () => {
    const state = { health: (({ network, filesystem, subscriptionId, ...health }) => health)(fixture), network: fixture.network, filesystem: fixture.filesystem }
    const input = { sequence: 1, observedMs: fixture.observedAtUnixMs, state }
    expect(parseHistoricalCheckpoint(input).frame).toEqual(fixture)
    expect(useCoreStore.getState().frame).toBeNull()
    for (const invalid of [
      { ...input, sequence: 2 },
      { ...input, observedMs: input.observedMs + 1 },
      { ...input, state: { ...state, network: { ...state.network, tableErrors: [0] } } },
      { ...input, state: { ...state, health: { ...state.health, protocolVersion: 6 } } },
    ]) expect(() => parseHistoricalCheckpoint(invalid)).toThrow()
  })
  it('rejects incompatible versions, invalid profiles, unsafe numbers and fake collectors', () => {
    for (const patch of [{ protocolVersion: 1 }, { profile: 'turbo' }, { uptimeMs: NaN }, { enabledCollectors: 1 }, { sequence: '18446744073709551616' }, { sequence: 'invalid' }, { sequence: '' }, { sequence: '-1' }, { profile: 'eco' }, { uptimeMs: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(coreFrameSchema.safeParse({ ...fixture, ...patch }).success).toBe(false)
    }
  })
  it('accepts null process measurements but rejects invalid CPU and duplicate identities', () => {
    expect(processSnapshotSchema.safeParse({ ...fixture.processes, rows: [processFixture], galaxies: [galaxyFixture] }).success).toBe(true)
    expect(processSnapshotSchema.safeParse({ ...fixture.processes, rows: [{ ...processFixture, cpuPercent: 101 }] }).success).toBe(false)
    expect(processSnapshotSchema.safeParse({ ...fixture.processes, rows: [processFixture, processFixture] }).success).toBe(false)
  })
  it('rejects dangling parents, inconsistent membership and graph cycles', () => {
    const valid = { ...fixture.processes, rows: [processFixture], galaxies: [galaxyFixture] }
    expect(processSnapshotSchema.safeParse({ ...valid, rows: [{ ...processFixture, parentId: '99:1', parentStatus: 'verified', depth: 1 }] }).success).toBe(false)
    expect(processSnapshotSchema.safeParse({ ...valid, galaxies: [{ ...galaxyFixture, processCount: 2 }] }).success).toBe(false)
    expect(processSnapshotSchema.safeParse({ ...valid, rows: [{ ...processFixture, parentId: processFixture.id, parentStatus: 'verified', depth: 1 }] }).success).toBe(false)
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