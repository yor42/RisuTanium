// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    Store2BackendFailureError, Store2StalePageError, Store2UnknownOutcomeError,
} from '../../store2/backend'
import { createCommitter, type AbandonResult, type CommitResult, type Committer, type CommitRequest } from '../../store2/commit'
import { classifyCommitRead } from '../../store2/commitKey'
import { encodeUnit, UNIT_TYPE, type CommitKey } from '../../store2/format'
import type { Store2Read } from '../../store2/backend'
import type { ListDerivation } from '../../store2/codec'
import { buildColdStub } from '../../../process/coldCharacter'
import { createSaveEncoder } from '../../store2/saveEncoder'
import { backedOffWait, runStore2SaveLoop, type Store2LoopPort, type UnsavableCharacter } from '../../store2/saveLoop'
import type { Database, character } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import {
    createPeerDouble, peerCommit, peerPin, startStore2, type PeerDouble, type Store2Kit, type Store2StartOptions,
} from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'

/**
 * The store2 save loop's engine over a real memory backend and committer, with a hand-built port in place of the
 * page's glue. Labels in the titles: new behaviour (a property the loop is built to have), guard (passes before and
 * after), mutant (a recorded temporary edit that turns the named test red).
 */

type Entry = Record<string, unknown>

function clone(db: Database): Database {
    return JSON.parse(JSON.stringify(db)) as Database
}

function chars(db: Database): Entry[] {
    return db.characters as unknown as Entry[]
}

function chaIdOf(db: Database, index: number): string {
    return String(chars(db)[index].chaId)
}

interface Loop {
    kit: Store2Kit
    db: Database
    tracker: toSaveType
    reloadFlag: { state: boolean }
    state: { due: boolean, dirty: boolean, saved: number, saving: boolean, stopped: string, peerHeard: boolean, marks: number, drafts: boolean }
    failures: Array<{ error: unknown, attempts: number }>
    /** Failures reported through `reportUncountedFailure`: the peer handler's throws and a throw after a commit landed. */
    uncounted: Array<{ error: unknown, attempts: number }>
    /** The waits the loop asked for through `sleep`, in order. */
    sleeps: number[]
    /**
     * Holds every later `sleep` until the returned release runs. The loop's catch sleeps right after it reports a
     * failure and reads the base only after that sleep, so a held sleep keeps the retry from adopting a landed commit
     * while the test edits the page. Open by default.
     */
    holdSleeps(): () => void
    /** When set, the next `saved` call throws once: the bookkeeping that follows a commit that has landed. */
    savedThrows: Error | null
    /** What the loop told the port about unsavable characters, in order, with `saved` calls interleaved as 'saved'. */
    unsavableCalls: Array<{ current: UnsavableCharacter[], newly: UnsavableCharacter[] }>
    order: string[]
    /** How many times the loop folded a snapshot back into the live tracker. */
    merges: number
    /** When set, `unsavable` throws it: the loop must stay quiet about a notice that fails. */
    unsavableThrows: Error | null
    broadcasts: string[]
    crashed: unknown[]
    mark(chaId: string): void
    /** Asks for a pass the way a debounce that elapsed does. */
    due(): void
    stop(): void
}

const loops: Loop[] = []

afterEach(() => {
    for (const loop of loops) {
        loop.stop()
    }
    loops.length = 0
})

function mergeBack(live: toSaveType, snapshot: toSaveType): void {
    for (const chaId of snapshot.character) {
        if (!live.character.includes(chaId)) {
            live.character.push(chaId)
        }
    }
    for (const pair of snapshot.chat) {
        if (!live.chat.some(([a, b]) => a === pair[0] && b === pair[1])) {
            live.chat.push(pair)
        }
    }
    live.botPreset ||= snapshot.botPreset
    live.modules ||= snapshot.modules
    live.loadouts ||= snapshot.loadouts
    live.plugins ||= snapshot.plugins
    live.pluginCustomStorage ||= snapshot.pluginCustomStorage
}

async function startLoop(db: Database, options: Partial<Store2StartOptions> = {}): Promise<Loop> {
    const kit = await startStore2({ db, ...options })
    return runLoop(kit, db)
}

function runLoop(kit: Store2Kit, db: Database): Loop {
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    let held: Promise<void> | null = null
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const reloadFlag = { state: false }
    const loop: Loop = {
        kit, db, tracker, reloadFlag,
        state: { due: false, dirty: false, saved: 0, saving: false, stopped: '', peerHeard: false, marks: 0, drafts: false },
        failures: [],
        uncounted: [],
        sleeps: [],
        holdSleeps() {
            let release: () => void = () => {}
            held = new Promise<void>((resolve) => { release = resolve })
            return () => {
                held = null
                release()
            }
        },
        savedThrows: null,
        unsavableCalls: [],
        order: [],
        merges: 0,
        unsavableThrows: null,
        broadcasts: [],
        crashed: [],
        mark(chaId) {
            tracker.character.push(chaId)
            loop.state.marks += 1
            loop.state.dirty = true
            loop.state.due = true
        },
        due() {
            loop.state.due = true
            loop.state.dirty = true
            loop.state.marks += 1
        },
        stop() {
            stopped = true
        },
    }
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag,
        getDatabase: () => loop.db,
        mergeBack(live, snapshot) {
            loop.merges += 1
            mergeBack(live, snapshot)
        },
        liveCheck: () => {},
        sweep: () => {},
        isDue: () => loop.state.due,
        isDirty: () => loop.state.dirty,
        hasDrafts: () => loop.state.drafts,
        beginIteration() {
            loop.state.saving = true
            loop.state.due = false
        },
        endIteration() {
            loop.state.saving = false
        },
        snapshotTaken() {
            loop.state.dirty = false
        },
        requestPass() {
            loop.state.dirty = true
            loop.state.marks += 1
            loop.state.due = true
        },
        unsavable(current, newly) {
            loop.order.push('unsavable')
            loop.unsavableCalls.push({ current: [...current], newly: [...newly] })
            if (loop.unsavableThrows !== null) {
                throw loop.unsavableThrows
            }
        },
        saved() {
            loop.order.push('saved')
            if (loop.savedThrows !== null) {
                const error = loop.savedThrows
                loop.savedThrows = null
                throw error
            }
            loop.state.saved += 1
        },
        broadcast(epoch) {
            loop.broadcasts.push(epoch)
        },
        peerHeard() {
            const heard = loop.state.peerHeard
            loop.state.peerHeard = false
            return heard
        },
        setStopped(reason) {
            loop.state.stopped = reason
        },
        reportFailure(error, attempts) {
            loop.failures.push({ error, attempts })
            return 1
        },
        reportUncountedFailure(error, attempts) {
            loop.uncounted.push({ error, attempts })
            return 1
        },
        async withWriteLock(run) {
            const before = tail
            let release: () => void = () => {}
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            try {
                return await run()
            } finally {
                release()
            }
        },
        wait: idle,
        sleep: (ms) => {
            loop.sleeps.push(ms)
            return held === null ? idle() : held.then(idle)
        },
        sleepForever: () => new Promise<never>(() => {}),
        now: () => Date.now(),
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        loop.crashed.push(error)
    })
    loops.push(loop)
    return loop
}

async function savedBy(loop: Loop, count = 1): Promise<void> {
    await until(() => loop.state.saved >= count, `${count} saved pass(es)`, 4000)
}

const healthy = (loop: Loop) => expect(loop.crashed).toEqual([])

