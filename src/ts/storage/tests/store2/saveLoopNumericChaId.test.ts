// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { installCharacterSaveMarks, markCharacterForSave, resetCharacterSaveMarksForTest } from '../../characterSaveMarks'
import { until } from '../saveLoopWorld'
import { startStore2, type Store2Kit } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The store2 marked pass and characters whose chaId is a number. The loop runs over a real memory backend and committer
 * with a hand-built port, and the first encoding is built by `startStore2` the way the real codec builds it.
 * Labels: (R) fails against the base, where a raw numeric mark names nothing; (G) is a compatibility guard.
 */

type Entry = Record<string, unknown>

function clone(db: Database): Database {
    return JSON.parse(JSON.stringify(db)) as Database
}

function chars(db: Database): Entry[] {
    return db.characters as unknown as Entry[]
}

// Marks are raw chaIds at runtime although toSaveType.character is declared string[].
function pushRawMark(tracker: toSaveType, mark: unknown): void {
    (tracker.character as unknown[]).push(mark)
}

interface Loop {
    kit: Store2Kit
    db: Database
    tracker: toSaveType
    state: { due: boolean, saved: number }
    crashed: unknown[]
    failures: unknown[]
    stop(): void
}

const loops: Loop[] = []

afterEach(() => {
    for (const loop of loops) {
        loop.stop()
    }
    loops.length = 0
    resetCharacterSaveMarksForTest()
})

async function startLoop(db: Database): Promise<Loop> {
    const kit = await startStore2({ db })
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const loop: Loop = { kit, db, tracker, state: { due: false, saved: 0 }, crashed: [], failures: [], stop: () => { stopped = true } }
    const idle = () => new Promise<void>((resolve) => {
        setTimeout(() => {
            if (!stopped) {
                resolve()
            }
        }, 2)
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => db,
        mergeBack: () => {},
        liveCheck: () => {},
        sweep: () => {},
        isDue: () => loop.state.due,
        isDirty: () => loop.state.due,
        hasDrafts: () => false,
        beginIteration() {
            loop.state.due = false
        },
        endIteration: () => {},
        snapshotTaken: () => {},
        requestPass() {
            loop.state.due = true
        },
        unsavable: () => {},
        saved() {
            loop.state.saved += 1
        },
        broadcast: () => {},
        peerHeard: () => false,
        setStopped: () => {},
        reportFailure: (error) => {
            loop.failures.push(error)
            return 1
        },
        reportUncountedFailure: () => 1,
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
        sleep: () => idle(),
        sleepForever: () => new Promise<never>(() => {}),
        now: () => Date.now(),
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        loop.crashed.push(error)
    })
    loops.push(loop)
    return loop
}

async function onePass(loop: Loop): Promise<Entry[]> {
    const before = loop.state.saved
    loop.state.due = true
    await until(() => loop.state.saved > before, 'one saved pass', 4000)
    return (await loop.kit.saved()).characters as unknown as Entry[]
}

describe('store2 marked pass and numeric chaIds', () => {
    test('T1 (R): a raw numeric mark writes the edited numeric-id character in the marked pass, and its chaId stays a number', async () => {
        const db = clone(buildSmall(4))
        chars(db)[0].chaId = 7
        const loop = await startLoop(db)
        chars(db)[0].personality = 'edited-numeric'
        pushRawMark(loop.tracker, 7)
        const stored = await onePass(loop)
        expect(stored[0].personality).toBe('edited-numeric')
        expect(stored[0].chaId).toBe(7)
        expect(loop.crashed).toEqual([])
        expect(loop.failures).toEqual([])
    })

    test('T2 (R): markCharacterForSave(7) reaches the marked pass', async () => {
        const db = clone(buildSmall(4))
        chars(db)[0].chaId = 7
        const loop = await startLoop(db)
        let scheduled = 0
        installCharacterSaveMarks({ tracker: loop.tracker, schedule: () => { scheduled += 1 } })
        chars(db)[0].personality = 'edited-by-api'
        markCharacterForSave(7)
        const stored = await onePass(loop)
        expect(stored[0].personality).toBe('edited-by-api')
        expect(scheduled).toBe(1)
    })

    test('T3 (G): "7" and 7 together are one shared id; each edit lands on its own holder and each keeps its stored type', async () => {
        const db = clone(buildSmall(4))
        chars(db)[0].chaId = '7'
        chars(db)[1].chaId = 7
        const loop = await startLoop(db)
        installCharacterSaveMarks({ tracker: loop.tracker, schedule: () => {} })
        const stringBefore = chars(db)[0].personality
        chars(db)[1].personality = 'edited-numeric-holder'
        markCharacterForSave(7)
        let stored = await onePass(loop)
        expect(stored[1].personality).toBe('edited-numeric-holder')
        expect(stored[1].chaId).toBe(7)
        expect(stored[0].personality).toBe(stringBefore)
        expect(stored[0].chaId).toBe('7')
        chars(db)[0].personality = 'edited-string-holder'
        markCharacterForSave('7')
        stored = await onePass(loop)
        expect(stored[0].personality).toBe('edited-string-holder')
        expect(stored[0].chaId).toBe('7')
        expect(stored[1].personality).toBe('edited-numeric-holder')
        expect(stored[1].chaId).toBe(7)
    })

    test('T4 (G): string ids unchanged: a string mark writes its character, and an unmarked edit elsewhere waits', async () => {
        const db = clone(buildSmall(4))
        chars(db)[0].chaId = 7
        const loop = await startLoop(db)
        const otherBefore = chars(db)[2].personality
        chars(db)[1].personality = 'edited-string-marked'
        chars(db)[2].personality = 'edited-unmarked'
        pushRawMark(loop.tracker, String(chars(db)[1].chaId))
        pushRawMark(loop.tracker, 7)
        const stored = await onePass(loop)
        expect(stored[1].personality).toBe('edited-string-marked')
        expect(stored[2].personality).toBe(otherBefore)
    })

    test('T5 (G): a mark that is neither a string nor a usable number names no character', async () => {
        const db = clone(buildSmall(4))
        chars(db)[0].chaId = 'undefined'
        chars(db)[1].chaId = 'Infinity'
        const loop = await startLoop(db)
        const before0 = chars(db)[0].personality
        const before1 = chars(db)[1].personality
        chars(db)[0].personality = 'edited-undefined'
        chars(db)[1].personality = 'edited-infinity'
        pushRawMark(loop.tracker, undefined)
        pushRawMark(loop.tracker, Infinity)
        const stored = await onePass(loop)
        expect(stored[0].personality).toBe(before0)
        expect(stored[1].personality).toBe(before1)
    })
})
