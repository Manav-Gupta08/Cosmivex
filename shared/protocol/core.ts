import { z } from 'zod'

const unsignedSafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const profileSchema = z.enum(['eco', 'normal', 'cinematic'])
export type Profile = z.infer<typeof profileSchema>

export const coreFrameSchema = z.strictObject({
  subscriptionId: z.number().int().positive().max(0xffffffff),
  protocolVersion: z.literal(1),
  abiVersion: z.literal(1),
  sequence: z.string().regex(/^[1-9][0-9]{0,19}$/).pipe(z.string().refine(value => BigInt(value) <= 18446744073709551615n)),
  uptimeMs: unsignedSafeInteger,
  observedAtUnixMs: unsignedSafeInteger,
  intervalMs: z.union([z.literal(2000), z.literal(5000)]),
  profile: profileSchema,
  enabledCollectors: z.literal(0),
}).refine(frame => frame.intervalMs === (frame.profile === 'eco' ? 5000 : 2000))

export type CoreFrame = z.infer<typeof coreFrameSchema>