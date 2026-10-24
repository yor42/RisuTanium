// @vitest-environment node
/**
 * The development action of the collector run (`store2/gc/gcMeasure.ts`), its pacing and its install point in the
 * maintenance runner. The action exists only in a measurement build: with `MEASURE` false the runner installs nothing.
 *
 * What is a stand-in: `MEASURE` is a mocked module constant (a real normal build folds it at build time; the build output is
 * checked separately by `util/checkReleaseDist.mjs`), the page facts (page mode, the save loop's parked state, Web Locks)
 * are a double, the session is a literal over a memory backend or the Node semantic store, and the busy registry is the
 * real one. The module does not exist on the red base (the W6a commit), so a file here fails at import there, which
 * proves nothing by itself; a "reproducer" is red under the mutant named in the hand-back.
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() { return flag.measure },
}))
// The runner's default trigger drags in the whole save loop; every case here passes its own.
vi.mock(import('src/ts/process/memory/putBackQuiet'), () => ({
    startQuietTrigger: () => { throw new Error('The real quiet trigger is not used in this test.') },
}) as unknown as typeof import('src/ts/process/memory/putBackQuiet'))

import { beginBusy, busyKinds, isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { createMemoryBackend, createNodeBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import {
    encodeUnit, newStagedKey, newStagingId, newUnitKey, UNIT_TYPE, type KeyEnv,
} from 'src/ts/storage/store2/format'
import {
    installGcMeasure, OTHER_TAB_WAIT_MS, webLocksAvailable, type GcMeasureDeps, type GcMeasureReport, type GcPageFacts,
} from 'src/ts/storage/store2/gc/gcMeasure'
import { resetMaintenanceForTests, startStore2Maintenance, type MaintenanceEnv } from 'src/ts/storage/store2/maintenance'
import { batchPaceOf, NODE_BATCH_PACE_MS } from 'src/ts/storage/store2/oldData/delete'
import { Store2Session } from 'src/ts/storage/store2/session'
import { yieldToEventLoop } from 'src/ts/storage/saveYield'
import { createNodeSemanticStore } from './replay/nodeSemanticStore'
import { createClock, hooked, peerWrite, seedStore, testEnv } from './commitFixtures'

const clock = createClock()
const env: KeyEnv = testEnv(clock, 91)

const NAME = '__risuGcNow'

function handleOn(target: object): unknown {
    return (target as Record<string, unknown>)[NAME]
}

async function orphan(backend: Store2Backend): Promise<string> {
    const key = newUnitKey(env)
    await backend.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
    return key
}

async function exists(backend: Store2Backend, key: string): Promise<boolean> {
    return (await backend.readUnits([key])).get(key) !== null
}

interface PageDouble {
    facts: GcPageFacts
    events: string[]
}

interface PageOptions {
    mode?: string
    parked?: boolean
    supported?: boolean
    otherTab?: boolean
}

/** The live page's facts as a double. The busy registry is the real one, so a registration is visible to anything that asks `isBusy`. */
function pageOf(options: PageOptions = {}): PageDouble {
    const events: string[] = []
    const facts: GcPageFacts = {
        pageMode: () => options.mode ?? 'store2',
        isBusy: () => isBusy(),
        beginBusy: () => {
            events.push('busy-begin')
            return beginBusy('cleanup')
        },
        saveLoopParked: () => options.parked ?? false,
        locks: {
            supported: options.supported ?? true,
            ready: async () => { events.push('lock-ready') },
            acquire: async timeoutMs => {
                events.push(`lock-acquire:${timeoutMs}`)
                if (options.otherTab === true) {
                    return null
                }
                return async () => { events.push('lock-release') }
            },
        },
    }
    return { facts, events }
}

type Kind = GcMeasureDeps['session']['kind']

function sessionOf(kind: Kind, backend: Store2Backend | null, idle: { reason: string | null } = { reason: null }): GcMeasureDeps['session'] {
    return {
        kind,
        backend,
        get idleReason() { return idle.reason },
    }
}

