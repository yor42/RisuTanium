// @vitest-environment node
/**
 * Every actor operation runs to termination on a healthy start and on each failure
 * start state, on Node and on Tauri, with no checker violation. A run ends in one
 * of four ways, and the matrix keeps them apart (plan E1): an outcome the library
 * reports (`committed`, `refused:absent`, ...), a throw, a stall or step limit, or a
 * violation. Only the first is a result of the protocol; a cell that ends any other
 * way is named for what it is (`threw:`, `hung:`, `violation:`) and fails the test,
 * never passing as green or as red.
 *
 * Thirty unreferenced units are planted before every run, so a garbage-collection
 * pass of a healthy store takes more than one batch and a refusal is a refusal to
 * delete something.
 */
import { describe, expect, test } from 'vitest'
import { encodeUnit, newManifestKey, newUnitKey, UNIT_TYPE, type KeyEnv } from 'src/ts/storage/store2/format'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { runExit } from 'src/ts/storage/store2/recovery'
import type { SessionDecision, Store2Session } from 'src/ts/storage/store2/session'
import {
    FOREIGN_OWNER, outcomeLabel, START_STATES, type ReplayActor, type ReplayRig, type ReplayRigOptions, type ReplayVariant, type StartState, type StateHooks,
} from './actors'
import { createNodeReplayRig } from './nodeRig'
import { createTauriReplayRig } from './tauriRig'
import { createClock, testEnv } from '../commitFixtures'
import type { StepInfo } from './scheduler'
import type { ForeignClearHook } from 'src/ts/storage/store2/owner'

type RigFactory = (options: ReplayRigOptions) => Promise<ReplayRig>

const BACKENDS: ReadonlyArray<{ variant: ReplayVariant, make: RigFactory }> = [
    { variant: 'node', make: createNodeReplayRig },
    { variant: 'tauri', make: createTauriReplayRig },
]

const MAX_STEPS = 20_000
const GARBAGE_UNITS = 30
const SCHEDULER_SEEDS = [1, 2, 3]

function plantGarbage(hooks: StateHooks, env: KeyEnv): void {
    for (let i = 0; i < GARBAGE_UNITS; i++) {
        hooks.plant(newUnitKey(env), encodeUnit(UNIT_TYPE.preset, { v: 1, tag: 'garbage', i }))
    }
}

// ---- One operation of one actor, as a program that names its outcome ----

type Program = (actor: ReplayActor) => Promise<string>

async function currentManifest(actor: ReplayActor): Promise<string> {
    return (await actor.readKey())?.current?.key ?? newManifestKey(actor.env)
}

async function candidateCount(actor: ReplayActor): Promise<number> {
    const listed = await actor.listRecoveryCandidates()
    return listed.status === 'listed' ? listed.candidates.length : -1
}

/** Picks the newest candidate and installs it, naming the step each stopped at. */
async function pickAndInstall(actor: ReplayActor): Promise<string> {
    if (await candidateCount(actor) <= 0) {
        return 'no-candidate'
    }
    const picked = await actor.pickCandidate()
    if (picked.status !== 'ready') {
        return `pick:${outcomeLabel(picked)}`
    }
    return `pick:ready/install:${outcomeLabel(await actor.installPick(picked))}`
}

