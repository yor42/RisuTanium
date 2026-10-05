/**
 * The boot archive pass, the crash-loop breaker (`src/ts/storage/bootArchivePass.ts`):
 * a pass that starts writing leaves a durable start record before the first
 * unit write; a pass that succeeds resets the count to zero; a pass that fails
 * or is interrupted keeps its strike; two strikes in a row pause archiving on
 * the device until the setting is turned off and on, and the paused notice is
 * posted once. The fail-closed rules are in `bootArchivePass.breakerFailClosed.test.ts`.
 *
 * The real `RisuSaveEncoder`, `decodeRisuSave` and `NodeStorage` are used; the
 * Node server is `FakeNodeServer`, the web units go to an in-memory OPFS
 * directory (see `bootArchivePassHarness.ts`). The strike record is the
 * `world.breaker` model and the notice memo is `world.memo`; a test that needs
 * the next boot's notice memo applies the previous outcome's notices with
 * `applyNoticeMemo`, which stands for what bootstrap does after it posts them.
 * These tests exercise the pass against in-memory models; they say nothing
 * about `localStorage`, the Tauri file system, the real Node server or a
 * browser's OPFS or Web Locks.
 *
 * Tests titled `guard:` assert behaviour that holds with and without the
 * breaker and must keep holding. The others fail without it: no start record,
 * no reset, no pause.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    MAIN_KEY,
    applyNoticeMemo,
    baseTree,
    blockWorldFor,
    bootHost,
    bootOnce,
    charactersOf,
    clearDeviceRecords,
    directWorld,
    encodeAsSaveDb,
    fullCharacter,
    installedTree,
    noticeKinds,
    peerCommits,
    plugin,
    runDirect,
    startBoot,
    worldFor,
    writeLockIsFree,
    type RemoteLike,
    type World,
    type WorldHost,
    type WorldKit,
    type WorldOptions,
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

function archivedFlags(tree: ReturnType<typeof baseTree>): boolean[] {
    return charactersOf(tree).map((c) => !!c.coldstorage)
}

/** A profile with the setting already on, so a boot's notices come from the pass's own outcome only. */
function profile(ids: string[], extra: Record<string, unknown> = {}) {
    return baseTree(ids.map((id) => fullCharacter(id, id.toUpperCase())), { archiveCharacters: true, ...extra })
}

async function bootProfile(host: WorldHost, ids: string[], extra: Record<string, unknown> = {}, strikes = 0, kind: 'legacy' | 'block' = 'legacy'): Promise<World> {
    useHost(host)
    const world = kind === 'block'
        ? await blockWorldFor(kit, host, profile(ids, extra))
        : await worldFor(kit, host, profile(ids, extra))
    world.breaker.strikes = strikes
    return world
}

/** The pass made no start record and no reset: it did not count anything on this boot. */
function expectNothingCounted(world: World) {
    expect(world.breaker.calls).not.toContain('start')
    expect(world.breaker.calls).not.toContain('reset')
}

/** The start record was made, and before `effect` happened. */
function expectStartedBefore(world: World, effect: World['order'][number]) {
    expect(world.order, 'effects in order').toContain('start')
    expect(world.order, 'effects in order').toContain(effect)
    expect(world.order.indexOf('start')).toBeLessThan(world.order.indexOf(effect))
}