beforeEach(() => {
    flag.measure = true
    resetPageStorageModeForTests()
    resetMaintenanceForTests()
    resetBusyActionsForTest()
    setPageStorageMode({ kind: 'store2' })
    delete (globalThis as Record<string, unknown>)[NAME]
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetPageStorageModeForTests()
    resetMaintenanceForTests()
    resetBusyActionsForTest()
    delete (globalThis as Record<string, unknown>)[NAME]
})

async function indexedDbRig(page: PageDouble = pageOf()) {
    const backend = createMemoryBackend()
    await seedStore(backend, env)
    const watched = hooked(backend)
    const loaded = vi.fn(async () => page.facts)
    const target = {}
    const handle = installGcMeasure({
        session: sessionOf('indexeddb', watched.backend),
        store: async () => createMemoryByteStore(),
        deletionActive: () => false,
        loadPage: loaded,
    }, target)
    return { backend, watched, handle, target, loaded, page }
}

describe('the action refuses to start without confirm', () => {
    test.each([
        ['no argument', undefined],
        ['an empty object', {}],
        ['confirm false', { confirm: false }],
    ] as const)('%s: nothing is loaded, registered or deleted', async (_label, options) => {
        const rig = await indexedDbRig()
        const junk = await orphan(rig.backend)

        const report = await rig.handle.run(options)

        expect(report).toMatchObject({ status: 'refused', reason: 'confirm-required' })
        expect(rig.loaded).not.toHaveBeenCalled()
        expect(rig.watched.log).toEqual([])
        expect(rig.page.events).toEqual([])
        expect(await exists(rig.backend, junk)).toBe(true)
    })
})

describe('the action runs one real pass', () => {
    test('reproducer: with confirm it deletes the garbage, keeps the current tree and logs the report once', async () => {
        const rig = await indexedDbRig()
        const before = await rig.backend.listStore2()
        const junk = [await orphan(rig.backend), await orphan(rig.backend)]

        const report = await rig.handle.run({ confirm: true })

        expect(handleOn(rig.target)).toBe(rig.handle)
        expect(report).toEqual({ status: 'ran', result: { status: 'done', deleted: 2, batches: 1 } })
        expect(await rig.backend.listStore2()).toEqual(before)
        for (const key of junk) {
            expect(await exists(rig.backend, key)).toBe(false)
        }
        expect(console.log).toHaveBeenCalledTimes(1)
    })

    test('guard: the pointed snapshot unit survives the pass at the action level and an unnamed orphan beside it does not', async () => {
        const rig = await indexedDbRig()
        const stagingId = newStagingId(env)
        const unitKey = newStagedKey(stagingId, 'u', env)
        await rig.backend.putUnit(unitKey, encodeUnit(UNIT_TYPE.preset, { v: 1, snapshot: 'old-data-key-list' }))
        await peerWrite(rig.backend, env, { snapshot: { key: unitKey, digest: '0123456789abcdef0123456789abcdef', count: 4 } })
        const junk = await orphan(rig.backend)

        const report = await rig.handle.run({ confirm: true })

        expect(report).toMatchObject({ status: 'ran', result: { status: 'done', deleted: 1 } })
        expect(await exists(rig.backend, unitKey)).toBe(true)
        expect(await exists(rig.backend, junk)).toBe(false)
    })

    test('the idle reason is read live at the pass, so an unflushed session refuses and deletes nothing', async () => {
        const backend = createMemoryBackend()
        await seedStore(backend, env)
        const junk = await orphan(backend)
        // The reason turns on only after the run began and the mark was read, so only a read at the gate sees it.
        const idle = { reason: null as string | null }
        const watched = hooked(backend, { after: call => {
            if (call === 'readFence') {
                idle.reason = 'not flushed'
            }
        } })
        const handle = installGcMeasure({
            session: sessionOf('indexeddb', watched.backend, idle),
            store: async () => createMemoryByteStore(),
            deletionActive: () => false,
            loadPage: async () => pageOf().facts,
        }, {})

        const report = await handle.run({ confirm: true })

        expect(report).toMatchObject({ status: 'ran', result: { status: 'refused', reason: 'idle' } })
        expect(await exists(backend, junk)).toBe(true)
    })
})

