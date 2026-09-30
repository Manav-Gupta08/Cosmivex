import { expect, it, vi } from 'vitest'
import { processSchema } from '../../shared/protocol/core'
import { eventSchema } from '../../shared/protocol/stream'
import { processFixture } from './fixtures'
import { BufferAttribute, BufferGeometry } from 'three'
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js'
import { WebGLGeometries } from 'three/src/renderers/webgl/WebGLGeometries.js'
import { resourceAppearance, updateResourceLevels, mergeUpdateRange, updateLineGeometry } from '../../apps/desktop/universe/resources'
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

it('keeps sparse GPU edits small and caps pending update ranges for hidden windows', () => {
  const attribute = new BufferAttribute(new Float32Array(160), 16)
  mergeUpdateRange(attribute, 16, 16)
  mergeUpdateRange(attribute, 96, 16)
  mergeUpdateRange(attribute, 32, 16)
  expect(attribute.updateRanges).toEqual([{ start: 16, count: 32 }, { start: 96, count: 16 }])
  const busy = new BufferAttribute(new Float32Array(3200), 16)
  for (let index = 0; index < 12; index++) mergeUpdateRange(busy, index * 64, 16)
  expect(busy.updateRanges.length).toBeLessThanOrEqual(8)
  expect(busy.updateRanges[0].start).toBe(0)
  expect(busy.updateRanges.at(-1)!.start + busy.updateRanges.at(-1)!.count).toBe(720)
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

it('reuses line buffers and deletes every uploaded buffer across resizing and disposal', () => {
  const gl = { createBuffer: vi.fn(() => ({})), deleteBuffer: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(), bufferSubData: vi.fn(), ARRAY_BUFFER: 34962, FLOAT: 5126 }
  const attributes = new WebGLAttributes(gl as unknown as WebGLRenderingContext)
  const info = { memory: { geometries: 0 } }
  const geometries = Reflect.construct(WebGLGeometries, [gl, attributes, info, { releaseStatesOfGeometry: vi.fn() }]) as InstanceType<typeof WebGLGeometries>
  const geometry = new BufferGeometry()
  const upload = () => { geometries.get({} as never, geometry); geometries.update(geometry) }
  updateLineGeometry(geometry, [0, 0, 0, 1, 1, 1], [1, 0, 0, 1, 0, 0])
  upload()
  const position = geometry.getAttribute('position')
  updateLineGeometry(geometry, [2, 2, 2, 3, 3, 3], [0, 1, 0, 0, 1, 0])
  upload()
  expect(geometry.getAttribute('position')).toBe(position)
  expect(gl.createBuffer).toHaveBeenCalledTimes(2)
  expect(gl.bufferSubData).toHaveBeenCalledTimes(2)
  for (let count = 0; count < 100; count++) {
    updateLineGeometry(geometry, new Array(count * 6).fill(1))
    upload()
  }
  geometry.dispose()
  expect(info.memory.geometries).toBe(0)
  expect(gl.deleteBuffer.mock.calls.length).toBe(gl.createBuffer.mock.calls.length)
})