/** Nothing was written, encoded or re-read: the boot read the main file and the tree is installed with no new stub. */
function expectNothingWritten(world: World, outcome: Awaited<ReturnType<typeof bootOnce>>['outcome']) {
    expect(world.units.attempts, 'unit writes attempted').toBe(0)
    expect(world.encoderCalls, 'encoders created').toBe(0)
    expect(world.mainLog, 'main-file traffic').toEqual(['boot-read'])
    expect(world.mainWrites.length).toBe(0)
    expect(outcome.kind).toBe('install')
    if (outcome.kind === 'install') {
        expect(outcome.noteBytes).toBeNull()
        expect(charactersOf(outcome.tree).some((c) => !!c.coldstorage)).toBe(false)
    }
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

/** Another device saves the profile when the pass writes its first unit; the peer's save holds `ids`. The profile is a block profile. */
function peerCommitsAtFirstUnit(world: World, ids: string[]): void {
    let armed = true
    const writeUnit = world.deps.writeUnit
    world.deps.writeUnit = async (key, value) => {
        if (armed) {
            armed = false
            await peerCommits(world, profile(ids))
        }
        return writeUnit(key, value)
    }
}

type Arrange = (world: World) => Promise<void> | void

/** Ways a pass that started ends without reaching success. Each leaves the original profile installed or the peer's. */
const FAILURES: [label: string, host: WorldHost, arrange: Arrange, kind?: 'legacy' | 'block'][] = [
    ['a rejected commit', 'opfs', (w) => { w.failNextMainWrite = new Error('commit rejected') }],
    ['a rejected commit on Tauri', 'tauri', (w) => { w.failNextMainWrite = new Error('commit rejected') }],
    ['a unit write that throws', 'opfs', (w) => { w.units.failWrite = (n) => (n === 2 ? 'throw' : undefined) }],
    ['an encoder that throws', 'opfs', (w) => { w.deps.createEncoder = () => { throw new Error('encoder failed') } }],
    ['encoded blocks that lose a block', 'opfs', (w) => { w.deps.createEncoder = () => new DroppingEncoder() }],
    ['a peer commit during the pass on the Node server', 'node', (w) => { peerCommitsAtFirstUnit(w, ['p1', 'p2']) }, 'block'],
]

describe('boot archive pass breaker: a pass that succeeds', () => {
    test.each(HOSTS)('%s: records the start before the first unit write and resets the count after the commit', async (host) => {
        const world = await bootProfile(host, ['a', 'b', 'c'])

        const result = await bootOnce(world)

        expectStartedBefore(world, 'unit-write')
        expectStartedBefore(world, 'encoder')
        expect(world.order.filter((e) => e === 'start').length, 'start records').toBe(1)
        expect(world.order.lastIndexOf('reset')).toBeGreaterThan(world.order.lastIndexOf('main-write'))
        expect(world.breaker.strikes).toBe(0)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, true, true])
        expect(noticeKinds(result.outcome)).toEqual([])
    })

    test.each(HOSTS)('%s: with one earlier strike a good pass archives normally and leaves the count at zero', async (host) => {
        const world = await bootProfile(host, ['a', 'b', 'c'], {}, 1)

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(3)
        expect(world.mainWrites.length).toBe(1)
        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, true, true])
        expect(world.breaker.strikes).toBe(0)
        expect(noticeKinds(result.outcome)).toEqual([])
    })

    test.each(HOSTS)('%s: with the key absent and nothing eligible the key-only commit is preceded by the start record and followed by a reset', async (host) => {
        useHost(host)
        const world = await worldFor(kit, host, baseTree([fullCharacter('t1', 'T1', { trashTime: 1 })]))
        world.breaker.strikes = 1

        const result = await bootOnce(world)

        expect(world.units.attempts, 'unit writes attempted').toBe(0)
        expect(world.mainWrites.length).toBe(1)
        expectStartedBefore(world, 'encoder')
        expect(world.order.lastIndexOf('reset')).toBeGreaterThan(world.order.lastIndexOf('main-write'))
        expect(world.breaker.strikes).toBe(0)
        expect(noticeKinds(result.outcome)).toEqual(['archive-enabled'])
    })

    test('an isolated skip with nothing else to archive is a success: the count goes to zero and the skip is named', async () => {
        const world = await bootProfile('opfs', ['a'], {}, 1)
        world.units.failWrite = () => 'false'

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(0)
        expect(world.order).toContain('start')
        expect(world.breaker.strikes).toBe(0)
        expect(result.outcome.kind === 'install' && result.outcome.notices).toEqual([
            { kind: 'archive-skipped', characters: [{ chaId: 'a', name: 'A' }] },
        ])
    })

    test('an isolated skip beside archived characters is a success: the count goes to zero', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c'], {}, 1)
        world.units.failWrite = (attempt) => (attempt === 2 ? 'false' : undefined)

        const result = await bootOnce(world)

        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, false, true])
        expect(world.breaker.strikes).toBe(0)
        expect(noticeKinds(result.outcome)).toEqual(['archive-skipped'])
    })

    test.each(HOSTS)('%s: a stop that archived something first is a success: the count goes to zero and the stopped notice stands alone', async (host) => {
        const world = await bootProfile(host, ['a', 'b', 'c', 'd'], {}, 1)
        world.units.failWrite = (attempt) => (attempt >= 3 ? 'false' : undefined)

        const result = await bootOnce(world)

        expect(archivedFlags(installedTree(result.outcome))).toEqual([true, true, false, false])
        expect(world.mainWrites.length).toBe(1)
        expect(world.breaker.strikes).toBe(0)
        expect(noticeKinds(result.outcome)).toEqual(['archive-stopped'])
    })
})

