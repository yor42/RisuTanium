/**
 * The boot archive pass on the block store (`src/ts/storage/bootArchivePass.ts`
 * with the commit and re-read of `bootPassSeams.ts`): a block profile commits as
 * a save into its live generation, a legacy profile is converted by the same
 * commit, every failure leaves the previous root (or the legacy main file)
 * authoritative, and the encoder writes nothing of its own.
 *
 * The real `RisuSaveEncoder`, `decodeRisuSave`, block-store owner and
 * `createStorageTabLocks` are used over the world of `bootArchivePassHarness.ts`
 * (an in-memory store, or the real Node HTTP store over `FakeNodeServer`).
 * These tests exercise the pass against in-memory models; they say nothing
 * about the Tauri file system, the real Node server, or a browser's Web Locks.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    baseTree,
    blockWorldFor,
    blockWriteRequests,
    bootOnce,
    charactersOf,
    fullCharacter,
    installedTree,
    jsonOf,
    noticeKinds,
    startBoot,
    worldFor,
    type RemoteLike,
    type World,
    type WorldHost,
    type WorldKit,
    type WorldOptions,
} from './bootArchivePassHarness'
import { fingerprintMainFile, preBlocksKey } from '../mainFileFingerprint'
import { HEAD_KEY, ownBlockKey } from '../blockKeys'
import { parseHead } from '../headSwap'

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
import type { FakeNodeServer } from './manualCleanupHarness'

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
    vi.restoreAllMocks()
})

function profile(ids: string[], extra: Record<string, unknown> = {}) {
    return baseTree(ids.map((id) => fullCharacter(id, id.toUpperCase())), { archiveCharacters: true, ...extra })
}

async function blockWorld(host: WorldHost, ids: string[], options: WorldOptions = {}, extra: Record<string, unknown> = {}): Promise<World> {
    useHost(host)
    return blockWorldFor(kit, host, profile(ids, extra), options)
}

/** The own-key blocks (`blocks/<generation>/c/...`) the store holds, by character name. */
function ownKeys(world: World, generation: string, names: string[]): string[] {
    const fake = world.fake
    if (fake) {
        return names.filter((name) => fake.peek(ownBlockKey(generation, name)) !== null)
    }
    return names.filter((name) => (world.server as FakeNodeServer).files.has(ownBlockKey(generation, name)))
}

async function currentGeneration(world: World): Promise<string> {
    const head = (await world.store.read(HEAD_KEY)).bytes as Uint8Array
    const parsed = parseHead(head)
    if (parsed.status !== 'ok') {
        throw new Error('the head does not parse')
    }
    return parsed.record.current
}

