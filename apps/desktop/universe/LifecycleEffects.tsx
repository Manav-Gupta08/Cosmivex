import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import type { Profile } from '../../../shared/protocol/core'
import { useCoreStore } from '../src/state/core'
import { renderMetrics } from './metrics'

export function LifecycleEffects({ profile }: { profile: Profile }) {
  const effects = useCoreStore(state => state.effects)
  const mode = useCoreStore(state => state.viewMode)
  const resourceVisuals = useCoreStore(state => state.resourceVisuals)
  const mesh = useRef<InstancedMesh>(null)
  const transform = useRef(new Object3D())
  const color = useRef(new Color())
  const invalidate = useThree(state => state.invalidate)
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setReducedMotion(preference.matches)
    preference.addEventListener('change', changed)
    return () => preference.removeEventListener('change', changed)
  }, [])
  useLayoutEffect(() => {
    if (mesh.current) mesh.current.count = 0
    renderMetrics.lifecycleEffects = 0
    invalidate()
  }, [effects, mode, profile, reducedMotion, resourceVisuals, invalidate])
  useEffect(() => {
    if (profile !== 'normal' || reducedMotion || effects.length === 0) return
    const remaining = Math.max(...effects.map(effect => effect.startedAt + 900)) - performance.now()
    if (remaining <= 0) return
    const timer = setTimeout(invalidate, remaining + 10)
    return () => clearTimeout(timer)
  }, [effects, profile, reducedMotion, invalidate])
  useFrame(({ camera }) => {
    if (!mesh.current) return
    let count = 0
    if (profile !== 'eco' && !reducedMotion) {
      const now = performance.now()
      for (const effect of effects) {
        if (effect.kind === 'RESOURCE_SPIKE' && !resourceVisuals) continue
        const age = (now - effect.startedAt) / 900
        if (age < 0 || age >= 1) continue
        transform.current.position.set(...effect[mode])
        transform.current.quaternion.copy(camera.quaternion)
        const spike = effect.kind === 'RESOURCE_SPIKE'
        transform.current.scale.setScalar(profile === 'cinematic' ? (spike ? 0.8 + age * 0.9 : 0.3 + age * 0.7) : spike ? 1.25 : 0.45)
        transform.current.updateMatrix()
        mesh.current.setMatrixAt(count, transform.current.matrix)
        color.current.set(spike ? '#dac48b' : effect.kind === 'PROCESS_CREATED' ? '#addab9' : '#d7a196').multiplyScalar(profile === 'cinematic' ? 1 - age : 0.8)
        mesh.current.setColorAt(count, color.current)
        count += 1
      }
    }
    mesh.current.count = count
    renderMetrics.lifecycleEffects = count
    if (count) {
      mesh.current.instanceMatrix.needsUpdate = true
      if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
      if (profile === 'cinematic') invalidate()
    }
  })
  return <instancedMesh ref={mesh} args={[undefined, undefined, 32]} frustumCulled={false} raycast={() => {}}>
    <ringGeometry args={[0.91, 1, 24]} />
    <meshBasicMaterial transparent opacity={0.8} depthWrite={false} />
  </instancedMesh>
}