const OPERATIONS: Readonly<Record<string, Program>> = {
    commit: async (actor) => outcomeLabel((await actor.commit('c')).result),
    bulk: async (actor) => outcomeLabel((await actor.bulkCommit('b')).result),
    'save-mine': async (actor) => outcomeLabel((await actor.saveMine('s')).result),
    restore: async (actor) => {
        await actor.admit('p')
        const key = (await actor.readKey())?.retained[0]?.key ?? newManifestKey(actor.env)
        return outcomeLabel(await actor.restore(key))
    },
    pin: async (actor) => outcomeLabel(await actor.pin(await currentManifest(actor))),
    unpin: async (actor) => {
        const key = await currentManifest(actor)
        await actor.pin(key)
        return outcomeLabel(await actor.unpin(key))
    },
    admit: async (actor) => outcomeLabel((await actor.admit('a')).result),
    'abandon-clear': async (actor) => outcomeLabel(await actor.abandonClear((await actor.readKey())?.staging?.prefix ?? 'store2/g-none-')),
    'clear-marker': async (actor) => {
        const outcome = await actor.clearMarker()
        return `${outcome.decision}${outcome.cleared === null ? '' : `:${outcomeLabel(outcome.cleared)}`}`
    },
    gc: async (actor) => {
        const result = await actor.gcPass()
        return result.status === 'done' ? `${outcomeLabel(result)}:${result.deleted}` : outcomeLabel(result)
    },
    candidates: async (actor) => `listed:${await candidateCount(actor)}`,
    'exit-convert': async (actor) => outcomeLabel(await actor.runExit('convert')),
    'exit-import': async (actor) => outcomeLabel(await actor.runExit('import')),
    'exit-seed': async (actor) => outcomeLabel(await actor.runExit('seed')),
    pick: pickAndInstall,
    'fence-exit': async (actor) => outcomeLabel(await actor.fenceExit()),
    'fence-discard': async (actor) => outcomeLabel(await actor.discardFence()),
}

/**
 * What the protocol answers, by operation and start state; the refusals name their kind.
 * The exit and pick cells on the live states are what the library does when it is called,
 * and they over-approximate what the app reaches: boot never offers recovery on a healthy tree.
 */
function expectedOutcome(variant: ReplayVariant, state: StartState, operation: string): string {
    const group = state === 'healthy' || state === 'standing-fence' || state === 'damaged-fence' ? 'live'
        : state === 'damaged-commit' || state === 'both-damaged' ? 'damaged'
            : state === 'no-commit-key' ? 'absent' : 'marker'
    const refusal = group === 'damaged' ? 'refused:damaged' : group === 'absent' ? 'refused:absent' : 'refused:no-current'
    switch (operation) {
        case 'commit': case 'bulk': case 'admit': case 'pin': case 'unpin': case 'restore':
            return group === 'live' ? 'committed' : refusal
        case 'save-mine':
            return group === 'live' ? (variant === 'tauri' ? 'committed' : 'refused:node-save-mine') : refusal
        case 'abandon-clear':
            return group === 'live' ? 'nothing' : group === 'marker' ? 'refused:not-mine' : refusal
        case 'clear-marker':
            return group === 'live' ? 'none' : group === 'marker' ? 'clear:cleared' : `none:${refusal}`
        case 'gc':
            return state === 'healthy' ? `done:${GARBAGE_UNITS}`
                : state === 'standing-fence' ? 'done:0'
                    : state === 'damaged-fence' ? 'refused:fence-unparsable'
                        : group === 'marker' ? 'refused:no-current' : 'refused:mark-refused'
        case 'candidates':
            return group === 'absent' ? 'listed:0' : 'listed:1'
        case 'exit-convert': case 'exit-import': case 'exit-seed':
            return 'marked:written'
        case 'pick':
            return group === 'absent' ? 'no-candidate' : 'pick:ready/install:installed'
        case 'fence-exit':
            return 'written'
        case 'fence-discard':
            return 'discarded'
        default:
            throw new Error(`No expectation for ${operation}.`)
    }
}

interface Cell {
    variant: ReplayVariant
    state: StartState
    operation: string
    seed: number
    /** What the protocol reported, or what went wrong instead: `threw:`, `hung:`, `violation:`. */
    outcome: string
    steps: number
}

async function runCell(make: RigFactory, variant: ReplayVariant, state: StartState, operation: string, seed: number): Promise<Cell> {
    const rig = await make({ scheduler: { seed }, start: state, prepare: plantGarbage })
    let outcome = 'unfinished'
    rig.spawn('a', 10, async (actor) => {
        await actor.open({ upstreamMainFile: state === 'marker-convert' })
        outcome = await OPERATIONS[operation](actor)
    }, { foreignClear: async () => true })
    const result = await rig.run({ maxSteps: MAX_STEPS })
    const report = result.actors.a
    const violations = rig.checker.violations
    let label = outcome
    if (violations.length > 0) {
        label = `violation:${violations.map((violation) => violation.property).join(',')}`
    } else if (result.status !== 'finished') {
        label = `hung:${result.status}`
    } else if (report.state !== 'done') {
        label = `threw:${report.state}:${report.error ?? ''}`
    }
    return { variant, state, operation, seed, outcome: label, steps: result.steps }
}

