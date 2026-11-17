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

import { createCommitter, IMPORT_REPLACES_BASE } from 'src/ts/storage/store2/commit'
import { isColdStub } from 'src/ts/storage/store2/codec'
import { createFastForward } from 'src/ts/storage/store2/fastForward'
import { defaultKeyEnv } from 'src/ts/storage/store2/format'
import { recordTrashOrigins } from 'src/ts/trashOrigin'
import type { Database } from 'src/ts/storage/database.svelte'
import { fakeLists } from './codecFixtures'
import { chaIdOf, chars, parsedKey, until } from './lineFixtures'
import {
    bootB, ffSetup, ffTeardown, ffWorld, personalityOf, runLoopWorld, runSpyOf, signal, sleepMs, takenBy, type PageB,
} from './ffFixtures'

/**
 * Plan rows of the fast-forward over the real save loop that no other suite drives through it: the moved fields and the
 * trash a peer wrote, a standing foreign marker under alternating commits, the commit-key writes that name no new tree,
 * the characters order, the unit classes that still park, a failed check A, and the ff-revert park's lifecycle.
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
    vi.useRealTimers()
})

/** The trash statement of `trashCharacters`: the id leaves the order, the character is stamped and its origin recorded. */
function trash(db: Database, index: number, at: number): void {
    const slot = chars(db)[index]
    slot.trashTime = at
    recordTrashOrigins(db, [{ chaId: String(slot.chaId) }], at)
    db.characterOrder = db.characterOrder.filter(item => item !== slot.chaId)
}

async function ownCommit(b: PageB, world: ReturnType<typeof runLoopWorld>, index: number): Promise<void> {
    const before = world.state.saved
    world.mark(chaIdOf(b.db, index))
    await until(() => world.state.saved > before, 'the own commit', 8000)
}

describe('moved fields and trash', () => {
    test('R6 a chat page the peer moved is followed by a character that is not open, and by one that is open but not being written', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        await page.commitEdit((db) => { chars(db)[3].chatPage = 1 })
        signal(world)
        await takenBy(b, memory)
        expect(chars(b.db)[3].chatPage).toBe(1)
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 2))
        await page.commitEdit((db) => { chars(db)[2].chatPage = 1 })
        signal(world)
        await takenBy(b, memory)
        expect(chars(b.db)[2].chatPage).toBe(1)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('R17 a peer trash of a character this page edited is taken without a park, and the store then holds it trashed with this page\'s edit', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        const at = Date.now()
        chars(b.db)[3].personality = 'my body edit'
        await page.commitEdit((db) => { trash(db, 3, at) })
        signal(world)
        await takenBy(b, memory)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(chars(b.db)[3].trashTime).toBe(at)
        expect(personalityOf(b.db, 3)).toBe('my body edit')
        expect(b.db.characterOrder).not.toContain(chaIdOf(b.db, 3))
        await ownCommit(b, world, 3)
        const read = await page.freeze()
        expect(chars(read.db)[3].trashTime).toBe(at)
        expect(personalityOf(read.db, 3)).toBe('my body edit')
        expect(read.db.characterOrder).not.toContain(chaIdOf(b.db, 3))
        expect(read.db.trashOrigins).toEqual(b.db.trashOrigins)
        expect(world.crashed).toEqual([])
    })

    test('R23 a character this page trashed and the peer then edited becomes the peer\'s stub with this page\'s trash time, and the next commit holds both', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        const at = Date.now()
        const chaId = chaIdOf(b.db, 3)
        trash(b.db, 3, at)
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer body' })
        signal(world)
        await takenBy(b, memory)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(isColdStub(chars(b.db)[3])).toBe(true)
        expect(chars(b.db)[3].trashTime).toBe(at)
        world.mark(chaId)
        await until(() => world.state.saved >= 1, 'the own commit', 8000)
        const read = await page.freeze()
        expect(chars(read.db)[3].trashTime).toBe(at)
        expect(personalityOf(read.db, 3)).toBe('peer body')
        expect(read.db.characterOrder).not.toContain(chaId)
    })

    test('R23c the stub that replaces a character shows the peer\'s name, not the name this page held', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        await page.commitEdit((db) => { chars(db)[3].name = 'Renamed by the peer' })
        signal(world)
        await takenBy(b, memory)
        expect(isColdStub(chars(b.db)[3])).toBe(true)
        expect(chars(b.db)[3].name).toBe('Renamed by the peer')
    })

    test('R23b a newer last interaction on this page survives the swap for the peer\'s stub', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        const newer = Date.now() + 5 * 60_000
        chars(b.db)[3].lastInteraction = newer
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer body' })
        signal(world)
        await takenBy(b, memory)
        expect(isColdStub(chars(b.db)[3])).toBe(true)
        expect(chars(b.db)[3].lastInteraction).toBe(newer)
        expect(b.peer.asked).toEqual([])
    })
})

