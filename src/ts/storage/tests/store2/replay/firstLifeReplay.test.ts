// @vitest-environment node
/**
 * First-life install under the replay (plan v3.4 amendment 7, R1), on hand-built schedules: two tabs racing first life on an
 * absent commit key (Node, Tauri and IndexedDB rigs), the install after a standing seed or convert marker, and a Tauri
 * first life that an unflushed write interrupts and a restart that drops it. Every run must finish with no checker violation.
 * The PCT regions R19a to R19d sample the same shapes under faults; these tests fix one interleaving each and assert the outcome.
 * New behaviour unless a test says guard.
 */
import { describe, expect, test } from 'vitest'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { outcomeLabel, type FirstLifeOutcome, type ReplayRig, type ReplayRigOptions, type StartState } from './actors'
import { createIdbReplayRig } from './idbRig'
import { createNodeReplayRig } from './nodeRig'
import { createTauriReplayRig } from './tauriRig'
import type { StepInfo } from './scheduler'
import { createClock, testEnv } from '../commitFixtures'

type RigFactory = (options: ReplayRigOptions) => Promise<ReplayRig>

const BACKENDS: ReadonlyArray<{ name: string, make: RigFactory }> = [
    { name: 'node', make: createNodeReplayRig },
    { name: 'tauri', make: createTauriReplayRig },
    { name: 'indexeddb', make: createIdbReplayRig },
]

const MAX_STEPS = 20_000
const SCHEDULER_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]

function label(outcome: FirstLifeOutcome): string {
    if (outcome.status === 'refused') {
        return `refused:${outcome.reason}`
    }
    if (outcome.status === 'not-marked') {
        return `not-marked:${outcome.marker.status}`
    }
    return outcomeLabel(outcome)
}

function storedKey(rig: ReplayRig): ReturnType<typeof classifyCommitRead> {
    return classifyCommitRead({ bytes: rig.hooks.peek(COMMIT_KEY) })
}

function commitContexts(steps: readonly StepInfo[]): Array<string | null> {
    return steps
        .filter((step) => step.kind === 'call' && step.applied && step.target === COMMIT_KEY && ['casCommit', 'writeChecked', 'writeTop'].includes(step.op))
        .map((step) => step.context?.kind ?? null)
        .filter((kind) => kind !== 'read')
}

describe.each(BACKENDS)('$name: first life', ({ make }) => {
    test('two tabs racing first life on an absent key: exactly one install, the other tab installs nothing, and the fence is never written', async () => {
        for (const seed of SCHEDULER_SEEDS) {
            const rig = await make({ scheduler: { seed }, start: 'no-commit-key' })
            const outcomes: Record<string, string> = {}
            for (const [id, actorSeed] of [['a', 10], ['b', 11]] as const) {
                rig.spawn(id, actorSeed, async (actor) => {
                    await actor.open()
                    outcomes[id] = label(await actor.firstLife(id))
                })
            }
            const result = await rig.run({ maxSteps: MAX_STEPS })
            expect(result.status, `seed ${seed}`).toBe('finished')
            expect(rig.checker.violations, `seed ${seed}`).toEqual([])
            const installed = Object.values(outcomes).filter((each) => each === 'installed')
            expect(installed, `seed ${seed}: ${JSON.stringify(outcomes)}`).toHaveLength(1)
            const key = storedKey(rig)
            expect(key.status).toBe('parsed')
            if (key.status === 'parsed') {
                expect(key.value.current).not.toBeNull()
                expect(key.value.staging).toBeNull()
                expect(key.value.convertedFrom).toBe('seed')
            }
            expect(rig.hooks.peek(FENCE_KEY)).toBeNull()
        }
    })
})

describe.each(BACKENDS)('$name: first life racing a peer that clears its marker (Q3)', ({ make }) => {
    test('the peer boots after the marker, clears it through the foreign-clear path while the install is between its marker and its units; the install does not land and the peer is refused a grant', async () => {
        const commitOps = ['writeChecked', 'writeTop', 'casCommit']
        const rig = await make({
            scheduler: { seed: 1 },
            start: 'no-commit-key',
            // The installer's first unit write waits for the peer's clear of the marker.
            holds: [{ call: { actor: 'a', op: ['write', 'putUnit'], context: 'recovery-begin' }, until: { actor: 'b', op: commitOps, context: 'foreign-clear' } }],
        })
        const outcomes: Record<string, string> = {}
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            outcomes.a = label(await actor.firstLife('a'))
        })
        rig.spawn('b', 11, async (actor) => {
            await rig.reached({ actor: 'a', op: commitOps, context: 'recovery-begin' })
            await actor.open()
            const cleared = await actor.clearMarker()
            outcomes.clear = `${cleared.decision}:${cleared.cleared === null ? 'none' : cleared.cleared.status}`
            outcomes.b = label(await actor.firstLife('b'))
        }, { foreignClear: async () => true })
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status, JSON.stringify(outcomes)).toBe('finished')
        expect(rig.checker.violations).toEqual([])
        expect(outcomes.clear).toBe('clear:cleared')
        // The peer's clear moved the key, so the final write at the marker's token meets a conflict (a Tauri page the peer made stale fails earlier).
        expect(['abandoned', 'failed', 'upload-failed']).toContain(outcomes.a)
        expect(outcomes.b).toBe('refused:foreign-marker')
        const key = storedKey(rig)
        expect(key.status === 'parsed' ? key.value.current : 'x').toBeNull()
        expect(rig.hooks.peek(FENCE_KEY)).toBeNull()
    })
})

