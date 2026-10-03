/**
 * Remote character blocks on the self-hosted Node server (`remotes/<chaId>.<hash>.bin`):
 * how `RisuSaveEncoder` checks for, writes and skips them and how `decodeRisuSave`
 * reads them, at the `fetch` boundary.
 *
 * The server is the `FakeNodeServer` stand-in behind the real `NodeStorage`
 * (what the storage object holds), so the same assertions hold whichever client
 * class the encoder and decoder go through. A pass here is about the request
 * sequence; it says nothing about the real server. `risuSave.ts` is real; the
 * database, platform and the rest of the app are mocked. Each test loads a fresh
 * module graph, which is a fresh page load for the encoder's memory of the
 * blocks it has already written.
 *
 * Tests titled `guard:` assert behaviour that must be preserved and pass before
 * and after the remote blocks moved behind the byte store. The others assert
 * behaviour only the store-based encoder has.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { BLOCK, FakeNodeServer, composeSave } from './manualCleanupHarness'
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

async function remoteKeyOf(character: TestCharacter): Promise<string> {
    const { hashRemoteBlockContent } = await loadRisuSave()
    return `remotes/${character.chaId}.${await hashRemoteBlockContent(bytesOf(character))}.bin`
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

function keyOfRequest(request: { headers: Record<string, string> }): string {
    return Buffer.from(request.headers['file-path'] ?? '', 'hex').toString('utf-8')
}

function remoteWriteRequests() {
    return server.requestsTo('/api/write').filter((request) => keyOfRequest(request).startsWith('remotes/'))
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

describe('the existence skip on the Node server', () => {
    const many = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((id) => characterOf(`s16-${id}`, `${id} content`))

    test('init asks the server which remote blocks are stored once, not once per character, and rewrites none of them', async () => {
        for (const character of many) {
            server.seed(await remoteKeyOf(character), bytesOf(character))
        }
        const { RisuSaveEncoder } = await loadRisuSave()

        await new RisuSaveEncoder().init(dbOf(...many))

        expect(remoteWriteRequests()).toEqual([])
        expect(server.requestsTo('/api/list').length).toBeLessThanOrEqual(1)
    })

    test('a block that is not stored is written and the stored ones are not, with one listing for the whole pass', async () => {
        const [stored, alsoStored, ...missing] = many
        server.seed(await remoteKeyOf(stored), bytesOf(stored))
        server.seed(await remoteKeyOf(alsoStored), bytesOf(alsoStored))
        const { RisuSaveEncoder } = await loadRisuSave()

        await new RisuSaveEncoder().init(dbOf(...many))

        expect(remoteWriteRequests().map(keyOfRequest).sort()).toEqual((await Promise.all(missing.map(remoteKeyOf))).sort())
        for (const character of missing) {
            expect(Array.from(server.files.get(await remoteKeyOf(character))?.bytes ?? [])).toEqual(Array.from(bytesOf(character)))
        }
        expect(server.requestsTo('/api/list').length).toBeLessThanOrEqual(1)
    })

    test('guard: a listing that fails fails the encode, writes nothing, and a later pass still writes the missing block', async () => {
        const character = many[0]
        const { RisuSaveEncoder } = await loadRisuSave()
        const encoder = new RisuSaveEncoder()
        server.beforeRequest = (path) => {
            if (path === '/api/list') {
                throw new Error('the network is down')
            }
        }

        await expect(encoder.init(dbOf(character))).rejects.toBeDefined()
        expect(remoteWriteRequests()).toEqual([])

        server.beforeRequest = undefined
        await encoder.init(dbOf(character))
        expect(remoteWriteRequests().map(keyOfRequest)).toEqual([await remoteKeyOf(character)])
    })

    test.each([true, false])('guard: a block written, changed and changed back within one page load is written once per content (skip flag %s)', async (skip) => {
        const first = characterOf('s16-origin', 'origin content A')
        const changed = characterOf('s16-origin', 'origin content B')
        const { RisuSaveEncoder } = await loadRisuSave()

        await new RisuSaveEncoder().init(dbOf(first), { skipRemoteSavingOnCharacters: skip })
        await new RisuSaveEncoder().init(dbOf(changed), { skipRemoteSavingOnCharacters: skip })
        expect(remoteWriteRequests().length).toBe(2)
        await new RisuSaveEncoder().init(dbOf(characterOf('s16-origin', 'origin content A')), { skipRemoteSavingOnCharacters: skip })

        expect(remoteWriteRequests().length).toBe(2)
        expect(Array.from(server.files.get(await remoteKeyOf(first))?.bytes ?? [])).toEqual(Array.from(bytesOf(first)))
        expect(Array.from(server.files.get(await remoteKeyOf(changed))?.bytes ?? [])).toEqual(Array.from(bytesOf(changed)))
    })
})

describe('writing a remote block on the Node server', () => {
    test('a content-addressed write is not refused because a peer touched the same block after this page read it', async () => {
        const character = characterOf('b', 'peer touched content')
        const key = await remoteKeyOf(character)
        server.seed(key, bytesOf(character))
        const { decodeRisuSave, hashRemoteBlockContent, RisuSaveEncoder } = await loadRisuSave()
        const hash = await hashRemoteBlockContent(bytesOf(character))
        const decoded = await decodeRisuSave(await saveWithPointer({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', hash }), { strict: true })
        expect((decoded.characters as { chaId: string }[]).map((c) => c.chaId).sort()).toEqual(['a', 'b'])
        // The same bytes under the same name: a second writer's idempotent write.
        server.peerWrite(key, bytesOf(character))

        await new RisuSaveEncoder().init(dbOf(character), { skipRemoteSavingOnCharacters: false })

        const writes = remoteWriteRequests().filter((request) => keyOfRequest(request) === key)
        expect(writes).toHaveLength(1)
        expect(writes[0].headers['if-match-revision']).toBeUndefined()
        expect(Array.from(server.files.get(key)?.bytes ?? [])).toEqual(Array.from(bytesOf(character)))
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