describe('a standing foreign marker', () => {
    test('R22 pages that commit in turn under a foreign marker never park, and the marker is on every key unchanged', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        const foreign = createCommitter(memory, { owner: 'foreign-page' })
        void foreign.commit(await foreign.readCommit(), { newUnits: 100, carry: IMPORT_REPLACES_BASE, label: 'bulk', build: () => new Promise(() => { }) })
        await until(async () => (await parsedKey(memory)).staging !== null, 'the marker', 4000)
        const marker = (await parsedKey(memory)).staging
        await page.commitEdit((db) => { chars(db)[1].personality = 'a1' })
        expect((await parsedKey(memory)).staging).toEqual(marker)
        signal(world)
        await takenBy(b, memory)
        chars(b.db)[0].personality = 'b1'
        await ownCommit(b, world, 0)
        expect((await parsedKey(memory)).staging).toEqual(marker)
        await page.commitEdit((db) => { chars(db)[2].personality = 'a2' })
        expect((await parsedKey(memory)).staging).toEqual(marker)
        signal(world)
        await takenBy(b, memory)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(b.peer.foreignAsked).toEqual([])
        const read = await page.freeze()
        expect(personalityOf(read.db, 0)).toBe('b1')
        expect(personalityOf(read.db, 1)).toBe('a1')
        expect(personalityOf(read.db, 2)).toBe('a2')
        expect(world.crashed).toEqual([])
    })
})

