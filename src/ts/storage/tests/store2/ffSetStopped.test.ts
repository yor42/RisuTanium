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

import { chaIdOf, chars, until } from './lineFixtures'
import { bootB, ffSetup, ffTeardown, ffWorld, personalityOf, runLoopWorld, signal, sleepMs, takenBy } from './ffFixtures'

/**
 * What the waiting line does to this page's own saving, over the real save loop. The line is its own channel and never a
 * saving-stopped reason, so no saving indicator, alert or hold reacts to it. A peer commit that waits for the send is a
 * peer commit this page has not taken, so every pass defers again and none of this page's reaches the store; the page's
 * own value is committed once the send ends, together with the peer's change, and the status is cleared by that same pass.
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
    vi.useRealTimers()
})

describe('own edits while the send status stands', () => {
    test('S1 an edit made during the status is held, not lost: it commits with the peer\'s change when the send ends, and the status is cleared', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        hostHandle.host.state.sending = true
        await page.commitEdit((db) => {
            Reflect.set(db, 'personas', [{ name: 'A', note: '' }, { name: 'B', note: '' }])
            Reflect.set(db, 'selectedPersona', 1)
        })
        signal(world)
        await sleepMs(200)
        vi.setSystemTime(Date.now() + 31_000)
        await until(() => world.peerWaiting, 'the waiting line', 5000)
        const savedAtStatus = world.state.saved
        chars(b.db)[0].personality = 'typed during the send'
        world.mark(chaIdOf(b.db, 0))
        await sleepMs(600)
        // Every pass defers again while the send runs: nothing of this page's reaches the store.
        expect(world.state.saved).toBe(savedAtStatus)
        expect(world.state.dirty).toBe(true)
        expect(personalityOf(b.db, 0)).toBe('typed during the send')
        expect(world.peerWaiting).toBe(true)
        expect(world.state.stopped).toBe('')
        hostHandle.host.state.sending = false
        await until(() => world.state.saved > savedAtStatus, 'the own commit after the send', 6000)
        expect(world.peerWaiting).toBe(false)
        expect(world.stoppedLog.filter((reason) => reason !== '')).toEqual([])
        await takenBy(b, memory)
        const read = await page.freeze()
        expect(personalityOf(read.db, 0)).toBe('typed during the send')
        expect(Reflect.get(read.db, 'selectedPersona')).toBe(1)
        expect(Reflect.get(b.db, 'selectedPersona')).toBe(1)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(world.crashed).toEqual([])
    })
})

describe('the waiting line ends with every exit of the deferral', () => {
    test('S2 a deferral that ends in a park clears the line, and the page asks nothing about it', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { memory, page, firstManifest } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        hostHandle.host.state.sending = true
        await page.commitEdit((db) => {
            Reflect.set(db, 'personas', [{ name: 'A', note: '' }, { name: 'B', note: '' }])
            Reflect.set(db, 'selectedPersona', 1)
        })
        signal(world)
        await sleepMs(200)
        vi.setSystemTime(Date.now() + 31_000)
        await until(() => world.peerWaiting, 'the waiting line', 5000)
        // A peer restore replaces the tree while the deferral stands: the next judgement parks instead of fast-forwarding.
        await page.restore(firstManifest)
        hostHandle.host.state.sending = false
        signal(world)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 6000)
        expect(b.peer.clean[0]).toMatchObject({ reason: 'tree-replaced' })
        expect(world.peerWaiting).toBe(false)
        expect(world.stoppedLog.filter((reason) => reason !== '')).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('S3 a deferral that ended in a park before the status mark never turns the line on, even with the send still running', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { memory, page, firstManifest } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        hostHandle.host.state.sending = true
        await page.commitEdit((db) => {
            Reflect.set(db, 'personas', [{ name: 'A', note: '' }, { name: 'B', note: '' }])
            Reflect.set(db, 'selectedPersona', 1)
        })
        signal(world)
        await sleepMs(200)
        await page.restore(firstManifest)
        signal(world)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 6000)
        vi.setSystemTime(Date.now() + 31_000)
        await sleepMs(2500)
        expect(world.peerWaiting).toBe(false)
        expect(world.peerWaitingLog).not.toContain(true)
        expect(world.crashed).toEqual([])
    })

    test('S4 a deferral parked as descends:false before the status mark never turns the line on', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        hostHandle.host.state.sending = true
        const stale = await page.freeze()
        await page.commitEdit((db) => {
            Reflect.set(db, 'personas', [{ name: 'A', note: '' }, { name: 'B', note: '' }])
            Reflect.set(db, 'selectedPersona', 1)
        })
        signal(world)
        await sleepMs(200)
        await page.saveMine(stale, (db) => { Reflect.set(db, 'selectedPersona', 0) })
        signal(world)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 6000)
        vi.setSystemTime(Date.now() + 31_000)
        await sleepMs(2500)
        expect(world.peerWaiting).toBe(false)
        expect(world.peerWaitingLog).not.toContain(true)
        expect(world.crashed).toEqual([])
    })
})
