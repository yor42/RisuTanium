// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Store2PayloadTooLargeError, Store2UnknownOutcomeError } from '../../store2/backend'
import { UNIT_TYPE } from '../../store2/format'
import type { CommitResult, Committer } from '../../store2/commit'
import { runStore2SaveLoop, PARK_CHECK_MAX_MS, type ParkCheck, type Store2LoopPort } from '../../store2/saveLoop'
import { createSaveEncoder, type SaveEncoder } from '../../store2/saveEncoder'
import { buildColdStub } from '../../../process/coldCharacter'
import { installCharacterSaveMarks, markCharacterForSave, resetCharacterSaveMarksForTest, type SaveMarkKind } from '../../characterSaveMarks'
import type { Database, character } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { peerCommit, startStore2, type Store2Kit, type Store2StartOptions } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The Reload check and the unlanded-tick mark of the store2 save loop, over a real memory backend and committer with a
 * hand-built port. The edits are synthetic and unmarked (no field producer is known). Labels in the titles: reproducer
 * (fails on the base for the defect itself), new behaviour (exercises the Reload request, which the base does not
 * have, so it cannot run there), guard (holds the clean path of the new request; it cannot run on the base either).
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
    /** The live tracker the real marks write into, as the page's `changeTracker`. */
    tracker: toSaveType
    /** The page's content flag: set by a `content` mark, `markUnsaved` and `requestPass`, cleared by the snapshot. */
    content: boolean
    /** How many marks (and requests for a pass) the page counted. */
    marks: number
    /** The mark path the real `installCharacterSaveMarks` reports to, as `saveTimeoutExecute` receives it. */
    schedule(kind?: SaveMarkKind): void
    markedUnsaved: number
    /** While set, `markUnsaved` is counted but leaves the page clean: isolates the check from the unlanded-tick mark. */
    ignoreMarks: boolean
    /** How many times the loop told the port about unsavable characters. */
    unsavableCalls: number
    stopCalls: string[]
    sleeps: number[]
    /** While set, the loop's yield inside the check never returns. */
    stallYield: boolean
    /** While set, a dirty page is due for a pass, as a page past its debounce is. */
    dueWhenDirty: boolean
    /** Settles the pending sleep of `PARK_CHECK_MAX_MS`, as the deadline elapsing would. */
    elapseDeadline(): void
}

const stoppers: Array<() => void> = []

afterEach(() => {
    for (const stop of stoppers) {
        stop()
    }
    stoppers.length = 0
    resetCharacterSaveMarksForTest()
})

function runLoop(kit: Store2Kit, db: Database): Loop {
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    let deadline: () => void = () => { }
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const loop: Loop = {
        kit, db,
        state: { dirty: false, peerHeard: false },
        tracker,
        content: false,
        marks: 0,
        // The page's `saveTimeoutExecute`: every dirty mark counts and dirties; only a `content` mark (and an absent kind) sets the flag.
        schedule(kind = 'content') {
            loop.marks += 1
            loop.state.dirty = true
            if (kind === 'content') {
                loop.content = true
            }
        },
        markedUnsaved: 0,
        ignoreMarks: false,
        unsavableCalls: 0,
        stopCalls: [],
        sleeps: [],
        stallYield: false,
        dueWhenDirty: false,
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
        isDue: () => loop.dueWhenDirty && loop.state.dirty,
        isDirty: () => loop.state.dirty,
        // A flag that outlives a cleared page (a test that resets `state.dirty`) does not count: the page's flag implies its dirt.
        contentState: () => ({ unsaved: loop.content && loop.state.dirty, marks: loop.marks }),
        markUnsaved: () => {
            loop.markedUnsaved += 1
            loop.state.dirty = !loop.ignoreMarks
            loop.content = !loop.ignoreMarks
        },
        hasDrafts: () => false,
        beginIteration: () => { },
        endIteration: () => { },
        snapshotTaken: () => {
            loop.state.dirty = false
            loop.content = false
        },
        requestPass: (content = true) => {
            loop.state.dirty = true
            loop.marks += 1
            if (content) {
                loop.content = true
            }
        },
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
    installCharacterSaveMarks({ tracker, schedule: (kind) => loop.schedule(kind) })
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => { console.error(error) })
    stoppers.push(() => { stopped = true })
    return loop
}

