import type { BufferAttribute } from 'three'
import type { ProcessRecord } from '../../../shared/protocol/core'

export interface ResourceLevels { cpuLevel: number | null; memoryLevel: number | null }

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
  for (const range of attribute.updateRanges) { beginning = Math.min(beginning, range.start); end = Math.max(end, range.start + range.count) }
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(beginning, end - beginning)
  attribute.needsUpdate = true
}