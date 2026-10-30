// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { beginBusy, resetBusyActionsForTest, busyKinds, type BusyHandle } from '../../../process/memory/busyActions'
import { installNetHold, peekNetTickStats, resetNetTickStats, setNetHoldCheck } from '../../measureExportHold'
import { until } from '../saveLoopWorld'
import { startStore2, type Store2Kit } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The measurement-build hold of the store2 save loop's idle net while a `backupSave` export is busy. The loop runs over
 * a real memory backend and committer with a hand-built port; the busy state is the real `busyActions` registry.
 * Labels: (R) fails against the base, where no hold exists; (G) is a compatibility guard that passes with or without the
 * change.
 */

const flags = vi.hoisted(() => ({ measure: true }))

vi.mock('../../../process/memory/measureFlag', () => ({
    get MEASURE() {
        return flags.measure
    },
}))

type Entry = Record<string, unknown>

function clone(db: Database): Database {
    return JSON.parse(JSON.stringify(db)) as Database
}

function chars(db: Database): Entry[] {
    return db.characters as unknown as Entry[]
}

interface Loop {
    kit: Store2Kit
    state: { due: boolean, saved: number }
    crashed: unknown[]
    tracker: toSaveType
    /** True while the loop waits in its idle; a stopped loop that is parked has finished every pass and tick. */
    parked: boolean
    stop(): void
}

const loops: Loop[] = []
const handles: BusyHandle[] = []

const NET_INTERVAL_MS = 50

