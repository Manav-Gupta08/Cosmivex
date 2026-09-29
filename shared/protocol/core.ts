import { z } from 'zod'

const unsignedSafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const profileSchema = z.enum(['eco', 'normal', 'cinematic'])
export type Profile = z.infer<typeof profileSchema>

export const unsigned64 = z.string().regex(/^(0|[1-9][0-9]{0,19})$/).pipe(z.string().refine(value => BigInt(value) <= 18446744073709551615n))
const unsigned32 = z.number().int().min(0).max(0xffffffff)
export const processId = z.string().regex(/^[0-9]+:[1-9][0-9]*$/).max(32)
export const galaxyId = z.string().regex(/^g:[0-9]+:[1-9][0-9]*$/).max(34)
export const processSchema = z.strictObject({
  id: processId,
  pid: unsigned32,
  parentPid: unsigned32,
  parentId: processId.nullable(),
  parentStatus: z.enum(['root', 'verified', 'missing', 'unavailable', 'newer-or-equal', 'self']),
  galaxyId,
  depth: z.number().int().min(0).max(4095),
  name: z.string().max(1040),
  threadCount: unsigned32,
  creationFiletime: unsigned64.nullable(),
  createdAtUnixMs: unsignedSafeInteger.nullable(),
  cpuPercent: z.number().min(0).max(100).nullable(),
  workingSetBytes: unsigned64.nullable(),
  cpuLevel: z.number().int().min(0).max(31).nullable(),
  memoryLevel: z.number().int().min(0).max(31).nullable(),
  timingError: unsigned32,
  memoryError: unsigned32,
}).refine(process => process.id.startsWith(`${process.pid}:`)
  && (process.cpuPercent === null) === (process.cpuLevel === null)
  && (process.workingSetBytes === null) === (process.memoryLevel === null))
export type ProcessRecord = z.infer<typeof processSchema>

export const galaxySchema = z.strictObject({
  id: galaxyId, rootId: processId, label: z.string().max(1040),
  executablePath: z.string().max(16384).nullable(), imageError: unsigned32,
  processCount: z.number().int().min(1).max(4096),
  cpuSampleCount: z.number().int().min(0).max(4096),
  memorySampleCount: z.number().int().min(0).max(4096),
  cpuPercent: z.number().min(0).max(409600).nullable(),
  workingSetBytes: unsigned64.nullable(),
}).refine(group => group.id === `g:${group.rootId}` && group.cpuSampleCount <= group.processCount
  && group.memorySampleCount <= group.processCount && (group.cpuSampleCount === 0) === (group.cpuPercent === null)
  && (group.memorySampleCount === 0) === (group.workingSetBytes === null))
export type GalaxyRecord = z.infer<typeof galaxySchema>

export const processSnapshotSchema = z.strictObject({
  observedAtUnixMs: unsignedSafeInteger,
  logicalCpus: z.number().int().min(0).max(65536),
  error: unsigned32,
  truncated: z.boolean(),
  collectionMs: z.number().nonnegative().finite(),
  rows: z.array(processSchema).max(4096),
  galaxies: z.array(galaxySchema).max(4096),
  modelBuildMs: z.number().nonnegative().finite(),
}).refine(snapshot => {
  const rows = new Map(snapshot.rows.map(process => [process.id, process]))
  const groups = new Map(snapshot.galaxies.map(group => [group.id, group]))
  const counts = new Map<string, number>()
  if (rows.size !== snapshot.rows.length || groups.size !== snapshot.galaxies.length) return false
  for (const process of snapshot.rows) {
    if (!groups.has(process.galaxyId) || (process.parentStatus === 'verified') !== (process.parentId !== null)) return false
    if (process.parentId !== null) {
      const parent = rows.get(process.parentId)
      if (!parent || parent.id === process.id || parent.pid !== process.parentPid || process.depth !== parent.depth + 1) return false
    } else if (process.depth !== 0) return false
    counts.set(process.galaxyId, (counts.get(process.galaxyId) ?? 0) + 1)
  }
  return snapshot.galaxies.every(group => rows.get(group.rootId)?.galaxyId === group.id && counts.get(group.id) === group.processCount)
})
export type ProcessSnapshot = z.infer<typeof processSnapshotSchema>

export const connectionSchema = z.strictObject({
  id: z.string().regex(/^n:[1-9][0-9]{0,19}$/), pid: unsigned32,
  family: z.union([z.literal(4), z.literal(6)]), protocol: z.enum(['TCP', 'UDP']),
  state: z.enum(['UNKNOWN', 'CLOSED', 'LISTEN', 'SYN_SENT', 'SYN_RECEIVED', 'ESTABLISHED', 'FIN_WAIT_1', 'FIN_WAIT_2', 'CLOSE_WAIT', 'CLOSING', 'LAST_ACK', 'TIME_WAIT', 'DELETE_TCB', 'BOUND']),
  localAddress: z.string().min(1).max(80), localPort: z.number().int().min(0).max(65535),
  remoteAddress: z.string().min(1).max(80).nullable(), remotePort: z.number().int().min(0).max(65535).nullable(),
  ownerCreation: unsigned64.nullable(), ownerError: unsigned32, observations: z.number().int().min(1).max(4096),
}).refine(row => (row.remoteAddress === null) === (row.remotePort === null)
  && (row.protocol === 'UDP' ? row.remoteAddress === null && row.state === 'BOUND' : row.state !== 'BOUND')
  && (row.state !== 'LISTEN' || row.remoteAddress === null))
