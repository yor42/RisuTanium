// @vitest-environment node
/**
 * The replay corpus: hand-built schedules of the store2 protocol, each a JSON file in
 * `corpus/`, run over the real library on the scheduled Node and Tauri stores. A
 * schedule names its actors and their programs (the operations of `ReplayActor`), the
 * start state, the calls to hold back until a step has been applied (`holds`), the
 * scripted faults, the environment damage and the seeds it runs under. The hold list
 * is what fixes an interleaving inside a library operation; the seed decides only what
 * the holds leave open.
 *
 * What a schedule asserts on the unmodified library: the run finishes, every actor ends
 * as declared, the checker reports nothing, and the outcomes the library gave are the
 * ones recorded. A schedule that is a control or covers a fault also names, under
 * `mutants`, the in-memory mutants of the library that it must catch and the property
 * each must make the checker report. That half is run by the scratch mutant runner
 * (`REPLAY_REPORT=1` makes every run print one `REPLAY-REPORT` line with its violations,
 * its status and its actors' states): a mutant is red only for a checker violation of the
 * named property, never for a throw, a refusal, a stall or a timeout.
 *
 * The controls come from the model's mutation controls (S0-5a), replayed as interleaving
 * classes on the library's own call order (plan amendment A), not step for step: the
 * model lists first and deletes one key per request, the library marks, reads the fence,
 * lists and deletes in batches of 25. Each control holds the same race, GC against a
 * writer, at the library's calls.
 *  - c1: GC without the check-only on the commit key;
 *  - c2: the writer's commit write without the check-only on its new units;
 *  - c4: a bulk commit whose units the marker no longer protects;
 *  - c5: the commit write at a fresh read instead of the version the value was built from;
 *  - offNodeNoMutex: the model's off-Node run with every check off. The library analog is
 *    Tauri's `underMutex` removed: the Tauri backend compares and writes with no
 *    server-side precondition, so the mutex is the whole of its atomicity. The model run
 *    removes the preconditions as well; the library has none to remove on Tauri.
 *
 * Control (iii), the retention list in a separate key, is structurally excluded, not
 * caught: retention lives inside the commit key and the format is frozen, so there is no
 * second key whose write could be separated from the commit.
 */