describe('every actor on every start state', () => {
    test.each(BACKENDS)('$variant: each operation ends in the outcome the protocol gives, under every scheduler seed', async ({ variant, make }) => {
        const mismatches: string[] = []
        let cells = 0
        for (const state of START_STATES) {
            for (const operation of Object.keys(OPERATIONS)) {
                for (const seed of SCHEDULER_SEEDS) {
                    const cell = await runCell(make, variant, state, operation, seed)
                    cells++
                    const expected = expectedOutcome(variant, state, operation)
                    if (cell.outcome !== expected) {
                        mismatches.push(`${variant}|${state}|${operation}|seed ${seed}: ${cell.outcome} (expected ${expected})`)
                    }

                }
            }
        }
        expect(cells).toBe(START_STATES.length * Object.keys(OPERATIONS).length * SCHEDULER_SEEDS.length)
        expect(mismatches).toEqual([])
    }, 240_000)
})

// ---- What each operation declares to the checker ----

interface Observed {
    rig: ReplayRig
    steps: StepInfo[]
}

async function observed(make: RigFactory, state: StartState, program: (actor: ReplayActor) => Promise<void>, options: { markerOwner?: string, seed?: number, foreignClear?: ForeignClearHook } = {}): Promise<Observed> {
    const steps: StepInfo[] = []
    const rig = await make({ scheduler: { seed: options.seed ?? 1 }, start: state, observe: (info) => steps.push(info), markerOwner: options.markerOwner, prepare: plantGarbage })
    rig.spawn('a', 10, async (actor) => {
        await actor.open()
        await program(actor)
    }, { foreignClear: options.foreignClear })
    const result = await rig.run({ maxSteps: MAX_STEPS })
    expect(result.status).toBe('finished')
    expect(result.actors.a.state).toBe('done')
    return { rig, steps }
}

/** The contexts of the applied writes of `key` that are not the boot re-flush, in order. */
function writeContexts(steps: readonly StepInfo[], key: string): Array<string | null> {
    return steps
        .filter((step) => step.kind === 'call' && step.applied && step.target === key && ['write', 'writeChecked', 'writeTop', 'removeTop', 'removeChecked', 'delete'].includes(step.op))
        .map((step) => step.context?.kind ?? null)
        .filter((kind) => kind !== 'read')
}

