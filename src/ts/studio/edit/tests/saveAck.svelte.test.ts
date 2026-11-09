// @vitest-environment jsdom
/**
 * The Studio save chip. Part 1 drives the state machine with fake dependencies (arithmetic of the
 * bounds, the sticky states, Retry, the poll and disposal). Part 2 runs the REAL, unmocked `saveDb()`
 * loops (store2 and the legacy block loop) through `src/ts/storage/tests/saveLoopWorld.ts`: the ack
 * is built from `productionSaveAckDeps` inside the world's own module graph, so `getCommittedSaveMarkCount`
 * and the rest are the loop's, never stubs. Only the ack's clock and the peer double are injected.
 * A mocked success here is not evidence of native backend behaviour.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { createPeerDouble, peerCommit, startStore2, store2Boot, type Store2Kit, type Store2StartOptions } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SaveFailureState } from 'src/ts/storage/store2/saveFailure'
import { createFakeClock, drainMicrotasks, type FakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import {
    ACK_BOUND_MS,
    ACK_CEILING_MS,
    PEER_POLL_MS,
    PENDING_DELAY_MS,
    createSaveAck,
    type SaveAck,
    type SaveAckDeps,
} from '../saveAck.svelte'

vi.setConfig({ testTimeout: 40_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

beforeAll(() => {
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

const acks: SaveAck[] = []

beforeEach(() => {
    vi.clearAllMocks()
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Entry }),
            selectedCharID: writable(-1),
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(''),
            frozenSaveKeysStore: writable([]),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    for (const ack of acks.splice(0)) {
        ack.dispose()
    }
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------- part 1: fake dependencies

interface FakeWorld {
    clock: FakeClock
    deps: SaveAckDeps
    ack: SaveAck
    state: {
        marks: number
        committed: number
        peers: number
        stopped: boolean
        failure: SaveFailureState | null
        unsavable: Set<string>
        frozen: Set<string>
        visible: boolean
        saveRequests: number
    }
    armed: { count: number }
    listeners: { commit: Set<() => void>; pass: Set<() => void>; failure: Set<(value: SaveFailureState | null) => void>; stop: Set<() => void>; visibility: Set<() => void> }
    // An edit: the mark counts first, then the ack is told with the count read before.
    edit(chaId?: string): void
    // A commit whose snapshot covers `covered` marks; fires and forgets the armed callbacks.
    commit(covered?: number): void
    passStart(): void
}

function fakeWorld(options: { visible?: boolean } = {}): FakeWorld {
    const clock = createFakeClock()
    const state: FakeWorld['state'] = {
        marks: 0,
        committed: 0,
        peers: 0,
        stopped: false,
        failure: null,
        unsavable: new Set(),
        frozen: new Set(),
        visible: options.visible ?? true,
        saveRequests: 0,
    }
    const armed = { count: 0 }
    const listeners: FakeWorld['listeners'] = { commit: new Set(), pass: new Set(), failure: new Set(), stop: new Set(), visibility: new Set() }
    const deps: SaveAckDeps = {
        getMarkCount: () => state.marks,
        getCommittedMarkCount: () => state.committed,
        afterNextCommit(callback) {
            armed.count += 1
            listeners.commit.add(callback)
        },
        requestSaveNow() {
            state.saveRequests += 1
            state.marks += 1
        },
        getPeerSaveCount: () => state.peers,
        onStopped(callback) {
            listeners.stop.add(callback)
            return () => listeners.stop.delete(callback)
        },
        isStopped: () => state.stopped,
        subscribeFailure(callback) {
            listeners.failure.add(callback)
            return () => listeners.failure.delete(callback)
        },
        currentFailure: () => state.failure,
        frozenKeys: () => state.frozen,
        isCharacterUnsavable: (chaId) => state.unsavable.has(chaId),
        onPassStart(callback) {
            listeners.pass.add(callback)
            return () => listeners.pass.delete(callback)
        },
        visible: () => state.visible,
        onVisibilityChange(callback) {
            listeners.visibility.add(callback)
            return () => listeners.visibility.delete(callback)
        },
        clock,
    }
    const ack = createSaveAck(deps)
    acks.push(ack)
    return {
        clock,
        deps,
        ack,
        state,
        armed,
        listeners,
        edit(chaId = 'A') {
            const before = state.marks
            state.marks += 1
            ack.noteEdit(chaId, before)
        },
        commit(covered = state.marks) {
            state.committed = Math.max(state.committed, covered)
            for (const callback of [...listeners.commit]) {
                listeners.commit.delete(callback)
                callback()
            }
        },
        passStart() {
            for (const callback of [...listeners.pass]) {
                callback()
            }
        },
    }
}

describe('the chip states', () => {
    test('pending is shown only after PENDING_DELAY_MS; a covering commit makes it saved', async () => {
        const w = fakeWorld()
        expect(w.ack.display).toBe('idle')
        w.edit()
        expect(w.ack.state).toBe('pending')
        expect(w.ack.display).toBe('idle')
        await w.clock.advance(PENDING_DELAY_MS)
        expect(w.ack.display).toBe('pending')
        w.commit()
        expect(w.ack.state).toBe('saved')
        expect(w.ack.display).toBe('saved')
        expect(w.clock.pendingTimers()).toBe(1)
    })

    test('a commit that does not cover the edit leaves it pending and arms the callback again', () => {
        const w = fakeWorld()
        w.state.marks = 5
        w.edit()
        w.commit(5)
        expect(w.ack.state).toBe('pending')
        expect(w.armed.count).toBe(2)
        w.commit(6)
        expect(w.ack.state).toBe('saved')
        expect(w.listeners.commit.size).toBe(0)
    })

    test('a covering commit for a character that cannot be encoded, or is frozen, is failed, never saved', () => {
        const unsavable = fakeWorld()
        unsavable.state.unsavable.add('A')
        unsavable.edit('A')
        unsavable.commit()
        expect(unsavable.ack.state).toBe('failed')
        const frozen = fakeWorld()
        frozen.state.frozen.add('A')
        frozen.edit('A')
        frozen.commit()
        expect(frozen.ack.state).toBe('failed')
    })

    test('C3: an edit whose mark was not counted, or made while saving is stopped, is failed at once', () => {
        const w = fakeWorld()
        w.ack.noteEdit('A', w.state.marks)
        expect(w.ack.state).toBe('failed')
        const stopped = fakeWorld()
        stopped.state.stopped = true
        stopped.edit()
        expect(stopped.ack.state).toBe('failed')
    })

    test('a failed state is sticky; Retry requests a save, covers its own mark and ends in saved', () => {
        const w = fakeWorld()
        w.ack.noteEdit('A', w.state.marks)
        w.edit()
        expect(w.ack.state).toBe('failed')
        w.commit()
        expect(w.ack.state).toBe('failed')
        expect(w.ack.retry()).toBe(true)
        expect(w.state.saveRequests).toBe(1)
        expect(w.ack.state).toBe('pending')
        w.commit(w.state.marks - 1)
        expect(w.ack.state).toBe('pending')
        w.commit()
        expect(w.ack.state).toBe('saved')
    })
})

describe('failure signals', () => {
    test('a failure that appears while pending makes the edit failed', () => {
        const w = fakeWorld()
        w.edit()
        const failure: SaveFailureState = { class: 'not-flushed', attempts: 1 }
        for (const callback of w.listeners.failure) {
            callback(failure)
        }
        expect(w.ack.state).toBe('failed')
    })

    test('T-A4b: a failure that was current at the edit does not fail it; its clearing restarts the bound', async () => {
        const w = fakeWorld()
        const stale: SaveFailureState = { class: 'not-flushed', attempts: 2 }
        w.state.failure = stale
        w.edit()
        for (const callback of w.listeners.failure) {
            callback(stale)
        }
        expect(w.ack.state).toBe('pending')
        await w.clock.advance(20_000)
        for (const callback of w.listeners.failure) {
            callback(null)
        }
        // The old handle was cleared: nothing fires at 30 s, and the new bound ends at 50 s.
        await w.clock.advance(ACK_BOUND_MS - 20_000 + 1)
        expect(w.ack.state).toBe('pending')
        await w.clock.advance(20_000 - 1)
        expect(w.ack.state).toBe('unconfirmed')
    })

    test('a stop while pending makes the edit failed', () => {
        const w = fakeWorld()
        w.edit()
        for (const callback of w.listeners.stop) {
            callback()
        }
        expect(w.ack.state).toBe('failed')
    })
})

describe('the bound and the ceiling', () => {
    test('the bound ends a pending edit with nothing to show in unconfirmed', async () => {
        const w = fakeWorld()
        w.edit()
        await w.clock.advance(ACK_BOUND_MS - 1)
        expect(w.ack.state).toBe('pending')
        await w.clock.advance(1)
        expect(w.ack.state).toBe('unconfirmed')
        expect(w.ack.display).toBe('unconfirmed')
    })

    test('T-A9b: pass starts keep the bound alive, but the ceiling ends it at 120 s', async () => {
        const w = fakeWorld()
        w.edit()
        for (let t = 20_000; t < ACK_CEILING_MS; t += 20_000) {
            await w.clock.advance(20_000)
            w.passStart()
            expect(w.ack.state).toBe('pending')
        }
        await w.clock.advance(ACK_CEILING_MS - 100_000 - 1)
        expect(w.ack.state).toBe('pending')
        await w.clock.advance(1)
        expect(w.ack.state).toBe('unconfirmed')
    })

    test('T-A9b: a commit that does not cover the edit still restarts the ceiling', async () => {
        const w = fakeWorld()
        w.state.marks = 3
        w.edit()
        for (let t = 20_000; t <= 100_000; t += 20_000) {
            await w.clock.advance(20_000)
            w.passStart()
        }
        w.commit(3)
        expect(w.ack.state).toBe('pending')
        for (let t = 120_000; t < 220_000; t += 20_000) {
            await w.clock.advance(20_000)
            w.passStart()
            expect(w.ack.state).toBe('pending')
        }
        await w.clock.advance(19_999)
        expect(w.ack.state).toBe('pending')
        await w.clock.advance(1)
        expect(w.ack.state).toBe('unconfirmed')
    })

    test('a pass start restarts the bound; firing the old one does nothing', async () => {
        const w = fakeWorld()
        w.edit()
        await w.clock.advance(20_000)
        w.passStart()
        await w.clock.advance(10_000)
        expect(w.ack.state).toBe('pending')
        await w.clock.advance(19_999)
        expect(w.ack.state).toBe('pending')
        await w.clock.advance(1)
        expect(w.ack.state).toBe('unconfirmed')
    })
})

describe('T-A10: Retry', () => {
    test('is offered only in failed or unconfirmed, with no changed elsewhere and saving not stopped', async () => {
        const rows: { name: string; arrange: (w: FakeWorld) => Promise<void> | void; offered: boolean }[] = [
            { name: 'idle', arrange: () => {}, offered: false },
            { name: 'pending', arrange: (w) => w.edit(), offered: false },
            { name: 'saved', arrange: (w) => { w.edit(); w.commit() }, offered: false },
            { name: 'failed', arrange: (w) => w.ack.noteEdit('A', w.state.marks), offered: true },
            { name: 'unconfirmed', arrange: async (w) => { w.edit(); await w.clock.advance(ACK_BOUND_MS) }, offered: true },
            {
                name: 'failed while changed elsewhere',
                arrange: async (w) => {
                    w.ack.noteEdit('A', w.state.marks)
                    w.state.peers += 1
                    await w.clock.advance(PEER_POLL_MS)
                },
                offered: false,
            },
            {
                name: 'unconfirmed while saving is stopped (the replaced stop)',
                arrange: async (w) => {
                    w.edit()
                    await w.clock.advance(ACK_BOUND_MS)
                    w.state.stopped = true
                },
                offered: false,
            },
        ]
        for (const row of rows) {
            const w = fakeWorld()
            await row.arrange(w)
            expect(w.ack.canRetry(), row.name).toBe(row.offered)
            expect(w.ack.retry(), row.name).toBe(row.offered)
            expect(w.state.saveRequests, row.name).toBe(row.offered ? 1 : 0)
        }
    })
})

describe('changed elsewhere', () => {
    test('is polled every PEER_POLL_MS while visible, and cleared by this tab\'s next covering save', async () => {
        const w = fakeWorld()
        w.state.peers += 1
        await w.clock.advance(PEER_POLL_MS - 1)
        expect(w.ack.changedElsewhere).toBe(false)
        await w.clock.advance(1)
        expect(w.ack.changedElsewhere).toBe(true)
        expect(w.ack.display).toBe('changedElsewhere')
        w.edit()
        w.commit()
        expect(w.ack.changedElsewhere).toBe(false)
        expect(w.ack.display).toBe('saved')
        // The covering save also takes the new peer count as its baseline, so the next poll does not flag it again.
        await w.clock.advance(PEER_POLL_MS)
        expect(w.ack.changedElsewhere).toBe(false)
    })

    test('T-A7b: with the page hidden nothing polls; a visibility change, an edit or a commit shows it', async () => {
        const w = fakeWorld({ visible: false })
        expect(w.clock.pendingTimers()).toBe(0)
        w.state.peers += 1
        await w.clock.advance(60_000)
        expect(w.ack.changedElsewhere).toBe(false)
        w.state.visible = true
        for (const callback of w.listeners.visibility) {
            callback()
        }
        expect(w.ack.changedElsewhere).toBe(true)

        const byEdit = fakeWorld({ visible: false })
        byEdit.state.peers += 1
        byEdit.edit()
        expect(byEdit.ack.changedElsewhere).toBe(true)

        const byCommit = fakeWorld({ visible: false })
        byCommit.state.marks = 4
        byCommit.edit()
        byCommit.state.peers += 1
        byCommit.commit(4)
        expect(byCommit.ack.changedElsewhere).toBe(true)
        expect(byCommit.ack.state).toBe('pending')
    })

    test('a covering commit in a sticky state still clears changed elsewhere (T-A11, unit)', async () => {
        const w = fakeWorld()
        w.edit()
        await w.clock.advance(ACK_BOUND_MS)
        expect(w.ack.state).toBe('unconfirmed')
        w.state.peers += 1
        await w.clock.advance(PEER_POLL_MS)
        expect(w.ack.changedElsewhere).toBe(true)
        w.commit()
        expect(w.ack.changedElsewhere).toBe(false)
        expect(w.ack.state).toBe('unconfirmed')
    })
})

describe('T-A9a: disposal', () => {
    test('leaves no timer, no listener, and an armed callback that fires later does nothing', async () => {
        const w = fakeWorld()
        w.edit()
        expect(w.listeners.visibility.size).toBe(1)
        const callbacks = [...w.listeners.commit]
        const armedBefore = w.armed.count
        w.ack.dispose()
        await drainMicrotasks()
        expect(w.clock.pendingTimers()).toBe(0)
        expect(w.listeners.visibility.size).toBe(0)
        expect(w.listeners.pass.size).toBe(0)
        expect(w.listeners.failure.size).toBe(0)
        expect(w.listeners.stop.size).toBe(0)
        const state = w.ack.state
        w.state.committed = w.state.marks
        for (const callback of callbacks) {
            callback()
        }
        expect(w.ack.state).toBe(state)
        expect(w.armed.count).toBe(armedBefore)
        w.edit()
        expect(w.clock.pendingTimers()).toBe(0)
    })
})

// ---------------------------------------------------------------- part 2: the real loops

interface Page {
    w: World
    k: Store2Kit
    db: Entry
    flush(): void
}

interface PageOptions extends Partial<Store2StartOptions> {
    beforeStart?: (page: Page) => Promise<void> | void
}

function characters(db: Entry): Entry[] {
    return db.characters as Entry[]
}

async function startPage(db: Database, options: PageOptions = {}): Promise<Page> {
    const { beforeStart, ...kitOptions } = options
    h.db = db as unknown as Entry
    const k = await startStore2({ db, ...kitOptions })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const page: Page = { w, k, db: h.db, flush: flushSync }
    await beforeStart?.(page)
    w.start()
    await sleepReal(150)
    return page
}

// The ack, built from the production dependencies of the world's own module graph.
async function worldAck(clock: FakeClock): Promise<SaveAck> {
    const module = await import('src/ts/studio/edit/saveAck.svelte')
    const ack = module.createSaveAck(module.productionSaveAckDeps(clock))
    acks.push(ack)
    return ack
}

// A Studio write as `writeLiveCharacter` makes it: the change, then the mark, then the ack is told
// with the count read before.
function studioEdit(page: Page, ack: SaveAck, index: number, text: string): string {
    const target = characters(page.db)[index]
    const chaId = String(target.chaId)
    const before = page.w.api.getSaveMarkCount()
    target.personality = text
    page.w.marks.markCharacterForSave(chaId)
    page.flush()
    ack.noteEdit(chaId, before)
    return chaId
}

const small = () => buildSmall(4)

describe('T-A1: store2, saved only after a commit whose snapshot followed the mark', () => {
    test('pending until the covering commit; a commit that was already running does not resolve it', async () => {
        let hold: Promise<void> | null = null
        let entered = false
        let release!: () => void
        const page = await startPage(small(), {
            hooks: {
                before: async (name) => {
                    if (name === 'commitOrdinary' && hold !== null) {
                        entered = true
                        await hold
                    }
                },
            },
        })
        await settled(page.w)
        const clock = createFakeClock()
        const ack = await worldAck(clock)
        // A pass that took its snapshot before the Studio edit is held at its commit.
        hold = new Promise<void>((resolve) => { release = resolve })
        characters(page.db)[0].personality = 'an earlier edit'
        page.w.marks.markCharacterForSave(String(characters(page.db)[0].chaId))
        await until(() => entered, 'the held commit', 10000)
        const earlierSnapshot = page.w.api.getSaveMarkCount()
        studioEdit(page, ack, 2, 'studio edit')
        expect(ack.state).toBe('pending')
        release()
        hold = null
        await until(() => page.w.api.getCommittedSaveMarkCount() >= earlierSnapshot, 'the held commit to land', 10000)
        // That commit's snapshot predates the Studio edit's mark.
        expect(page.w.api.getCommittedSaveMarkCount()).toBeLessThan(page.w.api.getSaveMarkCount())
        expect(ack.state).toBe('pending')
        await until(() => ack.state === 'saved', 'a covering commit', 10000)
        expect(page.w.api.getCommittedSaveMarkCount()).toBeGreaterThanOrEqual(page.w.api.getSaveMarkCount())
        expect((await page.k.saved()).characters[2]).toMatchObject({ personality: 'studio edit' })
    })
})

describe('T-A2: store2, a covering commit for an unencodable character is failed', () => {
    test('the chip is failed, not saved', async () => {
        const page = await startPage(small())
        await settled(page.w)
        const ack = await worldAck(createFakeClock())
        const target = characters(page.db)[1]
        const chaId = String(target.chaId)
        const before = page.w.api.getSaveMarkCount()
        target.personality = { toJSON() { throw new Error('toJSON fault') } }
        page.w.marks.markCharacterForSave(chaId)
        page.flush()
        ack.noteEdit(chaId, before)
        await until(() => ack.state !== 'pending', 'the covering commit', 10000)
        expect(ack.state).toBe('failed')
        expect(page.w.api.isCharacterUnsavable(chaId)).toBe(true)
    })
})

describe('T-A3: store2, a peer hand-off that throws leaves the edit unconfirmed', () => {
    test('no commit; the bound ends in unconfirmed; Retry is not offered while the page shows changed elsewhere', async () => {
        const peer = createPeerDouble('export-first')
        peer.exportFails = true
        const page = await startPage(small(), { kind: 'node', peer })
        await settled(page.w)
        const clock = createFakeClock()
        const ack = await worldAck(clock)
        const key = await peerCommit(page.k, (peerDb) => { (peerDb.characters as unknown as Entry[])[3].personality = 'the peer edit' })
        studioEdit(page, ack, 0, 'my edit')
        h.channels.at(-1)!.onmessage?.({ data: { sessionID: 'a peer tab', epoch: key.epoch } })
        const { alertError } = await import('src/ts/alert')
        await until(() => vi.mocked(alertError).mock.calls.length >= 1, 'the failure shown for the export throw', 8000)
        expect(ack.state).toBe('pending')
        await clock.advance(PEER_POLL_MS)
        expect(ack.changedElsewhere).toBe(true)
        await clock.advance(ACK_BOUND_MS)
        expect(ack.state).toBe('unconfirmed')
        expect(ack.canRetry()).toBe(false)
        expect(page.w.api.getCommittedSaveMarkCount()).toBeLessThan(page.w.api.getSaveMarkCount())
    })
})

describe('T-A4: store2, a failed save pass', () => {
    test('a pass that fails makes a pending edit failed; a failure present at the edit does not', async () => {
        const gate = { unflushed: true }
        const page = await startPage(small(), {
            hooks: { flushed: (name) => (name === 'commitOrdinary' && gate.unflushed ? false : undefined) },
        })
        const { saveFailureStore } = await import('src/ts/storage/store2/saveFailure')
        const { get } = await import('svelte/store')
        const ack = await worldAck(createFakeClock())
        studioEdit(page, ack, 0, 'unflushed edit')
        expect(ack.state).toBe('pending')
        await until(() => ack.state === 'failed', 'the failed pass', 20000)
        expect(get(saveFailureStore)).not.toBeNull()

        // A second visit's ack starts while that failure is still current.
        const later = await worldAck(createFakeClock())
        gate.unflushed = false
        studioEdit(page, later, 1, 'edit during a failure')
        expect(later.state).toBe('pending')
        await until(() => later.state === 'saved', 'the covering commit', 20000)
        expect(get(saveFailureStore)).toBeNull()
    })
})

describe('T-A5: marks that are not installed fail the edit at once (C3)', () => {
    test('the edit lands in the database and the chip is failed', async () => {
        h.db = makeDb('base', ['alpha', 'beta'])
        const w = await worlds.startWorld({ startLoop: false })
        const ack = await worldAck(createFakeClock())
        w.marks.uninstallCharacterSaveMarks()
        const before = w.api.getSaveMarkCount()
        ;(h.db.characters as Entry[])[0].name = 'edited'
        w.marks.markCharacterForSave('alpha')
        ack.noteEdit('alpha', before)
        expect(ack.state).toBe('failed')
    })
})

describe('T-A6: the legacy loop', () => {
    test('saved after the covering commit, and isCharacterUnsavable is false throughout', async () => {
        h.db = makeDb('base', ['alpha', 'beta'])
        const w = await worlds.startWorld()
        await settled(w)
        const ack = await worldAck(createFakeClock())
        const before = w.api.getSaveMarkCount()
        await nextCommit(w, () => {
            ;(h.db!.characters as Entry[])[0].name = 'edited'
            w.marks.markCharacterForSave('alpha')
            ack.noteEdit('alpha', before)
        })
        expect(ack.state).toBe('saved')
        expect(w.api.isCharacterUnsavable('alpha')).toBe(false)
    })

    test('with no commit the bound ends the edit in unconfirmed', async () => {
        h.db = makeDb('base', ['alpha', 'beta'])
        const w = await worlds.startWorld()
        await settled(w)
        const clock = createFakeClock()
        const ack = await worldAck(clock)
        // A closed tab: the loop is parked and its store hangs, so nothing ever commits.
        worlds.closeWorld(w)
        const before = w.api.getSaveMarkCount()
        ;(h.db!.characters as Entry[])[0].name = 'edited'
        w.marks.markCharacterForSave('alpha')
        ack.noteEdit('alpha', before)
        await sleepReal(300)
        await clock.advance(ACK_BOUND_MS)
        expect(ack.state).toBe('unconfirmed')
    })
})

describe('T-A6b: the legacy loop, a frozen chaId', () => {
    test('the covering commit of a mark whose chaId is held twice is failed, not saved', async () => {
        h.db = makeDb('base', ['alpha', 'beta'])
        const w = await worlds.startWorld()
        await settled(w)
        const ack = await worldAck(createFakeClock())
        const before = w.api.getSaveMarkCount()
        const list = h.db!.characters as Entry[]
        list[0].name = 'edited'
        // An import adds a second character with the same chaId.
        list.push({ ...(JSON.parse(JSON.stringify(list[0])) as Entry), name: 'the copy' })
        w.marks.markCharacterForSave('alpha')
        ack.noteEdit('alpha', before)
        await until(() => ack.state !== 'pending', 'the covering commit', 10000)
        expect(ack.state).toBe('failed')
    })
})

describe('T-A7: store2, changed elsewhere', () => {
    test('a peer message shows within one poll, and this tab\'s next covering save clears it', async () => {
        const page = await startPage(small())
        await settled(page.w)
        const clock = createFakeClock()
        const ack = await worldAck(clock)
        h.channels.at(-1)!.onmessage?.({ data: 'a peer tab' })
        expect(ack.changedElsewhere).toBe(false)
        await clock.advance(PEER_POLL_MS)
        expect(ack.changedElsewhere).toBe(true)
        studioEdit(page, ack, 0, 'after the peer')
        await until(() => ack.state === 'saved', 'the covering commit', 10000)
        expect(ack.changedElsewhere).toBe(false)
    })
})

describe('T-A9a: a real pass start restarts the bound', () => {
    test('the old bound does not fire; the new one does', async () => {
        let hold: Promise<void> | null = null
        let entered = false
        let release!: () => void
        const page = await startPage(small(), {
            hooks: {
                before: async (name) => {
                    if (name === 'commitOrdinary' && hold !== null) {
                        entered = true
                        await hold
                    }
                },
            },
        })
        await settled(page.w)
        const clock = createFakeClock()
        const ack = await worldAck(clock)
        hold = new Promise<void>((resolve) => { release = resolve })
        studioEdit(page, ack, 0, 'edit')
        // The pass starts later on the ack's clock: its start restarts the bound from there.
        clock.set(20_000)
        await until(() => entered, 'the pass to reach its commit', 10000)
        await drainMicrotasks()
        await clock.advance(ACK_BOUND_MS - 20_000)
        expect(ack.state).toBe('pending')
        await clock.advance(20_000 - 1)
        expect(ack.state).toBe('pending')
        await clock.advance(1)
        expect(ack.state).toBe('unconfirmed')
        release()
        hold = null
    })
})

describe('T-A11: a covering commit leaves a sticky state alone', () => {
    test('unconfirmed stays unconfirmed after a covering commit; only Retry reaches saved', async () => {
        let hold: Promise<void> | null = null
        let entered = false
        let release!: () => void
        const page = await startPage(small(), {
            hooks: {
                before: async (name) => {
                    if (name === 'commitOrdinary' && hold !== null) {
                        entered = true
                        await hold
                    }
                },
            },
        })
        await settled(page.w)
        const clock = createFakeClock()
        const ack = await worldAck(clock)
        hold = new Promise<void>((resolve) => { release = resolve })
        studioEdit(page, ack, 0, 'edit')
        await until(() => entered, 'the pass to reach its commit', 10000)
        await clock.advance(ACK_BOUND_MS)
        expect(ack.state).toBe('unconfirmed')
        release()
        hold = null
        await until(() => page.w.api.getCommittedSaveMarkCount() >= page.w.api.getSaveMarkCount(), 'the covering commit', 10000)
        expect(ack.state).toBe('unconfirmed')
        expect(ack.retry()).toBe(true)
        await until(() => ack.state === 'saved', 'the retry to be confirmed', 10000)
    })
})

describe('T-A12: store2, an undo is pending until a commit covers its own mark', () => {
    test('saved, then the revert write is pending and the profile holds the pre-edit value after the commit', async () => {
        const page = await startPage(small())
        await settled(page.w)
        const ack = await worldAck(createFakeClock())
        const original = String(characters(page.db)[2].personality)
        studioEdit(page, ack, 2, 'edited')
        await until(() => ack.state === 'saved', 'the edit to be saved', 10000)
        studioEdit(page, ack, 2, original)
        expect(ack.state).toBe('pending')
        await until(() => ack.state === 'saved', 'the undo to be saved', 10000)
        expect((await page.k.saved()).characters[2]).toMatchObject({ personality: original })
    })
})