describe('the pass commits into the live generation of a block profile', () => {
    test.each(['opfs', 'tauri', 'node'] as const)('%s: the archived characters leave their own keys for the stubs pack, under one generation and one root commit', async (host) => {
        const world = await blockWorld(host, ['a', 'b', 'c'])
        const generation = await currentGeneration(world)
        expect(ownKeys(world, generation, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])

        const result = await bootOnce(world)

        expect(result.outcome.kind === 'install' && result.outcome.committed).toBe(true)
        expect(await currentGeneration(world), 'a commit never writes the head').toBe(generation)
        expect(ownKeys(world, generation, ['a', 'b', 'c'])).toEqual([])
        expect(charactersOf(installedTree(result.outcome)).map((c) => !!c.coldstorage)).toEqual([true, true, true])
        const loaded = await decodeRisuSave(await world.committedFile() as Uint8Array, { strict: true })
        expect(jsonOf(charactersOf(loaded))).toEqual(jsonOf(charactersOf(installedTree(result.outcome))))
        expect(world.mainWrites.length).toBe(1)
    })

    test('the desktop app\'s in-process commit lock lets the post-commit deletes run without Web Locks, and a page with no lock at all keeps the own keys', async () => {
        const withLock = await blockWorld('tauri', ['a', 'b'])
        const generation = await currentGeneration(withLock)
        await bootOnce(withLock)
        expect(ownKeys(withLock, generation, ['a', 'b']), 'the desktop lock is available').toEqual([])

        const without = await blockWorld('opfs', ['a', 'b'], { commitLock: 'none' })
        const generationWithout = await currentGeneration(without)
        await bootOnce(without)
        expect(ownKeys(without, generationWithout, ['a', 'b']), 'without a commit lock the deletes are not run').toEqual(['a', 'b'])
        const loaded = await decodeRisuSave(await without.committedFile() as Uint8Array, { strict: true })
        expect(charactersOf(loaded).every((c) => !!c.coldstorage), 'the commit itself still landed').toBe(true)
    })

    test('a second boot of the committed profile has nothing left to do and writes nothing', async () => {
        const world = await blockWorld('opfs', ['a', 'b'])
        await bootOnce(world)
        const writes = blockWriteRequests(world)

        const second = await bootOnce(world)

        expect(second.outcome.kind === 'install' && second.outcome.committed).toBeUndefined()
        expect(blockWriteRequests(world), 'writes under blocks/').toBe(writes)
    })

    test('a failed commit leaves the previous root authoritative and writes nothing back: the next boot loads the characters as they were', async () => {
        const world = await blockWorld('opfs', ['a', 'b'])
        const fake = world.fake as NonNullable<World['fake']>
        const rootWrites: string[] = []
        const original = fake.write
        fake.write = async (key, bytes, condition) => {
            if (key.endsWith('/root')) {
                rootWrites.push(key)
                throw new Error('disk full')
            }
            return await original(key, bytes, condition)
        }

        const result = await bootOnce(world)

        expect(rootWrites.length).toBe(1)
        expect(result.outcome.kind).toBe('install')
        expect(result.outcome.kind === 'install' && result.outcome.committed).toBeUndefined()
        expect(charactersOf(installedTree(result.outcome)).map((c) => !!c.coldstorage)).toEqual([false, false])
        fake.write = original
        // The next boot, up to the point where the pass would run: the profile holds the characters as they were.
        const next = await startBoot(world)
        expect(charactersOf(next.tree).map((c) => c.chaId)).toEqual(['a', 'b'])
        expect(charactersOf(next.tree).map((c) => !!c.coldstorage)).toEqual([false, false])
    })

    test('a committed state that does not read cleanly after a failed pass takes the fallback path, never a write', async () => {
        const world = await blockWorld('opfs', ['a', 'b'])
        const fake = world.fake as NonNullable<World['fake']>
        world.failNextMainWrite = new Error('commit rejected')
        const generation = await currentGeneration(world)
        // After the failure the committed state is read again; a root that is gone makes it unreadable.
        const original = world.deps.reread
        world.deps.reread = async () => {
            fake.unplant(`blocks/${generation}/root`)
            return await original()
        }
        const writes = blockWriteRequests(world)

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('backup-fallback')
        expect(blockWriteRequests(world), 'no block write follows the failed read').toBe(writes)
    })
})

describe('the pass converts a legacy profile with the same commit', () => {
    test.each(['opfs', 'tauri', 'node'] as const)('%s: the head carries the fingerprint of the file the boot read and the time, and the old main file is moved aside', async (host) => {
        useHost(host)
        const world = await worldFor(kit, host, profile(['a', 'b']))
        const main = world.currentMain() as Uint8Array

        const result = await bootOnce(world)

        expect(result.outcome.kind === 'install' && result.outcome.committed).toBe(true)
        const head = parseHead((await world.store.read(HEAD_KEY)).bytes as Uint8Array)
        expect(head.status === 'ok' && head.record.convertedFrom).toBe(fingerprintMainFile(main))
        expect(head.status === 'ok' && (head.record.convertedAt ?? 0), 'the time of the conversion, by the owner\'s clock').toBeGreaterThanOrEqual(1_700_000_000_000)
        expect(world.currentMain(), 'the converted main file is gone').toBeNull()
        const moved = (await world.store.read(preBlocksKey(0))).bytes
        expect(Array.from(moved ?? [])).toEqual(Array.from(main))
    })

    test('a second boot is a block boot: the head is loaded, the convertedFrom stays, and nothing converts again', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', profile(['a', 'b']))
        await bootOnce(world)
        const headBefore = (await world.store.read(HEAD_KEY)).bytes as Uint8Array

        const second = await bootOnce(world)

        expect(Array.from((await world.store.read(HEAD_KEY)).bytes ?? [])).toEqual(Array.from(headBefore))
        expect(second.outcome.kind === 'install' && second.outcome.committed).toBeUndefined()
        expect(world.mainWrites.length).toBe(1)
    })

    test('a legacy profile with nothing to archive is left as it is: no conversion happens at boot', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', profile(['a'], { archiveCharacters: false }))
        const main = world.currentMain() as Uint8Array

        const result = await bootOnce(world)

        expect(result.outcome.kind === 'install' && result.outcome.committed).toBeUndefined()
        expect(world.currentMain()).toEqual(main)
        expect(blockWriteRequests(world)).toBe(0)
    })

    test('a conversion whose commit is over the Node limit is "too large": the notice, the main file untouched and nothing written under blocks/', async () => {
        useHost('node')
        const world = await worldFor(kit, 'node', profile(['a'], { mainPrompt: 'x'.repeat(40_000) }), { nodeBodyLimit: 20_000 })
        const main = world.currentMain() as Uint8Array

        const result = await bootOnce(world)

        expect(noticeKinds(result.outcome)).toEqual(['archive-too-large'])
        expect(world.currentMain()).toEqual(main)
        expect(blockWriteRequests(world)).toBe(0)
    })
})

