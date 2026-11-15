// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { ASSET_REF_V } from '../../store2/format'
import { createListDerivation } from '../../store2/lists'
import { buildClosureAssetKeepSet } from '../../store2/sweep'
import { sweepTauriAssets } from '../../assetSweep'
import { assetListOf, commitKeyOf, Tree } from '../../tests/store2/sweepFixtures'
import { ASSET_RETAINED_KEY } from '../../../studio/assets/assetOwnerKeys'

/**
 * The store2 keep-set over lists that may or may not know the retained-paths field. Both are guards: a list written by
 * a build that reads the field above this one's version is never trusted (nothing is deleted), and a stale list is
 * re-derived from the owner's core, which includes the field.
 */

describe('guard: a list above the known version makes the keep-set incomplete and the sweep deletes nothing', () => {
    test('the closure walk reports list-newer, and a sweep told the set is incomplete removes nothing', async () => {
        const tree = new Tree()
        const current = tree.addManifest({
            characters: [{ u: 'c1', assetList: { ...assetListOf(['assets/K.png']), v: ASSET_REF_V + 1 } }],
        }, 1)

        const result = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })

        expect(result.status).toBe('incomplete')
        expect(result.status === 'incomplete' ? result.reasons.map((reason) => reason.code) : []).toContain('list-newer')
        const removed: string[] = []
        await sweepTauriAssets({
            uncleanable: new Set<string>(),
            complete: false,
            listAssets: async () => [{ name: 'K.png' }, { name: 'orphan.png' }],
            removeAsset: async (path) => { removed.push(path) },
            getBasename: (name) => name,
            log: () => {},
        })
        expect(removed).toEqual([])
    })
})

describe('a stale list is re-derived from the owner core, which holds the retained paths', () => {
    test('the keep-set holds the retained path of a character whose stored list is below the known version', async () => {
        const tree = new Tree()
        const stale = { ...assetListOf([]), v: ASSET_REF_V - 1 }
        const current = tree.addManifest({ characters: [{ u: 'c1', assetList: stale }] }, 1)
        const core = { [ASSET_RETAINED_KEY]: [['x', 'assets/K.png']] }
        const lists = createListDerivation()

        const result = await buildClosureAssetKeepSet({
            commitKey: commitKeyOf({ current }),
            reader: tree.reader,
            rederive: { assets: async () => lists.characterAssets(core), inlays: async () => null },
        })

        expect(result.status).toBe('complete')
        expect(result.status === 'complete' && result.keep.holds('assets/K.png')).toBe(true)
        expect(result.status === 'complete' && result.keep.holds('assets/other.png')).toBe(false)
    })
})
