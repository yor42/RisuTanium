// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Store2PayloadTooLargeError, Store2UnknownOutcomeError } from '../../store2/backend'
import { UNIT_TYPE } from '../../store2/format'
import type { CommitResult, Committer } from '../../store2/commit'
import { runStore2SaveLoop, PARK_CHECK_MAX_MS, type ParkCheck, type Store2LoopPort } from '../../store2/saveLoop'
import { buildColdStub } from '../../../process/coldCharacter'
import type { Database, character } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { peerCommit, startStore2, type Store2Kit, type Store2StartOptions } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The Reload check and the unlanded-tick mark of the store2 save loop, over a real memory backend and committer with a
 * hand-built port. The edits are synthetic and unmarked (no field producer is known). Labels in the titles: reproducer
 * (fails without the change), guard (passes before and after).
 */

type Entry = Record<string, unknown>

const clone = (db: Database): Database => JSON.parse(JSON.stringify(db)) as Database
const chars = (db: Database): Entry[] => db.characters as unknown as Entry[]
const cyclic = (): Entry => {
    const value: Entry = {}
    value.self = value
    return value
}

interface Loop {
    kit: Store2Kit
    db: Database
    state: { dirty: boolean, peerHeard: boolean }
    markedUnsaved: number
    /** While set, `markUnsaved` is counted but leaves the page clean: isolates the check from the unlanded-tick mark. */
    ignoreMarks: boolean
    /** How many times the loop told the port about unsavable characters. */
    unsavableCalls: number
    stopCalls: string[]
    sleeps: number[]
    /** While set, the loop's yield inside the check never returns. */
    stallYield: boolean
    /** Settles the pending sleep of `PARK_CHECK_MAX_MS`, as the deadline elapsing would. */
    elapseDeadline(): void
}

const stoppers: Array<() => void> = []

afterEach(() => {
    for (const stop of stoppers) {
        stop()
    }
    stoppers.length = 0
})

function runLoop(kit: Store2Kit, db: Database): Loop {
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    let deadline: () => void = () => { }
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const loop: Loop = {
        kit, db,
        state: { dirty: false, peerHeard: false },
        markedUnsaved: 0,
        ignoreMarks: false,
        unsavableCalls: 0,
        stopCalls: [],
        sleeps: [],
        stallYield: false,
        elapseDeadline: () => deadline(),
    }
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => loop.db,
        mergeBack: () => { },
        liveCheck: () => { },
        sweep: () => { },
        isDue: () => false,
        isDirty: () => loop.state.dirty,
        markUnsaved: () => {
            loop.markedUnsaved += 1
            loop.state.dirty = !loop.ignoreMarks
        },
        hasDrafts: () => false,
        beginIteration: () => { },
        endIteration: () => { },
        snapshotTaken: () => { loop.state.dirty = false },
        requestPass: () => { loop.state.dirty = true },
        unsavable: () => { loop.unsavableCalls += 1 },
        saved: () => { },
        broadcast: () => { },
        peerHeard() {
            const heard = loop.state.peerHeard
            loop.state.peerHeard = false
            return heard
        },
        setStopped: (reason) => { loop.stopCalls.push(reason) },
        notifyTooLarge: () => { },
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
        sleep(ms) {
            loop.sleeps.push(ms)
            if (ms === PARK_CHECK_MAX_MS) {
                return new Promise<void>((resolve) => { deadline = resolve })
            }
            return idle()
        },
        sleepForever: () => new Promise<never>(() => { }),
        yieldNow: () => loop.stallYield ? new Promise<void>(() => { }) : Promise.resolve(),
        now: () => Date.now(),
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => { console.error(error) })
    stoppers.push(() => { stopped = true })
    return loop
}

/** The kit is seeded from one database; the loop runs over a copy that `prepare` may change before the loop starts. */
async function start(options: Partial<Store2StartOptions> = {}, prepare?: (db: Database, kit: Store2Kit) => void): Promise<Loop> {
    const seeded = clone(buildSmall(4))
    const kit = await startStore2({ db: seeded, ...options })
    const live = clone(seeded)
    prepare?.(live, kit)
    return runLoop(kit, live)
}

