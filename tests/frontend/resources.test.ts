import { expect, it } from 'vitest'
import { processSchema } from '../../shared/protocol/core'
import { eventSchema } from '../../shared/protocol/stream'
import { processFixture } from './fixtures'
import { BufferAttribute } from 'three'
import { resourceAppearance, updateResourceLevels, mergeUpdateRange } from '../../apps/desktop/universe/resources'
import { useCoreStore } from '../../apps/desktop/src/state/core'
import { coreFixture, galaxyFixture } from './fixtures'

it('requires visual availability to agree with real measurements', () => {
  expect(processSchema.safeParse(processFixture).success).toBe(true)
  expect(processSchema.safeParse({ ...processFixture, cpuLevel: 0 }).success).toBe(false)
  expect(processSchema.safeParse({ ...processFixture, memoryLevel: null }).success).toBe(false)
  expect(processSchema.safeParse({ ...processFixture, cpuPercent: 0, cpuLevel: 0 }).success).toBe(true)
  expect(processSchema.safeParse({ ...processFixture, memoryLevel: 32 }).success).toBe(false)
})

it('requires a measured spike value, policy threshold and process identity', () => {
  const event = { sequence: '1', observedAtUnixMs: 1000, previousObservedAtUnixMs: 0, monotonicNs: '1', processId: '42:1', pid: 42,
    kind: 'RESOURCE_SPIKE', reason: 'cpu-sustained', name: 'fixture.exe', resourceValue: 12, resourceThreshold: 10 }
  expect(eventSchema.safeParse(event).success).toBe(true)
  expect(eventSchema.safeParse({ ...event, resourceValue: null }).success).toBe(false)
  expect(eventSchema.safeParse({ ...event, resourceValue: 4 }).success).toBe(false)
  expect(eventSchema.safeParse({ ...event, processId: null }).success).toBe(false)
})

it('reuses visual state for metric-only changes within native levels', () => {
  const first = updateResourceLevels(new Map(), [{ ...processFixture, cpuPercent: 0, cpuLevel: 0 }])
  expect(updateResourceLevels(first, [{ ...processFixture, cpuPercent: 0.001, cpuLevel: 0 }])).toBe(first)
  expect(updateResourceLevels(first, [{ ...processFixture, cpuPercent: 5, cpuLevel: 7 }])).not.toBe(first)
  expect(updateResourceLevels(first, []).size).toBe(0)
})

it('maps native levels to bounded appearance without treating unknown as idle', () => {
  const idle = resourceAppearance({ cpuLevel: 0, memoryLevel: 0 }, true)
  const active = resourceAppearance({ cpuLevel: 31, memoryLevel: 31 }, true)
  const unknown = resourceAppearance({ cpuLevel: null, memoryLevel: null }, true)
  expect(active.scale).toBe(3)
  expect(active.intensity).toBeGreaterThan(idle.intensity)
  expect(unknown.memoryKnown).toBe(false)
  expect(unknown.intensity).not.toBe(idle.intensity)
  expect(resourceAppearance({ cpuLevel: 31, memoryLevel: 31 }, false).scale).toBe(1)
})

it('merges pending GPU edits so hidden windows neither lose changes nor grow an update queue', () => {
  const attribute = new BufferAttribute(new Float32Array(160), 16)
  mergeUpdateRange(attribute, 16, 16)
  mergeUpdateRange(attribute, 96, 16)
  mergeUpdateRange(attribute, 32, 16)
  expect(attribute.updateRanges).toEqual([{ start: 16, count: 96 }])
})

it('does not relayout the universe when native visual levels change', () => {
  const store = useCoreStore.getState()
  store.begin()
  store.receive({ ...coreFixture, processes: { ...coreFixture.processes, rows: [processFixture], galaxies: [galaxyFixture] } }, 100, 1000)
  const before = useCoreStore.getState()
  store.receive({ ...before.frame!, sequence: '2', processes: { ...before.frame!.processes, rows: [{ ...processFixture, cpuPercent: 25, cpuLevel: 16 }] } }, 100, 2000)
  expect(useCoreStore.getState().layout).toBe(before.layout)
  expect(useCoreStore.getState().resourceLevels).not.toBe(before.resourceLevels)
  store.setResourceVisuals(false)
  expect(useCoreStore.getState().frame?.processes.rows[0].cpuPercent).toBe(25)
  store.setResourceVisuals(true)
})