describe('each refusal deletes nothing and leaves nothing registered', () => {
    async function expectRefusal(report: GcMeasureReport, reason: string, rig: Awaited<ReturnType<typeof indexedDbRig>>, junk: string): Promise<void> {
        expect(report).toMatchObject({ status: 'refused', reason })
        expect(rig.watched.log.filter(call => call === 'removeBatch')).toEqual([])
        expect(await exists(rig.backend, junk)).toBe(true)
        expect(isBusy()).toBe(false)
    }

    test('the page is not a store2 page', async () => {
        const rig = await indexedDbRig(pageOf({ mode: 'legacy' }))
        const junk = await orphan(rig.backend)
        await expectRefusal(await rig.handle.run({ confirm: true }), 'not-store2', rig, junk)
    })

    test('the session has no backend', async () => {
        const handle = installGcMeasure({
            session: sessionOf('indexeddb', null),
            store: async () => createMemoryByteStore(),
            deletionActive: () => false,
            loadPage: async () => pageOf().facts,
        }, {})
        expect(await handle.run({ confirm: true })).toMatchObject({ status: 'refused', reason: 'read-only' })
    })

    test('a data action is registered (an export in progress)', async () => {
        const rig = await indexedDbRig()
        const junk = await orphan(rig.backend)
        const exporting = beginBusy('export')

        const report = await rig.handle.run({ confirm: true })

        expect(report).toMatchObject({ status: 'refused', reason: 'busy' })
        expect(rig.page.events).toEqual([])
        expect(await exists(rig.backend, junk)).toBe(true)
        expect(rig.watched.log.filter(call => call === 'removeBatch')).toEqual([])
        exporting.end()
    })

    test('the save loop is parked', async () => {
        const rig = await indexedDbRig(pageOf({ parked: true }))
        const junk = await orphan(rig.backend)
        await expectRefusal(await rig.handle.run({ confirm: true }), 'save-loop-parked', rig, junk)
    })

    // New behaviour: a tab stopped on a too-large body holds unsaved edits in memory only, like a parked one.
    test('new behaviour: the save loop has stopped on a body the server refuses as too large', async () => {
        const rig = await indexedDbRig()
        const junk = await orphan(rig.backend)
        const handle = installGcMeasure({
            session: sessionOf('indexeddb', rig.watched.backend),
            store: async () => createMemoryByteStore(),
            deletionActive: () => false,
            loadPage: async () => rig.page.facts,
            saveLoopStopped: () => true,
        }, {})
        await expectRefusal(await handle.run({ confirm: true }), 'save-loop-stopped', rig, junk)
    })

    test('the old-data deletion step is active', async () => {
        const rig = await indexedDbRig()
        const junk = await orphan(rig.backend)
        const handle = installGcMeasure({
            session: sessionOf('indexeddb', rig.watched.backend),
            store: async () => createMemoryByteStore(),
            deletionActive: () => true,
            loadPage: async () => rig.page.facts,
        }, {})
        await expectRefusal(await handle.run({ confirm: true }), 'old-data-deletion', rig, junk)
    })

    test('a browser page without Web Locks cannot rule out another tab', async () => {
        const rig = await indexedDbRig(pageOf({ supported: false }))
        const junk = await orphan(rig.backend)
        const report = await rig.handle.run({ confirm: true })
        await expectRefusal(report, 'no-web-locks', rig, junk)
        expect(rig.page.events).toEqual([])
    })

    test('another tab holds the presence lock: the busy entry ends and the pass never starts', async () => {
        const rig = await indexedDbRig(pageOf({ otherTab: true }))
        const junk = await orphan(rig.backend)
        const report = await rig.handle.run({ confirm: true })
        await expectRefusal(report, 'other-tab', rig, junk)
        expect(rig.page.events).toEqual(['busy-begin', 'lock-ready', `lock-acquire:${OTHER_TAB_WAIT_MS}`])
    })

    test('guard: a Tauri page takes no Web Lock and runs without Web Locks', async () => {
        const backend = createMemoryBackend()
        await seedStore(backend, env)
        const junk = await orphan(backend)
        const page = pageOf({ supported: false })
        const handle = installGcMeasure({
            session: sessionOf('tauri', backend),
            store: async () => createMemoryByteStore(),
            deletionActive: () => false,
            loadPage: async () => page.facts,
        }, {})

        const report = await handle.run({ confirm: true })

        expect(report).toMatchObject({ status: 'ran', result: { status: 'done', deleted: 1 } })
        expect(page.events).toEqual(['busy-begin'])
        expect(await exists(backend, junk)).toBe(false)
    })
})

