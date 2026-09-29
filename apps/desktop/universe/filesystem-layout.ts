import type { FileSystemSnapshot } from '../../../shared/protocol/core'
import { processPosition, type Position } from './layout'

export interface FileSystemLayout { key: string; positions: Map<string, Position>; directories: Set<string> }
export function buildFileSystemLayout(snapshot: FileSystemSnapshot, previous?: FileSystemLayout): FileSystemLayout {
  const key = `${snapshot.scope}/` + snapshot.entries.map(entry => `${entry.id}/${entry.directory}/${entry.reparse}`).join('|')
  if (previous?.key === key) return previous
  const positions = new Map<string, Position>()
  const directories = new Set<string>()
  for (const entry of snapshot.entries) {
    const [horizontal, vertical, depth] = processPosition(entry.id)
    positions.set(entry.id, [horizontal * 2, vertical * 1.3, depth * 2])
    if (entry.directory) directories.add(entry.id)
  }
  return { key, positions, directories }
}