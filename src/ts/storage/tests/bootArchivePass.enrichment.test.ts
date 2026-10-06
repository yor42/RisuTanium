/**
 * The boot archive pass, enrichment (`src/ts/storage/bootArchivePass.ts`): a
 * stub the upstream application wrote (no `coldVersion`, the type always
 * `'character'`, no description, no chat count) is rewritten from its unit with
 * the fields the fork's own stubs carry, on a profile with archiving on and on
 * a profile with archiving off, and committed through the pass's commit path.
 *
 * The real `RisuSaveEncoder`, `decodeRisuSave` and `NodeStorage` are used; the
 * Node server is `FakeNodeServer`, the web units go to an in-memory OPFS
 * directory and the web main file to an in-memory LocalForage-like store (see
 * `bootArchivePassHarness.ts`). The Tauri host here is the same in-memory model
 * with an in-memory `@tauri-apps/plugin-fs` for remote character files. These
 * tests exercise the pass against those models; they say nothing about the
 * native file system, the real Node server, or a browser's OPFS.
 *
 * A fallback boot (the main file did not decode, or decoded only loosely) never
 * reaches the pass, so no enrichment can run on it. That gate is bootstrap's
 * and is pinned in `bootstrap.archivePass.test.ts` and
 * `bootstrap.archivePassTauri.test.ts` (the tests that assert the pass is never
 * run for an undecodable or incomplete main file); it is not repeated here.
 *
 * Tests titled `guard:` assert behaviour that must not change; they pass with
 * and without enrichment and protect what the pass must keep doing or never do.
 * The others assert behaviour only enrichment has.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    BLOCK,
    baseTree,
    blockJson,
    bootOnce,
    bytesEqual,
    characterBlocks,
    charactersOf,
    currentStub,
    directWorld,
    encodeAsSaveDb,
    fullCharacter,
    groupCharacter,
    installedTree,
    jsonOf,
    makeTab,
    MAIN_KEY,
    noticeKinds,
    plugin,
    runDirect,
    setupWorld,
    startBoot,
    uid,
    unitValue,
    upstreamStub,
    worldFor,
    type BootResult,
    type Json,
    type RemoteLike,
    type World,
    type WorldHost,
    type WorldKit,
    type WorldOptions,
} from './bootArchivePassHarness'
import type { FakeNodeServer } from './manualCleanupHarness'
import type { ForageLike } from './forageBackedStore'
import type { BootArchiveEnvironment } from '../bootArchivePass'

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

// Remote character files go through the page's byte store: the Tauri model's
// files on a desktop boot, the mocked storage object otherwise.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver, forageOverMap } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    const tauriFiles = forageOverMap(h.tauriFiles)
    return appStoreModuleOver(() => h.platform.isTauri ? tauriFiles : forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

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

import { RisuSaveEncoder, decodeRisuSave, hashRemoteBlockContent } from 'src/ts/storage/risuSave'
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

const HOSTS = ['node', 'opfs', 'tauri'] as const

type Matrix = [host: WorldHost, label: string, archive: boolean][]

/** Every host with archiving on and with archiving off. */
const MATRIX: Matrix = HOSTS.flatMap((host) => [
    [host, 'archive on', true] as [WorldHost, string, boolean],
    [host, 'archive off', false] as [WorldHost, string, boolean],
])

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

//#region fixtures

const LEGACY_UNIT = '11111111-2222-4333-8444-555555555555'
const GROUP_ID = 'group-up'
const MEMBERS = ['member-1', 'member-2']
const TRASHED_AT = 1_700_000_001_000
const OLD_TRASH = Date.now() - 30 * 24 * 60 * 60 * 1000

/** The enrichment-only fields: none of them is on an upstream stub. */
const ENRICHMENT_FIELDS = ['coldVersion', 'coldChatCount', 'creatorNotes', 'lastInteraction', 'characters']

/** An upstream stub of a group: the type is `'character'`, as the upstream application writes it. */
function legacyStub(extra: Json = {}): Json {
    return {
        ...upstreamStub(GROUP_ID, 'Stub Name', LEGACY_UNIT),
        image: 'stub-image.png',
        coldStoragedChats: ['chat-key-stub'],
        ...extra,
    }
}

/** The group its unit holds. Its name, image and chat keys differ from the stub's, which keeps its own. */
function unitGroup(extra: Json = {}): Json {
    return groupCharacter(GROUP_ID, 'Name In Unit', MEMBERS, {
        image: 'unit-image.png',
        chatPage: 4,
        coldStoragedChats: ['key-in-unit'],
        desc: 'DESCRIPTION-MARKER',
        ...extra,
    })
}

interface LegacyOptions {
    stub?: Json
    /** The value stored under the stub's unit key; `null` stores nothing. */
    unit?: unknown
    others?: Json[]
    extra?: Json
    world?: WorldOptions
}

/** A world whose main file holds the upstream stub (and `others`) and whose unit storage holds the stub's unit. */
async function legacyWorld(host: WorldHost, archive: boolean, options: LegacyOptions = {}): Promise<World> {
    useHost(host)
    const stub = options.stub ?? legacyStub()
    const tree = baseTree([stub, ...(options.others ?? [])], { archiveCharacters: archive, ...options.extra })
    const world = await worldFor(kit, host, tree, options.world)
    const unit = options.unit === undefined ? unitValue(unitGroup()) : options.unit
    if (unit !== null) {
        await world.seedUnit(stub.coldstorage as string, unit)
    }
    return world
}

function slotOf(tree: ReturnType<typeof baseTree>, chaId: string = GROUP_ID): Json {
    return charactersOf(tree).find((c) => c.chaId === chaId) as Json
}

