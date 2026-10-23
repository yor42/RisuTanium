// @vitest-environment node
/**
 * Compatibility guards for the measurement hooks (CHORE-205 stage 0): they pass before and after the hooks exist.
 * What a pass encodes, every unit's identity, type, bytes, reuse flag and key, and the committed manifest key are the
 * same with the measurement flag off, the storage switch off and the switch on; a recorder or a peek that throws changes
 * and fails nothing; and a tick's peek of the tracker only reads.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import { previousFrom } from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import { peekSaveMarks, setSplitClockForTest, startSavePass, type SavePassMeterHandle } from '../../store2/savePassMeter'
import { buildColdStub } from '../../../process/coldCharacter'
import type { Database, character } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { startStore2 } from '../store2SaveKit'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

const NOW = 1_700_000_000_000

type MeterGlobal = { __risuSavePassMeter?: SavePassMeterHandle }

function meterOf(): SavePassMeterHandle | undefined {
    return (globalThis as MeterGlobal).__risuSavePassMeter
}

function switchTo(value: string | null): void {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? value : null })
}

function clone(db: Database): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

function contextOf(attempt: number): BuildContext {
    const { mint } = createKeyMint(seededEnv(900 + attempt), null)
    return { mint, seq: 2, now: NOW }
}

function encoderOf(db: Database): SaveEncoder {
    return createSaveEncoder({ previous: previousFrom(encodeWith(db)), lists: fakeLists, env: seededEnv(77), now: () => NOW })
}

function chaIdOf(db: Database, index = 0): string {
    return (db.characters[index] as { chaId: string }).chaId
}

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex')
}

function edited(): Database {
    const next = clone(buildSmall(4))
    ;(next.characters as Obj[])[0].name = 'a name no fixture holds'
    ;(next.modules as Obj[])[1].description = 'a module description no fixture holds'
    ;(next.botPresets as Obj[])[0].temperature = 0.1234
    ;(next.pluginCustomStorage as Obj)['plugin-0'] = { counter: 999 }
    return asDatabase(next)
}

/** Everything a pass decides, for each of several request shapes over one encoder, under a fixed key environment. */
async function scenario(requests: (db: Database) => SavePassRequest[], makeDb: () => Database = edited): Promise<unknown[]> {
    const db = makeDb()
    const encoder = encoderOf(buildSmall(4))
    const out: unknown[] = []
    let attempt = 0
    for (const request of requests(db)) {
        const plan = await encoder.plan(db, request)
        const built = await plan.commitRequest().build(contextOf(++attempt))
        const tree = built as unknown as { manifestKey?: string }
        plan.acknowledge()
        out.push({
            newUnits: plan.newUnits,
            unchanged: plan.unchanged,
            encoded: plan.encoded,
            skipped: plan.skipped.map(skip => [skip.chaId, skip.saved]),
            commitKeys: Object.keys(built as object),
            manifestKey: encoder.manifestKey,
            built: tree.manifestKey ?? null,
        })
    }
    return out
}

/** Unit-level detail needs the tree itself: the acknowledged encoding is read after each pass, and the build is wrapped to see its output. */
async function unitsOf(requests: (db: Database) => SavePassRequest[], makeDb: () => Database = edited): Promise<unknown[]> {
    const db = makeDb()
    const encoder = encoderOf(buildSmall(4))
    const out: unknown[] = []
    let attempt = 0
    for (const request of requests(db)) {
        const plan = await encoder.plan(db, request)
        let captured: unknown = null
        const commit = plan.commitRequest()
        const original = commit.build
        commit.build = (context) => {
            const result = original(context)
            captured = result
            return result
        }
        await commit.build(contextOf(++attempt))
        plan.acknowledge()
        const acknowledged = encoder.acknowledged()
        out.push({
            units: [...acknowledged.units].map(([identity, unit]) => [identity, unit.type, unit.key, unit.digest]),
            entities: [...acknowledged.entities],
            shape: captured === null ? null : Object.keys(captured as object),
        })
    }
    return out
}

const SHAPES = (db: Database): SavePassRequest[] => [
    { marked: new Set(), modules: false, whole: false, net: { chaId: chaIdOf(db), modules: true } },
    { marked: new Set([chaIdOf(db, 1)]), modules: false, whole: false },
    { marked: new Set(), modules: false, whole: true },
    { marked: new Set(), modules: false, whole: true, rewriteAll: true },
]

beforeEach(() => {
    flag.measure = true
    switchTo('on')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    startSavePass()
    meterOf()?.reset()
})