/**
 * The encoder the loop saves through, with the calls of the prompt's judgement counted. `kit.context.encoder` is read by
 * the loop when it starts, so this runs in `prepare`; `before` runs inside the first `verdictOf` and `netScan` call.
 */
interface Probe {
    encoder: SaveEncoder
    verdicts: number
    fronts: number
    /** Runs once, inside the next `verdictOf`. */
    onVerdict: (() => void) | null
    /** Throws once, from the next `netScan`. */
    netScanFails: boolean
}

function probeEncoder(kit: Store2Kit): Probe {
    const { previous, lists, env } = kit.context
    const encoder = createSaveEncoder({ previous, lists, env })
    kit.context.encoder = encoder
    const probe: Probe = { encoder, verdicts: 0, fronts: 0, onVerdict: null, netScanFails: false }
    const verdictOf = encoder.verdictOf.bind(encoder)
    encoder.verdictOf = (slot) => {
        probe.verdicts += 1
        const hook = probe.onVerdict
        probe.onVerdict = null
        hook?.()
        return verdictOf(slot)
    }
    const frontVerdictOf = encoder.frontVerdictOf.bind(encoder)
    encoder.frontVerdictOf = (db) => {
        probe.fronts += 1
        return frontVerdictOf(db)
    }
    const netScan = encoder.netScan.bind(encoder)
    encoder.netScan = (db) => {
        if (probe.netScanFails) {
            probe.netScanFails = false
            throw new Error('the scan failed once')
        }
        return netScan(db)
    }
    return probe
}

