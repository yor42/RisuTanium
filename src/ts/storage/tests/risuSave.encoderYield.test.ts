// @vitest-environment node
/**
 * The encoder writes nothing to storage and still gives the event loop a turn
 * while it encodes. The encoder and its yield budget are the real modules. The
 * block cache, the page's store, the platform flags, the live database and the
 * storage object are stand-ins, the first two recording what is written so a
 * write is countable. Only `performance.now`, the clock the budget reads, is
 * advanced by hand so that every block is due a yield.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { cacheWrites } = vi.hoisted(() => ({ cacheWrites: [] as string[] }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async (key: string) => { cacheWrites.push(key) }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }) },
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

const { storeWrites, platformBox, liveDb } = vi.hoisted(() => ({
    storeWrites: [] as string[],
    platformBox: { isTauri: false, isNodeServer: false },
    liveDb: { value: null as Record<string, unknown> | null },
}))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({
        capabilities: { conditionalWrites: false },
        read: async () => ({ bytes: null, version: null }),
        write: async (key: string) => { storeWrites.push(key); return { version: null } },
        delete: async (key: string) => { storeWrites.push(key) },
        deleteMany: async () => { storeWrites.push('deleteMany') },
        list: async () => [],
        has: async () => false,
    }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => {
                if (liveDb.value === null) {
                    throw new Error('no live database in tests')
                }
                return liveDb.value
            }),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    get isNodeServer() { return platformBox.isNodeServer },
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

import { RisuSaveEncoder, RisuSaveType, type toSaveType } from '../risuSave'
import type { Database } from '../database.svelte'
import { parseBlocks } from './risuSaveBlockFile'

const NO_MARKS: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function buildDb(count: number): Database {
    return {
        formatversion: 5,
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: Array.from({ length: count }, (_, i) => ({ chaId: `cha-${i}`, type: 'character', name: `Character ${i}`, chats: [] })),
    } as unknown as Database
}

beforeEach(() => {
    cacheWrites.length = 0
    storeWrites.length = 0
    platformBox.isTauri = false
    platformBox.isNodeServer = false
    liveDb.value = null
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the encoder writes nothing to storage', () => {
    test('init and set make no write to the block cache and none to the store', async () => {
        const db = buildDb(6)
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)
        db.characters[2].name = 'Edited'
        await encoder.set(db, { ...NO_MARKS, character: ['cha-2'], botPreset: true, modules: true, loadouts: true, plugins: true, pluginCustomStorage: true })
        expect(cacheWrites).toEqual([])
        expect(storeWrites).toEqual([])
        expect(encoder.snapshotLayout()?.keys.length).toBe(6 + 7)
    })

    test.each([
        ['a desktop page', { isTauri: true, isNodeServer: false }],
        ['a self-hosted server page', { isTauri: false, isNodeServer: true }],
    ])('on %s with Remote Saving on in the live database, init and set write no remote file and keep every character inline', async (_name, platform) => {
        platformBox.isTauri = platform.isTauri
        platformBox.isNodeServer = platform.isNodeServer
        const db = { ...buildDb(3), enableRemoteSaving: true } as Database
        liveDb.value = db as unknown as Record<string, unknown>
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false })
        db.characters[1].name = 'Edited'
        await encoder.set(db, { ...NO_MARKS, character: ['cha-1'] })
        expect(cacheWrites).toEqual([])
        expect(storeWrites).toEqual([])
        const blocks = parseBlocks(new Uint8Array(encoder.encode()!))
        expect(blocks.filter((block) => block.type === RisuSaveType.REMOTE)).toEqual([])
        expect(blocks.filter((block) => block.type === RisuSaveType.CHARACTER_WITH_CHAT).map((block) => block.name)).toEqual(['cha-0', 'cha-1', 'cha-2'])
    })
})

describe('a long encode gives the event loop turns between blocks', () => {
    test('macrotasks run while init is still encoding', async () => {
        let clock = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (clock += 10))
        const db = buildDb(40)
        const encoder = new RisuSaveEncoder()
        let ticks = 0
        let encoding = true
        const tick = () => {
            ticks++
            if (encoding) {
                setImmediate(tick)
            }
        }
        setImmediate(tick)
        await encoder.init(db)
        const ticksDuringInit = ticks
        encoding = false
        expect(ticksDuringInit).toBeGreaterThanOrEqual(20)
    })

    test('without a due yield budget the encode runs as one task', async () => {
        vi.spyOn(performance, 'now').mockImplementation(() => 0)
        const db = buildDb(40)
        const encoder = new RisuSaveEncoder()
        let ticks = 0
        let encoding = true
        const tick = () => {
            ticks++
            if (encoding) {
                setImmediate(tick)
            }
        }
        setImmediate(tick)
        await encoder.init(db)
        encoding = false
        expect(ticks).toBe(0)
    })
})