import { describe, expect, test } from 'vitest'
import { encodeUnit, newUnitKey, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import type { ExitResult } from 'src/ts/storage/store2/recovery'
import { createClock, testEnv } from '../commitFixtures'
import {
    outcomeLabel, stepMatches, type CallHold, type ReplayActor, type ReplayRig, type ReplayRigOptions, type StartState, type StepMatch,
} from './actors'
import type { PropertyId } from './checker'
import { createNodeReplayRig } from './nodeRig'
import { GARBAGE } from './replayFixtures'
import { createTauriReplayRig } from './tauriRig'
import type { EnvFault, FaultKind, OperationKind, PolicyConfig, ScriptedFault, StepInfo } from './scheduler'

// ---- The corpus format ----

type ProgramStep =
    | { do: 'open', upstreamMainFile?: boolean }
    | { do: 'commit', tag: string, extra?: number }
    | { do: 'bulk', tag: string }
    | { do: 'gc' }
    | { do: 'exit', kind: 'convert' | 'import' | 'seed' }
    /** The newest candidate is picked and installed. */
    | { do: 'recover' }
    | { do: 'candidates' }
    | { do: 'fenceExit' }
    | { do: 'discardFence' }
    | { do: 'clearMarker' }
    /** Waits until the nth applied step the match selects has been judged. */
    | { do: 'waitFor', match: StepMatch }

interface ActorSpec {
    id: string
    seed: number
    foreignClear?: 'yes' | 'no'
    page?: string
    device?: string
    program: ProgramStep[]
}

interface FaultSpec {
    actor: string
    kind: FaultKind
    write?: number
    op?: string | string[]
    target?: string
    context?: OperationKind
    nth?: number
}

interface EnvSpec {
    name: EnvFault
    /** Registered once a step the match selects has been judged; at the start when absent. */
    after?: StepMatch
}

export interface CorpusSchedule {
    name: string
    /** What the schedule is about: the race, the fault or the damage. */
    covers: string
    variant: 'node' | 'tauri' | 'indexeddb'
    /** Set when the schedule cannot run yet; it is written against the actor interface and is skipped, with the reason shown. */
    pending?: { until: string, reason: string }
    start: StartState
    /** Unreferenced units planted before the run, so a collection pass has something to delete. */
    garbage?: number
    /** The seeds every run is green under on the unmodified library. */
    seeds: number[]
    /** The seeds the mutants of mutants are red under, when the holds leave the race open to the seed; all of seeds otherwise. */
    redSeeds?: number[]
    policy?: PolicyConfig
    holds?: Array<{ call: CallHold['call'], until: StepMatch }>
    faults?: FaultSpec[]
    env?: EnvSpec[]
    actors: ActorSpec[]
    expect: {
        /** Final state of each actor; `done` unless listed. */
        actors?: Record<string, 'done' | 'crashed'>
        /** The outcome labels of each actor in order, when the holds fix them for every seed. */
        outcomes?: Record<string, string[]>
    }
    /** Mutant id (of the scratch runner) to the property it must make the checker report on this schedule. */
    mutants?: Record<string, PropertyId>
    /** How the model's trace maps to the library's calls, for a control. */
    labels?: Record<string, string>
}

const MAX_STEPS = 20_000

// ---- Running a schedule ----

function exitLabel(result: ExitResult): string {
    return result.status === 'marked' ? `marked@seq=${result.marker.seq}` : outcomeLabel(result)
}

async function runProgramStep(actor: ReplayActor, step: ProgramStep): Promise<string> {
    switch (step.do) {
        case 'open':
            await actor.open({ upstreamMainFile: step.upstreamMainFile })
            return 'open'
        case 'commit':
            return `commit:${outcomeLabel((await actor.commit(step.tag, step.extra)).result)}`
        case 'bulk':
            return `bulk:${outcomeLabel((await actor.bulkCommit(step.tag)).result)}`
        case 'gc': {
            const result = await actor.gcPass()
            return `gc:${result.status === 'done' ? `${outcomeLabel(result)}:${result.deleted}` : outcomeLabel(result)}`
        }
        case 'exit':
            return `exit:${exitLabel(await actor.runExit(step.kind))}`
        case 'recover': {
            const listed = await actor.listRecoveryCandidates()
            if (listed.status !== 'listed' || listed.candidates.length === 0) {
                return 'recover:no-candidate'
            }
            const picked = await actor.pickCandidate()
            if (picked.status !== 'ready') {
                return `recover:pick:${outcomeLabel(picked)}`
            }
            return `recover:installed:${outcomeLabel(await actor.installPick(picked))}`
        }
        case 'candidates': {
            const listed = await actor.listRecoveryCandidates()
            return `candidates:${listed.status === 'listed' ? listed.candidates.length : 'failed'}`
        }
        case 'fenceExit':
            return `fenceExit:${outcomeLabel(await actor.fenceExit())}`
        case 'discardFence':
            return `discardFence:${outcomeLabel(await actor.discardFence())}`
        case 'clearMarker': {
            const outcome = await actor.clearMarker()
            return `clearMarker:${outcome.decision}${outcome.cleared === null ? '' : `:${outcomeLabel(outcome.cleared)}`}`
        }
        case 'waitFor':
            await actor.rig.reached(step.match)
            return 'waitFor'
    }
}

export interface RunReport {
    schedule: string
    seed: number
    status: string
    steps: number
    /** Each actor's final state, with the error of a failed one. */
    actors: Record<string, string>
    violations: Array<{ property: PropertyId, step: number, actor: string, detail: string }>
    outcomes: Record<string, string[]>
}

function scriptedFault(spec: FaultSpec): ScriptedFault {
    if (spec.write !== undefined) {
        return { actor: spec.actor, kind: spec.kind, write: spec.write }
    }
    return { actor: spec.actor, kind: spec.kind, op: spec.op ?? [], target: spec.target, context: spec.context, nth: spec.nth }
}

async function makeRig(spec: CorpusSchedule, seed: number): Promise<ReplayRig> {
    const options: ReplayRigOptions = {
        scheduler: {
            seed,
            policy: spec.policy,
            faults: spec.faults === undefined ? { mode: 'none' } : { mode: 'script', entries: spec.faults.map(scriptedFault) },
        },
        start: spec.start,
        holds: spec.holds,
        prepare: (hooks, env) => {
            for (let i = 0; i < (spec.garbage ?? 0); i++) {
                hooks.plant(newUnitKey(env), encodeUnit(UNIT_TYPE.preset, { v: 1, tag: 'garbage', i }))
            }
        },
    }
    if (spec.variant === 'node') {
        return createNodeReplayRig(options)
    }
    if (spec.variant === 'tauri') {
        return createTauriReplayRig(options)
    }
    throw new Error(`The ${spec.variant} variant has no rig yet.`)
}

export async function runSchedule(spec: CorpusSchedule, seed: number): Promise<RunReport> {
    const rig = await makeRig(spec, seed)
    const outcomes: Record<string, string[]> = {}
    for (const actorSpec of spec.actors) {
        outcomes[actorSpec.id] = []
        const ask = actorSpec.foreignClear === undefined ? undefined : async (): Promise<boolean> => actorSpec.foreignClear === 'yes'
        rig.spawn(actorSpec.id, actorSpec.seed, async (actor) => {
            for (const step of actorSpec.program) {
                outcomes[actorSpec.id].push(await runProgramStep(actor, step))
            }
        }, { foreignClear: ask, page: actorSpec.page, device: actorSpec.device })
    }
    for (const env of spec.env ?? []) {
        const register = (): void => {
            rig.scheduler.environment(env.name, env.name, () => {
                rig.hooks.plant(env.name === 'damage-commit' ? COMMIT_KEY : FENCE_KEY, GARBAGE)
            })
        }
        if (env.after === undefined) {
            register()
        } else {
            void rig.reached(env.after).then(register)
        }
    }
    const result = await rig.run({ maxSteps: MAX_STEPS })
    const report: RunReport = {
        schedule: spec.name,
        seed,
        status: result.status,
        steps: result.steps,
        actors: Object.fromEntries(Object.entries(result.actors).map(([id, actor]) => [id, actor.state === 'failed' ? `failed:${actor.error ?? ''}` : actor.state])),
        violations: rig.checker.violations.map((violation) => ({ property: violation.property, step: violation.step, actor: violation.actor, detail: violation.detail })),
        outcomes,
    }
    if (process.env.REPLAY_REPORT === '1') {
        console.log(`REPLAY-REPORT ${JSON.stringify(report)}`)
    }
    if (process.env.REPLAY_TRACE === '1') {
        // The call log, for reproducing a seed by hand: one line per step.
        const lines = rig.scheduler.log.map((entry) => `${entry.step} ${entry.actor} ${entry.op} ${entry.target} ${entry.fault ?? ''} ${entry.outcome}`)
        console.log(`REPLAY-TRACE ${spec.name} seed ${seed}\n${lines.join('\n')}`)
    }
    return report
}

// ---- The corpus ----

const files = import.meta.glob<CorpusSchedule>('./corpus/*.json', { eager: true, import: 'default' })
const schedules = Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))

