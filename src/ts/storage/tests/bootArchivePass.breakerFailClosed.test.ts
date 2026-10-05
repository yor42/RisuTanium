/**
 * The boot archive pass, the crash-loop breaker when its record cannot be used
 * (`src/ts/storage/bootArchivePass.ts`): a count that cannot be read, or a
 * start record that cannot be made, means the pass writes nothing on that boot,
 * logs one warning and installs the repaired tree; a success reset that fails
 * is logged and changes nothing else. Counting and pausing are in
 * `bootArchivePass.breaker.test.ts`; how the memo module reads and writes
 * `localStorage` is in `bootArchiveBreaker.memo.test.ts`.
 *
 * The strike record is the `world.breaker` model, so these tests assert what
 * the pass does when a dependency answers or throws, not how storage fails.
 * They exercise the pass against in-memory models; they say nothing about
 * `localStorage`, the Tauri file system, the real Node server or a browser's
 * OPFS or Web Locks.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    baseTree,
    bootOnce,
    bytesEqual,
    charactersOf,
    directWorld,
    fullCharacter,
    installedTree,
    noticeKinds,
    runDirect,
    worldFor,
    writeLockIsFree,
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
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function profile(ids: string[], extra: Record<string, unknown> = {}) {
    return baseTree(ids.map((id) => fullCharacter(id, id.toUpperCase())), { archiveCharacters: true, ...extra })
}

type Break = (world: World) => void

/** The ways the strike record cannot be used. `starts` is true when the pass must have tried the start record. */
const UNUSABLE: [label: string, starts: boolean, apply: Break][] = [
    ['a count read that throws', false, (w) => { w.breaker.readThrows = true }],
    ['a count that cannot be read', false, (w) => { w.breaker.strikes = 'unreadable' }],
    ['a start record that is not written', true, (w) => { w.breaker.startFails = true }],
    ['a start record that throws', true, (w) => { w.breaker.startThrows = true }],
]

describe('boot archive pass breaker: an unusable strike record fails closed', () => {
    describe.each(HOSTS)('%s', (host) => {
        test.each(UNUSABLE)('%s: nothing is written, encoded or re-read, one warning is logged and the tree is installed as the boot decoded it', async (_label, starts, apply) => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
            useHost(host)
            const world = await worldFor(kit, host, profile(['a', 'b', 'c']))
            const original = world.currentMain() as Uint8Array
            apply(world)

            const result = await bootOnce(world)

            expect(world.units.attempts, 'unit writes attempted').toBe(0)
            expect(world.encoderCalls, 'encoders created').toBe(0)
            expect(world.mainLog, 'main-file traffic').toEqual(['boot-read'])
            expect(world.mainWrites.length).toBe(0)
            expect(bytesEqual(world.currentMain(), original)).toBe(true)
            expect(world.breaker.calls).toContain(starts ? 'start' : 'read')
            expect(world.breaker.calls).not.toContain('reset')
            expect(result.outcome.kind).toBe('install')
            expect(result.outcome.kind === 'install' && result.outcome.noteBytes).toBeNull()
            expect(noticeKinds(result.outcome)).toEqual([])
            expect(charactersOf(installedTree(result.outcome)).map((c) => c.chaId)).toEqual(['a', 'b', 'c'])
            expect(charactersOf(installedTree(result.outcome)).some((c) => !!c.coldstorage)).toBe(false)
            expect(warn).toHaveBeenCalledTimes(1)
            if (host !== 'tauri') {
                expect(world.releaseArgs).toEqual([undefined])
                expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
            }
        })
    })

    test.each(UNUSABLE)('%s: the installed tree has its duplicate ids repaired', async (_label, _starts, apply) => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        useHost('opfs')
        const world = await directWorld(kit, 'opfs')
        apply(world)

        const outcome = await runDirect(world, baseTree([fullCharacter('dup', 'First'), fullCharacter('dup', 'Second')], { archiveCharacters: true }))

        expect(world.units.attempts).toBe(0)
        const slots = charactersOf(installedTree(outcome))
        expect(slots.length).toBe(2)
        expect(new Set(slots.map((c) => c.chaId)).size).toBe(2)
        expect(slots.some((c) => !!c.coldstorage)).toBe(false)
    })

    test('a start record that fails with the key absent commits no key', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('t1', 'T1', { trashTime: 1 })]))
        world.breaker.startFails = true

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(0)
        expect(world.encoderCalls).toBe(0)
        expect(installedTree(result.outcome)).not.toHaveProperty('archiveCharacters')
        expect(noticeKinds(result.outcome)).toEqual([])
    })

    test('a start record that fails leaves the strike count where it was', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', profile(['a', 'b']))
        world.breaker.strikes = 1
        world.breaker.startFails = true

        await bootOnce(world)

        expect(world.breaker.strikes).toBe(1)
        expect(world.units.attempts).toBe(0)
    })
})

describe('boot archive pass breaker: a success reset that fails changes nothing else', () => {
    test('after a commit the reset is attempted, the failure is logged, and the outcome and notices are the commit\'s', async () => {
        const logged = [vi.spyOn(console, 'warn').mockImplementation(() => { }), vi.spyOn(console, 'error').mockImplementation(() => { })]
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]))
        world.breaker.resetThrows = true

        const result = await bootOnce(world)

        expect(world.breaker.calls).toContain('reset')
        expect(world.mainLog.filter((e) => e === 'reread'), 'main-file re-reads').toEqual([])
        expect(world.mainWrites.length).toBe(1)
        expect(result.outcome.kind === 'install' && result.outcome.noteBytes).toBeNull()
        expect(result.outcome.kind === 'install' && result.outcome.committed).toBe(true)
        expect(charactersOf(installedTree(result.outcome)).map((c) => !!c.coldstorage)).toEqual([true, true])
        expect(noticeKinds(result.outcome)).toEqual(['archive-enabled'])
        expect(logged.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBeGreaterThanOrEqual(1)
        expect(world.releaseArgs).toEqual([undefined])
    })

    test('after a pass that commits nothing the reset is attempted, the failure is logged, and the skip notice stands', async () => {
        const logged = [vi.spyOn(console, 'warn').mockImplementation(() => { }), vi.spyOn(console, 'error').mockImplementation(() => { })]
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', profile(['a']))
        world.units.failWrite = () => 'false'
        world.breaker.resetThrows = true

        const result = await bootOnce(world)

        expect(world.breaker.calls).toContain('reset')
        expect(world.mainLog.filter((e) => e === 'reread'), 'main-file re-reads').toEqual([])
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([
            { kind: 'archive-skipped', characters: [{ chaId: 'a', name: 'A' }] },
        ])
        expect(logged.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBeGreaterThanOrEqual(1)
    })
})
