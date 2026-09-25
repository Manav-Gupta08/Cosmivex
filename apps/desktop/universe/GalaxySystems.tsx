import { useLayoutEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, Object3D } from 'three'
import { useCoreStore } from '../src/state/core'
import { galaxyColor } from './layout'
import { renderMetrics } from './metrics'

export function GalaxySystems() {
  const layout = useCoreStore(state => state.layout)
  const ids = useCoreStore(state => state.processIds)
  const selectedId = useCoreStore(state => state.selectedGalaxy?.id)
  const mode = useCoreStore(state => state.viewMode)
  const mesh = useRef<InstancedMesh>(null)
  const visibleIds = useRef<string[]>([])
  const invalidate = useThree(state => state.invalidate)
  useLayoutEffect(() => {
    if (!mesh.current) return
    const visible = new Set(ids)
    const groups = new Set(layout.nodes.filter(node => visible.has(node.id)).map(node => node.galaxyId))
    visibleIds.current = mode === 'universe' ? [...groups] : []
    const transform = new Object3D()
    const color = new Color()
    visibleIds.current.forEach((id, index) => {
      const center = layout.galaxyPositions.get(id)!
      transform.position.set(center[0], center[1] - 0.3, center[2])
      transform.rotation.x = -Math.PI / 2
      transform.scale.setScalar((layout.galaxyRadii.get(id) ?? 2) * (selectedId === id ? 1.06 : 1))
      transform.updateMatrix()
      mesh.current!.setMatrixAt(index, transform.matrix)
      mesh.current!.setColorAt(index, color.set(selectedId === id ? '#edd9a8' : galaxyColor(id)))
    })
    mesh.current.count = visibleIds.current.length
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    mesh.current.computeBoundingSphere()
    renderMetrics.galaxyInstances = visibleIds.current.length
    invalidate()
  }, [layout, ids, mode, selectedId, invalidate])
  return <instancedMesh ref={mesh} args={[undefined, undefined, 4096]} onClick={event => {
    const id = event.instanceId === undefined ? undefined : visibleIds.current[event.instanceId]
    if (id) { event.stopPropagation(); useCoreStore.getState().selectGalaxy(id) }
  }}>
    <ringGeometry args={[0.96, 1, 48]} />
    <meshBasicMaterial transparent opacity={0.42} depthWrite={false} side={DoubleSide} />
  </instancedMesh>
}

export function ParentLinks() {
  const layout = useCoreStore(state => state.layout)
  const ids = useCoreStore(state => state.processIds)
  const mode = useCoreStore(state => state.viewMode)
  const selectedId = useCoreStore(state => state.selected?.id)
  const selectedGalaxyId = useCoreStore(state => state.selectedGalaxy?.id)
  const geometry = useRef<BufferGeometry>(null)
  const invalidate = useThree(state => state.invalidate)
  useLayoutEffect(() => {
    if (!geometry.current) return
    const visible = new Set(ids)
    const positions: number[] = []
    for (const node of layout.nodes) {
      if (!node.parentId || !visible.has(node.id) || !visible.has(node.parentId)) continue
      if (mode !== 'hierarchy' && node.id !== selectedId && node.parentId !== selectedId && node.galaxyId !== selectedGalaxyId) continue
      const start = layout[mode].get(node.parentId)
      const end = layout[mode].get(node.id)
      if (start && end) positions.push(...start, ...end)
    }
    geometry.current.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.current.computeBoundingSphere()
    renderMetrics.parentLinks = positions.length / 6
    invalidate()
  }, [layout, ids, mode, selectedId, selectedGalaxyId, invalidate])
  return <lineSegments>
    <bufferGeometry ref={geometry} />
    <lineBasicMaterial color="#6d8b8b" transparent opacity={0.5} />
  </lineSegments>
}