describe('boot archive pass breaker: a stop that archived nothing is a strike', () => {
    test.each(HOSTS)('%s: with the key present the nothing-changed return keeps the strike and posts no paused notice at the first', async (host) => {
        const world = await bootProfile(host, ['a', 'b'])
        world.units.failWrite = () => 'false'

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(0)
        expect(world.breaker.strikes).toBe(1)
        expect(world.breaker.calls).not.toContain('reset')
        expect(noticeKinds(result.outcome)).toEqual(['archive-stopped'])
    })

    test('with one earlier strike the second counts and the notices end [stopped, paused]', async () => {
        const world = await bootProfile('opfs', ['a', 'b'], {}, 1)
        world.units.failWrite = () => 'false'

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(0)
        expect(world.breaker.strikes).toBe(2)
        expect(noticeKinds(result.outcome)).toEqual(['archive-stopped', 'archive-paused'])
    })

    test('with the key absent the key-only commit is still written, the boot counts a strike, and the notices are [enabled, stopped]', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]))
        world.units.failWrite = () => 'false'

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(1)
        expect(installedTree(result.outcome).archiveCharacters).toBe(true)
        expect(world.breaker.strikes).toBe(1)
        expect(world.breaker.calls).not.toContain('reset')
        expect(noticeKinds(result.outcome)).toEqual(['archive-enabled', 'archive-stopped'])
    })

    test('with the key absent and one earlier strike the notices are [enabled, stopped, paused]', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')]))
        world.breaker.strikes = 1
        world.units.failWrite = () => 'false'

        const result = await bootOnce(world)

        expect(world.mainWrites.length).toBe(1)
        expect(world.breaker.strikes).toBe(2)
        expect(noticeKinds(result.outcome)).toEqual(['archive-enabled', 'archive-stopped', 'archive-paused'])
    })
})

