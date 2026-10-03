/**
 * `sweepTauriAssets` and `sweepForageAssetKey` (`src/ts/storage/assetSweep.ts`)
 * with every dependency injected: the listing, the removal, the keep-set, the
 * keys this page load wrote, and the live references. Nothing here touches a
 * storage backend; `bootstrap.assetSweep.test.ts` drives the same sweeps through
 * the real stores.
 *
 * Tests titled `guard:` hold before and after the guards on the sweep existed;
 * `reproducer:` tests fail against the sweep without the guards, and
 * `new behaviour:` tests assert what only the guarded sweep does.
 */
import { describe, test, expect, vi } from 'vitest'
import { sweepForageAssetKey, sweepTauriAssets } from '../assetSweep'

/** How many deletes share one answer of the live references. */
const BATCH_SIZE = 100

const getBasename = (name: string): string => name.replace(/\\/g, '/').split('/').pop() ?? ''

function names(count: number, prefix = 'filler'): { name: string }[] {
    return Array.from({ length: count }, (_, index) => ({ name: `${prefix}-${String(index).padStart(3, '0')}.png` }))
}

/** A Tauri sweep over `entries` that records what it removed. */
function tauriSweep(entries: { name: string }[], extra: Partial<Parameters<typeof sweepTauriAssets>[0]> = {}) {
    const removed: string[] = []
    const deps = {
        uncleanable: new Set<string>(),
        listAssets: async () => entries,
        removeAsset: async (path: string) => { removed.push(path) },
        getBasename,
        log: () => { },
        logError: () => { },
        ...extra,
    }
    return { removed, run: () => sweepTauriAssets(deps) }
}

describe('sweepTauriAssets', () => {
    test('guard: removes an entry the keep-set does not name and keeps one it names', async () => {
        const sweep = tauriSweep([{ name: 'orphan.png' }, { name: 'kept.png' }], { uncleanable: new Set(['kept.png']) })

        await sweep.run()

        expect(sweep.removed).toEqual(['assets/orphan.png'])
    })

    test('guard: removes nothing when the keep-set is explicitly incomplete, but still asks for the listing', async () => {
        const listAssets = vi.fn(async () => [{ name: 'orphan.png' }])
        const sweep = tauriSweep([], { complete: false, listAssets })

        await sweep.run()

        expect(listAssets).toHaveBeenCalledTimes(1)
        expect(sweep.removed).toEqual([])
    })

    test('guard: a listing that fails rejects the sweep', async () => {
        const sweep = tauriSweep([], { listAssets: async () => { throw new Error('listing failed') } })

        await expect(sweep.run()).rejects.toThrow('listing failed')
    })

    test('guard: a removal that fails is logged and the other entries are still removed', async () => {
        const logError = vi.fn()
        const removed: string[] = []
        const sweep = tauriSweep([{ name: 'a.png' }, { name: 'b.png' }, { name: 'c.png' }], {
            logError,
            removeAsset: async (path: string) => {
                if (path === 'assets/b.png') {
                    throw new Error('denied')
                }
                removed.push(path)
            },
        })

        await sweep.run()

        expect(removed).toEqual(['assets/a.png', 'assets/c.png'])
        expect(logError).toHaveBeenCalledTimes(1)
    })

    test('reproducer: a nested entry is never a candidate', async () => {
        const sweep = tauriSweep([{ name: 'd/nested.png' }, { name: 'orphan.png' }])

        await sweep.run()

        expect(sweep.removed).toEqual(['assets/orphan.png'])
    })

    test('reproducer: names are compared without regard to case on both sides', async () => {
        const sweep = tauriSweep([{ name: 'Hero.PNG' }, { name: 'orphan.png' }, { name: 'LATE.png' }], {
            uncleanable: new Set(['hero.png']),
            liveUncleanable: () => new Set(['Late.PNG']),
        })

        await sweep.run()

        expect(sweep.removed).toEqual(['assets/orphan.png'])
    })

    test('reproducer: a key that becomes written during the sweep is kept, because the set is asked at each delete', async () => {
        const written = new Set<string>()
        const removed: string[] = []
        const sweep = tauriSweep([{ name: 'a.png' }, { name: 'b.png' }, { name: 'c.png' }], {
            writtenThisPage: (key) => written.has(key),
            removeAsset: async (path: string) => {
                removed.push(path)
                written.add('assets/c.png')
            },
        })

        await sweep.run()

        expect(removed).toEqual(['assets/a.png', 'assets/b.png'])
    })

    test('reproducer: a key the page wrote under another case of the name is kept', async () => {
        const sweep = tauriSweep([{ name: 'abc.png' }, { name: 'orphan.png' }], { writtenKeysThisPage: () => ['assets/abc.PNG'] })

        await sweep.run()

        expect(sweep.removed).toEqual(['assets/orphan.png'])
    })

    test('new behaviour: a key the live references name is kept', async () => {
        const sweep = tauriSweep([{ name: 'live.png' }, { name: 'orphan.png' }], { liveUncleanable: () => new Set(['live.png']) })

        await sweep.run()

        expect(sweep.removed).toEqual(['assets/orphan.png'])
    })

    test('new behaviour: the live references are asked once per batch of deletes, never once per key', async () => {
        const liveUncleanable = vi.fn(() => new Set<string>())
        const total = BATCH_SIZE * 2 + 5
        const sweep = tauriSweep(names(total), { liveUncleanable })

        await sweep.run()

        expect(sweep.removed).toHaveLength(total)
        expect(liveUncleanable).toHaveBeenCalledTimes(3)
    })

    test('new behaviour: a keep-set entry spares an entry before the live references are asked', async () => {
        const liveUncleanable = vi.fn(() => new Set<string>())
        const sweep = tauriSweep([{ name: 'kept.png' }], { uncleanable: new Set(['kept.png']), liveUncleanable })

        await sweep.run()

        expect(sweep.removed).toEqual([])
        expect(liveUncleanable).not.toHaveBeenCalled()
    })
})