describe.each(BACKENDS)('$variant: the writes whose kind depends on the value are labelled from the actor\'s intent', ({ make }) => {
    test('a bulk commit: its marker is a bulk-begin and its final write a bulk-final', async () => {
        const { rig, steps } = await observed(make, 'healthy', async (actor) => {
            expect((await actor.bulkCommit('b')).result.status).toBe('committed')
        })
        expect(writeContexts(steps, COMMIT_KEY)).toEqual(['bulk-begin', 'bulk-final'])
        expect(rig.checker.violations).toEqual([])
    })

    test('a bulk commit whose final write is lost every time is abandoned: its clear of its own marker is an abandon-clear', async () => {
        const steps: StepInfo[] = []
        const final = () => ({ actor: 'a', op: ['writeChecked', 'writeTop'], target: COMMIT_KEY, context: 'bulk-final' as const, nth: 1, kind: 'lost-request' as const })
        const rig = await make({
            scheduler: { seed: 1, faults: { mode: 'script', entries: [final(), final(), final()] } },
            observe: (info) => steps.push(info),
        })
        let outcome = ''
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            outcome = outcomeLabel((await actor.bulkCommit('b')).result)
        })
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('finished')
        expect(result.actors.a.state).toBe('done')
        expect(outcome).toBe('abandoned:rejudge-exhausted')
        expect(writeContexts(steps, COMMIT_KEY)).toEqual(['bulk-begin', 'abandon-clear'])
        expect(rig.checker.violations).toEqual([])
    })

    test('a recovery exit: the fence is a fence-exit, the marker a recovery-begin, and the install a recovery-install', async () => {
        const { rig, steps } = await observed(make, 'damaged-commit', async (actor) => {
            expect(await pickAndInstall(actor)).toBe('pick:ready/install:installed')
        })
        expect(writeContexts(steps, FENCE_KEY)).toEqual(['fence-exit'])
        expect(writeContexts(steps, COMMIT_KEY)).toEqual(['recovery-begin', 'recovery-install'])
        expect(rig.checker.violations).toEqual([])
    })

    test('an abandon-clear of another owner\'s marker is reported: the page means its own', async () => {
        const { rig } = await observed(make, 'marker-seed', async (actor) => {
            const prefix = (await actor.readKey())?.staging?.prefix ?? ''
            // The committer is asked for the marker's owner and clears it; the page declared its own marker.
            expect(outcomeLabel(await actor.abandonClear(prefix, FOREIGN_OWNER))).toBe('cleared')
        })
        // The label is wrong for the marker (h) and another owner's marker went with no consent (h2).
        expect(rig.checker.violations.map((violation) => violation.property)).toEqual(['h', 'h2'])
    })

    test('a foreign marker cleared with consent is a foreign-clear', async () => {
        const { rig, steps } = await observed(make, 'marker-seed', async (actor) => {
            expect((await actor.clearMarker()).cleared?.status).toBe('cleared')
        }, { foreignClear: async () => true })
        expect(writeContexts(steps, COMMIT_KEY)).toEqual(['foreign-clear'])
        expect(rig.checker.violations).toEqual([])
    })
})

describe.each(BACKENDS)('$variant: the labelling leaves the checker\'s guards armed', ({ make }) => {
    test.each([['fence-exit', 'plain'], ['recovery-begin', 'recovery']] as const)('a fence removed under a %s operation is reported: only a discard removes the fence', async (kind, intent) => {
        const { rig } = await observed(make, 'standing-fence', async (actor) => {
            await actor.declared({ kind }, intent, async (session) => {
                const backend = session.backend!
                await backend.casFence((await backend.readFence()).token, null)
            })
        })
        const violations = rig.checker.violations
        expect(violations.map((violation) => violation.property)).toContain('G1')
        expect(violations.some((violation) => /not a fence discard/.test(violation.detail))).toBe(true)
        expect(rig.hooks.peek(FENCE_KEY)).toBeNull()
    })

    test('a fence written under a discard operation is reported: only an exit writes the fence', async () => {
        const { rig } = await observed(make, 'standing-fence', async (actor) => {
            await actor.declared({ kind: 'fence-discard' }, 'plain', async (session) => {
                const backend = session.backend!
                const read = await backend.readFence()
                await backend.casFence(read.token, read.bytes)
            })
        })
        // Rewriting the identical bytes is no change on Tauri; on Node the revision moves.
        const written = rig.checker.violations.some((violation) => violation.property === 'G1' && /not a fence exit/.test(violation.detail))
        expect(written).toBe(rig.variant === 'node')
    })

    test('a standing foreign marker cleared without the consent of the foreign-clear hook is reported', async () => {
        const { rig } = await observed(make, 'marker-seed', async (actor) => {
            await actor.declared({ kind: 'read' }, 'clear', async (session) => {
                const read = await session.backend!.readCommit()
                const parsed = classifyCommitRead(read)
                const marker = parsed.status === 'parsed' ? parsed.value.staging : null
                expect(marker).not.toBeNull()
                await session.committer!.abandonClear(read, marker!.owner, marker!.prefix)
            })
        }, { foreignClear: async () => false })
        expect(rig.checker.violations.map((violation) => violation.property)).toEqual(['h', 'h2'])
    })

    test('a recovery exit over a foreign marker whose hook bypassed the consent wrapper is reported by consent alone', async () => {
        const { rig } = await observed(make, 'marker-seed', async (actor) => {
            await actor.declared({ kind: 'recovery-begin' }, 'recovery', async (session) => {
                const read = await session.backend!.readCommit()
                // The raw hook answers yes without the wrapper, so no consent reaches the checker.
                await runExit(session.backend!, read, { kind: 'seed', highestSeqRead: 0 }, { owner: session.ownerId, env: actor.env, foreignClear: async () => true })
            })
        })
        const properties = rig.checker.violations.map((violation) => violation.property)
        expect(properties).toContain('h2')
        expect(properties).not.toContain('h')
    })

    test('a recovery exit over a foreign marker through the wrapped hook is clean', async () => {
        const { rig } = await observed(make, 'marker-seed', async (actor) => {
            await actor.runExit('seed')
        }, { foreignClear: async () => true })
        expect(rig.checker.violations).toEqual([])
    })
})

