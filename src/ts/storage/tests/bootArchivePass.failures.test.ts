/**
 * The boot archive pass, failures and the first-run notice
 * (`src/ts/storage/bootArchivePass.ts`): a lost or rejected commit, a fault in
 * the encoded blocks, a throw inside the pass, the re-read that follows, and
 * the one-time `archiveCharacters` key and notice. A unit that cannot be
 * written or read back is covered by `bootArchivePass.skips.test.ts`.
 *
 * Every failure path leaves the previous state authoritative (the legacy main
 * file untouched and no head, or the previous root) and writes nothing back to
 * restore it.
 *
 * The real `RisuSaveEncoder`, `decodeRisuSave`, `NodeStorage`, the Node HTTP
 * store, the block-store owner and `createStorageTabLocks` are used; the Node
 * server is `FakeNodeServer`, the web units go to an in-memory OPFS directory
 * and the web locks to `FakeLockManagerCore` (see `bootArchivePassHarness.ts`).
 * Faults are injected at the dependency seams (unit writer, commit, encoder)
 * or at the stand-in server's `fetch`. These tests exercise the pass against
 * those in-memory models; they say nothing about the Tauri file system, the
 * real Node server, or a browser's Web Locks. The Tauri tests cover the pass's
 * own seams only (a failed pass writes nothing back).
 *
 * Tests titled `guard:` assert that something does not happen; they pass with
 * and without the pass and protect behaviour the pass must keep. The others
 * assert behaviour only the pass has.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    baseTree,
    blockWriteRequests,
    bootOnce,
    bytesEqual,
    chaIdsOf,
    charactersOf,
    fullCharacter,
    installedTree,
    jsonOf,
    makeTab,
    worldFor,
    writeLockIsFree,
    type BootResult,
    type RemoteLike,
    type World,
    type WorldHost,
    type WorldKit,
} from './bootArchivePassHarness'
import { BLOCK, composeSave, type FakeNodeServer } from './manualCleanupHarness'

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
})

const HEAD_KEY = 'blocks/head'

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

/** The re-reads that return no bytes at all. */
const NOTHING_READ: [string, () => Uint8Array | null | undefined][] = [
    ['null', () => null],
    ['undefined', () => undefined],
    ['empty bytes', () => new Uint8Array(0)],
]

function threeCharacters(extra: Record<string, unknown> = {}) {
    return baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B'), fullCharacter('c', 'C')], { archiveCharacters: true, ...extra })
}

async function boot(host: WorldHost, tree: ReturnType<typeof baseTree> = threeCharacters()): Promise<World> {
    useHost(host)
    return worldFor(kit, host, tree)
}

function mainFileKey(init?: RequestInit): string {
    const filePath = (init?.headers as Record<string, string> | undefined)?.['file-path'] ?? ''
    return Buffer.from(filePath, 'hex').toString('utf-8')
}

/** The Node server stores the head write, then the response never reaches the client. */
function loseHeadResponse(world: World): void {
    const server = world.server as FakeNodeServer
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const response = await server.fetch(input, init)
        if (String(input) === '/api/write' && mainFileKey(init) === HEAD_KEY) {
            throw new TypeError('Failed to fetch')
        }
        return response
    })
}

/** The Node server bumps the revision of the new generation's root, then fails that write with a 500. */
function failRootWriteAfterRevisionBump(world: World): void {
    const server = world.server as FakeNodeServer
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const key = mainFileKey(init)
        if (String(input) === '/api/write' && key.startsWith('blocks/') && key.endsWith('/root')) {
            server.revisions.set(key, server.revisionOf(key) + 1)
            server.requests.push({ path: '/api/write', method: 'POST', headers: { 'file-path': (init?.headers as Record<string, string>)['file-path'] } })
            return new Response('write failed', { status: 500 })
        }
        return server.fetch(input, init)
    })
}

