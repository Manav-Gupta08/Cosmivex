import { z } from 'zod'
import { coreFrameSchema, galaxyId, parseHistoricalCheckpoint, processId, processSnapshotSchema, networkSnapshotSchema, filesystemSnapshotSchema, unsigned64, type CoreFrame } from './core'

export const CHUNK_BYTES = 256 * 1024
export const TRANSFER_BYTES = 16 * 1024 * 1024
const positiveSequence = unsigned64.refine(value => BigInt(value) > 0n)
const safeTime = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const eventSchema = z.strictObject({
  sequence: positiveSequence, observedAtUnixMs: safeTime, previousObservedAtUnixMs: safeTime,
  monotonicNs: unsigned64, processId: processId.nullable(), pid: z.number().int().nonnegative().max(0xffffffff),
  kind: z.enum(['BASELINE', 'PROCESS_CREATED', 'PROCESS_TERMINATED', 'PROCESS_UPDATED', 'EVENT_GAP', 'COLLECTION_PAUSED', 'RESOURCE_SPIKE']),
  reason: z.enum(['observation', 'identity', 'metadata', 'incomplete', 'configuration', 'cpu-sustained']), name: z.string().max(1040),
  resourceValue: z.number().min(0).max(100).nullable(), resourceThreshold: z.number().min(0).max(100).nullable(),
}).refine(event => (event.processId === null ? !event.kind.startsWith('PROCESS_') && event.kind !== 'RESOURCE_SPIKE' : event.processId.startsWith(`${event.pid}:`))
  && (event.kind === 'RESOURCE_SPIKE' ? event.reason === 'cpu-sustained' && event.resourceValue !== null && event.resourceThreshold !== null && event.resourceValue >= event.resourceThreshold
    : event.resourceValue === null && event.resourceThreshold === null))
export type ProcessEvent = z.infer<typeof eventSchema>

export const packetSchema = z.strictObject({
  ...coreFrameSchema.shape,
  kind: z.enum(['snapshot', 'delta']), baseSequence: positiveSequence.nullable(),
  network: networkSnapshotSchema.nullable(),
  filesystem: filesystemSnapshotSchema.nullable(),
  processes: z.strictObject({ ...processSnapshotSchema.shape, removed: z.array(processId).max(4096), removedGalaxies: z.array(galaxyId).max(4096) }),
  events: z.strictObject({ throughSequence: unsigned64, evictedCount: unsigned64, gapCount: unsigned64, rows: z.array(eventSchema).max(256) }),
}).refine(packet => (packet.kind === 'snapshot') === (packet.baseSequence === null)
  && (packet.baseSequence === null || BigInt(packet.baseSequence) < BigInt(packet.sequence))
  && packet.events.rows.every((event, index, rows) => BigInt(event.sequence) <= BigInt(packet.events.throughSequence)
    && (index === 0 || BigInt(rows[index - 1].sequence) < BigInt(event.sequence))))
export type CorePacket = z.infer<typeof packetSchema>

export const wireSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('chunk'), protocolVersion: z.literal(7), subscriptionId: z.number().int().positive().max(0xffffffff),
    transferId: positiveSequence, chunkIndex: z.number().int().min(0).max(127), chunkCount: z.number().int().min(1).max(128),
    totalBytes: z.number().int().min(1).max(TRANSFER_BYTES), payload: z.string().min(1).max(CHUNK_BYTES) }),
  z.strictObject({ kind: z.literal('error'), protocolVersion: z.literal(7), subscriptionId: z.number().int().positive().max(0xffffffff), message: z.string().max(1024) }),
])
export type WireChunk = Extract<z.infer<typeof wireSchema>, { kind: 'chunk' }>

export class ChunkAssembler {
  private pending: { id: string; subscription: number; next: number; count: number; total: number; bytes: number; wireBytes: number; pieces: string[] } | null = null
  private completed = 0n
  private readonly encoder = new TextEncoder()

  reset() { this.pending = null }

