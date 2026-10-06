/**
 * Remote character blocks on the desktop build (`remotes/<chaId>.<hash>.bin`
 * under AppData): the encoder writes nothing for them, and `decodeRisuSave`
 * still reads the ones a legacy save points at, at the plugin file-system
 * boundary.
 *
 * The file system is the strict in-memory `createFakeTauriFs`. Nothing here
 * says anything about the native file API. `risuSave.ts` is real; the
 * database, platform and the rest of the app are mocked. Each test loads a
 * fresh module graph.
 *
 * Tests titled `guard:` assert behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { BLOCK, composeSave } from './manualCleanupHarness'
import { parseBlocks } from './risuSaveBlockFile'
import type { Database } from '../database.svelte'

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { probeReads: true }))

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

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
    ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
    invoke: desktop.invoke,
}))

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

function bytesOf(character: TestCharacter): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(character))
}

beforeEach(() => {
    fakeFs.reset()
    desktop.reset()
    vi.resetModules()
})

describe('the encoder on the desktop build', () => {
    test('with Remote Saving on in the live database, init and set write nothing under remotes/ or anywhere else and keep every character inline', async () => {
        const characters = [characterOf('s15-first', 'first marker'), characterOf('s15-second', 'second marker')]
        const { RisuSaveEncoder, RisuSaveType } = await loadRisuSave()
        const encoder = new RisuSaveEncoder()

        await encoder.init(dbOf(...characters), { compression: false })
        await encoder.set(dbOf(...characters), { character: ['s15-second'], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })

        expect(fakeFs.writeLog).toEqual([])
        expect(fakeFs.directories.has('remotes')).toBe(false)
        const types = parseBlocks(new Uint8Array(encoder.encode()!)).filter((block) => characters.some((c) => c.chaId === block.name)).map((block) => block.type)
        expect(types).toEqual([RisuSaveType.CHARACTER_WITH_CHAT, RisuSaveType.CHARACTER_WITH_CHAT])
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
