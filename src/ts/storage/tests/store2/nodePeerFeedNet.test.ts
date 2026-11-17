// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { FEED_BACKSTOP_MS, IDLE_NET_INTERVAL_MS, runStore2SaveLoop, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import { hooked } from './commitFixtures'
import { bootB, ffSetup, ffTeardown, ffWorld, sleepMs, stopAllWorlds, type PageB } from './ffFixtures'

/**
 * While the Node change feed is live, an idle-net slot reads the commit key at most once per backstop; with the feed
 * down, or no feed seam at all, every slot reads. A skipped read leaves every later check of the slot as it was, so a
 * pending save attempt still takes the full tick. New-path guards over a line-seeded page, a fake clock and counted
 * backend reads; a pass says nothing about a real server.
 */

const START = 1_800_000_000_000
const STEP_MS = 500
const NET = { intervalMs: IDLE_NET_INTERVAL_MS, moduleIntervalMs: 1_000_000_000, backstopMs: 1_000_000_000, quiet: null }

beforeEach(() => {
    ffSetup()
})

afterEach(() => {
    ffTeardown()
})

interface Rig {
    b: PageB
    reads: () => number
    clock: { now: number }
    feed: { live: boolean }
    stop: () => void
    /** Moves the fake clock forward by `ms` in steps, letting the loop run between steps. */
    advance: (ms: number) => Promise<void>
}

async function startRig(pendingKey: { value: string | null } | null = null, withSeam = true): Promise<Rig> {
    const { memory } = await ffWorld()
    const counted = hooked(memory)
    const b = await bootB(counted.backend)
    b.context.idleNet = NET
    if (pendingKey !== null) {
        b.context.encoder = Object.create(b.context.encoder, { pendingKey: { get: () => pendingKey.value } }) as PageB['context']['encoder']
    }
    const clock = { now: START }
    const feed = { live: true }
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const db: Database = b.db
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => db,
        mergeBack: () => { },
        liveCheck: () => { },
        sweep: () => { },
        isDue: () => false,
        isDirty: () => false,
        hasDrafts: () => false,
        beginIteration: () => { },
        endIteration: () => { },
        snapshotTaken: () => { },
        requestPass: () => { },
        unsavable: () => { },
        saved: () => { },
        broadcast: () => { },
        peerHeard: () => false,
        setStopped: () => { },
        reportFailure: () => 1,
        reportUncountedFailure: () => 1,
        async withWriteLock(run) {
            const before = tail
            let release: () => void = () => { }
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            try {
                return await run()
            } finally {
                release()
            }
        },
        wait: idle,
        sleep: idle,
        sleepForever: () => new Promise<never>(() => { }),
        now: () => clock.now,
        pageHidden: () => false,
    }
    if (withSeam) {
        port.peerFeedLive = () => feed.live
    }
    runStore2SaveLoop(b.context, port).catch((error: unknown) => {
        throw error
    })
    const rig: Rig = {
        b,
        reads: () => counted.count('readCommit'),
        clock,
        feed,
        stop: () => { stopped = true },
        async advance(ms) {
            for (let spent = 0; spent < ms; spent += STEP_MS) {
                clock.now += STEP_MS
                await sleepMs(12)
            }
        },
    }
    return rig
}

describe('F3 a live feed replaces the idle net\'s commit-key read with a backstop', () => {
    test('no read in 25 s of idle while live beyond the one backstop read; the backstop recurs; a feed that is down reads every slot', async () => {
        const rig = await startRig()
        const baseline = rig.reads()
        await rig.advance(25_000)
        expect(rig.reads() - baseline).toBeLessThanOrEqual(1)

        await rig.advance(40_000)
        const afterLive = rig.reads() - baseline
        // 65 s live: the backstop fired again after the first window, and never every slot (about 32 slots).
        expect(afterLive).toBeGreaterThanOrEqual(2)
        expect(afterLive).toBeLessThanOrEqual(1 + Math.ceil(65_000 / FEED_BACKSTOP_MS))

        rig.feed.live = false
        const beforeDown = rig.reads()
        await rig.advance(10_000)
        // Five slots of 2 s each read once the feed is down.
        expect(rig.reads() - beforeDown).toBeGreaterThanOrEqual(4)
        rig.stop()
    }, 30_000)

    test('a page whose loop port has no feed seam reads every slot', async () => {
        const rig = await startRig(null, false)
        const baseline = rig.reads()
        await rig.advance(10_000)
        expect(rig.reads() - baseline).toBeGreaterThanOrEqual(4)
        rig.stop()
    }, 30_000)
})

describe('F3b a skipped read still resolves a pending save attempt', () => {
    test('a slot that skips the read with a pending key takes the full tick', async () => {
        const pending: { value: string | null } = { value: null }
        const rig = await startRig(pending)
        // One real read first, so the next slots are inside the backstop window.
        await rig.advance(5_000)
        const readsBefore = rig.reads()
        await rig.advance(4_000)
        // Control: inside the backstop window with nothing pending, the slots read nothing.
        expect(rig.reads()).toBe(readsBefore)
        pending.value = 'a manifest of unknown outcome'
        await rig.advance(5_000)
        // The pending attempt is resolved by a full tick, which reads the commit key under the write lock.
        expect(rig.reads()).toBeGreaterThan(readsBefore)
        pending.value = null
        rig.stop()
        stopAllWorlds()
    }, 30_000)
})
