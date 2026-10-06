/**
 * The boot archive pass, an unwritable character (`src/ts/storage/bootArchivePass.ts`):
 * a unit that cannot be written or read back leaves that one character fully
 * loaded and the pass carries on; two failures in a row stop archiving for the
 * boot; a skipped character is named in a notice and remembered on the device,
 * and the pass reads that memo but never writes it.
 *
 * The real `RisuSaveEncoder`, `decodeRisuSave` and `NodeStorage` are used; the
 * Node server is `FakeNodeServer`, the web units go to an in-memory OPFS
 * directory (see `bootArchivePassHarness.ts`). The device memo is a
 * `world.memo` model, and a test that needs the next boot's memo applies the
 * previous outcome's notices with `applyNoticeMemo`, which stands for what
 * bootstrap does after it posts them. These tests exercise the pass against
 * those in-memory models; they say nothing about the Tauri file system, the
 * real Node server, or a browser's OPFS.
 *
 * Tests titled `guard:` assert behaviour that must not change; they pass with
 * and without the skip rule. The others assert behaviour only the skip rule
 * has.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    applyNoticeMemo,
    archiveMemoKeysWritten,
    baseTree,
    bootOnce,
    bytesEqual,
    charactersOf,
    encodeAsSaveDb,
    fullCharacter,
    installedTree,
    jsonOf,
    noticeKinds,
    runDirect,
    directWorld,
    worldFor,
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

const HOSTS = ['node', 'opfs'] as const

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
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

/** The characters a tree lists, in order, as full or archived. */
function archivedFlags(tree: ReturnType<typeof baseTree>): boolean[] {
    return charactersOf(tree).map((c) => !!c.coldstorage)
}

/** A profile with the setting already on, so a boot's notices come from the pass's own outcome only. */
function profile(ids: string[], extra: Record<string, unknown> = {}) {
    return baseTree(ids.map((id) => fullCharacter(id, id.toUpperCase())), { archiveCharacters: true, ...extra })
}

async function bootProfile(host: WorldHost, ids: string[], extra: Record<string, unknown> = {}): Promise<World> {
    useHost(host)
    return worldFor(kit, host, profile(ids, extra))
}

/** The pass has not written the device memo: bootstrap does, after it posts the notice. */
function expectNoMemoWritten(world: World, before: ReadonlySet<string> = new Set()) {
    expect(archiveMemoKeysWritten()).toEqual([])
    expect(new Set(world.memo.skipped)).toEqual(before)
}

type ReadAnswer = () => Promise<{ status: 'ok', value: unknown } | { status: 'missing' } | { status: 'error', error: unknown }>

describe('boot archive pass: one character that cannot be stored is skipped and the pass carries on', () => {
    test.each(HOSTS)('%s: a failed write at the second of three leaves it full, archives the first and third and names it in one notice', async (host) => {
        const world = await bootProfile(host, ['a', 'b', 'c'])
        world.units.failWrite = (attempt) => (attempt === 2 ? 'false' : undefined)

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(3)
        const installed = installedTree(result.outcome)
        expect(archivedFlags(installed)).toEqual([true, false, true])
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(archivedFlags(committed)).toEqual([true, false, true])
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([
            { kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'B' }] },
        ])
        expectNoMemoWritten(world)
    })

    test.each([
        ['nothing at the key', async () => ({ status: 'missing' as const })],
        ['an error', async () => ({ status: 'error' as const, error: new Error('read failed') })],
        ['another chaId', async () => ({ status: 'ok' as const, value: { character: { chaId: 'someone-else' } } })],
    ] as [string, ReadAnswer][])('a read-back with %s at the second of three leaves it full, archives the first and third and names it', async (_label, answer) => {
        const world = await bootProfile('opfs', ['a', 'b', 'c'])
        let reads = 0
        world.units.readOverride = async (_key, real) => {
            reads++
            return reads === 2 ? answer() : real()
        }

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(3)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, false, true])
        expect(world.mainWrites.length).toBe(1)
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([
            { kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'B' }] },
        ])
        expectNoMemoWritten(world)
    })

    test('failures that are not consecutive are all skipped and named in the one notice, in slot order', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c', 'd'])
        world.units.failWrite = (attempt) => (attempt === 2 || attempt === 4 ? 'false' : undefined)

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(4)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, false, true, false])
        expect(world.mainWrites.length).toBe(1)
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([
            { kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'B' }, { chaId: 'd', name: 'D' }] },
        ])
    })

    test('a skip on the nothing-changed path commits nothing, keeps the boot record and still names the character', async () => {
        const world = await bootProfile('opfs', ['a'])
        world.units.failWrite = () => 'false'

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(0)
        expect(result.outcome.kind === 'install' && result.outcome.noteBytes).toBeNull()
        expect(archivedFlags(installedTree(result.outcome))).toEqual([false])
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([
            { kind: 'archive-skipped', characters: [{ chaId: 'a', name: 'A' }] },
        ])
        expectNoMemoWritten(world)
    })
})

