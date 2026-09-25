import { expect, it } from 'vitest'
import { connectionSchema, interfaceSchema, networkSnapshotSchema } from '../../shared/protocol/core'
import { applyPacket } from '../../shared/protocol/stream'
import { connectionFixture, coreFixture, networkFixture, packetFixture } from './fixtures'
import { processFixture } from './fixtures'
import { buildNetworkLayout, connectionOwner, matchingConnections } from '../../apps/desktop/universe/network-layout'

it('rejects invented UDP peers and duplicate endpoint identities', () => {
  expect(connectionSchema.safeParse(connectionFixture).success).toBe(true)
  expect(connectionSchema.safeParse({ ...connectionFixture, protocol: 'UDP', state: 'BOUND' }).success).toBe(false)
  expect(connectionSchema.safeParse({ ...connectionFixture, protocol: 'UDP', state: 'BOUND', remoteAddress: null, remotePort: null }).success).toBe(true)
  expect(networkSnapshotSchema.safeParse({ ...networkFixture, connections: [connectionFixture, connectionFixture] }).success).toBe(false)
})

it('keeps the last network sample across process-only deltas', () => {
  const base = applyPacket(null, packetFixture({ ...coreFixture, network: networkFixture }))
  const delta = { ...packetFixture({ ...coreFixture, sequence: '2' }), kind: 'delta' as const, baseSequence: '1', network: null }
  expect(applyPacket(base, delta).network).toEqual(networkFixture)
  expect(() => applyPacket(null, { ...packetFixture(), network: null })).toThrow('missing network')
})

it('keeps unknown interface rates distinct from measured zero', () => {
  const row = { id: 'if:1', index: 1, interfaceType: 6, up: true, name: 'fixture', receivedBytes: '100', sentBytes: '200', receiveRate: null, sendRate: null }
  expect(interfaceSchema.safeParse(row).success).toBe(true)
  expect(interfaceSchema.safeParse({ ...row, up: false, receiveRate: 10, sendRate: 10 }).success).toBe(false)
  expect(interfaceSchema.safeParse({ ...row, receiveRate: 0, sendRate: 0 }).success).toBe(true)
})

it('reuses layout across interface counter changes and searches actual endpoints', () => {
  const layout = buildNetworkLayout(networkFixture)
  expect(buildNetworkLayout({ ...networkFixture, collectionMs: 10 }, layout)).toBe(layout)
  expect(matchingConnections(networkFixture, '45001')).toEqual(['n:1'])
  expect(matchingConnections(networkFixture, '127.0.0.1')).toEqual(['n:1'])
  expect(connectionOwner(connectionFixture, [processFixture])?.id).toBe(processFixture.id)
  expect(connectionOwner({ ...connectionFixture, ownerCreation: '1' }, [processFixture])).toBeUndefined()
  expect(connectionOwner({ ...connectionFixture, ownerCreation: null }, [processFixture])).toBeUndefined()
})