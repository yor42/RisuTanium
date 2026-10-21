/**
 * `decodeRisuSave` reads the body of a legacy save as a view of the bytes it was handed, so a save that sits at a non-zero
 * `byteOffset` of a larger buffer (a view the caller cut out of a bigger read) must decode as the same save as a standalone
 * copy, must leave every byte of the backing buffer as it found it, and must decode the same view again to the same tree.
 *
 * Compatibility guard: passes before and after the change from a copying slice to a view; it fails when a branch builds its
 * view without the `byteOffset` or consumes the bytes it is handed. Each producer is the encoder that writes the format.
 * Platform boundaries are mocked as in the other risuSave tests.
 */
import { describe, expect, test, vi } from 'vitest'
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

import { decodeRisuSave, encodeRisuSaveCompressionStream, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'

const JUNK = 0xee
const BEFORE = 37
const AFTER = 53

/** A save tree holding a string, a nested array, binary data, a large integer and a float. */
function tree() {
    return {
        title: 'offset view',
        nested: [[1, 'two', [3, { four: 4 }]], ['five']],
        binary: Uint8Array.of(9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
        large: 2 ** 40 + 5,
        ratio: 3.14159,
    }
}

const producers: readonly (readonly [string, () => Promise<Uint8Array>])[] = [
    ['legacy, compressed', async () => encodeRisuSaveLegacy(tree(), 'compression')],
    ['legacy, uncompressed', async () => encodeRisuSaveLegacy(tree(), 'noCompression')],
    ['legacy, compression stream', async () => await encodeRisuSaveCompressionStream(tree())],
]

/** `encoded` placed at a non-zero offset of a larger buffer with junk on both sides, and the view over exactly it. */
function placed(encoded: Uint8Array): { backing: Uint8Array, view: Uint8Array } {
    const backing = new Uint8Array(BEFORE + encoded.length + AFTER).fill(JUNK)
    backing.set(encoded, BEFORE)
    return { backing, view: backing.subarray(BEFORE, BEFORE + encoded.length) }
}

describe('decodeRisuSave over a view at a non-zero byteOffset (guard: passes with a copy or a view)', () => {
    test.each(producers)('%s: the view decodes as its standalone copy and the backing bytes are untouched', async (_label, produce) => {
        const encoded = await produce()
        const expected = await decodeRisuSave(encoded.slice())
        expect((expected as { title: string }).title).toBe('offset view')
        const { backing, view } = placed(encoded)
        expect(view.byteOffset).toBe(BEFORE)
        const before = backing.slice()

        const first = await decodeRisuSave(view)

        expect(first).toEqual(expected)
        expect(backing).toEqual(before)
    })

    test.each(producers)('%s: a second decode of the same view equals the first', async (_label, produce) => {
        const encoded = await produce()
        const expected = await decodeRisuSave(encoded.slice())
        const { view } = placed(encoded)

        const first = await decodeRisuSave(view)
        const second = await decodeRisuSave(view)

        expect(first).toEqual(expected)
        expect(second).toEqual(expected)
    })
})
