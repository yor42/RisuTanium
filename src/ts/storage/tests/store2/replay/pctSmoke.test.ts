// @vitest-environment node
/**
 * The PCT smoke run: every region of `regions.ts` on every backend that has a rig, over fixed seeds, under the PCT
 * scheduler with the region's fault plan. Per region and backend one test runs all seeds and asserts:
 *  - no checker violation (the only red outcome);
 *  - no stall and no step limit, and no throw: those are findings about the driver or the library, listed by seed and
 *    never counted as a pass (plan E1);
 *  - the faults of the plan did start after the region's step count, so the operations after `open` ran unfaulted
 *    until then, and at least `minFaulted` (half by default) of the exercised runs saw one;
 *  - the share of runs that were exercised at all (a faulted registration with the Tauri page gate is not);
 *  - the floors: the share of exercised runs that reached each named operation or outcome, so a region cannot
 *    degrade into early crashes unnoticed.
 * Every region prints one `PCT-SMOKE` line with its counts before it asserts, so a failing or mutated run still
 * reports what each seed did; `PCT_REPORT=1` also prints one `PCT-RUN` line per run.
 *
 * A region whose rig does not exist yet is skipped with the reason in its test name.
 */
import { describe, expect, test } from 'vitest'
import { REGIONS, runRegion, type RegionBackend, type RegionConfig, type RegionRun, type RunKind } from './regions'
import { FIRST_ACTOR_SEED } from './actors'

const KINDS: readonly RunKind[] = ['violation', 'stalled', 'max-steps', 'threw', 'not-exercised', 'crashed', 'complete']

function seedsOf(region: RegionConfig): number[] {
    return Array.from({ length: region.seeds }, (_, index) => index + 1)
}

function floorsOf(region: RegionConfig, backend: RegionBackend): Record<string, number> {
    return backend === 'tauri' && region.tauriFloors !== undefined ? region.tauriFloors : region.floors
}

interface Summary {
    region: string
    backend: RegionBackend
    runs: number
    kinds: Record<string, number>
    /** Runs that reached each operation key. */
    reached: Record<string, number>
    /** How often each outcome label of a run ended an actor's program step, over all actors. */
    outcomes: Record<string, number>
    faults: Record<string, number>
    violations: Array<{ seed: number, violation: string }>
    findings: Array<{ seed: number, kind: RunKind, detail: string }>
    /** Runs that were not exercised, with the errors of their failed actors: listed so they are never silently dropped. */
    notExercised: Array<{ seed: number, detail: string }>
    /** Exercised runs in which the plan injected at least one fault. */
    faultedRuns: number
    /** Seeds whose outcome labels differ from the region's declared ones, when it declares them. */
    outcomeMismatches: number[]
    steps: number
    ms: number
}

function summarize(region: RegionConfig, backend: RegionBackend, runs: RegionRun[], ms: number): Summary {
    const kinds: Record<string, number> = Object.fromEntries(KINDS.map((kind) => [kind, 0]))
    const reached: Record<string, number> = {}
    const outcomes: Record<string, number> = {}
    const faults: Record<string, number> = {}
    const violations: Summary['violations'] = []
    const findings: Summary['findings'] = []
    const notExercised: Summary['notExercised'] = []
    const outcomeMismatches: number[] = []
    let faultedRuns = 0
    let steps = 0
    for (const run of runs) {
        kinds[run.kind]++
        if (run.kind === 'not-exercised') {
            notExercised.push({ seed: run.seed, detail: run.errors.join(' | ') })
        } else if (run.firstFaultStep !== null) {
            faultedRuns++
        }
        steps += run.steps
        for (const key of run.reached) {
            reached[key] = (reached[key] ?? 0) + 1
        }
        for (const labels of Object.values(run.outcomes)) {
            for (const label of labels) {
                outcomes[label] = (outcomes[label] ?? 0) + 1
            }
        }
        for (const [kind, count] of Object.entries(run.faults)) {
            faults[kind] = (faults[kind] ?? 0) + count
        }
        for (const violation of run.violations) {
            violations.push({ seed: run.seed, violation })
        }
        if (region.outcomes !== undefined && JSON.stringify(run.outcomes) !== JSON.stringify(region.outcomes)) {
            outcomeMismatches.push(run.seed)
        }
        if (run.kind === 'stalled' || run.kind === 'max-steps' || run.kind === 'threw') {
            findings.push({ seed: run.seed, kind: run.kind, detail: run.errors.join(' | ') })
        }
    }
    return { region: region.id, backend, runs: runs.length, kinds, reached, outcomes, faults, violations, findings, notExercised, faultedRuns, outcomeMismatches, steps, ms }
}