async function committedCharacters(world: World, index = 0): Promise<Json[]> {
    return charactersOf(await decodeRisuSave(world.mainWrites[index], { strict: true }))
}

/** `slot` is `legacyStub()` enriched from `unitGroup()`: the unit's type, members, description, last interaction and chat count, the stub's own everything else. */
function expectEnrichedGroup(slot: Json) {
    const stub = legacyStub()
    const unit = unitGroup()
    expect(slot.type).toBe('group')
    expect(slot.characters).toEqual(MEMBERS)
    expect(slot.creatorNotes).toBe(unit.creatorNotes)
    expect(slot.lastInteraction).toBe(unit.lastInteraction)
    expect(slot.coldChatCount).toBe(2)
    expect(slot.coldVersion).toBe(2)
    expect(slot.name).toBe(stub.name)
    expect(slot.image).toBe(stub.image)
    expect(slot.chaId).toBe(stub.chaId)
    expect(slot.coldstorage).toBe(stub.coldstorage)
    expect(slot.coldStoragedChats).toEqual(stub.coldStoragedChats)
    expect(slot.chatPage).toBe(0)
    expect(slot.firstMsgIndex).toBe(0)
    const chats = slot.chats as Json[]
    expect(chats.length).toBe(1)
    expect(chats[0].message).toEqual((stub.chats as Json[])[0].message)
    expect(typeof chats[0].id).toBe('string')
    expect(chats[0].id).toBeTruthy()
}

/** Nothing of the unit reached the stub and no enrichment field was added; the stub's own fields are as they were. */
function expectLeftAlone(slot: Json, stub: Json = legacyStub()) {
    for (const field of ENRICHMENT_FIELDS) {
        expect(slot, field).not.toHaveProperty(field)
    }
    expect(slot.type).toBe(stub.type)
    expect(slot.name).toBe(stub.name)
    expect(slot.image).toBe(stub.image)
    expect(slot.chaId).toBe(stub.chaId)
    expect(slot.coldstorage).toBe(stub.coldstorage)
    expect(slot.coldStoragedChats).toEqual(stub.coldStoragedChats)
    expect(slot.trashTime).toBe(stub.trashTime)
}

/** Another tab holds presence, so this boot's hold is refused. */
async function refuseHold(world: World): Promise<void> {
    const other = makeTab(world.core, 'B')
    await other.locks.tabPresenceLockAcquired
}

/**
 * A boot whose first unit read never settles, as when the page is killed during
 * it. Returns once that read has begun, or once the pass has settled without
 * reading. The hold the dead pass held is released so the next boot can take it.
 */
async function bootDyingAtFirstUnitRead(world: World): Promise<void> {
    world.units.readOverride = () => new Promise<never>(() => { })
    const { session, tree } = await startBoot(world)
    let settled = false
    void session.run({ tree }).then(() => { settled = true })
    await vi.waitFor(() => {
        if (!settled && !world.order.includes('unit-read')) {
            throw new Error('the pass has neither read a unit nor settled')
        }
    }, { timeout: 1000, interval: 5 })
    world.units.readOverride = undefined
    await session.release()
}

/** The encoder whose layout loses a character block, as an encoder fault would. */
class DroppingEncoder extends RisuSaveEncoder {
    override snapshotLayout() {
        const layout = super.snapshotLayout()
        if (layout === null) {
            return null
        }
        const at = layout.keys.indexOf('b')
        return { keys: layout.keys.filter((_, i) => i !== at), blocks: layout.blocks.filter((_, i) => i !== at) }
    }
}

/** The encoder that writes the enriched stub of `legacyStub()` with a chat count other than the one the pass built; every other slot is written as given. */
class StubAlteringEncoder extends RisuSaveEncoder {
    override async init(...args: Parameters<RisuSaveEncoder['init']>) {
        const [data, arg] = args
        const characters = data.characters.map((cha) => (cha.chaId === GROUP_ID ? { ...cha, coldChatCount: 99 } : cha))
        return super.init({ ...data, characters }, arg)
    }
}

//#endregion

describe('boot archive pass: enriching an upstream stub on a profile with archiving on', () => {
    test.each(HOSTS)('%s: an upstream group stub with a readable unit becomes a current group stub in one commit that decodes to the same stub', async (host) => {
        const world = await legacyWorld(host, true)

        const boot = await bootOnce(world)

        const installed = installedTree(boot.outcome)
        const slot = slotOf(installed)
        expectEnrichedGroup(slot)
        expect(slot).not.toHaveProperty('trashTime')
        expect(JSON.stringify(slot)).not.toContain('first chat of')
        expect(JSON.stringify(slot)).not.toContain('DESCRIPTION-MARKER')
        expect(world.mainWrites.length).toBe(1)
        expect(jsonOf(await committedCharacters(world))).toEqual(jsonOf(charactersOf(installed)))
        expect(world.units.writes.length).toBe(0)
        expect(await world.units.valueOf(LEGACY_UNIT)).toEqual(jsonOf(unitValue(unitGroup())))
        expect(noticeKinds(boot.outcome)).toEqual([])
        expect(installed.archiveCharacters).toBe(true)
    })

    test.each(HOSTS)('%s: the pass counts the enrichment as a pass of its own: the start is recorded before the first unit read and the count is reset after the commit', async (host) => {
        const world = await legacyWorld(host, true)

        await bootOnce(world)

        expect(world.order.filter((e) => e === 'start').length, 'start records').toBe(1)
        expect(world.order.indexOf('start')).toBeLessThan(world.order.indexOf('unit-read'))
        expect(world.order.lastIndexOf('reset')).toBeGreaterThan(world.order.lastIndexOf('main-write'))
        expect(world.breaker.strikes).toBe(0)
        expect(world.enrich.calls, 'the archive-off count is not used on an archive-on profile').toEqual([])
    })

    test.each(HOSTS)('%s: a legacy stub whose unit cannot be used still counts the pass: the start is recorded before the unit is read, and the pass resets the count when it returns', async (host) => {
        const world = await legacyWorld(host, true, { unit: null })
        world.breaker.strikes = 1

        const boot = await bootOnce(world)

        expect(world.order).toContain('start')
        expect(world.order).toContain('unit-read')
        expect(world.order.indexOf('start')).toBeLessThan(world.order.indexOf('unit-read'))
        expect(world.breaker.strikes).toBe(0)
        expect(world.mainWrites.length).toBe(0)
        expectLeftAlone(slotOf(installedTree(boot.outcome)))
    })

    test.each(HOSTS)('%s: a page killed during the enrichment read leaves no unit written by the pass, even with a character waiting to be archived', async (host) => {
        const world = await legacyWorld(host, true, { others: [fullCharacter('a', 'A')] })

        await bootDyingAtFirstUnitRead(world)

        expect(world.units.attempts).toBe(0)
        expect(world.units.writes.length).toBe(0)
        expect(world.breaker.strikes).toBe(1)
    })

    test.each(HOSTS)('%s: guard: a stub the unit cannot enrich is not committed on its own', async (host) => {
        const world = await legacyWorld(host, true, { unit: null })

        await bootOnce(world)

        expect(world.mainWrites.length).toBe(0)
        expect(world.units.writes.length).toBe(0)
    })
})