describe('the Tauri re-flush', () => {
    test('rewrites the commit key and the fence it read and is labelled a read, never a fence exit', async () => {
        const { rig, steps } = await observed(createTauriReplayRig, 'standing-fence', async () => {})
        const flushed = steps.filter((step) => step.kind === 'call' && step.op === 'writeTop')
        expect(flushed.map((step) => step.target).sort()).toEqual([COMMIT_KEY, FENCE_KEY])
        expect(flushed.map((step) => step.context?.kind)).toEqual(['read', 'read'])
        expect(rig.checker.violations).toEqual([])
    })
})

// ---- Determinism ----

describe.each(BACKENDS)('$variant: determinism', ({ make }) => {
    test('one seed gives the same call log twice, whatever the clock and Math.random say', async () => {
        const logs: string[][] = []
        for (let run = 0; run < 2; run++) {
            const rig = await make({ scheduler: { seed: 7 }, start: 'healthy', prepare: plantGarbage })
            rig.spawn('a', 10, async (actor) => {
                await actor.open()
                await actor.bulkCommit('b')
                await actor.gcPass()
            })
            rig.spawn('b', 11, async (actor) => {
                await actor.open()
                await actor.commit('c')
                await actor.fenceExit()
            })
            await rig.run({ maxSteps: MAX_STEPS })
            expect(rig.checker.violations).toEqual([])
            logs.push(rig.scheduler.log.map((entry) => `${entry.actor}:${entry.op}:${entry.target}:${entry.outcome}`))
        }
        expect(logs[0].length).toBeGreaterThan(50)
        expect(logs[1]).toEqual(logs[0])
    })
})

// ---- A deleter reads before it deletes ----

describe.each(BACKENDS)('$variant: garbage collection', ({ make }) => {
    test('reads the commit key and the fence before its first removal, and removes the garbage in several batches', async () => {
        const { rig, steps } = await observed(make, 'healthy', async (actor) => {
            const result = await actor.gcPass()
            expect(result).toMatchObject({ status: 'done', deleted: GARBAGE_UNITS })
            expect(result.status === 'done' && result.batches).toBeGreaterThan(1)
        })
        void rig
        const reads = (key: string): number => steps.findIndex((step) => step.actor === 'a' && step.kind === 'call' && (step.op === 'read' && step.target === key))
        const removal = steps.findIndex((step) => step.kind === 'call' && ['retireChecked', 'removeChecked', 'removeTop', 'deleteMany'].includes(step.op))
        expect(removal).toBeGreaterThan(-1)
        expect(reads(COMMIT_KEY)).toBeGreaterThan(-1)
        expect(reads(COMMIT_KEY)).toBeLessThan(removal)
        expect(reads(FENCE_KEY)).toBeGreaterThan(-1)
        expect(reads(FENCE_KEY)).toBeLessThan(removal)
    })
})

// ---- Concurrent recoveries ----

interface PairRun {
    seed: number
    outcomes: string
    status: string
    states: string
    violations: string[]
}

