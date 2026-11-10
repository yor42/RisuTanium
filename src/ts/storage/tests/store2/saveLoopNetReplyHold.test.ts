// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import type { CommitRequest, CommitResult, Committer } from '../../store2/commit'
import type { Store2Read } from '../../store2/backend/types'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { startSavePass, type NetSlotReason, type SavePassMeterHandle } from '../../store2/savePassMeter'
import { runStore2SaveLoop, type Store2LoopPort, type UnsavableCharacter } from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { startStore2, type Store2Kit } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The idle net leaves a streaming reply's owner to the marked passes. The world is saveLoopNetBackstop's
 * `startWorld`, plus a test-owned owner set offered through the optional port member `replyOwners`.
 */

type Entry = Record<string, unknown>
type MeterGlobal = { __risuSavePassMeter?: SavePassMeterHandle }
type PortWithOwners = Store2LoopPort & { replyOwners?: () => ReadonlySet<string> }

interface Slot {
    reads: number
    yields: number
    verdicts: string[]
    requests: SavePassRequest[]
    reason: NetSlotReason | null
    chaId: string | null
}

interface World {
    kit: Store2Kit
    tracker: toSaveType
    clock: { now: number }
    start: number
    requests: SavePassRequest[]
    verdicts: string[]
    state: { due: boolean, dirty: boolean }
    flags: { hidden: boolean, sweep: boolean }
    owners: Set<string>
    unsavableCalls: Array<{ current: readonly UnsavableCharacter[], newly: readonly UnsavableCharacter[] }>
    crashed: unknown[]
    slotAt(offset: number): Promise<Slot>
    markedPass(ids: string[]): Promise<void>
    stop(): void
}

interface StartOptions {
    backstopMs?: number
    moduleIntervalMs?: number
    quiet?: { afterMs: number, intervalMs: number, moduleIntervalMs: number } | null
    /** False: the port has no `replyOwners` member, as on a page that never wires it. */
    ownersMember?: boolean
}

const worlds: World[] = []

function meterOf(): SavePassMeterHandle {
    const found = (globalThis as MeterGlobal).__risuSavePassMeter
    if (found === undefined) {
        throw new Error('The meter handle is not installed.')
    }
    return found
}

beforeEach(() => {
    flag.measure = true
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    startSavePass()
    meterOf().reset()
})

afterEach(() => {
    for (const world of worlds) {
        world.stop()
    }
    worlds.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (globalThis as MeterGlobal).__risuSavePassMeter
})

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function chars(db: Database): Entry[] {
    return db.characters as unknown as Entry[]
}

function idOf(db: Database, index: number): string {
    return String(chars(db)[index].chaId)
}

function cyclic(): Entry {
    const value: Entry = {}
    value.self = value
    return value
}

function indexOfId(db: Database, chaId: string | null): number | null {
    if (chaId === null) {
        return null
    }
    return chars(db).findIndex(slot => slot.chaId === chaId)
}

async function storedChar(world: World, chaId: string): Promise<Entry> {
    const found = (chars(await world.kit.saved())).find(slot => slot.chaId === chaId)
    if (found === undefined) {
        throw new Error(`no stored character ${chaId}`)
    }
    return found
}

function chatIdsOf(slot: Entry): string[] {
    const chats = slot.chats as Array<{ message: Array<{ chatId?: string }> }>
    return chats[0].message.map(message => String(message.chatId))
}

