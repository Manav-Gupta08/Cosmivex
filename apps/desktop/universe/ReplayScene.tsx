import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import { Color, InstancedMesh, Object3D } from 'three'
import type { CoreFrame } from '../../../shared/protocol/core'
import { buildLayout, galaxyColor } from './layout'
import { RenderBudget } from './RenderBudget'

function RecordedStars({ frame, selectedId, select }: { frame: CoreFrame; selectedId: string | null; select: (id: string) => void }) {
  const mesh = useRef<InstancedMesh>(null)
  const layout = useMemo(() => buildLayout(frame.processes), [frame.processes])
  const invalidate = useThree(state => state.invalidate)
  useLayoutEffect(() => {
    if (!mesh.current) return
    const transform = new Object3D()
    const color = new Color()
    frame.processes.rows.forEach((row, index) => {
      transform.position.set(...(layout.universe.get(row.id) ?? [0, 0, 0]))
      transform.scale.setScalar(row.id === selectedId ? 1.8 : 1)
      transform.updateMatrix()
      mesh.current!.setMatrixAt(index, transform.matrix)
      mesh.current!.setColorAt(index, color.set(row.id === selectedId ? '#e7a194' : galaxyColor(row.galaxyId)))
    })
    mesh.current.count = frame.processes.rows.length
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    mesh.current.computeBoundingSphere()
    invalidate()
  }, [frame, layout, selectedId, invalidate])
  function choose(event: ThreeEvent<MouseEvent>) {
    const row = frame.processes.rows[event.instanceId ?? -1]
    if (row) { event.stopPropagation(); select(row.id) }
  }
  return <instancedMesh ref={mesh} args={[undefined, undefined, 4096]} onClick={choose}>
    <sphereGeometry args={[0.22, 8, 6]} /><meshBasicMaterial />
  </instancedMesh>
}

export function ReplayScene({ frame, selectedId, select }: { frame: CoreFrame; selectedId: string | null; select: (id: string) => void }) {
  const [lost, setLost] = useState(false)
  return <section className="universe-scene" aria-label="Historical process viewport">
    {lost ? <div className="renderer-fallback" role="alert"><h2>Graphics context lost</h2><button onClick={() => setLost(false)}>Retry renderer</button></div> :
    <Canvas frameloop="demand" dpr={1} camera={{ position: [48, 38, 60], fov: 48, near: 0.1, far: 600 }} gl={{ antialias: false, powerPreference: 'low-power', alpha: false }}
      fallback={<div className="renderer-fallback" role="alert">WebGL is unavailable. Recorded details remain available.</div>}>
      <color attach="background" args={['#090c0e']} />
      <gridHelper args={[160, 40, '#283538', '#141d20']} position={[0, -2, 0]} />
      <RecordedStars frame={frame} selectedId={selectedId} select={select} />
      <CameraControls makeDefault minDistance={2} maxDistance={300} maxPolarAngle={Math.PI * 0.88} />
      <RenderBudget profile={frame.profile} onFailure={() => setLost(true)} />
    </Canvas>}
  </section>
}