describe('boot archive pass breaker: a failed pass keeps its strike', () => {
    test.each(FAILURES)('%s: counts a strike, installs without a paused notice at the first', async (_label, host, arrange, kind) => {
        const world = await bootProfile(host, ['a', 'b', 'c'], {}, 0, kind)
        await arrange(world)

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('install')
        expect(world.order).toContain('start')
        expect(world.breaker.strikes).toBe(1)
        expect(world.breaker.calls).not.toContain('reset')
        expect(noticeKinds(result.outcome)).toEqual([])
    })

    test.each(FAILURES)('%s: with one earlier strike the second counts and the boot ends with the paused notice', async (_label, host, arrange, kind) => {
        const world = await bootProfile(host, ['a', 'b', 'c'], {}, 1, kind)
        await arrange(world)

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('install')
        expect(world.breaker.strikes).toBe(2)
        expect(noticeKinds(result.outcome)).toEqual(['archive-paused'])
    })

    test('a success after a failure resets the count, so failures that are not consecutive never pause', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c'])
        world.failNextMainWrite = new Error('commit rejected')
        const failed = await bootOnce(world)
        expect(world.breaker.strikes).toBe(1)
        expect(noticeKinds(failed.outcome)).toEqual([])

        const succeeded = await bootOnce(world)
        expect(archivedFlags(installedTree(succeeded.outcome))).toEqual([true, true, true])
        expect(world.breaker.strikes).toBe(0)

        // The profile is a block profile now; another page restores a different one with characters to archive.
        await world.replaceProfile(profile(['d', 'e']))
        world.failNextMainWrite = new Error('commit rejected')
        const failedAgain = await bootOnce(world)

        expect(world.breaker.strikes).toBe(1)
        expect(noticeKinds(failedAgain.outcome)).toEqual([])
    })

    test.each(HOSTS)('%s: two failed commits in a row pause the third boot, which writes nothing and installs the tree', async (host) => {
        const world = await bootProfile(host, ['a', 'b', 'c'])
        world.failNextMainWrite = new Error('commit rejected')
        const first = await bootOnce(world)
        expect(world.breaker.strikes).toBe(1)
        expect(noticeKinds(first.outcome)).toEqual([])
        applyNoticeMemo(world, first.outcome)

        world.failNextMainWrite = new Error('commit rejected')
        const second = await bootOnce(world)
        expect(world.breaker.strikes).toBe(2)
        expect(noticeKinds(second.outcome)).toEqual(['archive-paused'])
        applyNoticeMemo(world, second.outcome)

        const attempts = world.units.attempts
        const encoders = world.encoderCalls
        const logLength = world.mainLog.length
        const callsLength = world.breaker.calls.length
        const third = await bootOnce(world)

        expect(world.units.attempts, 'unit writes on the third boot').toBe(attempts)
        expect(world.encoderCalls, 'encoders created on the third boot').toBe(encoders)
        expect(world.mainLog.slice(logLength), 'main-file traffic on the third boot').toEqual(['boot-read'])
        expect(world.breaker.calls.slice(callsLength)).not.toContain('start')
        expect(world.breaker.strikes).toBe(2)
        expect(noticeKinds(third.outcome)).toEqual([])
        expect(archivedFlags(installedTree(third.outcome))).toEqual([false, false, false])
    })

    test('two peer commits during the pass on two boots pause the Node server device the same way', async () => {
        const world = await bootProfile('node', ['a', 'b', 'c'], {}, 0, 'block')
        peerCommitsAtFirstUnit(world, ['p1', 'p2'])
        const first = await bootOnce(world)
        expect(first.outcome.kind).toBe('install')
        expect(world.breaker.strikes).toBe(1)
        expect(noticeKinds(first.outcome)).toEqual([])

        peerCommitsAtFirstUnit(world, ['q1', 'q2'])
        const second = await bootOnce(world)
        expect(world.breaker.strikes).toBe(2)
        expect(noticeKinds(second.outcome)).toEqual(['archive-paused'])
        applyNoticeMemo(world, second.outcome)

        const attempts = world.units.attempts
        const third = await bootOnce(world)

        expect(world.units.attempts, 'unit writes on the third boot').toBe(attempts)
        expect(noticeKinds(third.outcome)).toEqual([])
    })

    test.each([
        ['stop', async () => { throw new Error('storage read failed') }],
        ['backup-fallback', async () => new Uint8Array([1, 2, 3, 4])],
    ] as const)('a second failure that ends in %s keeps the strike, and the next boot posts the paused notice once', async (kind, read) => {
        const world = await bootProfile('opfs', ['a', 'b', 'c'], {}, 1)
        world.failNextMainWrite = new Error('commit rejected')
        world.readQueue.push(read)

        const ended = await bootOnce(world)

        expect(ended.outcome.kind).toBe(kind)
        expect(world.breaker.strikes).toBe(2)
        expect(noticeKinds(ended.outcome)).toEqual([])
        expect(world.memo.pausedTold).toBe(false)

        const attempts = world.units.attempts
        const next = await bootOnce(world)
        expect(noticeKinds(next.outcome)).toEqual(['archive-paused'])
        expect(world.units.attempts, 'unit writes on the boot after the pause').toBe(attempts)
        applyNoticeMemo(world, next.outcome)

        const after = await bootOnce(world)
        expect(noticeKinds(after.outcome)).toEqual([])
        expect(world.units.attempts).toBe(attempts)
    })
})