  push(chunk: WireChunk): { packet: CorePacket | null; wireBytes: number } | null {
    if (BigInt(chunk.transferId) <= this.completed) return null
    if (this.pending && BigInt(chunk.transferId) < BigInt(this.pending.id)) return null
    if (!this.pending || this.pending.id !== chunk.transferId) {
      if (chunk.chunkIndex !== 0) throw new Error('Missing first telemetry chunk')
      this.pending = { id: chunk.transferId, subscription: chunk.subscriptionId, next: 0, count: chunk.chunkCount, total: chunk.totalBytes, bytes: 0, wireBytes: 0, pieces: [] }
    }
    const pending = this.pending
    if (chunk.subscriptionId !== pending.subscription || chunk.chunkIndex !== pending.next || chunk.chunkCount !== pending.count || chunk.totalBytes !== pending.total) {
      throw new Error('Telemetry chunk order or metadata mismatch')
    }
    const bytes = this.encoder.encode(chunk.payload).byteLength
    const wireBytes = this.encoder.encode(JSON.stringify(chunk)).byteLength
    if (bytes > CHUNK_BYTES || wireBytes > 1024 * 1024 || pending.bytes + bytes > pending.total) throw new Error('Telemetry size limit exceeded')
    pending.bytes += bytes
    pending.wireBytes += wireBytes
    pending.pieces.push(chunk.payload)
    pending.next += 1
    if (pending.next < pending.count) return { packet: null, wireBytes: 0 }
    if (pending.bytes !== pending.total) throw new Error('Incomplete telemetry transfer')
    const packet = packetSchema.parse(JSON.parse(pending.pieces.join('')))
    if (packet.subscriptionId !== chunk.subscriptionId) throw new Error('Telemetry subscription mismatch')
    this.completed = BigInt(chunk.transferId)
    this.pending = null
    return { packet, wireBytes: pending.wireBytes }
  }
}

const stateSchema = coreFrameSchema.strip()
export function applyPacket(base: CoreFrame | null, packet: CorePacket): CoreFrame {
  if (packet.kind === 'delta' && (!base || base.subscriptionId !== packet.subscriptionId || base.sequence !== packet.baseSequence)) throw new Error('Delta base mismatch')
  if (packet.kind === 'snapshot' && (packet.processes.removed.length || packet.processes.removedGalaxies.length)) throw new Error('Snapshot contains removals')
  if (packet.kind === 'snapshot' && packet.network === null) throw new Error('Snapshot is missing network state')
  if (packet.kind === 'snapshot' && packet.filesystem === null) throw new Error('Snapshot is missing filesystem state')
  const processes = new Map((packet.kind === 'delta' ? base!.processes.rows : []).map(row => [row.id, row]))
  const galaxies = new Map((packet.kind === 'delta' ? base!.processes.galaxies : []).map(group => [group.id, group]))
  const checkUnique = (ids: string[]) => { if (new Set(ids).size !== ids.length) throw new Error('Duplicate change identity') }
  checkUnique([...packet.processes.rows.map(row => row.id), ...packet.processes.removed])
  checkUnique([...packet.processes.galaxies.map(group => group.id), ...packet.processes.removedGalaxies])
  for (const id of packet.processes.removed) if (!processes.delete(id)) throw new Error('Unknown process removal')
  for (const id of packet.processes.removedGalaxies) if (!galaxies.delete(id)) throw new Error('Unknown galaxy removal')
  for (const row of packet.processes.rows) processes.set(row.id, row)
  for (const group of packet.processes.galaxies) galaxies.set(group.id, group)
  const { removed, removedGalaxies, ...metadata } = packet.processes
  void removed
  void removedGalaxies
  const frame = stateSchema.parse({ ...packet, network: packet.network ?? base?.network, filesystem: packet.filesystem ?? base?.filesystem, processes: { ...metadata,
    rows: [...processes.values()].sort((left, right) => left.pid - right.pid),
    galaxies: [...galaxies.values()].sort((left, right) => left.id.localeCompare(right.id)),
  } })
  if (packet.network === null && base) frame.network = base.network
  if (packet.filesystem === null && base) frame.filesystem = base.filesystem
  return frame
}

const replaySchema = z.strictObject({
  checkpoint: z.unknown(), packets: z.array(z.unknown()).max(256), observedMs: safeTime, gap: z.boolean(),
})

export function reconstructHistory(input: unknown): { frame: CoreFrame; observedMs: number; anchorMs: number; gap: boolean } {
  const replay = replaySchema.parse(input)
  const checkpoint = parseHistoricalCheckpoint(replay.checkpoint)
  let frame = checkpoint.frame
  for (const raw of replay.packets) frame = applyPacket(frame, packetSchema.parse(raw))
  if (frame.observedAtUnixMs !== replay.observedMs || replay.observedMs < checkpoint.observedMs) {
    throw new Error('Historical state timestamp mismatch')
  }
  return { frame, observedMs: replay.observedMs, anchorMs: checkpoint.observedMs, gap: replay.gap }
}