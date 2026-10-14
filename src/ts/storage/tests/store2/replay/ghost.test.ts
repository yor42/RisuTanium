// @vitest-environment node
/**
 * The Tauri late-write ("ghost") reproducer. A Tauri page can die while a decisive
 * call of it is still running in the native process: Tauri never cancels a running
 * command. The real `Store2Session`, committer, `gcPass` and fence code run over the
 * real `createTauriBackend` on the scheduled Tauri-semantics store, and the dead
 * page's call is kept by the scheduler's delayed-landing fault and lands at a chosen
 * step.
 *
 * The trace (the model's `s1_n2_ghost`): page A commits and dies with its commit-key
 * write in flight; page B boots and re-flushes; B's GC removes A's uploads, which no
 * commit key names yet; A's write lands, and the commit key names deleted units (I1).
 *
 * What each run shows, and what it does not:
 *  - gate disabled in the fake store (a test option): red, I1.
 *  - gate on, call not yet at the native lock (`ghost-queued`): the landing is
 *    refused because B's registration made A's generation stale. Green.
 *  - gate on, call holding the lock (`ghost-held`): B's registration waits for the
 *    landing, then B proceeds on the ghost's result. Green.
 *  - `bypass: 'allow'` with the gate on: the production backend never touches the
 *    plain paths, so this is green; a backend that went around the gate (a plain
 *    write or deleteMany of the gated keys) turns it red with I1. That mutant is run
 *    as a temporary edit of `backend/tauri.ts`, not in this file.
 *  - the in-progress run is also what turns red for a backend that registers after
 *    its first top-level read: the re-flush then overwrites the ghost's commit key
 *    with the older bytes it read (I3).
 *  - lost update: the ghost lands after B committed a newer key; I3 is the property
 *    that turns it red (the stored `seq` is not the one the write was built from).
 *  - ghost fence delete: a dead page's fence delete lands after B's fence exit. Red
 *    without the gate as G1 (a fence removal by an actor whose last read of the fence
 *    is not the stored one) and as the lost fence in the stored state.
 *
 * REASONED, not run: a ghost removal of `store2/` keys. `removeTop` takes the same
 * lock and makes the same generation check as `writeTop`, so a removal queued behind
 * a registration is refused and a removal in progress is waited for. The model run
 * that found the ghost produced only the commit-key write.
 */
import { describe, expect, test } from 'vitest'
import { StoreStaleGenerationError } from 'src/ts/storage/store/errors'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import type { GcResult } from 'src/ts/storage/store2/gc/pass'
import { createScheduler, type FaultPlan, type LogEntry, type RunResult, type ScriptedFault, type StepInfo } from './scheduler'
import { createTauriRig, spawnPage, type TauriRig } from './tauriRig'
import { createTauriSemanticStore, type TauriSemanticOptions } from './tauriSemanticStore'

// ---- Scenario builders ----

type Ordering = 'queued' | 'held'

interface Run {
    rig: TauriRig
    result: RunResult
    /** The landing step of A's kept call. */
    landing: LogEntry
    /** What B's GC reported, when the scenario ran one. */
    gc: GcResult | null
    /** The commit key B committed, when the scenario committed one. */
    bCommit: string | null
    bytesBefore: { commit: Uint8Array | null, fence: Uint8Array | null }
}

function isGhostStep(info: StepInfo): boolean {
    return info.actor === 'A' && (info.fault === 'ghost-queued' || info.fault === 'ghost-held')
}

function seqOf(bytes: Uint8Array | null): number | null {
    const read = classifyCommitRead({ bytes })
    return read.status === 'parsed' ? read.value.seq : null
}

/** The commit-key writes a page can issue: the gated one, and the plain one a backend that bypassed the gate would use. */
const COMMIT_WRITE_OPS = ['writeTop', 'write'] as const

