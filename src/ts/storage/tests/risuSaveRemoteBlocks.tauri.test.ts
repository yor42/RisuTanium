/**
 * Remote character blocks on the desktop build (`remotes/<chaId>.<hash>.bin`
 * under AppData): how `RisuSaveEncoder` writes and skips them and how
 * `decodeRisuSave` reads them, at the plugin file-system boundary.
 *
 * The file system is the strict in-memory `createFakeTauriFs`, whose
 * `writeFile` truncates and leaves a partial body behind when it fails, as the
 * real plugin's does; the same assertions therefore hold whichever write path
 * the encoder takes. Nothing here says anything about the native file API.
 * `risuSave.ts` is real; the database, platform and the rest of the app are
 * mocked. Each test loads a fresh module graph, which is a fresh page load for
 * the encoder's memory of the blocks it has already written.
 *
 * Tests titled `guard:` assert behaviour that must be preserved and pass before
 * and after the remote blocks moved behind the byte store. The others assert
 * behaviour only the store-based encoder has.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { BLOCK, composeSave } from './manualCleanupHarness'
import type { Database } from '../database.svelte'

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))

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
    isTauri: true,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { Init: async (): Promise<void> => { }, realStorage: undefined },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ enableRemoteSaving: true })),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock('src/lang', () => ({ language: {} }))

vi.mock('src/ts/util', () => ({
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => null),
    saveKeypairStore: vi.fn(async () => { }),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)

interface TestCharacter {
    chaId: string
    type: 'character'
    name: string
    data: string
    chats: never[]
}

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

/** The key the encoder stores `character` under: the hash is of the character's own JSON. */
async function remoteKeyOf(character: TestCharacter): Promise<string> {
    const { hashRemoteBlockContent } = await loadRisuSave()
    return `remotes/${character.chaId}.${await hashRemoteBlockContent(new TextEncoder().encode(JSON.stringify(character)))}.bin`
}

function bytesOf(character: TestCharacter): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(character))
}

