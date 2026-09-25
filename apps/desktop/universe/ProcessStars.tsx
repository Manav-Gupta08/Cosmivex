import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Color, DynamicDrawUsage, InstancedMesh, Object3D, SphereGeometry } from 'three'
import { useCoreStore } from '../src/state/core'
import { galaxyColor } from './layout'
import { renderMetrics } from './metrics'
import { mergeUpdateRange, resourceAppearance } from './resources'

interface CachedStar { id: string; scale: number; color: string; intensity: number }

export function ProcessStars() {
  const ids = useCoreStore(state => state.processIds)
  const selectedId = useCoreStore(state => state.selected?.id)
  const selectedGalaxyId = useCoreStore(state => state.selectedGalaxy?.id)
  const layout = useCoreStore(state => state.layout)
  const viewMode = useCoreStore(state => state.viewMode === 'hierarchy' ? 'hierarchy' : 'universe')
  const resources = useCoreStore(state => state.resourceVisuals ? state.resourceLevels : null)
  const enabled = useCoreStore(state => state.resourceVisuals)
  const filled = useRef<InstancedMesh>(null)
  const unknown = useRef<InstancedMesh>(null)
  const picking = useRef<string[][]>([[], []])
  const cache = useRef<{ positions: unknown; batches: CachedStar[][] }>({ positions: null, batches: [[], []] })
  const [geometry] = useState(() => new SphereGeometry(0.19, 8, 6))
  const invalidate = useThree(state => state.invalidate)
  useEffect(() => () => { geometry.dispose(); renderMetrics.processInstances = 0; renderMetrics.unknownMemoryInstances = 0 }, [geometry])
  useLayoutEffect(() => {
    if (!filled.current || !unknown.current) return
    const transform = new Object3D()
    const color = new Color()
    const nodes = new Map(layout.nodes.map(node => [node.id, node]))
    const groups: string[][] = [[], []]
    for (const id of ids) groups[enabled && resources?.get(id)?.memoryLevel === null ? 1 : 0].push(id)
    const positions = layout[viewMode]
    let changed = false
    let matrixEdits = 0
    let colorEdits = 0
    const nextCache: CachedStar[][] = [[], []]
    for (const [batch, mesh] of [filled.current, unknown.current].entries()) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      let resized = mesh.count !== groups[batch].length
      if (resized) changed = true
      groups[batch].forEach((id, index) => {
        const appearance = resourceAppearance(resources?.get(id), enabled)
        const node = nodes.get(id)
        const scale = appearance.scale * (id === selectedId ? 1.8 : node?.galaxyId === selectedGalaxyId ? 1.25 : 1)
        const tint = id === selectedId ? '#e7a194' : appearance.cpuKnown ? galaxyColor(node?.galaxyId ?? id) : '#9ca6a2'
        const intensity = appearance.intensity
        const previous = cache.current.batches[batch][index]
        if (previous?.id !== id || previous.scale !== scale || cache.current.positions !== positions) {
          transform.position.set(...(positions.get(id) ?? [0, 0, 0]))
          transform.scale.setScalar(scale)
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
          mergeUpdateRange(mesh.instanceMatrix, index * 16, 16)
          matrixEdits += 1
          resized = true
          changed = true
        }
        if (previous?.id !== id || previous.color !== tint || previous.intensity !== intensity) {
          mesh.setColorAt(index, color.set(tint).multiplyScalar(intensity))
          if (mesh.instanceColor) { mesh.instanceColor.setUsage(DynamicDrawUsage); mergeUpdateRange(mesh.instanceColor, index * 3, 3) }
          colorEdits += 1
          changed = true
        }
        nextCache[batch].push({ id, scale, color: tint, intensity })
      })
      mesh.count = groups[batch].length
      if (resized) mesh.computeBoundingSphere()
    }
    picking.current = groups
    cache.current = { positions, batches: nextCache }
    renderMetrics.processInstances = ids.length
    renderMetrics.unknownMemoryInstances = groups[1].length
    renderMetrics.resourceMatrixEdits += matrixEdits
    renderMetrics.resourceColorEdits += colorEdits
    if (changed) invalidate()
  }, [ids, selectedId, selectedGalaxyId, layout, viewMode, resources, enabled, invalidate])
  function choose(event: ThreeEvent<MouseEvent>, batch: number) {
    const id = event.instanceId === undefined ? undefined : picking.current[batch][event.instanceId]
    if (id) { event.stopPropagation(); useCoreStore.getState().select(id) }
  }
  return <group>
    <instancedMesh ref={filled} args={[geometry, undefined, 4096]} onClick={event => choose(event, 0)}><meshBasicMaterial /></instancedMesh>
    <instancedMesh ref={unknown} args={[geometry, undefined, 4096]} onClick={event => choose(event, 1)}><meshBasicMaterial wireframe /></instancedMesh>
  </group>
}