describe('Web Locks availability', () => {
    test.each([
        ['supported and present', true, {}, true],
        ['the page reports none', false, {}, false],
        ['undefined', undefined, undefined, false],
        ['null', true, null, false],
    ] as const)('%s', (_label, pageSupported, locks, expected) => {
        expect(webLocksAvailable(pageSupported, locks)).toBe(expected)
    })
})

describe('the run is registered as a data action and holds the lock for its length', () => {
    test('reproducer: while the pass is in its removal, an export is refused and a second run is refused; both clear after', async () => {
        const backend = createMemoryBackend()
        await seedStore(backend, env)
        await orphan(backend)
        let entered!: () => void
        const inRemoval = new Promise<void>(resolve => { entered = resolve })
        let open!: () => void
        const gate = new Promise<void>(resolve => { open = resolve })
        const watched = hooked(backend, { before: async call => {
            if (call === 'removeBatch') {
                entered()
                await gate
            }
        } })
        const page = pageOf()
        const handle = installGcMeasure({
            session: sessionOf('indexeddb', watched.backend),
            store: async () => createMemoryByteStore(),
            deletionActive: () => false,
            loadPage: async () => page.facts,
        }, {})

        const first = handle.run({ confirm: true })
        await inRemoval

        // What an export asks before it starts.
        expect(isBusy()).toBe(true)
        expect(busyKinds()).toEqual(['cleanup'])
        expect(await handle.run({ confirm: true })).toMatchObject({ status: 'refused', reason: 'busy' })
        expect(page.events).not.toContain('lock-release')

        open()
        expect(await first).toMatchObject({ status: 'ran', result: { status: 'done', deleted: 1 } })
        expect(isBusy()).toBe(false)
        expect(page.events).toEqual(['busy-begin', 'lock-ready', `lock-acquire:${OTHER_TAB_WAIT_MS}`, 'lock-release'])
    })

    test('the registration and the lock are given back when the pass throws', async () => {
        const backend = createMemoryBackend()
        await seedStore(backend, env)
        const watched = hooked(backend, { before: call => {
            if (call === 'readCommit') {
                throw new RangeError('Injected.')
            }
        } })
        const page = pageOf()
        const handle = installGcMeasure({
            session: sessionOf('indexeddb', watched.backend),
            store: async () => createMemoryByteStore(),
            deletionActive: () => false,
            loadPage: async () => page.facts,
        }, {})

        await expect(handle.run({ confirm: true })).rejects.toThrow('Injected.')

        expect(isBusy()).toBe(false)
        expect(page.events.at(-1)).toBe('lock-release')
    })
})