describe('sweepForageAssetKey', () => {
    function forageSweep(extra: Partial<Parameters<typeof sweepForageAssetKey>[1]> = {}) {
        const removed: string[] = []
        const deps = {
            uncleanable: new Set<string>(),
            removeAsset: async (key: string) => { removed.push(key) },
            getBasename,
            ...extra,
        }
        return { removed, run: (key: string) => sweepForageAssetKey(key, deps) }
    }

    test('guard: removes a key the keep-set does not name and keeps one it names', async () => {
        const sweep = forageSweep({ uncleanable: new Set(['kept.png']) })

        await sweep.run('assets/orphan.png')
        await sweep.run('assets/kept.png')

        expect(sweep.removed).toEqual(['assets/orphan.png'])
    })

    test('guard: removes nothing when the keep-set is explicitly incomplete', async () => {
        const sweep = forageSweep({ complete: false })

        await sweep.run('assets/orphan.png')

        expect(sweep.removed).toEqual([])
    })

    test('guard: a removal that fails rejects, as the caller does not catch it per key', async () => {
        const sweep = forageSweep({ removeAsset: async () => { throw new Error('denied') } })

        await expect(sweep.run('assets/orphan.png')).rejects.toThrow('denied')
    })

    test('guard: names are compared exactly, so a key that differs only in case is another asset', async () => {
        const sweep = forageSweep({ uncleanable: new Set(['hero.png']) })

        await sweep.run('assets/Hero.PNG')

        expect(sweep.removed).toEqual(['assets/Hero.PNG'])
    })

    test('reproducer: a key this page load wrote is kept, and one it did not write is removed', async () => {
        const sweep = forageSweep({ writtenThisPage: (key) => key === 'assets/just-saved.png' })

        await sweep.run('assets/just-saved.png')
        await sweep.run('assets/orphan.png')

        expect(sweep.removed).toEqual(['assets/orphan.png'])
    })

    test('new behaviour: a key the live references name is kept', async () => {
        const sweep = forageSweep({ liveUncleanable: () => new Set(['live.png']) })

        await sweep.run('assets/live.png')
        await sweep.run('assets/orphan.png')

        expect(sweep.removed).toEqual(['assets/orphan.png'])
    })
})
