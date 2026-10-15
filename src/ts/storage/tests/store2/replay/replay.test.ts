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
 *
 * Part (ii) maps the model's 409/404 categories and surprises to schedules (`corpusIndex.ts`):
 * each schedule drives the library to the counterpart of the category and declares the
 * reaction the library has there, which is not always the model's (the library judges a
 * conflicted bulk final write again where the model parks, and a missing base manifest at boot
 * is the recovery screen where the model re-reads the commit key). A mutant whose effect is a
 * different answer rather than a broken property is named `outcome`.
 *
 * Several holds on one call selector (same actor, op, target and context) catch that
 * selector's calls one each, in list order: a gate that has caught a call hands the next
 * call to the next hold, so the list is how a schedule holds the first, second and third
 * such call. `nth` on a hold's `call` is for the only hold of a selector.
 */
import { describe, expect, test } from 'vitest'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, newUnitKey, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import type { ExitResult } from 'src/ts/storage/store2/recovery'
import { createClock, testEnv } from '../commitFixtures'
import {
    outcomeLabel, stepMatches, type CallHold, type ReplayActor, type ReplayRig, type ReplayRigOptions, type StartState, type StepMatch,
} from './actors'
import type { PropertyId } from './checker'
import { CORPUS_INDEX } from './corpusIndex'
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
    /** The newest candidate is picked and installed, or the seeded tree's manifest when `pick` is `seed`. */
    | { do: 'recover', pick?: 'seed' }
    /** What the boot decided: the table row and mode of `Store2Session.open`. */
    | { do: 'decision' }
    /** What the start-up clear of the page's own marker came to at boot. */
    | { do: 'startupClear' }
    /** The clock moves past the admission interval and an ordinary commit follows, `times` times over. */
    | { do: 'admit', tag: string, times?: number }
    /** Restores the seeded tree's manifest, or the newest retained one, from a fresh read of the commit key. */
    | { do: 'restore', to: 'seed' | 'retained' }
    /** Pins the manifest the fresh read names as current. */
    | { do: 'pin' }
    /** Clears the marker the fresh read shows, naming its prefix. */
    | { do: 'abandonClear' }
    /** Tauri: the page is gone and a new one opens on the same device. */
    | { do: 'restart' }
    | { do: 'candidates' }
    | { do: 'fenceExit' }
    | { do: 'discardFence' }
    | { do: 'clearMarker' }
    /** What a fresh read of the commit key shows: whether `current` and each `retained` entry is the seeded tree's manifest (`seed`) or another one (`other`). */
    | { do: 'finalKey' }
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

/** The manifest a `remove-unit` step takes out, resolved from the commit key as it stands when the step is taken. */
type LostManifest = 'seed' | 'current' | 'retained'

interface EnvSpec {
    name: EnvFault
    /** Registered once a step the match selects has been judged; at the start when absent. */
    after?: StepMatch
    /** For `remove-unit`: which manifest of the commit key goes (the first retained one, the current one, or the seeded tree's). */
    unit?: LostManifest
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
    /** Why `redSeeds` is narrower than seeds, when it is. */
    redSeedsReason?: string
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
    /**
     * Mutant id (of the scratch runner) to the property it must make the checker report on this schedule; `outcome`
     * names a mutant that changes what the library answers without breaking a property, so the declared outcomes differ.
     */
    mutants?: Record<string, PropertyId | 'outcome'>
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
            const picked = await actor.pickCandidate(step.pick === 'seed' ? seeded(actor) : undefined)
            if (picked.status !== 'ready') {
                // An invalid pick says whether the exit's marker had landed before the tree read failed.
                return `recover:pick:${outcomeLabel(picked)}${picked.status === 'invalid' ? (picked.marked === null ? ':unmarked' : ':marked') : ''}`
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
        case 'finalKey': {
            const key = await actor.readKey()
            if (key === null) {
                return 'finalKey:unparsed'
            }
            const named = (manifest: string): string => (manifest === actor.rig.seedManifest ? 'seed' : 'other')
            return `finalKey:current=${key.current === null ? 'none' : named(key.current.key)};retained=${key.retained.length === 0 ? 'none' : key.retained.map((entry) => named(entry.key)).join(',')}`
        }
        case 'waitFor':
            await actor.rig.reached(step.match)
            return 'waitFor'
        case 'decision': {
            const decision = actor.session.decision
            return `decision:${decision.row === null ? 'none' : decision.row}:${decision.mode}${'tree' in decision ? `:${decision.tree}` : ''}`
        }
        case 'startupClear': {
            const cleared = actor.session.startupClear
            return `startupClear:${cleared === null ? 'none' : outcomeLabel(cleared)}`
        }
        case 'admit': {
            const labels: string[] = []
            for (let i = 0; i < (step.times ?? 1); i++) {
                labels.push(outcomeLabel((await actor.admit(step.tag)).result))
            }
            return `admit:${labels.every((label) => label === labels[0]) ? `${labels[0]}*${labels.length}` : labels.join(',')}`
        }
        case 'restore': {
            const key = step.to === 'seed' ? seeded(actor) : (await actor.readKey())?.retained[0]?.key
            if (key === undefined) {
                throw new Error('There is no manifest to restore.')
            }
            return `restore:${outcomeLabel(await actor.restore(key))}`
        }
        case 'pin': {
            const named = (await actor.readKey())?.current
            if (named === null || named === undefined) {
                throw new Error('The commit key names no current manifest to pin.')
            }
            return `pin:${outcomeLabel(await actor.pin(named.key))}`
        }
        case 'abandonClear': {
            const standing = (await actor.readKey())?.staging
            if (standing === null || standing === undefined) {
                return 'abandonClear:no-marker'
            }
            return `abandonClear:${outcomeLabel(await actor.abandonClear(standing.prefix))}`
        }
        case 'restart':
            await actor.restart()
            return 'restart'
    }
}

