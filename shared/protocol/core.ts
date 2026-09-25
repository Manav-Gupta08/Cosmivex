import { z } from 'zod'

const unsignedSafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const profileSchema = z.enum(['eco', 'normal', 'cinematic'])
export type Profile = z.infer<typeof profileSchema>

const unsigned64 = z.string().regex(/^(0|[1-9][0-9]{0,19})$/).pipe(z.string().refine(value => BigInt(value) <= 18446744073709551615n))
const unsigned32 = z.number().int().min(0).max(0xffffffff)
export const processSchema = z.strictObject({
  id: z.string().regex(/^[0-9]+:[1-9][0-9]*$/).max(32),
  pid: unsigned32,
  parentPid: unsigned32,
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

export const processSnapshotSchema = z.strictObject({
  observedAtUnixMs: unsignedSafeInteger,
  logicalCpus: z.number().int().min(0).max(65536),
  error: unsigned32,
  truncated: z.boolean(),
  collectionMs: z.number().nonnegative().finite(),
  rows: z.array(processSchema).max(4096),
}).refine(snapshot => new Set(snapshot.rows.map(process => process.id)).size === snapshot.rows.length)
export type ProcessSnapshot = z.infer<typeof processSnapshotSchema>

export const coreFrameSchema = z.strictObject({
  subscriptionId: z.number().int().positive().max(0xffffffff),
  protocolVersion: z.literal(2),
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