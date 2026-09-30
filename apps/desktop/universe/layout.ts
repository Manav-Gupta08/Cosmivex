import { stratify, tree } from 'd3-hierarchy'
import type { ProcessSnapshot } from '../../../shared/protocol/core'

export function processPosition(id: string): [number, number, number] {
  let hash = 2166136261
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  const angle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2
  hash = Math.imul(hash ^ (hash >>> 16), 2246822519)
  const radius = 3 + Math.sqrt((hash >>> 0) / 0xffffffff) * 14
  hash = Math.imul(hash ^ (hash >>> 13), 3266489917)
  const height = ((hash >>> 0) / 0xffffffff - 0.5) * 7
  return [Math.cos(angle) * radius, height, Math.sin(angle) * radius]
}

export type ViewMode = 'universe' | 'hierarchy' | 'network' | 'filesystem'
export type Position = [number, number, number]
export interface GraphNode { id: string; parentId: string | null; galaxyId: string; depth: number }
export interface UniverseLayout {
  key: string
  nodes: GraphNode[]
  universe: Map<string, Position>
  hierarchy: Map<string, Position>
  galaxyPositions: Map<string, Position>
  galaxyRadii: Map<string, number>
  hierarchyOrder: string[]
}

export function selectLodIds(ids: readonly string[], selectedId: string | null | undefined, limit: number): string[] {
  if (ids.length <= limit) return ids as string[]
  if (limit < 1) return []
  const ranked: { id: string; hash: number }[] = []
  const compare = (left: { id: string; hash: number }, right: { id: string; hash: number }) => left.hash - right.hash || left.id.localeCompare(right.id)
  for (const id of ids) {
    let hash = 2166136261
    for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
    const candidate = { id, hash: hash >>> 0 }
    if (ranked.length < limit) {
      let slot = ranked.length
      ranked.push(candidate)
      while (slot > 0) {
        const parent = Math.floor((slot - 1) / 2)
        if (compare(ranked[parent], candidate) >= 0) break
        ranked[slot] = ranked[parent]
        slot = parent
      }
      ranked[slot] = candidate
    } else if (compare(candidate, ranked[0]) < 0) {
      let slot = 0
      while (slot * 2 + 1 < ranked.length) {
        let child = slot * 2 + 1
        if (child + 1 < ranked.length && compare(ranked[child + 1], ranked[child]) > 0) child += 1
        if (compare(candidate, ranked[child]) >= 0) break
        ranked[slot] = ranked[child]
        slot = child
      }
      ranked[slot] = candidate
    }
  }
  ranked.sort(compare)
  const visible = ranked.map(row => row.id)
  if (selectedId && ids.includes(selectedId) && !visible.includes(selectedId)) visible[limit - 1] = selectedId
  return visible
}

export function buildLayout(snapshot: ProcessSnapshot, previous?: UniverseLayout): UniverseLayout {
  const key = snapshot.galaxies.map(group => `${group.id}/${group.rootId}/${group.processCount}`).join('|')
  if (previous?.key === key && previous.nodes.length === snapshot.rows.length && snapshot.rows.every((row, index) => {
    const node = previous.nodes[index]
    return node.id === row.id && node.parentId === row.parentId && node.galaxyId === row.galaxyId && node.depth === row.depth
  })) return previous
  const nodes = snapshot.rows.map(({ id, parentId, galaxyId, depth }) => ({ id, parentId, galaxyId, depth }))
  const layout: UniverseLayout = { key, nodes, universe: new Map(), hierarchy: new Map(), galaxyPositions: new Map(), galaxyRadii: new Map(), hierarchyOrder: [] }
  const groups = new Map(snapshot.galaxies.map(group => [group.id, group]))
  for (const group of snapshot.galaxies) {
    const [horizontal, vertical, depth] = processPosition(group.id)
    layout.galaxyPositions.set(group.id, [horizontal * 2.1, vertical * 1.3, depth * 2.1])
    layout.galaxyRadii.set(group.id, Math.min(6, 1.6 + Math.sqrt(group.processCount) * 0.5))
  }
  for (const node of nodes) {
    const center = layout.galaxyPositions.get(node.galaxyId)
    if (!center) continue
    const local = groups.get(node.galaxyId)?.rootId === node.id ? [0, 0, 0] : processPosition(node.id)
    const scale = (layout.galaxyRadii.get(node.galaxyId) ?? 2) / 20
    layout.universe.set(node.id, [center[0] + local[0] * scale, center[1] + local[1] * scale, center[2] + local[2] * scale])
  }
  if (nodes.length) {
    const rootId = '__layout_origin__'
    const origin: GraphNode = { id: rootId, parentId: null, galaxyId: '', depth: -1 }
    const forest = stratify<GraphNode>().id(node => node.id).parentId(node => node.id === rootId ? null : node.parentId ?? rootId)([origin, ...nodes])
    const hierarchy = tree<GraphNode>().size([Math.PI * 2, 28])(forest)
    hierarchy.eachBefore(node => {
      if (node.id === rootId) return
      layout.hierarchy.set(node.data.id, [Math.cos(node.x) * (12 + node.y), -Math.min(node.data.depth, 16) * 0.35, Math.sin(node.x) * (12 + node.y)])
      layout.hierarchyOrder.push(node.data.id)
    })
  }
  return layout
}

const colors = ['#adcfbd', '#a9bdda', '#d0c193', '#d5a99f']
export function galaxyColor(id: string): string {
  let hash = 0
  for (const character of id) hash = Math.imul(hash, 31) + character.charCodeAt(0)
  return colors[(hash >>> 0) % colors.length]
}