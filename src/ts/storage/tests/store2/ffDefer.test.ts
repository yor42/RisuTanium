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

import { isColdStub } from 'src/ts/storage/store2/codec'
import { createFastForward, type FastForwardFrame, type FastForwardPort } from 'src/ts/storage/store2/fastForward'
import { defaultKeyEnv } from 'src/ts/storage/store2/format'
import { fakeLists } from './codecFixtures'
import { chaIdOf, chars, parsedKey, until } from './lineFixtures'
import { bootB, ffSetup, ffTeardown, ffWorld, personalityOf, runLoopWorld, signal, sleepMs, takenBy, type PageB } from './ffFixtures'

/**
 * The fast-forward's two deferrals over the real save loop, with the loop's reports recorded: a record that changes a
 * running send's view waits for the send, with no park, no failure and no change to the page (D1); a swap waits for a
 * busy action and parks only when that action is stuck (D2). The page's clock is `Date`, moved by the test; the re-checks
 * run on real timers, so a test that moves the clock then waits for one re-check.
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
    vi.useRealTimers()
})

const personaSwitch = (db: object): void => {
    Reflect.set(db, 'personas', [{ name: 'A', note: '' }, { name: 'B', note: '' }])
    Reflect.set(db, 'selectedPersona', 1)
}

async function sendingWorld() {
    const { memory, page } = await ffWorld()
    const b: PageB = await bootB(memory)
    const owners = new Set<string>()
    const world = runLoopWorld(b.context, b.db, { replyOwners: () => owners })
    hostHandle.host.state.sending = true
    await page.commitEdit(personaSwitch)
    signal(world)
    return { memory, page, b, world, owners }
}

describe('D1 a send that changes what the page shows', () => {
    test('R9 the page defers: no park, no failure report, no field change, and it applies after the send ends', async () => {
        const { memory, b, world } = await sendingWorld()
        await sleepMs(400)
        expect(Reflect.get(b.db, 'selectedPersona')).not.toBe(1)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(world.failures).toEqual([])
        hostHandle.host.state.sending = false
        await takenBy(b, memory)
        expect(Reflect.get(b.db, 'selectedPersona')).toBe(1)
        expect(world.failures).toEqual([])
        expect(b.peer.clean).toEqual([])
    })

    test('R9b a send with no end for two minutes of page time is still deferred and unparked, then the page follows and commits', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { memory, b, world } = await sendingWorld()
        await sleepMs(200)
        vi.setSystemTime(Date.now() + 120_000)
        await sleepMs(1300)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(Reflect.get(b.db, 'selectedPersona')).not.toBe(1)
        hostHandle.host.state.sending = false
        await takenBy(b, memory)
        expect(Reflect.get(b.db, 'selectedPersona')).toBe(1)
        chars(b.db)[0].personality = 'my edit after the send'
        world.mark(chaIdOf(b.db, 0))
        const before = world.state.saved
        await until(() => world.state.saved > before, 'the own commit after the send', 4000)
        expect(b.peer.clean).toEqual([])
    })

    test('R9c a send past thirty seconds shows the waiting line without stopping saving, nothing is applied or committed, and the end of the send clears it', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { memory, b, world } = await sendingWorld()
        await sleepMs(200)
        vi.setSystemTime(Date.now() + 31_000)
        await until(() => world.peerWaiting, 'the waiting line', 5000)
        expect(world.stoppedLog.filter((reason) => reason !== '')).toEqual([])
        expect(Reflect.get(b.db, 'selectedPersona')).not.toBe(1)
        expect(b.context.encoder.manifestKey).not.toBe((await parsedKey(memory)).current?.key)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        hostHandle.host.state.sending = false
        await takenBy(b, memory)
        expect(world.peerWaiting).toBe(false)
        expect(world.state.stopped).toBe('')
        expect(Reflect.get(b.db, 'selectedPersona')).toBe(1)
    })

    test('R9d a send that ended while a reply owner stands is still a send; the owner\'s end releases the deferral within a re-check', async () => {
        const { memory, b, owners } = await sendingWorld()
        owners.add('a-reply-owner')
        hostHandle.host.state.sending = false
        await sleepMs(1500)
        expect(Reflect.get(b.db, 'selectedPersona')).not.toBe(1)
        expect(b.peer.asked).toEqual([])
        owners.clear()
        await takenBy(b, memory, 4000)
        expect(Reflect.get(b.db, 'selectedPersona')).toBe(1)
    })
})

describe('D1 then D2', () => {
    test('H1 the waiting line a long send set is off while the page waits only for a busy action', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        hostHandle.host.state.sending = true
        hostHandle.host.state.busy = true
        await page.commitEdit((db) => {
            personaSwitch(db)
            chars(db)[3].personality = 'peer edit'
        })
        signal(world)
        await sleepMs(200)
        vi.setSystemTime(Date.now() + 31_000)
        await until(() => world.peerWaiting, 'the waiting line', 5000)
        hostHandle.host.state.sending = false
        await until(() => !world.peerWaiting, 'the waiting line off during the busy wait', 5000)
        await sleepMs(1500)
        expect(world.peerWaiting).toBe(false)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
        hostHandle.host.state.busy = false
        await takenBy(b, memory)
        expect(world.peerWaiting).toBe(false)
    })
})

describe('D2 a swap that waits for a busy action', () => {
    test('D2a the swap waits for the busy action and happens after it, with no failure report', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        hostHandle.host.state.busy = true
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        signal(world)
        await sleepMs(400)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
        expect(world.failures).toEqual([])
        expect(b.peer.clean).toEqual([])
        hostHandle.host.state.busy = false
        await takenBy(b, memory)
        expect(isColdStub(chars(b.db)[3])).toBe(true)
    })

    test('D2b a busy action older than two hours at the next attempt parks with nothing applied, and a younger one is still deferred', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        hostHandle.host.state.busy = true
        const fastForward = createFastForward({ backend: memory, kind: 'indexeddb', lists: fakeLists, env: defaultKeyEnv })
        const frame = async (): Promise<FastForwardFrame> => {
            const port: FastForwardPort = { getDatabase: () => b.db, now: () => Date.now() }
            return { read: await memory.readCommit(), key: await parsedKey(memory), baseKey: b.context.encoder.manifestKey, encoder: b.context.encoder, port, snapshot: null }
        }
        expect((await fastForward.run(await frame())).kind).toBe('deferred')
        vi.setSystemTime(Date.now() + 119 * 60_000)
        expect((await fastForward.run(await frame())).kind).toBe('deferred')
        vi.setSystemTime(Date.now() + 2 * 60_000)
        expect(await fastForward.run(await frame())).toEqual({ kind: 'park', reason: 'busy-stuck' })
        expect(isColdStub(chars(b.db)[3])).toBe(false)
        expect(b.context.encoder.manifestKey).not.toBe((await parsedKey(memory)).current?.key)
    })
})
