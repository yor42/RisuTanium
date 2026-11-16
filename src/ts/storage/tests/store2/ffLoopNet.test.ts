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

import { createCommitter, IMPORT_REPLACES_BASE, type Committer } from 'src/ts/storage/store2/commit'
import { chaIdOf, chars, parsedKey, until } from './lineFixtures'
import { hooked } from './commitFixtures'
import {
    bootB, ffSetup, ffTeardown, ffWorld, ownEdit, personalityOf, runLoopWorld, signal, takenBy,
} from './ffFixtures'

/**
 * The fast-forward's retry accounting and the loop's other entry points over worlds that record what the loop reports:
 * the idle net takes a descending peer commit without a signal, a refused write over a moved base is retried and not
 * parked, a peer that keeps committing is not a failing save, the Node marker-prompt suppression counts the marker's
 * age, and a standing ff-revert question is not replaced by a later peer commit.
 */

const NET = { intervalMs: 20, moduleIntervalMs: 1_000_000_000, backstopMs: 0 }
const ROWS = 80

beforeEach(() => {
    ffSetup()
})

afterEach(() => {
    ffTeardown()
    vi.useRealTimers()
})

describe('entry points', () => {
    test('N1 the idle net takes a peer commit that provably descends, with no peer signal and no park', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db, { idleNet: NET })
        await page.commitEdit((db) => { db.temperature = 123 })
        await takenBy(b, memory)
        expect(b.db.temperature).toBe(123)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('N2 a write refused because the base no longer names the planned manifest is retried over the peer\'s commit, not parked', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const real: Committer = b.context.session.committer
        let refuse = true
        const proxy: Committer = {
            ...real,
            async commit(read, request) {
                if (refuse) {
                    refuse = false
                    await page.commitEdit((db) => { chars(db)[2].personality = 'peer edit under the refusal' })
                    return { status: 'refused', reason: 'base-unnamed', detail: 'The commit key no longer names the planned manifest.' }
                }
                return real.commit(read, request)
            },
        }
        b.context.session = { kind: b.context.session.kind, committer: proxy }
        const world = runLoopWorld(b.context, b.db)
        await ownEdit(world, b, 0, 'my edit')
        expect(refuse).toBe(false)
        const read = await page.freeze()
        expect(personalityOf(read.db, 0)).toBe('my edit')
        expect(personalityOf(read.db, 2)).toBe('peer edit under the refusal')
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('N3 a peer that commits four times while this page\'s commit is in flight is not a failing save', async () => {
        const { memory, page } = await ffWorld()
        let conflicts = 4
        const wrapped = hooked(memory, {
            before: async (name) => {
                if (name === 'commitOrdinary' && conflicts > 0) {
                    conflicts -= 1
                    await page.commitEdit((db) => { chars(db)[2].personality = `peer edit ${conflicts}` })
                }
            },
        })
        const b = await bootB(wrapped.backend)
        const world = runLoopWorld(b.context, b.db)
        await ownEdit(world, b, 0, 'my edit')
        expect(conflicts).toBe(0)
        expect(world.failures).toEqual([])
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        const read = await page.freeze()
        expect(personalityOf(read.db, 0)).toBe('my edit')
        expect(personalityOf(read.db, 2)).toBe('peer edit 0')
    })
})

describe('Node marker-prompt suppression counts the marker\'s age', () => {
    test('N4 a marker first seen more than ten minutes ago is asked about even while the peer is live', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { memory, page } = await ffWorld({ mintLine: true, count: ROWS })
        const b = await bootB(memory)
        b.context.session = { kind: 'node', committer: b.context.session.committer }
        b.context.markerOwnerProbe = async () => 'unknown'
        b.peer.foreignAnswers.push('wait')
        let gate: () => void = () => { }
        const held = new Promise<void>((resolve) => { gate = resolve })
        let sleeps = 0
        const world = runLoopWorld(b.context, b.db, { sleep: async () => { sleeps += 1; await held } })
        const peer = createCommitter(memory, { owner: 'peer-page' })
        void peer.commit(await peer.readCommit(), { newUnits: 100, carry: IMPORT_REPLACES_BASE, label: 'bulk', build: () => new Promise(() => { }) })
        await until(async () => (await parsedKey(memory)).staging !== null, 'the marker', 4000)
        for (const [index] of chars(b.db).entries()) {
            chars(b.db)[index].personality = `edited ${index}`
            world.mark(chaIdOf(b.db, index))
        }
        await until(() => sleeps >= 1, 'the first refusal of the marked save', 4000)
        expect(b.peer.foreignAsked).toEqual([])
        vi.setSystemTime(Date.now() + 11 * 60_000)
        await page.commitEdit((db) => { db.temperature = 321 })
        gate()
        await until(() => b.peer.foreignAsked.length >= 1, 'the question about the old marker', 8000)
    })
})

describe('a standing question', () => {
    test('N5 a later peer commit does not turn an unanswered ff-revert question into another reason', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        // A Node page offers Reload and Export this tab first; a declined export leaves the question standing and it is asked again.
        b.context.session = { kind: 'node', committer: b.context.session.committer }
        b.peer.answer = 'export-first'
        b.peer.exportResult = 'declined'
        const world = runLoopWorld(b.context, b.db)
        const original = b.db.temperature
        await page.commitEdit((db) => { db.temperature = 123 })
        signal(world)
        await takenBy(b, memory)
        b.db.temperature = original
        world.mark(chaIdOf(b.db, 0))
        await until(() => b.peer.asked.length >= 2, 'the ff-revert question, asked again', 4000)
        expect(b.peer.asked[0]).toMatchObject({ reason: 'ff-revert' })
        await page.commitEdit((db) => { chars(db)[2].personality = 'a later peer edit' })
        signal(world)
        const before = b.peer.asked.length
        await until(() => b.peer.asked.length >= before + 3, 'the question asked after the later peer commit', 4000)
        expect(b.peer.asked.map((prompt) => prompt.reason)).toEqual(b.peer.asked.map(() => 'ff-revert'))
        b.peer.answer = 'reload'
        expect(world.crashed).toEqual([])
    })
})