describe('new behaviour: a pass commits what it carries and says so', () => {
    test('a marked edit lands in the store, the epoch is broadcast, and the acknowledged encoding moved', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[0].personality = 'a new personality'
        loop.mark(chaIdOf(db, 0))
        await savedBy(loop)
        const saved = await loop.kit.saved()
        expect((saved.characters[0] as unknown as Entry).personality).toBe('a new personality')
        expect(loop.broadcasts).toEqual([(await loop.kit.commitKey()).epoch])
        // The next pass is a plain commit over the new base: no park, no failure.
        chars(db)[1].personality = 'a second edit'
        loop.mark(chaIdOf(db, 1))
        await savedBy(loop, 2)
        expect((await loop.kit.saved()).characters[1]).toMatchObject({ personality: 'a second edit' })
        expect(loop.failures).toEqual([])
        expect(loop.kit.peer.asked).toEqual([])
        expect(loop.kit.peer.clean).toEqual([])
        healthy(loop)
    })

    // New behaviour: a throw after the commit landed is not a failed save pass, so it is told without counting and records no failure.
    test('reproducer: a throw after a commit landed is reported uncounted with the fixed escalation and records no failure', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        const boom = new Error('bookkeeping after the commit')
        loop.savedThrows = boom
        chars(db)[0].personality = 'a landed edit'
        loop.mark(chaIdOf(db, 0))
        await until(() => loop.uncounted.length >= 1, 'the uncounted failure report', 4000)
        expect((await loop.kit.saved()).characters[0]).toMatchObject({ personality: 'a landed edit' })
        expect(loop.uncounted[0]).toEqual({ error: boom, attempts: 5 })
        expect(loop.failures).toEqual([])
        healthy(loop)
    })

    test('a pass that changed nothing writes nothing and still reports saved', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        loop.mark(chaIdOf(db, 0))
        await savedBy(loop)
        expect(loop.kit.counted.writeCalls()).toBe(0)
        expect(loop.broadcasts).toEqual([])
        healthy(loop)
    })

    test('an edit that no mark names is not written by a mark-only loop (the carried part is carried)', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[2].personality = 'unmarked'
        loop.mark(chaIdOf(db, 0))
        await savedBy(loop)
        expect(loop.kit.counted.writeCalls()).toBe(0)
        healthy(loop)
    })
})

describe('new behaviour: the full-reload flag and the module flag reach the encoder', () => {
    test('whole mode writes every resident character, and the flag is consumed by the snapshot', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[2].personality = 'whole edit'
        loop.reloadFlag.state = true
        loop.due()
        await savedBy(loop)
        expect((await loop.kit.saved()).characters[2]).toMatchObject({ personality: 'whole edit' })
        expect(loop.reloadFlag.state).toBe(false)
        healthy(loop)
    })

    test('a flagged module is written, an unflagged module edit is carried', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        ;(db.modules as unknown as Entry[])[1].description = 'unflagged module edit'
        loop.due()
        await savedBy(loop)
        expect(loop.kit.counted.writeCalls()).toBe(0)
        ;(db.modules as unknown as Entry[])[1].description = 'flagged module edit'
        loop.tracker.modules = true
        loop.due()
        await savedBy(loop, 2)
        expect(((await loop.kit.saved()).modules as unknown as Entry[])[1].description).toBe('flagged module edit')
        healthy(loop)
    })
})

describe('new behaviour: the idle net writes what no mark named', () => {
    // Guard: the character cadence is unchanged; the module half moved to saveLoopModuleCadence.test.ts (MC-372 1).
    test('guard: with the net on, an unmarked character edit is written within one cycle', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db, { idleNet: { intervalMs: 1 } })
        chars(db)[2].personality = 'unmarked edit'
        await until(async () => {
            const saved = await loop.kit.saved()
            return (saved.characters[2] as unknown as Entry).personality === 'unmarked edit'
        }, 'the idle net to write the character edit', 4000)
        healthy(loop)
    })

    test('guard: with the net off nothing runs a pass without a request', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db, { idleNet: null })
        chars(db)[2].personality = 'unmarked edit'
        await new Promise<void>((resolve) => setTimeout(resolve, 80))
        expect(loop.kit.counted.writeCalls()).toBe(0)
        expect(loop.state.saved).toBe(0)
        healthy(loop)
    })

    test('a tick that writes nothing neither reports saved nor fires callbacks', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db, { idleNet: { intervalMs: 1 } })
        await new Promise<void>((resolve) => setTimeout(resolve, 80))
        expect(loop.state.saved).toBe(0)
        expect(loop.kit.counted.writeCalls()).toBe(0)
        healthy(loop)
    })
})

describe('new behaviour: marks are kept for the pass that encodes them (O2)', () => {
    test('a character edited and marked during a pass is written by the next pass', async () => {
        const db = clone(buildSmall(4))
        let fired = false
        let loopRef: Loop | null = null
        const lists: ListDerivation = {
            ...fakeLists,
            characterAssets: (owner) => {
                // Called while the pass encodes the third character, after the first one's turn.
                if (!fired && String(owner.chaId) === chaIdOf(db, 2) && loopRef !== null) {
                    fired = true
                    chars(db)[0].personality = 'edited during the pass'
                    loopRef.mark(chaIdOf(db, 0))
                }
                return fakeLists.characterAssets(owner)
            },
        }
        const kit = await startStore2({ db, lists })
        const loop = runLoop(kit, db)
        loopRef = loop
        loop.reloadFlag.state = true
        loop.due()
        await savedBy(loop, 2)
        expect(fired).toBe(true)
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: 'edited during the pass' })
        healthy(loop)
    })
})

type Script = Array<(read: Store2Read, request: CommitRequest) => Promise<CommitResult>>

/** The kit's committer with its next commits scripted; once the script runs out it commits for real. */
function script(kit: Store2Kit, steps: Script): Committer {
    const real = kit.committer
    const scripted: Committer = {
        ...real,
        async commit(read, request) {
            const step = steps.shift()
            return step === undefined ? real.commit(read, request) : step(read, request)
        },
    }
    kit.context.session = { ...kit.context.session, committer: scripted }
    return scripted
}

