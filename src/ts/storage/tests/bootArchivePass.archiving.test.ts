/**
 * The boot archive pass, archiving (`src/ts/storage/bootArchivePass.ts`):
 * which characters become units and stubs, what the unit holds, what is
 * committed and installed, and what the pass leaves alone.
 *
 * The real `RisuSaveEncoder`, `decodeRisuSave` and `NodeStorage` are used; the
 * Node server is `FakeNodeServer`, the web units go to an in-memory OPFS
 * directory and the web main file to an in-memory LocalForage-like store (see
 * `bootArchivePassHarness.ts`). These tests exercise the pass against those
 * in-memory models; they say nothing about the Tauri file system, the real
 * Node server, or a browser's OPFS.
 *
 * Tests titled `guard:` assert that something does not happen; they pass with
 * and without the pass and protect behaviour the pass must keep. The others
 * assert behaviour only the pass has.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    BLOCK,
    chaIdsOf,
    characterBlocks,
    COLD_POINTER_HEADER,
    baseTree,
    bytesEqual,
    charactersOf,
    currentStub,
    encodeAsSaveDb,
    encodeUpstreamEraFile,
    fullCharacter,
    installedTree,
    jsonOf,
    setupWorld,
    uid,
    upstreamStub,
    UUID_V4,
    worldFor,
    bootOnce,
    blockJson,
    type Json,
    type RemoteLike,
    type World,
    type WorldKit,
} from './bootArchivePassHarness'
import type { ForageLike } from './forageBackedStore'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    db: {} as Record<string, unknown>,
    remote: null as RemoteLike | null,
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

import { RisuSaveEncoder, decodeRisuSave, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { getAppStore } from 'src/ts/storage/store/appStore'
import { withRemoteCharacters } from './remoteFileFixture'
import { NodeStorage } from 'src/ts/storage/nodeStorage'
import { openBootArchiveSession } from 'src/ts/storage/bootArchivePass'

const kit: WorldKit = {
    Encoder: RisuSaveEncoder,
    decodeRisuSave: decodeRisuSave as WorldKit['decodeRisuSave'],
    openBootArchiveSession,
    NodeStorage: NodeStorage as unknown as WorldKit['NodeStorage'],
    setRemote: (remote) => { h.remote = remote },
}

const HOSTS = ['node', 'opfs'] as const
type Host = typeof HOSTS[number]

function useHost(host: Host): void {
    h.platform.isNodeServer = host === 'node'
    h.platform.isTauri = false
}

async function legacyEncode(_Encoder: unknown, tree: unknown): Promise<Uint8Array> {
    return encodeRisuSaveLegacy(tree)
}

beforeEach(() => {
    localStorage.clear()
    h.platform.isNodeServer = false
    h.platform.isTauri = false
    h.db = {}
    h.remote = null
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('boot archive pass: archiving eligible characters', () => {
    test.each(HOSTS)('A1 (%s): writes one unit per eligible character, puts a stub in each slot, commits once and installs the committed tree', async (host) => {
        useHost(host)
        const world = await worldFor(kit, host, baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B'), fullCharacter('c', 'C')]))

        const boot = await bootOnce(world)

        const installed = installedTree(boot.outcome)
        const slots = charactersOf(installed)
        expect(slots.map((c) => c.chaId)).toEqual(['a', 'b', 'c'])
        const keys = slots.map((c) => c.coldstorage as string)
        expect(keys.every((k) => typeof k === 'string' && UUID_V4.test(k))).toBe(true)
        expect(new Set(keys).size).toBe(3)
        expect(world.units.writes.map((w) => w.key).sort()).toEqual([...keys].sort())
        expect(world.units.writtenCharacters().map((c) => c.chaId)).toEqual(['a', 'b', 'c'])
        expect(world.units.writes.every((w) => Object.keys(JSON.parse(w.json)).join() === 'character')).toBe(true)
        expect(slots[0].name).toBe('A')
        expect((slots[0].chats as Json[]).length).toBe(1)
        expect(((slots[0].chats as Json[])[0].message as Json[])[0].data).toBe('')

        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(jsonOf(committed.characters)).toEqual(jsonOf(installed.characters))
        expect(boot.outcome.kind === 'install' && boot.outcome.noteBytes, 'a commit leaves no main file to record').toBeNull()
        expect(boot.outcome.kind === 'install' && boot.outcome.committed).toBe(true)
        expect(world.currentMain(), 'the converted main file is moved aside').toBeNull()
        const stored = await decodeRisuSave(await world.committedFile() as Uint8Array, { strict: true })
        expect(jsonOf(stored.characters)).toEqual(jsonOf(installed.characters))
    })

    test('reports English progress that carries the count while archiving', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B'), fullCharacter('c', 'C')]))

        await bootOnce(world)

        expect(world.progressTexts.length).toBeGreaterThan(0)
        expect(world.progressTexts.some((t) => /\b3\b/.test(t))).toBe(true)
    })

    test('builds each stub from the character as it was read back, not from the live object', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]))
        world.units.readOverride = async (_key, real) => {
            const result = await real()
            if (result.status === 'ok') {
                const character = (result.value as { character: Json }).character
                character.name = 'Name From Unit'
                character.creatorNotes = 'Notes From Unit'
                character.chats = [{ id: 'u1', message: [], note: '', name: '', localLore: [] }, { id: 'u2', message: [], note: '', name: '', localLore: [] }]
            }
            return result
        }

        const boot = await bootOnce(world)

        const slots = charactersOf(installedTree(boot.outcome))
        expect(world.units.writes.length).toBe(2)
        expect(slots.map((c) => c.name)).toEqual(['Name From Unit', 'Name From Unit'])
        expect(slots.map((c) => c.creatorNotes)).toEqual(['Notes From Unit', 'Notes From Unit'])
        expect(slots.map((c) => c.coldChatCount)).toEqual([2, 2])
    })

    test('gives the placeholder chat of every stub a truthy id', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]))

        const boot = await bootOnce(world)

        const slots = charactersOf(installedTree(boot.outcome))
        expect(slots.every((c) => !!c.coldstorage)).toBe(true)
        expect(slots.every((c) => !!(c.chats as Json[])[0].id)).toBe(true)
    })

    test('keeps every slot in its place when only some are archived', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([
            fullCharacter('a', 'A'),
            fullCharacter('t', 'Trashed', { trashTime: 123 }),
            fullCharacter('b', 'B'),
            fullCharacter('§playground', 'Playground'),
            fullCharacter('c', 'C'),
        ]))

        const boot = await bootOnce(world)

        const slots = charactersOf(installedTree(boot.outcome))
        expect(slots.map((c) => c.chaId)).toEqual(['a', 't', 'b', '§playground', 'c'])
        expect(slots.map((c) => !!c.coldstorage)).toEqual([true, false, true, false, true])
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(chaIdsOf(committed)).toEqual(['a', 't', 'b', '§playground', 'c'])
    })

    test('A3: a pointer chat and a legacy error-text chat reach the unit unchanged and the stub lists the pointer key', async () => {
        useHost('opfs')
        const pointerChat = { id: 'chat-pointer', message: [{ time: 1, data: COLD_POINTER_HEADER + 'inner-pointer-key', role: 'char' }], note: '', name: '', localLore: [] }
        const errorChat = { id: 'chat-error', message: [{ time: 1, data: '[Cold storage data could not be loaded. Key: inner-error-key]', role: 'char' }], note: '', name: '', localLore: [] }
        const normalChat = { id: 'chat-normal', message: [{ time: 1, data: 'plain', role: 'user' }], note: '', name: '', localLore: [] }
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('a', 'A', { chats: [normalChat, pointerChat, errorChat] })]))

        const boot = await bootOnce(world)

        const slots = charactersOf(installedTree(boot.outcome))
        expect(world.units.writes.length).toBe(1)
        const unit = world.units.writtenCharacters()[0]
        const chats = unit.chats as Json[]
        expect(chats.map((c) => c.message)).toEqual([normalChat.message, pointerChat.message, errorChat.message])
        expect(slots[0].coldStoragedChats).toEqual(['inner-pointer-key'])
    })

    test('A4: the unit holds the per-chat streaming reset and the per-character defaults', async () => {
        useHost('opfs')
        const streamingChat = { id: 'chat-s', isStreaming: true, activeStreamingDisplayOptimizationMode: 'fast', message: [{ time: 1, data: 'x', role: 'char' }], note: '', name: '', localLore: [] }
        const bare = { chaId: 'a', name: 'A', type: 'character', chats: [streamingChat] }
        const world = await worldFor(kit, 'opfs', baseTree([bare]))

        await bootOnce(world)

        expect(world.units.writes.length).toBe(1)
        const unit = world.units.writtenCharacters()[0]
        const chat = (unit.chats as Json[])[0]
        expect(chat.isStreaming).toBe(false)
        expect(chat).not.toHaveProperty('activeStreamingDisplayOptimizationMode')
        expect(unit.bias).toEqual([])
        expect(unit.tags).toEqual([])
        expect(unit.customscript).toEqual([])
        expect(unit.globalLore).toEqual([])
        expect(unit.viewScreen).toBe('none')
        expect(unit.utilityBot).toBe(false)
        expect(unit.scenario).toBe('')
    })

    test.each(HOSTS)('A5 (%s): guard: a second boot over the committed file writes no unit and no commit', async (host) => {
        useHost(host)
        const world = await worldFor(kit, host, baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]))
        const first = await bootOnce(world)
        const unitWrites = world.units.writes.length
        const commits = world.mainWrites.length

        const second = await bootOnce(world)

        expect(world.units.writes.length).toBe(unitWrites)
        expect(world.mainWrites.length).toBe(commits)
        expect(jsonOf(charactersOf(installedTree(second.outcome)))).toEqual(jsonOf(charactersOf(installedTree(first.outcome))))
    })
})

describe('boot archive pass: slots the pass leaves alone', () => {
    const UNIT = '11111111-2222-4333-8444-555555555555'
    const rows: [string, () => Json][] = [
        ['a trashed character', () => fullCharacter('trashed', 'Trashed', { trashTime: 123 })],
        ['the hidden playground character', () => fullCharacter('§playground', 'Playground')],
        ['the hidden temporary character', () => fullCharacter('§temp', 'Temp')],
        ['a current stub', () => currentStub('current-stub', 'Current Stub', UNIT, { coldStoragedChats: ['inner'] })],
    ]

    test.each(rows)('guard: %s stays as it is and gets no unit', async (_label, make) => {
        useHost('opfs')
        const row = make()
        const world = await worldFor(kit, 'opfs', baseTree([row, fullCharacter('x', 'X')]))

        const boot = await bootOnce(world)

        const kept = charactersOf(installedTree(boot.outcome)).find((c) => c.chaId === row.chaId) as Json
        expect(kept).toBeDefined()
        expect(kept.name).toBe(row.name)
        expect(kept.coldstorage).toBe(row.coldstorage)
        expect(kept.coldStoragedChats).toEqual(row.coldStoragedChats)
        expect(kept.trashTime).toBe(row.trashTime)
        expect(world.units.writtenCharacters().some((c) => c.chaId === row.chaId)).toBe(false)
        expect(world.units.writes.every((w) => w.key !== UNIT)).toBe(true)
    })

    test('guard: an upstream stub whose unit is not stored gets no unit and no enrichment field, and keeps its name, image, ids, unit key and trash state', async () => {
        useHost('opfs')
        const row = upstreamStub('upstream-stub', 'Upstream Stub', UNIT)
        const world = await worldFor(kit, 'opfs', baseTree([row, fullCharacter('x', 'X')]))
        expect(await world.units.keys()).toEqual([])

        const boot = await bootOnce(world)

        const kept = charactersOf(installedTree(boot.outcome)).find((c) => c.chaId === row.chaId) as Json
        expect(kept).toBeDefined()
        // The boot's id repair may give the placeholder chat an id, so the chat is not compared.
        for (const field of ['coldVersion', 'coldChatCount', 'creatorNotes', 'lastInteraction', 'characters']) {
            expect(kept, field).not.toHaveProperty(field)
        }
        expect(kept.type).toBe(row.type)
        expect(kept.name).toBe(row.name)
        expect(kept.image).toBe(row.image)
        expect(kept.chaId).toBe(row.chaId)
        expect(kept.coldstorage).toBe(row.coldstorage)
        expect(kept.coldStoragedChats).toEqual(row.coldStoragedChats)
        expect(kept).not.toHaveProperty('trashTime')
        expect(world.units.writtenCharacters().some((c) => c.chaId === row.chaId)).toBe(false)
        expect(world.units.writes.every((w) => w.key !== UNIT)).toBe(true)
        expect(await world.units.keys()).not.toContain(UNIT)
    })

    test('archives both holders of a duplicated chaId under distinct ids', async () => {
        useHost('opfs')
        const world = await worldFor(
            kit,
            'opfs',
            baseTree([fullCharacter('dup', 'First'), fullCharacter('dup', 'Second')]),
            {},
            legacyEncode,
        )

        const boot = await bootOnce(world)

        const slots = charactersOf(installedTree(boot.outcome))
        expect(slots.map((c) => c.name)).toEqual(['First', 'Second'])
        expect(new Set(slots.map((c) => c.chaId)).size).toBe(2)
        expect(slots[0].chaId).toBe('dup')
        expect(slots.every((c) => !!c.coldstorage)).toBe(true)
        expect(world.units.writes.length).toBe(2)
        expect(world.units.writtenCharacters().map((c) => c.chaId)).toEqual(slots.map((c) => c.chaId))
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(chaIdsOf(committed)).toEqual(slots.map((c) => c.chaId))
    })

    test('one malformed slot never stops the pass: the others are archived and a null or non-object slot is dropped', async () => {
        useHost('opfs')
        const group = { chaId: 'g', type: 'group', name: 'Group', chats: [], chatPage: 0 }
        const numericNotes = fullCharacter('n', 'Numeric', { creatorNotes: 42 })
        const noChats = { chaId: 'm', type: 'character', name: 'NoChats' }
        const world = await worldFor(
            kit,
            'opfs',
            baseTree([null, group, 'garbage', numericNotes, 7, noChats, fullCharacter('ok', 'Ok')]),
            {},
            legacyEncode,
        )

        const boot = await bootOnce(world)

        const slots = charactersOf(installedTree(boot.outcome))
        expect(slots.map((c) => c?.chaId)).toEqual(['g', 'n', 'm', 'ok'])
        expect(slots.every((c) => !!c?.coldstorage)).toBe(true)
        expect(slots.every((c) => typeof c?.creatorNotes === 'string')).toBe(true)
        expect(slots[0]?.type).toBe('group')
        expect(world.units.writes.length).toBe(4)
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(chaIdsOf(committed)).toEqual(['g', 'n', 'm', 'ok'])
    })
})

describe('boot archive pass: what the committed and installed tree hold besides the slots', () => {
    test('drops the account field and keeps the container fields, in the committed file and the installed tree alike', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('a', 'A')], { account: { token: 'secret' }, mainPrompt: 'kept' }))

        const boot = await bootOnce(world)

        const installed = installedTree(boot.outcome)
        expect(installed).not.toHaveProperty('account')
        expect(installed.mainPrompt).toBe('kept')
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(committed).not.toHaveProperty('account')
        expect(committed.mainPrompt).toBe('kept')
        expect(committed.plugins).toEqual([])
        expect(committed.loadouts).toEqual([])
        expect(committed.modules).toEqual([])
    })
})

describe('boot archive pass: committed character blocks follow remote saving', () => {
    test('E1: with remote saving on, the committed character blocks are inline and the pass writes no remote file', async () => {
        useHost('node')
        const ids = [uid('remote-a'), uid('remote-b')]
        const tree = baseTree(ids.map((id) => fullCharacter(id, `Name ${id}`)), { enableRemoteSaving: true })
        const world = await setupWorld(kit, 'node', null)
        // The legacy main file of a profile that had Remote Saving on: its characters are remote pointers.
        const store = await getAppStore()
        world.seedMain(await withRemoteCharacters(await encodeAsSaveDb(RisuSaveEncoder, tree), ids, async (key, bytes) => { await store.write(key, bytes, 'unconditional') }))
        h.db = { enableRemoteSaving: true }
        const remotesBefore = (world.server as NonNullable<World['server']>).keysWithPrefix('remotes/').sort()
        expect(remotesBefore.length, 'the fixture holds remote files for the pass to resolve').toBe(2)

        const boot = await bootOnce(world)

        expect(boot.outcome.kind).toBe('install')
        expect(world.mainWrites.length).toBe(1)
        const blocks = characterBlocks(world.mainWrites[0])
        expect(blocks.map((b) => b.name)).toEqual(ids)
        expect(blocks.every((b) => b.type === BLOCK.CHARACTER_WITH_CHAT)).toBe(true)
        expect((world.server as NonNullable<World['server']>).keysWithPrefix('remotes/').sort()).toEqual(remotesBefore)
        const committed = await decodeRisuSave(await world.committedFile() as Uint8Array, { strict: true })
        expect(chaIdsOf(committed)).toEqual(ids)
    })

    test.each([
        ['node', false],
        ['opfs', true],
    ] as const)('%s with remote saving %s: the committed character blocks are inline', async (host, flag) => {
        useHost(host)
        const world = await worldFor(kit, host, baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')], flag ? { enableRemoteSaving: true } : {}))

        await bootOnce(world)

        expect(world.mainWrites.length).toBe(1)
        const blocks = characterBlocks(world.mainWrites[0])
        expect(blocks.map((b) => b.name)).toEqual(['a', 'b'])
        expect(blocks.every((b) => b.type === BLOCK.CHARACTER_WITH_CHAT)).toBe(true)
    })
})

describe('boot archive pass: an upstream-era save', () => {
    test.each(HOSTS)('F4 (%s): a format-5 file with no loadouts or modules block is archived, commits a strictly decodable file, and a second boot writes nothing', async (host) => {
        useHost(host)
        const tree = baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]) as unknown as Json
        delete tree.loadouts
        delete tree.modules
        const world = await worldFor(kit, host, tree as unknown as ReturnType<typeof baseTree>, {}, encodeUpstreamEraFile)
        const original = await decodeRisuSave(world.currentMain() as Uint8Array, { strict: true })
        expect(original).not.toHaveProperty('loadouts')

        const first = await bootOnce(world)

        expect(first.outcome.kind).toBe('install')
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(chaIdsOf(committed)).toEqual(['a', 'b'])
        expect(charactersOf(committed).every((c) => !!c.coldstorage)).toBe(true)
        expect(committed.loadouts).toEqual([])
        expect(committed.modules).toEqual([])
        const unitWrites = world.units.writes.length

        await bootOnce(world)

        expect(world.units.writes.length).toBe(unitWrites)
        expect(world.mainWrites.length).toBe(1)
    })
})