describe('the corpus files', () => {
    test('there is a corpus, and each file is named for its schedule', () => {
        expect(schedules.length).toBeGreaterThan(0)
        for (const [path, spec] of schedules) {
            expect(path).toBe(`./corpus/${spec.name}.json`)
        }
    })

    test('a schedule that cannot run yet says until when and why; every other one has a rig', () => {
        for (const [, spec] of schedules) {
            if (spec.pending === undefined) {
                expect(['node', 'tauri'], spec.name).toContain(spec.variant)
            } else {
                expect(spec.pending.until, spec.name).not.toBe('')
                expect(spec.pending.reason, spec.name).not.toBe('')
            }
        }
    })

    test('the red seeds of a schedule are among its seeds', () => {
        for (const [, spec] of schedules) {
            for (const seed of spec.redSeeds ?? []) {
                expect(spec.seeds, spec.name).toContain(seed)
            }
        }
    })

    test('a mutant a schedule names is one of the property ids the checker reports', () => {
        const properties: readonly string[] = ['I1', 'b', 'I2', 'I3', 'h', 'h2', 'G1', 'G10', 'i', 'p', 'r', 'I4']
        for (const [, spec] of schedules) {
            for (const [mutant, property] of Object.entries(spec.mutants ?? {})) {
                expect(properties, `${spec.name}/${mutant}`).toContain(property)
            }
        }
    })
})

