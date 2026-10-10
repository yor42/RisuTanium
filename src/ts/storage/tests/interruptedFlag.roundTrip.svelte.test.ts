/**
 * The `interrupted` flag on a reply is saved with the character and gone from
 * the next save once it is deleted from the live (reactive) data. The real
 * `RisuSaveEncoder` and `decodeRisuSave` are used, over `$state` data as the
 * live database is. These are compatibility guards: they pass on the base too,
 * because the encoder keeps any message field, and they pin that a deleted flag
 * cannot come back through the proxy.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            readImage: vi.fn(),
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => { }),
            },
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

// The page's reactive stores run effects over the live database as soon as
// they load; this suite encodes its own data and needs none of them.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const known: Record<string, unknown> = { DBState: { db: {} }, selIdState: { selId: -1 } }
    return new Proxy(known, {
        get: (target, key) => (key in target ? target[key as string] : writable(undefined)),
        has: () => true,
    })
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'

function buildDb(): Database {
    const db = $state({
        formatversion: 5,
        botPresets: [{ name: 'p' }],
        botPresetsId: 0,
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
                message: [
                    { role: 'user', data: 'hello' },
                    { role: 'char', data: 'partial', chatId: 'reply-1', interrupted: true },
                ],
            }],
        }],
    })
    return db as unknown as Database
}

async function savedReply(encoder: RisuSaveEncoder) {
    const decoded = await decodeRisuSave(new Uint8Array(encoder.encode() as ArrayBuffer), { strict: true })
    return decoded.characters[0].chats[0].message[1] as unknown as Record<string, unknown>
}

const nothingMarked = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

describe('the interrupted flag through the encoder (guard)', () => {
    test('a flagged reply is saved and decoded with its flag', async () => {
        const db = buildDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false })
        await encoder.set(db, nothingMarked)

        expect(await savedReply(encoder)).toMatchObject({ data: 'partial', interrupted: true })
    })

    test('a flag deleted from the live data is absent from the next encoded block and the decoded message', async () => {
        const db = buildDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false })
        await encoder.set(db, nothingMarked)

        delete db.characters[0].chats[0].message[1].interrupted
        await encoder.set(db, { ...nothingMarked, character: ['a'] })

        const saved = await savedReply(encoder)
        expect('interrupted' in saved).toBe(false)
        expect(saved).toMatchObject({ data: 'partial', chatId: 'reply-1' })
    })
})