describe('boot archive pass breaker: an interrupted pass keeps its strike', () => {
    /** A boot whose first unit write never settles, as when the tab is closed or killed during it. */
    async function interruptedBoot(world: World): Promise<void> {
        const realWrite = world.deps.writeUnit
        world.deps.writeUnit = () => {
            world.order.push('unit-write')
            return new Promise<boolean>(() => { })
        }
        const { session, tree } = await startBoot(world)
        void session.run({ tree })
        await vi.waitFor(() => { expect(world.order).toContain('start') }, { timeout: 500, interval: 5 })
        await vi.waitFor(() => { expect(world.order).toContain('unit-write') }, { timeout: 500, interval: 5 })
        world.deps.writeUnit = realWrite
    }

    test('the start record is already counted while the pass is still writing, and one interruption does not stop the next boot', async () => {
        const world = await bootProfile('tauri', ['a', 'b', 'c'])

        await interruptedBoot(world)

        expect(world.breaker.strikes).toBe(1)
        expect(world.breaker.calls).not.toContain('reset')

        const next = await bootOnce(world)

        expect(archivedFlags(installedTree(next.outcome))).toEqual([true, true, true])
        expect(world.breaker.strikes).toBe(0)
        expect(noticeKinds(next.outcome)).toEqual([])
    })

    test('two interruptions in a row pause the third boot, which writes nothing and posts the paused notice', async () => {
        const world = await bootProfile('tauri', ['a', 'b', 'c'])
        await interruptedBoot(world)
        await interruptedBoot(world)
        expect(world.breaker.strikes).toBe(2)
        const attempts = world.units.attempts

        const third = await bootOnce(world)

        expect(world.units.attempts, 'unit writes on the third boot').toBe(attempts)
        expect(world.mainWrites.length).toBe(0)
        expect(noticeKinds(third.outcome)).toEqual(['archive-paused'])
        expect(archivedFlags(installedTree(third.outcome))).toEqual([false, false, false])
    })
})