/** Another device converts the profile while the pass is writing its units; the profile it leaves holds `peer`. */
function peerConvertsDuringPass(world: World): void {
    const writeUnit = world.deps.writeUnit
    let armed = true
    world.deps.writeUnit = async (key, value) => {
        if (armed && world.units.attempts === 1) {
            armed = false
            const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
            const result = await world.anotherOwner().replaceWholeState(
                await treeToBlockSet(baseTree([fullCharacter('peer', 'Peer')], { archiveCharacters: true })),
                { requireAbsentHead: true },
            )
            expect(result.kind).toBe('won')
        }
        return writeUnit(key, value)
    }
}

/** The main file is exactly what it was before the pass, no head was written, and the installed tree holds every slot as a full character. */
function expectOriginalInstalled(world: World, result: BootResult, original: Uint8Array) {
    expect(world.mainWrites.length).toBe(0)
    expect(bytesEqual(world.currentMain(), original)).toBe(true)
    expect(blockWriteRequests(world), 'writes under blocks/').toBe(0)
    expect(result.outcome.kind).toBe('install')
    const tree = installedTree(result.outcome)
    expect(chaIdsOf(tree)).toEqual(['a', 'b', 'c'])
    expect(charactersOf(tree).some((c) => !!c.coldstorage)).toBe(false)
}

describe('boot archive pass: the commit on the Node server', () => {
    test('C3: another device converting the profile during the pass makes the conversion lose: the boot stops, the main file is not touched, and the next boot loads the peer\'s profile', async () => {
        const world = await boot('node')
        const original = world.currentMain() as Uint8Array
        peerConvertsDuringPass(world)

        const result = await bootOnce(world)

        expect(world.units.writes.length).toBe(3)
        expect(result.outcome.kind).toBe('stop')
        expect(world.mainWrites.length).toBe(0)
        expect(bytesEqual(world.currentMain(), original), 'the main file is not ours to move once the conversion lost').toBe(true)
        expect((await world.units.keys()).length).toBe(3)
        expect(world.releaseArgs).toEqual([undefined])

        const next = await bootOnce(world)

        expect(chaIdsOf(next.tree)).toEqual(['peer'])
    })

    test('C4: a root write the server fails with a 500 after it bumped the revision fails the conversion: no head, the main file untouched, the profile installs as it was', async () => {
        const world = await boot('node')
        const original = world.currentMain() as Uint8Array
        failRootWriteAfterRevisionBump(world)

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('install')
        expect(result.outcome.kind === 'install' && result.outcome.committed).toBeUndefined()
        expect(chaIdsOf(installedTree(result.outcome))).toEqual(['a', 'b', 'c'])
        expect(charactersOf(installedTree(result.outcome)).some((c) => !!c.coldstorage)).toBe(false)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect((world.server as FakeNodeServer).files.has(HEAD_KEY), 'no head names the half-written generation').toBe(false)
        expect(world.mainWrites).toEqual([])
        vi.unstubAllGlobals()
        vi.stubGlobal('fetch', (world.server as FakeNodeServer).fetch)
        const retry = await bootOnce(world)
        expect(retry.outcome.kind === 'install' && retry.outcome.committed).toBe(true)
    })

    test('C4: a head write the server stored but answered with a failure is found by the re-read of the head: the conversion won and is reported as committed', async () => {
        const world = await boot('node')
        loseHeadResponse(world)

        const result = await bootOnce(world)

        expect(result.outcome.kind === 'install' && result.outcome.committed).toBe(true)
        expect((world.server as FakeNodeServer).files.has(HEAD_KEY)).toBe(true)
        expect(charactersOf(installedTree(result.outcome)).map((c) => !!c.coldstorage)).toEqual([true, true, true])
        expect(world.currentMain(), 'the converted main file is moved aside').toBeNull()
    })

    test('guard: a pass that throws, followed by a re-read that throws, stops the boot with the error and writes nothing', async () => {
        const world = await boot('node')
        const original = world.currentMain() as Uint8Array
        world.units.failWrite = (attempt) => (attempt === 2 ? 'throw' : undefined)
        world.readQueue.push(async () => { throw 'getItem Error' })

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('stop')
        expect(world.mainWrites.length).toBe(0)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect(world.releaseArgs).toEqual([undefined])
        expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
    })

    test.each(NOTHING_READ)('guard: a rejected commit followed by a re-read that returns %s stops the boot on the Node server, writing nothing and releasing the hold', async (_label, answer) => {
        const world = await boot('node')
        const original = world.currentMain() as Uint8Array
        world.failNextMainWrite = new Error('commit rejected')
        world.readQueue.push(async () => answer())

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('stop')
        expect(world.mainWrites.length).toBe(0)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect(world.releaseArgs).toEqual([undefined])
        expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
    })

    test('C7: a re-read whose bytes do not decode leaves the decision to the backup-fallback path', async () => {
        const world = await boot('node')
        world.units.failWrite = (attempt) => (attempt === 2 ? 'throw' : undefined)
        world.readQueue.push(async () => new Uint8Array([1, 2, 3, 4]))

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('backup-fallback')
        expect(world.mainWrites.length).toBe(0)
    })
})