describe('boot archive pass: enriching an upstream stub on a profile with archiving off', () => {
    test.each(HOSTS)('%s: the same stub is enriched, no unit is written, the setting stays off and nothing is posted or recorded for archiving', async (host) => {
        const world = await legacyWorld(host, false)

        const boot = await bootOnce(world)

        const installed = installedTree(boot.outcome)
        expectEnrichedGroup(slotOf(installed))
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(committed.archiveCharacters).toBe(false)
        expect(installed.archiveCharacters).toBe(false)
        expect(jsonOf(charactersOf(committed))).toEqual(jsonOf(charactersOf(installed)))
        expect(world.units.attempts).toBe(0)
        expect(world.units.writes.length).toBe(0)
        expect(await world.units.valueOf(LEGACY_UNIT)).toEqual(jsonOf(unitValue(unitGroup())))
        expect(noticeKinds(boot.outcome)).toEqual([])
        expect(boot.outcome.kind === 'install' && boot.outcome.noteBytes, 'a commit leaves no main file to record').toBeNull()
        expect(world.breaker.calls, 'the archive strike count is not used').toEqual([])
    })

    test.each(HOSTS)('%s: the attempt is counted before the first unit read and the count is removed, not set to zero, when the attempt completes', async (host) => {
        const world = await legacyWorld(host, false)

        await bootOnce(world)

        expect(world.enrich.calls.filter((c) => c === 'start').length, 'start records').toBe(1)
        expect(world.order.indexOf('enrich-start')).toBeLessThan(world.order.indexOf('unit-read'))
        expect(world.order.lastIndexOf('enrich-clear')).toBeGreaterThan(world.order.lastIndexOf('main-write'))
        expect(world.enrich.stored).toBeNull()
    })

    test.each([
        ['an enrichable stub', {}],
        ['a stub whose unit is missing', { unit: null }],
    ] as [string, LegacyOptions][])('a completed attempt over %s removes a count left by an earlier failure', async (_label, options) => {
        const world = await legacyWorld('opfs', false, options)
        world.enrich.stored = '1'

        await bootOnce(world)

        expect(world.enrich.stored).toBeNull()
        expect(world.enrich.calls).toContain('clear')
    })

    test.each([true, false])('reports English progress for the enrichment that does not say it is archiving (archive %s)', async (archive) => {
        const world = await legacyWorld('opfs', archive)

        await bootOnce(world)

        expect(world.progressTexts).toContain('Updating archived characters 1/1')
        expect(world.progressTexts.some((t) => /archiving/i.test(t))).toBe(false)
    })

    test.each(HOSTS)('%s: guard: a stub the unit cannot enrich is not committed on its own', async (host) => {
        const world = await legacyWorld(host, false, { unit: null })

        const boot = await bootOnce(world)

        expect(world.mainWrites.length).toBe(0)
        expect(world.units.writes.length).toBe(0)
        expect(installedTree(boot.outcome).archiveCharacters).toBe(false)
    })
})

