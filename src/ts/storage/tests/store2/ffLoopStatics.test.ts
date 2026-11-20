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

import { Store2UnknownOutcomeError } from 'src/ts/storage/store2/backend/errors'
import { chaIdOf, chars, parsedKey, until } from './lineFixtures'
import { hooked } from './commitFixtures'
import {
    bootB, ffSetup, ffTeardown, ffWorld, runLoopWorld, runSpyOf, signal, takenBy, type PageB,
} from './ffFixtures'

/**
 * Statics counters over the real save loop and fast-forward: each side's increment since the base is counted once, equal
 * increments included.
 *
 * The D1 tests pin accepted limitation L2 (MC-2553): when this page's own commit landed but the loop never learned it
 * and a peer write then moved the commit key, the next fast-forward merges a tree that already holds this page's
 * increment against the earlier base, so the counter is over-counted by that increment. They document accepted
 * behaviour and flip only when the follow-up that flags a possibly-landed write lands; they must not be rewritten to hide
 * the over-count.
 */

beforeEach(() => {
    ffSetup()
})

afterEach(() => {
    ffTeardown()
    vi.useRealTimers()
})

const messagesOf = (db: PageB['db']): number => db.statics.messages

async function ownCommit(b: PageB, world: ReturnType<typeof runLoopWorld>, index: number): Promise<void> {
    const before = world.state.saved
    world.mark(chaIdOf(b.db, index))
    await until(() => world.state.saved > before, 'the own commit', 8000)
}

describe('equal increments over the real loop', () => {
    test('E1 an acknowledged own commit, a further unsaved increment and a peer increment over the own commit count once each', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        await page.commitEdit((db) => { db.statics.messages = 5 })
        signal(world)
        await takenBy(b, memory)
        expect(messagesOf(b.db)).toBe(5)
        b.db.statics.messages += 1
        await ownCommit(b, world, 0)
        expect(messagesOf((await page.freeze()).db)).toBe(6)
        b.db.statics.messages += 1
        await page.commitEdit((db) => { db.statics.messages += 1 })
        signal(world)
        await takenBy(b, memory)
        await until(async () => messagesOf((await page.freeze()).db) === 8 || world.crashed.length > 0, 'the merged value in the store', 8000)
        expect(messagesOf(b.db)).toBe(8)
        expect(messagesOf((await page.freeze()).db)).toBe(8)
        expect(b.peer.asked).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('E2 an unsaved increment and a peer increment over the same base add', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        const start = messagesOf(b.db)
        b.db.statics.messages += 1
        await page.commitEdit((db) => { db.statics.messages += 1 })
        signal(world)
        await takenBy(b, memory)
        await until(async () => messagesOf((await page.freeze()).db) === start + 2 || world.crashed.length > 0, 'the merged value in the store', 8000)
        expect(messagesOf(b.db)).toBe(start + 2)
        expect(messagesOf((await page.freeze()).db)).toBe(start + 2)
        expect(b.peer.asked).toEqual([])
        expect(world.crashed).toEqual([])
    })
})

describe('limitation L2: an own write that landed unnoticed is counted twice', () => {
    type Peer = 'edit' | 'pin'

    /**
     * B's first ordinary commit lands, a peer write goes on top of it before B's read-back, and B's response is lost. B then
     * fast-forwards over its pre-commit base, which holds none of its own increment. `later` is a further unsaved increment
     * B makes while the response is lost. Returns the statics B and the store end with.
     */
    async function scenario(peer: Peer, later: number): Promise<{ start: number, b: number, store: number, landedManifest: string | undefined, peerManifest: string | undefined }> {
        const { memory, page } = await ffWorld()
        let b: PageB | null = null
        let armed = false
        let fired = 0
        let landedManifest: string | undefined
        let peerManifest: string | undefined
        const wrapped = hooked(memory, {
            after: async (name) => {
                if (name !== 'commitOrdinary' || !armed) {
                    return
                }
                armed = false
                fired += 1
                landedManifest = (await parsedKey(memory)).current?.key
                if (landedManifest === undefined) {
                    throw new Error('The landed commit names no current manifest.')
                }
                if (peer === 'edit') {
                    await page.commitEdit((db) => { chars(db)[3].personality = 'peer' })
                } else {
                    await page.committer.pin(await page.committer.readCommit(), landedManifest, 'test')
                }
                peerManifest = (await parsedKey(memory)).current?.key
                if (b !== null && later > 0) {
                    b.db.statics.messages += later
                }
                throw new Store2UnknownOutcomeError('lost')
            },
        })
        b = await bootB(wrapped.backend)
        const run = runSpyOf(b)
        const world = runLoopWorld(b.context, b.db)
        const manifestBefore = b.context.encoder.manifestKey
        const start = messagesOf(b.db)
        b.db.statics.messages += 1
        armed = true
        const saved = world.state.saved
        world.mark(chaIdOf(b.db, 0))
        await until(() => world.state.saved > saved || world.crashed.length > 0, 'the pass that lands the own commit', 8000)
        // The injection fired once, on the ordinary path, and the loop then fast-forwarded over the pre-commit base.
        expect(fired).toBe(1)
        expect(run).toHaveBeenCalled()
        const frame = run.mock.calls[0][0]
        expect(frame.baseKey).toBe(manifestBefore)
        expect(frame.baseKey).not.toBe(landedManifest)
        expect(frame.key.current?.key).toBe(peerManifest)
        expect(world.crashed).toEqual([])
        return { start, b: messagesOf(b.db), store: messagesOf((await page.freeze()).db), landedManifest, peerManifest }
    }

    test('D1a an equal increment is counted twice: the true value is start + 1, the merge holds start + 2', async () => {
        const result = await scenario('edit', 0)
        expect(result.b).toBe(result.start + 2)
        expect(result.store).toBe(result.start + 2)
    })

    test('D1b an unequal increment is counted twice as well: the true value is start + 2, the merge holds start + 3', async () => {
        const result = await scenario('edit', 1)
        expect(result.b).toBe(result.start + 3)
        expect(result.store).toBe(result.start + 3)
    })

    test('D1c a peer key-only write over the own landed commit leads to the same over-count', async () => {
        const result = await scenario('pin', 0)
        // The peer's write changed the commit key but not its current manifest: the landed tree is still current.
        expect(result.peerManifest).toBe(result.landedManifest)
        expect(result.b).toBe(result.start + 2)
        expect(result.store).toBe(result.start + 2)
    })
})
