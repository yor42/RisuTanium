// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: false }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import { Sha256 } from 'src/ts/assetHash'
import type { Store2Read } from '../../store2/backend/types'
import type { Committer } from '../../store2/commit'
import { previousFrom, type ListDerivation } from '../../store2/codec'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { startStore2 } from '../store2SaveKit'
import { chat, dbWithCharacters, encodeWith, fakeLists, loreEntry, message, mulberry32, prosePool, sparseCharacter, uuidLike, type Obj } from './codecFixtures'

/**
 * The idle-net slot's verdict waits between the stages of its emit (`netDecision` awaits `verdictOfYielding` on the
 * budget the passes use). Labels: T8 is the regression reproducer: on the base the slot's verdict is one synchronous
 * stretch, so its trace has no wait between the units. T12 (rejected wait), T13 (replaced database), the due-pass
 * test and the belt are guards of the new waits: they need a wait inside the verdict, so they fail on the base and are
 * not reproducers of a defect. T16 (hidden page) is a compatibility guard that passes on the base and after. Each is
 * killed by a mutant named in the hand-back. The behavioural tests run with the
 * measurement switch off, as a release build does. The slot's clock moves 10 ms at every frame the verdict hashes and
 * at every list it derives, only while the verdict runs, so the budget's 8 ms elapses between any two stages and the
 * loop's own interval gate sees the slot's start time again once the verdict returns.
 */

const FRAME_NAMES: Record<number, string> = { 4: 'core', 5: 'lore', 6: 'scripts', 7: 'chatCore', 15: 'al', 21: 'il' }

type Entry = Record<string, unknown>

interface WorldOptions {
    yieldImmediately?: () => boolean
    backstopMs?: number
}

interface World {
    holder: { db: Database }
    encoder: SaveEncoder
    trace: string[]
    requests: SavePassRequest[]
    errors: unknown[]
    crashed: unknown[]
    state: { due: boolean, dirty: boolean }
    /** Runs inside the injected yield; `call` counts the yields since the slot began (the one before the verdict is 1). */
    onYield: { action: ((call: number) => void) | null }
    /** Runs inside the verdict wrapper, after the verdict returned and before the loop sees it. */
    afterVerdict: { fn: (() => void) | null }
    verdictDone: number
    /** Moves the loop's clock by `delta` ms and waits for the slot it starts. */
    slotAfter(delta: number): Promise<void>
    stop(): void
}

const worlds: World[] = []
let restoreSha: (() => void) | null = null

beforeEach(() => {
    flag.measure = false
})

afterEach(() => {
    for (const world of worlds) {
        world.stop()
    }
    worlds.length = 0
    restoreSha?.()
    restoreSha = null
    vi.restoreAllMocks()
})

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function chars(db: Database): Entry[] {
    return db.characters as unknown as Entry[]
}

/** A character with lore, a script, an inlay token in a message and two chats. */
function fullDatabase(): Database {
    const rng = mulberry32(11)
    const pool = prosePool(rng, 200, 20, 100)
    const first = message(rng, pool, 0, 50)
    first.data = `see {{inlay::${uuidLike(rng)}}} here`
    const slot = sparseCharacter(rng, pool, 'cha-big-0001', 'Big', [chat(rng, 0, [first, message(rng, pool, 1, 50)]), chat(rng, 1, [message(rng, pool, 1, 50)])], [loreEntry(rng, pool, 0, 50)])
    slot.customscript = [{ comment: 'x', in: 'a', out: 'b', type: 'editinput' }]
    return clone(dbWithCharacters([slot as Obj]))
}

const SLOT_STAGES = ['core', 'Y', 'lore', 'Y', 'scripts', 'Y', 'assets', 'Y', 'al', 'Y', 'inlays', 'Y', 'il', 'Y', 'chatCore', 'Y', 'chatCore']

