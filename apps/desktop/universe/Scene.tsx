import { memo, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Profile } from '../../../shared/protocol/core'
import { recordFrameCpu, recordGpu, recordSubmission, renderMetrics, resetGpu, stopMovementSampling } from './metrics'
import { GpuTimer } from './gpu-timer'
import { ProcessStars } from './ProcessStars'
import { GalaxySystems, ParentLinks } from './GalaxySystems'
import { LifecycleEffects } from './LifecycleEffects'
import { useCoreStore } from '../src/state/core'
import { NetworkScene } from './NetworkScene'
import { FileSystemScene } from './FileSystemScene'

const initialCamera: [number, number, number] = [48, 38, 60]

function ReferenceGeometry() {
  return <group position={[0, -2, 0]}>
    <polarGridHelper args={[12, 12, 4, 128, '#4d665c', '#273333']} />
    <gridHelper args={[160, 40, '#283538', '#141d20']} position={[0, -0.01, 0]} />
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
  const previousView = useRef('')
  const { gl, invalidate } = useThree()
  const selectedId = useCoreStore(state => state.selected?.id)
  const selectedGalaxyId = useCoreStore(state => state.selectedGalaxy?.id)
  const selectedGalaxyRoot = useCoreStore(state => state.selectedGalaxy?.rootId)
  const selectedNetworkId = useCoreStore(state => state.selectedConnection?.id ?? state.selectedInterface?.id)
  const networkLayout = useCoreStore(state => state.networkLayout)
  const selectedFileId = useCoreStore(state => state.selectedFile?.id)
  const fileLayout = useCoreStore(state => state.fileLayout)
  const fileScope = useCoreStore(state => state.frame?.filesystem.scope)
  const layout = useCoreStore(state => state.layout)
  const mode = useCoreStore(state => state.viewMode)
  const aspect = useThree(state => state.size.width / state.size.height)
  const focusRevision = useCoreStore(state => state.focusRevision)
  useEffect(() => () => { renderMetrics.cameraMoving = false; stopMovementSampling() }, [])
  useEffect(() => {
    const canvas = gl.domElement
    canvas.setAttribute('tabindex', '0')
    canvas.setAttribute('aria-label', '3D navigation. Arrow keys orbit; plus and minus zoom.')
    const navigate = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !controls.current) return
      const angle = Math.PI / 24
      if (event.key === 'ArrowLeft') void controls.current.rotate(-angle, 0, false)
      else if (event.key === 'ArrowRight') void controls.current.rotate(angle, 0, false)
      else if (event.key === 'ArrowUp') void controls.current.rotate(0, -angle, false)
      else if (event.key === 'ArrowDown') void controls.current.rotate(0, angle, false)
      else if (event.key === '+' || event.key === '=') void controls.current.dolly(6, false)
      else if (event.key === '-') void controls.current.dolly(-6, false)
      else return
      event.preventDefault()
      invalidate()
    }
    canvas.addEventListener('keydown', navigate)
    return () => canvas.removeEventListener('keydown', navigate)
  }, [gl, invalidate])
  useEffect(() => {
    const transition = !matchMedia('(prefers-reduced-motion: reduce)').matches
    const viewKey = `${mode}/${aspect}/${reset}/${mode === 'filesystem' ? fileScope : ''}`
    const viewChanged = previousView.current !== viewKey
    previousView.current = viewKey
    const processMode = mode === 'hierarchy' ? 'hierarchy' : 'universe'
    const target = mode === 'filesystem' ? fileLayout.positions.get(selectedFileId ?? '') : mode === 'network' ? networkLayout.positions.get(selectedNetworkId ?? '') : selectedId ? layout[processMode].get(selectedId)
      : selectedGalaxyId ? (mode === 'universe' ? layout.galaxyPositions.get(selectedGalaxyId) : layout.hierarchy.get(selectedGalaxyRoot ?? '')) : undefined
    if (!target) {
      if (!viewChanged) return
      const scale = Math.max(1, 1.15 / aspect)
      void controls.current?.setLookAt(initialCamera[0] * scale, initialCamera[1] * scale, initialCamera[2] * scale, 0, 0, 0, reset > 0 && transition)
      return
    }
    const distance = selectedId || selectedNetworkId || selectedFileId ? 1 : Math.max(2, (layout.galaxyRadii.get(selectedGalaxyId!) ?? 2) * 0.65)
    void controls.current?.setLookAt(target[0] + 4 * distance, target[1] + 2 * distance, target[2] + 5 * distance, ...target, transition)
  }, [selectedId, selectedGalaxyId, selectedGalaxyRoot, selectedNetworkId, networkLayout, selectedFileId, fileLayout, fileScope, focusRevision, layout, mode, aspect, reset])
  return <CameraControls ref={controls} makeDefault minDistance={2} maxDistance={300} smoothTime={0.2} maxPolarAngle={Math.PI * 0.88}
    onWake={() => { renderMetrics.cameraMoving = true }} onSleep={() => { renderMetrics.cameraMoving = false; stopMovementSampling() }} />
}