describe('boot archive pass breaker: a paused device writes nothing', () => {
    test.each(HOSTS)('%s: with two strikes and the user not yet told the pass writes nothing, installs the tree and posts the paused notice, which the next boot does not repeat once told', async (host) => {
        const world = await bootProfile(host, ['a', 'b', 'c'], {}, 2)

        const first = await bootOnce(world)

        expectNothingWritten(world, first.outcome)
        expect(world.breaker.calls).not.toContain('start')
        expect(world.breaker.calls).not.toContain('reset')
        expect(world.breaker.strikes).toBe(2)
        expect(noticeKinds(first.outcome)).toEqual(['archive-paused'])
        if (host !== 'tauri') {
            expect(world.releaseArgs).toEqual([undefined])
            expect(await writeLockIsFree(world.tab as NonNullable<World['tab']>)).toBe(true)
        }

        applyNoticeMemo(world, first.outcome)
        const logLength = world.mainLog.length
        const second = await bootOnce(world)

        expect(noticeKinds(second.outcome)).toEqual([])
        expect(world.mainLog.slice(logLength)).toEqual(['boot-read'])
        expect(world.units.attempts).toBe(0)
        expect(world.breaker.strikes).toBe(2)
    })

    test('a boot that ends before the paused notice is posted leaves it untold, so the next paused boot posts it again', async () => {
        const world = await bootProfile('opfs', ['a', 'b'], {}, 2)

        const first = await bootOnce(world)
        expect(noticeKinds(first.outcome)).toEqual(['archive-paused'])
        const second = await bootOnce(world)
        expect(noticeKinds(second.outcome)).toEqual(['archive-paused'])
        applyNoticeMemo(world, second.outcome)
        const third = await bootOnce(world)

        expect(noticeKinds(third.outcome)).toEqual([])
        expect(world.units.attempts).toBe(0)
    })

    test('a count above two is paused as well', async () => {
        const world = await bootProfile('opfs', ['a', 'b'], {}, 3)

        const result = await bootOnce(world)

        expectNothingWritten(world, result.outcome)
        expect(noticeKinds(result.outcome)).toEqual(['archive-paused'])
    })

    test('the installed tree has its duplicate ids repaired, its non-object slots dropped and its container defaults filled in', async () => {
        useHost('opfs')
        const world = await directWorld(kit, 'opfs')
        world.breaker.strikes = 2
        const tree = baseTree([fullCharacter('dup', 'First'), null, fullCharacter('dup', 'Second')], { archiveCharacters: true, modules: undefined, loadouts: undefined, plugins: undefined })

        const outcome = await runDirect(world, tree)

        expect(world.units.attempts).toBe(0)
        const installed = installedTree(outcome)
        const slots = charactersOf(installed)
        expect(slots.length).toBe(2)
        expect(new Set(slots.map((c) => c.chaId)).size).toBe(2)
        expect(slots.some((c) => !!c.coldstorage)).toBe(false)
        expect(installed.modules).toEqual([])
        expect(installed.loadouts).toEqual([])
        expect(installed.plugins).toEqual([])
        expect(noticeKinds(outcome)).toEqual(['archive-paused'])
    })

    test('a paused device with the key absent commits no key and posts only the paused notice', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('a', 'A')]))
        world.breaker.strikes = 2

        const result = await bootOnce(world)

        expectNothingWritten(world, result.outcome)
        expect(installedTree(result.outcome)).not.toHaveProperty('archiveCharacters')
        expect(noticeKinds(result.outcome)).toEqual(['archive-paused'])
    })

    test('a paused device with nothing eligible still posts the paused notice at the first boot that knows', async () => {
        useHost('opfs')
        const world = await worldFor(kit, 'opfs', baseTree([fullCharacter('t1', 'T1', { trashTime: 1 })], { archiveCharacters: true }))
        world.breaker.strikes = 2

        const result = await bootOnce(world)

        expectNothingWritten(world, result.outcome)
        expect(noticeKinds(result.outcome)).toEqual(['archive-paused'])
    })

    test('a paused device whose tree the refusal would reject posts the paused notice and does not count', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        useHost('opfs')
        const world = await directWorld(kit, 'opfs')
        world.breaker.strikes = 2

        const outcome = await runDirect(world, baseTree([fullCharacter('ok', 'Ok'), fullCharacter('root', 'Root')], { archiveCharacters: true }))

        expect(world.units.attempts).toBe(0)
        expect(world.breaker.calls).not.toContain('start')
        expect(noticeKinds(outcome)).toEqual(['archive-paused'])
    })

    test('the paused notice does not depend on the Node too-large memo: another host ignores that memo and is paused', async () => {
        const world = await bootProfile('opfs', ['a', 'b'], {}, 2)
        world.memo.tooLarge = true

        const result = await bootOnce(world)

        expectNothingWritten(world, result.outcome)
        expect(noticeKinds(result.outcome)).toEqual(['archive-paused'])
    })

    test('turning the setting off and on again clears the records, and the next boot archives from a zero count', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c'], {}, 2)
        const paused = await bootOnce(world)
        expectNothingWritten(world, paused.outcome)
        applyNoticeMemo(world, paused.outcome)

        clearDeviceRecords(world)
        const resumed = await bootOnce(world)

        expect(archivedFlags(installedTree(resumed.outcome))).toEqual([true, true, true])
        expect(world.mainWrites.length).toBe(1)
        expect(world.breaker.strikes).toBe(0)
        expect(noticeKinds(resumed.outcome)).toEqual([])
    })

    test('guard: after the records are cleared the pass runs from a zero count', async () => {
        const world = await bootProfile('opfs', ['a', 'b', 'c'], {}, 2)
        world.memo.pausedTold = true

        clearDeviceRecords(world)
        const resumed = await bootOnce(world)

        expect(archivedFlags(installedTree(resumed.outcome))).toEqual([true, true, true])
        expect(world.breaker.strikes).toBe(0)
    })
})