describe.each(schedules.map(([, spec]) => spec))('replay: $name', (spec) => {
    if (spec.pending !== undefined) {
        test.skip(`${spec.covers} (pending ${spec.pending.until}: ${spec.pending.reason})`, () => undefined)
        return
    }
    test.each(spec.seeds)(`${spec.covers} (seed %i): no violation, the declared outcomes`, async (seed) => {
        const report = await runSchedule(spec, seed)
        expect(report.violations).toEqual([])
        expect(report.status).toBe('finished')
        const expected: Record<string, string> = {}
        for (const actor of spec.actors) {
            expected[actor.id] = spec.expect.actors?.[actor.id] ?? 'done'
        }
        expect(report.actors).toEqual(expected)
        if (spec.expect.outcomes !== undefined) {
            expect(report.outcomes).toEqual(spec.expect.outcomes)
        }
    })
})

// Part (ii), the 409/404 categories and the model's surprises 1, 2, 3 and 6, comes from a separate exporter of the
// model's first path per category; each category gets a schedule here, and a category with no library flow is listed
// with the reason.
test.todo('part (ii): one schedule per 409/404 category of the model, from the exporter')

// ---- The driver's own features ----

describe('holds and step matches', () => {
    const applied = (extra: Partial<StepInfo>): StepInfo => ({
        step: 1, actor: 'a', kind: 'call', op: 'writeChecked', target: COMMIT_KEY, applied: true, fault: null, context: { kind: 'commit' },
        commitExpect: null, fenceExpect: null, ...extra,
    })

    test('a match selects by actor, op, target class and declared operation, and never an unapplied step', () => {
        const info = applied({})
        expect(stepMatches(info, { actor: 'a', op: 'writeChecked', target: '$commit', context: 'commit' })).toBe(true)
        expect(stepMatches(info, { op: ['write', 'writeChecked'] })).toBe(true)
        expect(stepMatches(info, { actor: 'b' })).toBe(false)
        expect(stepMatches(info, { target: '$fence' })).toBe(false)
        expect(stepMatches(info, { target: '$unit' })).toBe(false)
        expect(stepMatches(info, { context: 'gc' })).toBe(false)
        expect(stepMatches(applied({ target: newUnitKey(testEnv(createClock(), 1)) }), { target: '$unit' })).toBe(true)
        expect(stepMatches(applied({ target: 'assets/not-a-unit' }), { target: '$unit' })).toBe(false)
        expect(stepMatches(applied({ applied: false }), { op: 'writeChecked' })).toBe(false)
        expect(stepMatches(applied({ target: FENCE_KEY }), { target: '$fence' })).toBe(true)
    })

    function twoWriters(holds: ReplayRigOptions['holds']): Promise<ReplayRig> {
        return createNodeReplayRig({ scheduler: { seed: 1 }, holds })
    }

    test('a held call is requested only after the step has been applied: b\'s commit-key write follows a\'s', async () => {
        const rig = await twoWriters([{ call: { actor: 'b', op: 'writeChecked', target: '$commit' }, until: { actor: 'a', op: 'writeChecked', target: '$commit' } }])
        for (const [id, seed] of [['a', 10], ['b', 11]] as const) {
            rig.spawn(id, seed, async (actor) => {
                await actor.open()
                await actor.commit(id)
            })
        }
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('finished')
        const writes = rig.scheduler.log.filter((entry) => entry.op === 'writeChecked' && entry.target === COMMIT_KEY).map((entry) => entry.actor)
        expect(writes).toEqual(['a', 'b'])
        expect(rig.checker.violations).toEqual([])
    })

    test('a hold that can never be released ends the run stalled, not finished', async () => {
        const rig = await twoWriters([{ call: { actor: 'a', op: 'writeChecked', target: '$commit' }, until: { actor: 'nobody' } }])
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            await actor.commit('a')
        })
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('stalled')
    })

    test('a hold applies to the nth matching call only', async () => {
        const rig = await twoWriters([{ call: { actor: 'a', op: 'writeChecked', target: '$unit', nth: 3 }, until: { actor: 'a', op: 'writeChecked', target: '$commit' } }])
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            await actor.commit('a')
        })
        // The third unit upload waits for the commit-key write, which waits for every unit: the other ten uploads are all that happens.
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('stalled')
        expect(rig.scheduler.log.filter((entry) => entry.op === 'writeChecked' && entry.target !== COMMIT_KEY)).toHaveLength(10)
    })
})
