import { describe, expect, test, vi } from 'vitest'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => { }),
        removeItem: vi.fn(async () => { }),
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

import { decodeRisuSave, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

/**
 * `Chat.supaMemoryCoveredId` inside the database entry of a legacy `.bin` (the container the fork exports
 * and upstream reads): it is an ordinary chat key beside `supaMemoryData`, so both survive encode and decode
 * with and without compression. Platform boundaries are mocked as in the lenient-decode suite; a pass says
 * nothing about a backup written by `SaveLocalBackup`.
 */
const POINTER = 'chat-id-of-the-last-summarised-message'

function database(): Database {
    return {
        formatversion: 5,
        botPresets: [],
        modules: [],
        characters: [{
            chaId: 'c1', type: 'character', name: 'C',
            chats: [
                { name: 'with pair', id: 'chat-1', message: [{ role: 'user', data: 'hi', chatId: POINTER }], note: '', localLore: [], supaMemoryData: POINTER + '\nsummary text', supaMemoryCoveredId: POINTER },
                { name: 'without', id: 'chat-2', message: [], note: '', localLore: [] },
            ],
        }],
    } as unknown as Database
}

describe('supaMemoryCoveredId in a legacy .bin', () => {
    test.each(['noCompression', 'compression'] as const)('round trip keeps the field beside supaMemoryData (%s)', async (mode) => {
        const decoded = await decodeRisuSave(encodeRisuSaveLegacy(database(), mode)) as Database
        const [withPair, without] = decoded.characters[0].chats
        expect(withPair.supaMemoryCoveredId).toBe(POINTER)
        expect(withPair.supaMemoryData).toBe(POINTER + '\nsummary text')
        expect('supaMemoryCoveredId' in without).toBe(false)
    })
})