async function startWorld(db: Database, options: WorldOptions = {}): Promise<World> {
    const trace: string[] = []
    const clock = { now: 1_800_000_000_000 }
    let inVerdict = false
    const advance = (): void => {
        if (inVerdict) {
            clock.now += 10
        }
    }
    const lists: ListDerivation = {
        ...fakeLists,
        characterAssets: (owner) => {
            trace.push('assets')
            advance()
            return fakeLists.characterAssets(owner)
        },
        characterInlays: (owner) => {
            trace.push('inlays')
            advance()
            return fakeLists.characterInlays(owner)
        },
    }
    const kit = await startStore2({ db, lists, idleNet: { intervalMs: 1, backstopMs: options.backstopMs ?? 0 } })
    const inner = createSaveEncoder({ previous: kit.context.previous, lists, env: kit.context.env })
    const requests: SavePassRequest[] = []
    const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        requests.push(request)
        return inner.plan(planDb, request)
    }
    const hooks: Pick<World, 'afterVerdict'> = { afterVerdict: { fn: null } }
    const counted = { reads: 0, sweeps: 0 }
    let verdictDone = 0
    /** Marks the verdict's start and end in the trace and moves the clock back to where it started once it ends, however it ends. */
    async function around(run: () => Promise<'unknown' | 'clean' | 'dirty'>): Promise<'unknown' | 'clean' | 'dirty'> {
        const before = clock.now
        trace.push('V')
        inVerdict = true
        try {
            const verdict = await run()
            trace.push('VDone')
            verdictDone += 1
            hooks.afterVerdict.fn?.()
            return verdict
        } finally {
            inVerdict = false
            clock.now = before
        }
    }
    // The base has the synchronous verdict only and the changed loop the yielding one: both are wrapped alike.
    encoder.verdictOf = slot => {
        trace.push('V')
        const verdict = inner.verdictOf(slot)
        trace.push('VDone')
        verdictDone += 1
        return verdict
    }
    encoder.verdictOfYielding = (slot, pause) => around(() => inner.verdictOfYielding(slot, pause))
    kit.context.encoder = encoder
    const real = kit.context.session.committer as Committer
    kit.context.session = {
        ...kit.context.session,
        committer: {
            ...real,
            async readCommit() {
                counted.reads += 1
                const read: Store2Read = await real.readCommit()
                return read
            },
        },
    }
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const state = { due: false, dirty: false }
    const holder = { db }
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    let yieldCalls = 0
    const onYield: World['onYield'] = { action: null }
    const world: World = {
        holder, encoder: inner, trace, requests, errors: [], crashed: [], state, onYield,
        afterVerdict: hooks.afterVerdict,
        get verdictDone() {
            return verdictDone
        },
        async slotAfter(delta) {
            const reads = counted.reads
            yieldCalls = 0
            clock.now += delta
            await until(() => counted.reads > reads, `a read after +${delta}`, 4000)
            const sweeps = counted.sweeps
            await until(() => counted.sweeps > sweeps, `the end of the slot after +${delta}`, 4000)
        },
        stop() {
            stopped = true
        },
    }
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => holder.db,
        mergeBack() {},
        liveCheck: () => {},
        sweep() {
            counted.sweeps += 1
        },
        isDue: () => state.due,
        isDirty: () => state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            state.due = false
        },
        endIteration: () => {},
        snapshotTaken() {
            state.dirty = false
        },
        requestPass() {
            state.dirty = true
            state.due = true
        },
        unsavable: () => {},
        saved: () => {},
        broadcast: () => {},
        peerHeard: () => false,
        setStopped: () => {},
        reportFailure: () => 1,
        reportUncountedFailure: () => 1,
        async withWriteLock(work) {
            const before = tail
            let release: () => void = () => {}
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            try {
                return await work()
            } finally {
                release()
            }
        },
        wait: idle,
        sleep: () => idle(),
        sleepForever: () => new Promise<never>(() => {}),
        now: () => clock.now,
        yieldNow: async () => {
            yieldCalls += 1
            trace.push('Y')
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
            onYield.action?.(yieldCalls)
        },
    }
    if (options.yieldImmediately !== undefined) {
        port.yieldImmediately = options.yieldImmediately
    }
    vi.spyOn(console, 'error').mockImplementation((error: unknown) => {
        world.errors.push(error)
    })
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        world.crashed.push(error)
    })
    // From here on every frame the verdict hashes moves its clock; the seeding and the first loop turns above did not.
    const real256 = Sha256.prototype.update
    Sha256.prototype.update = function (this: Sha256, bytes: Uint8Array) {
        if (bytes.length > 6 && bytes[0] === 0x52 && bytes[1] === 0x53 && bytes[2] === 0x41 && bytes[3] === 0x4c) {
            const name = FRAME_NAMES[bytes[5]]
            if (name !== undefined) {
                trace.push(name)
                advance()
            }
        }
        return real256.call(this, bytes)
    } as typeof real256
    restoreSha = () => {
        Sha256.prototype.update = real256
    }
    worlds.push(world)
    return world
}