async function startWorld(db: Database, options: StartOptions = {}): Promise<World> {
    const kit = await startStore2({
        db,
        idleNet: {
            intervalMs: 1,
            moduleIntervalMs: options.moduleIntervalMs ?? 1_000_000_000,
            backstopMs: options.backstopMs ?? 30_000,
            ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
        },
    })
    const inner = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
    const requests: SavePassRequest[] = []
    const verdicts: string[] = []
    const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        requests.push(request)
        return inner.plan(planDb, request)
    }
    encoder.verdictOf = (slot) => {
        verdicts.push(String((slot as { chaId?: unknown }).chaId))
        return inner.verdictOf(slot)
    }
    kit.context.encoder = encoder
    const counted = { reads: 0, sweeps: 0, begun: 0 }
    const real = kit.context.session.committer as Committer
    kit.context.session = {
        ...kit.context.session,
        committer: {
            ...real,
            async readCommit(): Promise<Store2Read> {
                counted.reads += 1
                return real.readCommit()
            },
            async commit(read: Store2Read, request: CommitRequest): Promise<CommitResult> {
                return real.commit(read, request)
            },
        },
    }
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const clock = { now: 1_800_000_000_000 }
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const state = { due: false, dirty: false }
    const flags = { hidden: false, sweep: false }
    const owners = new Set<string>()
    const world: World = {
        kit, tracker, clock, start: clock.now, requests, verdicts, state, flags, owners,
        unsavableCalls: [],
        crashed: [],
        async slotAt(offset) {
            const reads = counted.reads
            const judged = verdicts.length
            const planned = requests.length
            const records = meterOf().signalSlots().length
            clock.now = world.start + offset
            await until(() => counted.reads > reads, `the slot at +${offset} ms to read the base`, 4000)
            const sweeps = counted.sweeps
            await until(() => counted.sweeps > sweeps, `the slot at +${offset} ms to end`, 4000)
            const added = meterOf().signalSlots().slice(records)
            const last = added.length === 0 ? null : added[added.length - 1]
            return {
                reads: counted.reads - reads,
                yields: 0,
                verdicts: verdicts.slice(judged),
                requests: requests.slice(planned),
                reason: last?.reason ?? null,
                chaId: last?.chaId ?? null,
            }
        },
        async markedPass(ids) {
            const begun = counted.begun
            tracker.character.push(...ids)
            state.dirty = true
            state.due = true
            await until(() => counted.begun > begun, 'the marked pass to begin', 4000)
            const sweeps = counted.sweeps
            await until(() => counted.sweeps > sweeps + 1, 'the loop to go on past the marked pass', 4000)
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
    const port: PortWithOwners = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => db,
        mergeBack(live, snapshot) {
            live.modules ||= snapshot.modules
        },
        liveCheck: () => {},
        sweep() {
            counted.sweeps += 1
        },
        isDue: () => state.due,
        isDirty: () => state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            counted.begun += 1
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
        unsavable(current, newly) {
            world.unsavableCalls.push({ current, newly })
        },
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
        async yieldNow() {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
        },
        pageHidden: () => flags.hidden,
        takeNetSweep() {
            const pending = flags.sweep
            flags.sweep = false
            return pending
        },
    }
    if (options.ownersMember !== false) {
        port.replyOwners = () => owners
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        world.crashed.push(error)
    })
    worlds.push(world)
    return world
}

/** Three residents verdicted clean once each at +1 s, +2 s and +3 s; resident 0's next turn is at +4 s. */
async function threeClean(world: World, db: Database): Promise<void> {
    for (const [index, offset] of [1_000, 2_000, 3_000].entries()) {
        expect((await world.slotAt(offset)).verdicts).toEqual([idOf(db, index)])
    }
}

describe('T1\' the sent message and the reply placeholder wait with the reply (MC-1319)', () => {
    test('reproducer: marked-not-due start state of a registered owner is not written by the net; the settle pass writes it', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db, { backstopMs: 0 })
        await threeClean(world, db)
        const a = idOf(db, 0)
        const chat = (chars(db)[0].chats as Array<{ message: Entry[] }>)[0]
        // As sendChat does: the user message, then the placeholder with `interrupted`, marked, the debounce not due.
        chat.message.push({ role: 'user', data: 'the sent message', chatId: 'sent-1', time: 1 })
        chat.message.push({ role: 'char', data: '', saying: a, chatId: 'reply-1', time: 2, interrupted: true })
        world.tracker.character.push(a)
        world.state.dirty = true
        world.owners.add(a)
        for (const offset of [4_000, 5_000, 6_000]) {
            await world.slotAt(offset)
        }
        expect(chatIdsOf(await storedChar(world, a))).not.toContain('sent-1')
        world.owners.delete(a)
        await world.markedPass([a])
        expect(chatIdsOf(await storedChar(world, a))).toEqual(expect.arrayContaining(['sent-1', 'reply-1']))
        expect(world.crashed).toEqual([])
    })
})