describe('new behaviour: result mapping', () => {
    async function edited(options: Partial<Store2StartOptions> = {}): Promise<{ db: Database, kit: Store2Kit }> {
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db, ...options })
        return { db, kit }
    }

    test('flushed:false is a failed save the person is told about; the commit stays acknowledged and the next pass commits again', async () => {
        const { db, kit } = await edited()
        script(kit, [async (read, request) => {
            const result = await kit.committer.commit(read, request)
            return result.status === 'committed' ? { ...result, flushed: false } : result
        }])
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'durable edit'
        loop.mark(chaIdOf(db, 0))
        await until(() => loop.failures.length >= 1 && loop.state.saved >= 1, 'the failure report and the forced commit', 4000)
        expect(loop.failures[0].attempts).toBe(1)
        expect((loop.failures[0].error as Error).name).toBe('Store2NotFlushedError')
        // The landed commit was broadcast, and the forced second commit is a fresh manifest even though nothing changed.
        expect(loop.broadcasts).toHaveLength(2)
        expect(kit.counted.writes.filter(write => write.call === 'commitOrdinary' && write.key === 'store2-commit')).toHaveLength(2)
        // Never a park: the acknowledged encoding followed the landed commit.
        expect(kit.peer.asked).toEqual([])
        expect(kit.peer.clean).toEqual([])
        expect(loop.state.stopped).toBe('')
        healthy(loop)
    })

    test('a commit with flushed:false does not count as saved and does not fire the callbacks', async () => {
        const { db, kit } = await edited()
        let releaseThird = (): void => {}
        const third = new Promise<void>((resolve) => {
            releaseThird = resolve
        })
        script(kit, [async (read, request) => {
            const result = await kit.committer.commit(read, request)
            return result.status === 'committed' ? { ...result, flushed: false } : result
        }, async (read, request) => {
            const result = await kit.committer.commit(read, request)
            return result.status === 'committed' ? { ...result, flushed: false } : result
        }, async (read, request) => {
            // The retry after the second report would commit flushed and count as saved. It waits here until the
            // assertions ran, so they do not depend on how long the retry's sleep takes against the poll interval.
            await third
            return kit.committer.commit(read, request)
        }])
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'durable edit'
        loop.mark(chaIdOf(db, 0))
        await until(() => loop.failures.length >= 2, 'two failure reports', 4000)
        expect(loop.state.saved).toBe(0)
        expect(loop.failures.map(failure => failure.attempts)).toEqual([1, 2])
        releaseThird()
        healthy(loop)
    })

    test('a conflict that shows this page\'s own manifest still current is retried, not parked', async () => {
        const { db, kit } = await edited()
        script(kit, [async () => ({ status: 'conflict', current: await kit.committer.readCommit() })])
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'retried edit'
        loop.mark(chaIdOf(db, 0))
        await savedBy(loop)
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: 'retried edit' })
        expect(loop.failures).toEqual([])
        expect(kit.peer.asked).toEqual([])
        expect(loop.state.stopped).toBe('')
        healthy(loop)
    })

    test.each([
        ['failed with a backend failure', async () => ({ status: 'failed', cause: new Store2BackendFailureError('down') }) as CommitResult],
        ['refused for a bad unit set', async () => ({ status: 'refused', reason: 'bad-unit-set', detail: 'x' }) as CommitResult],
    ])('%s: reported with its attempt count, the marks come back, and the next pass saves', async (_label, step) => {
        const { db, kit } = await edited()
        script(kit, [step])
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'second try'
        loop.mark(chaIdOf(db, 0))
        await savedBy(loop)
        expect(loop.failures).toHaveLength(1)
        expect(loop.failures[0].attempts).toBe(1)
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: 'second try' })
        expect(loop.state.stopped).toBe('')
        healthy(loop)
    })

    test.each([
        ['a marker-present refusal', async () => ({ status: 'refused', reason: 'marker-present', detail: 'x' }) as CommitResult],
        ['an abandoned bulk with no cause', async () => ({ status: 'abandoned', reason: 'marker-lost', cleared: null }) as CommitResult],
    ])('guard: a single %s is retried quietly and the next pass saves', async (_label, step) => {
        const { db, kit } = await edited()
        script(kit, [step])
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'after one retry'
        loop.mark(chaIdOf(db, 0))
        await savedBy(loop)
        expect(loop.failures).toEqual([])
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: 'after one retry' })
        healthy(loop)
    })

    test.each([
        ['marker-present', async () => ({ status: 'refused', reason: 'marker-present', detail: 'a marker stands' }) as CommitResult],
        ['marker-lost', async () => ({ status: 'abandoned', reason: 'marker-lost', cleared: null }) as CommitResult],
        ['rejudge-exhausted', async () => ({ status: 'abandoned', reason: 'rejudge-exhausted', cleared: null }) as CommitResult],
    ])('a persistent %s run is reported through the failure path, counted, with the marks kept', async (_label, step) => {
        const { db, kit } = await edited()
        script(kit, Array.from({ length: 6 }, () => step))
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'blocked then saved'
        loop.mark(chaIdOf(db, 0))
        await until(() => loop.failures.length >= 2, 'the escalation', 4000)
        expect((loop.failures[0].error as Error).name).toBe('Store2CommitRefusedError')
        expect(loop.failures.map(failure => failure.attempts).slice(0, 2)).toEqual([1, 2])
        await savedBy(loop)
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: 'blocked then saved' })
        healthy(loop)
    })

    test('a persistent conflict run is reported after the quiet retries', async () => {
        const { db, kit } = await edited()
        script(kit, Array.from({ length: 6 }, () => async () => ({ status: 'conflict', current: await kit.committer.readCommit() }) as CommitResult))
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'conflicted'
        loop.mark(chaIdOf(db, 0))
        await until(() => loop.failures.length >= 1, 'the escalation', 4000)
        expect(loop.failures[0].attempts).toBe(1)
        await savedBy(loop)
        healthy(loop)
    })

    test('an abandoned bulk with a backend cause is a failed save: reported and counted like a failure, never retried silently', async () => {
        const { db, kit } = await edited()
        script(kit, Array.from({ length: 6 }, () => async () => ({
            status: 'abandoned', reason: 'upload-failed', cleared: null, cause: new Store2BackendFailureError('QuotaExceededError: disk full'),
        }) as CommitResult))
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'told'
        loop.mark(chaIdOf(db, 0))
        await until(() => loop.failures.length >= 6, 'six reports', 4000)
        expect(loop.failures.map(failure => failure.attempts).slice(0, 6)).toEqual([1, 2, 3, 4, 5, 6])
        expect((loop.failures[0].error as Error).name).toBe('Store2BackendFailureError')
        await savedBy(loop)
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: 'told' })
        healthy(loop)
    })

    test('an abandoned bulk whose cause is a stale page parks as replaced and asks', async () => {
        const { db, kit } = await edited()
        script(kit, [async () => ({
            status: 'abandoned', reason: 'upload-failed', cleared: null, cause: new Store2StalePageError('a newer page registered'),
        }) as CommitResult])
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'unsaved'
        loop.mark(chaIdOf(db, 0))
        await until(() => kit.peer.asked.length === 1, 'the prompt', 4000)
        expect(kit.peer.asked[0]).toMatchObject({ reason: 'replaced', offers: ['reload'] })
        expect(loop.failures).toEqual([])
        healthy(loop)
    })

    describe('a marker-present refusal whose own-marker clear comes to a stale page', () => {
        /**
         * The kit's committer whose base read carries a standing bulk marker of this page load, whose commits are scripted
         * and whose clear answers `clear`. `clears` counts the clears the loop asked for.
         */
        function withOwnMarker(kit: Store2Kit, steps: Script, clear: (read: Store2Read) => Promise<AbandonResult>): { clears: number } {
            const real = kit.committer
            const seen = { clears: 0 }
            const scripted: Committer = {
                ...real,
                async readCommit() {
                    const read = await real.readCommit()
                    const parsed = classifyCommitRead(read)
                    // The marker stands only while scripted commits remain: once they run out the real committer sees a plain base.
                    if (parsed.status !== 'parsed' || steps.length === 0) {
                        return read
                    }
                    const marked: CommitKey = { ...parsed.value, staging: { owner: real.owner, prefix: 'store2/g-0000000000000001-', startedAt: 1, label: 'bulk' } }
                    return { ...read, bytes: encodeUnit(UNIT_TYPE.commit, marked) }
                },
                async commit(read, request) {
                    const step = steps.shift()
                    return step === undefined ? real.commit(read, request) : step(read, request)
                },
                async abandonClear(read) {
                    seen.clears += 1
                    return clear(read)
                },
            }
            kit.context.session = { ...kit.context.session, committer: scripted }
            return seen
        }

        const markerPresent = async () => ({ status: 'refused', reason: 'marker-present', detail: 'a marker stands' }) as CommitResult

        test.each([
            ['failed', 'reworded cause one', (cause: Store2StalePageError): AbandonResult => ({ status: 'failed', cause })],
            ['unknown', 'a different wording', (cause: Store2StalePageError): AbandonResult => ({ status: 'unknown', cause })],
        ])('reproducer: a clear that %s with a stale page cause parks as replaced and asks, never retried', async (_label, message, result) => {
            const { db, kit } = await edited()
            const seen = withOwnMarker(kit, Array.from({ length: 8 }, () => markerPresent), async () => result(new Store2StalePageError(message)))
            const loop = runLoop(kit, db)
            chars(db)[0].personality = 'unsaved'
            loop.mark(chaIdOf(db, 0))
            await until(() => kit.peer.asked.length === 1, 'the replaced prompt', 4000)
            expect(kit.peer.asked[0]).toMatchObject({ reason: 'replaced', offers: ['reload'] })
            expect(loop.failures).toEqual([])
            expect(seen.clears).toBe(1)
            healthy(loop)
        })

        test('guard: a clear that fails for another backend reason keeps the quiet retry and the next pass saves', async () => {
            const { db, kit } = await edited()
            withOwnMarker(kit, [markerPresent], async () => ({ status: 'failed', cause: new Store2BackendFailureError('down') }))
            const loop = runLoop(kit, db)
            chars(db)[0].personality = 'after the retry'
            loop.mark(chaIdOf(db, 0))
            await savedBy(loop)
            expect(kit.peer.asked).toEqual([])
            expect(loop.failures).toEqual([])
            healthy(loop)
        })

        test('guard: a cleared marker is retried and the next pass saves', async () => {
            const { db, kit } = await edited()
            withOwnMarker(kit, [markerPresent], async (read) => {
                const parsed = classifyCommitRead(read)
                if (parsed.status !== 'parsed') {
                    throw new Error('The base read is not a commit key.')
                }
                return { status: 'cleared', value: parsed.value, bytes: read.bytes as Uint8Array }
            })
            const loop = runLoop(kit, db)
            chars(db)[0].personality = 'after the clear'
            loop.mark(chaIdOf(db, 0))
            await savedBy(loop)
            expect(kit.peer.asked).toEqual([])
            expect(loop.failures).toEqual([])
            healthy(loop)
        })
    })

    describe('the real committer over a bulk pass', () => {
        const BULK_ROWS = 80

        function editEverything(db: Database, loop: Loop): void {
            for (const entry of chars(db)) {
                entry.personality = `${String(entry.personality)} edited`
            }
            loop.reloadFlag.state = true
            loop.due()
        }

        test('a unit upload that fails with a quota-style error is reported, and the data stays marked', async () => {
            const db = clone(buildSmall(BULK_ROWS))
            let armed = false
            const kit = await startStore2({
                db,
                hooks: {
                    before: (name) => {
                        if (armed && name === 'putUnit') {
                            throw new Store2BackendFailureError('QuotaExceededError: disk full')
                        }
                    },
                },
            })
            armed = true
            const loop = runLoop(kit, db)
            editEverything(db, loop)
            await until(() => loop.failures.length >= 2, 'the reports', 8000)
            expect(loop.failures.map(failure => failure.attempts).slice(0, 2)).toEqual([1, 2])
            expect(loop.state.saved).toBe(0)
            // The whole pass is still owed and the page is still dirty.
            await until(() => loop.reloadFlag.state && loop.state.dirty, 'the owed whole pass and the dirty page after the fold-back', 4000)
            healthy(loop)
        })

        test('a stale page during a bulk upload parks as replaced and asks', async () => {
            const db = clone(buildSmall(BULK_ROWS))
            let armed = false
            const kit = await startStore2({
                db,
                hooks: {
                    before: (name) => {
                        if (armed && name === 'putUnit') {
                            throw new Store2StalePageError('a newer page registered')
                        }
                    },
                },
            })
            armed = true
            const loop = runLoop(kit, db)
            editEverything(db, loop)
            await until(() => kit.peer.asked.length === 1, 'the prompt', 8000)
            expect(loop.state.stopped).toBe('replaced')
            expect(kit.peer.asked[0]).toMatchObject({ reason: 'replaced', offers: ['reload'] })
            expect(loop.failures).toEqual([])
            healthy(loop)
        })

        /** A marker left standing by a bulk that never finished: its build never returns. */
        async function leaveMarker(kit: Store2Kit, by: Committer): Promise<void> {
            void by.commit(await by.readCommit(), {
                newUnits: 100,
                label: 'bulk',
                build: () => new Promise(() => {}),
            })
            await until(async () => (await kit.commitKey()).staging !== null, 'the marker', 4000)
        }

        test('this page load\'s own marker that an earlier bulk left standing is cleared through the library and the bulk then lands', async () => {
            const db = clone(buildSmall(BULK_ROWS))
            const kit = await startStore2({ db })
            await leaveMarker(kit, kit.committer)
            const loop = runLoop(kit, db)
            editEverything(db, loop)
            await savedBy(loop)
            expect((await kit.commitKey()).staging).toBeNull()
            expect((await kit.saved()).characters[0]).toMatchObject({ personality: expect.stringContaining('edited') })
            expect(loop.failures).toEqual([])
            healthy(loop)
        })

        test('a foreign marker stays: the persistent refusal is reported and the data stays marked', async () => {
            const db = clone(buildSmall(BULK_ROWS))
            const kit = await startStore2({ db })
            await leaveMarker(kit, createCommitter(kit.memory, { owner: 'peer-page' }))
            const loop = runLoop(kit, db)
            editEverything(db, loop)
            await until(() => loop.failures.length >= 1, 'the report', 8000)
            expect((loop.failures[0].error as Error).name).toBe('Store2CommitRefusedError')
            expect((await kit.commitKey()).staging?.owner).toBe('peer-page')
            expect(loop.state.saved).toBe(0)
            await until(() => loop.reloadFlag.state, 'the owed whole pass after the fold-back', 4000)
            healthy(loop)
        })
    })

    test.each(['absent', 'no-current', 'damaged', 'too-new'] as const)('refused %s parks the page as replaced: reload is the only offer', async (reason) => {
        const { db, kit } = await edited()
        script(kit, [async () => ({ status: 'refused', reason, detail: 'x' })])
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'unsaved'
        loop.mark(chaIdOf(db, 0))
        await until(() => kit.peer.asked.length === 1, 'the prompt', 4000)
        expect(loop.state.stopped).toBe('replaced')
        expect(kit.peer.asked[0]).toMatchObject({ reason: 'replaced', unsaved: true, offers: ['reload'], saveMineUnavailable: 'replaced' })
        expect(loop.state.saved).toBe(0)
        healthy(loop)
    })

    test('a stale page (the Tauri gate) parks as replaced rather than retrying', async () => {
        const { db, kit } = await edited()
        script(kit, [async () => ({ status: 'failed', cause: new Store2StalePageError('a newer page registered') })])
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'unsaved'
        loop.mark(chaIdOf(db, 0))
        await until(() => kit.peer.asked.length === 1, 'the prompt', 4000)
        expect(kit.peer.asked[0].reason).toBe('replaced')
        expect(loop.failures).toEqual([])
        healthy(loop)
    })

    test('an unknown outcome is reported and kept as pending; the next base read that shows it current adopts it, and a pass that reverts it commits', async () => {
        const { db, kit } = await edited()
        script(kit, [async (read, request) => {
            // The write lands and its response is lost.
            await kit.committer.commit(read, request)
            return { status: 'unknown', cause: new Store2UnknownOutcomeError('lost') }
        }])
        const loop = runLoop(kit, db)
        const original = chars(db)[0].personality
        // The retry sleeps right after the report and reads the base only afterwards, so holding the sleep keeps it from
        // adopting the landed commit before the revert below.
        const release = loop.holdSleeps()
        chars(db)[0].personality = 'landed edit'
        loop.mark(chaIdOf(db, 0))
        await until(() => loop.failures.length === 1, 'the report of the unknown outcome', 4000)
        // The page reverts the edit before the retry: the retry must write the revert over the adopted commit.
        chars(db)[0].personality = original
        release()
        await savedBy(loop)
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: original })
        expect(kit.peer.asked).toEqual([])
        expect(kit.peer.clean).toEqual([])
        expect(loop.state.stopped).toBe('')
        healthy(loop)
    })
})