describe('boot archive pass: an enriched stub keeps the trash state of the stub, never the unit\'s', () => {
    // The startup purge reads only the installed stub's `trashTime`, and the boot runs the pass before the purge:
    // a `trashTime` copied from the unit onto a stub that has none would delete the character on that same boot.
    test.each(MATRIX)('%s, %s: a stub with no trashTime stays without one although its unit holds an old one, and is enriched', async (host, _label, archive) => {
        const world = await legacyWorld(host, archive, { unit: unitValue(unitGroup({ trashTime: OLD_TRASH })) })

        const boot = await bootOnce(world)

        const slot = slotOf(installedTree(boot.outcome))
        expect(slot.coldVersion).toBe(2)
        expect(slot.type).toBe('group')
        expect(slot).not.toHaveProperty('trashTime')
        expect(world.mainWrites.length).toBe(1)
        expect((await committedCharacters(world))[0]).not.toHaveProperty('trashTime')
    })

    test.each(MATRIX)('%s, %s: guard: a stub with no trashTime is not trashed because its unit holds an old one', async (host, _label, archive) => {
        const world = await legacyWorld(host, archive, { unit: unitValue(unitGroup({ trashTime: OLD_TRASH })) })

        const boot = await bootOnce(world)

        expect(slotOf(installedTree(boot.outcome))).not.toHaveProperty('trashTime')
        for (let i = 0; i < world.mainWrites.length; i++) {
            expect((await committedCharacters(world, i))[0]).not.toHaveProperty('trashTime')
        }
    })

    test.each([
        ['a unit with no trashTime', undefined],
        ['a unit with another trashTime', 5],
    ] as [string, number | undefined][])('a trashed stub stays trashed at its own time and is enriched, with %s', async (_label, unitTrash) => {
        const unit = unitValue(unitGroup(unitTrash === undefined ? {} : { trashTime: unitTrash }))
        const world = await legacyWorld('opfs', false, { stub: legacyStub({ trashTime: TRASHED_AT }), unit })

        const boot = await bootOnce(world)

        const slot = slotOf(installedTree(boot.outcome))
        expect(slot.coldVersion).toBe(2)
        expect(slot.trashTime).toBe(TRASHED_AT)
        expect((await committedCharacters(world))[0].trashTime).toBe(TRASHED_AT)
    })

    test.each([
        ['a unit with no trashTime', undefined],
        ['a unit with another trashTime', 5],
    ] as [string, number | undefined][])('guard: a trashed stub keeps its own trashTime, with %s', async (_label, unitTrash) => {
        const unit = unitValue(unitGroup(unitTrash === undefined ? {} : { trashTime: unitTrash }))
        const world = await legacyWorld('opfs', true, { stub: legacyStub({ trashTime: TRASHED_AT }), unit })

        const boot = await bootOnce(world)

        expect(slotOf(installedTree(boot.outcome)).trashTime).toBe(TRASHED_AT)
        for (let i = 0; i < world.mainWrites.length; i++) {
            expect((await committedCharacters(world, i))[0].trashTime).toBe(TRASHED_AT)
        }
    })
})

describe('boot archive pass: an upstream stub whose unit cannot enrich it is left alone', () => {
    interface Unenrichable {
        label: string
        unit?: unknown
        readFails?: boolean
    }

    const ROWS: Unenrichable[] = [
        { label: 'a unit that is missing', unit: null },
        { label: 'a unit whose read fails', readFails: true },
        { label: 'a unit with no character', unit: { notACharacter: true } },
        { label: 'a unit whose character is text', unit: { character: 'text' } },
        { label: 'a unit that is a list', unit: [{ id: 'a chat' }] },
        { label: 'a unit holding a character with another chaId', unit: unitValue(unitGroup({ chaId: 'someone-else' })) },
    ]

    const CASES = MATRIX.flatMap(([host, label, archive]) => ROWS.map((row) => [host, label, archive, row] as [WorldHost, string, boolean, Unenrichable]))

    test.each(CASES)('%s, %s, %s: guard: the stub gets no enrichment field and keeps its own fields, and nothing is written', async (host, _label, archive, row) => {
        const world = await legacyWorld(host, archive, { unit: row.unit })
        if (row.readFails) {
            world.units.readOverride = async () => ({ status: 'error', error: new Error('read failed') })
        }

        const boot = await bootOnce(world)

        expectLeftAlone(slotOf(installedTree(boot.outcome)))
        expect(world.mainWrites.length).toBe(0)
        expect(world.units.writes.length).toBe(0)
    })

    test('guard: a trashed stub whose unit cannot enrich it keeps its trashTime and gets no enrichment field', async () => {
        const stub = legacyStub({ trashTime: TRASHED_AT })
        const world = await legacyWorld('opfs', false, { stub, unit: unitValue(unitGroup({ chaId: 'someone-else', trashTime: 5 })) })

        const boot = await bootOnce(world)

        expectLeftAlone(slotOf(installedTree(boot.outcome)), stub)
        expect(world.mainWrites.length).toBe(0)
    })
})

describe('boot archive pass: an enriched stub is enriched once', () => {
    test.each(MATRIX)('%s, %s: guard: a second boot over the committed file reads no unit and writes no main file', async (host, _label, archive) => {
        const world = await legacyWorld(host, archive)
        await bootOnce(world)
        const reads = world.units.reads.length
        const writes = world.mainWrites.length
        const countCalls = world.enrich.calls.length
        const starts = world.breaker.calls.filter((c) => c === 'start').length

        const second = await bootOnce(world)

        expect(second.outcome.kind).toBe('install')
        expect(world.units.reads.length).toBe(reads)
        expect(world.mainWrites.length).toBe(writes)
        expect(world.enrich.calls.length).toBe(countCalls)
        expect(world.breaker.calls.filter((c) => c === 'start').length).toBe(starts)
    })

    test.each(MATRIX)('%s, %s: the second boot installs the enriched stub it reads from the committed file', async (host, _label, archive) => {
        const world = await legacyWorld(host, archive)
        await bootOnce(world)

        const second = await bootOnce(world)

        expectEnrichedGroup(slotOf(installedTree(second.outcome)))
    })
})

