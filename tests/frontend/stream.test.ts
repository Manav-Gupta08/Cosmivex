import { expect, it } from 'vitest'
import { applyPacket, ChunkAssembler, packetSchema, TRANSFER_BYTES, wireSchema } from '../../shared/protocol/stream'
import { coreFixture, processFixture, galaxyFixture, packetFixture, chunkFixture } from './fixtures'

it('assembles chunks without exposing partial snapshots', () => {
  const assembler = new ChunkAssembler()
  const chunk = chunkFixture()
  const middle = Math.floor(chunk.payload.length / 2)
  expect(assembler.push({ ...chunk, payload: chunk.payload.slice(0, middle), chunkCount: 2 })?.packet).toBeNull()
  expect(assembler.push({ ...chunk, payload: chunk.payload.slice(middle), chunkIndex: 1, chunkCount: 2 })?.packet?.sequence).toBe('1')
  expect(assembler.push(chunk)).toBeNull()
})

it('rejects out-of-order, mismatched and oversized transfers', () => {
  expect(() => new ChunkAssembler().push({ ...chunkFixture(), chunkIndex: 1, chunkCount: 2 })).toThrow()
  expect(() => new ChunkAssembler().push({ ...chunkFixture(), totalBytes: 1 })).toThrow()
  expect(wireSchema.safeParse({ ...chunkFixture(), totalBytes: TRANSFER_BYTES + 1 }).success).toBe(false)
})

it('applies exact native upserts/removals and validates the resulting graph', () => {
  const initial = applyPacket(null, packetFixture({ ...coreFixture, processes: { ...coreFixture.processes, rows: [processFixture], galaxies: [galaxyFixture] } }))
  const delta = packetSchema.parse({ ...packetFixture(), kind: 'delta', baseSequence: '1', sequence: '2',
    processes: { ...coreFixture.processes, rows: [{ ...processFixture, cpuPercent: 5, cpuLevel: 7 }], galaxies: [{ ...galaxyFixture, cpuSampleCount: 1, cpuPercent: 5 }], removed: [], removedGalaxies: [] },
  })
  const next = applyPacket(initial, delta)
  expect(next.processes.rows[0].cpuPercent).toBe(5)
  expect(initial.processes.rows[0].cpuPercent).toBeNull()
  expect(() => applyPacket(null, delta)).toThrow('Delta base mismatch')
  expect(() => applyPacket(next, delta)).toThrow('Delta base mismatch')
  const removal = { ...delta, baseSequence: '2', sequence: '3', processes: { ...delta.processes, rows: [], galaxies: [], removed: ['42:1'], removedGalaxies: ['g:42:1'] } }
  expect(applyPacket(next, removal).processes.rows).toEqual([])
  expect(() => applyPacket(next, { ...removal, processes: { ...removal.processes, removedGalaxies: [] } })).toThrow()
})

it('new snapshot replaces state without needing a delta base', () => {
  const frame = { ...coreFixture, sequence: '50' }
  expect(applyPacket(coreFixture, packetFixture(frame)).sequence).toBe('50')
})