describe('new behaviour: a peer\'s commit parks the page and the person decides', () => {
    async function startPeerWorld(options: Partial<Store2StartOptions> = {}): Promise<{ db: Database, kit: Store2Kit, loop: Loop }> {
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db, ...options })
        return { db, kit, loop: runLoop(kit, db) }
    }

    async function parkedDirty(options: Partial<Store2StartOptions> = {}) {
        const world = await startPeerWorld(options)
        await peerCommit(world.kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        chars(world.db)[0].personality = 'my edit'
        world.loop.mark(chaIdOf(world.db, 0))
        await until(() => world.kit.peer.asked.length >= 1, 'the prompt', 4000)
        return world
    }

    test('non-Node with unsaved edits: Reload is first and the default, Save mine is offered', async () => {
        const { kit, loop } = await parkedDirty()
        expect(kit.peer.asked[0]).toMatchObject({ reason: 'peer-commit', unsaved: true, offers: ['reload', 'save-mine'] })
        expect(kit.peer.asked[0].saveMineUnavailable).toBeUndefined()
        await until(() => kit.peer.reloads === 1, 'the reload', 4000)
        expect(loop.state.saved).toBe(0)
        // Nothing was written over the peer's commit.
        expect(kit.counted.writeCalls()).toBe(0)
        healthy(loop)
    })

    test('Node with unsaved edits: Reload or export this tab first; Save mine is never offered', async () => {
        const { kit, loop } = await parkedDirty({ kind: 'node' })
        expect(kit.peer.asked[0]).toMatchObject({ unsaved: true, offers: ['reload', 'export-first'], saveMineUnavailable: 'node' })
        expect(kit.peer.asked[0].offers).not.toContain('save-mine')
        healthy(loop)
    })

    test('a page with nothing unsaved is told once and nothing is asked', async () => {
        const { kit, loop } = await startPeerWorld()
        await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        loop.state.peerHeard = true
        await until(() => kit.peer.clean.length === 1, 'the notice', 4000)
        await new Promise<void>((resolve) => setTimeout(resolve, 60))
        expect(kit.peer.clean).toHaveLength(1)
        expect(kit.peer.clean[0]).toMatchObject({ reason: 'peer-commit', unsaved: false, offers: ['reload'] })
        expect(kit.peer.asked).toEqual([])
        healthy(loop)
    })

    test('Node with nothing unsaved: only reload, with the Node reason', async () => {
        const { kit, loop } = await startPeerWorld({ kind: 'node' })
        await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        loop.state.peerHeard = true
        await until(() => kit.peer.clean.length === 1, 'the notice', 4000)
        expect(kit.peer.clean[0]).toMatchObject({ offers: ['reload'], saveMineUnavailable: 'node' })
        healthy(loop)
    })

    test('a parked clean page that gains an edit is asked once', async () => {
        const { db, kit, loop } = await startPeerWorld()
        await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        loop.state.peerHeard = true
        await until(() => kit.peer.clean.length === 1, 'the notice', 4000)
        chars(db)[0].personality = 'late edit'
        loop.mark(chaIdOf(db, 0))
        await until(() => kit.peer.asked.length === 1, 'the prompt', 4000)
        await new Promise<void>((resolve) => setTimeout(resolve, 60))
        expect(kit.peer.asked).toHaveLength(1)
        expect(kit.peer.asked[0].offers).toEqual(['reload', 'save-mine'])
        healthy(loop)
    })

    test('the clean prompt\'s live state reads the park, the dirty flag and the drafts when it is called: a tab that gains an edit after the notice ends in the unsaved question', async () => {
        const { db, kit, loop } = await startPeerWorld()
        await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        loop.state.peerHeard = true
        await until(() => kit.peer.clean.length === 1, 'the notice', 4000)
        expect(kit.peer.live).toHaveLength(1)
        expect(kit.peer.live[0]()).toEqual({ parked: true, dirty: false, drafts: false })
        loop.state.drafts = true
        expect(kit.peer.live[0]()).toEqual({ parked: true, dirty: false, drafts: true })
        loop.state.drafts = false
        chars(db)[0].personality = 'late edit'
        loop.mark(chaIdOf(db, 0))
        // The state handed over earlier now sees the edit, so a Reload pressed on the clean prompt would do nothing.
        expect(kit.peer.live[0]()).toMatchObject({ parked: true, dirty: true })
        // The loop's next settle asks with the unsaved wording: `asked` was still false after the clean notice.
        await until(() => kit.peer.asked.length === 1, 'the unsaved question', 4000)
        expect(kit.peer.asked[0]).toMatchObject({ unsaved: true, offers: ['reload', 'save-mine'] })
        healthy(loop)
    })

    test('Save mine overwrites the peer commit: the store holds this page\'s whole state afterwards', async () => {
        const peer: PeerDouble = createPeerDouble('save-mine')
        const { db, kit, loop } = await parkedDirty({ peer })
        await savedBy(loop)
        const saved = await kit.saved()
        expect((saved.characters[0] as unknown as Entry).personality).toBe('my edit')
        // The peer's edit is gone: Save mine is consent to overwrite, and it rewrote this page's state.
        expect((saved.characters[3] as unknown as Entry).personality).toBe((chars(db)[3]).personality)
        expect(kit.peer.reloads).toBe(0)
        healthy(loop)
    })

    test('Save mine\'s consent covers the epoch asked about only: a commit made while the question was open is asked about again', async () => {
        const peer: PeerDouble = createPeerDouble('save-mine')
        let release: () => void = () => {}
        peer.hold = new Promise<void>((resolve) => { release = resolve })
        const world = await startPeerWorld({ peer })
        await peerCommit(world.kit, (peerDb) => { chars(peerDb)[3].personality = 'first peer edit' })
        chars(world.db)[0].personality = 'my edit'
        world.loop.mark(chaIdOf(world.db, 0))
        await until(() => peer.asked.length === 1, 'the first prompt', 4000)
        // A newer commit lands while the person is still deciding.
        await peerPin(world.kit)
        release()
        await until(() => peer.asked.length === 2, 'the second prompt', 4000)
        expect(peer.asked[1].offers).toEqual(['reload', 'save-mine'])
        healthy(world.loop)
    })

    test('export-first on Node reports the request with this page\'s manifest key and then reloads', async () => {
        const peer = createPeerDouble('export-first')
        const { kit, loop } = await parkedDirty({ kind: 'node', peer })
        await until(() => kit.peer.reloads === 1, 'the reload after the export', 4000)
        expect(kit.peer.exports).toEqual([kit.seeded.manifestKey])
        healthy(loop)
    })

    test('an export that fails tells the person and the page asks again: Reload or export stays available', async () => {
        const peer = createPeerDouble('export-first')
        peer.exportFails = true
        const { kit, loop } = await parkedDirty({ kind: 'node', peer })
        await until(() => loop.uncounted.length >= 1, 'the failure report', 4000)
        expect(kit.peer.reloads).toBe(0)
        expect(loop.uncounted[0].attempts).toBeGreaterThan(4)
        expect(loop.failures).toHaveLength(0)
        peer.exportFails = false
        await until(() => kit.peer.reloads === 1, 'the second question and the reload after a working export', 4000)
        expect(kit.peer.asked.length).toBeGreaterThanOrEqual(2)
        expect(kit.peer.asked[kit.peer.asked.length - 1].offers).toEqual(['reload', 'export-first'])
        healthy(loop)
    })

    // Guard (passes before and after): the reload follows an export that resolved 'saved' (the handler resolves after the person's answer).
    test('guard: export-first reloads only after the export has resolved saved, never while it is pending', async () => {
        const peer = createPeerDouble('export-first')
        let release: () => void = () => {}
        peer.exportHold = new Promise<void>((resolve) => { release = resolve })
        const { kit, loop } = await parkedDirty({ kind: 'node', peer })
        await until(() => kit.peer.exports.length === 1, 'the export request', 4000)
        await new Promise<void>((resolve) => setTimeout(resolve, 150))
        expect(kit.peer.reloads).toBe(0)
        release()
        await until(() => kit.peer.reloads === 1, 'the reload after the export resolved', 4000)
        healthy(loop)
    })

    // New behaviour: a declined export is a cancel, not a failed save.
    test('reproducer: a declined export does not reload, asks again and raises no failure; a later saved export reloads', async () => {
        const peer = createPeerDouble('export-first')
        peer.exportResult = 'declined'
        const { kit, loop } = await parkedDirty({ kind: 'node', peer })
        await until(() => kit.peer.asked.length >= 2, 'the second question', 4000)
        expect(kit.peer.reloads).toBe(0)
        expect(loop.failures).toHaveLength(0)
        expect(kit.peer.asked[kit.peer.asked.length - 1].offers).toEqual(['reload', 'export-first'])
        peer.exportResult = 'saved'
        await until(() => kit.peer.reloads === 1, 'the reload after a saved export', 4000)
        healthy(loop)
    })

    // New behaviour: a peer handler that throws is not a save attempt, so it is told without counting and records no failure.
    test('reproducer: a peer decide that throws is reported uncounted, records no failure, and the question is asked again', async () => {
        const peer = createPeerDouble('reload')
        const answer = peer.decide.bind(peer)
        const boom = new Error('the prompt could not be shown')
        let thrown = false
        peer.decide = async (prompt) => {
            if (!thrown) {
                thrown = true
                throw boom
            }
            return answer(prompt)
        }
        const world = await startPeerWorld({ peer })
        await peerCommit(world.kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        chars(world.db)[0].personality = 'my edit'
        world.loop.mark(chaIdOf(world.db, 0))
        await until(() => world.loop.uncounted.length >= 1, 'the uncounted failure report', 4000)
        expect(world.loop.uncounted[0].error).toBe(boom)
        expect(world.loop.failures).toEqual([])
        await until(() => world.kit.peer.asked.length >= 1, 'the question asked again', 4000)
        healthy(world.loop)
    })

    // Guard (passes before and after): a failed export was already told by its writer, so the loop adds no second alert and asks again.
    test('guard: a failed export does not reload, asks again and reports nothing through either failure path; a later saved export reloads', async () => {
        const peer = createPeerDouble('export-first')
        peer.exportResult = 'failed'
        const { kit, loop } = await parkedDirty({ kind: 'node', peer })
        await until(() => kit.peer.asked.length >= 2, 'the second question', 4000)
        expect(kit.peer.reloads).toBe(0)
        expect(loop.failures).toHaveLength(0)
        expect(loop.uncounted).toHaveLength(0)
        peer.exportResult = 'saved'
        await until(() => kit.peer.reloads === 1, 'the reload after a saved export', 4000)
        healthy(loop)
    })

    test('a parked page unparks when a peer announces and the base is this page\'s own again', async () => {
        const { db, kit, loop } = await (async () => {
            const world = await startPeerWorld()
            return world
        })()
        // The seed manifest enters `retained` only when the previous `current` is old enough.
        kit.clock.advance(6 * 60 * 1000)
        await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        loop.state.peerHeard = true
        await until(() => kit.peer.clean.length === 1, 'the notice', 4000)
        const peerCommitter = createCommitter(kit.memory, { owner: 'peer-page' })
        const restored = await peerCommitter.restore(await peerCommitter.readCommit(), kit.seeded.manifestKey)
        expect(restored.status).toBe('committed')
        loop.state.peerHeard = true
        await until(() => loop.state.stopped === '' && kit.peer.clean.length === 1, 'the recheck', 4000)
        // The clean prompt still on screen reads the unpark: its Reload must do nothing.
        await until(() => !kit.peer.live[0]().parked, 'the unpark', 4000)
        chars(db)[0].personality = 'after the restore'
        loop.mark(chaIdOf(db, 0))
        await savedBy(loop)
        expect(kit.peer.asked).toEqual([])
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: 'after the restore' })
        healthy(loop)
    })

    test('a page parked as replaced unparks when a peer announces and the base still names this page\'s manifest', async () => {
        const { db, kit } = await (async () => {
            const db = clone(buildSmall(4))
            return { db, kit: await startStore2({ db }) }
        })()
        let announce: () => void = () => {}
        script(kit, [async () => {
            announce()
            return { status: 'refused', reason: 'absent', detail: 'x' }
        }])
        const loop = runLoop(kit, db)
        announce = () => { loop.state.peerHeard = true }
        chars(db)[0].personality = 'kept'
        loop.mark(chaIdOf(db, 0))
        await savedBy(loop)
        expect(kit.peer.asked).toEqual([])
        expect(loop.state.stopped).toBe('')
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: 'kept' })
        healthy(loop)
    })

    test('a failed whole pass restores the full-reload flag: the next pass is whole again', async () => {
        const { db, kit } = await (async () => {
            const db = clone(buildSmall(4))
            return { db, kit: await startStore2({ db }) }
        })()
        script(kit, [async () => ({ status: 'failed', cause: new Store2BackendFailureError('down') })])
        const loop = runLoop(kit, db)
        // No mark names this edit: only a whole pass writes it.
        chars(db)[2].personality = 'whole edit'
        loop.reloadFlag.state = true
        loop.due()
        await until(() => loop.failures.length === 1, 'the failure', 4000)
        await savedBy(loop)
        expect((await kit.saved()).characters[2]).toMatchObject({ personality: 'whole edit' })
        healthy(loop)
    })

    test('persistent flushed:false backs off after the fifth report instead of recommitting every second', async () => {
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db })
        script(kit, Array.from({ length: 9 }, () => async (read: Store2Read, request: CommitRequest) => {
            const result = await kit.committer.commit(read, request)
            return result.status === 'committed' ? { ...result, flushed: false } : result
        }))
        const loop = runLoop(kit, db)
        chars(db)[0].personality = 'unconfirmed'
        loop.mark(chaIdOf(db, 0))
        await until(() => loop.failures.length >= 9, 'nine reports', 8000)
        // reportFailure answers 1 ms here; the sixth report onward doubles the wait.
        expect(loop.sleeps.slice(0, 9)).toEqual([1, 1, 1, 1, 1, 2, 4, 8, 16])
        healthy(loop)
    })

    test('guard: backedOffWait leaves the first five waits alone, doubles after, and is capped', () => {
        expect([1, 2, 3, 4, 5].map(attempt => backedOffWait(1000, attempt))).toEqual([1000, 1000, 1000, 1000, 1000])
        expect(backedOffWait(1000, 6)).toBe(2000)
        expect(backedOffWait(1000, 7)).toBe(4000)
        expect(backedOffWait(1000, 40)).toBe(60_000)
    })

    test('a peer\'s pin changes the epoch and not the current manifest: it does not park the page', async () => {
        const { db, kit, loop } = await startPeerWorld()
        chars(db)[0].personality = 'saved before a pin'
        loop.mark(chaIdOf(db, 0))
        await savedBy(loop, 1)
        await peerPin(kit)
        loop.state.peerHeard = true
        chars(db)[1].personality = 'saved after a pin'
        loop.mark(chaIdOf(db, 1))
        await savedBy(loop, 2)
        const saved = await kit.saved()
        expect(saved.characters[0]).toMatchObject({ personality: 'saved before a pin' })
        expect(saved.characters[1]).toMatchObject({ personality: 'saved after a pin' })
        expect(kit.peer.asked).toEqual([])
        expect(kit.peer.clean).toEqual([])
        healthy(loop)
    })

    test('a peer commit that lands between the base read and this page\'s commit is a real conflict: the page parks and writes nothing', async () => {
        let armed = false
        let fired = false
        const holder: { kit: Store2Kit | null } = { kit: null }
        const db = clone(buildSmall(4))
        const kit = await startStore2({
            db,
            hooks: {
                before: async (name) => {
                    if (armed && !fired && name === 'commitOrdinary' && holder.kit !== null) {
                        fired = true
                        await peerCommit(holder.kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
                    }
                },
            },
        })
        holder.kit = kit
        const loop = runLoop(kit, db)
        armed = true
        chars(db)[0].personality = 'my edit'
        loop.mark(chaIdOf(db, 0))
        await until(() => kit.peer.asked.length >= 1, 'the prompt', 4000)
        expect(fired).toBe(true)
        expect(kit.peer.asked[0]).toMatchObject({ reason: 'peer-commit', unsaved: true, offers: ['reload', 'save-mine'] })
        expect(loop.state.saved).toBe(0)
        expect(loop.failures).toEqual([])
        const saved = await kit.saved()
        expect((saved.characters[0] as unknown as Entry).personality).not.toBe('my edit')
        expect((saved.characters[3] as unknown as Entry).personality).toBe('the peer edit')
        healthy(loop)
    })

    test('Save mine with a stub is offered only while the base still names this page\'s manifest', async () => {
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db })
        const live = clone(db)
        const source = JSON.parse(JSON.stringify(chars(live)[1])) as Entry
        chars(live)[1] = buildColdStub(source as unknown as character, 'unit-key', ['chat-a']) as unknown as Entry
        const loop = runLoop(kit, live)
        // The seed manifest is dropped from the base: 21 peer commits, each at least admission-interval apart.
        for (let round = 0; round < 22; round++) {
            kit.clock.advance(6 * 60 * 1000)
            await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = `peer ${round}` }, 100 + round)
        }
        chars(live)[0].personality = 'my edit'
        loop.mark(chaIdOf(live, 0))
        await until(() => kit.peer.asked.length === 1, 'the prompt', 4000)
        expect(kit.peer.asked[0]).toMatchObject({ offers: ['reload'], saveMineUnavailable: 'unloaded-characters' })
        healthy(loop)
    })
})