/** What the trace holds between the verdict's start and its end. */
function verdictSegment(world: World): string[] {
    const from = world.trace.indexOf('V')
    const to = world.trace.indexOf('VDone')
    if (from < 0 || to < 0) {
        throw new Error(`The trace holds no complete verdict: ${world.trace.join(' ')}`)
    }
    return world.trace.slice(from + 1, to)
}

describe('the idle-net verdict waits between the stages of its emit', () => {
    test('T8 regression reproducer: the verdict of a slot is staged, after the wait that precedes it', async () => {
        const world = await startWorld(fullDatabase())
        await world.slotAfter(2_000)
        const stretch = world.trace.slice(0, world.trace.indexOf('VDone') + 1)
        expect(stretch.slice(-SLOT_STAGES.length - 3)).toEqual(['Y', 'V', ...SLOT_STAGES, 'VDone'])
        expect(world.trace.indexOf('core'), 'the shadow missed and the emit ran').toBeGreaterThan(-1)
    })

    test('T16 compatibility guard: on a page that must not wait, the verdict runs its stages with no wait', async () => {
        const world = await startWorld(fullDatabase(), { yieldImmediately: () => true })
        await world.slotAfter(2_000)
        expect(verdictSegment(world)).toEqual(['core', 'lore', 'scripts', 'assets', 'al', 'inlays', 'il', 'chatCore', 'chatCore'])
    })

    test('the due-pass test, compatibility guard: a pass that becomes due during a wait of the verdict does not abandon it, and its turn follows', async () => {
        const world = await startWorld(fullDatabase())
        let requestsDuring = -1
        world.onYield.action = (call) => {
            if (call === 2) {
                requestsDuring = world.requests.length
                world.state.due = true
            }
        }
        const before = world.requests.length
        await world.slotAfter(2_000)
        expect(world.verdictDone, 'the verdict was answered').toBe(1)
        expect(requestsDuring, 'the loop is suspended: no pass started during the wait').toBe(before)
        await until(() => world.requests.length > before, 'the marked pass', 4000)
        expect(world.requests[before].net, 'the pass that follows is the marked one').toBeUndefined()
    })

    test('T12 compatibility guard: a wait of the verdict that rejects reaches the guard and the full tick, with no verdict', async () => {
        const world = await startWorld(fullDatabase())
        world.onYield.action = (call) => {
            if (call === 3) {
                throw new Error('the injected in-verdict yield rejected')
            }
        }
        await world.slotAfter(2_000)
        expect(world.trace).not.toContain('VDone')
        expect(world.errors.some(error => error instanceof Error && error.message === 'the injected in-verdict yield rejected')).toBe(true)
        expect(world.crashed).toEqual([])
        expect(world.requests).toHaveLength(1)
        expect(world.encoder.shadowStats().entries, 'a rejected verdict admits no shadow').toBe(0)
    })

    test('T13 compatibility guard: a database replaced during a wait of the verdict starts no pass and no clean clock', async () => {
        const db = fullDatabase()
        const world = await startWorld(db, { backstopMs: 1_000_000 })
        world.onYield.action = (call) => {
            if (call === 2) {
                world.holder.db = clone(db)
                world.onYield.action = null
            }
        }
        await world.slotAfter(2_000)
        expect(world.verdictDone).toBe(1)
        expect(world.requests, 'no pass for a database the slot did not scan').toEqual([])
        // A clean clock would make the backstop skip this resident's verdict at the next turn.
        await world.slotAfter(2_000)
        expect(world.verdictDone, 'the next turn judges the resident again').toBe(2)
    })

    test('T13 the control: with the database unchanged the clean verdict starts the clock and the next turn skips it', async () => {
        const world = await startWorld(fullDatabase(), { backstopMs: 1_000_000 })
        await world.slotAfter(2_000)
        expect(world.verdictDone).toBe(1)
        await world.slotAfter(2_000)
        expect(world.verdictDone).toBe(1)
    })

    test('the belt, compatibility guard: an acknowledged encoding moved during the verdict leaves no shadow behind', async () => {
        const db = fullDatabase()
        const world = await startWorld(db)
        const other = encodeWith(dbWithCharacters([]))
        let entriesAtEnd = -1
        world.afterVerdict.fn = () => {
            entriesAtEnd = world.encoder.shadowStats().entries
        }
        world.onYield.action = (call) => {
            if (call === 2) {
                world.onYield.action = null
                world.encoder.fastForward(previousFrom(other))
            }
        }
        await world.slotAfter(2_000)
        expect(world.verdictDone).toBe(1)
        expect(entriesAtEnd).toBe(0)
        expect(chars(db)).toHaveLength(1)
    })
})