describe('T2 a registered owner is not verdicted', () => {
    test('reproducer: an unmarked owner edit gets no verdict and stays unwritten for a rotation', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db, { backstopMs: 0 })
        await threeClean(world, db)
        const a = idOf(db, 0)
        world.owners.add(a)
        chars(db)[0].personality = 'owner edit, nothing marked'
        const seen: string[] = []
        for (const offset of [4_000, 5_000, 6_000]) {
            seen.push(...(await world.slotAt(offset)).verdicts)
        }
        expect(seen).not.toContain(a)
        expect((await storedChar(world, a)).personality).not.toBe('owner edit, nothing marked')
    })
})

describe('T3 and T4 a held full tick', () => {
    test('T3 reproducer: the module tick that picks the held owner names no character, keeps module scope and keeps the owner\'s clean clock', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db, { moduleIntervalMs: 5_000 })
        const a = idOf(db, 0)
        expect((await world.slotAt(1_000)).verdicts).toEqual([a])
        world.owners.add(a)
        chars(db)[0].personality = 'owner edit, nothing marked'
        const tick = await world.slotAt(6_000)
        expect(tick.reason).toBe('modulesDue')
        expect(tick.requests.map(request => request.net)).toEqual([{ chaId: null, modules: true }])
        expect((await storedChar(world, a)).personality).not.toBe('owner edit, nothing marked')
        // The +1 s clean clock survived the held tick: +7 s is no module tick (the module clock is at +6 s), and the
        // turn after removal is skipped inside the 30 s backstop rather than verdicted.
        world.owners.delete(a)
        const after = await world.slotAt(7_000)
        expect(after.verdicts).toEqual([])
        expect(after.reason).toBe('verdictSkipped')
    })

    test('T4 guard: a module edited unmarked is written by that held tick', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db, { moduleIntervalMs: 5_000 })
        const a = idOf(db, 0)
        expect((await world.slotAt(1_000)).verdicts).toEqual([a])
        world.owners.add(a)
        const modules = db.modules as unknown as Entry[]
        modules[0].name = 'module edit, nothing marked'
        const tick = await world.slotAt(6_000)
        expect(tick.reason).toBe('modulesDue')
        await until(async () => ((await world.kit.saved()).modules as unknown as Entry[])[0].name === 'module edit, nothing marked', 'the module edit to reach the store', 4000)
    })
})

describe('T8 and T10 the hold ends with the stream', () => {
    test('T8 guard: after removal the owner\'s next turn verdicts it and writes an unmarked edit', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db, { backstopMs: 0 })
        await threeClean(world, db)
        const a = idOf(db, 0)
        world.owners.add(a)
        for (const offset of [4_000, 5_000, 6_000]) {
            await world.slotAt(offset)
        }
        world.owners.delete(a)
        chars(db)[0].personality = 'after the stream, nothing marked'
        const turn = await world.slotAt(7_000)
        expect(turn.verdicts).toEqual([a])
        expect(turn.reason).toBe('verdictDirty')
        await until(async () => (await storedChar(world, a)).personality === 'after the stream, nothing marked', 'the edit to reach the store', 4000)
    })

    test('T10 guard: a held turn keeps a fresh clean clock, so the turn after removal inside 30 s is skipped', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db)
        const a = idOf(db, 0)
        expect((await world.slotAt(1_000)).verdicts).toEqual([a])
        world.owners.add(a)
        expect((await world.slotAt(2_000)).verdicts).toEqual([])
        world.owners.delete(a)
        const next = await world.slotAt(3_000)
        expect(next.verdicts).toEqual([])
        expect(next.reason).toBe('verdictSkipped')
    })
})

/** saveLoopNetBackstop's scripted run, with the owner set present or absent but always empty. */
async function scriptedRun(options: StartOptions): Promise<Array<[string | null, number | null]>> {
    const db = clone(buildSmall(3))
    const world = await startWorld(db, { moduleIntervalMs: 7_000, ...options })
    const seen: Array<[string | null, number | null]> = []
    for (let offset = 1_000; offset <= 20_000; offset += 1_000) {
        if (offset === 9_000) {
            chars(db)[1].personality = 'edited in place, nothing marked'
        }
        const slot = await world.slotAt(offset)
        seen.push([slot.reason, indexOfId(db, slot.chaId)])
    }
    expect(world.crashed).toEqual([])
    return seen
}