describe('pacing', () => {
    test('the Node floor between removal batches is pinned at 100 ms, and other kinds only yield', () => {
        expect(NODE_BATCH_PACE_MS).toBe(100)
        expect(batchPaceOf('indexeddb')).toBe(yieldToEventLoop)
        expect(batchPaceOf('tauri')).toBe(yieldToEventLoop)
        expect(batchPaceOf('node')).not.toBe(yieldToEventLoop)
    })

    test('reproducer: on a Node page the action waits the floor between removal batches and not before the first (fake timers)', async () => {
        vi.useFakeTimers()
        const semantic = createNodeSemanticStore()
        const backend = createNodeBackend(semantic.store)
        await seedStore(backend, env)
        for (let i = 0; i < 60; i++) {
            await orphan(backend)
        }
        const watched = hooked(backend)
        const handle = installGcMeasure({
            session: sessionOf('node', watched.backend),
            store: async () => semantic.store,
            deletionActive: () => false,
            loadPage: async () => pageOf().facts,
        }, {})
        const removals = () => watched.log.filter(call => call === 'removeBatch').length

        const running = handle.run({ confirm: true })
        await vi.advanceTimersByTimeAsync(0)
        expect(removals()).toBe(1)

        await vi.advanceTimersByTimeAsync(NODE_BATCH_PACE_MS - 1)
        expect(removals()).toBe(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(removals()).toBe(2)

        await vi.advanceTimersByTimeAsync(NODE_BATCH_PACE_MS - 1)
        expect(removals()).toBe(2)
        await vi.advanceTimersByTimeAsync(1)
        expect(await running).toEqual({ status: 'ran', result: { status: 'done', deleted: 60, batches: 3 } })
    })

    test('guard: the injected sleep stands in for the timer and receives the floor', async () => {
        const semantic = createNodeSemanticStore()
        const backend = createNodeBackend(semantic.store)
        await seedStore(backend, env)
        for (let i = 0; i < 30; i++) {
            await orphan(backend)
        }
        const slept: number[] = []
        const handle = installGcMeasure({
            session: sessionOf('node', backend),
            store: async () => semantic.store,
            deletionActive: () => false,
            loadPage: async () => pageOf().facts,
            sleep: async ms => { slept.push(ms) },
        }, {})

        expect(await handle.run({ confirm: true })).toMatchObject({ status: 'ran', result: { status: 'done', deleted: 30, batches: 2 } })
        expect(slept).toEqual([NODE_BATCH_PACE_MS])
    })
})

describe('the install point is compiled out when MEASURE is false', () => {
    const noStore: MaintenanceEnv = { store: async () => createMemoryByteStore(), listBackupTimes: async () => [] }
    const neverTrigger = () => ({ arm: () => {}, stop: () => {} })

    async function openReadySession() {
        const backend = createMemoryBackend()
        await seedStore(backend, env)
        const store = createMemoryByteStore()
        return await Store2Session.open(store, { kind: 'indexeddb', backend, upstreamMainFile: async () => false })
    }

    test('reproducer: with MEASURE true a store2 page gets the action', async () => {
        const session = await openReadySession()

        startStore2Maintenance(noStore, { session: () => session, startTrigger: neverTrigger })

        expect(handleOn(globalThis)).toBeDefined()
    })

    test('reproducer: with MEASURE false the runner installs no action on the same page', async () => {
        flag.measure = false
        const session = await openReadySession()

        startStore2Maintenance(noStore, { session: () => session, startTrigger: neverTrigger })

        expect(handleOn(globalThis)).toBeUndefined()
    })

    test('guard: a page that is not a store2 page gets no action either way', async () => {
        resetPageStorageModeForTests()
        setPageStorageMode({ kind: 'legacy', convertedFrom: null })
        const session = await openReadySession()

        startStore2Maintenance(noStore, { session: () => session, startTrigger: neverTrigger })

        expect(handleOn(globalThis)).toBeUndefined()
    })
})

describe('the build output check names the global', () => {
    const script = fileURLToPath(new URL('../../../../../util/checkReleaseDist.mjs', import.meta.url))

    async function runCheck(source: string): Promise<{ status: number | null, stderr: string }> {
        const dir = await mkdtemp(join(tmpdir(), 'risu-dist-check-'))
        try {
            await writeFile(join(dir, 'index.js'), source)
            const run = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })
            return { status: run.status, stderr: run.stderr }
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    }

    test('reproducer: an output that carries the installed global name fails the check', async () => {
        const target = {}
        installGcMeasure({ session: sessionOf('indexeddb', null), store: async () => createMemoryByteStore(), deletionActive: () => false }, target)
        const installed = Object.keys(target)
        expect(installed).toHaveLength(1)

        const found = await runCheck(`globalThis.${installed[0]} = {}`)

        expect(found.status).toBe(1)
        expect(found.stderr).toContain('1 forbidden marker hit(s)')
    })

    test('guard: an output without any marker passes the check', async () => {
        expect((await runCheck('console.log("clean")')).status).toBe(0)
    })
})
