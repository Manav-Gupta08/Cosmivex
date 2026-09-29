import { expect, it } from 'vitest'
import { filesystemSnapshotSchema } from '../../shared/protocol/core'
import { applyPacket } from '../../shared/protocol/stream'
import { buildFileSystemLayout } from '../../apps/desktop/universe/filesystem-layout'
import { coreFixture, packetFixture, fileFixture, filesystemFixture } from './fixtures'

it('rejects mismatched scopes and invented directory sizes', () => {
  expect(filesystemSnapshotSchema.safeParse(filesystemFixture).success).toBe(true)
  expect(filesystemSnapshotSchema.safeParse({ ...filesystemFixture, scope: '2' }).success).toBe(false)
  expect(filesystemSnapshotSchema.safeParse({ ...filesystemFixture, entries: [{ ...fileFixture, directory: true }] }).success).toBe(false)
})
it('preserves filesystem data on unrelated deltas and requires full baselines', () => {
  const base = applyPacket(null, packetFixture({ ...coreFixture, filesystem: filesystemFixture }))
  const delta = { ...packetFixture({ ...coreFixture, sequence: '2' }), kind: 'delta' as const, baseSequence: '1', filesystem: null }
  expect(applyPacket(base, delta).filesystem).toBe(base.filesystem)
  expect(() => applyPacket(null, { ...packetFixture(), filesystem: null })).toThrow('missing filesystem')
})
it('does not relayout unchanged entries after a metadata update', () => {
  const layout = buildFileSystemLayout(filesystemFixture)
  expect(buildFileSystemLayout({ ...filesystemFixture, entries: [{ ...fileFixture, size: '10' }] }, layout)).toBe(layout)
})