/**
 * `RisuSaveEncoder.init`'s optional `enableRemoteSaving` input: the encoder
 * takes the remote-saving decision from the input when it is given, in both
 * `init` and `set`, and from `getDatabase()` as before when it is not.
 *
 * Remote blocks need `isNodeServer` or `isTauri`; these tests use the Node
 * side with an in-memory remote store (the mocked `forageStorage`). The
 * `getDatabase()` mock answers an empty object, which is what the live
 * database holds before the boot installs one.
 *
 * Tests titled `guard:` pass with and without the input and protect the
 * behaviour of callers that do not pass it; the others need the input.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
    BLOCK,
    baseTree,
    characterBlocks,
    fullCharacter,
    memoryRemote,
    uid,
    type RemoteLike,
} from './bootArchivePassHarness'
import type { ForageLike } from './forageBackedStore'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: true },
    db: {} as Record<string, unknown>,
    remote: null as null | (RemoteLike & { files: Map<string, Uint8Array> }),
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
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        getItem: (key: string) => (h.remote as RemoteLike).getItem(key),
        setItem: (key: string, value: Uint8Array) => (h.remote as RemoteLike).setItem(key, value),
        keys: () => (h.remote as RemoteLike).keys(),
    },
    isPlainHttpFileSrc: vi.fn(() => false),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

import { RisuSaveEncoder } from 'src/ts/storage/risuSave'
import type { toSaveType } from 'src/ts/storage/risuSave'

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = true
    h.db = {}
    h.remote = memoryRemote()
})

function toSave(character: string[]): toSaveType {
    return { character, chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

function blockTypes(encoder: RisuSaveEncoder): number[] {
    return characterBlocks(new Uint8Array(encoder.encode() as ArrayBuffer)).map((b) => b.type)
}

describe('RisuSaveEncoder.init enableRemoteSaving input', () => {
    test('E1: with the input true, init writes character blocks remote although getDatabase holds no flag', async () => {
        const id = uid('input-a')
        const tree = baseTree([fullCharacter(id, 'A')])
        const arg = { compression: false, enableRemoteSaving: true }
        const encoder = new RisuSaveEncoder()

        await encoder.init(tree, arg)

        expect(blockTypes(encoder)).toEqual([BLOCK.REMOTE])
        expect(Array.from((h.remote as NonNullable<typeof h.remote>).files.keys()).some((k) => k.startsWith(`remotes/${id}.`))).toBe(true)
    })

    test('E1: the input is kept on the encoder, so a later set writes a character added after init remote as well', async () => {
        const first = uid('input-b')
        const second = uid('input-c')
        const tree = baseTree([fullCharacter(first, 'A')])
        const arg = { compression: false, enableRemoteSaving: true }
        const encoder = new RisuSaveEncoder()
        await encoder.init(tree, arg)
        const grown = baseTree([fullCharacter(first, 'A'), fullCharacter(second, 'B')])

        await encoder.set(grown, toSave([second]))

        expect(blockTypes(encoder)).toEqual([BLOCK.REMOTE, BLOCK.REMOTE])
    })

    test('guard: on web the input never makes a character block remote', async () => {
        h.platform.isNodeServer = false
        const tree = baseTree([fullCharacter(uid('input-d'), 'A')])
        const arg = { compression: false, enableRemoteSaving: true }
        const encoder = new RisuSaveEncoder()

        await encoder.init(tree, arg)

        expect(blockTypes(encoder)).toEqual([BLOCK.CHARACTER_WITH_CHAT])
    })

    test('E2: guard: without the input, a database that holds the flag still gets remote blocks', async () => {
        h.db = { enableRemoteSaving: true }
        const encoder = new RisuSaveEncoder()

        await encoder.init(baseTree([fullCharacter(uid('input-e'), 'A')]), { compression: false })

        expect(blockTypes(encoder)).toEqual([BLOCK.REMOTE])
    })

    test('E2: guard: without the input, a database that holds no flag gets inline blocks', async () => {
        const encoder = new RisuSaveEncoder()

        await encoder.init(baseTree([fullCharacter(uid('input-f'), 'A')]), { compression: false })

        expect(blockTypes(encoder)).toEqual([BLOCK.CHARACTER_WITH_CHAT])
    })

    test('E2: guard: without the input, set follows the database flag as well', async () => {
        h.db = { enableRemoteSaving: true }
        const first = uid('input-g')
        const second = uid('input-h')
        const encoder = new RisuSaveEncoder()
        await encoder.init(baseTree([fullCharacter(first, 'A')]), { compression: false })

        await encoder.set(baseTree([fullCharacter(first, 'A'), fullCharacter(second, 'B')]), toSave([second]))

        expect(blockTypes(encoder)).toEqual([BLOCK.REMOTE, BLOCK.REMOTE])
    })
})