async function startLoop(db: Database): Promise<Loop> {
    const kit = await startStore2({ db, idleNet: { intervalMs: NET_INTERVAL_MS } })
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const loop: Loop = { kit, state: { due: false, saved: 0 }, crashed: [], tracker, parked: false, stop: () => { stopped = true } }
    const idle = () => new Promise<void>((resolve) => {
        loop.parked = true
        setTimeout(() => {
            if (!stopped) {
                loop.parked = false
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
        reportFailure: () => 1,
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

function busy(kind: Parameters<typeof beginBusy>[0]): BusyHandle {
    const handle = beginBusy(kind)
    handles.push(handle)
    return handle
}

async function pause(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function written(loop: Loop, text: string): Promise<boolean> {
    return ((await loop.kit.saved()).characters[2] as unknown as Entry).personality === text
}

beforeEach(() => {
    flags.measure = true
    resetNetTickStats()
    setNetHoldCheck(null)
})

afterEach(async () => {
    for (const loop of loops) {
        loop.stop()
    }
    // A tick still in flight would note its counts after the next test reset them.
    const deadline = Date.now() + 10_000
    while (loops.some((loop) => !loop.parked) && Date.now() < deadline) {
        await pause(5)
    }
    loops.length = 0
    for (const handle of handles) {
        handle.end()
    }
    handles.length = 0
    resetBusyActionsForTest()
    setNetHoldCheck(null)
})

describe('the idle-net hold while an export is busy', () => {
    test('(R) with the hold on and backupSave busy, an unmarked edit is not written and the held ticks are counted', async () => {
        installNetHold(busyKinds, () => 'on')
        busy('backupSave')
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[2].personality = 'unmarked edit'
        await pause(250)

        expect(await written(loop, 'unmarked edit')).toBe(false)
        expect(peekNetTickStats().held).toBeGreaterThan(0)
        expect(peekNetTickStats().ticks).toBe(0)
        expect(loop.crashed).toEqual([])
    })

    test('(R) once the backupSave entry ends the net runs again: the edit is written and its ticks are counted', async () => {
        installNetHold(busyKinds, () => 'on')
        const handle = busy('backupSave')
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[2].personality = 'unmarked edit'
        await pause(150)
        expect(await written(loop, 'unmarked edit')).toBe(false)

        handle.end()
        await until(() => written(loop, 'unmarked edit'), 'the net to write the edit after the export ends', 4000)
        expect(peekNetTickStats().ticks).toBeGreaterThan(0)
        expect(loop.crashed).toEqual([])
    })

    test('(R) a held tick advances the net clock, so skipped ticks are counted per interval and not per loop iteration', async () => {
        installNetHold(busyKinds, () => 'on')
        busy('backupSave')
        const loop = await startLoop(clone(buildSmall(4)))
        const startedAt = performance.now()
        await pause(10 * NET_INTERVAL_MS)
        const elapsed = performance.now() - startedAt

        // The loop iterates about every 2 ms, so a clock that did not advance would count a hold per iteration.
        // A late timer lets more intervals elapse, so the bound follows the measured time.
        expect(peekNetTickStats().held).toBeGreaterThan(0)
        expect(peekNetTickStats().held).toBeLessThanOrEqual(Math.ceil(elapsed / NET_INTERVAL_MS) + 2)
        expect(loop.crashed).toEqual([])
    })

    test('(G) a dirty mark still produces a pass while the net is held', async () => {
        installNetHold(busyKinds, () => 'on')
        busy('backupSave')
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[1].personality = 'marked edit'
        loop.tracker.character.push(String(chars(db)[1].chaId))
        loop.state.due = true

        await until(async () => ((await loop.kit.saved()).characters[1] as unknown as Entry).personality === 'marked edit', 'the marked pass', 4000)
        expect(loop.crashed).toEqual([])
    })

    test('(G) only backupSave holds: another busy kind leaves the ticks running', async () => {
        installNetHold(busyKinds, () => 'on')
        busy('import')
        busy('export')
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[2].personality = 'unmarked edit'

        await until(() => written(loop, 'unmarked edit'), 'the net to write the edit', 4000)
        expect(peekNetTickStats().held).toBe(0)
    })

    test('(G) with no export busy the ticks run even though the hold is on', async () => {
        installNetHold(busyKinds, () => 'on')
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[2].personality = 'unmarked edit'

        await until(() => written(loop, 'unmarked edit'), 'the net to write the edit', 4000)
        expect(peekNetTickStats().held).toBe(0)
    })

    test('(G) with the stored switch not on, ticks run while backupSave is busy', async () => {
        expect(installNetHold(busyKinds, () => 'off')).toBe(false)
        expect(installNetHold(busyKinds, () => null)).toBe(false)
        busy('backupSave')
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[2].personality = 'unmarked edit'

        await until(() => written(loop, 'unmarked edit'), 'the net to write the edit', 4000)
        expect(peekNetTickStats().held).toBe(0)
    })

    test('(G) a check that throws means not held: the ticks run and the loop survives', async () => {
        setNetHoldCheck(() => { throw new Error('the hold check failed') })
        busy('backupSave')
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[2].personality = 'unmarked edit'

        await until(() => written(loop, 'unmarked edit'), 'the net to write the edit', 4000)
        chars(db)[2].personality = 'a later edit'
        await until(() => written(loop, 'a later edit'), 'a later unmarked edit to be written', 4000)
        expect(loop.crashed).toEqual([])
    })

    test('(R) the ticks that run are counted with their milliseconds', async () => {
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[2].personality = 'unmarked edit'
        await until(() => written(loop, 'unmarked edit'), 'the net to write the edit', 4000)

        const stats = peekNetTickStats()
        expect(stats.ticks).toBeGreaterThan(0)
        expect(stats.tickMs).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(stats.tickMs)).toBe(true)
    })

    test('(G) on a normal build (MEASURE false) the hold is ignored', async () => {
        flags.measure = false
        setNetHoldCheck(() => true)
        busy('backupSave')
        const db = clone(buildSmall(4))
        const loop = await startLoop(db)
        chars(db)[2].personality = 'unmarked edit'

        await until(() => written(loop, 'unmarked edit'), 'the net to write the edit', 4000)
        expect(peekNetTickStats()).toEqual({ held: 0, ticks: 0, tickMs: 0 })
    })

    test('(G) on a normal build installNetHold installs nothing', () => {
        flags.measure = false
        expect(installNetHold(busyKinds, () => 'on')).toBe(false)
    })
})