function RenderBudget({ profile, onFailure }: { profile: Profile; onFailure: () => void }) {
  const { gl, setFrameloop, invalidate } = useThree()
  const lastRender = useRef(-Infinity)
  const frameStarted = useRef(0)
  const gpuTimer = useRef<GpuTimer | null>(null)
  useEffect(() => {
    const timer = new GpuTimer(gl.getContext() as WebGL2RenderingContext, recordGpu)
    gpuTimer.current = timer
    resetGpu(timer.supported)
    return () => { timer.dispose(); gpuTimer.current = null; resetGpu(false) }
  }, [gl])
  useFrame(() => { frameStarted.current = performance.now() }, -100)
  useEffect(() => {
    let active = true
    let unlistenFocus: (() => void) | undefined
    let unlistenResize: (() => void) | undefined
    const nativeWindow = '__TAURI_INTERNALS__' in window ? getCurrentWindow() : null
    const visibility = async () => {
      const minimized = nativeWindow ? await nativeWindow.isMinimized().catch(() => false) : false
      if (!active) return
      const hidden = document.hidden || minimized
      setFrameloop(hidden ? 'never' : 'demand')
      if (!hidden) invalidate()
    }
    const lost = (event: Event) => { event.preventDefault(); onFailure() }
    document.addEventListener('visibilitychange', visibility)
    if (nativeWindow) {
      void nativeWindow.onFocusChanged(visibility).then(unlisten => { if (active) unlistenFocus = unlisten; else unlisten() })
      void nativeWindow.onResized(visibility).then(unlisten => { if (active) unlistenResize = unlisten; else unlisten() })
    }
    gl.domElement.addEventListener('webglcontextlost', lost)
    void visibility()
    return () => {
      active = false
      unlistenFocus?.()
      unlistenResize?.()
      document.removeEventListener('visibilitychange', visibility)
      gl.domElement.removeEventListener('webglcontextlost', lost)
    }
  }, [gl, invalidate, onFailure, setFrameloop])
  useFrame(({ gl, scene, camera, invalidate }) => {
    const now = performance.now()
    if (now - lastRender.current < 1000 / (profile === 'eco' ? 30 : 60) - 2) {
      invalidate()
      return
    }
    gpuTimer.current?.begin(frameStarted.current)
    try { gl.render(scene, camera) } finally { gpuTimer.current?.end() }
    renderMetrics.frames += 1
    renderMetrics.drawCalls = gl.info.render.calls
    renderMetrics.triangles = gl.info.render.triangles
    recordSubmission(performance.now() - now, now)
    recordFrameCpu(performance.now() - frameStarted.current)
    lastRender.current = now
  }, 1)
  return null
}

export const UniverseScene = memo(function UniverseScene({ profile, reset }: { profile: Profile; reset: number }) {
  const [lost, setLost] = useState(false)
  const mode = useCoreStore(state => state.viewMode)
  return <section className="universe-scene" aria-label="Universe navigation viewport">
    {lost ? <div className="renderer-fallback" role="alert"><h2>Graphics context lost</h2><button onClick={() => setLost(false)}>Retry renderer</button></div> :
      <Canvas key={profile === 'cinematic' ? 'cinematic' : 'efficient'} frameloop="demand" dpr={profile === 'cinematic' ? 2 : 1}
        camera={{ position: initialCamera, fov: 48, near: 0.1, far: 600 }}
        gl={{ antialias: profile === 'cinematic', powerPreference: 'low-power', alpha: false }}
        fallback={<div className="renderer-fallback" role="alert">WebGL is unavailable. Native status remains available.</div>}>
        <color attach="background" args={['#090c0e']} />
        <fog attach="fog" args={['#090c0e', 120, 500]} />
        <ReferenceGeometry />
        {mode === 'filesystem' ? <FileSystemScene /> : mode === 'network' ? <NetworkScene profile={profile} /> : <><GalaxySystems /><ParentLinks /><ProcessStars /><LifecycleEffects profile={profile} /></>}
        <Navigation reset={reset} />
        <RenderBudget profile={profile} onFailure={() => setLost(true)} />
      </Canvas>}
  </section>
})