describe('new behaviour: a pending attempt is resolved against the base before the plan (F2)', () => {
    test('the adopted attempt is the base the next plan is made over: its acknowledgement does not throw and nothing parks', async () => {
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db })
        script(kit, [async (read, request) => {
            await kit.committer.commit(read, request)
            return { status: 'unknown', cause: new Store2UnknownOutcomeError('lost') }
        }])
        const loop = runLoop(kit, db)
        const original = chars(db)[0].personality
        // Held so the retry cannot adopt the landed commit before the revert (see the unknown-outcome test above).
        const release = loop.holdSleeps()
        chars(db)[0].personality = 'landed edit'
        loop.mark(chaIdOf(db, 0))
        await until(() => loop.failures.length === 1, 'the report', 4000)
        chars(db)[0].personality = original
        release()
        await savedBy(loop)
        // The revert was committed over the adopted commit, so a plan made over the adopted base was acknowledged.
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: original })
        // A plan made before the adoption would be acknowledged against a moved encoding and fail loudly.
        expect(loop.failures).toHaveLength(1)
        expect(kit.peer.asked).toEqual([])
        expect(kit.peer.clean).toEqual([])
        // The next ordinary pass commits over what the revert wrote, with no park.
        chars(db)[1].personality = 'after the revert'
        loop.mark(chaIdOf(db, 1))
        await savedBy(loop, 2)
        expect((await kit.saved()).characters[1]).toMatchObject({ personality: 'after the revert' })
        healthy(loop)
    })
})

