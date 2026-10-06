/**
 * The boot archive pass, the Node server's size rule
 * (`src/ts/storage/bootArchivePass.ts`): on the Node server host an encoded
 * commit over the server's body limit is never sent; it is a pass failure that
 * installs the main file as it is and carries a "too large" notice, and while
 * the device memo says so the pass does nothing at all. No other host is
 * affected.
 *
 * `FakeNodeServer` refuses a write body over the test limit with a 413, as the
 * real server's body parser does, so a pass that sends an oversized commit
 * fails as it would on a real server. The test limit is small; the pass is
 * told it through `BootArchiveDeps.nodeBodyLimit`. These tests exercise the
 * pass against in-memory models; they say nothing about the real server, the
 * Tauri file system or a browser's OPFS.
 *
 * Tests titled `guard:` assert behaviour that must not change; they pass with
 * and without the size rule. The others assert behaviour only the size rule
 * has.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    applyNoticeMemo,
    archiveMemoKeysWritten,
    baseTree,
    blockWriteRequests,
    bootOnce,
    bytesEqual,
    charactersOf,
    fullCharacter,
    installedTree,
    largestStoredBlock,
    mainFileRequests,
    noticeKinds,
    worldFor,
    type RemoteLike,
    type World,
    type WorldHost,
    type WorldKit,
} from './bootArchivePassHarness'
import type { FakeNodeServer } from './manualCleanupHarness'

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

import * as passModule from 'src/ts/storage/bootArchivePass'
import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import { NodeStorage } from 'src/ts/storage/nodeStorage'

const kit: WorldKit = {
    Encoder: RisuSaveEncoder,
    decodeRisuSave: decodeRisuSave as WorldKit['decodeRisuSave'],
    openBootArchiveSession: passModule.openBootArchiveSession,
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

/** The body limit of every world in this file; the commit of `bigProfile` is over it and each unit is far under it. */
const TEST_LIMIT = 20_000

/** Two small characters and a root field big enough that the encoded commit exceeds `TEST_LIMIT`. */
function bigProfile(extra: Record<string, unknown> = {}) {
    return baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')], { mainPrompt: 'x'.repeat(40_000), ...extra })
}

function mainWriteRequests(world: World): number {
    return mainFileRequests(world.server as FakeNodeServer).filter((r) => r === 'write').length
}

function archivedFlags(tree: ReturnType<typeof baseTree>): boolean[] {
    return charactersOf(tree).map((c) => !!c.coldstorage)
}