/** The manifest key of the seeded tree; a schedule that asks for it starts from a seeded store. */
function seeded(actor: ReplayActor): string {
    const key = actor.rig.seedManifest
    if (key === null) {
        throw new Error('The store was not seeded.')
    }
    return key
}

/** The key of the manifest a `remove-unit` step names, from the commit key as it stands now. */
function lostManifestKey(rig: ReplayRig, unit: LostManifest | undefined): string {
    if (unit === undefined) {
        throw new Error('A remove-unit step names the manifest it removes.')
    }
    if (unit === 'seed') {
        if (rig.seedManifest === null) {
            throw new Error('The store was not seeded.')
        }
        return rig.seedManifest
    }
    const read = classifyCommitRead({ bytes: rig.hooks.peek(COMMIT_KEY) })
    if (read.status !== 'parsed') {
        throw new Error('The commit key does not parse: there is no manifest to name.')
    }
    const named = unit === 'current' ? read.value.current?.key : read.value.retained[0]?.key
    if (named === undefined) {
        throw new Error(`The commit key names no ${unit} manifest.`)
    }
    return named
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
                if (env.name === 'remove-unit') {
                    rig.hooks.remove(lostManifestKey(rig, env.unit))
                    return
                }
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

    test('a mutant a schedule names is one of the property ids the checker reports, or an outcome mismatch', () => {
        const properties: readonly string[] = ['I1', 'b', 'I2', 'I3', 'h', 'h2', 'G1', 'G10', 'i', 'p', 'r', 'I4', 'INST', 'outcome']
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

// Part (ii): the model's 409/404 categories and its surprises. Each is a schedule on the library's call order, a pending
// schedule, or an entry without one that says why; nothing is dropped silently.
describe('the model\'s categories and surprises (part ii)', () => {
    const byName = new Map(schedules.map(([, spec]) => [spec.name, spec]))

    test('every category and surprise has an entry, and every part (ii) file is an entry', () => {
        const ids = CORPUS_INDEX.map((entry) => entry.id)
        expect(new Set(ids).size).toBe(ids.length)
        const categories = Array.from({ length: 18 }, (_, i) => `c409-${String(i + 1).padStart(2, '0')}`)
        expect([...categories, 'surprise-s1', 'surprise-s2', 'surprise-s3', 'surprise-s3c', 'surprise-s6'].filter((id) => !ids.includes(id))).toEqual([])
        const named = new Set(CORPUS_INDEX.flatMap((entry) => (entry.schedule === null ? [] : [entry.schedule])))
        const part2 = schedules.map(([, spec]) => spec.name).filter((name) => name.startsWith('c409_') || name.startsWith('surprise_'))
        expect(part2.filter((name) => !named.has(name))).toEqual([])
    })

    test('an entry\'s kind agrees with its corpus file, and an entry without a schedule says why', () => {
        for (const entry of CORPUS_INDEX) {
            expect(entry.note, entry.id).not.toBe('')
            if (entry.kind === 'none') {
                expect(entry.schedule, entry.id).toBeNull()
                continue
            }
            const spec = byName.get(entry.schedule ?? '')
            expect(spec, `${entry.id}: ${entry.schedule}`).toBeDefined()
            expect(spec?.pending !== undefined, entry.id).toBe(entry.kind === 'pending')
        }
    })

    test('a schedule of part (ii) asserts the library\'s outcomes', () => {
        for (const entry of CORPUS_INDEX) {
            const spec = byName.get(entry.schedule ?? '')
            if (spec !== undefined && spec.pending === undefined) {
                expect(Object.keys(spec.expect.outcomes ?? {}).length, spec.name).toBeGreaterThan(0)
            }
        }
    })
})

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

    test('holds on one call selector catch the matching calls in list order, one call each', async () => {
        const never = { actor: 'nobody' }
        const rig = await twoWriters([
            { call: { actor: 'a', op: 'writeChecked', target: '$unit' }, until: never },
            { call: { actor: 'a', op: 'writeChecked', target: '$unit' }, until: never },
        ])
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            await actor.commit('a')
        })
        // The commit uploads eleven units: the first two calls are held, nine are applied, and the commit-key write never comes.
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('stalled')
        expect(rig.scheduler.log.filter((entry) => entry.op === 'writeChecked' && entry.target !== COMMIT_KEY)).toHaveLength(9)
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
