import type { ConnectionRecord, NetworkSnapshot, ProcessRecord } from '../../../shared/protocol/core'
import { processPosition, type Position } from './layout'

export interface NetworkLayout {
  key: string
  positions: Map<string, Position>
  connections: Pick<ConnectionRecord, 'id' | 'state' | 'protocol' | 'remoteAddress'>[]
  interfaces: { id: string; up: boolean; position: Position }[]
}

export function buildNetworkLayout(snapshot: NetworkSnapshot, previous?: NetworkLayout): NetworkLayout {
  const key = snapshot.connections.map(row => `${row.id}/${row.state}/${row.protocol}/${row.remoteAddress}`).join('|')
    + ';' + snapshot.interfaces.map(row => `${row.id}/${row.up}`).join('|')
  if (previous?.key === key) return previous
  const positions = new Map<string, Position>()
  const connections = snapshot.connections.map(({ id, state, protocol, remoteAddress }) => ({ id, state, protocol, remoteAddress }))
  for (const row of connections) {
    const [horizontal, vertical, depth] = processPosition(row.id)
    positions.set(row.id, [horizontal * 2, vertical * 1.2 + 4, depth * 2])
  }
  const interfaces = snapshot.interfaces.map((row, index) => ({ id: row.id, up: row.up, position: [-25 + index % 8 * 7, -8 - Math.floor(index / 8) * 2, -26] as Position }))
  interfaces.forEach(row => positions.set(row.id, row.position))
  return { key, positions, connections, interfaces }
}

export function matchingConnections(snapshot: NetworkSnapshot, query: string): string[] {
  const search = query.trim().toLowerCase()
  return snapshot.connections.filter(row => !search || String(row.pid) === search || String(row.localPort) === search || String(row.remotePort) === search
    || row.localAddress.toLowerCase().includes(search) || row.remoteAddress?.toLowerCase().includes(search) || row.protocol.toLowerCase() === search || row.state.toLowerCase().includes(search)).map(row => row.id)
}

export function connectionOwner(connection: ConnectionRecord, processes: ProcessRecord[]): ProcessRecord | undefined {
  return connection.ownerCreation === null ? undefined : processes.find(process => process.pid === connection.pid && process.creationFiletime === connection.ownerCreation)
}