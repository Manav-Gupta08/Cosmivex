import { expect, it } from 'vitest'
import { applyPacket, ChunkAssembler, packetSchema, reconstructHistory, TRANSFER_BYTES, wireSchema } from '../../shared/protocol/stream'
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
  expect(() => applyPacket(next, { ...delta, baseSequence: '2', sequence: '3', processes: { ...delta.processes,
    rows: [], galaxies: [{ ...galaxyFixture, processCount: 2 }], removed: [], removedGalaxies: [],
  } })).toThrow('Invalid reconstructed frame')
  expect(() => applyPacket(next, { ...delta, baseSequence: '2', sequence: '3', intervalMs: 1000,
    processes: { ...delta.processes, rows: [], galaxies: [], removed: [], removedGalaxies: [] },
  })).toThrow('Invalid reconstructed frame')
})

it('new snapshot replaces state without needing a delta base', () => {
  const frame = { ...coreFixture, sequence: '50' }
  expect(applyPacket(coreFixture, packetFixture(frame)).sequence).toBe('50')
})

it('reconstructs recorded deltas without mutating their checkpoint', () => {
  const { network, filesystem, subscriptionId, ...health } = coreFixture
  void subscriptionId
  const checkpoint = { sequence: 1, observedMs: coreFixture.observedAtUnixMs, state: { health, network, filesystem } }
  const later = coreFixture.observedAtUnixMs + 1000
  const delta = { ...packetFixture(), kind: 'delta', baseSequence: '1', sequence: '2', observedAtUnixMs: later, network: null, filesystem: null }
  const chain = { checkpoint, packets: [delta], observedMs: later, gap: false }
  expect(reconstructHistory(chain).frame.sequence).toBe('2')
  expect(reconstructHistory({ ...chain, packets: [], observedMs: coreFixture.observedAtUnixMs }).frame.sequence).toBe('1')
  expect(() => reconstructHistory({ ...chain, packets: [{ ...delta, baseSequence: '0' }] })).toThrow()
  expect(() => reconstructHistory({ ...chain, observedMs: later + 1 })).toThrow('timestamp mismatch')
  expect(coreFixture.sequence).toBe('1')
})