describe('writes that name no new tree, and parks that stay', () => {
    test('G7 a peer pin and unpin change the commit key only: no park, no fast-forward, and this page still saves', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const run = runSpyOf(b)
        const world = runLoopWorld(b.context, b.db)
        const current = (await parsedKey(memory)).current?.key
        if (current === undefined) {
            throw new Error('The store has no current tree.')
        }
        expect((await page.committer.pin(await page.committer.readCommit(), current, 'peer pin')).status).toBe('committed')
        signal(world)
        await sleepMs(150)
        expect((await page.committer.unpin(await page.committer.readCommit(), current)).status).toBe('committed')
        signal(world)
        await sleepMs(150)
        chars(b.db)[0].personality = 'my edit after the pin'
        await ownCommit(b, world, 0)
        expect(run).not.toHaveBeenCalled()
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
    })

    test('G12L every fast-forward the loop starts runs under its write lock, whether a pass or a peer check noticed the commit', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        const fastForward = b.context.fastForward
        if (fastForward === undefined) {
            throw new Error('The page has no fast-forward.')
        }
        const lockedAtCall: boolean[] = []
        const original = fastForward.run.bind(fastForward)
        vi.spyOn(fastForward, 'run').mockImplementation((frame) => {
            lockedAtCall.push(world.locked)
            return original(frame)
        })
        await page.commitEdit((db) => { chars(db)[1].personality = 'peer one' })
        signal(world)
        await takenBy(b, memory)
        await page.commitEdit((db) => { chars(db)[2].personality = 'peer two' })
        signal(world)
        await takenBy(b, memory)
        expect(lockedAtCall.length).toBeGreaterThanOrEqual(2)
        expect(lockedAtCall.every(Boolean)).toBe(true)
    })

    test('G13 both pages changed the characters order: this page parks with today\'s offers and keeps its own order', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        const added = JSON.parse(JSON.stringify(chars(b.db)[0])) as Record<string, unknown>
        added.chaId = 'added-here'
        added.name = 'Added here'
        chars(b.db).push(added)
        b.db.characterOrder = [...b.db.characterOrder, 'added-here']
        world.mark('added-here')
        await page.commitEdit((db) => { trash(db, 3, Date.now()) })
        await until(() => b.peer.asked.length >= 1, 'the question', 8000)
        expect(b.peer.asked[0]).toMatchObject({ reason: 'peer-commit', unsaved: true })
        expect(b.peer.asked[0].offers).toEqual(['reload', 'save-mine'])
        expect(b.db.characterOrder).toContain('added-here')
        expect(b.db.characterOrder).toContain(chaIdOf(b.db, 3))
    })

    test('G5b a peer change to the installed modules parks with today\'s prompt, applies nothing and does not take the modules', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const run = runSpyOf(b)
        const world = runLoopWorld(b.context, b.db)
        const before = JSON.stringify(b.db.modules)
        await page.commitEdit((db) => { Reflect.set(db, 'modules', [{ id: 'module-peer', name: 'Peer module', description: '', lorebook: [] }]) })
        signal(world)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 8000)
        expect(await run.mock.results[0].value).toMatchObject({ kind: 'park', reason: 'prepare' })
        expect(JSON.stringify(b.db.modules)).toBe(before)
        expect(world.crashed).toEqual([])
    })

    test('G5c a peer change to the plugin storage parks with today\'s prompt and applies nothing', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const run = runSpyOf(b)
        const world = runLoopWorld(b.context, b.db)
        const before = JSON.stringify(b.db)
        await page.commitEdit((db) => { Reflect.set(db, 'pluginCustomStorage', { 'peer-key': 'peer value' }) })
        signal(world)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 8000)
        expect(await run.mock.results[0].value).toMatchObject({ kind: 'park', reason: 'prepare' })
        expect(JSON.stringify(b.db)).toBe(before)
        expect(world.crashed).toEqual([])
    })
})
describe('check A and the ff-revert park', () => {
    test('G9a a failed check A at loop level leaves the database and the acknowledged manifest as they were, and the page parks', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        b.context.fastForward = createFastForward({
            backend: memory,
            kind: 'indexeddb',
            lists: fakeLists,
            env: defaultKeyEnv,
            apply: (steps) => {
                const undo = steps.map(step => step.apply())
                // One taken value is corrupted after it was written, so the check cannot hold.
                b.db.temperature = 424242
                if (steps.every(step => step.verify())) {
                    return 'applied'
                }
                for (const restore of undo.reverse()) {
                    restore()
                }
                return 'check-failed'
            },
        })
        const world = runLoopWorld(b.context, b.db)
        const before = JSON.stringify(b.db)
        const manifestBefore = b.context.encoder.manifestKey
        await page.commitEdit((db) => { db.temperature = 31 })
        signal(world)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 8000)
        expect(JSON.stringify(b.db)).toBe(before)
        expect(b.context.encoder.manifestKey).toBe(manifestBefore)
        expect((await parsedKey(memory)).current?.key).not.toBe(manifestBefore)
        expect(world.crashed).toEqual([])
    })

    test('G9f an ff-revert park keeps its guard entries pinned past five minutes, and a peer restore replaces it with tree-replaced', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { memory, page, firstManifest } = await ffWorld()
        const b = await bootB(memory)
        b.context.session = { kind: 'node', committer: b.context.session.committer }
        const world = runLoopWorld(b.context, b.db)
        const original = b.db.temperature
        await page.commitEdit((db) => { db.temperature = 123 })
        signal(world)
        await takenBy(b, memory)
        let release: () => void = () => { }
        b.peer.hold = new Promise<void>((resolve) => { release = resolve })
        b.peer.answer = 'export-first'
        b.peer.exportResult = 'declined'
        b.db.temperature = original
        world.mark(chaIdOf(b.db, 0))
        await until(() => b.peer.asked.length >= 1, 'the ff-revert question', 8000)
        expect(b.peer.asked[0]).toMatchObject({ reason: 'ff-revert' })
        vi.setSystemTime(Date.now() + 6 * 60_000)
        const guard = b.context.fastForward?.guard
        if (guard === undefined) {
            throw new Error('The page has no fast-forward.')
        }
        expect(guard.check(new Map(), path => path === 'temperature' ? original : undefined)).not.toBeNull()
        expect(b.peer.asked.length).toBe(1)
        await page.restore(firstManifest)
        signal(world)
        b.peer.hold = null
        release()
        await until(() => b.peer.asked.length >= 2, 'the second question', 8000)
        expect(b.peer.asked[1]).toMatchObject({ reason: 'tree-replaced' })
        expect(world.crashed).toEqual([])
    })
})