/** The kit is seeded from one database; the loop runs over a copy that `prepare` may change before the loop starts. */
async function start(options: Partial<Store2StartOptions> = {}, prepare?: (db: Database, kit: Store2Kit) => void, seed?: (db: Database) => void): Promise<Loop> {
    const seeded = clone(buildSmall(4))
    seed?.(seeded)
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

describe('new behaviour (synthetic unmarked state): what the check cannot call clean is dirty, marks the page and brings the unsaved question', () => {
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

describe('the Reload check counts messages, cards and settings, and leaves out view state (MC-2291, MC-2298)', () => {
    test('L1 reproducer: an unmarked chatPage-only difference is clean and marks nothing', async () => {
        const loop = await start()
        await parkOnPeer(loop)
        chars(loop.db)[0].chatPage = 7
        expect(await press(loop)).toBe('clean')
        expect(loop.markedUnsaved).toBe(0)
        expect(loop.kit.peer.asked).toEqual([])
    })

    test('L2 reproducer: an unmarked lastInteraction-only difference is clean and marks nothing', async () => {
        const loop = await start()
        await parkOnPeer(loop)
        chars(loop.db)[0].lastInteraction = 123_456
        expect(await press(loop)).toBe('clean')
        expect(loop.markedUnsaved).toBe(0)
    })

    test.each([
        ['L3 firstMsgIndex', (slot: Entry) => { slot.firstMsgIndex = 9 }],
        ['L4 trashTime', (slot: Entry) => { slot.trashTime = 777 }],
        ['L5 chatPage together with a card edit', (slot: Entry) => { slot.chatPage = 7; slot.personality = 'a card edit no mark saw' }],
    ])('guard: %s is dirty, marks the page and brings the unsaved question', async (_label, mutate) => {
        const loop = await start()
        holdAnswer(loop)
        await parkOnPeer(loop)
        mutate(chars(loop.db)[0])
        expect(await press(loop)).toBe('dirty')
        expect(loop.markedUnsaved).toBe(1)
        await untilUnsavedAsked(loop)
    })

    test('L6 guard: two residents sharing one chaId stay dirty for an unmarked card edit', async () => {
        const loop = await start({}, undefined, (db) => {
            chars(db)[2].chaId = chars(db)[1].chaId
            db.characterOrder = chars(db).map(slot => slot.chaId) as never
        })
        holdAnswer(loop)
        await parkOnPeer(loop)
        chars(loop.db)[1].personality = 'an edit on a shared id'
        expect(await press(loop)).toBe('dirty')
        await untilUnsavedAsked(loop)
    })

    test.each([
        ['F1 username', (db: Database) => { db.username = 'a username no mark saw' }],
        ['F2 a bot preset field', (db: Database) => { db.botPresets[0].temperature = 1 + (db.botPresets[0].temperature ?? 0) }],
        ['F3 characterOrder', (db: Database) => { db.characterOrder = [...db.characterOrder].reverse() as never }],
    ])('reproducer: an unmarked front edit (%s) is dirty at the press, so the edit is not lost on reload', async (_label, edit) => {
        const loop = await start()
        holdAnswer(loop)
        await parkOnPeer(loop)
        edit(loop.db)
        expect(await press(loop)).toBe('dirty')
        expect(loop.markedUnsaved).toBe(1)
        await untilUnsavedAsked(loop)
    })

    test('F1 reproducer: Save mine keeps the unmarked front edit', async () => {
        const loop = await start()
        loop.kit.peer.answer = 'save-mine'
        loop.dueWhenDirty = true
        await parkOnPeer(loop)
        loop.db.username = 'a username no mark saw'
        expect(await press(loop)).toBe('dirty')
        await until(async () => (await loop.kit.saved()).username === 'a username no mark saw', 'the saved username', 8000)
    })

    test('F6 reproducer: a database key whose read faults is dirty at the press', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const loop = await start()
        holdAnswer(loop)
        await parkOnPeer(loop)
        Object.defineProperty(loop.db, 'aKeyThatFaultsWhenRead', {
            enumerable: true,
            configurable: true,
            get() {
                throw new Error('an unreadable settings key')
            },
        })
        expect(await press(loop)).toBe('dirty')
        await untilUnsavedAsked(loop)
    })

    test('F7 reproducer: statics that cannot be read are dirty at the press and the loop survives', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const loop = await start()
        holdAnswer(loop)
        await parkOnPeer(loop)
        const record = loop.db as unknown as Record<string, unknown>
        record.statics = {
            toJSON() {
                throw new Error('statics that cannot be read')
            },
        }
        expect(await press(loop)).toBe('dirty')
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

describe('new behaviour: the pending-attempt read at the Reload press', () => {
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

describe('new behaviour: a request still waiting when the park ends', () => {
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

const chaIdAt = (db: Database, index: number): string => String(chars(db)[index].chaId)
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const sharedIdSeed = (db: Database): void => {
    chars(db)[2].chaId = chars(db)[1].chaId
    db.characterOrder = chars(db).map(slot => slot.chaId) as never
}
const chaIdSeed = (value: string | number) => (db: Database): void => {
    chars(db)[1].chaId = value
    db.characterOrder = chars(db).map(slot => slot.chaId) as never
}

/** The clean prompt is up, nothing asked: the state every prompt row below starts a mark from. */
async function cleanPrompt(loop: Loop): Promise<void> {
    holdAnswer(loop)
    await parkOnPeer(loop)
    expect(loop.kit.peer.clean.length).toBe(1)
    expect(loop.kit.peer.asked).toEqual([])
}

async function staysClean(loop: Loop): Promise<void> {
    await pause(150)
    expect(loop.kit.peer.clean.length).toBe(1)
    expect(loop.kit.peer.asked).toEqual([])
    expect(loop.kit.peer.reloads).toBe(0)
}

describe('the prompt judges the marked residents and the front by value (MC-2293, MC-2294, MC-2298)', () => {
    test('F5 guard: a no-change mark does not hide an unmarked settings edit from the prompt', async () => {
        const loop = await start()
        holdAnswer(loop)
        markCharacterForSave(chaIdAt(loop.db, 0))
        loop.db.username = 'a username no mark saw'
        await parkOnPeer(loop)
        await untilUnsavedAsked(loop)
        expect(loop.kit.peer.asked[0].offers).toContain('save-mine')
    })

    test('P10 reproducer: a mark that names no resident is judged clean, so the prompt is clean', async () => {
        const loop = await start()
        holdAnswer(loop)
        markCharacterForSave('no-such-character')
        await parkOnPeer(loop)
        await staysClean(loop)
    })

    test('P1 guard: a no-change mark on one of two residents sharing a chaId asks the unsaved question', async () => {
        const loop = await start({}, undefined, sharedIdSeed)
        holdAnswer(loop)
        markCharacterForSave(chaIdAt(loop.db, 1))
        await parkOnPeer(loop)
        await untilUnsavedAsked(loop)
    })

    test('P2 guard: a pending attempt that stays pending asks the unsaved question, before the front is judged', async () => {
        let attempted = false
        let probe: Probe | null = null
        const loop = await start({ idleNet: { intervalMs: 1, backstopMs: 0 } }, (_db, kit) => {
            probe = probeEncoder(kit)
            const real = kit.committer
            const scripted: Committer = {
                ...real,
                async commit(read, request) {
                    if (attempted) {
                        return real.commit(read, request)
                    }
                    attempted = true
                    await real.commit(read, request)
                    await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
                    return { status: 'unknown', cause: new Store2UnknownOutcomeError('The response was lost.') }
                },
            }
            kit.context.session = { ...kit.context.session, committer: scripted }
        })
        loop.ignoreMarks = true
        holdAnswer(loop)
        await pause(50)
        chars(loop.db)[0].personality = 'an edit the net found'
        await until(() => loop.kit.peer.clean.length >= 1, 'the clean prompt', 4000)
        loop.ignoreMarks = false
        markCharacterForSave(chaIdAt(loop.db, 1))
        await untilUnsavedAsked(loop)
        expect((probe as unknown as Probe).fronts).toBe(0)
    })

    test('P3 guard: an unsavable character asks the unsaved question', async () => {
        const loop = await start({ idleNet: { intervalMs: 1, backstopMs: 0 } })
        holdAnswer(loop)
        loop.ignoreMarks = true
        await pause(50)
        chars(loop.db)[1].personality = cyclic()
        await until(() => loop.unsavableCalls >= 1, 'the net to report the break', 4000)
        await parkOnPeer(loop)
        expect(loop.kit.peer.clean.length).toBe(1)
        loop.ignoreMarks = false
        markCharacterForSave(chaIdAt(loop.db, 0))
        await untilUnsavedAsked(loop)
    })

    test('P4 guard: a character the acknowledged encoding does not hold (unheld) asks the unsaved question, before the front is judged', async () => {
        let probe: Probe | null = null
        const loop = await start({}, (_db, kit) => { probe = probeEncoder(kit) })
        await cleanPrompt(loop)
        const extra = clone(loop.db).characters[0] as unknown as Entry
        extra.chaId = 'a-new-character-no-mark-saw'
        chars(loop.db).push(extra)
        markCharacterForSave(chaIdAt(loop.db, 0))
        await untilUnsavedAsked(loop)
        // An undecided page answers before the front encode runs: the cost of the judgement stays at the scan.
        expect((probe as unknown as Probe).fronts).toBe(0)
    })

    test('P5 guard: a stub that needs a full pass asks the unsaved question, before the front is judged', async () => {
        let probe: Probe | null = null
        const loop = await start({}, (db, kit) => {
            const source = JSON.parse(JSON.stringify(chars(db)[1])) as Entry
            chars(db)[1] = buildColdStub(source as unknown as character, 'a-key-the-entry-does-not-name', ['chat-a']) as unknown as Entry
            probe = probeEncoder(kit)
        })
        await cleanPrompt(loop)
        markCharacterForSave(chaIdAt(loop.db, 0))
        await untilUnsavedAsked(loop)
        expect((probe as unknown as Probe).fronts).toBe(0)
    })

    test('P6 guard: a judgement that outlives PARK_CHECK_MAX_MS asks the unsaved question and the page stays parked', async () => {
        const loop = await start()
        await cleanPrompt(loop)
        loop.stallYield = true
        markCharacterForSave(chaIdAt(loop.db, 0))
        await until(() => loop.sleeps.includes(PARK_CHECK_MAX_MS), 'the deadline to be armed', 4000)
        loop.elapseDeadline()
        await untilUnsavedAsked(loop)
    })

    test('P7 guard: a scan that throws asks the unsaved question and the loop survives', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        let probe: Probe | null = null
        const loop = await start({}, (_db, kit) => { probe = probeEncoder(kit) })
        await cleanPrompt(loop)
        expect(probe).not.toBeNull()
        ;(probe as unknown as Probe).netScanFails = true
        markCharacterForSave(chaIdAt(loop.db, 0))
        await untilUnsavedAsked(loop)
    })

    test('P8 guard: a mark that arrives while the judgement runs asks the unsaved question', async () => {
        let probe: Probe | null = null
        const loop = await start({}, (_db, kit) => { probe = probeEncoder(kit) })
        await cleanPrompt(loop)
        ;(probe as unknown as Probe).onVerdict = () => { markCharacterForSave(chaIdAt(loop.db, 1)) }
        markCharacterForSave(chaIdAt(loop.db, 0))
        await untilUnsavedAsked(loop)
    })

    test('P9 diagnostic: the prompt judges the one marked resident and the front once per mark serial', async () => {
        let probe: Probe | null = null
        const loop = await start({}, (_db, kit) => { probe = probeEncoder(kit) })
        await cleanPrompt(loop)
        const seen = probe as unknown as Probe
        markCharacterForSave(chaIdAt(loop.db, 0))
        await until(() => seen.fronts >= 1, 'the judgement', 4000)
        await pause(150)
        expect(seen.verdicts).toBe(1)
        expect(seen.fronts).toBe(1)
        expect(loop.kit.peer.asked).toEqual([])
        await pause(150)
        expect(seen.verdicts).toBe(1)
        expect(seen.fronts).toBe(1)
    })

    test.each([
        ['P11 numeric chaId 5, raw edit and a raw numeric mark', 5, (loop: Loop) => { chars(loop.db)[1].personality = 'a raw edit'; markCharacterForSave(5) }],
        ['P12 string chaId 5, raw edit and a string mark', '5', (loop: Loop) => { chars(loop.db)[1].personality = 'a raw edit'; markCharacterForSave('5') }],
    ])('%s: asks the unsaved question', async (_label, id, act) => {
        const loop = await start({}, undefined, chaIdSeed(id))
        await cleanPrompt(loop)
        act(loop)
        await untilUnsavedAsked(loop)
    })

    test('P12b reproducer: a numeric mark with no change is judged clean', async () => {
        const loop = await start({}, undefined, chaIdSeed(5))
        holdAnswer(loop)
        markCharacterForSave(5)
        await parkOnPeer(loop)
        await staysClean(loop)
    })

    test('P13 guard: a tracker entry that stands for no chaId (the selected chaId 0) asks the unsaved question', async () => {
        const loop = await start({}, undefined, chaIdSeed(0))
        await cleanPrompt(loop)
        chars(loop.db)[1].personality = 'a raw edit'
        loop.tracker.character.push(0 as never)
        loop.schedule('judged')
        await untilUnsavedAsked(loop)
    })

    test('P14 diagnostic: a park replaced during the judgement is asked about once, for the new park', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        let attempted = false
        let absentOnce = false
        let torn = false
        const loop = await start({ idleNet: { intervalMs: 1, backstopMs: 0 } }, (_db, kit) => {
            const real = kit.committer
            const scripted: Committer = {
                ...real,
                async readCommit() {
                    const read = await real.readCommit()
                    // The first read of `recheckPark` after the arming is torn, and so is every read after it (the idle net
                    // reads the base too, and must find the replaced park again, not re-park it as a peer commit).
                    if (absentOnce && new Error().stack?.includes('recheckPark') === true) {
                        absentOnce = false
                        torn = true
                    }
                    // A read that cannot be parsed as a base: the recheck inside the judgement parks as replaced.
                    return torn ? { ...read, bytes: null } : read
                },
                async commit(read, request) {
                    if (attempted) {
                        return real.commit(read, request)
                    }
                    attempted = true
                    await real.commit(read, request)
                    await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
                    return { status: 'unknown', cause: new Store2UnknownOutcomeError('The response was lost.') }
                },
            }
            kit.context.session = { ...kit.context.session, committer: scripted }
        })
        loop.ignoreMarks = true
        holdAnswer(loop)
        await pause(50)
        chars(loop.db)[0].personality = 'an edit the net found'
        await until(() => loop.kit.peer.clean.length >= 1, 'the clean prompt', 4000)
        loop.ignoreMarks = false
        absentOnce = true
        markCharacterForSave(chaIdAt(loop.db, 1))
        await until(() => loop.kit.peer.asked.length >= 1, 'the unsaved question', 8000)
        await pause(200)
        expect(loop.kit.peer.asked).toHaveLength(1)
        expect(loop.kit.peer.asked[0]).toMatchObject({ unsaved: true, reason: 'replaced' })
    })
})

describe('MC-566: a tick that ended in a stop keeps the page unsaved, whatever the marks say', () => {
    /** The commit lands a peer commit first, so the pass the tick planned parks instead of saving. */
    function peerFirst(kit: Store2Kit): void {
        const real = kit.committer
        let landed = false
        const scripted: Committer = {
            ...real,
            async commit(read, request) {
                if (!landed) {
                    landed = true
                    await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
                }
                return real.commit(read, request)
            },
        }
        kit.context.session = { ...kit.context.session, committer: scripted }
    }

    test('T1 guard: a verdict-slot tick that found an unmarked root edit and an unmarked chatPage and parked asks the unsaved question', async () => {
        const loop = await start({ idleNet: { intervalMs: 1, backstopMs: 0 } }, (_db, kit) => { peerFirst(kit) })
        holdAnswer(loop)
        await pause(50)
        loop.db.username = 'a username no mark saw'
        chars(loop.db)[0].chatPage = 3
        await until(() => loop.kit.peer.clean.length + loop.kit.peer.asked.length >= 1, 'a prompt', 8000)
        expect(loop.markedUnsaved).toBeGreaterThanOrEqual(1)
        await until(() => loop.kit.peer.asked.length >= 1, 'the unsaved question', 8000)
        expect(loop.kit.peer.asked[0]).toMatchObject({ unsaved: true })
    })

    test('T1b guard: a full tick caused by an unheld raw character that parked after planning asks the unsaved question', async () => {
        const loop = await start({ idleNet: { intervalMs: 1, backstopMs: 0 } }, (_db, kit) => { peerFirst(kit) })
        holdAnswer(loop)
        await pause(50)
        const extra = clone(loop.db).characters[0] as unknown as Entry
        extra.chaId = 'a-raw-character-no-mark-saw'
        chars(loop.db).push(extra)
        await until(() => loop.kit.peer.clean.length + loop.kit.peer.asked.length >= 1, 'a prompt', 8000)
        expect(loop.markedUnsaved).toBeGreaterThanOrEqual(1)
        await until(() => loop.kit.peer.asked.length >= 1, 'the unsaved question', 8000)
        expect(loop.kit.peer.asked[0]).toMatchObject({ unsaved: true })
    })
})
