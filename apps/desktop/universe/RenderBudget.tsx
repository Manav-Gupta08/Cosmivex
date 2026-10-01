import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Profile } from '../../../shared/protocol/core'
import { recordFrameCpu, recordGpu, recordSubmission, renderMetrics, resetGpu } from './metrics'
import { GpuTimer } from './gpu-timer'

export function RenderBudget({ profile, onFailure }: { profile: Profile; onFailure: () => void }) {
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
    let revision = 0
    let unlistenFocus: (() => void) | undefined
    let unlistenResize: (() => void) | undefined
    const nativeWindow = '__TAURI_INTERNALS__' in window ? getCurrentWindow() : null
    const visibility = async () => {
      const current = ++revision
      const minimized = nativeWindow ? await nativeWindow.isMinimized().catch(() => false) : false
      if (!active || current !== revision) return
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