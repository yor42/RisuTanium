// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { installCharacterSaveMarks, markDbWrite, resetCharacterSaveMarksForTest } from '../../characterSaveMarks'
import { until } from '../saveLoopWorld'
import { startStore2, type Store2Kit } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The store2 marked pass and characters whose chaId is a string that isUsableCharacterId refuses (a reserved name, an
 * oversized string, a malformed one). store2 stores such a character under its string handle, so an explicit write-hook
 * mark naming it must reach the marked pass: the edit is written, not left for a later net.
 */

type Entry = Record<string, unknown>

function clone(db: Database): Database {
    return JSON.parse(JSON.stringify(db)) as Database
}

function chars(db: Database): Entry[] {
    return db.characters as unknown as Entry[]
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

const HANDLES: ReadonlyArray<readonly [string, string]> = [
    ['a reserved name', 'config'],
    ['an oversized string', 'x'.repeat(300)],
    ['a malformed string', 'a\uD800b'],
]

describe('store2 marked pass and string handles isUsableCharacterId refuses', () => {
    test.each(HANDLES)('%s: a write-hook owner mark writes the edited character in one pass', async (_label, handle) => {
        const db = clone(buildSmall(4))
        chars(db)[1].chaId = handle
        const loop = await startLoop(db)
        installCharacterSaveMarks({ tracker: loop.tracker, schedule: () => {} })
        const stored0 = await onePass(loop)
        expect(stored0[1].chaId).toBe(handle)
        chars(db)[1].personality = 'edited-by-hook'
        markDbWrite({ kind: 'owner', id: handle })
        const stored = await onePass(loop)
        expect(stored[1].personality).toBe('edited-by-hook')
        expect(stored[1].chaId).toBe(handle)
        expect(loop.crashed).toEqual([])
        expect(loop.failures).toEqual([])
    })
})