afterEach(() => {
    setSplitClockForTest(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (globalThis as MeterGlobal).__risuSavePassMeter
})

describe('compatibility guard: the hooks change nothing that is encoded', () => {
    async function threeArms<T>(run: () => Promise<T>): Promise<{ off: T, switchedOff: T, on: T }> {
        flag.measure = false
        const off = await run()
        flag.measure = true
        switchTo(null)
        const switchedOff = await run()
        switchTo('on')
        const on = await run()
        return { off, switchedOff, on }
    }

    test('plans: newUnits, unchanged, encoded, skipped and the manifest key are equal in all three arms', async () => {
        const { off, switchedOff, on } = await threeArms(() => scenario(SHAPES))
        expect(switchedOff).toEqual(off)
        expect(on).toEqual(off)
        expect((off as unknown[]).length).toBe(4)
        expect(meterOf()?.all().length).toBe(4)
    })

    test('units: every identity, type, key and digest of the acknowledged encoding is equal in all three arms', async () => {
        const { off, switchedOff, on } = await threeArms(() => unitsOf(SHAPES))
        expect(switchedOff).toEqual(off)
        expect(on).toEqual(off)
    })

    test('a new character mints a fresh entity id and fresh keys from the same random sequence in all three arms', async () => {
        function withNewCharacter(): Database {
            const next = clone(edited())
            const copy = JSON.parse(JSON.stringify((next.characters as Obj[])[0])) as Obj
            copy.chaId = 'brand-new-character'
            copy.name = 'Brand new'
            ;(next.characters as Obj[]).push(copy)
            return asDatabase(next)
        }
        const shapes = (db: Database): SavePassRequest[] => [
            { marked: new Set(), modules: false, whole: false, net: { chaId: 'brand-new-character', modules: true } },
            { marked: new Set([chaIdOf(db, 1)]), modules: false, whole: false },
        ]
        const planned = await threeArms(() => scenario(shapes, withNewCharacter))
        expect(planned.switchedOff).toEqual(planned.off)
        expect(planned.on).toEqual(planned.off)
        const units = await threeArms(() => unitsOf(shapes, withNewCharacter))
        expect(units.switchedOff).toEqual(units.off)
        expect(units.on).toEqual(units.off)
        // The new character's entity id is in the acknowledged encoding, so the comparison covered a minted id.
        const entities = (units.off as { entities: [string, string][] }[])[0].entities
        expect(entities.some(([handle]) => handle === 'brand-new-character#0')).toBe(true)
    })

    test('the framed bytes and the reuse flags of the committed tree are equal with and without the switch', async () => {
        async function trees(): Promise<unknown[]> {
            const db = edited()
            const encoder = encoderOf(buildSmall(4))
            const plan = await encoder.plan(db, { marked: new Set(), modules: false, whole: false, net: { chaId: chaIdOf(db), modules: true } })
            const seen: unknown[] = []
            const commit = plan.commitRequest()
            const built = await commit.build(contextOf(1)) as unknown as { units?: { identity: string, type: number, reused: boolean, key: string, bytes: Uint8Array }[] }
            for (const unit of built.units ?? []) {
                seen.push([unit.identity, unit.type, unit.reused, unit.key, hex(unit.bytes)])
            }
            return seen
        }
        const { off, switchedOff, on } = await threeArms(trees)
        expect(off.length).toBeGreaterThan(0)
        expect(switchedOff).toEqual(off)
        expect(on).toEqual(off)
    })
})

describe('a failing recorder changes and fails nothing', () => {
    test('a clock, a console and a peek that throw leave the plan, the build and the acknowledgement as they were', async () => {
        flag.measure = false
        const control = await scenario(SHAPES)
        flag.measure = true
        setSplitClockForTest(() => { throw new Error('clock') })
        vi.spyOn(console, 'log').mockImplementation(() => { throw new Error('console') })
        const throwingPeek = (): never => { throw new Error('peek') }
        const measured = await scenario(db => SHAPES(db).map(request => ({ ...request, peekMarks: throwingPeek })))
        expect(measured).toEqual(control)
    })
})

interface TickLoop {
    /** Every request that reached the encoder, in order. */
    requests: SavePassRequest[]
    crashed: unknown[]
    /** Moves the loop's clock to `offset` ms after its start and waits for the plan of the tick that follows. */
    tickAt(offset: number): Promise<void>
    stop(): void
}

/** The save loop over a real memory backend with the idle net on and a hand-built port; `startDb` is what the store holds. */
async function startTickLoop(
    live: Database, tracker: toSaveType, configure: (kit: Awaited<ReturnType<typeof startStore2>>) => void = () => {}, startDb: Database = live,
): Promise<TickLoop> {
    const kit = await startStore2({ db: startDb, idleNet: { intervalMs: 1 } })
    const inner = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
    const requests: SavePassRequest[] = []
    const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        requests.push(request)
        return inner.plan(planDb, request)
    }
    kit.context.encoder = encoder
    configure(kit)
    const clock = { now: 1_800_000_000_000 }
    const start = clock.now
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const state = { due: false, dirty: false }
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => live,
        mergeBack: () => {},
        liveCheck: () => {},
        sweep: () => {},
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
            const earlier = tail
            let release: () => void = () => {}
            tail = new Promise<void>((resolve) => { release = resolve })
            await earlier
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
    }
    const crashed: unknown[] = []
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => { crashed.push(error) })
    return {
        requests,
        crashed,
        async tickAt(offset) {
            const before = requests.length
            clock.now = start + offset
            await until(() => requests.length > before, `the tick at +${offset} ms`, 4000)
        },
        stop() {
            stopped = true
        },
    }
}