describe.each(REGIONS)('region $id $name', (region) => {
    for (const backend of region.backends) {
        const pending = region.pending?.[backend]
        if (pending !== undefined) {
            test.skip(`${backend}: ${region.covers} (pending: ${pending})`, () => undefined)
            continue
        }
        test(`${backend}: ${region.covers}`, async () => {
            const started = Date.now()
            const runs: RegionRun[] = []
            for (const seed of seedsOf(region)) {
                const run = await runRegion(region, backend, seed)
                runs.push(run)
                if (process.env.PCT_REPORT === '1') {
                    console.log(`PCT-RUN ${JSON.stringify(run)}`)
                }
            }
            const summary = summarize(region, backend, runs, Date.now() - started)
            console.log(`PCT-SMOKE ${JSON.stringify(summary)}`)

            // Red: a checker violation, with the seed that reproduces it.
            expect(summary.violations).toEqual([])
            // Not red, and not a pass: reported by seed.
            expect(summary.findings).toEqual([])

            const exercised = runs.filter((run) => run.kind !== 'not-exercised')
            expect(exercised.length / runs.length).toBeGreaterThanOrEqual(region.minExercised ?? 0.9)

            if (region.faults !== undefined) {
                // The faults began after the step count: nothing before it was faulted.
                for (const run of runs) {
                    expect(run.firstFaultStep === null || run.firstFaultStep > region.faults.startAfterSteps, `seed ${run.seed}: first fault at step ${run.firstFaultStep}`).toBe(true)
                }
                // And they did fire: a plan whose faults never happen would turn the region into a fault-free run.
                expect(summary.faultedRuns / exercised.length, `a fault was injected in ${summary.faultedRuns} of ${exercised.length} exercised runs`).toBeGreaterThanOrEqual(region.faults.minFaulted ?? 0.5)
            } else {
                expect(summary.faults).toEqual({})
            }

            for (const [key, share] of Object.entries(floorsOf(region, backend))) {
                const reachedRuns = exercised.filter((run) => run.reached.includes(key)).length
                expect(reachedRuns / exercised.length, `${key} was reached in ${reachedRuns} of ${exercised.length} exercised runs`).toBeGreaterThanOrEqual(share)
            }

            if (region.outcomes !== undefined) {
                // The outcome kinds MC-291 names: a warning with counts that continues, or a loud failure.
                expect(summary.outcomeMismatches).toEqual([])
            }
        }, 120_000)
    }
})

describe('the region configs', () => {
    test('a region id is unique and an actor seed is above the rig\'s own and unique within its region', () => {
        expect(new Set(REGIONS.map((region) => region.id)).size).toBe(REGIONS.length)
        for (const region of REGIONS) {
            const seeds = region.actors.map((actor) => actor.seed)
            expect(new Set(seeds).size, region.id).toBe(seeds.length)
            for (const seed of seeds) {
                expect(seed, region.id).toBeGreaterThanOrEqual(FIRST_ACTOR_SEED)
            }
        }
    })

    test('every region plants more than one collection batch (25 keys) of garbage, and every pending backend names its reason', () => {
        for (const region of REGIONS) {
            expect(region.garbage, region.id).toBeGreaterThan(25)
            for (const backend of Object.keys(region.pending ?? {})) {
                expect(region.backends, region.id).toContain(backend)
                expect(region.pending?.[backend as RegionBackend], region.id).not.toBe('')
            }
        }
    })

    test('the regions the plan names are all present: R1 to R16, the V1 cases R17 and the uncovered set R18', () => {
        const ids = new Set(REGIONS.map((region) => region.id))
        for (let number = 1; number <= 16; number++) {
            expect(ids.has(`R${number}`), `R${number}`).toBe(true)
        }
        expect(REGIONS.some((region) => region.id.startsWith('R17'))).toBe(true)
        expect(REGIONS.some((region) => region.id.startsWith('R18'))).toBe(true)
    })
})
