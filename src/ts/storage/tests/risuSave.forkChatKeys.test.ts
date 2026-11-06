/**
 * MC-774: the `.bin` leave-out of the fork-only chat keys is done on the export's copy of the tree, never in the encoder.
 * The encoder that saves and that internal backups share must keep `Chat.alt`, `Chat.supaMemoryCoveredId` and
 * `Message.interrupted`. This is a compatibility guard: it passes before and after the leave-out, and fails if the strip
 * moves into the encoder (the real `encodeRisuSaveStreamed` and `decodeRisuSave` are used).
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

import { decodeRisuSave, encodeRisuSaveStreamed } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'

function concat(pieces: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
    let at = 0
    for (const piece of pieces) {
        out.set(piece, at)
        at += piece.length
    }
    return out
}

const ALT = [{ m: { time: 5, data: 'ALT', role: 'char' }, p: null, a: 1 }]

function treeWithForkKeys(): Record<string, unknown> {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [{ name: 'test-preset' }],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt: 'prompt',
        characters: [{
            chaId: 'a',
            type: 'character',
            name: 'A',
            chats: [{
                name: 'Chat 1',
                note: '',
                localLore: [],
                message: [
                    { role: 'user', data: 'hello' },
                    { role: 'char', data: 'partial', chatId: 'reply-1', interrupted: true },
                ],
                supaMemoryData: 'FIRST\nrest',
                supaMemoryCoveredId: 'FIRST',
                alt: ALT,
            }],
        }],
    }
}

describe('the save encoder keeps the fork-only chat keys', () => {
    test('guard (G3): encodeRisuSaveStreamed then decodeRisuSave returns alt, the coverage pointer and the interrupted flag', async () => {
        const { pieces } = encodeRisuSaveStreamed(treeWithForkKeys() as unknown as Database)

        const decoded = await decodeRisuSave(concat(pieces))

        const chat = decoded.characters[0].chats[0] as unknown as Record<string, unknown>
        expect(chat.supaMemoryCoveredId).toBe('FIRST')
        expect(chat.alt).toEqual(ALT)
        expect((chat.message as Record<string, unknown>[])[1]).toMatchObject({ data: 'partial', interrupted: true })
        expect(chat.supaMemoryData).toBe('FIRST\nrest')
    })
})
