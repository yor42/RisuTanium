/**
 * The boot archive pass, gates (`src/ts/storage/bootArchivePass.ts`): the
 * conditions under which a boot archives nothing, the capability check per
 * host, and the exclusive hold's lifetime.
 *
 * The real `RisuSaveEncoder`, `decodeRisuSave`, `NodeStorage` and
 * `createStorageTabLocks` are used; the Node server is `FakeNodeServer`, the
 * web units go to an in-memory OPFS directory and the web locks to
 * `FakeLockManagerCore` (see `bootArchivePassHarness.ts`). These tests
 * exercise the pass against those in-memory models; they say nothing about
 * the Tauri file system, the real Node server, or a browser's Web Locks.
 *
 * Tests titled `guard:` assert that something does not happen; they pass with
 * and without the pass and protect behaviour the pass must keep. The others
 * assert behaviour only the pass has.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    baseTree,
    bootOnce,
    chaIdsOf,
    charactersOf,
    fullCharacter,
    installedTree,
    makeTab,
    plugin,
    worldFor,
    writeLockIsFree,
    type BootResult,
    type Json,
    type RemoteLike,
    type World,
    type WorldHost,
    type WorldKit,
    type WorldOptions,
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
    isPlainHttpFileSrc: vi.fn(() => false),
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

import { RisuSaveEncoder, decodeRisuSave, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { NodeStorage } from 'src/ts/storage/nodeStorage'
import { openBootArchiveSession } from 'src/ts/storage/bootArchivePass'

const kit: WorldKit = {
    Encoder: RisuSaveEncoder,
    decodeRisuSave: decodeRisuSave as WorldKit['decodeRisuSave'],
    openBootArchiveSession,
    NodeStorage: NodeStorage as unknown as WorldKit['NodeStorage'],
    setRemote: (remote) => { h.remote = remote },
}

function useHost(host: WorldHost): void {
    h.platform.isNodeServer = host === 'node'
    h.platform.isTauri = host === 'tauri'
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

function twoCharacters(extra: Json = {}) {
    return baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')], extra)
}

async function boot(host: WorldHost, tree: ReturnType<typeof baseTree>, options: WorldOptions = {}, encode?: Parameters<typeof worldFor>[4]): Promise<{ world: World, result: BootResult }> {
    useHost(host)
    const world = await worldFor(kit, host, tree, options, encode)
    return { world, result: await bootOnce(world) }
}

/** Nothing archived, nothing written, no notice, and the installed tree holds the main file's own slots with no stub. */
function expectNothingDone(world: World, result: BootResult, expectedIds: string[] = ['a', 'b'], keyAbsent = true) {
    expect(world.units.writes.length).toBe(0)
    expect(world.mainWrites.length).toBe(0)
    expect(result.outcome.kind).toBe('install')
    if (result.outcome.kind === 'install') {
        expect(result.outcome.notices).toEqual([])
        expect(result.outcome.noteBytes).toBeNull()
        expect(result.outcome.committed).toBeUndefined()
    }
    const tree = installedTree(result.outcome)
    expect(chaIdsOf(tree)).toEqual(expectedIds)
    expect(charactersOf(tree).some((c) => !!c.coldstorage)).toBe(false)
    if (keyAbsent) {
        expect(tree).not.toHaveProperty('archiveCharacters')
    }
}