async function runScenario(options: {
    store?: TauriSemanticOptions
    ordering: Ordering
    shape: 'gc' | 'lost-update' | 'fence-delete'
}): Promise<Run> {
    let rigRef: TauriRig | null = null
    let bDone = false
    const registered = (): boolean => rigRef !== null && rigRef.scheduler.log.some((entry) => entry.actor === 'B' && entry.op === 'registerPage')
    const kind = options.ordering === 'queued' ? 'ghost-queued' : 'ghost-held'
    const landWhen = options.ordering === 'held' ? registered : (): boolean => bDone
    const entry: ScriptedFault = options.shape === 'fence-delete'
        ? { actor: 'A', op: 'removeTop', target: FENCE_KEY, context: 'fence-discard', kind, landWhen }
        : { actor: 'A', op: COMMIT_WRITE_OPS, target: COMMIT_KEY, context: 'commit', kind, landWhen }
    const faults: FaultPlan = { mode: 'script', entries: [entry] }
    const rig = await createTauriRig({
        store: options.store,
        scheduler: { seed: 17, faults },
        prepare: (fake) => {
            if (options.shape === 'fence-delete') {
                fake.plant(FENCE_KEY, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 1, priorCommits: [], keys: [] }))
            }
        },
    })
    rigRef = rig
    const bytesBefore = { commit: rig.fake.peek(COMMIT_KEY), fence: rig.fake.peek(FENCE_KEY) }
    let gc: GcResult | null = null
    let bCommit: string | null = null

    spawnPage(rig, 'A', 101, async (page) => {
        const session = await page.open()
        if (options.shape === 'fence-delete') {
            await page.discardFence(session)
        } else {
            await page.commit(session, 'A')
        }
    })
    spawnPage(rig, 'B', 202, async (page) => {
        await rig.when(isGhostStep)
        const session = await page.open()
        if (options.shape === 'gc') {
            gc = await page.gc(session)
        } else if (options.shape === 'lost-update') {
            const committed = await page.commit(session, 'B')
            bCommit = committed.result.status
        } else {
            const exited = await page.exitFence(session)
            bCommit = exited.status
        }
        bDone = true
    })

    const result = await rig.run()
    const landing = rig.scheduler.log.find((each) => each.actor === 'A' && (each.outcome === 'landed' || each.outcome.startsWith('refused:')))
    if (landing === undefined) {
        throw new Error(`A's call never landed: ${JSON.stringify(rig.scheduler.log.filter((each) => each.actor === 'A'))}`)
    }
    return { rig, result, landing, gc, bCommit, bytesBefore }
}

function deleted(run: Run): number {
    return run.gc !== null && run.gc.status === 'done' ? run.gc.deleted : -1
}

// ---- The 8-step trace ----

describe('the trace: A commits and dies, B boots and collects, A\'s write lands', () => {
    test('gate disabled: A\'s write lands after the GC removed its uploads and the commit key names deleted units (I1)', async () => {
        const run = await runScenario({ store: { gate: false }, ordering: 'queued', shape: 'gc' })

        expect(run.result.status).toBe('finished')
        // B's GC collected A's uploads: the eleven units of its tree, no commit key named them.
        expect(deleted(run)).toBe(11)
        expect(run.landing).toMatchObject({ actor: 'A', op: expect.stringMatching(/^(writeTop|write)$/), fault: 'ghost-queued', outcome: 'landed' })
        const violations = run.rig.checker.violations
        expect(violations.map((violation) => violation.property)).toContain('I1')
        const named = violations.find((violation) => violation.property === 'I1')!
        expect(named.actor).toBe('A')
        expect(named.step).toBe(run.landing.step)
        expect(named.detail).toMatch(/\(named by the commit key\) needs store2\/.* which holds no value/)
        expect(seqOf(run.rig.fake.peek(COMMIT_KEY))).toBe(seqOf(run.bytesBefore.commit)! + 1)
    })

    test('gate on, call queued: the landing is refused, the commit key and every unit stay as B left them', async () => {
        const run = await runScenario({ ordering: 'queued', shape: 'gc' })

        expect(run.result.status).toBe('finished')
        expect(deleted(run)).toBe(11)
        expect(run.landing).toMatchObject({ actor: 'A', fault: 'ghost-queued', outcome: `refused:${StoreStaleGenerationError.name}` })
        expect(run.rig.checker.violations).toEqual([])
        expect(run.rig.fake.peek(COMMIT_KEY)).toEqual(run.bytesBefore.commit)
    })

    test('gate on, call in progress: B\'s registration waits for it, then B proceeds on its result', async () => {
        const run = await runScenario({ ordering: 'held', shape: 'gc' })

        expect(run.result.status).toBe('finished')
        expect(run.rig.checker.violations).toEqual([])
        const registration = run.rig.scheduler.log.find((entry) => entry.actor === 'B' && entry.op === 'registerPage')!
        expect(registration.outcome).toBe('ok-after-wait')
        expect(run.landing).toMatchObject({ actor: 'A', fault: 'ghost-held', outcome: 'landed' })
        // B read the commit key the ghost left, so its GC kept every unit A uploaded.
        expect(seqOf(run.rig.fake.peek(COMMIT_KEY))).toBe(seqOf(run.bytesBefore.commit)! + 1)
        expect(deleted(run)).toBe(0)
        expect(run.rig.fake.list('store2/')).toHaveLength(22)
        expect(run.rig.checker.violations).toEqual([])
    })

    test('gate on and the plain paths unguarded: the backend still goes only through the gate, so the ghost is refused (red under a backend that bypasses it)', async () => {
        const run = await runScenario({ store: { bypass: 'allow' }, ordering: 'queued', shape: 'gc' })

        expect(run.rig.checker.violations).toEqual([])
        expect(run.landing).toMatchObject({ actor: 'A', op: 'writeTop', outcome: `refused:${StoreStaleGenerationError.name}` })
        expect(deleted(run)).toBe(11)
        expect(run.rig.fake.peek(COMMIT_KEY)).toEqual(run.bytesBefore.commit)
    })
})

