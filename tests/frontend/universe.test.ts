import { expect, it } from 'vitest'
import { buildLayout, selectLodIds } from '../../apps/desktop/universe/layout'
import { movingCadenceP95, recordSubmission, renderMetrics, stopMovementSampling, submissionP95 } from '../../apps/desktop/universe/metrics'
import { useCoreStore } from '../../apps/desktop/src/state/core'
import { coreFixture, processFixture, galaxyFixture } from './fixtures'

const child = { ...processFixture, id: '43:2', pid: 43, parentPid: 42, parentId: '42:1', parentStatus: 'verified' as const, depth: 1 }
const snapshot = { ...coreFixture.processes, rows: [processFixture, child], galaxies: [{ ...galaxyFixture, processCount: 2, memorySampleCount: 2 }] }

it('lays out only observed processes and keeps members near their native galaxy', () => {
  const layout = buildLayout(snapshot)
  expect(layout.universe.size).toBe(2)
  expect(layout.hierarchy.size).toBe(2)
  expect(layout.hierarchyOrder).toEqual(['42:1', '43:2'])
  const center = layout.galaxyPositions.get(galaxyFixture.id)!
  expect(layout.universe.get(processFixture.id)).toEqual(center)
  const position = layout.universe.get(child.id)!
  expect(Math.hypot(...position.map((value, index) => value - center[index]))).toBeLessThan(4)
})

it('reuses layout on metric-only updates but rebuilds on relationships changing', () => {
  const layout = buildLayout(snapshot)
  expect(buildLayout({ ...snapshot, rows: [{ ...processFixture, cpuPercent: 4, cpuLevel: 6 }, child] }, layout)).toBe(layout)
  expect(buildLayout({ ...snapshot, rows: [processFixture, { ...child, parentId: null, depth: 0 }] }, layout)).not.toBe(layout)
  expect(buildLayout({ ...snapshot, rows: [child, processFixture] }, layout)).not.toBe(layout)
  expect(buildLayout({ ...snapshot, galaxies: [{ ...snapshot.galaxies[0], rootId: child.id }] }, layout)).not.toBe(layout)
})

it('keeps process and galaxy selection exclusive and retains last group data', () => {
  const store = useCoreStore.getState()
  store.begin()
  store.receive({ ...coreFixture, processes: snapshot }, 100, 1000)
  store.selectGalaxy(galaxyFixture.id)
  expect(useCoreStore.getState().selectedGalaxy?.processCount).toBe(2)
  store.select(child.id)
  expect(useCoreStore.getState().selectedGalaxy).toBeNull()
  store.selectGalaxy(galaxyFixture.id)
  store.receive({ ...coreFixture, sequence: '2' }, 100, 2000)
  expect(useCoreStore.getState().selectedGalaxy?.id).toBe(galaxyFixture.id)
  expect(useCoreStore.getState().layout.nodes).toHaveLength(0)
})

it('keeps stable bounded far-field stars while retaining the selected process', () => {
  const ids = Array.from({ length: 10_000 }, (_, index) => `${index + 1}:1`)
  const first = selectLodIds(ids, ids[9999], 1024)
  expect(first).toHaveLength(1024)
  expect(first).toContain(ids[9999])
  expect(new Set(first).size).toBe(1024)
  expect(selectLodIds(ids, ids[9999], 1024)).toEqual(first)
  expect(selectLodIds(ids.slice(0, 100), null, 1024)).toEqual(ids.slice(0, 100))
  const ranked = ids.map(id => {
    let hash = 2166136261
    for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
    return { id, hash: hash >>> 0 }
  }).sort((left, right) => left.hash - right.hash || left.id.localeCompare(right.id))
  const expected = ranked.slice(0, 1024).map(row => row.id)
  expect(selectLodIds(ids, null, 1024)).toEqual(expected)
  expect(selectLodIds([...ids].reverse(), null, 1024)).toEqual(expected)
  expect(selectLodIds(ids, null, 1)).toEqual(expected.slice(0, 1))
  expect(selectLodIds(ids, null, 0)).toEqual([])
})

it('keeps only the latest 4096 CPU submission samples for p95', () => {
  const originalFrames = renderMetrics.frames
  try {
    for (let index = 0; index < 4096; index += 1) {
      renderMetrics.frames += 1
      recordSubmission(1)
    }
    expect(submissionP95()).toBe(1)
    for (let index = 0; index < 4096; index += 1) {
      renderMetrics.frames += 1
      recordSubmission(5)
    }
    expect(submissionP95()).toBe(5)
    expect(renderMetrics.submissionMs).toBe(5)
  } finally {
    renderMetrics.frames = originalFrames
  }
})

it('samples moving frame intervals without treating gaps between drags as frames', () => {
  const originalFrames = renderMetrics.frames
  renderMetrics.cameraMoving = true
  try {
    renderMetrics.frames += 1
    recordSubmission(1, 100)
    renderMetrics.frames += 1
    recordSubmission(1, 116)
    stopMovementSampling()
    renderMetrics.frames += 1
    recordSubmission(1, 1000)
    for (let index = 0; index < 4096; index += 1) {
      renderMetrics.frames += 1
      recordSubmission(1, 1016 + index * 20)
    }
    expect(movingCadenceP95()).toBe(20)
  } finally {
    renderMetrics.cameraMoving = false
    renderMetrics.frames = originalFrames
    stopMovementSampling()
  }
})