describe('boot archive pass: format and plugin gates', () => {
    test.each([
        ['4', 4],
        ['absent', undefined],
    ] as const)('B1: guard: a main file with formatversion %s is not archived, no key is written and no notice is raised', async (_label, formatversion) => {
        const tree = twoCharacters() as unknown as Json
        if (formatversion === undefined) {
            delete tree.formatversion
        } else {
            tree.formatversion = formatversion
        }

        const { world, result } = await boot('opfs', tree as unknown as ReturnType<typeof baseTree>)

        expectNothingDone(world, result)
        expect(installedTree(result.outcome)).not.toHaveProperty('archiveCharacters')
    })

    test('guard: a tree whose characters is not an array is installed as it is, with nothing written', async () => {
        const tree = baseTree([]) as unknown as Json
        tree.characters = {}

        const { world, result } = await boot('opfs', tree as unknown as ReturnType<typeof baseTree>, {}, legacyEncode)

        expect(world.units.writes.length).toBe(0)
        expect(world.mainWrites.length).toBe(0)
        expect(result.outcome.kind).toBe('install')
        expect(installedTree(result.outcome)).not.toHaveProperty('archiveCharacters')
    })

    test.each([
        ['an enabled V2.1 plugin', [plugin('2.1', true)]],
        ['an enabled V2.1 plugin among others', [plugin(2, true, 'old'), plugin('3.0', true, 'v3'), plugin('2.1', true, 'new')]],
    ] as const)('B2: guard: %s blocks archiving, the key and the notice', async (_label, plugins) => {
        const { world, result } = await boot('opfs', twoCharacters({ plugins: [...plugins] }))

        expectNothingDone(world, result)
        expect(installedTree(result.outcome)).not.toHaveProperty('archiveCharacters')
    })

    test.each([
        ['a disabled V2.1 plugin', [plugin('2.1', false)]],
        ['an enabled V2.0 plugin (version 2)', [plugin(2, true)]],
        ['an enabled V3 plugin', [plugin('3.0', true)]],
    ] as const)('B2: %s does not block archiving', async (_label, plugins) => {
        const { world, result } = await boot('opfs', twoCharacters({ plugins: [...plugins] }))

        const slots = charactersOf(installedTree(result.outcome))
        expect(slots.map((c) => !!c.coldstorage)).toEqual([true, true])
        expect(world.units.writes.length).toBe(2)
    })
})

describe('boot archive pass: the archive-characters setting', () => {
    test('B3: guard: archiveCharacters false archives nothing, writes nothing and keeps the setting', async () => {
        const { world, result } = await boot('opfs', twoCharacters({ archiveCharacters: false }))

        expectNothingDone(world, result, ['a', 'b'], false)
        expect(installedTree(result.outcome).archiveCharacters).toBe(false)
    })

    test('B3: archiveCharacters true archives, leaves the setting as it is and raises no notice', async () => {
        const { world, result } = await boot('opfs', twoCharacters({ archiveCharacters: true }))

        expect(charactersOf(installedTree(result.outcome)).map((c) => !!c.coldstorage)).toEqual([true, true])
        expect(installedTree(result.outcome).archiveCharacters).toBe(true)
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([])
        expect(world.mainWrites.length).toBe(1)
    })

    test.each(['node', 'opfs'] as const)('I8 (%s): guard: with the key present and nothing eligible, nothing is written and the boot record stands', async (host) => {
        const tree = baseTree([fullCharacter('t1', 'T1', { trashTime: 1 }), fullCharacter('t2', 'T2', { trashTime: 2 })], { archiveCharacters: true })

        const { world, result } = await boot(host, tree)

        expectNothingDone(world, result, ['t1', 't2'], false)
    })
})

describe('boot archive pass: capability per host', () => {
    test.each([
        ['no Web Locks', 'opfs', { locksSupported: false }],
        ['Web Locks on a page whose store is not the IndexedDB store, not the Node server', 'opfs', { indexedDbStore: false }],
        ['the Node server without Web Locks', 'node', { locksSupported: false }],
        ['a Tauri build that is not a desktop build', 'tauri', { tauriDesktop: false }],
    ] as const)('B4: guard: %s archives nothing, takes no hold and raises no notice', async (_label, host, env) => {
        const { world, result } = await boot(host, twoCharacters(), { env })

        expectNothingDone(world, result)
        expect(world.holdRequests).toEqual([])
    })

    test('the Node server needs Web Locks but not the IndexedDB store', async () => {
        const { world, result } = await boot('node', twoCharacters(), { env: { indexedDbStore: false } })

        expect(charactersOf(installedTree(result.outcome)).map((c) => !!c.coldstorage)).toEqual([true, true])
        expect(world.mainWrites.length).toBe(1)
    })

    test('a Tauri desktop boot archives without taking any hold', async () => {
        const { world, result } = await boot('tauri', twoCharacters())

        expect(world.units.writes.length).toBe(2)
        expect(charactersOf(installedTree(result.outcome)).map((c) => !!c.coldstorage)).toEqual([true, true])
        expect(world.holdRequests).toEqual([])
    })

    test('B5: guard: a stale-account profile archives nothing and leaves the write lock free', async () => {
        const { world, result } = await boot('opfs', twoCharacters(), { env: { staleAccountProfile: true } })

        expectNothingDone(world, result)
        expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
    })
})

