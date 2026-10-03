/**
 * The block check made before the boot archive pass's commit overwrites the
 * main file (`checkCommittedBlocks` in `src/ts/storage/bootArchivePass.ts`).
 *
 * The files under test are built by the real `RisuSaveEncoder` (and, for a
 * missing directory entry, by `composeSave`); remote character files live in
 * an in-memory store. The check must give its verdict from the file's own
 * blocks and never read a remote file.
 *
 * Tests titled `guard:` assert that a well-formed encoding is accepted; they
 * pass with and without the check. The others assert rejections only the
 * check makes.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
    BLOCK,
    baseTree,
    currentStub,
    encodeAsSaveDb,
    fullCharacter,
    memoryRemote,
    uid,
    type EncoderClass,
    type Json,
    type RemoteLike,
} from './bootArchivePassHarness'
import { composeSave } from './manualCleanupHarness'
import type { ForageLike } from './forageBackedStore'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    db: {} as Record<string, unknown>,
    remote: null as null | (RemoteLike & { files: Map<string, Uint8Array> }),
    remoteReads: [] as string[],
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
        getItem: (key: string) => {
            h.remoteReads.push(key)
            return (h.remote as RemoteLike).getItem(key)
        },
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
import { checkCommittedBlocks, type CommittedCharacterExpectation } from 'src/ts/storage/bootArchivePass'

const UNIT = '11111111-2222-4333-8444-555555555555'
const Encoder: EncoderClass = RisuSaveEncoder

beforeEach(() => {
    h.platform.isNodeServer = false
    h.platform.isTauri = false
    h.db = {}
    h.remote = memoryRemote()
    h.remoteReads = []
})

function plain(chaId: string): CommittedCharacterExpectation {
    return { chaId, archivedUnitKey: null }
}

function archived(chaId: string, unitKey: string, stub: Json): CommittedCharacterExpectation {
    return { chaId, archivedUnitKey: unitKey, stubJson: JSON.stringify(stub) }
}

function withRemoteSaving<T>(run: () => Promise<T>): Promise<T> {
    h.platform.isNodeServer = true
    h.db = { enableRemoteSaving: true }
    return run().finally(() => {
        h.platform.isNodeServer = false
        h.db = {}
    })
}

describe('checkCommittedBlocks', () => {
    test('guard: accepts a well-formed encoding of one stub and two full characters', async () => {
        const stub = currentStub('b', 'B', UNIT)
        const bytes = await encodeAsSaveDb(Encoder, baseTree([fullCharacter('a', 'A'), stub, fullCharacter('c', 'C')]))

        const result = await checkCommittedBlocks(bytes, [plain('a'), archived('b', UNIT, stub), plain('c')])

        expect(result).toEqual({ ok: true })
    })

    test('rejects an encoding that is missing a character block', async () => {
        const bytes = await encodeAsSaveDb(Encoder, baseTree([fullCharacter('a', 'A'), fullCharacter('c', 'C')]))

        const result = await checkCommittedBlocks(bytes, [plain('a'), plain('b'), plain('c')])

        expect(result).toMatchObject({ ok: false })
    })

    test('rejects an encoding that dropped the second holder of a duplicated chaId', async () => {
        const bytes = await encodeAsSaveDb(Encoder, baseTree([fullCharacter('d', 'First'), fullCharacter('d', 'Second')]))

        const result = await checkCommittedBlocks(bytes, [plain('d'), plain('d')])

        expect(result).toMatchObject({ ok: false })
    })

    test('rejects an encoding whose character blocks are in another order', async () => {
        const bytes = await encodeAsSaveDb(Encoder, baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B'), fullCharacter('c', 'C')]))

        const result = await checkCommittedBlocks(bytes, [plain('b'), plain('a'), plain('c')])

        expect(result).toMatchObject({ ok: false })
    })

    test('rejects an encoding that holds a character block no slot expects', async () => {
        const bytes = await encodeAsSaveDb(Encoder, baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B'), fullCharacter('c', 'C')]))

        const result = await checkCommittedBlocks(bytes, [plain('a'), plain('b')])

        expect(result).toMatchObject({ ok: false })
    })

    test('rejects an archived slot whose block is still the full character', async () => {
        const bytes = await encodeAsSaveDb(Encoder, baseTree([fullCharacter('a', 'A')]))

        const result = await checkCommittedBlocks(bytes, [archived('a', UNIT, currentStub('a', 'A', UNIT))])

        expect(result).toMatchObject({ ok: false })
    })

    test('rejects an archived slot whose stub carries another unit key', async () => {
        const bytes = await encodeAsSaveDb(Encoder, baseTree([currentStub('a', 'A', '99999999-2222-4333-8444-555555555555')]))

        const result = await checkCommittedBlocks(bytes, [archived('a', UNIT, currentStub('a', 'A', UNIT))])

        expect(result).toMatchObject({ ok: false })
    })

    test('rejects a file whose loadouts block is empty, as an encoder writes it for a tree without loadouts', async () => {
        const tree = baseTree([fullCharacter('a', 'A')]) as unknown as Json
        delete tree.loadouts
        const bytes = await encodeAsSaveDb(Encoder, tree as unknown as ReturnType<typeof baseTree>)

        const result = await checkCommittedBlocks(bytes, [plain('a')])

        expect(result).toMatchObject({ ok: false })
    })

    test('rejects a file whose root names a directory block the file does not hold', async () => {
        const encoder = new RisuSaveEncoder()
        const parts = [
            { name: 'root', type: BLOCK.ROOT, data: JSON.stringify({ formatversion: 5, __directory: ['preset', 'modules', 'loadouts', 'plugins', 'a', 'config', 'ghost'] }) },
            { name: 'preset', type: BLOCK.BOTPRESET, data: '[]' },
            { name: 'modules', type: BLOCK.MODULES, data: '[]' },
            { name: 'loadouts', type: BLOCK.LOADOUTS, data: '[]' },
            { name: 'plugins', type: BLOCK.PLUGINS, data: '[]' },
            { name: 'a', type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify(fullCharacter('a', 'A')) },
            { name: 'config', type: BLOCK.CONFIG, data: '{"version":1}' },
        ]
        const bytes = (await composeSave(encoder, parts)).bytes

        const result = await checkCommittedBlocks(bytes, [plain('a')])

        expect(result).toMatchObject({ ok: false })
    })
})

/** A hand-composed save with one character block `a`; `overrides` replace the payload of the named fixed block. */
async function composeWithBlocks(overrides: Record<string, string> = {}, character: { type: number, data: string } = { type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify(fullCharacter('a', 'A')) }): Promise<Uint8Array> {
    const payload = (name: string, fallback: string) => overrides[name] ?? fallback
    const parts = [
        { name: 'root', type: BLOCK.ROOT, data: payload('root', JSON.stringify({ formatversion: 5, __directory: ['preset', 'modules', 'loadouts', 'plugins', 'a', 'config'] })) },
        { name: 'preset', type: BLOCK.BOTPRESET, data: payload('preset', '[]') },
        { name: 'modules', type: BLOCK.MODULES, data: payload('modules', '[]') },
        { name: 'loadouts', type: BLOCK.LOADOUTS, data: payload('loadouts', '[]') },
        { name: 'plugins', type: BLOCK.PLUGINS, data: payload('plugins', '[]') },
        { name: 'a', type: character.type, data: character.data },
        { name: 'config', type: BLOCK.CONFIG, data: payload('config', '{"version":1}') },
    ]
    return (await composeSave(new RisuSaveEncoder(), parts)).bytes
}