// ---- Lost update ----

describe('lost update: the ghost lands after the new page committed a newer key', () => {
    test('gate disabled: the dead page\'s key replaces B\'s commit and I3 reports the seq that was not built from the stored one', async () => {
        const run = await runScenario({ store: { gate: false }, ordering: 'queued', shape: 'lost-update' })

        expect(run.bCommit).toBe('committed')
        expect(run.landing).toMatchObject({ actor: 'A', outcome: 'landed' })
        const violations = run.rig.checker.violations.filter((violation) => violation.property === 'I3')
        expect(violations).toHaveLength(1)
        expect(violations[0].actor).toBe('A')
        expect(violations[0].step).toBe(run.landing.step)
        expect(violations[0].detail).toMatch(/wrote seq \d+ over a stored seq \d+: the value was not built from the stored version/)
        // Nothing but I3 sees it: every unit of both trees is present, so I1 holds.
        expect(run.rig.checker.violations.map((violation) => violation.property)).toEqual(['I3'])
    })

    test('gate on: the ghost is refused and B\'s commit stands', async () => {
        const run = await runScenario({ ordering: 'queued', shape: 'lost-update' })

        expect(run.bCommit).toBe('committed')
        expect(run.landing).toMatchObject({ actor: 'A', outcome: `refused:${StoreStaleGenerationError.name}` })
        expect(run.rig.checker.violations).toEqual([])
        expect(seqOf(run.rig.fake.peek(COMMIT_KEY))).toBe(seqOf(run.bytesBefore.commit)! + 1)
        expect(run.rig.fake.peek(COMMIT_KEY)).not.toEqual(run.bytesBefore.commit)
    })
})

// ---- Ghost fence delete ----

describe('ghost fence delete: a dead page\'s fence delete lands after the new page\'s fence exit', () => {
    // The ghost is a legitimate discard, and on this backend the native call carries no
    // basis, so the presented-basis rule is vacuous. What names it is the G1 rule that a
    // fence removal acts on the fence its actor last read: another page rewrote the
    // fence since. The tests also judge the stored fence directly.
    test('gate disabled: B\'s fence is gone after the landing', async () => {
        const run = await runScenario({ store: { gate: false }, ordering: 'queued', shape: 'fence-delete' })

        expect(run.bCommit).toBe('written')
        expect(run.landing).toMatchObject({ actor: 'A', op: 'removeTop', outcome: 'landed' })
        expect(run.rig.fake.peek(FENCE_KEY)).toBeNull()
        const violations = run.rig.checker.violations
        expect(violations.map((violation) => violation.property)).toEqual(['G1'])
        expect(violations[0].actor).toBe('A')
        expect(violations[0].step).toBe(run.landing.step)
        expect(violations[0].detail).toMatch(/^A \(removeTop\) removed a fence other than the one it read$/)
    })

    test('gate on: the ghost is refused and B\'s fence stands', async () => {
        const run = await runScenario({ ordering: 'queued', shape: 'fence-delete' })

        expect(run.bCommit).toBe('written')
        expect(run.landing).toMatchObject({ actor: 'A', op: 'removeTop', outcome: `refused:${StoreStaleGenerationError.name}` })
        const fence = run.rig.fake.peek(FENCE_KEY)
        expect(fence).not.toBeNull()
        expect(fence).not.toEqual(run.bytesBefore.fence)
        expect(run.rig.checker.violations).toEqual([])
    })
})

