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
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { peerCommitWake, startNodePeerFeed, type FeedVisibility, type NodePeerFeed } from 'src/ts/storage/store2/nodePeerFeed'
import { runStore2SaveLoop, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { until } from '../saveLoopWorld'
import { bootThroughDispatch, countedBackend, createClock, seedTree, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'
import { bootB, ffSetup, ffTeardown, ffWorld, runLoopWorld, takenBy } from './ffFixtures'

/**
 * The Node change feed wakes a page's peer check and nothing else. F2a: a Node page booted through the real dispatch,
 * its idle net off and its clock frozen, reads the commit key exactly once more per feed event, through `checkPeer`,
 * takes no idle-net slot, writes nothing and parks nowhere. The unit cases pin the feed loop's own rules: the first
 * answer is a baseline, a revision or instance change is an event, errors back off, stop ends everything. New-path
 * guards; a pass says nothing about a real server or browser.
 */

function resetPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageStorageModeForTests()
    resetRetainedForTest()
}

const feeds: NodePeerFeed[] = []

beforeEach(() => {
    vi.clearAllMocks()
    resetPage()
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    for (const feed of feeds.splice(0)) {
        feed.stop()
    }
    resetPage()
    vi.restoreAllMocks()
})

const FROZEN_NOW = 1_800_000_000_000

/** A fetch whose answers the test hands out one at a time; an aborted request rejects as a real one does. */
function scriptedFetch() {
    const waiting: Array<{ url: string, headers: unknown, resolve: (response: Response) => void, reject: (error: unknown) => void }> = []
    const urls: string[] = []
    const fetchLike = (url: string, init?: RequestInit): Promise<Response> => new Promise<Response>((resolve, reject) => {
        urls.push(url)
        const entry = { url, headers: init?.headers, resolve, reject }
        waiting.push(entry)
        init?.signal?.addEventListener('abort', () => {
            const at = waiting.indexOf(entry)
            if (at >= 0) {
                waiting.splice(at, 1)
            }
            reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
    })
    return {
        fetchLike,
        urls,
        pending: () => waiting.length,
        answer(rev: number, instance = 'instance-a') {
            const entry = waiting.shift()
            if (entry === undefined) {
                throw new Error('No request is waiting.')
            }
            entry.resolve(new Response(JSON.stringify({ rev, instance }), { status: 200 }))
        },
        status(code: number) {
            const entry = waiting.shift()
            if (entry === undefined) {
                throw new Error('No request is waiting.')
            }
            entry.resolve(new Response('{}', { status: code }))
        },
        body(text: string) {
            const entry = waiting.shift()
            if (entry === undefined) {
                throw new Error('No request is waiting.')
            }
            entry.resolve(new Response(text, { status: 200 }))
        },
        headersOfNext: () => waiting[0]?.headers,
    }
}

/** A visibility source the test flips by hand; `subscribers()` counts the live subscriptions. */
function fakeVisibility(initiallyVisible: boolean) {
    const state = { visible: initiallyVisible }
    const listeners = new Set<() => void>()
    return {
        source: {
            isVisible: () => state.visible,
            subscribe(onChange: () => void) {
                listeners.add(onChange)
                return () => { listeners.delete(onChange) }
            },
        },
        set(visible: boolean) {
            state.visible = visible
            for (const listener of [...listeners]) {
                listener()
            }
        },
        subscribers: () => listeners.size,
    }
}

function startFeed(script: ReturnType<typeof scriptedFetch>, onPeerCommit: () => void, sleeps: number[] = [], visibility?: FeedVisibility): NodePeerFeed {
    const feed = startNodePeerFeed({
        visibility,
        authHeader: async () => 'a-token',
        onPeerCommit,
        fetch: script.fetchLike,
        baseUrl: 'http://node.test',
        // A recorded, instant sleep: the loop's pacing is asserted from the durations, not from timers.
        sleep: async (ms) => {
            sleeps.push(ms)
            await new Promise<void>((resolve) => setTimeout(resolve, 1))
        },
        now: () => FROZEN_NOW,
    })
    feeds.push(feed)
    return feed
}

describe('F2a a feed event wakes exactly one peer check', () => {
    test('one event is one extra commit-key read through checkPeer, no idle-net slot, no write, no park', async () => {
        const reads = { commit: 0 }
        const counted = countedBackend({ hooks: { before: (name) => { if (name === 'readCommit') { reads.commit += 1 } } } })
        await seedTree(counted.memory, JSON.parse(JSON.stringify(buildSmall(2))) as Database, testEnv(createClock(), 4242), fakeLists)
        // The kit boots the in-memory profile as a Node page over a Node-semantic byte store.
        const boot = await bootThroughDispatch(counted.backend)
        if (boot.result.kind !== 'store2') {
            throw new Error(`The boot came to ${boot.result.kind}.`)
        }
        const context = getActiveStore2Save()
        if (context === null) {
            throw new Error('No save context is active.')
        }
        // The idle net is off for this page: no slot can read the commit key on a timer.
        expect(context.idleNet ?? null).toBeNull()
        const database = boot.result.database

        const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        const flags = { peerHeard: false }
        const wakes = { idle: 0 }
        const progress = { sweeps: 0 }
        const stopLog: string[] = []
        let stopped = false
        let tail: Promise<void> = Promise.resolve()
        const idle = () => new Promise<void>((resolve) => {
            if (!stopped) {
                setTimeout(resolve, 2)
            }
        })
        const port: Store2LoopPort = {
            tracker,
            reloadFlag: { state: false },
            getDatabase: () => database,
            mergeBack: () => {},
            liveCheck: () => {},
            sweep() {
                progress.sweeps += 1
            },
            isDue: () => false,
            isDirty: () => false,
            hasDrafts: () => false,
            beginIteration: () => {},
            endIteration: () => {},
            snapshotTaken: () => {},
            requestPass: () => {},
            unsavable: () => {},
            saved: () => {},
            broadcast: () => {},
            peerHeard() {
                const heard = flags.peerHeard
                flags.peerHeard = false
                return heard
            },
            setStopped(reason) {
                stopLog.push(reason)
            },
            reportFailure: () => 1,
            reportUncountedFailure: () => 1,
            async withWriteLock(work) {
                const before = tail
                let release: () => void = () => {}
                tail = new Promise<void>((resolve) => { release = resolve })
                await before
                try {
                    return await work()
                } finally {
                    release()
                }
            },
            wait: idle,
            sleep: () => idle(),
            sleepForever: () => new Promise<never>(() => {}),
            now: () => FROZEN_NOW,
            async yieldNow() {
                await new Promise<void>((resolve) => setTimeout(resolve, 0))
            },
            pageHidden: () => false,
        }
        runStore2SaveLoop(context, port).catch((error: unknown) => {
            throw error
        })

        const script = scriptedFetch()
        // The glue the page installs: the flag the broadcast path sets, and the idle wake.
        startFeed(script, peerCommitWake(() => { flags.peerHeard = true }, () => { wakes.idle += 1 }))
        await until(() => script.pending() === 1, 'the feed to ask', 4000)
        script.answer(1)
        await until(() => script.pending() === 1, 'the feed to ask again after its baseline', 4000)

        // Quiet: the baseline answer is no event, and with the clock frozen nothing else reads the commit key.
        counted.reset()
        const readsBefore = reads.commit
        const sweepsBefore = progress.sweeps
        await until(() => progress.sweeps >= sweepsBefore + 5, 'five quiet iterations', 4000)
        expect(reads.commit).toBe(readsBefore)

        script.answer(2)
        await until(() => reads.commit === readsBefore + 1, 'the peer check to read the commit key', 4000)
        const sweepsAfterRead = progress.sweeps
        await until(() => progress.sweeps >= sweepsAfterRead + 8, 'eight more iterations', 4000)

        expect(reads.commit).toBe(readsBefore + 1)
        expect(wakes.idle).toBe(1)
        expect(stopLog).toEqual([])
        expect(counted.writeCalls()).toBe(0)
        expect(counted.reads).toEqual([])
        stopped = true
    }, 30_000)
})

describe('F2b a feed event over a descending peer commit is taken by the owed tick', () => {
    beforeEach(() => {
        ffSetup()
    })

    afterEach(() => {
        ffTeardown()
    })

    test('page B holds the peer\'s change after the event and does not park', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        expect(b.context.idleNet ?? null).toBeNull()
        const world = runLoopWorld(b.context, b.db)
        const script = scriptedFetch()
        // The glue the page installs: the flag the broadcast path sets, and the idle wake.
        startFeed(script, peerCommitWake(() => { world.state.peerHeard = true }, () => { }))
        await until(() => script.pending() === 1, 'the feed to ask', 4000)
        script.answer(1)
        await until(() => script.pending() === 1, 'the feed to ask again after its baseline', 4000)

        await page.commitEdit((db) => { db.temperature = 123 })
        script.answer(2)
        await takenBy(b, memory)

        expect(b.db.temperature).toBe(123)
        expect(world.stoppedLog.filter((reason) => reason !== '')).toEqual([])
        expect(b.peer.asked).toEqual([])
        expect(world.crashed).toEqual([])
    }, 30_000)
})

describe('the feed loop', () => {
    test('the first answer is a baseline; a higher revision is one event; an unchanged answer is none', async () => {
        const script = scriptedFetch()
        const events = { count: 0 }
        const sleeps: number[] = []
        startFeed(script, () => { events.count += 1 }, sleeps)
        await until(() => script.pending() === 1, 'the first request', 2000)
        expect(script.urls[0]).toBe('http://node.test/api/store2-feed')
        expect(script.headersOfNext()).toMatchObject({ 'risu-auth': 'a-token' })
        script.answer(7)
        await until(() => script.pending() === 1, 'the second request', 2000)
        expect(script.urls[1]).toBe('http://node.test/api/store2-feed?since=7')
        expect(events.count).toBe(0)

        script.answer(7)
        await until(() => script.pending() === 1 && script.urls.length === 3, 'the third request', 2000)
        expect(events.count).toBe(0)
        // An unchanged answer that came at once is paced, never a hot loop.
        expect(sleeps).toEqual([1000])

        script.answer(8)
        await until(() => script.urls.length === 4, 'the fourth request', 2000)
        expect(events.count).toBe(1)
        expect(script.urls[3]).toBe('http://node.test/api/store2-feed?since=8')
    })

    test('a changed server instance is an event even at a lower revision, and restarts the baseline', async () => {
        const script = scriptedFetch()
        const events = { count: 0 }
        startFeed(script, () => { events.count += 1 })
        await until(() => script.pending() === 1, 'the first request', 2000)
        script.answer(5, 'instance-a')
        await until(() => script.urls.length === 2, 'the second request', 2000)
        script.answer(0, 'instance-b')
        await until(() => script.urls.length === 3, 'the third request', 2000)
        expect(events.count).toBe(1)
        expect(script.urls[2]).toBe('http://node.test/api/store2-feed?since=0')
    })

    test('errors back off with growing waits, never a hot loop, and a good answer resets them', async () => {
        const script = scriptedFetch()
        const sleeps: number[] = []
        const feed = startFeed(script, () => {}, sleeps)
        const codes = [401, 429, 503, 400]
        for (const [index, code] of codes.entries()) {
            await until(() => script.pending() === 1, 'a request', 2000)
            script.status(code)
            await until(() => sleeps.length === index + 1 && script.pending() === 1, 'the retry', 2000)
        }
        expect(sleeps.slice(0, 4)).toEqual([1000, 2000, 4000, 8000])
        expect(feed.isPeerFeedLive()).toBe(false)
        script.answer(1)
        await until(() => script.urls.length === 6, 'the request after the good answer', 2000)
        expect(feed.isPeerFeedLive()).toBe(true)
        script.status(500)
        await until(() => sleeps.length === 5, 'the next back-off', 2000)
        expect(sleeps[4]).toBe(1000)
    })

    test('a malformed answer is an error, not an event', async () => {
        const script = scriptedFetch()
        const events = { count: 0 }
        const sleeps: number[] = []
        const feed = startFeed(script, () => { events.count += 1 }, sleeps)
        await until(() => script.pending() === 1, 'a request', 2000)
        script.body('{"rev":"x"}')
        await until(() => sleeps.length === 1, 'the back-off', 2000)
        expect(events.count).toBe(0)
        expect(feed.isPeerFeedLive()).toBe(false)
    })

    test('the feed is live after an answer and stops asking, aborting its request, once stopped', async () => {
        const script = scriptedFetch()
        const feed = startFeed(script, () => {})
        expect(feed.isPeerFeedLive()).toBe(false)
        await until(() => script.pending() === 1, 'a request', 2000)
        script.answer(1)
        await until(() => script.pending() === 1, 'the next request', 2000)
        expect(feed.isPeerFeedLive()).toBe(true)
        feed.stop()
        expect(feed.isPeerFeedLive()).toBe(false)
        await until(() => script.pending() === 0, 'the request to be aborted', 2000)
        await new Promise<void>((resolve) => setTimeout(resolve, 30))
        expect(script.urls.length).toBe(2)
    })

    test('U2 a page that starts hidden sends nothing; the first show sends one baseline request and no event', async () => {
        const script = scriptedFetch()
        const visibility = fakeVisibility(false)
        const events = { count: 0 }
        startFeed(script, () => { events.count += 1 }, [], visibility.source)
        await new Promise<void>((resolve) => setTimeout(resolve, 30))
        expect(script.urls).toEqual([])
        visibility.set(true)
        await until(() => script.pending() === 1, 'the first request after the show', 2000)
        expect(script.urls).toEqual(['http://node.test/api/store2-feed'])
        script.answer(4)
        await until(() => script.urls.length === 2, 'the held request', 2000)
        expect(events.count).toBe(0)
        expect(script.urls[1]).toBe('http://node.test/api/store2-feed?since=4')
    })

    test('U3 a hide ends the held request without a failure; the show probes, and the probe answer decides the event', async () => {
        const cases = [
            { rev: 6, instance: 'instance-a', events: 1, nextUrl: 'http://node.test/api/store2-feed?since=6' },
            { rev: 5, instance: 'instance-a', events: 0, nextUrl: 'http://node.test/api/store2-feed?since=5' },
            { rev: 0, instance: 'instance-b', events: 1, nextUrl: 'http://node.test/api/store2-feed?since=0' },
        ]
        for (const expected of cases) {
            const script = scriptedFetch()
            const visibility = fakeVisibility(true)
            const events = { count: 0 }
            const sleeps: number[] = []
            const feed = startFeed(script, () => { events.count += 1 }, sleeps, visibility.source)
            await until(() => script.pending() === 1, 'the first request', 2000)
            script.answer(5)
            await until(() => script.urls.length === 2 && script.pending() === 1, 'the held request', 2000)
            expect(feed.isPeerFeedLive()).toBe(true)

            visibility.set(false)
            expect(script.pending()).toBe(0)
            expect(feed.isPeerFeedLive()).toBe(false)
            await new Promise<void>((resolve) => setTimeout(resolve, 30))
            expect(sleeps).toEqual([])
            expect(script.urls.length).toBe(2)

            visibility.set(true)
            await until(() => script.urls.length === 3 && script.pending() === 1, 'the probe', 2000)
            expect(script.urls[2]).toBe('http://node.test/api/store2-feed')
            script.answer(expected.rev, expected.instance)
            await until(() => script.urls.length === 4, 'the request after the probe', 2000)
            expect(events.count).toBe(expected.events)
            expect(script.urls[3]).toBe(expected.nextUrl)
            // A probe is not paced.
            expect(sleeps).toEqual([])
            feed.stop()
        }
    })

    test('U4 a hide during a back-off sleep sends no request after the sleep until the page is shown', async () => {
        const script = scriptedFetch()
        const visibility = fakeVisibility(true)
        const release: Array<() => void> = []
        const feed = startNodePeerFeed({
            authHeader: async () => 'a-token',
            onPeerCommit: () => {},
            fetch: script.fetchLike,
            baseUrl: 'http://node.test',
            sleep: () => new Promise<void>((resolve) => { release.push(resolve) }),
            now: () => FROZEN_NOW,
            visibility: visibility.source,
        })
        feeds.push(feed)
        await until(() => script.pending() === 1, 'the first request', 2000)
        script.status(500)
        await until(() => release.length === 1, 'the back-off sleep', 2000)
        visibility.set(false)
        release[0]()
        await new Promise<void>((resolve) => setTimeout(resolve, 30))
        expect(script.urls.length).toBe(1)
        visibility.set(true)
        await until(() => script.urls.length === 2, 'the request after the show', 2000)
    })

    test('U5 stop leaves no visibility subscription', async () => {
        const script = scriptedFetch()
        const visibility = fakeVisibility(true)
        const feed = startFeed(script, () => {}, [], visibility.source)
        expect(visibility.subscribers()).toBe(1)
        feed.stop()
        expect(visibility.subscribers()).toBe(0)
    })

    test('peerCommitWake sets the heard flag and wakes the idle wait, once per call', () => {
        const calls: string[] = []
        const wake = peerCommitWake(() => { calls.push('heard') }, () => { calls.push('wake') })
        wake()
        expect(calls).toEqual(['heard', 'wake'])
    })
})