describe('first life after a standing marker of the page\'s own device (Tauri)', () => {
    test('the page\'s own clear, then a crash, then the next boot is row 7: nothing is re-run silently', async () => {
        const owner = freshOwnerId(testEnv(createClock(), 10))
        const steps: StepInfo[] = []
        const rig = await createTauriReplayRig({ scheduler: { seed: 1 }, start: 'marker-seed', markerOwner: owner, observe: (info) => steps.push(info) })
        const seen: string[] = []
        rig.spawn('a', 10, async (actor) => {
            const first = await actor.open()
            seen.push(`clear:${first.startupClear === null ? 'none' : first.startupClear.status}`)
            const rebooted = await actor.restart({ drop: false })
            seen.push(`row:${rebooted.decision.row}`)
            seen.push(`startupClear:${rebooted.startupClear === null ? 'none' : rebooted.startupClear.status}`)
            seen.push(label(await actor.firstLife('x')))
        }, { device: 'phone' })
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('finished')
        expect(rig.checker.violations).toEqual([])
        expect(seen).toEqual(['clear:cleared', 'row:7', 'startupClear:none', 'refused:not-first-life'])
        expect(commitContexts(steps)).toEqual(['start-clear'])
        const key = storedKey(rig)
        expect(key.status === 'parsed' ? [key.value.current, key.value.staging] : 'x').toEqual([null, null])
    })

    test.each([
        ['marker-seed', 'seed', false],
        ['marker-convert', 'database/database.bin', true],
    ] as const)('%s: the start-up clear grants the unfenced marker and the install lands; the key is written start-clear, recovery-begin, recovery-install', async (state: StartState, convertedFrom, upstreamMainFile) => {
        const steps: StepInfo[] = []
        const owner = freshOwnerId(testEnv(createClock(), 10))
        const rig = await createTauriReplayRig({ scheduler: { seed: 1 }, start: state, markerOwner: owner, observe: (info) => steps.push(info) })
        let outcome: FirstLifeOutcome | null = null
        let cleared = ''
        rig.spawn('a', 10, async (actor) => {
            const session = await actor.open({ upstreamMainFile })
            cleared = session.startupClear === null ? 'none' : session.startupClear.status
            outcome = await actor.firstLife('x', 0, convertedFrom)
        })
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('finished')
        expect(rig.checker.violations).toEqual([])
        expect(cleared).toBe('cleared')
        expect(outcome === null ? 'none' : label(outcome)).toBe('installed')
        expect(commitContexts(steps)).toEqual(['start-clear', 'recovery-begin', 'recovery-install'])
        const key = storedKey(rig)
        expect(key.status === 'parsed' ? key.value.convertedFrom : null).toBe(convertedFrom)
        expect(rig.hooks.peek(FENCE_KEY)).toBeNull()
    })

    test('guard: a foreign standing marker is refused by the grant and nothing is written', async () => {
        const rig = await createTauriReplayRig({ scheduler: { seed: 1 }, start: 'marker-seed' })
        let outcome = ''
        const before = rig.hooks.peek(COMMIT_KEY)
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            outcome = label(await actor.firstLife('x'))
        })
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('finished')
        expect(outcome).toBe('refused:foreign-marker')
        expect(Array.from(rig.hooks.peek(COMMIT_KEY) as Uint8Array)).toEqual(Array.from(before as Uint8Array))
        expect(rig.checker.violations).toEqual([])
    })
})

describe('first life interrupted on Tauri', () => {
    test('an unflushed unit write stops the install and leaves the marker; the restart drops it, the new page clears its own marker and installs again', async () => {
        const steps: StepInfo[] = []
        // The third unit write under the actor's declared recovery-begin reports `flushed: false`; the marker went through the page gate, not `write`.
        const rig = await createTauriReplayRig({
            scheduler: { seed: 1, faults: { mode: 'script', entries: [{ actor: 'a', op: 'write', context: 'recovery-begin', nth: 3, kind: 'flush-fault' }] } },
            start: 'no-commit-key',
            observe: (info) => steps.push(info),
        })
        const outcomes: string[] = []
        const keys: string[] = []
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            outcomes.push(label(await actor.firstLife('x', 2)))
            const standing = storedKey(rig)
            keys.push(standing.status === 'parsed' && standing.value.staging !== null && standing.value.current === null ? 'marker' : 'other')
            await actor.restart({ drop: true })
            outcomes.push(label(await actor.firstLife('y', 2)))
        }, { device: 'phone' })
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('finished')
        expect(rig.checker.violations).toEqual([])
        expect(outcomes).toEqual(['upload-failed', 'installed'])
        expect(keys).toEqual(['marker'])
        const key = storedKey(rig)
        expect(key.status === 'parsed' ? key.value.staging : 'x').toBeNull()
        expect(key.status === 'parsed' ? key.value.current : null).not.toBeNull()
        expect(rig.hooks.peek(FENCE_KEY)).toBeNull()
    })
})