async function remoteHash(json: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

describe('checkCommittedBlocks on the shape of the fixed blocks', () => {
    test.each([
        ['loadouts', '{}'],
        ['modules', '"text"'],
        ['plugins', 'null'],
        ['preset', '{"x":1}'],
        ['root', '[]'],
    ])('guard: rejects a file whose %s block parses to JSON of the wrong shape (%s)', async (name, data) => {
        expect(await checkCommittedBlocks(await composeWithBlocks(), [plain('a')])).toEqual({ ok: true })

        const result = await checkCommittedBlocks(await composeWithBlocks({ [name]: data }), [plain('a')])

        expect(result).toMatchObject({ ok: false })
    })
})

describe('checkCommittedBlocks on the name inside a remote pointer', () => {
    const stub = currentStub('a', 'A', UNIT)

    async function pointerFile(pointerName: string): Promise<Uint8Array> {
        const hash = await remoteHash(JSON.stringify(stub))
        return composeWithBlocks({}, { type: BLOCK.REMOTE, data: JSON.stringify({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name: pointerName, hash }) })
    }

    test('guard: accepts a pointer that names its own character and its stub by hash', async () => {
        expect(await checkCommittedBlocks(await pointerFile('a'), [archived('a', UNIT, stub)])).toEqual({ ok: true })
    })

    test('guard: rejects a pointer whose name differs from the character it stands for, although its hash names the stub', async () => {
        const result = await checkCommittedBlocks(await pointerFile('another-name'), [archived('a', UNIT, stub)])

        expect(result).toMatchObject({ ok: false })
    })

    test('guard: rejects a pointer of a full slot whose name differs from the character it stands for', async () => {
        const result = await checkCommittedBlocks(await pointerFile('another-name'), [plain('a')])

        expect(result).toMatchObject({ ok: false })
    })
})

describe('checkCommittedBlocks on remote character blocks', () => {
    test('guard: accepts remote pointers and reads no remote file', async () => {
        const ids = [uid('check-a'), uid('check-b')]
        const stub = currentStub(ids[1], 'B', UNIT)
        const bytes = await withRemoteSaving(() => encodeAsSaveDb(Encoder, baseTree([fullCharacter(ids[0], 'A'), stub])))
        h.remoteReads = []

        const result = await checkCommittedBlocks(bytes, [plain(ids[0]), archived(ids[1], UNIT, stub)])

        expect(result).toEqual({ ok: true })
        expect(h.remoteReads).toEqual([])
    })

    test('rejects an archived slot whose remote pointer names a different stub than the one the pass encoded, without reading a remote file', async () => {
        const ids = [uid('check-c'), uid('check-d')]
        const stub = currentStub(ids[1], 'B', UNIT)
        const bytes = await withRemoteSaving(() => encodeAsSaveDb(Encoder, baseTree([fullCharacter(ids[0], 'A'), stub])))
        h.remoteReads = []

        const result = await checkCommittedBlocks(bytes, [plain(ids[0]), archived(ids[1], UNIT, currentStub(ids[1], 'Another Name', UNIT))])

        expect(result).toMatchObject({ ok: false })
        expect(h.remoteReads).toEqual([])
    })

    test('F5: rejects an encoding with a missing character block without reading any remote file', async () => {
        const ids = [uid('check-e'), uid('check-f'), uid('check-g')]
        const bytes = await withRemoteSaving(() => encodeAsSaveDb(Encoder, baseTree([fullCharacter(ids[0], 'A'), fullCharacter(ids[2], 'C')])))
        h.remoteReads = []

        const result = await checkCommittedBlocks(bytes, ids.map(plain))

        expect(result).toMatchObject({ ok: false })
        expect(h.remoteReads).toEqual([])
    })
})
