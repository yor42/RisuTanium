// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { hexStemToBase64url } from '../../store2/format'
import { createListDerivation } from '../../store2/lists'

/**
 * Compatibility guard (CHORE-225 stage A): it passes on the code that introduced the carry and pins what the real
 * module list derivation reads, so that a change to the module fields it reads cannot pass unnoticed. A carried
 * module list equals a fresh derivation only while the derivation reads nothing but what `ASSET_REF_V` / `IL_REF_V`
 * pin.
 *
 * A failure here means: bump the list version (`ASSET_REF_V` for the asset derivation, `IL_REF_V` for the inlay
 * derivation, in `store2/format/versions.ts`) and update the expected sets, or prove that the derivation's output is
 * unchanged for every module. Without a bump a stored list of the old rule is carried as current and goes stale, and
 * the cleanup can then delete an asset the module still names.
 *
 * What is pinned, from the derivation source:
 * - the asset derivation (`collectModuleAssets`) reads `assets` (the second element of each row) and `icon` only;
 * - the inlay derivation (`deriveInlayList` over `forEachString`) reads no named field: it walks every own enumerable
 *   key and every string value of the whole module to any depth. So the pin is that it scans the whole body: ids in
 *   top-level and nested keys and values are all found, and every own key is read.
 * The scan fixture also kills the case-flag and key-skip variants of the scanner that the golden module in
 * `codecModuleListCarry.test.ts` does not show.
 */

interface Reads {
    get: Set<string>
    has: Set<string>
    ownKeys: Set<string>
}

/** Path of one property read: array indices are folded into `*`, so the set does not depend on the row count. */
function pathOf(prefix: string, key: string): string {
    return `${prefix}${/^\d+$/.test(key) ? '*' : key}`
}

/** A deep proxy that records every property read, `in` check and key enumeration under `path`. */
function watch<T extends object>(target: T, path: string, reads: Reads): T {
    return new Proxy(target, {
        get(object, key, receiver) {
            const value = Reflect.get(object, key, receiver) as unknown
            if (typeof key !== 'string') {
                return value
            }
            const next = pathOf(path, key)
            reads.get.add(next)
            return typeof value === 'object' && value !== null ? watch(value, `${next}.`, reads) : value
        },
        has(object, key) {
            if (typeof key === 'string') {
                reads.has.add(pathOf(path, key))
            }
            return Reflect.has(object, key)
        },
        ownKeys(object) {
            reads.ownKeys.add(path === '' ? '(module)' : path.slice(0, -1))
            return Reflect.ownKeys(object)
        },
    })
}

function readsOf(derive: (module: object) => unknown, module: object): { get: string[], has: string[], ownKeys: string[] } {
    const reads: Reads = { get: new Set(), has: new Set(), ownKeys: new Set() }
    derive(watch(module, '', reads))
    return { get: [...reads.get].sort(), has: [...reads.has].sort(), ownKeys: [...reads.ownKeys].sort() }
}

const HEX = {
    A: 'ab'.repeat(32),
    B: 'cd'.repeat(32),
    C: '0f'.repeat(32),
    D: '3e'.repeat(32),
    E: 'ba'.repeat(32),
}
const png = (hex: string): string => `assets/${hex}.png`

describe('guard: the module asset derivation reads only assets and icon', () => {
    // Every other field is present, so a derivation that starts reading one of them is seen.
    const MODULE = {
        id: 'p', name: 'Pin', description: 'd', namespace: 'n', lowLevelAccess: true, hideIcon: false,
        lorebook: [{ content: png(HEX.D) }], regex: [{ in: 'a', out: 'b' }], trigger: [{ effect: png(HEX.C) }],
        assets: [['a', png(HEX.A)], ['b', 'Voice.WAV']],
        icon: png(HEX.B),
    }

    test('A1: the exact set of properties read, with no `in` check or key enumeration', () => {
        const seen = readsOf(createListDerivation().moduleAssets, MODULE)
        expect(seen.get).toEqual(['assets', 'assets.*', 'assets.*.*', 'assets.length', 'icon'])
        expect(seen.has).toEqual([])
        expect(seen.ownKeys).toEqual([])
    })

    test('A2: the top-level fields read are exactly assets and icon', () => {
        const seen = readsOf(createListDerivation().moduleAssets, MODULE)
        expect(seen.get.filter(path => !path.includes('.'))).toEqual(['assets', 'icon'])
    })
})

describe('guard: the module inlay derivation scans the whole module body', () => {
    const UUID_KEY = '2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d'
    const UUID_NESTED_KEY = '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a'
    const UUID_UPPER = 'ABCDEF01-2345-4ABC-8DEF-0123456789AB'
    const UUID_TOKEN_UPPER = 'FEDCBA98-7654-4FED-9CBA-9876543210FE'

    // Ids sit in a top-level key, a nested key, a nested value, a deep array value, and in upper case; the token id
    // in upper case is a uuid (kept out of `o`), `Odd-Id` is not.
    const MODULE = {
        id: 'p',
        [UUID_KEY]: 'plain',
        description: `see ${UUID_UPPER} here`,
        lorebook: [{ content: `{{inlay::${UUID_TOKEN_UPPER}}} and {{inlay::Odd-Id}}` }],
        nested: { deep: [{ [`assets/${HEX.A}`]: 1, [UUID_NESTED_KEY]: { value: `assets/${HEX.E.toUpperCase()}.png` } }] },
    }

    test('I1: every id of the body is found, in keys and values, at any depth, in either case', () => {
        const list = createListDerivation().moduleInlays(MODULE) as { v: number, u: string[], h: string, o: string[], x?: boolean }
        expect(list.x).toBeUndefined()
        expect(list.u).toEqual([UUID_KEY, UUID_NESTED_KEY, UUID_UPPER.toLowerCase(), UUID_TOKEN_UPPER.toLowerCase()].sort())
        expect(list.h).toBe([HEX.A, HEX.E].map(hexStemToBase64url).sort().join(''))
        expect(list.o).toEqual(['Odd-Id'])
    })

    test('I2: every own key and every value of the body is read, not a named subset', () => {
        const seen = readsOf(createListDerivation().moduleInlays, MODULE)
        expect(seen.ownKeys).toEqual(['(module)', 'lorebook.*', 'nested', 'nested.deep.*', `nested.deep.*.${UUID_NESTED_KEY}`].sort())
        expect(seen.get).toEqual([
            'description', 'id', 'lorebook', 'lorebook.*', 'lorebook.*.content', 'lorebook.length',
            'nested', 'nested.deep', 'nested.deep.*', 'nested.deep.*.' + `assets/${HEX.A}`, `nested.deep.*.${UUID_NESTED_KEY}`,
            `nested.deep.*.${UUID_NESTED_KEY}.value`, 'nested.deep.length', UUID_KEY,
        ].sort())
        expect(seen.has).toEqual([])
    })
})