describe('new behaviour: a stub that shares its id with a resident character', () => {
    function sharedWorld(): { db: Database, stub: Entry, resident: Entry } {
        const db = clone(buildSmall(4))
        const full = JSON.parse(JSON.stringify(chars(db)[1])) as Entry
        return { db, stub: buildColdStub(full as unknown as character, 'unit-key', ['chat-a']) as unknown as Entry, resident: full }
    }

    test('the stub is loaded through the loader and the pass is retried once', async () => {
        const { db, stub, resident } = sharedWorld()
        const kit0 = await startStore2({ db })
        const live = clone(db)
        chars(live)[1] = stub
        chars(live).push(JSON.parse(JSON.stringify(resident)) as Entry)
        const loaded: string[] = []
        kit0.context.loadStub = async (chaId) => {
            loaded.push(chaId)
            chars(live)[1] = resident
            return true
        }
        const loop = runLoop(kit0, live)
        chars(live)[0].personality = 'saved with the retry'
        loop.mark(chaIdOf(live, 0))
        await savedBy(loop)
        expect(loaded).toEqual([chaIdOf(db, 1)])
        expect((await kit0.saved()).characters[0]).toMatchObject({ personality: 'saved with the retry' })
        expect(loop.failures).toEqual([])
        healthy(loop)
    })

    test('a stub that cannot be loaded keeps the save blocked and the person is told, pass after pass', async () => {
        const { db, stub, resident } = sharedWorld()
        const kit0 = await startStore2({ db })
        const live = clone(db)
        chars(live)[1] = stub
        chars(live).push(JSON.parse(JSON.stringify(resident)) as Entry)
        let calls = 0
        kit0.context.loadStub = async () => {
            calls += 1
            return false
        }
        const loop = runLoop(kit0, live)
        chars(live)[0].personality = 'blocked'
        loop.mark(chaIdOf(live, 0))
        await until(() => loop.failures.length >= 2, 'two reports', 4000)
        expect((loop.failures[0].error as Error).name).toBe('SharedChaIdStubError')
        expect(loop.failures.map(failure => failure.attempts).slice(0, 2)).toEqual([1, 2])
        expect(calls).toBeGreaterThanOrEqual(2)
        expect(loop.state.saved).toBe(0)
        expect(kit0.counted.writeCalls()).toBe(0)
        healthy(loop)
    })

    test('without a loader the save is blocked the same way', async () => {
        const { db, stub, resident } = sharedWorld()
        const kit0 = await startStore2({ db })
        const live = clone(db)
        chars(live)[1] = stub
        chars(live).push(JSON.parse(JSON.stringify(resident)) as Entry)
        const loop = runLoop(kit0, live)
        loop.mark(chaIdOf(live, 0))
        await until(() => loop.failures.length >= 1, 'a report', 4000)
        expect((loop.failures[0].error as Error).name).toBe('SharedChaIdStubError')
        healthy(loop)
    })
})