describe('boot archive pass: an archive-off profile with no upstream stub is left exactly as it is', () => {
    const NO_CHAT_ID = [{ message: [{ time: 1, data: 'hello', role: 'char' }], note: '', name: '', localLore: [] }]

    const ROWS: [string, () => Json[]][] = [
        ['full characters only', () => [fullCharacter('a', 'A', { chats: NO_CHAT_ID }), fullCharacter('b', 'B')]],
        ['only current stubs', () => [currentStub('c1', 'C1', LEGACY_UNIT), currentStub('c2', 'C2', '22222222-3333-4444-8555-666666666666')]],
        ['a current stub and a full character', () => [currentStub('c1', 'C1', LEGACY_UNIT), fullCharacter('a', 'A', { chats: NO_CHAT_ID })]],
    ]

    test.each(HOSTS.flatMap((host) => ROWS.map((row) => [host, row[0], row[1]] as [WorldHost, string, () => Json[]])))('%s, %s: guard: no unit is read, nothing is written, the count is neither read nor changed and the installed tree is the decoded file', async (host, _label, make) => {
        useHost(host)
        const world = await worldFor(kit, host, baseTree(make(), { archiveCharacters: false }))
        world.enrich.stored = '1'

        const boot = await bootOnce(world)

        expect(world.units.reads).toEqual([])
        expect(world.units.attempts).toBe(0)
        expect(world.mainWrites.length).toBe(0)
        expect(world.mainLog).toEqual(['boot-read'])
        expect(world.enrich.calls).toEqual([])
        expect(world.enrich.stored).toBe('1')
        expect(world.breaker.calls).toEqual([])
        expect(noticeKinds(boot.outcome)).toEqual([])
        expect(jsonOf(installedTree(boot.outcome))).toEqual(jsonOf(await decodeRisuSave(boot.bytes, { strict: true })))
    })
})

describe('boot archive pass: a paused archive device enriches nothing', () => {
    test.each(HOSTS)('%s: guard: with two strikes no unit is read and nothing is written', async (host) => {
        const world = await legacyWorld(host, true)
        world.breaker.strikes = 2

        const boot = await bootOnce(world)

        expect(world.units.reads).toEqual([])
        expect(world.units.attempts).toBe(0)
        expect(world.mainWrites.length).toBe(0)
        expect(world.mainLog).toEqual(['boot-read'])
        expect(world.breaker.calls).not.toContain('start')
        expect(world.breaker.calls).not.toContain('reset')
        expect(world.breaker.strikes).toBe(2)
        expectLeftAlone(slotOf(installedTree(boot.outcome)))
    })
})

describe('boot archive pass: enrichment beside archiving', () => {
    test.each(HOSTS)('%s: when every unit write fails the stub is still enriched and committed, with the full characters left as they are', async (host) => {
        const world = await legacyWorld(host, true, { others: [fullCharacter('a', 'A'), fullCharacter('b', 'B')] })
        world.units.failWrite = () => 'false'

        const boot = await bootOnce(world)

        const installed = installedTree(boot.outcome)
        expectEnrichedGroup(slotOf(installed))
        expect(world.mainWrites.length).toBe(1)
        const committed = await committedCharacters(world)
        expect(committed.map((c) => c.chaId)).toEqual([GROUP_ID, 'a', 'b'])
        expectEnrichedGroup(committed[0])
        expect(committed[1]).not.toHaveProperty('coldstorage')
        expect(committed[2]).not.toHaveProperty('coldstorage')
        expect(jsonOf(committed)).toEqual(jsonOf(charactersOf(installed)))
    })

    test.each(HOSTS)('%s: guard: a pass whose unit writes stopped with nothing archived keeps its strike, enriched stub or not', async (host) => {
        const world = await legacyWorld(host, true, { others: [fullCharacter('a', 'A'), fullCharacter('b', 'B')] })
        world.units.failWrite = () => 'false'

        const boot = await bootOnce(world)

        expect(world.breaker.strikes).toBe(1)
        expect(world.breaker.calls).not.toContain('reset')
        expect(noticeKinds(boot.outcome)).toEqual(['archive-stopped'])
    })

    test.each(HOSTS)('%s: the stub and an archived character commit together: one commit, the stub enriched, the character archived, the count reset', async (host) => {
        const world = await legacyWorld(host, true, { others: [fullCharacter('a', 'A')] })

        const boot = await bootOnce(world)

        const installed = installedTree(boot.outcome)
        expectEnrichedGroup(slotOf(installed))
        const archived = slotOf(installed, 'a')
        expect(archived.coldVersion).toBe(2)
        expect(archived.coldChatCount).toBe(1)
        expect(typeof archived.coldstorage).toBe('string')
        expect(archived.coldstorage).not.toBe(LEGACY_UNIT)
        expect(world.units.writes.length).toBe(1)
        expect(world.units.writtenCharacters().map((c) => c.chaId)).toEqual(['a'])
        expect(world.units.writes[0].key).toBe(archived.coldstorage)
        expect(world.mainWrites.length).toBe(1)
        const committed = await committedCharacters(world)
        expect(committed.map((c) => c.chaId)).toEqual([GROUP_ID, 'a'])
        expectEnrichedGroup(committed[0])
        expect(committed[1].coldstorage).toBe(archived.coldstorage)
        expect(jsonOf(committed)).toEqual(jsonOf(charactersOf(installed)))
        expect(world.breaker.strikes).toBe(0)
        expect(world.order.filter((e) => e === 'start').length, 'start records').toBe(1)
        expect(world.order.lastIndexOf('reset')).toBeGreaterThan(world.order.lastIndexOf('main-write'))
    })

    test.each(HOSTS)('%s: the stub\'s unit is read before any unit is written, and after the start record', async (host) => {
        const world = await legacyWorld(host, true, { others: [fullCharacter('a', 'A')] })

        await bootOnce(world)

        expect(world.units.reads[0]).toBe(LEGACY_UNIT)
        expect(world.order).toContain('start')
        expect(world.order.indexOf('start')).toBeLessThan(world.order.indexOf('unit-read'))
        expect(world.order.indexOf('unit-read')).toBeLessThan(world.order.indexOf('unit-write'))
    })
})

