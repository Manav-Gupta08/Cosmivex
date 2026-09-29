import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import { useCoreStore } from '../src/state/core'
import { navigateFilesystem } from '../src/transport'
import { renderMetrics } from './metrics'

export function FileSystemScene() {
  const snapshot = useCoreStore(state => state.frame?.filesystem)
  const layout = useCoreStore(state => state.fileLayout)
  const selected = useCoreStore(state => state.selectedFile?.id)
  const directories = useRef<InstancedMesh>(null)
  const files = useRef<InstancedMesh>(null)
  const picks = useRef<string[][]>([[], []])
  const [time, setTime] = useState(0)
  const invalidate = useThree(state => state.invalidate)
  useEffect(() => {
    const latest = snapshot?.events.reduce((value, event) => Math.max(value, event.observedAtUnixMs), 0) ?? 0
    const remaining = latest + 5000 - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(() => setTime(Date.now()), remaining + 10)
    return () => clearTimeout(timer)
  }, [snapshot])
  useEffect(() => () => { renderMetrics.filesystemEntries = 0 }, [])
  useLayoutEffect(() => {
    if (!directories.current || !files.current) return
    const transform = new Object3D()
    const color = new Color()
    const groups = [snapshot?.entries.filter(entry => entry.directory) ?? [], snapshot?.entries.filter(entry => !entry.directory) ?? []]
    const changed = new Set(snapshot?.events.filter(event => ['FILE_CREATED', 'FILE_MODIFIED', 'FILE_MOVED'].includes(event.kind) && Math.max(time, Date.now()) - event.observedAtUnixMs < 5000).map(event => event.name))
    for (const [batch, mesh] of [directories.current, files.current].entries()) {
      picks.current[batch] = groups[batch].map(entry => entry.id)
      groups[batch].forEach((entry, index) => {
        transform.position.set(...(layout.positions.get(entry.id) ?? [0, 0, 0]))
        transform.rotation.x = entry.directory ? -Math.PI / 2 : 0
        transform.scale.setScalar(entry.id === selected ? 1.8 : 1)
        transform.updateMatrix()
        mesh.setMatrixAt(index, transform.matrix)
        mesh.setColorAt(index, color.set(entry.id === selected ? '#e8bc92' : entry.reparse ? '#b99494' : changed.has(entry.name) ? '#b8e4b0' : entry.directory ? '#a9c4da' : '#cbd0b8'))
      })
      mesh.count = groups[batch].length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    renderMetrics.filesystemEntries = snapshot?.entries.length ?? 0
    invalidate()
  }, [snapshot, layout, selected, time, invalidate])
  function select(event: ThreeEvent<MouseEvent>, batch: number, open = false) {
    const id = event.instanceId === undefined ? undefined : picks.current[batch][event.instanceId]
    if (!id) return
    event.stopPropagation()
    const entry = snapshot?.entries.find(row => row.id === id)
    if (open && entry?.directory && !entry.reparse && snapshot) void navigateFilesystem(snapshot.scope, entry.token).catch((error: unknown) => useCoreStore.getState().fail(String(error)))
    else useCoreStore.getState().selectFile(id)
  }
  return <group>
    <instancedMesh ref={directories} args={[undefined, undefined, 4096]} onClick={event => select(event, 0)} onDoubleClick={event => select(event, 0, true)}><torusGeometry args={[0.7, 0.12, 6, 20]} /><meshBasicMaterial /></instancedMesh>
    <instancedMesh ref={files} args={[undefined, undefined, 4096]} onClick={event => select(event, 1)}><icosahedronGeometry args={[0.35, 0]} /><meshBasicMaterial /></instancedMesh>
  </group>
}