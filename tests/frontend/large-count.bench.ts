import { describe, it } from 'vitest'
import { BufferAttribute } from 'three'
import { buildLayout, selectLodIds } from '../../apps/desktop/universe/layout'
import { mergeUpdateRange } from '../../apps/desktop/universe/resources'
import { galaxyFixture, processFixture } from './fixtures'

for (const count of [10_000, 50_000, 100_000]) {
  const rows = Array.from({ length: count }, (_, index) => ({
    ...processFixture,
    id: `${index + 1}:1`,
    pid: index + 1,
    parentId: null,
    galaxyId: galaxyFixture.id,
  }))
  const snapshot = { ...{ observedAtUnixMs: 0, logicalCpus: 1, error: 0, truncated: false, collectionMs: 0, modelBuildMs: 0 }, rows,
    galaxies: [{ ...galaxyFixture, processCount: count }] }
  const ids = rows.map(row => row.id)
  let previous: ReturnType<typeof buildLayout> | undefined
  describe(`${count} synthetic processes`, () => {
    it('topology rebuild', async ({ bench }) => {
      await bench('topology rebuild', () => { buildLayout(snapshot) }).run()
    })
    it('far-field selection', async ({ bench }) => {
      await bench('far-field selection', () => { selectLodIds(ids, ids.at(-1), 1024) }).run()
    })
    it('cached metric-only layout', async ({ bench }) => {
      previous ??= buildLayout(snapshot)
      await bench('cached metric-only layout', () => { buildLayout(snapshot, previous) }).run()
    })
  })
}

describe('4096-instance upload ranges', () => {
  for (const [label, stride, step] of [['sparse colors', 3, 512], ['dense colors', 3, 1], ['sparse matrices', 16, 512]] as const) {
    it(label, async ({ bench }) => {
      await bench(label, () => {
        const attribute = new BufferAttribute(new Float32Array(4096 * stride), stride)
        for (let index = 0; index < 4096; index += step) mergeUpdateRange(attribute, index * stride, stride)
        return attribute.updateRanges.reduce((total, range) => total + range.count, 0)
      }).run()
    })
  }
})