describe('boot archive pass: several upstream stubs', () => {
    test('their units are read one at a time and each stub is enriched from its own unit', async () => {
        useHost('opfs')
        const stubs = [
            { ...upstreamStub('cha-1', 'One', '10000000-0000-4000-8000-000000000001') },
            { ...upstreamStub('grp-2', 'Two', '10000000-0000-4000-8000-000000000002') },
            { ...upstreamStub('grp-3', 'Three', '10000000-0000-4000-8000-000000000003') },
        ]
        const world = await worldFor(kit, 'opfs', baseTree(stubs, { archiveCharacters: false }))
        await world.seedUnit(stubs[0].coldstorage as string, unitValue(fullCharacter('cha-1', 'One in unit', { chats: [] })))
        await world.seedUnit(stubs[1].coldstorage as string, unitValue(groupCharacter('grp-2', 'Two in unit', ['m2'])))
        await world.seedUnit(stubs[2].coldstorage as string, unitValue(groupCharacter('grp-3', 'Three in unit', ['m3'])))
        let inFlight = 0
        let mostInFlight = 0
        world.units.readOverride = async (_key, real) => {
            inFlight++
            mostInFlight = Math.max(mostInFlight, inFlight)
            try {
                await new Promise((resolve) => setTimeout(resolve, 5))
                return await real()
            } finally {
                inFlight--
            }
        }

        const boot = await bootOnce(world)

        expect(mostInFlight).toBe(1)
        expect(world.units.reads.slice().sort()).toEqual(stubs.map((s) => s.coldstorage as string).sort())
        const slots = charactersOf(installedTree(boot.outcome))
        expect(slots.map((c) => c.type)).toEqual(['character', 'group', 'group'])
        expect(slots.map((c) => c.characters)).toEqual([undefined, ['m2'], ['m3']])
        expect(slots.map((c) => c.name)).toEqual(['One', 'Two', 'Three'])
        expect(slots.map((c) => c.coldVersion)).toEqual([2, 2, 2])
        expect(slots.map((c) => c.coldChatCount)).toEqual([0, 2, 2])
        expect(world.mainWrites.length).toBe(1)
    })
})

describe('boot archive pass: enrichment failures on a profile with archiving off', () => {
    interface FailureKind {
        label: string
        hosts: readonly WorldHost[]
        extra?: Json
        worldOptions?: WorldOptions
        /** The page is killed during the first unit read: the attempt has a start record and no end. */
        dies?: boolean
        /** Another device saves the profile, so what storage holds is not what the boot read. */
        replacesFile?: boolean
        /** Arms the failure for boot number `boot` (1-based). */
        arm?: (world: World, boot: number) => Promise<void> | void
    }

    function offTree(extra: Json = {}) {
        return baseTree([legacyStub(), fullCharacter('b', 'B')], { archiveCharacters: false, ...extra })
    }

    const KINDS: FailureKind[] = [
        {
            label: 'a commit the Node server rejects',
            hosts: ['node'],
            arm: (world) => { world.failNextMainWrite = new Error('the server rejected the commit') },
        },
        {
            label: 'a commit the block check refuses',
            hosts: HOSTS,
            arm: (world) => { world.deps.createEncoder = () => new DroppingEncoder() },
        },
        {
            label: 'a commit over the Node limit',
            hosts: ['node'],
            extra: { mainPrompt: 'x'.repeat(40_000) },
            worldOptions: { nodeBodyLimit: 20_000 },
        },
        {
            label: 'a page killed during the unit read',
            hosts: HOSTS,
            dies: true,
        },
    ]

    const CASES = KINDS.flatMap((kind) => kind.hosts.map((host) => [host, kind.label, kind] as [WorldHost, string, FailureKind]))

    async function failingWorld(host: WorldHost, kind: FailureKind): Promise<World> {
        useHost(host)
        const world = await worldFor(kit, host, offTree(kind.extra), kind.worldOptions)
        await world.seedUnit(LEGACY_UNIT, unitValue(unitGroup()))
        return world
    }

    async function failingBoot(world: World, kind: FailureKind, boot: number): Promise<BootResult | null> {
        if (kind.dies) {
            await bootDyingAtFirstUnitRead(world)
            return null
        }
        await kind.arm?.(world, boot)
        try {
            return await bootOnce(world)
        } finally {
            world.units.readOverride = undefined
        }
    }

    test.each(CASES)('%s, %s: each failed attempt is counted, the second boot retries, and the third boot reads no unit and writes nothing, with a warning', async (host, _label, kind) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const world = await failingWorld(host, kind)

        await failingBoot(world, kind, 1)
        expect(world.enrich.stored).toBe('1')
        const readsAfterFirst = world.units.reads.length
        expect(readsAfterFirst).toBeGreaterThan(0)

        await failingBoot(world, kind, 2)
        expect(world.enrich.stored).toBe('2')
        expect(world.units.reads.length).toBeGreaterThan(readsAfterFirst)

        const reads = world.units.reads.length
        const logLength = world.mainLog.length
        const writes = world.mainWrites.length
        warn.mockClear()
        const third = await bootOnce(world)

        expect(world.units.reads.length).toBe(reads)
        expect(world.mainLog.slice(logLength)).toEqual(['boot-read'])
        expect(world.mainWrites.length).toBe(writes)
        expect(world.enrich.stored).toBe('2')
        expect(warn).toHaveBeenCalled()
        expect(noticeKinds(third.outcome)).toEqual([])
        expect(charactersOf(installedTree(third.outcome))[0]).not.toHaveProperty('coldVersion')
    })

    test.each(CASES)('%s, %s: guard: no notice is posted, no archive record is written and the installed tree is the file on disk', async (host, _label, kind) => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const world = await failingWorld(host, kind)
        const original = world.currentMain() as Uint8Array

        for (let boot = 1; boot <= 2; boot++) {
            const result = await failingBoot(world, kind, boot)
            if (result) {
                expect(noticeKinds(result.outcome)).toEqual([])
                const installed = installedTree(result.outcome)
                expect(installed.archiveCharacters).toBe(false)
                expect(slotOf(installed)).not.toHaveProperty('coldVersion')
                expect(jsonOf(installed)).toEqual(jsonOf(await decodeRisuSave(world.currentMain() as Uint8Array, { strict: true })))
            }
        }
        const third = await bootOnce(world)

        expect(noticeKinds(third.outcome)).toEqual([])
        expect(world.units.attempts).toBe(0)
        expect(world.breaker.calls).toEqual([])
        if (!kind.replacesFile) {
            expect(bytesEqual(world.currentMain(), original)).toBe(true)
        }
    })
})

