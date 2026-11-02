/**
 * Compatibility guard: a character whose `loreSettings` carries the optional `fullWordAsciiBoundary` flag keeps it
 * through the save codec (`encodeRisuSaveCompressionStream` and `decodeRisuSave`), and a character saved without the flag
 * reads back without it, which the matcher treats as off. The guard passes before and after the option exists: the codec
 * stores a character whole, so a new nested key needs no schema change.
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

function tree(loreSettings: Record<string, unknown>) {
    return { characters: [{ name: '앨리스', loreSettings }] }
}

describe('loreSettings.fullWordAsciiBoundary through the save codec', () => {
    test('guard: the flag round-trips as true and as false', async () => {
        for (const flag of [true, false]) {
            const original = tree({ tokenBudget: 100, scanDepth: 3, recursiveScanning: false, fullWordMatching: true, fullWordAsciiBoundary: flag })
            expect(await decodeRisuSave(await encodeRisuSaveCompressionStream(original))).toEqual(original)
        }
    })

    test('guard: a character saved without the flag reads back without it', async () => {
        const original = tree({ tokenBudget: 100, scanDepth: 3, recursiveScanning: false, fullWordMatching: true })
        const decoded = await decodeRisuSave(await encodeRisuSaveCompressionStream(original)) as ReturnType<typeof tree>
        expect(decoded.characters[0].loreSettings.fullWordAsciiBoundary).toBeUndefined()
    })
})
