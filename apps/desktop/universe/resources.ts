import { BufferAttribute, type BufferGeometry } from 'three'
import type { ProcessRecord } from '../../../shared/protocol/core'

export interface ResourceLevels { cpuLevel: number | null; memoryLevel: number | null }

export function updateLineGeometry(geometry: BufferGeometry, positions: number[], colors?: number[]) {
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color')
  if (position instanceof BufferAttribute && position.array.length === positions.length
    && (colors ? color instanceof BufferAttribute && color.array.length === colors.length : !color)) {
    position.copyArray(positions)
    position.needsUpdate = true
    if (colors && color instanceof BufferAttribute) {
      color.copyArray(colors)
      color.needsUpdate = true
    }
  } else {
    geometry.dispose()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    if (colors) geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    else geometry.deleteAttribute('color')
  }
  geometry.computeBoundingSphere()
}

export function updateResourceLevels(previous: ReadonlyMap<string, ResourceLevels>, rows: ProcessRecord[]): ReadonlyMap<string, ResourceLevels> {
  const next = new Map<string, ResourceLevels>()
  let changed = previous.size !== rows.length
  for (const row of rows) {
    const old = previous.get(row.id)
    if (old && old.cpuLevel === row.cpuLevel && old.memoryLevel === row.memoryLevel) next.set(row.id, old)
    else { changed = true; next.set(row.id, { cpuLevel: row.cpuLevel, memoryLevel: row.memoryLevel }) }
  }
  return changed ? next : previous
}

export function resourceAppearance(levels: ResourceLevels | undefined, enabled: boolean) {
  if (!enabled) return { scale: 1, intensity: 1, cpuKnown: true, memoryKnown: true }
  const cpuKnown = levels?.cpuLevel !== null && levels?.cpuLevel !== undefined
  const memoryKnown = levels?.memoryLevel !== null && levels?.memoryLevel !== undefined
  return {
    scale: memoryKnown ? 0.85 + levels!.memoryLevel! / 31 * 2.15 : 1,
    intensity: cpuKnown ? 0.45 + levels!.cpuLevel! / 31 * 1.35 : 0.8,
    cpuKnown, memoryKnown,
  }
}

export function mergeUpdateRange(attribute: BufferAttribute, start: number, count: number) {
  let beginning = start
  let end = start + count
  const separate = [] as { start: number; count: number }[]
  for (const range of attribute.updateRanges) {
    if (range.start <= end && range.start + range.count >= beginning) {
      beginning = Math.min(beginning, range.start)
      end = Math.max(end, range.start + range.count)
    } else separate.push(range)
  }
  separate.push({ start: beginning, count: end - beginning })
  separate.sort((left, right) => left.start - right.start)
  attribute.clearUpdateRanges()
  if (separate.length > 8) {
    const last = separate.at(-1)!
    attribute.addUpdateRange(separate[0].start, last.start + last.count - separate[0].start)
  } else for (const range of separate) attribute.addUpdateRange(range.start, range.count)
  attribute.needsUpdate = true
}