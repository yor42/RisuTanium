/**
 * A root built the way `exportCopyOf` builds the export tree: the live `$state` database object spread into a plain
 * root, so its top-level values are `$state` proxies (arrays and objects). `encodeRisuSaveParts` must write those
 * values with the same bytes as the whole encode.
 *
 * Guard, no pre-fix reproducer: the red side is the splice mutants named in `risuSave.partsEncode.test.ts` (array
 * header boundaries are crossed here by a 16-element and a 70000-element proxied array).
 */
import { describe, expect, test, vi } from 'vitest'
import { types } from 'node:util'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import { encodeRisuSaveLegacy, encodeRisuSaveParts } from 'src/ts/storage/risuSave'

const HEADER_LENGTH = 11

function concat(pieces: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
    let at = 0
    for (const piece of pieces) {
        out.set(piece, at)
        at += piece.length
    }
    return out
}

describe('encodeRisuSaveParts over a root spread from a $state tree', () => {
    test('guard: pieces of the export-copy shape equal the whole encode byte for byte', () => {
        const db = $state({
            name: 'live',
            account: { id: 'a', token: 't' },
            characters: [{ chaId: 'c1', chats: [{ message: 'hi' }] }, { chaId: 'c2', chats: [] as { message: string }[] }],
            sixteen: Array.from({ length: 16 }, (_, i) => i),
            long: Array.from({ length: 70000 }, (_, i) => i % 100),
            modules: [] as string[],
            settings: { nested: { flag: true, list: [1, 2, 3] } },
        })
        // The same spread `exportCopyOf` makes: a plain root, its values still `$state` proxies.
        const root = { ...db, account: undefined }
        // Without real proxies the row would only repeat the plain-object case.
        expect(types.isProxy(root.characters)).toBe(true)
        expect(types.isProxy(root.long)).toBe(true)
        expect(types.isProxy(root.settings)).toBe(true)
        expect(types.isProxy(root)).toBe(false)

        const pieces: Uint8Array[] = []
        for (const piece of encodeRisuSaveParts(root)) pieces.push(piece.slice())
        const actual = concat(pieces)
        const expected = encodeRisuSaveLegacy(root, 'noCompression').subarray(HEADER_LENGTH).slice()
        expect(actual.length).toBe(expected.length)
        expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true)
        // Splitting happened: more than one piece per array element family, not a whole-encode fallback.
        expect(pieces.length).toBeGreaterThan(70000)
    })
})