describe('boot archive pass breaker: the Node too-large refusal', () => {
    const TEST_LIMIT = 20_000

    function bigProfile(extra: Record<string, unknown> = {}) {
        return baseTree([fullCharacter('a', 'A'), fullCharacter('b', 'B')], { mainPrompt: 'x'.repeat(40_000), ...extra })
    }

    test('a commit over the limit counts a strike', async () => {
        useHost('node')
        const world = await worldFor(kit, 'node', bigProfile(), { nodeBodyLimit: TEST_LIMIT })

        const result = await bootOnce(world)

        expect(world.order).toContain('start')
        expect(world.breaker.strikes).toBe(1)
        expect(noticeKinds(result.outcome)).toEqual(['archive-too-large'])
    })

    test('a too-large boot that takes the count to two posts the too-large notice alone', async () => {
        useHost('node')
        const world = await worldFor(kit, 'node', bigProfile(), { nodeBodyLimit: TEST_LIMIT })
        world.breaker.strikes = 1

        const result = await bootOnce(world)

        expect(world.breaker.strikes).toBe(2)
        expect(noticeKinds(result.outcome)).toEqual(['archive-too-large'])
    })

    test('guard: once the too-large notice was posted at a count of two, the later boots are silent no-ops that write nothing', async () => {
        useHost('node')
        const world = await worldFor(kit, 'node', bigProfile(), { nodeBodyLimit: TEST_LIMIT })
        world.breaker.strikes = 2
        world.memo.tooLarge = true

        const first = await bootOnce(world)
        const second = await bootOnce(world)

        expect(noticeKinds(first.outcome)).toEqual([])
        expect(noticeKinds(second.outcome)).toEqual([])
        expect(world.units.attempts).toBe(0)
        expect(world.encoderCalls).toBe(0)
        expect(world.mainLog.filter((e) => e !== 'boot-read')).toEqual([])
    })
})

describe('boot archive pass breaker: boots that write nothing do not count', () => {
    type Case = [label: string, host: WorldHost, make: () => ReturnType<typeof baseTree>, options?: WorldOptions]

    const CASES: Case[] = [
        ['a tree that reads the setting off', 'opfs', () => baseTree([fullCharacter('a', 'A')], { archiveCharacters: false })],
        ['a save below format 5', 'opfs', () => baseTree([fullCharacter('a', 'A')], { archiveCharacters: true, formatversion: 4 })],
        ['an enabled V2.1 plugin', 'opfs', () => baseTree([fullCharacter('a', 'A')], { archiveCharacters: true, plugins: [plugin('2.1', true)] })],
        ['nothing eligible with the key present', 'opfs', () => baseTree([fullCharacter('t1', 'T1', { trashTime: 1 })], { archiveCharacters: true })],
        ['an array slot that is never eligible', 'opfs', () => baseTree([Object.assign([], { chaId: 'arr' })], { archiveCharacters: true })],
        ['a tree the refusal rejects', 'opfs', () => baseTree([fullCharacter('ok', 'Ok'), fullCharacter('root', 'Root')], { archiveCharacters: true })],
        ['a profile the session cannot archive', 'opfs', () => baseTree([fullCharacter('a', 'A')], { archiveCharacters: true }), { env: { staleAccountProfile: true } }],
    ]

    test.each(CASES)('guard: %s leaves a count of one alone and makes no start record or reset', async (_label, host, make, options) => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        useHost(host)
        const world = await directWorld(kit, host, options)
        world.breaker.strikes = 1

        const outcome = await runDirect(world, make())

        expect(outcome.kind).toBe('install')
        expect(world.units.attempts).toBe(0)
        expectNothingCounted(world)
        expect(world.breaker.strikes).toBe(1)
    })

    test('guard: every eligible character memoised as skipped leaves a count of one alone', async () => {
        const world = await bootProfile('opfs', ['a'], {}, 1)
        world.memo.skipped.add('a')

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('install')
        expect(world.units.attempts).toBe(0)
        expectNothingCounted(world)
        expect(world.breaker.strikes).toBe(1)
    })

    test('guard: the Node too-large memo leaves a count of one alone', async () => {
        const world = await bootProfile('node', ['a', 'b'], {}, 1)
        world.memo.tooLarge = true

        const result = await bootOnce(world)

        expect(result.outcome.kind).toBe('install')
        expect(world.units.attempts).toBe(0)
        expectNothingCounted(world)
        expect(world.breaker.strikes).toBe(1)
    })
})
