import { afterEach, describe, expect, test, vi } from 'vitest'
import type { MacroEntry } from './macroIndex'

const h = vi.hoisted(() => ({
    collected: 0,
    registryModule: () => ({
        collectMacroEntries: (): MacroEntry[] => {
            h.collected += 1
            return [{ name: 'char', aliases: [], summary: 's', usage: null, docOnly: false, internalOnly: false, blockSyntax: false, deprecated: null }]
        },
    }),
}))

// The real registry drags the CBS module and the stores in; its module is replaced by a registry that records calls.
vi.mock('./macroRegistry', () => h.registryModule())

import { createMacroIndex } from './macroIndex'
import { loadMacroIndex, setMacroIndexForTests } from './macroIndexService'

afterEach(() => {
    setMacroIndexForTests(null)
    h.collected = 0
    vi.doMock('./macroRegistry', () => h.registryModule())
})

describe('C1-U4 the macro index service', () => {
    test('the registry is collected once for any number of loads, and the index answers lookups', async () => {
        const first = await loadMacroIndex()
        const second = await loadMacroIndex()
        expect(first).toBe(second)
        expect(h.collected).toBe(1)
        expect(first.lookup('CHAR')?.name).toBe('char')
    })

    test('C2-x02 a failed import rejects and the next load imports again', async () => {
        // A fresh module registry and a throwing factory make the dynamic import of the registry module reject.
        vi.resetModules()
        vi.doMock('./macroRegistry', () => { throw new Error('import failed') })
        const fresh = await import('./macroIndexService')
        await expect(fresh.loadMacroIndex()).rejects.toThrow()
        vi.doMock('./macroRegistry', () => h.registryModule())
        expect((await fresh.loadMacroIndex()).lookup('char')?.name).toBe('char')
    })

    test('the test seam replaces the index and null restores the real one', async () => {
        const seam = createMacroIndex([])
        setMacroIndexForTests(seam)
        expect(await loadMacroIndex()).toBe(seam)
        expect(h.collected).toBe(0)
        setMacroIndexForTests(null)
        expect((await loadMacroIndex()).entries).toHaveLength(1)
        expect(h.collected).toBe(1)
    })
})