describe('boot archive pass: the block check covers the enriched stubs', () => {
    test.each(MATRIX)('%s, %s: an encoder that writes an enriched stub differently from the one the pass built is refused, nothing is committed and the file on disk is installed', async (host, _label, archive) => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const world = await legacyWorld(host, archive, { others: [fullCharacter('b', 'B')] })
        const original = world.currentMain() as Uint8Array
        world.deps.createEncoder = () => new StubAlteringEncoder()

        const boot = await bootOnce(world)

        expect(world.mainWrites.length).toBe(0)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect(noticeKinds(boot.outcome)).toEqual([])
        const installed = installedTree(boot.outcome)
        expect(slotOf(installed)).not.toHaveProperty('coldVersion')
        expect(jsonOf(installed)).toEqual(jsonOf(await decodeRisuSave(original, { strict: true })))
        if (archive) {
            expect(world.breaker.strikes, 'the failed attempt keeps its strike').toBe(1)
        } else {
            expect(world.units.writes.length).toBe(0)
            expect(world.enrich.stored, 'the failed attempt keeps its count').toBe('1')
            expect(world.enrich.calls).not.toContain('clear')
        }
    })
})

describe('boot archive pass: the count that bounds enrichment on a profile with archiving off cannot be used', () => {
    const ROWS: [string, (world: World) => void][] = [
        ['a count read that throws', (w) => { w.enrich.readThrows = true }],
        ['a count read that answers unreadable', (w) => { w.enrich.unreadable = true }],
        ['a start record that answers false', (w) => { w.enrich.startFails = true }],
        ['a start record that throws', (w) => { w.enrich.startThrows = true }],
    ]

    const CASES = HOSTS.flatMap((host) => ROWS.map((row) => [host, row[0], row[1]] as [WorldHost, string, (w: World) => void]))

    test.each(CASES)('%s, %s: enrichment does not run on that boot, with a warning', async (host, _label, arrange) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        const world = await legacyWorld(host, false)
        arrange(world)

        const boot = await bootOnce(world)

        expect(boot.outcome.kind).toBe('install')
        expect(warn).toHaveBeenCalled()
    })

    test.each(CASES)('%s, %s: guard: the boot completes with no unit read, no write and no notice', async (host, _label, arrange) => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        const world = await legacyWorld(host, false)
        arrange(world)

        const boot = await bootOnce(world)

        expect(boot.outcome.kind).toBe('install')
        expect(world.units.reads).toEqual([])
        expect(world.mainWrites.length).toBe(0)
        expect(world.mainLog).toEqual(['boot-read'])
        expect(noticeKinds(boot.outcome)).toEqual([])
        expect(world.breaker.calls).toEqual([])
        expectLeftAlone(slotOf(installedTree(boot.outcome)))
    })

    test.each(HOSTS)('%s: a count of two stops enrichment on that device with a warning, reads no unit and writes nothing', async (host) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        const world = await legacyWorld(host, false)
        world.enrich.stored = '2'

        const boot = await bootOnce(world)

        expect(warn).toHaveBeenCalled()
        expect(world.units.reads).toEqual([])
        expect(world.mainWrites.length).toBe(0)
        expect(world.enrich.stored).toBe('2')
        expect(noticeKinds(boot.outcome)).toEqual([])
        expectLeftAlone(slotOf(installedTree(boot.outcome)))
    })

    test.each(HOSTS)('%s: a count of one lets the attempt run, and a success removes it', async (host) => {
        const world = await legacyWorld(host, false)
        world.enrich.stored = '1'

        const boot = await bootOnce(world)

        expectEnrichedGroup(slotOf(installedTree(boot.outcome)))
        expect(world.enrich.stored).toBeNull()
    })
})

