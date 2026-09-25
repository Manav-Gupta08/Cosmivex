import { memo, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import type { Profile } from '../../../shared/protocol/core'
import { renderMetrics } from './metrics'
import { ProcessStars } from './ProcessStars'
import { processPosition } from './layout'
import { useCoreStore } from '../src/state/core'

const initialCamera: [number, number, number] = [14, 12, 18]

function ReferenceGeometry() {
  return <group position={[0, -2, 0]}>
    <polarGridHelper args={[12, 12, 4, 128, '#4d665c', '#273333']} />
    <gridHelper args={[80, 40, '#283538', '#141d20']} position={[0, -0.01, 0]} />
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[2.97, 3, 128]} />
      <meshBasicMaterial color="#9ec7a4" />
    </mesh>
    <mesh position={[0, 0.02, -10]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.045, 4]} />
      <meshBasicMaterial color="#d58b80" />
    </mesh>
  </group>
}

function Navigation({ reset }: { reset: number }) {
  const controls = useRef<CameraControls>(null)
  const selectedId = useCoreStore(state => state.selected?.id)
  const focusRevision = useCoreStore(state => state.focusRevision)
  useEffect(() => {
    if (reset > 0) void controls.current?.setLookAt(...initialCamera, 0, 0, 0, !matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [reset])
  useEffect(() => {
    if (!selectedId) return
    const [horizontal, vertical, depth] = processPosition(selectedId)
    void controls.current?.setLookAt(horizontal + 4, vertical + 2, depth + 5, horizontal, vertical, depth, !matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [selectedId, focusRevision])
  return <CameraControls ref={controls} makeDefault minDistance={2} maxDistance={65} smoothTime={0.2} maxPolarAngle={Math.PI * 0.88} />
}

function RenderBudget({ profile, onFailure }: { profile: Profile; onFailure: () => void }) {
  const { gl, setFrameloop, invalidate } = useThree()
  const lastRender = useRef(-Infinity)
  useEffect(() => {
    const visibility = () => {
      setFrameloop(document.hidden ? 'never' : 'demand')
      if (!document.hidden) invalidate()
    }
    const lost = (event: Event) => { event.preventDefault(); onFailure() }
    document.addEventListener('visibilitychange', visibility)
    gl.domElement.addEventListener('webglcontextlost', lost)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      gl.domElement.removeEventListener('webglcontextlost', lost)
    }
  }, [gl, invalidate, onFailure, setFrameloop])
  useFrame(({ gl, scene, camera, invalidate }) => {
    const now = performance.now()
    if (now - lastRender.current < 1000 / (profile === 'eco' ? 30 : 60) - 0.5) {
      invalidate()
      return
    }
    gl.render(scene, camera)
    renderMetrics.frames += 1
    renderMetrics.drawCalls = gl.info.render.calls
    renderMetrics.triangles = gl.info.render.triangles
    renderMetrics.submissionMs = performance.now() - now
    lastRender.current = now
  }, 1)
  return null
}

export const UniverseScene = memo(function UniverseScene({ profile, reset }: { profile: Profile; reset: number }) {
  const [lost, setLost] = useState(false)
  return <section className="universe-scene" aria-label="Universe navigation viewport">
    {lost ? <div className="renderer-fallback" role="alert"><h2>Graphics context lost</h2><button onClick={() => setLost(false)}>Retry renderer</button></div> :
      <Canvas key={profile === 'cinematic' ? 'cinematic' : 'efficient'} frameloop="demand" dpr={profile === 'cinematic' ? 2 : 1}
        camera={{ position: initialCamera, fov: 48, near: 0.1, far: 160 }}
        gl={{ antialias: profile === 'cinematic', powerPreference: 'low-power', alpha: false }}
        fallback={<div className="renderer-fallback" role="alert">WebGL is unavailable. Native status remains available.</div>}>
        <color attach="background" args={['#090c0e']} />
        <fog attach="fog" args={['#090c0e', 22, 72]} />
        <ReferenceGeometry />
        <ProcessStars />
        <Navigation reset={reset} />
        <RenderBudget profile={profile} onFailure={() => setLost(true)} />
      </Canvas>}
  </section>
})