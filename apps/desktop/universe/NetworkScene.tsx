import { useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BufferGeometry, Color, InstancedMesh, Object3D, QuadraticBezierCurve3, Vector3 } from 'three'
import type { Profile } from '../../../shared/protocol/core'
import { useCoreStore } from '../src/state/core'
import { renderMetrics } from './metrics'
import { updateLineGeometry } from './resources'

export function NetworkScene({ profile }: { profile: Profile }) {
  const layout = useCoreStore(state => state.networkLayout)
  const ids = useCoreStore(state => state.networkIds)
  const selected = useCoreStore(state => state.selectedConnection?.id)
  const nodes = useRef<InstancedMesh>(null)
  const bridges = useRef<BufferGeometry>(null)
  const linkedIds = useRef<string[]>([])
  const invalidate = useThree(state => state.invalidate)
  useEffect(() => () => { renderMetrics.networkInstances = 0; renderMetrics.networkBridges = 0; renderMetrics.interfaceInstances = 0 }, [])
  useLayoutEffect(() => {
    if (!nodes.current || !bridges.current) return
    const visible = new Set(ids)
    const transform = new Object3D()
    const color = new Color()
    const vertices: number[] = []
    const colors: number[] = []
    linkedIds.current = []
    const rows = new Map(layout.connections.map(row => [row.id, row]))
    ids.forEach((id, index) => {
      const row = rows.get(id)!
      const position = layout.positions.get(id)!
      const tint = selected === id ? '#ecc48d' : row.protocol === 'UDP' ? '#a9bdda' : row.state === 'ESTABLISHED' ? '#acd5b0' : '#9d9a97'
      transform.position.set(...position)
      transform.scale.setScalar(selected === id ? 1.8 : 1)
      transform.updateMatrix()
      nodes.current!.setMatrixAt(index, transform.matrix)
      nodes.current!.setColorAt(index, color.set(tint))
      if (row.protocol === 'TCP' && row.remoteAddress !== null && visible.has(id)) {
        const curve = new QuadraticBezierCurve3(new Vector3(), new Vector3(position[0] * 0.5, position[1] + 6, position[2] * 0.5), new Vector3(...position))
        const points = curve.getPoints(12)
        linkedIds.current.push(id)
        for (let step = 0; step < 12; ++step) {
          vertices.push(...points[step].toArray(), ...points[step + 1].toArray())
          colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
        }
      }
    })
    nodes.current.count = ids.length
    nodes.current.instanceMatrix.needsUpdate = true
    if (nodes.current.instanceColor) nodes.current.instanceColor.needsUpdate = true
    nodes.current.computeBoundingSphere()
    updateLineGeometry(bridges.current, vertices, colors)
    renderMetrics.networkInstances = ids.length
    renderMetrics.networkBridges = linkedIds.current.length
    invalidate()
  }, [layout, ids, selected, invalidate])
  return <group>
    <mesh><icosahedronGeometry args={[0.8, 1]} /><meshBasicMaterial color="#d8d3b0" wireframe /></mesh>
    <instancedMesh ref={nodes} args={[undefined, undefined, 4096]} onClick={event => {
      const id = event.instanceId === undefined ? undefined : ids[event.instanceId]
      if (id) { event.stopPropagation(); useCoreStore.getState().selectConnection(id) }
    }}><torusGeometry args={[0.45, 0.12, 6, 16]} /><meshBasicMaterial /></instancedMesh>
    <lineSegments onClick={event => {
      const index = event.index
      if (index === undefined) return
      const id = linkedIds.current[Math.floor(index / 24)]
      if (id) { event.stopPropagation(); useCoreStore.getState().selectConnection(id) }
    }}><bufferGeometry ref={bridges} /><lineBasicMaterial vertexColors transparent opacity={0.32} /></lineSegments>
    <InterfaceFlow profile={profile} />
  </group>
}

function InterfaceFlow({ profile }: { profile: Profile }) {
  const layout = useCoreStore(state => state.networkLayout)
  const interfaces = useCoreStore(state => state.frame?.network.interfaces)
  const selected = useCoreStore(state => state.selectedInterface?.id)
  const mesh = useRef<InstancedMesh>(null)
  const flow = useRef<InstancedMesh>(null)
  const geometry = useRef<BufferGeometry>(null)
  const transform = useRef(new Object3D())
  const invalidate = useThree(state => state.invalidate)
  useLayoutEffect(() => {
    if (!mesh.current || !geometry.current || !flow.current) return
    const color = new Color()
    const vertices: number[] = []
    layout.interfaces.forEach((row, index) => {
      transform.current.position.set(...row.position)
      transform.current.scale.setScalar(row.id === selected ? 1.5 : 1)
      transform.current.updateMatrix()
      mesh.current!.setMatrixAt(index, transform.current.matrix)
      const sample = interfaces?.find(item => item.id === row.id)
      const measured = sample?.receiveRate !== null && sample?.receiveRate !== undefined
      const active = measured && (sample!.receiveRate! + (sample!.sendRate ?? 0)) > 0
      mesh.current!.setColorAt(index, color.set(row.id === selected ? '#edc18e' : active ? '#acd5b0' : row.up ? '#96a9b7' : '#5a6267'))
      if (row.up) vertices.push(0, 0, 0, ...row.position)
    })
    mesh.current.count = layout.interfaces.length
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    mesh.current.computeBoundingSphere()
    updateLineGeometry(geometry.current, vertices)
    flow.current.count = 0
    renderMetrics.interfaceInstances = layout.interfaces.length
    invalidate()
  }, [layout, interfaces, selected, invalidate])
  useFrame(({ clock }) => {
    if (!flow.current) return
    let count = 0
    if (profile === 'cinematic' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const color = new Color()
      for (const row of interfaces ?? []) {
        const position = layout.positions.get(row.id)
        if (!row.up || !position) continue
        for (const [direction, rate] of [row.receiveRate, row.sendRate].entries()) {
          if (rate === null || rate <= 0) continue
          const speed = Math.min(1.5, 0.25 + Math.log2(1 + rate) / 24)
          const fraction = (clock.elapsedTime * speed) % 1
          const progress = direction === 0 ? 1 - fraction : fraction
          transform.current.position.set(position[0] * progress, position[1] * progress, position[2] * progress)
          transform.current.scale.setScalar(1)
          transform.current.updateMatrix()
          flow.current.setMatrixAt(count, transform.current.matrix)
          flow.current.setColorAt(count, color.set(direction === 0 ? '#add9c0' : '#dab096'))
          count += 1
        }
      }
    }
    flow.current.count = count
    if (count) {
      flow.current.instanceMatrix.needsUpdate = true
      if (flow.current.instanceColor) flow.current.instanceColor.needsUpdate = true
      invalidate()
    }
  })
  return <group>
    <instancedMesh ref={mesh} args={[undefined, undefined, 128]} onClick={event => {
      const id = event.instanceId === undefined ? undefined : layout.interfaces[event.instanceId]?.id
      if (id) { event.stopPropagation(); useCoreStore.getState().selectInterface(id) }
    }}><octahedronGeometry args={[0.45]} /><meshBasicMaterial /></instancedMesh>
    <lineSegments><bufferGeometry ref={geometry} /><lineBasicMaterial color="#677d80" transparent opacity={0.25} /></lineSegments>
    <instancedMesh ref={flow} args={[undefined, undefined, 256]} frustumCulled={false} raycast={() => {}}><sphereGeometry args={[0.16, 6, 4]} /><meshBasicMaterial /></instancedMesh>
  </group>
}