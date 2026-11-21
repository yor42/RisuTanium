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

import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { isColdStub } from 'src/ts/storage/store2/codec'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { fakeLists } from './codecFixtures'
import {
    chaIdOf, chars, extrasOf, olderBuildCommit, parsedKey, plantBytes, runLoopOver, seedProfile, until, type LoopHandle,
} from './lineFixtures'
import { hooked } from './commitFixtures'
import { bootB, ffSetup, ffTeardown, ffWorld, personalityOf, signal, sleepMs, type PageB } from './ffFixtures'

/**
 * The fast-forward over the real save loop: page B is dispatch-booted as a node page, the peer is built from the
 * committer and encoder APIs, and every row reads what B holds and what the store holds. A taken peer commit parks
 * nothing, a commit whose descent is unproven parks with today's prompt and never calls the fast-forward.
 */

beforeEach(() => {
    ffSetup()
})

afterEach(() => {
    ffTeardown()
})

async function commitOwnEdit(loop: LoopHandle, b: PageB, index: number, text: string): Promise<void> {
    const before = loop.state.saved
    chars(b.db)[index].personality = text
    loop.mark(chaIdOf(b.db, index))
    await until(() => loop.state.saved > before, 'the own commit', 4000)
}

/** Waits until the page's acknowledged encoding names the manifest the store holds: the peer's tree was taken. */
async function caughtUp(b: PageB, memory: Parameters<typeof parsedKey>[0]): Promise<void> {
    await until(async () => b.context.encoder.manifestKey === await manifestOfStore(memory), 'the page to take the peer tree', 4000)
}

function spyOnRun(b: PageB) {
    const fastForward = b.context.fastForward
    if (fastForward === undefined) {
        throw new Error('The page has no fast-forward.')
    }
    return vi.spyOn(fastForward, 'run')
}

async function manifestOfStore(memory: Parameters<typeof parsedKey>[0]): Promise<string | undefined> {
    return (await parsedKey(memory)).current?.key
}

describe('a peer commit that provably descends is taken, never parked on', () => {
    test('R1 a disjoint peer edit appears in a clean page, which names the peer\'s tree and saves over it', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        signal(loop)
        await caughtUp(b, memory)
        expect(b.context.encoder.manifestKey).toBe(await manifestOfStore(memory))
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        await commitOwnEdit(loop, b, 0, 'my edit')
        const read = await page.freeze()
        expect(personalityOf(read.db, 0)).toBe('my edit')
        expect(personalityOf(read.db, 3)).toBe('peer edit')
        expect(loop.crashed).toEqual([])
    })

    test('R2 a dirty page takes a peer edit to another record and keeps its own unsaved edit', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        chars(b.db)[0].personality = 'my unsaved edit'
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        signal(loop)
        await caughtUp(b, memory)
        loop.mark(chaIdOf(b.db, 0))
        await until(() => loop.state.saved >= 1, 'the own commit', 4000)
        const read = await page.freeze()
        expect(personalityOf(read.db, 0)).toBe('my unsaved edit')
        expect(personalityOf(read.db, 3)).toBe('peer edit')
        expect(b.peer.asked).toEqual([])
    })

    test('R3 a peer edit to the record this page also edited parks with today\'s offers and keeps this page\'s edit', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        chars(b.db)[3].personality = 'my edit to the same record'
        loop.mark(chaIdOf(b.db, 3))
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        await until(() => b.peer.asked.length >= 1, 'the question', 4000)
        expect(b.peer.asked[0]).toMatchObject({ reason: 'peer-commit', unsaved: true })
        expect(b.peer.asked[0].offers).toEqual(['reload', 'export-first'])
        expect(personalityOf(b.db, 3)).toBe('my edit to the same record')
        expect(loop.crashed).toEqual([])
    })

    test('R4 a peer\'s config change is taken, and a config field both sides changed differently parks', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        await page.commitEdit((db) => { db.temperature = 123 })
        signal(loop)
        await until(() => b.db.temperature === 123, 'the peer temperature', 4000)
        expect(b.peer.asked).toEqual([])
        b.db.temperature = 7
        loop.mark(chaIdOf(b.db, 0))
        await page.commitEdit((db) => { db.temperature = 99 })
        await until(() => b.peer.asked.length >= 1, 'the question', 4000)
        expect(b.db.temperature).toBe(7)
        expect(b.peer.asked[0].offers).toEqual(['reload', 'export-first'])
    })
})