// ---- The delayed-landing fault itself ----

describe('delayed landing', () => {
    const BYTES = Uint8Array.from([7, 7, 7])

    function plan(entries: ScriptedFault[]): FaultPlan {
        return { mode: 'script', entries }
    }

    test('a queued call is kept at the crash, lands in a step of its own once landWhen holds, and is attributed to the dead actor', async () => {
        const fake = createTauriSemanticStore()
        let release = false
        const steps: StepInfo[] = []
        const scheduler = createScheduler({
            seed: 1,
            faults: plan([{ actor: 'p', op: 'writeTop', kind: 'ghost-queued', landWhen: () => release }]),
            onStep: (info) => steps.push(info),
        })
        scheduler.spawn('p', async (actor) => {
            const gate = actor.byteStore(fake.store).pageGate!
            await gate.writeTop(await gate.registerPage(), COMMIT_KEY, BYTES)
        }, { page: 'P' })
        scheduler.spawn('q', async (actor) => {
            const store = actor.byteStore(fake.store)
            await store.has(COMMIT_KEY)
            await store.has(COMMIT_KEY)
            expect(fake.peek(COMMIT_KEY)).toBeNull()
            release = true
        })
        const result = await scheduler.run()

        expect(result.status).toBe('finished')
        expect(result.actors.p.state).toBe('crashed')
        const kept = steps.find((info) => info.op === 'writeTop' && info.applied === false)!
        expect(kept).toMatchObject({ actor: 'p', fault: 'ghost-queued', applied: false })
        const landed = steps.filter((info) => info.op === 'writeTop' && info.applied)
        expect(landed).toHaveLength(1)
        expect(landed[0].step).toBeGreaterThan(kept.step)
        expect(landed[0]).toMatchObject({ actor: 'p', fault: 'ghost-queued' })
        expect(fake.peek(COMMIT_KEY)).toEqual(BYTES)
    })

    test('a landing that the gate refuses is a step with applied false and the refusal in the log', async () => {
        const fake = createTauriSemanticStore()
        let kept!: () => void
        const keptStep = new Promise<void>((resolve) => { kept = resolve })
        const scheduler = createScheduler({
            seed: 1,
            faults: plan([{ actor: 'p', op: 'writeTop', kind: 'ghost-queued', landWhen: () => fake.generation >= 2 }]),
            onStep: (info) => {
                if (info.fault === 'ghost-queued') {
                    kept()
                }
            },
        })
        scheduler.spawn('p', async (actor) => {
            const gate = actor.byteStore(fake.store).pageGate!
            await gate.writeTop(await gate.registerPage(), COMMIT_KEY, BYTES)
        }, { page: 'P' })
        scheduler.spawn('q', async (actor) => {
            await keptStep
            await actor.byteStore(fake.store).pageGate!.registerPage()
        })
        const result = await scheduler.run()

        expect(result.status).toBe('finished')
        expect(scheduler.log.find((entry) => entry.fault === 'ghost-queued' && entry.outcome !== 'ghost-queued')?.outcome).toBe(`refused:${StoreStaleGenerationError.name}`)
        expect(fake.peek(COMMIT_KEY)).toBeNull()
    })

    test('a registration granted while a ghost holds the lock is parked and completes after the landing, with the ghost\'s bytes in place', async () => {
        const fake = createTauriSemanticStore()
        const steps: StepInfo[] = []
        let kept!: () => void
        const keptStep = new Promise<void>((resolve) => { kept = resolve })
        const scheduler = createScheduler({
            seed: 1,
            faults: plan([{ actor: 'p', op: 'writeTop', kind: 'ghost-held', landWhen: () => scheduler.log.some((entry) => entry.actor === 'q' && entry.op === 'registerPage') }]),
            onStep: (info) => {
                steps.push(info)
                if (info.fault === 'ghost-held') {
                    kept()
                }
            },
        })
        let registered: number | null = null
        let seenAtRegistration: Uint8Array | null = null
        scheduler.spawn('p', async (actor) => {
            const gate = actor.byteStore(fake.store).pageGate!
            await gate.writeTop(await gate.registerPage(), COMMIT_KEY, BYTES)
        }, { page: 'P' })
        scheduler.spawn('q', async (actor) => {
            const store = actor.byteStore(fake.store)
            await keptStep
            registered = await store.pageGate!.registerPage()
            seenAtRegistration = fake.peek(COMMIT_KEY)
        })
        const result = await scheduler.run()

        expect(result.status).toBe('finished')
        const q = scheduler.log.find((entry) => entry.actor === 'q' && entry.op === 'registerPage')!
        expect(q.outcome).toBe('ok-after-wait')
        const order = steps.map((info) => `${info.actor}:${info.op}:${info.applied}`)
        expect(order.indexOf('p:writeTop:true')).toBeGreaterThan(-1)
        expect(order.indexOf('p:writeTop:true')).toBeLessThan(order.indexOf('q:registerPage:true'))
        expect(registered).toBe(2)
        expect(seenAtRegistration).toEqual(BYTES)
    })

    test('a ghost-held stale at the lock is over at once: nothing lands later', async () => {
        const fake = createTauriSemanticStore()
        let late = false
        const scheduler = createScheduler({
            seed: 1,
            faults: plan([{ actor: 'p', op: 'writeTop', kind: 'ghost-held' }]),
        })
        scheduler.spawn('p', async (actor) => {
            const gate = actor.byteStore(fake.store).pageGate!
            await gate.registerPage()
            // A generation that was never issued is stale at the lock.
            await gate.writeTop(99, COMMIT_KEY, BYTES)
            late = true
        }, { page: 'P' })
        const result = await scheduler.run()

        expect(result.status).toBe('finished')
        expect(late).toBe(false)
        expect(scheduler.log.find((entry) => entry.op === 'writeTop')?.outcome).toBe(`error:${StoreStaleGenerationError.name}`)
        expect(fake.peek(COMMIT_KEY)).toBeNull()
        expect(fake.locked).toBe(false)
    })

    test('a ghost that is never released stalls the run instead of ending it', async () => {
        const fake = createTauriSemanticStore()
        const scheduler = createScheduler({
            seed: 1,
            faults: plan([{ actor: 'p', op: 'writeTop', kind: 'ghost-queued', landWhen: () => false }]),
        })
        scheduler.spawn('p', async (actor) => {
            const gate = actor.byteStore(fake.store).pageGate!
            await gate.writeTop(await gate.registerPage(), COMMIT_KEY, BYTES)
        }, { page: 'P' })
        const result = await scheduler.run()

        expect(result.status).toBe('stalled')
        expect(fake.peek(COMMIT_KEY)).toBeNull()
    })

    test('a held ghost of a plain write cannot happen and is reported as a scripting error', async () => {
        const fake = createTauriSemanticStore()
        const scheduler = createScheduler({
            seed: 1,
            faults: plan([{ actor: 'p', op: 'write', kind: 'ghost-held' }]),
        })
        scheduler.spawn('p', async (actor) => {
            await actor.byteStore(fake.store).write('store2/x', BYTES, 'unconditional')
        }, { page: 'P' })

        await expect(scheduler.run()).rejects.toThrow('cannot happen')
    })

    test('the nth call selector counts only matching calls, and a ghost of a plain write is queued', async () => {
        const fake = createTauriSemanticStore({ bypass: 'allow' })
        const scheduler = createScheduler({
            seed: 1,
            faults: plan([{ actor: 'p', op: 'write', target: COMMIT_KEY, nth: 2, kind: 'ghost-queued' }]),
        })
        scheduler.spawn('p', async (actor) => {
            const store = actor.byteStore(fake.store)
            await store.write(COMMIT_KEY, Uint8Array.from([1]), 'unconditional')
            await store.write('store2/x', Uint8Array.from([2]), 'unconditional')
            await store.write(COMMIT_KEY, Uint8Array.from([3]), 'unconditional')
            throw new Error('unreachable: the third write crashed the actor')
        }, { page: 'P' })
        const result = await scheduler.run()

        expect(result.status).toBe('finished')
        expect(result.actors.p.state).toBe('crashed')
        // The kept write landed last, unconditionally.
        expect(fake.peek(COMMIT_KEY)).toEqual(Uint8Array.from([3]))
    })
})
