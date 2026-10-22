// @vitest-environment node
/**
 * The app wiring of the automatic clean-up over the Tauri rig: a page is a program of the real `Store2Session`, the real
 * committer and `gcPass` over the real Tauri backend on the scheduled Tauri-semantics store, with the deps built by
 * `buildAutoGcDeps` instead of the rig's own `gc`. Nothing here is the maintenance step or the quiet trigger; those are in
 * `maintenanceRunner.test.ts`.
 *
 * Labels: both programs are wiring guards, proven by mutants (they fail at import on the base, which proves nothing).
 * (a) pins the positive path: the run finishes, the checker finds no violation and the orphans are gone. (b) pins the live
 * idle reason: the page's own commit-key write reports no flush, so the session turns idle after the deps were built and
 * before the gate reads it; the pass must refuse `idle` and keep every orphan. A spread copy of the session and an
 * `idleReason: () => null` both freeze the answer at "not idle", delete the orphans, and still satisfy the checker, so (b)
 * rests on its explicit idle assertions.
 */
import { describe, expect, test } from 'vitest'
import { COMMIT_KEY, newUnitKey } from 'src/ts/storage/store2/format'
import { buildAutoGcDeps, type AutoGcFacts } from 'src/ts/storage/store2/gc/autoGc'
import { gcPass, type GcResult } from 'src/ts/storage/store2/gc/pass'
import { createClock, testEnv } from '../commitFixtures'
import { createTauriRig, spawnPage, type TauriRig } from './tauriRig'

const CLEAN: AutoGcFacts = { isBusy: () => false, saveLoopParked: () => false, isSaveClean: () => true }
const ORPHANS = 30
const SEEDS = [51, 52, 53, 54]

interface Outcome {
    status: string
    gc: GcResult | null
    idleBeforeGc: string | null
    orphansLeft: number
    violations: string[]
}

async function runProgram(seed: number, flipIdle: boolean): Promise<Outcome> {
    let rigRef: TauriRig | null = null
    const orphans: string[] = []
    const rig = await createTauriRig({
        scheduler: {
            seed,
            faults: flipIdle
                ? { mode: 'script', entries: [{ actor: 'P', kind: 'flush-fault', op: 'writeTop', target: COMMIT_KEY, context: 'commit' }] }
                : { mode: 'none' },
            // Late-bound: the store exists after the scheduler is built.
            unflushed: key => rigRef?.fake.markUnflushed(key),
        },
        prepare: fake => {
            // Planted before the rig's own environment exists: the keys come from a seeded environment of their own.
            const env = testEnv(createClock(), 9100 + seed)
            for (let i = 0; i < ORPHANS; i++) {
                const key = newUnitKey(env)
                orphans.push(key)
                fake.plant(key, new Uint8Array([i & 255, 1, 2]))
            }
        },
    })
    rigRef = rig
    let gc: GcResult | null = null
    let idleBeforeGc: string | null = null
    spawnPage(rig, 'P', 301, async page => {
        const session = await page.open()
        if (!flipIdle) {
            page.actor.setContext({ kind: 'gc' })
        }
        const deps = buildAutoGcDeps(session, CLEAN)
        if (deps === null) {
            throw new Error('The page has no backend.')
        }
        if (flipIdle) {
            await page.commit(session, 'flip')
            idleBeforeGc = session.idleReason
            page.actor.setContext({ kind: 'gc' })
        }
        gc = await gcPass(deps)
    })
    const result = await rig.run()
    const left = orphans.filter(key => rig.fake.peek(key) !== null && rig.fake.peek(key) !== undefined).length
    return { status: result.status, gc, idleBeforeGc, orphansLeft: left, violations: rig.checker.violations.map(violation => violation.property) }
}

describe('the automatic clean-up over the Tauri rig', () => {
    test.each(SEEDS)('guard (a): the deps the runner builds finish a pass that deletes the orphans, with no checker violation (seed %i)', async seed => {
        const out = await runProgram(seed, false)

        expect(out.status).toBe('finished')
        expect(out.violations).toEqual([])
        expect(out.gc).toEqual({ status: 'done', deleted: ORPHANS, batches: 2 })
        expect(out.orphansLeft).toBe(0)
    })

    test.each(SEEDS)('guard (b): a page whose own commit-key write was not flushed refuses idle at the gate and keeps every orphan (seed %i)', async seed => {
        const out = await runProgram(seed, true)

        expect(out.status).toBe('finished')
        expect(out.idleBeforeGc, 'the page turned idle after the deps were built').not.toBeNull()
        expect(out.gc).toMatchObject({ status: 'refused', reason: 'idle' })
        expect(out.orphansLeft).toBe(ORPHANS)
    })
})