/** A path as the plugin was given it, relative to AppData: the byte store passes `./`-prefixed paths. */
function relative(path: string): string {
    return path.replace(/^\.\//, '')
}

/** Every write into `remotes/`, the temp file of an atomic write included, whatever the path's spelling. */
function remoteWrites() {
    return fakeFs.writeLog.filter((entry) => relative(entry.path).startsWith('remotes/'))
}

beforeEach(() => {
    fakeFs.reset()
    vi.resetModules()
})

describe('writing a remote block on the desktop build', () => {
    test('a write that fails part-way leaves no remote file and no temp file, and the encode fails', async () => {
        const character = characterOf('s15-first', 'S15 first-write marker')
        const key = await remoteKeyOf(character)
        const fault = fakeFs.failWritesOf((body) => new TextDecoder().decode(body).includes('S15 first-write marker'))
        const { RisuSaveEncoder } = await loadRisuSave()

        await expect(new RisuSaveEncoder().init(dbOf(character), { skipRemoteSavingOnCharacters: false })).rejects.toBeDefined()

        expect(fault.fired).toBe(1)
        expect(fakeFs.files.has(key)).toBe(false)
        expect(fakeFs.listing('remotes')).toEqual([])
    })

    test('a rewrite that fails part-way keeps the file that was there', async () => {
        const character = characterOf('s15-rewrite', 'S15 rewrite marker')
        const key = await remoteKeyOf(character)
        const earlier = new Uint8Array([1, 2, 3, 4])
        fakeFs.plant(key, earlier)
        const fault = fakeFs.failWritesOf((body) => new TextDecoder().decode(body).includes('S15 rewrite marker'))
        const { RisuSaveEncoder } = await loadRisuSave()

        await expect(new RisuSaveEncoder().init(dbOf(character), { skipRemoteSavingOnCharacters: false })).rejects.toBeDefined()

        expect(fault.fired).toBe(1)
        expect(Array.from(fakeFs.files.get(key) ?? [])).toEqual(Array.from(earlier))
        expect(fakeFs.listing('remotes')).toEqual([key.slice('remotes/'.length)])
    })

    test('guard: the first write creates remotes/ and leaves exactly the block, byte for byte, with no temp file', async () => {
        const character = characterOf('s15-parents', 'S15 parents marker')
        const key = await remoteKeyOf(character)
        expect(fakeFs.directories.has('remotes')).toBe(false)
        const { RisuSaveEncoder } = await loadRisuSave()

        await new RisuSaveEncoder().init(dbOf(character), { skipRemoteSavingOnCharacters: false })

        expect(Array.from(fakeFs.files.get(key) ?? [])).toEqual(Array.from(bytesOf(character)))
        expect(fakeFs.listing('remotes')).toEqual([key.slice('remotes/'.length)])
    })
})

describe('the existence skip on the desktop build', () => {
    test('guard: a block that is already stored is not rewritten by init', async () => {
        const character = characterOf('skip-stored', 'skip stored marker')
        const key = await remoteKeyOf(character)
        const stored = bytesOf(character)
        fakeFs.plant(key, stored)
        const { RisuSaveEncoder } = await loadRisuSave()

        await new RisuSaveEncoder().init(dbOf(character))

        expect(remoteWrites()).toEqual([])
        expect(Array.from(fakeFs.files.get(key) ?? [])).toEqual(Array.from(stored))
    })

    test('guard: a block that is not stored is written by init while a stored one is not', async () => {
        const stored = characterOf('skip-mixed-stored', 'mixed stored marker')
        const missing = characterOf('skip-mixed-missing', 'mixed missing marker')
        fakeFs.plant(await remoteKeyOf(stored), bytesOf(stored))
        const { RisuSaveEncoder } = await loadRisuSave()

        await new RisuSaveEncoder().init(dbOf(stored, missing))

        expect(Array.from(fakeFs.files.get(await remoteKeyOf(missing)) ?? [])).toEqual(Array.from(bytesOf(missing)))
        const bodiesWritten = remoteWrites().map((entry) => new TextDecoder().decode(entry.data))
        expect(bodiesWritten).toEqual([JSON.stringify(missing)])
    })

    test.each([true, false])('guard: a block written, changed and changed back within one page load is written once per content (skip flag %s)', async (skip) => {
        const first = characterOf('s16-origin', 'origin content A')
        const changed = characterOf('s16-origin', 'origin content B')
        const keyA = await remoteKeyOf(first)
        const keyB = await remoteKeyOf(changed)
        const { RisuSaveEncoder } = await loadRisuSave()

        await new RisuSaveEncoder().init(dbOf(first), { skipRemoteSavingOnCharacters: skip })
        await new RisuSaveEncoder().init(dbOf(changed), { skipRemoteSavingOnCharacters: skip })
        expect(remoteWrites().length).toBeGreaterThanOrEqual(2)
        const writesBeforeReturn = remoteWrites().length
        await new RisuSaveEncoder().init(dbOf(characterOf('s16-origin', 'origin content A')), { skipRemoteSavingOnCharacters: skip })

        expect(remoteWrites().length).toBe(writesBeforeReturn)
        expect(Array.from(fakeFs.files.get(keyA) ?? [])).toEqual(Array.from(bytesOf(first)))
        expect(Array.from(fakeFs.files.get(keyB) ?? [])).toEqual(Array.from(bytesOf(changed)))
    })
})

describe('reading a remote block on the desktop build', () => {
    interface PointerFixture {
        bytes: Uint8Array
    }

    /** A save whose character `b` is only a REMOTE pointer, as `pointer` says. */
    async function saveWithPointer(pointer: Record<string, unknown>): Promise<PointerFixture> {
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
        return { bytes: save.bytes }
    }

    const characterB = characterOf('b', 'remote payload')
    const blockBytes = bytesOf(characterB)
    const idsOf = (decoded: { characters?: unknown }) => ((decoded.characters ?? []) as { chaId: string }[]).map((c) => c.chaId)

    test('guard: a content-addressed pointer is read from its hash-named file', async () => {
        const { hashRemoteBlockContent, decodeRisuSave } = await loadRisuSave()
        const hash = await hashRemoteBlockContent(blockBytes)
        fakeFs.plant(`remotes/b.${hash}.bin`, blockBytes)
        const { bytes } = await saveWithPointer({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', hash })

        const decoded = await decodeRisuSave(bytes, { strict: true })

        expect(idsOf(decoded).sort()).toEqual(['a', 'b'])
    })

    test('guard: an upstream legacy pointer is read from its <chaId>.local.bin file', async () => {
        fakeFs.plant('remotes/b.local.bin', blockBytes)
        const { bytes } = await saveWithPointer({ v: 1, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b' })
        const { decodeRisuSave } = await loadRisuSave()

        const decoded = await decodeRisuSave(bytes, { strict: true })

        expect(idsOf(decoded).sort()).toEqual(['a', 'b'])
    })

    test('guard: a missing file throws in strict mode and leaves the character out otherwise', async () => {
        const { bytes } = await saveWithPointer({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', hash: '0123456789abcdef' })
        const { decodeRisuSave } = await loadRisuSave()

        await expect(decodeRisuSave(bytes, { strict: true })).rejects.toThrow(/not found/)
        expect(idsOf(await decodeRisuSave(bytes))).toEqual(['a'])
    })

    test('guard: a file that cannot be read throws in strict mode and leaves the character out otherwise', async () => {
        fakeFs.plant('remotes/b.local.bin', blockBytes)
        fakeFs.failReadFiles('Access is denied. (os error 5)', (path) => path.startsWith('remotes/'))
        const { bytes } = await saveWithPointer({ v: 1, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b' })
        const { decodeRisuSave } = await loadRisuSave()

        await expect(decodeRisuSave(bytes, { strict: true })).rejects.toBeDefined()
        expect(idsOf(await decodeRisuSave(bytes))).toEqual(['a'])
    })
})