async function recoverTwice(make: RigFactory, state: StartState, program: Program, seed: number): Promise<PairRun> {
    const rig = await make({ scheduler: { seed }, start: state, prepare: plantGarbage })
    const outcomes: Record<string, string> = { a: 'unfinished', b: 'unfinished' }
    for (const [id, actorSeed] of [['a', 10], ['b', 11]] as const) {
        rig.spawn(id, actorSeed, async (actor) => {
            await actor.open()
            outcomes[id] = await program(actor)
        }, { foreignClear: async () => true })
    }
    const result = await rig.run({ maxSteps: MAX_STEPS })
    return {
        seed,
        outcomes: `${outcomes.a} | ${outcomes.b}`,
        status: result.status,
        states: `${result.actors.a.state}${result.actors.a.error === undefined ? '' : `(${result.actors.a.error})`} ${result.actors.b.state}${result.actors.b.error === undefined ? '' : `(${result.actors.b.error})`}`,
        violations: rig.checker.violations.map((violation) => `${violation.property}: ${violation.detail}`),
    }
}

/** The pairs of outcomes two recovering actors may end in, by variant: one recovers, and the other meets what the first left. */
const RECOVERY_PAIRS: Readonly<Record<ReplayVariant, Readonly<Record<string, readonly string[]>>>> = {
    node: {
        pick: [
            'pick:ready/install:installed | pick:exit:conflict', 'pick:exit:conflict | pick:ready/install:installed',
            'pick:ready/install:installed | pick:ready/install:abandoned', 'pick:ready/install:abandoned | pick:ready/install:installed',
        ],
        'exit-seed': ['marked:written | conflict', 'conflict | marked:written', 'marked:written | marked:written'],
    },
    // The page that registered second is the page of the app; the first is stale and every decisive step of it is refused.
    tauri: {
        pick: ['pick:ready/install:installed | pick:exit:fence:failed', 'pick:exit:fence:failed | pick:ready/install:installed'],
        'exit-seed': ['marked:written | fence:failed', 'fence:failed | marked:written'],
    },
}

describe.each(BACKENDS)('$variant: concurrent recoveries', ({ variant, make }) => {
    test.each([['damaged-commit', 'pick'], ['both-damaged', 'pick'], ['no-commit-key', 'exit-seed']] as const)('two recovering actors over %s run %s', async (state, operation) => {
        const seen = new Set<string>()
        for (let seed = 1; seed <= 40; seed++) {
            const run = await recoverTwice(make, state, OPERATIONS[operation], seed)
            // A throw, a stall or a violation is reported as itself, with the seed that reproduces it.
            expect(`seed ${seed}: ${run.status} ${run.states} ${run.violations.join(';')}`).toBe(`seed ${seed}: finished done done `)
            expect(RECOVERY_PAIRS[variant][operation]).toContain(run.outcomes)
            seen.add(run.outcomes)
        }
        // The race is reachable: more than one order of the two recoveries was run.
        expect(seen.size).toBeGreaterThan(1)
    })
})

// ---- Restart and the device's owner id ----

/** The owner id the page of an actor with `seed` is given on a device that has none yet. */
function firstOwner(seed: number): string {
    return freshOwnerId(testEnv(createClock(), seed))
}

