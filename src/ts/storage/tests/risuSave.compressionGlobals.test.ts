/**
 * The compression stream globals are feature-tested with `typeof`, so a runtime that does not declare `CompressionStream`,
 * `DecompressionStream` or `TextDecoder` falls back to the ponyfill / Buffer instead of throwing a ReferenceError on the bare read.
 * A runtime that does declare them is left alone: the native constructors are never replaced.
 *
 * Reproducers R662-1..3 fail with a ReferenceError against the bare `!X` check; G662-1 is a guard that passes before and after.
 * Platform boundaries are mocked as in the other risuSave tests.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
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
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/characters'),() => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import { decodeRisuSave, encodeRisuSaveCompressionStream } from 'src/ts/storage/risuSave'
import { BufferToText } from 'src/ts/util'

type StreamGlobal = 'CompressionStream' | 'DecompressionStream' | 'TextDecoder'

const saved = new Map<StreamGlobal, PropertyDescriptor | undefined>()

/** Removes only `name` from the global scope and proves it is gone; `afterEach` restores the original descriptor. */
function undeclare(name: StreamGlobal) {
    if (!saved.has(name)) {
        saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    }
    delete (globalThis as Record<string, unknown>)[name]
    expect(name in globalThis).toBe(false)
}

afterEach(() => {
    for (const [name, descriptor] of saved) {
        if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor)
        } else {
            delete (globalThis as Record<string, unknown>)[name]
        }
    }
    saved.clear()
})

function tree() {
    return {
        title: 'compression globals',
        nested: [[1, 'two', [3, { four: 4 }]], ['five']],
        binary: Uint8Array.of(9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
        large: 2 ** 40 + 5,
    }
}

describe('undeclared stream globals fall back instead of throwing (reproducers)', () => {
    test('R662-1: CompressionStream undeclared, encode and decode round-trip', async () => {
        undeclare('CompressionStream')

        const encoded = await encodeRisuSaveCompressionStream(tree())
        const decoded = await decodeRisuSave(encoded)

        expect(decoded).toEqual(tree())
    })

    test('R662-2: DecompressionStream undeclared, a natively encoded save decodes', async () => {
        const encoded = await encodeRisuSaveCompressionStream(tree())
        undeclare('DecompressionStream')

        const decoded = await decodeRisuSave(encoded)

        expect(decoded).toEqual(tree())
    })

    test('R662-3: TextDecoder undeclared, BufferToText decodes multibyte UTF-8', () => {
        const text = '앨리스 爱丽丝 café 😀'
        const bytes = new TextEncoder().encode(text)
        undeclare('TextDecoder')

        expect(BufferToText(bytes)).toBe(text)
    })
})

describe('declared stream globals are left alone (guard: passes before and after)', () => {
    test('G662-1: the native constructors keep their identity across encode and decode', async () => {
        const compression = globalThis.CompressionStream
        const decompression = globalThis.DecompressionStream
        expect(typeof compression).toBe('function')
        expect(typeof decompression).toBe('function')

        const encoded = await encodeRisuSaveCompressionStream(tree())
        await decodeRisuSave(encoded)

        expect(globalThis.CompressionStream).toBe(compression)
        expect(globalThis.DecompressionStream).toBe(decompression)
    })
})