describe('boot archive pass: two failures in a row stop archiving for the boot', () => {
    test.each(HOSTS)('%s: with the third and fourth of four failing, both are tried, the first two are committed and the stopped notice is the only one', async (host) => {
        const world = await bootProfile(host, ['a', 'b', 'c', 'd'])
        world.units.failWrite = (attempt) => (attempt >= 3 ? 'false' : undefined)

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(4)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, true, false, false])
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(archivedFlags(committed)).toEqual([true, true, false, false])
        expect(noticeKinds(result.outcome)).toEqual(['archive-stopped'])
        const notice = result.outcome.kind === 'install' ? result.outcome.notices[0] : null
        expect(notice && notice.kind === 'archive-stopped' ? notice.characterName : null).toBe('D')
        expectNoMemoWritten(world)
    })

    test('a start that enables archiving, skips one character and then stops posts the enabled, skipped and stopped notices in that order', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c', 'd', 'e'], { archiveCharacters: undefined })
        world.units.failWrite = (attempt) => (attempt === 2 || attempt >= 4 ? 'false' : undefined)

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(5)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, false, true, false, false])
        expect(world.mainWrites.length).toBe(1)
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([
            { kind: 'archive-enabled' },
            { kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'B' }] },
            { kind: 'archive-stopped', characterName: 'E' },
        ])
        expectNoMemoWritten(world)
    })

    test('five characters with the second and third failing never try the fourth and fifth', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c', 'd', 'e'])
        world.units.failWrite = (attempt) => (attempt === 2 || attempt === 3 ? 'false' : undefined)

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(3)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, false, false, false, false])
        expect(noticeKinds(result.outcome)).toEqual(['archive-stopped'])
    })
})

describe('boot archive pass: a skip is remembered only after its notice is delivered', () => {
    test('a skip followed by a rejected commit installs the file as it is, names no skip, and the next boot tries the character again and names it', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c'])
        const original = world.currentMain() as Uint8Array
        world.units.failWrite = (attempt) => (attempt === 2 || attempt === 5 ? 'false' : undefined)
        world.failNextMainWrite = new Error('commit rejected')

        const first = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted on the first boot').toBe(3)
        expect(first.outcome.kind).toBe('install')
        expect(archivedFlags(installedTree(first.outcome))).toEqual([false, false, false])
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect(noticeKinds(first.outcome)).not.toContain('archive-skipped')
        expectNoMemoWritten(world)

        applyNoticeMemo(world, first.outcome)
        const second = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted over two boots').toBe(6)
        expect(archivedFlags(installedTree(second.outcome))).toEqual([true, false, true])
        expect(second.outcome.kind === 'install' && second.outcome.notices).toEqual([
            { kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'B' }] },
        ])
    })

    test('a character the memo lists is not tried, gets no notice, and the others are archived and committed', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c'])
        world.memo.skipped.add('b')

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(2)
        expect(world.units.writtenCharacters().map((c) => c.chaId)).toEqual(['a', 'c'])
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, false, true])
        expect(world.mainWrites.length).toBe(1)
        expect(noticeKinds(result.outcome)).toEqual([])
        expect([...world.memo.skipped]).toEqual(['b'])
    })

    test('when the only eligible character is memoised the pass writes and commits nothing, as when nothing is eligible', async () => {
        const world = await bootProfile('opfs', ['a'])
        world.memo.skipped.add('a')

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(0)
        expect(world.mainWrites.length).toBe(0)
        expect(result.outcome.kind === 'install' && result.outcome.noteBytes).toBeNull()
        expect(archivedFlags(installedTree(result.outcome))).toEqual([false])
        expect(noticeKinds(result.outcome)).toEqual([])
    })
})

describe('boot archive pass: a slot that cannot survive its unit is not eligible', () => {
    test('an array that carries a chaId gets no unit and does not stop the characters after it', async () => {
        useHost('opfs')
        const world = await directWorld(kit, 'opfs')
        const arraySlot = Object.assign([], { chaId: 'arr', name: 'Array Slot' })
        const tree = baseTree([arraySlot, fullCharacter('ok', 'Ok')], { archiveCharacters: true })

        const outcome = await runDirect(world, tree)

        expect(world.units.writtenCharacters().map((c) => c.chaId), 'characters written as units').toEqual(['ok'])
        const slots = charactersOf(installedTree(outcome))
        expect(slots.find((c) => c.chaId === 'ok')?.coldstorage).toBeTruthy()
        expect(noticeKinds(outcome)).toEqual([])
    })
})

describe('boot archive pass: the device memo is out of the pass\'s hands', () => {
    test('guard: a memo read that throws is treated as an empty memo: every eligible character is tried and the pass commits', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c'])
        world.memo.skipped.add('b')
        let memoReads = 0
        world.deps.readArchiveMemo = () => {
            memoReads++
            throw new Error('storage read blocked')
        }

        const result = await bootOnce(world)

        expect(memoReads).toBeGreaterThan(0)
        expect(world.units.attempts, 'unit writes attempted').toBe(3)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, true, true])
        expect(world.mainWrites.length).toBe(1)
        expect(noticeKinds(result.outcome)).toEqual([])
    })

    test('guard: a profile with no failure, no refusal and no memo commits the bytes a save of the same tree produces', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c'])

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(1)
        const installed = installedTree(result.outcome)
        const expected = await encodeAsSaveDb(RisuSaveEncoder, installed)
        expect(bytesEqual(world.mainWrites[0], expected)).toBe(true)
        expect(jsonOf(charactersOf(await decodeRisuSave(world.mainWrites[0], { strict: true })))).toEqual(jsonOf(charactersOf(installed)))
    })
})