describe('a commit whose descent is unproven parks and never calls the fast-forward', () => {
    test('R24 a peer\'s web Save mine over this page\'s committed edit parks with the Node offers and no fast-forward', async () => {
        const { memory, page } = await ffWorld()
        const frozen = await page.freeze()
        const b = await bootB(memory)
        const run = spyOnRun(b)
        const loop = runLoopOver(b.context, b.db)
        await commitOwnEdit(loop, b, 3, 'my committed edit')
        await page.saveMine(frozen, (db) => { chars(db)[0].personality = 'peer save mine' })
        chars(b.db)[1].personality = 'my unsaved edit'
        loop.mark(chaIdOf(b.db, 1))
        await until(() => b.peer.asked.length >= 1, 'the question', 4000)
        expect(b.peer.asked[0].offers).toEqual(['reload', 'export-first'])
        expect(personalityOf(b.db, 3)).toBe('my committed edit')
        expect(run).not.toHaveBeenCalled()
    })

    test('R26 an older build\'s commit parks and no fast-forward is called, also after a new-build commit over it', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const run = spyOnRun(b)
        const loop = runLoopOver(b.context, b.db)
        await olderBuildCommit(memory, page, (db) => { db.temperature = 5 })
        signal(loop)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 4000)
        expect(b.peer.clean[0].offers).toEqual(['reload', 'export-first'])
        await page.commitEdit((db) => { chars(db)[2].personality = 'a later new-build edit' })
        signal(loop)
        await sleepMs(80)
        expect(run).not.toHaveBeenCalled()
        expect(loop.crashed).toEqual([])
    })

    test('R29 the first read after a commit-key rollback parks, applies nothing and does not call the fast-forward again', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        await commitOwnEdit(loop, b, 0, 'my edit')
        await page.commitEdit((db) => { chars(db)[1].personality = 'peer one' })
        signal(loop)
        await caughtUp(b, memory)
        const captured = (await memory.readCommit()).bytes
        await page.commitEdit((db) => { chars(db)[2].personality = 'peer two' })
        signal(loop)
        await caughtUp(b, memory)
        if (captured === null) {
            throw new Error('No commit key bytes.')
        }
        await plantBytes(memory, captured)
        const run = spyOnRun(b)
        const before = JSON.stringify(b.db.characters)
        signal(loop)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 4000)
        expect(b.peer.clean[0].offers).toEqual(['reload', 'export-first'])
        expect(run).not.toHaveBeenCalled()
        expect(JSON.stringify(b.db.characters)).toBe(before)
    })
})

describe('the baseline moves with every taken tree', () => {
    test('R30 pages alternating disjoint commits never park', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        const texts = ['a1', 'b1', 'a2', 'b2', 'a3', 'b3']
        let own = 0
        for (const [index, text] of texts.entries()) {
            if (index % 2 === 0) {
                await page.commitEdit((db) => { chars(db)[1].personality = text })
                signal(loop)
                await caughtUp(b, memory)
            } else {
                own += 1
                await commitOwnEdit(loop, b, 0, text)
            }
        }
        expect(own).toBe(3)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        const final = await page.freeze()
        expect(personalityOf(final.db, 0)).toBe('b3')
        expect(personalityOf(final.db, 1)).toBe('a3')
    })

    test('R28a a store without a line parks a clean page once, with Reload and Export this tab first', async () => {
        const memory = createMemoryBackend()
        const clock = createClock()
        await seedTree(memory, seedProfile(), testEnv(clock, 4242), fakeLists)
        const { peerPage } = await import('./lineFixtures')
        const page = peerPage(memory, clock, 7)
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        await page.commitEdit((db) => { chars(db)[3].personality = 'first peer edit' })
        signal(loop)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 4000)
        expect(b.peer.clean[0].offers).toEqual(['reload', 'export-first'])
        expect(extrasOf(await parsedKey(memory)).line).toBeDefined()
    })

    test('R28b after the reload of a page that parked on a store without a line, the next peer commit is taken and the page does not park', async () => {
        const memory = createMemoryBackend()
        const clock = createClock()
        await seedTree(memory, seedProfile(), testEnv(clock, 4242), fakeLists)
        const { peerPage } = await import('./lineFixtures')
        const page = peerPage(memory, clock, 7)
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        await page.commitEdit((db) => { chars(db)[3].personality = 'first peer edit' })
        signal(loop)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 4000)
        loop.stop()
        const reloaded = await bootB(memory)
        const second = runLoopOver(reloaded.context, reloaded.db)
        await page.commitEdit((db) => { chars(db)[2].personality = 'second peer edit' })
        signal(second)
        await until(async () => reloaded.peer.clean.length >= 1 || reloaded.context.encoder.manifestKey === await manifestOfStore(memory), 'the reloaded page to settle', 4000)
        expect(reloaded.peer.clean).toEqual([])
        expect(reloaded.context.encoder.manifestKey).toBe(await manifestOfStore(memory))
        expect(isColdStub(chars(reloaded.db)[2])).toBe(true)
        expect(second.crashed).toEqual([])
    })

    test('R31 a page booted through the first-life install takes a peer commit made before its first judged read', async () => {
        const memory = createMemoryBackend()
        const clock = createClock()
        const { peerPage } = await import('./lineFixtures')
        const b = await bootB(memory)
        const page = peerPage(memory, clock, 7)
        const loop = runLoopOver(b.context, b.db)
        await page.commitEdit((db) => { db.temperature = 77 })
        signal(loop)
        await caughtUp(b, memory)
        expect(b.db.temperature).toBe(77)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
    })
    test('R10 a peer that commits while this page\'s commit is in flight is taken on the next attempt, with no park', async () => {
        const { memory, page } = await ffWorld()
        let armed = false
        const wrapped = hooked(memory, {
            before: async (name) => {
                if (name === 'commitOrdinary' && armed) {
                    armed = false
                    await page.commitEdit((db) => { chars(db)[2].personality = 'peer edit during the commit' })
                }
            },
        })
        const b = await bootB(wrapped.backend)
        const loop = runLoopOver(b.context, b.db)
        armed = true
        await commitOwnEdit(loop, b, 0, 'my edit')
        const read = await page.freeze()
        expect(personalityOf(read.db, 0)).toBe('my edit')
        expect(personalityOf(read.db, 2)).toBe('peer edit during the commit')
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
    })
})
