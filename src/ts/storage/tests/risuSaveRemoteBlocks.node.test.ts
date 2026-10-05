/**
 * Remote character blocks on the self-hosted Node server (`remotes/<chaId>.<hash>.bin`):
 * the encoder sends no request for them, and `decodeRisuSave` still reads the
 * ones a legacy save points at, at the `fetch` boundary.
 *
 * The server is the `FakeNodeServer` stand-in behind the real `NodeStorage`
 * (what the storage object holds), so the same assertions hold whichever client
 * class the encoder and decoder go through. A pass here is about the request
 * sequence; it says nothing about the real server. `risuSave.ts` is real; the
 * database, platform and the rest of the app are mocked. Each test loads a fresh
 * module graph.
 *
 * Tests titled `guard:` assert behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { BLOCK, FakeNodeServer, composeSave } from './manualCleanupHarness'
import { parseBlocks } from './risuSaveBlockFile'
import type { Database } from '../database.svelte'

const world = vi.hoisted(() => ({
    storage: null as unknown,
    keyPair: null as CryptoKeyPair | null,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const storage = () => world.storage as {
        getItem(key: string): Promise<Uint8Array | null>
        setItem(key: string, value: Uint8Array): Promise<void>
        keys(): Promise<string[]>
        removeItem(key: string): Promise<void>
    }
    return {
        forageStorage: {
            get realStorage() { return world.storage },
            Init: async (): Promise<void> => { },
            getItem: (key: string) => storage().getItem(key),
            setItem: (key: string, value: Uint8Array) => storage().setItem(key, value),
            keys: () => storage().keys(),
            removeItem: (key: string) => storage().removeItem(key),
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ enableRemoteSaving: true })),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock('src/lang', () => ({ language: { setNodePassword: 'set password', inputNodePassword: 'input password' } }))

vi.mock('src/ts/util', () => ({
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        world.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return world.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => { throw new Error('the desktop file system is not in use') }),
    writeFile: vi.fn(async () => { throw new Error('the desktop file system is not in use') }),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => { }),
    rename: vi.fn(async () => { }),
}))

interface TestCharacter {
    chaId: string
    type: 'character'
    name: string
    data: string
    chats: never[]
}

let server: FakeNodeServer

function characterOf(chaId: string, data: string): TestCharacter {
    return { chaId, type: 'character', name: 'Test Character', data, chats: [] }
}

function dbOf(...characters: TestCharacter[]): Database {
    return {
        formatversion: 5,
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
    } as unknown as Database
}

async function loadRisuSave() {
    return await import('src/ts/storage/risuSave')
}

function bytesOf(character: TestCharacter): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(character))
}

/** A save whose character `b` is only a REMOTE pointer, as `pointer` says. */
async function saveWithPointer(pointer: Record<string, unknown>): Promise<Uint8Array> {
    const { RisuSaveEncoder } = await loadRisuSave()
    const root = { formatversion: 999, __directory: ['preset', 'plugins', 'a', 'b', 'config'] }
    const save = await composeSave(new RisuSaveEncoder(), [
        { name: 'root', type: BLOCK.ROOT, data: JSON.stringify(root) },
        { name: 'preset', type: BLOCK.BOTPRESET, data: JSON.stringify([{ name: 'p' }]) },
        { name: 'plugins', type: BLOCK.PLUGINS, data: '[]' },
        { name: 'a', type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify({ chaId: 'a', name: 'A', type: 'character', chats: [] }) },
        { name: 'b', type: BLOCK.REMOTE, data: JSON.stringify(pointer) },
        { name: 'config', type: BLOCK.CONFIG, data: '{"version":1}' },
    ])
    return save.bytes
}

beforeEach(async () => {
    world.keyPair = null
    server = new FakeNodeServer()
    vi.stubGlobal('fetch', server.fetch)
    vi.resetModules()
    const { NodeStorage } = await import('src/ts/storage/nodeStorage')
    world.storage = new NodeStorage()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('the encoder on the Node server', () => {
    test('with Remote Saving on in the live database, init and set send no write and no listing request and keep every character inline', async () => {
        const characters = ['alpha', 'bravo', 'charlie'].map((id) => characterOf(`s16-${id}`, `${id} content`))
        const { RisuSaveEncoder, RisuSaveType } = await loadRisuSave()
        const encoder = new RisuSaveEncoder()

        await encoder.init(dbOf(...characters), { compression: false })
        await encoder.set(dbOf(...characters), { character: ['s16-bravo'], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })

        expect(server.requestsTo('/api/write')).toEqual([])
        expect(server.requestsTo('/api/list')).toEqual([])
        const types = parseBlocks(new Uint8Array(encoder.encode()!)).filter((block) => characters.some((c) => c.chaId === block.name)).map((block) => block.type)
        expect(types).toEqual([RisuSaveType.CHARACTER_WITH_CHAT, RisuSaveType.CHARACTER_WITH_CHAT, RisuSaveType.CHARACTER_WITH_CHAT])
    })
})

describe('reading a remote block on the Node server', () => {
    const characterB = characterOf('b', 'remote payload')
    const idsOf = (decoded: { characters?: unknown }) => ((decoded.characters ?? []) as { chaId: string }[]).map((c) => c.chaId)

    test('guard: a content-addressed pointer is read from its hash-named key', async () => {
        const { decodeRisuSave, hashRemoteBlockContent } = await loadRisuSave()
        const hash = await hashRemoteBlockContent(bytesOf(characterB))
        server.seed(`remotes/b.${hash}.bin`, bytesOf(characterB))
        const bytes = await saveWithPointer({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', hash })

        const decoded = await decodeRisuSave(bytes, { strict: true })

        expect(idsOf(decoded).sort()).toEqual(['a', 'b'])
    })

    test('guard: an upstream legacy pointer is read from its <chaId>.local.bin key', async () => {
        server.seed('remotes/b.local.bin', bytesOf(characterB))
        const bytes = await saveWithPointer({ v: 1, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b' })
        const { decodeRisuSave } = await loadRisuSave()

        const decoded = await decodeRisuSave(bytes, { strict: true })

        expect(idsOf(decoded).sort()).toEqual(['a', 'b'])
    })

    test('guard: a missing key throws in strict mode and leaves the character out otherwise', async () => {
        const bytes = await saveWithPointer({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', hash: '0123456789abcdef' })
        const { decodeRisuSave } = await loadRisuSave()

        await expect(decodeRisuSave(bytes, { strict: true })).rejects.toThrow(/not found/)
        expect(idsOf(await decodeRisuSave(bytes))).toEqual(['a'])
    })

    test('guard: a key the server cannot read throws in strict mode and leaves the character out otherwise', async () => {
        server.seed('remotes/b.local.bin', bytesOf(characterB))
        server.readFailures.add('remotes/b.local.bin')
        const bytes = await saveWithPointer({ v: 1, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b' })
        const { decodeRisuSave } = await loadRisuSave()

        await expect(decodeRisuSave(bytes, { strict: true })).rejects.toBeDefined()
        expect(idsOf(await decodeRisuSave(bytes))).toEqual(['a'])
    })
})
