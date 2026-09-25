import { useLayoutEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import { useCoreStore } from '../src/state/core'
import { processPosition } from './layout'
import { renderMetrics } from './metrics'

export function ProcessStars() {
  const ids = useCoreStore(state => state.processIds)
  const selectedId = useCoreStore(state => state.selected?.id)
  const mesh = useRef<InstancedMesh>(null)
  const invalidate = useThree(state => state.invalidate)
  useLayoutEffect(() => {
    if (!mesh.current) return
    const transform = new Object3D()
    const normal = new Color('#d8e5cc')
    const selected = new Color('#e7a194')
    ids.forEach((id, index) => {
      transform.position.set(...processPosition(id))
      transform.scale.setScalar(id === selectedId ? 1.8 : 1)
      transform.updateMatrix()
      mesh.current!.setMatrixAt(index, transform.matrix)
      mesh.current!.setColorAt(index, id === selectedId ? selected : normal)
    })
    mesh.current.count = ids.length
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    mesh.current.computeBoundingSphere()
    renderMetrics.processInstances = ids.length
    invalidate()
  }, [ids, selectedId, invalidate])
  return <instancedMesh ref={mesh} args={[undefined, undefined, 4096]} onClick={event => {
    if (event.instanceId === undefined || !ids[event.instanceId]) return
    event.stopPropagation()
    useCoreStore.getState().select(ids[event.instanceId])
  }}>
    <sphereGeometry args={[0.15, 8, 6]} />
    <meshBasicMaterial />
  </instancedMesh>
}