describe('boot archive pass: the size rule on the Node server', () => {
    test('a commit over the limit is never sent: the file is installed as it is, the too-large notice is the only one, and the next boot does nothing at all', async () => {
        useHost('node')
        const world = await worldFor(kit, 'node', bigProfile(), { nodeBodyLimit: TEST_LIMIT })
        const original = world.currentMain() as Uint8Array

        const first = await bootOnce(world)

        expect(world.mainLog.filter((e) => e === 'write'), 'main-file writes by the pass').toEqual([])
        expect(mainWriteRequests(world), 'write requests for the main file').toBe(0)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
        expect(first.outcome.kind).toBe('install')
        const installed = installedTree(first.outcome)
        expect(installed).not.toHaveProperty('archiveCharacters')
        expect(archivedFlags(installed)).toEqual([false, false])
        expect(first.outcome.kind === 'install' && first.outcome.notices).toEqual([{ kind: 'archive-too-large' }])
        expect(archiveMemoKeysWritten()).toEqual([])

        applyNoticeMemo(world, first.outcome)
        expect(world.memo.tooLarge).toBe(true)
        const attempts = world.units.attempts
        const encoders = world.encoderCalls
        const logLength = world.mainLog.length

        const second = await bootOnce(world)

        expect(world.units.attempts, 'unit writes on the next boot').toBe(attempts)
        expect(world.encoderCalls, 'encoders created on the next boot').toBe(encoders)
        expect(world.mainLog.slice(logLength), 'main-file traffic on the next boot').toEqual(['boot-read'])
        expect(mainWriteRequests(world)).toBe(0)
        expect(noticeKinds(second.outcome)).toEqual([])
        expect(installedTree(second.outcome)).not.toHaveProperty('archiveCharacters')
        expect(archivedFlags(installedTree(second.outcome))).toEqual([false, false])
        expect(second.outcome.kind === 'install' && second.outcome.noteBytes).toBeNull()
    })

    test('while the too-large memo is set the pass does nothing even when the profile has the key and other characters could be archived', async () => {
        useHost('node')
        const world = await worldFor(kit, 'node', baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')], { archiveCharacters: true }), { nodeBodyLimit: TEST_LIMIT })
        world.memo.tooLarge = true

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes').toBe(0)
        expect(world.encoderCalls).toBe(0)
        expect(world.mainLog).toEqual(['boot-read'])
        expect(noticeKinds(result.outcome)).toEqual([])
        expect(archivedFlags(installedTree(result.outcome))).toEqual([false, false])
    })

    test.each([
        ['throws', async () => { throw new Error('storage read failed') }, 'stop'],
        ['returns bytes that do not decode', async () => new Uint8Array([1, 2, 3, 4]), 'backup-fallback'],
    ] as const)('a commit over the limit followed by a re-read that %s ends the boot that way, with no write and no memo', async (_label, read, kind) => {
        useHost('node')
        const world = await worldFor(kit, 'node', bigProfile(), { nodeBodyLimit: TEST_LIMIT })
        world.readQueue.push(read)

        const result = await bootOnce(world)

        expect(world.mainLog.filter((e) => e === 'write'), 'main-file writes by the pass').toEqual([])
        expect(mainWriteRequests(world)).toBe(0)
        expect(result.outcome.kind).toBe(kind)
        expect(noticeKinds(result.outcome)).toEqual([])
        expect(archiveMemoKeysWritten()).toEqual([])
        expect(world.memo.tooLarge).toBe(false)
    })

    test('a commit whose largest block is exactly the limit is sent and one byte over is not', async () => {
        useHost('node')
        const small = baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')], { archiveCharacters: true })
        const probe = await worldFor(kit, 'node', small)
        await bootOnce(probe)
        expect(probe.mainWrites.length).toBe(1)
        const size = largestStoredBlock(probe)

        const atLimit = await worldFor(kit, 'node', small, { nodeBodyLimit: size })
        const fitted = await bootOnce(atLimit)

        expect(atLimit.mainWrites.length).toBe(1)
        expect(archivedFlags(installedTree(fitted.outcome))).toEqual([true, true])
        expect(noticeKinds(fitted.outcome)).toEqual([])

        const overLimit = await worldFor(kit, 'node', small, { nodeBodyLimit: size - 1 })
        const refused = await bootOnce(overLimit)

        expect(overLimit.mainWrites, 'commits that landed').toEqual([])
        expect(mainWriteRequests(overLimit)).toBe(0)
        expect(blockWriteRequests(overLimit), 'writes under blocks/ for a commit that is never sent').toBe(0)
        expect(noticeKinds(refused.outcome)).toEqual(['archive-too-large'])
    })

    test('the limit applies per block: a profile whose whole save is over it but no block is commits, and the too-large notice is not raised', async () => {
        useHost('node')
        // Trashed characters are never archived, so the commit carries all three in full.
        const characters = ['a', 'b', 'c'].map((id) => fullCharacter(id, id.toUpperCase(), { desc: 'd'.repeat(9_000), trashTime: 1 }))
        const world = await worldFor(kit, 'node', baseTree(characters), { nodeBodyLimit: TEST_LIMIT })

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(1)
        expect(world.mainWrites[0].length, 'the whole commit is over the limit').toBeGreaterThan(TEST_LIMIT)
        expect(largestStoredBlock(world), 'and no block is').toBeLessThanOrEqual(TEST_LIMIT)
        expect(noticeKinds(result.outcome)).not.toContain('archive-too-large')
        expect(world.server?.files.has('blocks/head')).toBe(true)
    })

    test('a value the owner refuses as over the limit is reported as too large, not as a failure: the notice is raised, nothing is written and the profile installs as it was', async () => {
        useHost('node')
        const world = await worldFor(kit, 'node', bigProfile(), { nodeBodyLimit: TEST_LIMIT })
        // The pass is told no limit, so only the owner's own pre-flight can refuse.
        world.deps.nodeBodyLimit = undefined
        const original = world.currentMain() as Uint8Array

        const result = await bootOnce(world)

        expect(world.commitCalls.length, 'the commit was attempted').toBe(1)
        expect(noticeKinds(result.outcome)).toEqual(['archive-too-large'])
        expect(result.outcome.kind === 'install' && result.outcome.committed).toBeUndefined()
        expect(archivedFlags(installedTree(result.outcome))).toEqual([false, false])
        expect(world.mainWrites).toEqual([])
        expect(blockWriteRequests(world), 'writes under blocks/').toBe(0)
        expect(bytesEqual(world.currentMain(), original)).toBe(true)
    })

    test('guard: a commit under the limit on the Node server is sent as before', async () => {
        useHost('node')
        const world = await worldFor(kit, 'node', baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]), { nodeBodyLimit: TEST_LIMIT })

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(1)
        expect(mainWriteRequests(world), 'the pass never writes the main file').toBe(0)
        expect(world.server?.files.has('blocks/head')).toBe(true)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, true])
        expect(noticeKinds(result.outcome)).toEqual(['archive-enabled'])
    })
})

describe('boot archive pass: hosts other than the Node server never apply the size rule', () => {
    test.each(['opfs', 'tauri'] as const)('guard: %s commits a save over the limit it is told, as if no limit existed', async (host) => {
        useHost(host)
        const world = await worldFor(kit, host, bigProfile(), { nodeBodyLimit: TEST_LIMIT })

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(1)
        expect(world.mainWrites[0].length).toBeGreaterThan(TEST_LIMIT)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, true])
        expect(noticeKinds(result.outcome)).toEqual(['archive-enabled'])
    })

    test.each(['opfs', 'tauri'] as const)('guard: %s ignores a too-large memo', async (host) => {
        useHost(host)
        const world = await worldFor(kit, host, bigProfile(), { nodeBodyLimit: TEST_LIMIT })
        world.memo.tooLarge = true

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(1)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, true])
    })
})

describe('boot archive pass: the limit predicate', () => {
    const fits = (passModule as unknown as { fitsNodeBodyLimit?: (length: number, limit: number) => boolean }).fitsNodeBodyLimit

    test('fitsNodeBodyLimit accepts a length equal to the server limit and refuses one byte over', () => {
        expect(typeof fits, 'fitsNodeBodyLimit export').toBe('function')
        const fit = fits as (length: number, limit: number) => boolean
        expect(fit(104_857_600, 104_857_600)).toBe(true)
        expect(fit(104_857_601, 104_857_600)).toBe(false)
        expect(fit(0, 104_857_600)).toBe(true)
        expect(fit(TEST_LIMIT, TEST_LIMIT)).toBe(true)
        expect(fit(TEST_LIMIT + 1, TEST_LIMIT)).toBe(false)
    })
})