// Copied from saveLoopNetBackstop.test.ts (generated there on the commit before the backstop existed).
const SCRIPTED_RUN_BASE: Array<[string | null, number | null]> = [
    ['verdictClean', 0], ['verdictClean', 1], ['verdictClean', 2], ['verdictClean', 0], ['verdictClean', 1],
    ['verdictClean', 2], ['modulesDue', null], ['verdictClean', 1], ['verdictClean', 2], ['verdictClean', 0],
    ['verdictDirty', 1], ['verdictClean', 2], ['verdictClean', 0], ['modulesDue', null], ['verdictClean', 2],
    ['verdictClean', 0], ['verdictClean', 1], ['verdictClean', 2], ['verdictClean', 0], ['verdictClean', 1],
]

describe('T9 the port without the member, or with no owner, is the base\'s', () => {
    test('T9 guard: no member, backstop 0: every slot equals the base', async () => {
        expect(await scriptedRun({ backstopMs: 0, ownersMember: false })).toEqual(SCRIPTED_RUN_BASE)
    })

    test('T9 guard: the member with an empty set, backstop 0: every slot equals the base', async () => {
        expect(await scriptedRun({ backstopMs: 0 })).toEqual(SCRIPTED_RUN_BASE)
    })
})

describe('T11 a hidden page still holds', () => {
    test('reproducer: hidden, the owner\'s turn gets no verdict', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db)
        const a = idOf(db, 0)
        expect((await world.slotAt(1_000)).verdicts).toEqual([a])
        world.flags.hidden = true
        world.owners.add(a)
        const turn = await world.slotAt(2_000)
        expect(turn.verdicts).toEqual([])
    })
})

describe('T12 a marked pass writes a held owner', () => {
    test('guard: an owner edit is written by the marked pass while registered', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db, { backstopMs: 0 })
        await threeClean(world, db)
        const a = idOf(db, 0)
        world.owners.add(a)
        chars(db)[0].personality = 'owner edit, then marked'
        await world.markedPass([a])
        expect((await storedChar(world, a)).personality).toBe('owner edit, then marked')
    })
})

describe('T15 saved bytes do not depend on the member', () => {
    test('guard: the stored owner after hold, removal and the settle pass equals the stored owner of a world without the member', async () => {
        async function run(ownersMember: boolean): Promise<string> {
            const db = clone(buildSmall(3))
            const world = await startWorld(db, { backstopMs: 0, ownersMember })
            await threeClean(world, db)
            const a = idOf(db, 0)
            world.owners.add(a)
            chars(db)[0].personality = 'same edit'
            const chat = (chars(db)[0].chats as Array<{ message: Entry[] }>)[0]
            chat.message.push({ role: 'user', data: 'the sent message', chatId: 'sent-1', time: 1 })
            for (const offset of [4_000, 5_000, 6_000]) {
                await world.slotAt(offset)
            }
            world.owners.delete(a)
            await world.markedPass([a])
            const stored = JSON.stringify(await storedChar(world, a))
            world.stop()
            return stored
        }
        expect(await run(true)).toBe(await run(false))
    })
})

describe('T17 an unsavable owner is never held', () => {
    test('T17a guard: an unsavable registered owner is retried at its turn', async () => {
        const db = clone(buildSmall(2))
        const world = await startWorld(db)
        const a = idOf(db, 0)
        expect((await world.slotAt(1_000)).verdicts).toEqual([a])
        world.owners.add(a)
        chars(db)[0].personality = cyclic()
        await world.markedPass([a])
        await until(() => world.unsavableCalls.length > 0, 'the character to be reported unsavable', 4000)
        expect((await world.slotAt(2_000)).verdicts).toEqual([idOf(db, 1)])
        const planned = world.requests.length
        const slot = await world.slotAt(3_000)
        expect(slot.reason).toBe('verdictUnknown')
        expect(slot.chaId).toBe(a)
        expect(world.requests.slice(planned).map(request => request.net)).toEqual([{ chaId: a, modules: false }])
    })

    test('T17c guard: the module tick names an unsavable registered owner', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db, { moduleIntervalMs: 5_000 })
        const a = idOf(db, 0)
        expect((await world.slotAt(1_000)).verdicts).toEqual([a])
        world.owners.add(a)
        chars(db)[0].personality = cyclic()
        await world.markedPass([a])
        await until(() => world.unsavableCalls.length > 0, 'the character to be reported unsavable', 4000)
        const tick = await world.slotAt(6_000)
        expect(tick.reason).toBe('modulesDue')
        expect(tick.requests.map(request => request.net)).toEqual([{ chaId: a, modules: true }])
    })
})