describe('a block profile commit over the Node limit', () => {
    test('is reported as too large by the owner\'s own per-block check: the notice is raised, nothing is written and the profile installs as it was', async () => {
        // A profile whose root is over the limit another server would refuse; it is stored while no limit applies.
        const world = await blockWorld('node', ['a', 'b'], {}, { mainPrompt: 'x'.repeat(40_000) })
        world.setOwnerBodyLimit(20_000)
        // The pass is told no limit, so only the owner's own check can refuse.
        world.deps.nodeBodyLimit = undefined
        const writes = blockWriteRequests(world)

        const result = await bootOnce(world)

        expect(world.commitCalls.length, 'the commit was attempted').toBe(1)
        expect(noticeKinds(result.outcome)).toEqual(['archive-too-large'])
        expect(result.outcome.kind === 'install' && result.outcome.committed).toBeUndefined()
        expect(charactersOf(installedTree(result.outcome)).map((c) => !!c.coldstorage)).toEqual([false, false])
        expect(blockWriteRequests(world), 'writes under blocks/').toBe(writes)
    })
})

describe('a re-read that fails after a failed commit', () => {
    test.each(['opfs', 'tauri', 'node'] as const)('%s: stops the boot with the read error, so a numbered backup never stands in for a profile that was readable', async (host) => {
        useHost(host)
        const world = await worldFor(kit, host, profile(['a', 'b']))
        world.failNextMainWrite = new Error('commit rejected')
        world.deps.reread = async () => { throw new Error('the profile could not be read again') }

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('stop')
        expect(result.outcome.kind === 'stop' && String(result.outcome.error)).toContain('the profile could not be read again')
    })

    test('tauri: a re-read that returns no bytes stops the boot too', async () => {
        useHost('tauri')
        const world = await worldFor(kit, 'tauri', profile(['a', 'b']))
        world.failNextMainWrite = new Error('commit rejected')
        world.deps.reread = async () => ({ kind: 'bytes', bytes: null })

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('stop')
    })
})

describe('the pass runs only under the boot hold', () => {
    test.each(['opfs', 'tauri', 'node'] as const)('%s: after the session released the hold (a damage prompt did), a loaded profile installs as it is with no archive and no commit', async (host) => {
        const world = await blockWorld(host, ['a', 'b'])
        const generation = await currentGeneration(world)
        const { session, tree } = await startBoot(world)
        await session.release()
        const writes = blockWriteRequests(world)
        const encoders = world.encoderCalls

        const outcome = await session.run({ tree })

        expect(outcome.kind).toBe('install')
        expect(outcome.kind === 'install' && outcome.committed).toBeUndefined()
        expect(charactersOf(installedTree(outcome)).map((c) => !!c.coldstorage)).toEqual([false, false])
        expect(world.commitCalls).toEqual([])
        expect(world.encoderCalls).toBe(encoders)
        expect(blockWriteRequests(world)).toBe(writes)
        expect(ownKeys(world, generation, ['a', 'b'])).toEqual(['a', 'b'])
    })
})

describe('the pass\'s encoder writes nothing of its own', () => {
    test('with remote saving on, a Node boot writes no remotes/ file and every character block is inline', async () => {
        useHost('node')
        const world = await worldFor(kit, 'node', profile(['a', 'b'], { enableRemoteSaving: true }))
        h.db = { enableRemoteSaving: true }
        const server = world.server as FakeNodeServer

        await bootOnce(world)

        expect(server.requestsTo('/api/write').filter((request) => Buffer.from(request.headers['file-path'] ?? '', 'hex').toString('utf-8').startsWith('remotes/'))).toEqual([])
    })
})