describe('boot archive pass: enrichment inherits the pass gates', () => {
    interface Gate {
        label: string
        hosts: readonly WorldHost[]
        extra?: Json
        env?: (host: WorldHost) => Partial<BootArchiveEnvironment>
        /** Runs after the world is built and before the boot. */
        setup?: (world: World) => Promise<void>
        /** The tree is handed to the pass as given, with no encode or decode first. */
        direct?: boolean
    }

    const GATES: Gate[] = [
        { label: 'an enabled V2.1 plugin', hosts: HOSTS, extra: { plugins: [plugin('2.1', true)] } },
        { label: 'a format version below 5', hosts: HOSTS, extra: { formatversion: 4 } },
        { label: 'a stale-account profile', hosts: HOSTS, env: () => ({ staleAccountProfile: true }) },
        {
            label: 'a host that cannot archive',
            hosts: HOSTS,
            env: (host) => (host === 'tauri' ? { tauriDesktop: false } : { locksSupported: false }),
        },
        { label: 'a refused hold', hosts: ['node', 'opfs'], setup: refuseHold },
        { label: 'a legacy stub whose chaId is __proto__', hosts: HOSTS, direct: true },
    ]

    const CASES = GATES.flatMap((gate) => gate.hosts.flatMap((host) => [
        [gate.label, host, 'archive on', true, gate] as [string, WorldHost, string, boolean, Gate],
        [gate.label, host, 'archive off', false, gate] as [string, WorldHost, string, boolean, Gate],
    ]))

    test.each(CASES)('guard: %s (%s, %s): no unit is read, nothing is written and no count is recorded', async (_gateLabel, host, _label, archive, gate) => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        let world: World
        let outcome: Awaited<ReturnType<typeof bootOnce>>['outcome']
        let stub = legacyStub()
        if (gate.direct) {
            useHost(host)
            stub = legacyStub({ chaId: '__proto__' })
            world = await directWorld(kit, host)
            await world.seedUnit(LEGACY_UNIT, unitValue(unitGroup({ chaId: '__proto__' })))
            outcome = await runDirect(world, baseTree([stub], { archiveCharacters: archive }))
        } else {
            world = await legacyWorld(host, archive, { extra: gate.extra, world: { env: gate.env?.(host) } })
            await gate.setup?.(world)
            outcome = (await bootOnce(world)).outcome
        }

        expect(world.units.reads).toEqual([])
        expect(world.units.attempts).toBe(0)
        expect(world.mainWrites.length).toBe(0)
        expect(world.enrich.calls).not.toContain('start')
        expect(world.enrich.stored).toBeNull()
        expect(world.breaker.calls).not.toContain('start')
        expectLeftAlone(slotOf(installedTree(outcome), stub.chaId as string), stub)
    })

    test('guard: with the Node too-large memo set on an archive-on profile no unit is read and nothing is written', async () => {
        const world = await legacyWorld('node', true)
        world.memo.tooLarge = true

        const boot = await bootOnce(world)

        expect(world.units.reads).toEqual([])
        expect(world.mainWrites.length).toBe(0)
        expect(world.breaker.calls).not.toContain('start')
        expectLeftAlone(slotOf(installedTree(boot.outcome)))
    })
})

describe('boot archive pass: dying during the enrichment read on an archive-on profile', () => {
    test.each(HOSTS)('%s: with nothing to archive, two dead attempts pause the device and the third boot posts the paused notice, reads no unit and writes nothing', async (host) => {
        const world = await legacyWorld(host, true)

        await bootDyingAtFirstUnitRead(world)
        expect(world.breaker.strikes).toBe(1)
        await bootDyingAtFirstUnitRead(world)
        expect(world.breaker.strikes).toBe(2)
        const reads = world.units.reads.length
        const writes = world.mainWrites.length

        const third = await bootOnce(world)

        expect(noticeKinds(third.outcome)).toEqual(['archive-paused'])
        expect(world.units.reads.length).toBe(reads)
        expect(world.units.attempts).toBe(0)
        expect(world.mainWrites.length).toBe(writes)
        expect(world.enrich.calls).toEqual([])
        expectLeftAlone(slotOf(installedTree(third.outcome)))
    })
})

describe('boot archive pass: enriched stubs and remote saving', () => {
    const REMOTE_HOSTS = ['node', 'tauri'] as const

    async function remoteWorld(host: WorldHost, archive: boolean) {
        useHost(host)
        const stubId = uid('remote-stub')
        const fullId = uid('remote-full')
        const stub = { ...upstreamStub(stubId, 'Remote Stub', LEGACY_UNIT), image: 'stub-image.png' }
        const tree = baseTree([stub, fullCharacter(fullId, 'Remote Full')], { archiveCharacters: archive, enableRemoteSaving: true })
        const world = await setupWorld(kit, host, null)
        // The legacy main file of a profile that had Remote Saving on: its characters are remote pointers.
        const store = await getAppStore()
        world.seedMain(await withRemoteCharacters(await encodeAsSaveDb(RisuSaveEncoder, tree), [stubId, fullId], async (key, bytes) => { await store.write(key, bytes, 'unconditional') }))
        h.db = { enableRemoteSaving: true }
        await world.seedUnit(LEGACY_UNIT, unitValue(groupCharacter(stubId, 'Remote Group', MEMBERS)))
        return { world, stubId, fullId }
    }

    /** The remote character files the page's store holds: the Tauri model's files on a desktop boot, the storage object's otherwise. */
    async function remoteKeys(host: WorldHost): Promise<string[]> {
        const keys = host === 'tauri' ? Array.from(h.tauriFiles.keys()) : await (h.remote as RemoteLike).keys()
        return keys.filter((key) => key.replace(/^\.\//, '').startsWith('remotes/'))
    }

    test.each(REMOTE_HOSTS.flatMap((host) => [[host, true], [host, false]] as [WorldHost, boolean][]))('%s, archive %s: the enriched stub passes the block check as an inline stub, the commit is written and no remote file is', async (host, archive) => {
        const { world, stubId, fullId } = await remoteWorld(host, archive)
        const remotesBefore = (await remoteKeys(host)).sort()
        expect(remotesBefore.length, 'the fixture holds remote files for the pass to resolve').toBe(2)

        const boot = await bootOnce(world)

        expect(world.mainWrites.length).toBe(1)
        const blocks = characterBlocks(world.mainWrites[0])
        expect(blocks.map((b) => b.name)).toEqual([stubId, fullId])
        expect(blocks.every((b) => b.type === BLOCK.CHARACTER_WITH_CHAT)).toBe(true)
        const installed = installedTree(boot.outcome)
        const slot = slotOf(installed, stubId)
        expect(slot.coldVersion).toBe(2)
        expect(slot.type).toBe('group')
        expect(slot.characters).toEqual(MEMBERS)
        expect(blockJson(blocks[0])).toEqual(jsonOf(slot))
        expect(jsonOf(charactersOf(await decodeRisuSave(world.mainWrites[0], { strict: true })))).toEqual(jsonOf(charactersOf(installed)))
        expect((await remoteKeys(host)).sort()).toEqual(remotesBefore)
    })
})