export type ConnectionRecord = z.infer<typeof connectionSchema>

export const interfaceSchema = z.strictObject({
  id: z.string().regex(/^if:[0-9]{1,20}$/), index: unsigned32, interfaceType: unsigned32, up: z.boolean(), name: z.string().max(2048),
  receivedBytes: unsigned64, sentBytes: unsigned64, receiveRate: z.number().nonnegative().finite().nullable(), sendRate: z.number().nonnegative().finite().nullable(),
}).refine(row => (row.receiveRate === null) === (row.sendRate === null) && (row.up || row.receiveRate === null))
export type NetworkInterfaceRecord = z.infer<typeof interfaceSchema>

export const networkSnapshotSchema = z.strictObject({
  enabled: z.boolean(), observedAtUnixMs: unsignedSafeInteger, collectionMs: z.number().nonnegative().finite(),
  tableErrors: z.array(unsigned32).length(4), interfaceError: unsigned32, truncated: z.boolean(),
  connections: z.array(connectionSchema).max(4096), interfaces: z.array(interfaceSchema).max(128),
}).refine(snapshot => (snapshot.enabled || (!snapshot.connections.length && !snapshot.interfaces.length))
  && new Set(snapshot.connections.map(row => row.id)).size === snapshot.connections.length
  && new Set(snapshot.interfaces.map(row => row.id)).size === snapshot.interfaces.length)
export type NetworkSnapshot = z.infer<typeof networkSnapshotSchema>

export const fileEntrySchema = z.strictObject({
  id: z.string().regex(/^f:[0-9]+:[1-9][0-9]*$/).max(48), token: unsigned64, fileId: unsigned64, createdTicks: unsigned64,
  modifiedUnixMs: unsignedSafeInteger, size: unsigned64.nullable(), attributes: unsigned32, directory: z.boolean(), reparse: z.boolean(), name: z.string().min(1).max(2048),
}).refine(entry => (entry.directory === (entry.size === null)) && !/[\\/\u0000]/.test(entry.name) && entry.name !== '.' && entry.name !== '..')
export type FileEntryRecord = z.infer<typeof fileEntrySchema>
export const fileEventSchema = z.strictObject({ sequence: unsigned64, observedAtUnixMs: unsignedSafeInteger,
  kind: z.enum(['BASELINE', 'FILE_CREATED', 'FILE_MODIFIED', 'FILE_DELETED', 'FILE_MOVED', 'EVENT_GAP', 'RENAME_FROM', 'RENAME_TO']),
  name: z.string().max(2048), previousName: z.string().max(2048) })
export const filesystemSnapshotSchema = z.strictObject({
  revision: unsigned64, scope: unsigned64, observedAtUnixMs: unsignedSafeInteger, evictedEvents: unsigned64,
  error: unsigned32, watchError: unsigned32, watching: z.boolean(), truncated: z.boolean(), scanMs: z.number().nonnegative().finite(),
  root: z.string().max(16384), relative: z.string().max(16384), entries: z.array(fileEntrySchema).max(4096), events: z.array(fileEventSchema).max(256),
}).refine(snapshot => new Set(snapshot.entries.map(entry => entry.id)).size === snapshot.entries.length
  && snapshot.entries.every(entry => entry.id === `f:${snapshot.scope}:${entry.token}`)
  && snapshot.events.every((event, index, events) => index === 0 || BigInt(event.sequence) > BigInt(events[index - 1].sequence)))
export type FileSystemSnapshot = z.infer<typeof filesystemSnapshotSchema>

export const coreFrameSchema = z.strictObject({
  subscriptionId: z.number().int().positive().max(0xffffffff),
  protocolVersion: z.literal(7),
  abiVersion: z.literal(1),
  sequence: z.string().regex(/^[1-9][0-9]{0,19}$/).pipe(z.string().refine(value => BigInt(value) <= 18446744073709551615n)),
  uptimeMs: unsignedSafeInteger,
  observedAtUnixMs: unsignedSafeInteger,
  intervalMs: z.union([z.literal(1000), z.literal(2000), z.literal(5000)]),
  profile: profileSchema,
  enabledCollectors: z.union([z.literal(0), z.literal(1)]),
  processes: processSnapshotSchema,
  network: networkSnapshotSchema,
  filesystem: filesystemSnapshotSchema,
}).refine(frame => frame.intervalMs === (frame.enabledCollectors === 1
  ? (frame.profile === 'eco' ? 2000 : 1000) : (frame.profile === 'eco' ? 5000 : 2000)))

export type CoreFrame = z.infer<typeof coreFrameSchema>

const historicalCheckpointSchema = z.strictObject({
  sequence: unsignedSafeInteger,
  observedMs: unsignedSafeInteger,
  state: z.strictObject({ health: z.record(z.string(), z.unknown()), network: z.unknown(), filesystem: z.unknown() }),
})

export function parseHistoricalCheckpoint(input: unknown): { observedMs: number; frame: CoreFrame } {
  const checkpoint = historicalCheckpointSchema.parse(input)
  const frame = coreFrameSchema.parse({ ...checkpoint.state.health, subscriptionId: 1, network: checkpoint.state.network, filesystem: checkpoint.state.filesystem })
  if (frame.sequence !== String(checkpoint.sequence) || frame.observedAtUnixMs !== checkpoint.observedMs) {
    throw new Error('Historical checkpoint identity mismatch')
  }
  return { observedMs: checkpoint.observedMs, frame }
}