describe('the peek of the tracker only reads', () => {
    function trackerOf(): toSaveType {
        return {
            character: ['front', 'second', 'third'],
            chat: [['frontChat', 'c0'], ['laterChat', 'c1']],
            botPreset: true, modules: false, loadouts: true, plugins: false, pluginCustomStorage: true,
        }
    }

    test('peekSaveMarks copies the front, the later marks and the flags and leaves the tracker deep-equal', () => {
        const tracker = trackerOf()
        const before = structuredClone(tracker)
        const copy = peekSaveMarks({ tracker, isDirty: () => true })
        expect(tracker).toEqual(before)
        expect(copy).toEqual({
            front: 'front',
            frontChat: 'frontChat',
            character: new Set(['second', 'third', 'laterChat']),
            flags: { botPreset: true, modules: false, loadouts: true, plugins: false, pluginCustomStorage: true },
            dirty: true,
        })
        const empty: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        expect(peekSaveMarks({ tracker: empty, isDirty: () => false })).toMatchObject({ front: null, frontChat: null, character: new Set() })
    })

    test('a real loop tick that peeks and commits leaves its tracker deep-equal and records a mark state', async () => {
        const db = clone(buildSmall(3)) as unknown as Database
        const tracker = trackerOf()
        const before = structuredClone(tracker)
        const loop = await startTickLoop(db, tracker)
        try {
            ;(db.botPresets as unknown as Obj[])[0].temperature = 0.1234
            // The fixed-group edit is taken by the 30 s full tick: an ordinary slot only judges a resident and plans nothing.
            await loop.tickAt(30_000)
            await until(() => (meterOf()?.units().length ?? 0) > 0, 'the tick to commit', 4000)
            expect(loop.requests[0].peekMarks).toBeTypeOf('function')
            expect(tracker).toEqual(before)
            const record = meterOf()?.units()[0]
            const preset = record?.found?.find(find => find.kind === 'fixed' && find.entity === 'botPreset')
            // The tracker's botPreset flag stood at both ends, so the peek reached the meter and saw it.
            expect(preset?.mark).toBe('marked')
            expect(loop.crashed).toEqual([])
        } finally {
            loop.stop()
        }
    })
})

describe('a stub retry through the save loop', () => {
    test('the second plan of the tick is its only pass record, carries retry and counts as the tick', async () => {
        const base = clone(buildSmall(4))
        const live = clone(base as unknown as Database) as unknown as Database
        const resident = JSON.parse(JSON.stringify((live.characters as unknown as Obj[])[1])) as Obj
        // A stub that names units its entry no longer holds makes the first plan of any pass throw until it is loaded.
        ;(live.characters as unknown as Obj[])[1] = buildColdStub(resident as unknown as character, 'a-key-the-entry-does-not-name', ['chat-a']) as unknown as Obj
        const loop = await startTickLoop(live, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }, (kit) => {
            kit.context.loadStub = async () => {
                ;(live.characters as unknown as Obj[])[1] = resident
                return true
            }
        }, asDatabase(base))
        try {
            ;(live.botPresets as unknown as Obj[])[0].temperature = 0.1234
            await loop.tickAt(2_000)
            await until(() => (meterOf()?.units().length ?? 0) > 0, 'the retried tick to commit', 4000)
            expect(loop.requests.length).toBe(2)
            expect(loop.requests.map(request => request.retry)).toEqual([undefined, true])
            expect(meterOf()?.all().map(pass => [pass.kind, pass.retry])).toEqual([['tick', true]])
            expect(meterOf()?.netFound()).toMatchObject({ ticks: 1, ticksCommitted: 1 })
            expect(loop.crashed).toEqual([])
        } finally {
            loop.stop()
        }
    })
})