describe('boot archive pass: the exclusive hold', () => {
    test('B7: guard: another tab holding presence refuses the hold, the boot installs the file as it is and the write lock stays free', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', twoCharacters())
        const other = makeTab(world.core, 'B')
        await other.locks.tabPresenceLockAcquired

        const result = await bootOnce(world)

        expectNothingDone(world, result)
        expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
    })

    test('guard: a refused hold on a page that is reloading marks the session reloading and not archivable', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', twoCharacters())
        const other = makeTab(world.core, 'B')
        await other.locks.tabPresenceLockAcquired
        world.reloading = true

        const session = await openBootArchiveSession('web', world.deps)

        expect(session.reloading).toBe(true)
        expect(session.canArchive).toBe(false)
    })

    test('guard: a refused hold on a page that is not reloading leaves the session not reloading', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', twoCharacters())
        const other = makeTab(world.core, 'B')
        await other.locks.tabPresenceLockAcquired

        const session = await openBootArchiveSession('web', world.deps)

        expect(session.reloading).toBe(false)
        expect(session.canArchive).toBe(false)
    })

    test('guard: a granted hold never marks the session reloading', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', twoCharacters())
        world.reloading = true

        const session = await openBootArchiveSession('web', world.deps)

        expect(session.canArchive).toBe(true)
        expect(session.reloading).toBe(false)
        await session.release()
    })

    test('takes the exclusive hold when the session opens, before the main file is read, and gives the write lock back with no argument', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', twoCharacters())

        const session = await openBootArchiveSession('web', world.deps)

        expect(world.holdRequests.length).toBe(1)
        expect(world.holdRequests[0]).toBeLessThan(5000)
        expect(world.mainLog).toEqual([])
        await session.release()
        expect(world.releaseArgs).toEqual([undefined])
        expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
    })

    test.each([
        ['an ordinary profile', {}],
        ['an opted-out profile', { archiveCharacters: false }],
        ['a profile with an enabled V2.1 plugin', { plugins: [plugin('2.1', true)] }],
        ['a profile with nothing to archive', { characters: [] }],
    ] as const)('takes the hold on a capable boot for %s, and releases it with the write lock free', async (_label, extra) => {
        const { world } = await boot('opfs', twoCharacters(extra))

        expect(world.holdRequests.length).toBe(1)
        expect(world.releaseArgs).toEqual([undefined])
        expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
    })

    test('keeps another tab out of storage from the open until the pass settles', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', twoCharacters())
        const session = await openBootArchiveSession('web', world.deps)
        const other = makeTab(world.core, 'B')
        let otherGranted = false
        void other.locks.tabPresenceLockAcquired.then(() => { otherGranted = true })
        const grantedDuringUnitWrites: boolean[] = []
        world.units.failWrite = () => {
            grantedDuringUnitWrites.push(otherGranted)
            return undefined
        }
        const bytes = await world.bootRead()
        const tree = await decodeRisuSave(bytes as Uint8Array, { strict: true })

        await session.run({ tree })

        expect(grantedDuringUnitWrites).toEqual([false, false])
        await other.locks.tabPresenceLockAcquired
        expect(otherGranted).toBe(true)
    })

    test('guard: a session that never runs the pass releases with no argument and leaves the write lock free', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', twoCharacters())
        const session = await openBootArchiveSession('web', world.deps)

        await session.release()
        await session.release()

        expect(world.releaseArgs.every((arg) => arg === undefined)).toBe(true)
        expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
    })
})