describe('boot archive pass: a pass that cannot commit installs the main file as it is', () => {
    test('C5: guard: encoded bytes that lose a character block are never written and the original tree is installed', async () => {
        const world = await boot('opfs')
        const original = world.currentMain() as Uint8Array
        world.deps.createEncoder = () => new DroppingEncoder()

        const result = await bootOnce(world)

        expectOriginalInstalled(world, result, original)
    })

    test.each(['node', 'opfs'] as const)('C6 (%s): guard: a throw inside the pass writes nothing, installs the original tree and never takes the backup path', async (host) => {
        const world = await boot(host)
        const original = world.currentMain() as Uint8Array
        world.units.failWrite = (attempt) => (attempt === 2 ? 'throw' : undefined)

        const result = await bootOnce(world)

        expect(result.outcome.kind).not.toBe('backup-fallback')
        expect(result.outcome.kind).not.toBe('stop')
        expectOriginalInstalled(world, result, original)
    })

    test('C7: a rejected commit followed by a re-read that throws stops the boot with that error on web, writing nothing and releasing the hold', async () => {
        const world = await boot('opfs')
        const original = world.currentMain() as Uint8Array
        world.failNextMainWrite = new Error('commit rejected')
        const readError = new Error('storage read failed')
        world.readQueue.push(async () => { throw readError })

        const result = await bootOnce(world)

        expect(result.outcome).toEqual({ kind: 'stop', error: readError })
        expect(world.mainWrites.length).toBe(0)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect(world.releaseArgs).toEqual([undefined])
        expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
    })

    test.each(NOTHING_READ)('C7: a rejected commit followed by a re-read that returns %s stops the boot on web, writing nothing and releasing the hold', async (_label, answer) => {
        const world = await boot('opfs')
        const original = world.currentMain() as Uint8Array
        world.failNextMainWrite = new Error('commit rejected')
        world.readQueue.push(async () => answer())

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('stop')
        expect(world.mainWrites.length).toBe(0)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect(world.releaseArgs).toEqual([undefined])
        expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
    })

    test('a re-read that decodes only non-strictly is installed as it is, with no second pass over it', async () => {
        const world = await boot('opfs')
        world.units.failWrite = (attempt) => (attempt === 2 ? 'throw' : undefined)
        const root = { formatversion: 5, archiveCharacters: true, __directory: ['preset', 'a', 'b', 'config'] }
        const partial = await composeSave(new RisuSaveEncoder(), [
            { name: 'root', type: BLOCK.ROOT, data: JSON.stringify(root) },
            { name: 'preset', type: BLOCK.BOTPRESET, data: '[{"name":"p"}]' },
            { name: 'a', type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify(fullCharacter('a', 'A')) },
            { name: 'b', type: BLOCK.REMOTE, data: JSON.stringify({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', hash: '0123456789abcdef' }) },
            { name: 'config', type: BLOCK.CONFIG, data: '{"version":1}' },
        ])
        await expect(decodeRisuSave(partial.bytes, { strict: true })).rejects.toBeDefined()
        world.readQueue.push(async () => partial.bytes)

        const result = await bootOnce(world)

        expect(world.units.attempts).toBe(2)
        expect(result.outcome.kind).toBe('install')
        expect(chaIdsOf(installedTree(result.outcome))).toEqual(['a'])
        expect(world.mainWrites.length).toBe(0)
    })

    test('C7: a re-read whose bytes do not decode on web falls to the backup path', async () => {
        const world = await boot('opfs')
        world.units.failWrite = (attempt) => (attempt === 2 ? 'throw' : undefined)
        world.readQueue.push(async () => new Uint8Array([9, 9, 9, 9]))

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('backup-fallback')
        expect(world.mainWrites.length).toBe(0)
    })
})

describe('boot archive pass: Tauri seams (in-memory model, not the native file system)', () => {
    test('guard: a re-read that does not decode takes the backup-fallback path, and nothing is written to the main file: it is as it was and no head exists', async () => {
        const world = await boot('tauri')
        const original = world.currentMain() as Uint8Array
        world.units.failWrite = (attempt) => (attempt === 2 ? 'throw' : undefined)
        world.readQueue.push(async () => new Uint8Array([7, 7, 7, 7]))

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('backup-fallback')
        expect(world.mainWrites.length).toBe(0)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect(blockWriteRequests(world), 'writes under blocks/').toBe(0)
    })

    test.each([
        ['returns nothing', async () => null],
        ['throws', async () => { throw new Error('read failed') }],
    ] as const)('a re-read that %s stops the boot on Tauri as on the web, and writes nothing to the main file', async (_label, answer) => {
        const world = await boot('tauri')
        const original = world.currentMain() as Uint8Array
        world.units.failWrite = (attempt) => (attempt === 2 ? 'throw' : undefined)
        world.readQueue.push(answer)

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('stop')
        expect(world.mainWrites.length).toBe(0)
        expect(world.mainLog.filter((entry) => entry === 'reread'), 'exactly one re-read').toHaveLength(1)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect(blockWriteRequests(world), 'writes under blocks/').toBe(0)
    })

    test('a failed conversion on Tauri leaves the legacy main file authoritative and writes no head: the profile installs as it was', async () => {
        const world = await boot('tauri')
        const original = world.currentMain() as Uint8Array
        world.failNextMainWrite = new Error('commit rejected')

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('install')
        expect(chaIdsOf(installedTree(result.outcome))).toEqual(['a', 'b', 'c'])
        expect(charactersOf(installedTree(result.outcome)).some((c) => !!c.coldstorage)).toBe(false)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect(blockWriteRequests(world), 'writes under blocks/').toBe(0)
    })

    test('takes the backup-fallback path when the re-read does not decode, however many reads it takes: a second bad read is never asked for', async () => {
        const world = await boot('tauri')
        world.units.failWrite = (attempt) => (attempt === 2 ? 'throw' : undefined)
        world.readQueue.push(async () => new Uint8Array([7, 7, 7, 7]), async () => new Uint8Array([7, 7, 7, 7]))

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('backup-fallback')
        expect(world.readQueue, 'the second queued read was never taken').toHaveLength(1)
    })
})

type Arrange = (world: World) => Promise<void> | void

const RELEASE_SCENARIOS: [string, WorldHost, Arrange][] = [
    ['a failed unit write', 'opfs', (w) => { w.units.failWrite = (n) => (n === 2 ? 'false' : undefined) }],
    ['a read-back of another chaId', 'opfs', (w) => { w.units.readOverride = async () => ({ status: 'ok', value: { character: { chaId: 'x' } } }) }],
    ['encoded blocks that lose a block', 'opfs', (w) => { w.deps.createEncoder = () => new DroppingEncoder() }],
    ['a throw inside the pass', 'opfs', (w) => { w.units.failWrite = (n) => (n === 2 ? 'throw' : undefined) }],
    ['a re-read that finds nothing', 'opfs', (w) => { w.units.failWrite = (n) => (n === 2 ? 'throw' : undefined); w.readQueue.push(async () => null) }],
    ['a rejected commit', 'opfs', (w) => { w.failNextMainWrite = new Error('commit rejected') }],
    ['another device converting the profile during the pass', 'node', (w) => { peerConvertsDuringPass(w) }],
    ['a failed root write on the Node server', 'node', (w) => { failRootWriteAfterRevisionBump(w) }],
    ['a rejected commit followed by a web re-read that throws', 'opfs', (w) => { w.failNextMainWrite = new Error('commit rejected'); w.readQueue.push(async () => { throw new Error('read failed') }) }],
    ['a Node re-read that throws', 'node', (w) => { w.units.failWrite = (n) => (n === 2 ? 'throw' : undefined); w.readQueue.push(async () => { throw 'getItem Error' }) }],
]

describe('boot archive pass: the hold is released on every failure path', () => {
    test.each(RELEASE_SCENARIOS)('C8: guard: after %s the write lock is free, the hold was released with no argument and another tab can take presence', async (_label, host, arrange) => {
        const world = await boot(host)
        await arrange(world)

        await bootOnce(world)

        expect(world.releaseArgs.every((arg) => arg === undefined)).toBe(true)
        expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
        const other = makeTab(world.core, 'B')
        const granted = await Promise.race([
            other.locks.tabPresenceLockAcquired.then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 400)),
        ])
        expect(granted).toBe(true)
    })
})

describe('boot archive pass: the one-time key and notice', () => {
    const HOSTS = ['node', 'opfs'] as const

    test.each(HOSTS)('D1 (%s): with the key absent and nothing eligible, the pass commits the key, raises the notice once, and a second boot raises none', async (host) => {
        const tree = baseTree([fullCharacter('t1', 'T1', { trashTime: 1 })])
        useHost(host)
        const world = await worldFor(kit, host, tree)

        const first = await bootOnce(world)

        expect(first.outcome.kind === 'install' && first.outcome.notices).toEqual([{ kind: 'archive-enabled' }])
        expect(installedTree(first.outcome).archiveCharacters).toBe(true)
        expect(world.units.writes.length).toBe(0)
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(committed.archiveCharacters).toBe(true)

        const second = await bootOnce(world)

        expect(second.outcome.kind === 'install' && second.outcome.notices).toEqual([])
        expect(world.mainWrites.length).toBe(1)
    })

    test('D1: with the key absent and characters to archive, the one notice is the archive notice', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]))

        const result = await bootOnce(world)

        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([{ kind: 'archive-enabled' }])
        expect(installedTree(result.outcome).archiveCharacters).toBe(true)
    })

    test.each(HOSTS)('D2 (%s): guard: a commit that fails and leaves the file without the key writes no key and raises no notice', async (host) => {
        useHost(host)
        const world = await worldFor(kit, host, baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]))
        const original = world.currentMain() as Uint8Array
        world.failNextMainWrite = new Error('commit rejected')

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('install')
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([])
        expect(installedTree(result.outcome)).not.toHaveProperty('archiveCharacters')
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
    })

    test('D2: a conversion that landed on the Node server but whose head response was lost is reported as committed, with the notice, and the profile it left is the installed one', async () => {
        useHost('node')
        const world = await worldFor(kit, 'node', baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]))
        loseHeadResponse(world)

        const result = await bootOnce(world)

        expect(result.outcome.kind === 'install' && result.outcome.committed).toBe(true)
        expect(installedTree(result.outcome).archiveCharacters).toBe(true)
        expect(charactersOf(installedTree(result.outcome)).map((c) => !!c.coldstorage)).toEqual([true, true])
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([{ kind: 'archive-enabled' }])
        vi.unstubAllGlobals()
        vi.stubGlobal('fetch', (world.server as FakeNodeServer).fetch)
        const landed = await decodeRisuSave(await world.committedFile() as Uint8Array, { strict: true })
        expect(jsonOf(charactersOf(landed))).toEqual(jsonOf(charactersOf(installedTree(result.outcome))))
    })
})