/** A peer commits and this tab hears it: the loop parks and shows the clean prompt. */
async function parkOnPeer(loop: Loop): Promise<void> {
    await peerCommit(loop.kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
    loop.state.peerHeard = true
    await until(() => loop.kit.peer.clean.length + loop.kit.peer.asked.length >= 1, 'a prompt', 8000)
}

function press(loop: Loop): Promise<ParkCheck> {
    return loop.kit.peer.requests[0]()
}

async function untilUnsavedAsked(loop: Loop): Promise<void> {
    await until(() => loop.kit.peer.asked.length >= 1, 'the unsaved question', 8000)
    expect(loop.kit.peer.asked[0]).toMatchObject({ unsaved: true })
    expect(loop.kit.peer.reloads).toBe(0)
}

function scriptCommit(kit: Store2Kit, result: CommitResult): void {
    const real = kit.committer
    const scripted: Committer = { ...real, commit: async () => result }
    kit.context.session = { ...kit.context.session, committer: scripted }
}

const holdAnswer = (loop: Loop): void => {
    loop.kit.peer.hold = new Promise<void>(() => { })
}

describe('guard: a clean resident set is judged clean', () => {
    test.each(['tauri', 'node'] as const)('%s: the check says clean, marks nothing, asks nothing and exports nothing', async (kind) => {
        const loop = await start({ kind })
        await parkOnPeer(loop)
        expect(await press(loop)).toBe('clean')
        expect(loop.markedUnsaved).toBe(0)
        expect(loop.kit.peer.asked).toEqual([])
        expect(loop.kit.peer.autoExports).toEqual([])
    })
})

describe('reproducer (mechanism, synthetic unmarked state): what the check cannot call clean is dirty, marks the page and brings the unsaved question', () => {
    test('an edit no mark saw', async () => {
        const loop = await start()
        holdAnswer(loop)
        await parkOnPeer(loop)
        chars(loop.db)[0].personality = 'an edit no mark saw'
        expect(await press(loop)).toBe('dirty')
        expect(loop.markedUnsaved).toBe(1)
        await untilUnsavedAsked(loop)
    })

    test('a character the acknowledged encoding does not hold (unheld)', async () => {
        const loop = await start()
        holdAnswer(loop)
        await parkOnPeer(loop)
        const extra = clone(loop.db).characters[0] as unknown as Entry
        extra.chaId = 'a-new-character-no-mark-saw'
        chars(loop.db).push(extra)
        expect(await press(loop)).toBe('dirty')
        await untilUnsavedAsked(loop)
    })

    test('a stub that needs a full pass', async () => {
        const loop = await start({}, (db) => {
            const source = JSON.parse(JSON.stringify(chars(db)[1])) as Entry
            chars(db)[1] = buildColdStub(source as unknown as character, 'a-key-the-entry-does-not-name', ['chat-a']) as unknown as Entry
        })
        holdAnswer(loop)
        await parkOnPeer(loop)
        expect(await press(loop)).toBe('dirty')
        await untilUnsavedAsked(loop)
    })

    test('an unsavable character (MC-570)', async () => {
        const loop = await start({ idleNet: { intervalMs: 1, backstopMs: 0 } })
        holdAnswer(loop)
        await new Promise((resolve) => setTimeout(resolve, 50))
        chars(loop.db)[1].personality = cyclic()
        await until(() => loop.unsavableCalls >= 1, 'the net to report the break', 4000)
        await parkOnPeer(loop)
        loop.state.dirty = false
        expect(await press(loop)).toBe('dirty')
    })

    test('an attempt whose outcome is unknown and still pending after the base read', async () => {
        let attempted = false
        const loop = await start({ idleNet: { intervalMs: 1, backstopMs: 0 } }, (_db, kit) => {
            const real = kit.committer
            const scripted: Committer = {
                ...real,
                async commit(read, request) {
                    if (attempted) {
                        return real.commit(read, request)
                    }
                    attempted = true
                    // The write lands, a peer commits on top of it, and the response is lost: our attempt is pending and is not the base.
                    await real.commit(read, request)
                    await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
                    return { status: 'unknown', cause: new Store2UnknownOutcomeError('The response was lost.') }
                },
            }
            kit.context.session = { ...kit.context.session, committer: scripted }
        })
        loop.ignoreMarks = true
        holdAnswer(loop)
        await new Promise((resolve) => setTimeout(resolve, 50))
        chars(loop.db)[0].personality = 'an edit the net found'
        await until(() => loop.kit.peer.clean.length >= 1, 'the clean prompt', 4000)
        expect(await press(loop)).toBe('dirty')
    })

    test('a check that outlives PARK_CHECK_MAX_MS counts as dirty (controlled deadline)', async () => {
        const loop = await start()
        holdAnswer(loop)
        await parkOnPeer(loop)
        loop.stallYield = true
        const answer = press(loop)
        await until(() => loop.sleeps.includes(PARK_CHECK_MAX_MS), 'the deadline to be armed', 4000)
        loop.elapseDeadline()
        expect(await answer).toBe('dirty')
        expect(loop.markedUnsaved).toBe(1)
        await untilUnsavedAsked(loop)
    })
})

describe('reproducer (mechanism): a tick that ended in a stop keeps the page unsaved', () => {
    test('the idle net found an unmarked edit dirty and the commit was refused as too large', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const refusal = new Store2PayloadTooLargeError('The Node server answered 413.', 'store2/example', 3 * 1024 * 1024, UNIT_TYPE.chatChunk)
        const loop = await start({ idleNet: { intervalMs: 1, backstopMs: 0 } }, (_db, kit) => {
            scriptCommit(kit, { status: 'failed', cause: refusal })
        })
        await new Promise((resolve) => setTimeout(resolve, 50))
        chars(loop.db)[0].personality = 'an edit no mark saw'
        await until(() => loop.stopCalls.includes('too-large'), 'the stop', 4000)
        expect(loop.state.dirty).toBe(true)
        expect(loop.markedUnsaved).toBeGreaterThanOrEqual(1)
    })
})

