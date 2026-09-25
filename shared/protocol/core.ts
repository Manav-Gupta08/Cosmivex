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
  timingError: unsigned32,
  memoryError: unsigned32,
}).refine(process => process.id.startsWith(`${process.pid}:`))
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

export const coreFrameSchema = z.strictObject({
  subscriptionId: z.number().int().positive().max(0xffffffff),
  protocolVersion: z.literal(4),
  abiVersion: z.literal(1),
  sequence: z.string().regex(/^[1-9][0-9]{0,19}$/).pipe(z.string().refine(value => BigInt(value) <= 18446744073709551615n)),
  uptimeMs: unsignedSafeInteger,
  observedAtUnixMs: unsignedSafeInteger,
  intervalMs: z.union([z.literal(1000), z.literal(2000), z.literal(5000)]),
  profile: profileSchema,
  enabledCollectors: z.union([z.literal(0), z.literal(1)]),
  processes: processSnapshotSchema,
}).refine(frame => frame.intervalMs === (frame.enabledCollectors === 1
  ? (frame.profile === 'eco' ? 2000 : 1000) : (frame.profile === 'eco' ? 5000 : 2000)))

export type CoreFrame = z.infer<typeof coreFrameSchema>