describe('new behaviour: a stub that names units its entry no longer holds', () => {
    /** A live list whose second character is a stub naming something other than its entity. */
    function foreignStubWorld(): { db: Database, live: Database, resident: Entry } {
        const db = clone(buildSmall(4))
        const live = clone(db)
        const resident = JSON.parse(JSON.stringify(chars(db)[1])) as Entry
        chars(live)[1] = buildColdStub(resident as unknown as character, 'a-key-the-entry-does-not-name', ['chat-a']) as unknown as Entry
        return { db, live, resident }
    }

    test('the stub is loaded through the loader and the pass is retried once', async () => {
        const { db, live, resident } = foreignStubWorld()
        const kit = await startStore2({ db })
        const loaded: string[] = []
        kit.context.loadStub = async (chaId) => {
            loaded.push(chaId)
            chars(live)[1] = resident
            return true
        }
        const loop = runLoop(kit, live)
        chars(live)[0].personality = 'saved with the retry'
        loop.mark(chaIdOf(live, 0))
        await savedBy(loop)
        expect(loaded).toEqual([chaIdOf(db, 1)])
        expect((await kit.saved()).characters[0]).toMatchObject({ personality: 'saved with the retry' })
        expect(loop.failures).toEqual([])
        healthy(loop)
    })

    test('a chat pointer is not loadable that way: the refusal stands and the loader is not asked', async () => {
        const db = clone(buildSmall(4))
        const live = clone(db)
        ;((chars(live)[1].chats as Entry[])[0].message as Entry[])[0].data = 'COLDSTORAGEsome-key'
        const kit = await startStore2({ db })
        let asked = 0
        kit.context.loadStub = async () => {
            asked += 1
            return true
        }
        const loop = runLoop(kit, live)
        loop.mark(chaIdOf(live, 1))
        await until(() => loop.failures.length >= 1, 'a report', 4000)
        expect((loop.failures[0].error as Error).name).toBe('StubRefusedError')
        expect(asked).toBe(0)
        healthy(loop)
    })

    test('a stub that cannot be loaded keeps the save blocked, and without a loader the refusal is reported as it is', async () => {
        const { db, live } = foreignStubWorld()
        const kit = await startStore2({ db })
        let calls = 0
        kit.context.loadStub = async () => {
            calls += 1
            return false
        }
        const loop = runLoop(kit, live)
        loop.mark(chaIdOf(live, 0))
        await until(() => loop.failures.length >= 1, 'a report', 4000)
        expect((loop.failures[0].error as Error).name).toBe('StubRefusedError')
        expect(calls).toBeGreaterThanOrEqual(1)
        expect(loop.state.saved).toBe(0)
        expect(kit.counted.writeCalls()).toBe(0)
        healthy(loop)

        const { db: db2, live: live2 } = foreignStubWorld()
        const bare = await startStore2({ db: db2 })
        const bareLoop = runLoop(bare, live2)
        bareLoop.mark(chaIdOf(live2, 0))
        await until(() => bareLoop.failures.length >= 1, 'a report', 4000)
        expect((bareLoop.failures[0].error as Error).name).toBe('StubRefusedError')
        healthy(bareLoop)
    })
})

describe('new behaviour: the loop saves through the encoder the context carries', () => {
    test('a pass moves the carried encoder\'s acknowledged encoding, and the one the loop would have made stays out of it', async () => {
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db })
        const encoder = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
        const before = encoder.manifestKey
        kit.context.encoder = encoder
        const live = clone(db)
        const loop = runLoop(kit, live)
        chars(live)[1].personality = 'saved through the carried encoder'
        loop.mark(chaIdOf(live, 1))
        await savedBy(loop)
        expect(encoder.manifestKey).not.toBe(before)
        expect((await kit.saved()).characters[1]).toMatchObject({ personality: 'saved through the carried encoder' })
        healthy(loop)
    })
})