describe('T18 other residents keep the net', () => {
    test('guard: another resident\'s unmarked edit is verdicted and written at its turn', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db, { backstopMs: 0 })
        await threeClean(world, db)
        const a = idOf(db, 0)
        const b = idOf(db, 1)
        world.owners.add(a)
        chars(db)[1].personality = 'other edit, nothing marked'
        await world.slotAt(4_000)
        const turn = await world.slotAt(5_000)
        expect(turn.verdicts).toEqual([b])
        expect(turn.reason).toBe('verdictDirty')
        await until(async () => (await storedChar(world, b)).personality === 'other edit, nothing marked', 'the edit to reach the store', 4000)
    })
})

describe('RQ a held owner\'s turn is activity, so an unselected-chat stream keeps the base cadence', () => {
    test('guard: another resident\'s unmarked edit is verdicted at its turn while the owner changes unmarked every slot', async () => {
        const db = clone(buildSmall(3))
        // Scaled quiet thresholds: quiet after 5 s without activity, then one scan per 10 s.
        const world = await startWorld(db, { backstopMs: 0, quiet: { afterMs: 5_000, intervalMs: 10_000, moduleIntervalMs: 1_000_000_000 } })
        await threeClean(world, db)
        const a = idOf(db, 0)
        const b = idOf(db, 1)
        world.owners.add(a)
        const reasons: Array<NetSlotReason | null> = []
        let bSeenAt: number | null = null
        for (let offset = 4_000; offset <= 12_000; offset += 1_000) {
            // A reply streaming into a chat that is not selected: written in place, no mark, the page not dirty.
            chars(db)[0].personality = 'stream chunk ' + offset
            if (offset === 8_000) {
                chars(db)[1].personality = 'other edit, nothing marked'
            }
            const slot = await world.slotAt(offset)
            reasons.push(slot.reason)
            if (bSeenAt === null && offset >= 8_000 && slot.verdicts.includes(b)) {
                bSeenAt = offset
            }
        }
        expect(reasons).not.toContain('scanBackedOff')
        expect(bSeenAt).toBe(8_000)
        expect(world.crashed).toEqual([])
    })
})

describe('RQ2 a held full tick is activity, so the module interval does not lengthen behind it', () => {
    test('guard: the module tick after a held module tick comes one module interval later', async () => {
        const db = clone(buildSmall(3))
        // Quiet scans never start here (afterMs is out of reach); only the quiet module interval can apply.
        const world = await startWorld(db, { backstopMs: 0, moduleIntervalMs: 3_000, quiet: { afterMs: 1_000_000_000, intervalMs: 1_000_000_000, moduleIntervalMs: 1_000_000_000 } })
        const c = idOf(db, 2)
        expect((await world.slotAt(1_000)).verdicts).toEqual([idOf(db, 0)])
        expect((await world.slotAt(2_000)).verdicts).toEqual([idOf(db, 1)])
        // A reply streams into resident 2's chat, which is not selected: written in place, no mark, the page not dirty.
        world.owners.add(c)
        const reasons: Array<NetSlotReason | null> = []
        for (let offset = 3_000; offset <= 6_000; offset += 1_000) {
            chars(db)[2].personality = 'stream chunk ' + offset
            reasons.push((await world.slotAt(offset)).reason)
        }
        // +3 s: the module tick picks resident 2; +4 s and +5 s: residents 0 and 1; +6 s: the next module tick.
        expect(reasons).toEqual(['modulesDue', 'verdictClean', 'verdictClean', 'modulesDue'])
        expect(world.crashed).toEqual([])
    })
})
