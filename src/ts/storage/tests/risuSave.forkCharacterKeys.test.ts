/**
 * MC-2170: the fork-only character key `risutanium_render_when_complete` rides the `.bin` untranslated. The real
 * `encodeRisuSaveStreamed` and `decodeRisuSave` keep it, and neither the hot export copy (`withoutForkOnlyChatData`) nor
 * the cold unit composition (`withoutForkOnlyChatData(coldUnitCharacter(c))`) strips it. These are compatibility guards:
 * they pass before and after the field exists, and fail if a leave-out or the encoder starts dropping the key. A tree
 * without the key decodes without it (absent means off).
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
import { withoutForkOnlyChatData } from 'src/ts/drive/exportAlternatives'
import { coldUnitCharacter } from 'src/ts/process/coldCharacter'
import type { character as Character, Database } from 'src/ts/storage/database.svelte'

const KEY = 'risutanium_render_when_complete'

function concat(pieces: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
    let at = 0
    for (const piece of pieces) {
        out.set(piece, at)
        at += piece.length
    }
    return out
}

function character(withKey: boolean): Record<string, unknown> {
    return {
        chaId: 'a',
        type: 'character',
        name: 'A',
        ...(withKey ? { [KEY]: true } : {}),
        chats: [{
            name: 'Chat 1',
            note: '',
            localLore: [],
            message: [{ role: 'user', data: 'hello' }],
            supaMemoryData: 'FIRST\nrest',
            supaMemoryCoveredId: 'FIRST',
            alt: [{ m: { time: 5, data: 'ALT', role: 'char' }, p: null, a: 1 }],
        }],
    }
}

function tree(withKey: boolean): Record<string, unknown> {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [{ name: 'test-preset' }],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt: 'prompt',
        characters: [character(withKey)],
    }
}

describe('the render-when-complete character key in the .bin compositions', () => {
    test('guard: encodeRisuSaveStreamed then decodeRisuSave keeps the key', async () => {
        const { pieces } = encodeRisuSaveStreamed(tree(true) as unknown as Database)
        const decoded = await decodeRisuSave(concat(pieces))
        expect((decoded.characters[0] as unknown as Record<string, unknown>)[KEY]).toBe(true)
    })

    test('guard: a tree without the key decodes without it', async () => {
        const { pieces } = encodeRisuSaveStreamed(tree(false) as unknown as Database)
        const decoded = await decodeRisuSave(concat(pieces))
        expect(KEY in decoded.characters[0]).toBe(false)
    })

    test('guard: the hot export copy keeps the key while it removes the fork-only chat keys', () => {
        const exported = withoutForkOnlyChatData(character(true))
        expect(exported[KEY]).toBe(true)
        expect('alt' in (exported.chats as Record<string, unknown>[])[0]).toBe(false)
    })

    test('guard: the cold unit composition keeps the key', () => {
        const exported = withoutForkOnlyChatData(coldUnitCharacter(character(true) as unknown as Character))
        expect(exported.risutanium_render_when_complete).toBe(true)
    })
})