describe('new behaviour: a character that cannot be saved is skipped, noticed once, and retried quietly', () => {
    function cyclic(): Entry {
        const value: Entry = {}
        value.self = value
        return value
    }

    interface Counted {
        loop: Loop
        /** The base reads so far: one per pass, a tick included. */
        passes(): number
    }

    async function startCounted(db: Database): Promise<Counted> {
        const kit = await startStore2({ db, idleNet: { intervalMs: 1 } })
        const real = kit.committer
        let passes = 0
        kit.context.session = { ...kit.context.session, committer: { ...real, readCommit: () => { passes++; return real.readCommit() } } }
        return { loop: runLoop(kit, db), passes: () => passes }
    }

    async function quietPasses(counted: Counted, count: number): Promise<void> {
        const before = counted.passes()
        await until(() => counted.passes() >= before + count, `${count} more passes`, 4000)
    }

    function noticesOf(loop: Loop): UnsavableCharacter[][] {
        return loop.unsavableCalls.filter(call => call.newly.length > 0).map(call => call.newly)
    }

    test('new behaviour: the rest is saved, the saved character keeps its last copy, one notice, and nothing is reported as a failure', async () => {
        const db = clone(buildSmall(4))
        const counted = await startCounted(db)
        const { loop } = counted
        const original = chars(db)[1].personality
        chars(db)[1].personality = cyclic()
        chars(db)[2].personality = 'edited next to the unsavable one'
        loop.mark(chaIdOf(db, 1))
        loop.mark(chaIdOf(db, 2))
        await until(() => loop.unsavableCalls.length >= 1, 'the unsavable report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the unsavable one' })
        expect(saved.characters[1]).toMatchObject({ personality: original })

        const marks = loop.state.marks
        await quietPasses(counted, 10)
        expect(loop.failures).toEqual([])
        expect(loop.uncounted).toEqual([])
        expect(loop.sleeps).toEqual([])
        // No extra pass is requested and no mark is put back for the character.
        expect(loop.state.marks).toBe(marks)
        expect(loop.merges).toBe(0)
        expect(loop.unsavableCalls).toHaveLength(1)
        expect(loop.unsavableCalls[0].newly.map(({ chaId, saved }) => ({ chaId, saved }))).toEqual([{ chaId: chaIdOf(db, 1), saved: true }])
        expect(loop.unsavableCalls[0].current.map(({ chaId }) => chaId)).toEqual([chaIdOf(db, 1)])
        // The port hears about it before the commit callbacks run.
        expect(loop.order.slice(0, 2)).toEqual(['unsavable', 'saved'])
        healthy(loop)
    })

    test('new behaviour: a fix clears the set, and a new break is a new notice', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db, { idleNet: { intervalMs: 1 } })
        const id1 = chaIdOf(db, 1)
        chars(db)[1].personality = cyclic()
        loop.mark(id1)
        await until(() => loop.unsavableCalls.length >= 1, 'the first report', 4000)

        chars(db)[1].personality = 'fixed'
        loop.mark(id1)
        await until(() => loop.unsavableCalls.length >= 2, 'the report that clears it', 4000)
        expect(loop.unsavableCalls[1].current).toEqual([])
        expect(loop.unsavableCalls[1].newly).toEqual([])
        expect((await loop.kit.saved()).characters[1]).toMatchObject({ personality: 'fixed' })

        chars(db)[1].personality = cyclic()
        loop.mark(id1)
        await until(() => loop.unsavableCalls.length >= 3, 'the second notice', 4000)
        expect(noticesOf(loop).map(newly => newly.map(({ chaId }) => chaId))).toEqual([[id1], [id1]])
        expect(loop.failures).toEqual([])
        healthy(loop)
    })

    test('new behaviour: a character that was never saved is left out, noticed as never saved, and stays out of the store', async () => {
        const db = clone(buildSmall(4))
        const counted = await startCounted(db)
        const { loop } = counted
        chars(db).push({ ...JSON.parse(JSON.stringify(chars(db)[0])) as Entry, chaId: 'never-saved-character', name: 'Never saved', personality: cyclic() })
        chars(db)[2].personality = 'edited next to the new one'
        loop.mark(chaIdOf(db, 2))
        const marksAfterMark = loop.state.marks
        await until(() => loop.unsavableCalls.length >= 1, 'the unsavable report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters).toHaveLength(4)
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the new one' })
        await quietPasses(counted, 10)
        expect(loop.failures).toEqual([])
        // The skipped character asks for no further pass and no mark is put back for it.
        expect(loop.state.marks).toBe(marksAfterMark)
        expect(loop.merges).toBe(0)
        expect(loop.unsavableCalls).toHaveLength(1)
        expect(loop.unsavableCalls[0].newly.map(({ chaId, saved: held }) => ({ chaId, saved: held }))).toEqual([{ chaId: 'never-saved-character', saved: false }])
        healthy(loop)
    })

    test('new behaviour: a character deleted with no replacement leaves the set', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db, { idleNet: null })
        chars(db)[1].personality = cyclic()
        loop.mark(chaIdOf(db, 1))
        await until(() => loop.unsavableCalls.length >= 1, 'the unsavable report', 4000)
        chars(db).splice(1, 1)
        loop.due()
        await until(() => loop.unsavableCalls.length >= 2, 'the report after the deletion', 4000)
        expect(loop.unsavableCalls[1].current).toEqual([])
        expect(loop.unsavableCalls[1].newly).toEqual([])
        healthy(loop)
    })

    test('new behaviour: a not-flushed commit that skipped a saved character still reports it once', async () => {
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db, idleNet: null })
        script(kit, [async (read, request) => {
            const result = await kit.committer.commit(read, request)
            return result.status === 'committed' ? { ...result, flushed: false } : result
        }])
        const loop = runLoop(kit, db)
        const original = chars(db)[1].personality
        chars(db)[1].personality = cyclic()
        chars(db)[2].personality = 'edited next to it'
        loop.mark(chaIdOf(db, 2))
        loop.mark(chaIdOf(db, 1))
        await until(() => loop.failures.length >= 1 && loop.state.saved >= 1, 'the not-flushed report and the forced commit', 4000)
        // Passes that do not name the offender must not be what reports it.
        for (let i = 0; i < 3; i++) {
            loop.due()
            await new Promise(resolve => setTimeout(resolve, 60))
        }
        const stored = await loop.kit.saved()
        expect(stored.characters[1]).toMatchObject({ personality: original })
        expect(stored.characters[2]).toMatchObject({ personality: 'edited next to it' })
        expect(loop.failures.map(failure => (failure.error as Error).name)).toEqual(['Store2NotFlushedError'])
        expect(noticesOf(loop)).toHaveLength(1)
        expect(loop.unsavableCalls[0].newly.map(({ chaId, saved }) => ({ chaId, saved }))).toEqual([{ chaId: chaIdOf(db, 1), saved: true }])
        healthy(loop)
    })

    test('new behaviour: the idle net alone reports a break nothing marked and clears a fix nothing marked', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db, { idleNet: { intervalMs: 1, backstopMs: 0 } })
        const original = chars(db)[1].personality
        await new Promise(resolve => setTimeout(resolve, 50))
        chars(db)[1].personality = cyclic()
        await until(() => loop.unsavableCalls.length >= 1, 'a tick report of the break', 4000)
        expect(loop.unsavableCalls[0].newly.map(({ chaId }) => chaId)).toEqual([chaIdOf(db, 1)])
        chars(db)[1].personality = original
        await until(() => loop.unsavableCalls.length >= 2, 'a tick report of the fix', 4000)
        expect(loop.unsavableCalls[1].current).toEqual([])
        expect(loop.failures).toEqual([])
        healthy(loop)
    })

    test('a character deleted while its pass commits gets no notice', async () => {
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db })
        script(kit, [async (read, request) => {
            chars(db).splice(1, 1)
            return kit.committer.commit(read, request)
        }])
        const loop = runLoop(kit, db)
        chars(db)[1].personality = cyclic()
        chars(db)[2].personality = 'edited during the same pass'
        loop.mark(chaIdOf(db, 1))
        loop.mark(chaIdOf(db, 2))
        await savedBy(loop)
        expect(loop.unsavableCalls).toEqual([])
        healthy(loop)
    })

    test('an attempt that does not save tells the port nothing, and the notice comes with the attempt that saves', async () => {
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db })
        script(kit, [async () => ({ status: 'refused', reason: 'marker-present', detail: 'x' }) as CommitResult])
        const loop = runLoop(kit, db)
        const release = loop.holdSleeps()
        chars(db)[1].personality = cyclic()
        chars(db)[2].personality = 'edited during the retry'
        loop.mark(chaIdOf(db, 1))
        loop.mark(chaIdOf(db, 2))
        await until(() => loop.sleeps.length >= 1, 'the quiet retry', 4000)
        expect(loop.unsavableCalls).toEqual([])
        release()
        await until(() => loop.unsavableCalls.length >= 1, 'the report after the retry saved', 4000)
        await savedBy(loop)
        expect(noticesOf(loop)).toHaveLength(1)
        expect(loop.failures).toEqual([])
        healthy(loop)
    })

    test('a port whose notice throws does not turn the pass that saved into a failed one', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db, { idleNet: null })
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            loop.unsavableThrows = new Error('the notice failed')
            chars(db)[1].personality = cyclic()
            chars(db)[2].personality = 'edited next to it'
            loop.mark(chaIdOf(db, 1))
            loop.mark(chaIdOf(db, 2))
            await savedBy(loop)
            expect(loop.failures).toEqual([])
            expect(loop.uncounted).toEqual([])
            expect(logged).toHaveBeenCalledWith(loop.unsavableThrows)
            expect((await loop.kit.saved()).characters[2]).toMatchObject({ personality: 'edited next to it' })
        } finally {
            logged.mockRestore()
        }
        healthy(loop)
    })

    test('guard (passes before and after): a bad value outside a character still fails the pass and is reported', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db, { idleNet: null })
        ;(db.botPresets as unknown as Entry[])[1].temperature = cyclic()
        loop.reloadFlag.state = true
        loop.due()
        await until(() => loop.failures.length >= 1, 'the failure report', 4000)
        expect(loop.unsavableCalls).toEqual([])
        expect(loop.state.saved).toBe(0)
    })
})

describe('guard: the loop does not start without a committer', () => {
    test('a context whose session has no committer is refused', async () => {
        const db = clone(buildSmall(2))
        const kit = await startStore2({ db })
        const orphan = { ...kit.context, session: { kind: kit.context.session.kind, committer: null } }
        const never = vi.fn()
        await expect(runStore2SaveLoop(orphan, { getDatabase: never } as unknown as Store2LoopPort)).rejects.toThrow('no-committer')
    })
})