describe('a Tauri restart', () => {
    test('the start-up clear removes the device\'s own seed marker when the page opens again', async () => {
        const rig = await createTauriReplayRig({ scheduler: { seed: 1 }, start: 'marker-seed', markerOwner: firstOwner(10) })
        let decision: SessionDecision | null = null
        let cleared = ''
        rig.spawn('a', 10, async (actor) => {
            const session = await actor.open()
            decision = session.decision
            cleared = session.startupClear === null ? 'none' : session.startupClear.status
        })
        const result = await rig.run({ maxSteps: MAX_STEPS })

        expect(result.actors.a.state).toBe('done')
        expect(decision).toMatchObject({ row: 9, mode: 'rerun', operation: 'seed', clear: 'own' })
        expect(cleared).toBe('cleared')
        expect(rig.checker.violations).toEqual([])
    })

    test('a web page has no device: the same marker is left for the foreign-clear path', async () => {
        const rig = await createNodeReplayRig({ scheduler: { seed: 1 }, start: 'marker-seed', markerOwner: firstOwner(10) })
        let decision: SessionDecision | null = null
        let cleared = ''
        rig.spawn('a', 10, async (actor) => {
            const session = await actor.open()
            decision = session.decision
            cleared = session.startupClear === null ? 'none' : session.startupClear.status
        })
        await rig.run({ maxSteps: MAX_STEPS })

        expect(decision).toMatchObject({ row: 9, mode: 'rerun', operation: 'seed', clear: 'foreign-path' })
        expect(cleared).toBe('none')
        expect(rig.checker.violations).toEqual([])
    })

    test('restart(): a marker the page set is its own again after it opens with the same owner store, and is cleared at start-up', async () => {
        const rig = await createTauriReplayRig({ scheduler: { seed: 1 }, start: 'healthy' })
        const observedClears: string[] = []
        let owners: [string, string] = ['', '']
        rig.spawn('a', 10, async (actor) => {
            const first = await actor.open()
            expect(outcomeLabel(await actor.runExit('seed'))).toBe('marked:written')
            const second = await actor.restart()
            owners = [first.ownerId, second.ownerId]
            observedClears.push(second.startupClear === null ? 'none' : second.startupClear.status)
            // The exit emptied current and the clear removed only the marker, so the key names nothing to commit over.
            observedClears.push(outcomeLabel((await actor.commit('after')).result))
        })
        const result = await rig.run({ maxSteps: MAX_STEPS })

        expect(result.actors.a.state).toBe('done')
        expect(owners[1]).toBe(owners[0])
        expect(observedClears).toEqual(['cleared', 'refused:no-current'])
        expect(rig.checker.violations).toEqual([])
    })

    test('a page that died with its marker standing: the next page of the device clears it at start-up', async () => {
        const rig = await createTauriReplayRig({
            scheduler: { seed: 1, faults: { mode: 'script', entries: [{ actor: 'a', op: 'writeTop', target: COMMIT_KEY, context: 'recovery-begin', kind: 'crash-after-write' }] } },
            start: 'healthy',
        })
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            await actor.runExit('seed')
        }, { page: 'before', device: 'phone' })
        let cleared = ''
        rig.spawn('b', 11, async (actor) => {
            await rig.when((info) => info.actor === 'a' && info.fault === 'crash-after-write')
            const session = await actor.open()
            cleared = session.startupClear === null ? 'none' : session.startupClear.status
        }, { page: 'after', device: 'phone' })
        const result = await rig.run({ maxSteps: MAX_STEPS })

        expect(result.actors.a.state).toBe('crashed')
        expect(result.actors.b.state).toBe('done')
        expect(cleared).toBe('cleared')
        expect(rig.checker.violations).toEqual([])
        const key = classifyCommitRead({ bytes: rig.hooks.peek(COMMIT_KEY) })
        expect(key.status === 'parsed' && key.value.staging).toBeNull()
    })

    test('restart is the device\'s: a web page refuses it', async () => {
        const rig = await createNodeReplayRig({ scheduler: { seed: 1 } })
        let refusal = ''
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            await actor.restart().catch((error: unknown) => { refusal = error instanceof RangeError ? error.message : 'other' })
        })
        await rig.run({ maxSteps: MAX_STEPS })
        expect(refusal).toMatch(/Tauri only/)
    })
})

// ---- One page, one gate ----

describe('one Tauri page, one gate', () => {
    test('the actors of a page share one session, one backend and one registration', async () => {
        const rig = await createTauriReplayRig({ scheduler: { seed: 3 }, start: 'healthy' })
        const sessions: Store2Session[] = []
        for (const [id, seed] of [['a', 10], ['b', 11]] as const) {
            rig.spawn(id, seed, async (actor) => {
                sessions.push(await actor.open())
                await actor.commit(id)
            }, { page: 'P' })
        }
        const result = await rig.run({ maxSteps: MAX_STEPS })

        expect(result.status).toBe('finished')
        expect(result.actors.a.state).toBe('done')
        expect(result.actors.b.state).toBe('done')
        expect(sessions[0]).toBe(sessions[1])
        // The seeding page was generation 1, the page of the two actors is 2, and nothing registered again.
        expect(rig.fake.generation).toBe(2)
        expect(rig.checker.violations).toEqual([])
    })

    test('a second page on the same store makes the first stale: its decisive step is refused, never applied', async () => {
        const rig = await createTauriReplayRig({ scheduler: { seed: 1 }, start: 'healthy' })
        let secondOpen!: () => void
        const opened = new Promise<void>((resolve) => { secondOpen = resolve })
        let outcome = ''
        rig.spawn('first', 10, async (actor) => {
            await actor.open()
            await opened
            outcome = outcomeLabel((await actor.commit('late')).result)
        })
        rig.spawn('second', 11, async (actor) => {
            await rig.when((info) => info.actor === 'first' && info.op === 'registerPage')
            await actor.open()
            secondOpen()
        })
        const before = rig.hooks.peek(COMMIT_KEY)
        const result = await rig.run({ maxSteps: MAX_STEPS })

        expect(result.actors.first.state).toBe('done')
        expect(outcome).toBe('failed')
        expect(rig.fake.generation).toBe(3)
        expect(rig.hooks.peek(COMMIT_KEY)).toEqual(before)
        expect(rig.checker.violations).toEqual([])
    })
})