describe('guard: presses made before the loop serves one share its answer', () => {
    test('two presses before the loop serves one get the same verdict', async () => {
        const loop = await start()
        await parkOnPeer(loop)
        const request = loop.kit.peer.requests[0]
        const [first, second] = await Promise.all([request(), request()])
        expect([first, second]).toEqual(['clean', 'clean'])
    })
})

describe('reproducer: the pending-attempt read at the Reload press', () => {
    test('a park whose base turns out to be our own pending attempt is answered moved and unparks, with no unsaved question', async () => {
        let attempted = false
        let absentOnce = false
        const loop = await start({ idleNet: { intervalMs: 1, backstopMs: 0 } }, (_db, kit) => {
            const real = kit.committer
            const scripted: Committer = {
                ...real,
                async readCommit() {
                    const read = await real.readCommit()
                    if (absentOnce) {
                        absentOnce = false
                        // A read that cannot be parsed as a base (torn or absent): the loop parks as replaced.
                        return { ...read, bytes: null }
                    }
                    return read
                },
                async commit(read, request) {
                    if (attempted) {
                        return real.commit(read, request)
                    }
                    attempted = true
                    // The write lands and the response is lost: our attempt is pending and IS the base.
                    await real.commit(read, request)
                    absentOnce = true
                    return { status: 'unknown', cause: new Store2UnknownOutcomeError('The response was lost.') }
                },
            }
            kit.context.session = { ...kit.context.session, committer: scripted }
        })
        loop.ignoreMarks = true
        holdAnswer(loop)
        await new Promise((resolve) => setTimeout(resolve, 50))
        chars(loop.db)[0].personality = 'an edit the net found'
        await until(() => loop.kit.peer.clean.length >= 1, 'the clean prompt', 4000)
        expect(loop.stopCalls).toContain('replaced')
        loop.ignoreMarks = false
        loop.state.dirty = false
        const before = loop.stopCalls.length
        expect(await press(loop)).toBe('moved')
        expect(loop.stopCalls.slice(before)).toContain('')
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(loop.kit.peer.asked).toEqual([])
        expect(loop.markedUnsaved).toBe(0)
    })
})

describe('reproducer: a request still waiting when the park ends', () => {
    test('a press waiting for the loop is answered moved when the peer read unparks the page first', async () => {
        let absentOnce = false
        const loop = await start({ idleNet: { intervalMs: 1, backstopMs: 0 } }, (_db, kit) => {
            const real = kit.committer
            const scripted: Committer = {
                ...real,
                async readCommit() {
                    const read = await real.readCommit()
                    if (absentOnce) {
                        absentOnce = false
                        return { ...read, bytes: null }
                    }
                    return read
                },
            }
            kit.context.session = { ...kit.context.session, committer: scripted }
        })
        holdAnswer(loop)
        await new Promise((resolve) => setTimeout(resolve, 50))
        absentOnce = true
        await until(() => loop.kit.peer.clean.length >= 1, 'the clean prompt', 4000)
        expect(loop.stopCalls).toContain('replaced')
        // The press and the peer signal land together: the loop's peer read comes first and finds the base is ours.
        const answer = loop.kit.peer.requests[0]()
        loop.state.peerHeard = true
        const settled = await Promise.race([answer, new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 2000))])
        expect(settled).toBe('moved')
        expect(loop.stopCalls.at(-1)).toBe('')
    })
})
