/**
 * The boot archive pass (`src/ts/storage/bootArchivePass.ts`) reads units back
 * through `deps.readUnit`, the reader `readColdStorageItem`. A read that cannot
 * succeed on this page (no storage) and a read whose bytes are damaged reach it
 * as an error result that also carries a `kind`; the pass takes exactly the
 * branch it takes for a plain read error:
 *
 * - archiving: a unit that cannot be read back leaves that one character fully
 *   loaded, the pass carries on with the others and names the skipped character;
 * - enrichment: an upstream stub whose unit cannot be read is left alone and
 *   nothing is written.
 *
 * The real `RisuSaveEncoder`, `decodeRisuSave` and `NodeStorage` are used; the
 * Node server is `FakeNodeServer`, the web units go to an in-memory OPFS
 * directory and the Tauri host is the same in-memory model (see
 * `bootArchivePassHarness.ts`). These tests exercise the pass against those
 * models and say nothing about a real browser, the native file system or a real
 * Node server.
 *
 * Every test here is a guard: the pass branches on the status of the read alone,
 * so a no-storage or damaged read must take the branch a plain read error takes.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    baseTree,
    bootOnce,
    charactersOf,
    fullCharacter,
    groupCharacter,
    installedTree,
    unitValue,
    upstreamStub,
    worldFor,
    type Json,
    type RemoteLike,
    type World,
    type WorldHost,
    type WorldKit,
} from './bootArchivePassHarness'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    db: {} as Record<string, unknown>,
    remote: null as RemoteLike | null,
    keyPair: null as CryptoKeyPair | null,
    tauriFiles: new Map<string, Uint8Array>(),
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
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async (name: string, data: Uint8Array) => { h.tauriFiles.set(name, data.slice()) }),
    exists: vi.fn(async (name: string) => name === 'remotes' || h.tauriFiles.has(name)),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async (name: string) => h.tauriFiles.get(name)),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/util'), () => ({
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/alert'))

import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import { NodeStorage } from 'src/ts/storage/nodeStorage'
import { openBootArchiveSession } from 'src/ts/storage/bootArchivePass'

const kit: WorldKit = {
    Encoder: RisuSaveEncoder,
    decodeRisuSave: decodeRisuSave as WorldKit['decodeRisuSave'],
    openBootArchiveSession,
    NodeStorage: NodeStorage as unknown as WorldKit['NodeStorage'],
    setRemote: (remote) => { h.remote = remote },
}

const HOSTS = ['node', 'opfs', 'tauri'] as const

function useHost(host: WorldHost): void {
    h.platform.isNodeServer = host === 'node'
    h.platform.isTauri = host === 'tauri'
}

beforeEach(() => {
    localStorage.clear()
    h.platform.isNodeServer = false
    h.platform.isTauri = false
    h.db = {}
    h.remote = null
    h.tauriFiles.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

type ReadAnswer = () => Promise<
    | { status: 'error', error: unknown, kind?: 'unavailable' | 'damaged' }
>

/** Every unreadable read the reader can report, by cause. */
const UNREADABLE_READS: Array<[string, ReadAnswer]> = [
    ['no storage on the page', async () => ({ status: 'error', error: new Error('no storage'), kind: 'unavailable' })],
    ['a damaged copy', async () => ({ status: 'error', error: new Error('unexpected EOF'), kind: 'damaged' })],
    ['a read error with no cause', async () => ({ status: 'error', error: new Error('disk unavailable') })],
]

describe('boot archive pass: a unit that cannot be read back is skipped whatever the cause', () => {
    test.each(UNREADABLE_READS)('%s at the second of three leaves it full, archives the first and third and names it', async (_label, answer) => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree(['a', 'b', 'c'].map((id) => fullCharacter(id, id.toUpperCase())), { archiveCharacters: true }))
        let reads = 0
        world.units.readOverride = async (_key, real) => {
            reads++
            return reads === 2 ? answer() : real()
        }

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(3)
        expect(charactersOf(installedTree(result.outcome)).map((c) => !!c.coldstorage)).toEqual([true, false, true])
        expect(world.mainWrites.length).toBe(1)
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([
            { kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'B' }] },
        ])
    })
})

describe('boot archive pass: an upstream stub whose unit cannot be read is left alone whatever the cause', () => {
    const LEGACY_UNIT = '11111111-2222-4333-8444-555555555555'
    const GROUP_ID = 'group-up'
    const ENRICHMENT_FIELDS = ['coldVersion', 'coldChatCount', 'creatorNotes', 'lastInteraction', 'characters']

    function legacyStub(): Json {
        return { ...upstreamStub(GROUP_ID, 'Stub Name', LEGACY_UNIT), image: 'stub-image.png', coldStoragedChats: ['chat-key-stub'] }
    }

    function unitGroup(): Json {
        return groupCharacter(GROUP_ID, 'Name In Unit', ['member-1', 'member-2'], {
            image: 'unit-image.png',
            chatPage: 4,
            coldStoragedChats: ['key-in-unit'],
            desc: 'DESCRIPTION-MARKER',
        })
    }

    async function legacyWorld(host: WorldHost, archive: boolean): Promise<World> {
        useHost(host)
        const stub = legacyStub()
        const world = await worldFor(kit, host, baseTree([stub], { archiveCharacters: archive }))
        await world.seedUnit(stub.coldstorage as string, unitValue(unitGroup()))
        return world
    }

    const CASES = HOSTS.flatMap((host) => [true, false].flatMap((archive) => UNREADABLE_READS.map(([label, answer]) => [host, archive, label, answer] as [WorldHost, boolean, string, ReadAnswer])))

    test.each(CASES)('%s, archive %s, %s: the stub gets no enrichment field and keeps its own fields, and nothing is written', async (host, archive, _label, answer) => {
        const world = await legacyWorld(host, archive)
        world.units.readOverride = answer

        const boot = await bootOnce(world)

        const slot = charactersOf(installedTree(boot.outcome)).find((c) => c.chaId === GROUP_ID) as Json
        for (const field of ENRICHMENT_FIELDS) {
            expect(slot, field).not.toHaveProperty(field)
        }
        expect(slot.type).toBe(legacyStub().type)
        expect(slot.name).toBe('Stub Name')
        expect(slot.coldstorage).toBe(LEGACY_UNIT)
        expect(world.mainWrites.length).toBe(0)
        expect(world.units.writes.length).toBe(0)
    })
})