// ---- The same operations with faults ----

/**
 * Lost responses, lost requests and one crash per actor, drawn from the seed. A run
 * that ends in a violation fails; a throw or a stall is a finding about the driver
 * or the library and is listed by its seed, not counted as green.
 *
 * This is a sweep of the early fault paths, not of the whole operation: a crash retires
 * the actor at its first faulted write, and a lost registration with the page gate leaves
 * the actor nothing to run (the run is counted as not exercised, and the fault plan is not
 * retuned to avoid it: regions and their fault rates are stage 2f-4).
 */
describe.each(BACKENDS)('$variant: every operation under injected faults', ({ make }) => {
    test('no violation, no stall, no throw', async () => {
        const problems: string[] = []
        const outcomes = new Map<string, number>()
        let runs = 0
        let notExercised = 0
        for (const state of ['healthy', 'standing-fence', 'damaged-fence', 'marker-import'] as const) {
            for (const operation of Object.keys(OPERATIONS)) {
                for (let seed = 1; seed <= 12; seed++) {
                    const rig = await make({
                        scheduler: { seed, faults: { mode: 'random', probability: 0.25, budget: { lostPerActor: 3, crashPerActor: 1 } } },
                        start: state,
                        prepare: plantGarbage,
                    })
                    let outcome = 'unfinished'
                    rig.spawn('a', 10, async (actor) => {
                        await actor.open({ upstreamMainFile: false })
                        outcome = await OPERATIONS[operation](actor)
                    }, { foreignClear: async () => true })
                    const result = await rig.run({ maxSteps: MAX_STEPS })
                    runs++
                    const report = result.actors.a
                    const where = `${state}|${operation}|seed ${seed}`
                    if (rig.checker.violations.length > 0) {
                        problems.push(`${where}: violation ${rig.checker.violations.map((violation) => `${violation.property} ${violation.detail}`).join('; ')}`)
                    } else if (result.status !== 'finished') {
                        problems.push(`${where}: ${result.status}`)
                    } else if (rig.scheduler.log.some((entry) => entry.op === 'registerPage' && entry.fault !== null)) {
                        // A registration with the page gate was faulted: the real session may open read-only, and the operation did not run as asked.
                        notExercised++
                        outcomes.set('not exercised (registerPage faulted)', (outcomes.get('not exercised (registerPage faulted)') ?? 0) + 1)
                    } else if (report.state === 'failed' && report.error?.startsWith('PageUnavailableError') === true) {
                        notExercised++
                        outcomes.set('not exercised (page unavailable)', (outcomes.get('not exercised (page unavailable)') ?? 0) + 1)
                    } else if (report.state === 'failed') {
                        problems.push(`${where}: threw ${report.error}`)
                    } else {
                        const key = report.state === 'crashed' ? 'ended early (crashed)' : outcome
                        outcomes.set(key, (outcomes.get(key) ?? 0) + 1)
                    }
                }
            }
        }
        expect(problems).toEqual([])
        // A crash cuts about a fifth of the Node runs short, and a crash or a faulted registration about half of the Tauri runs; the sweep covers the early fault paths most.
        expect(runs - notExercised).toBeGreaterThan(0)
        expect(runs).toBe(4 * Object.keys(OPERATIONS).length * 12)
    }, 240_000)
})
