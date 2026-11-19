/**
 * `runImportBatch` with a task card: rounds, the write gate, Cancel, Retry, the busy span and the result composition,
 * on fake items. The real `alertTask.svelte.ts`, `busyActions.ts` and `inFlightWork.ts` run; the alert store is a
 * recorder. The card's own rendering is the stage 1 tests.
 *
 * Labels: (RR-m) new behaviour pinned by mutants; (new-API guard) holds for the new `task` option and progress, which
 * the previous runner does not have, so it cannot pass before the change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
    const alert: { v: { type: string, msg: string }, subs: Set<(v: { type: string, msg: string }) => void> } = {
        v: { type: 'none', msg: '' },
        subs: new Set(),
    }
    return {
        alert,
        alertStore: {
            set: (v: { type: string, msg: string }) => { alert.v = v; for (const run of [...alert.subs]) run(v) },
            subscribe: (run: (v: { type: string, msg: string }) => void) => {
                alert.subs.add(run)
                run(alert.v)
                return () => { alert.subs.delete(run) }
            },
        },
    }
})

vi.mock('./alert', () => ({
    alertError: (msg: string) => h.alertStore.set({ type: 'error', msg: String(msg) }),
    alertClear: () => h.alertStore.set({ type: 'none', msg: '' }),
    alertWait: (msg: string) => h.alertStore.set({ type: 'wait', msg }),
    alertNormal: (msg: string) => h.alertStore.set({ type: 'normal', msg }),
}))

vi.mock('./stores.svelte', () => ({ alertStore: h.alertStore }))

import { language } from 'src/lang'
import { composeImportResult, runImportBatch, type ImportItem, type ImportOutcome } from './importBatch'
import type { ImportProgress } from './importProgress'
import { alertTask, answerTask, requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing } from './alertTask.svelte'
import type { TaskClock } from '../lib/Nexus/pattern/taskProgress'
import { beginBusy, busyKinds } from './process/memory/busyActions'
import { inFlightKinds } from './process/inFlightWork'
import { beginRestoreRun, resetRestoreInProgressForTests } from './drive/restoreInProgress'
import { alertWait } from './alert'

const TASK = { title: 'Importing', steps: ['read', 'check', 'assets', 'add'] as const }
const ok: ImportOutcome = { kind: 'imported', index: null }

type Run = (progress: ImportProgress) => Promise<ImportOutcome>
const item = (name: string, run: Run): ImportItem => ({ name, run })

async function untilResult(done: Promise<unknown>): Promise<boolean> {
    let ended = false
    void done.then(() => { ended = true })
    for (let i = 0; i < 400 && !ended && !taskResultShowing(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return taskResultShowing()
}

beforeEach(() => {
    h.alert.v = { type: 'none', msg: '' }
    let now = 0
    const clock: TaskClock = {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    resetRestoreInProgressForTests()
    vi.restoreAllMocks()
})

describe('the write gate and Cancel', () => {
    test('R-a8 (RR-m): a Cancel pressed just before the first gate makes it throw, nothing is written and the round is Cancelled', async () => {
        const writes: string[] = []
        let thrown: unknown
        const done = runImportBatch([item('a', async (progress) => {
            requestTaskCancel()
            try {
                progress.beforeWrite()
                writes.push('a')
            } catch (error) {
                thrown = error
                throw error
            }
            return ok
        })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(taskHostView()?.cancelled).toBe(true)
        expect((thrown as Error | undefined)?.name).toBe('ImportCancelled')
        expect(writes).toEqual([])
        answerTask({ kind: 'ok' })
        expect((await done).cancelled).toBe(true)
    })

    test('R-a7 (RR-m): after the gate Cancel is withdrawn, a press is ignored and the later file in the round is not offered it', async () => {
        const seen: (boolean | undefined)[] = []
        const done = runImportBatch([
            item('a', async (progress) => { progress.beforeWrite(); return ok }),
            item('b', async () => { seen.push(taskHostView()?.cancelOffered); requestTaskCancel(); return ok }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(seen).toEqual([false])
        expect(taskHostView()?.cancelled).toBe(false)
        expect(taskHostView()?.result?.headline).toBe(language.importTaskImported(2))
        answerTask({ kind: 'ok' })
        expect((await done).imported).toBe(2)
    })

    test('R-a8 (RR-m): a Cancel between files stops the round and the later file never runs', async () => {
        let secondRan = false
        const done = runImportBatch([
            item('a', async () => { requestTaskCancel(); return ok }),
            item('b', async () => { secondRan = true; return ok }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(taskHostView()?.cancelled).toBe(true)
        expect(secondRan).toBe(false)
        answerTask({ kind: 'ok' })
        await done
    })

    test('R-a12b (RR-m): a round with a commit marker is never reported Cancelled', async () => {
        const done = runImportBatch([item('a', async (progress) => {
            progress.committed()
            requestTaskCancel()
            return ok
        })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(taskHostView()?.cancelled).toBe(false)
        expect(taskHostView()?.result?.headline).toBe(language.importTaskImported(1))
        answerTask({ kind: 'ok' })
        expect((await done).cancelled).toBeUndefined()
    })

    test('R-a20 (RR-m): a replaced round keeps writing, ends silently and is never read as a cancel', async () => {
        const writes: string[] = []
        const done = runImportBatch([item('a', async (progress) => {
            alertTask({ title: 'Other', steps: [{ label: 'x' }] })
            progress.beforeWrite()
            writes.push('a')
            return ok
        })], { task: TASK })
        const summary = await done
        expect(writes).toEqual(['a'])
        expect(summary.cancelled).toBeUndefined()
        expect(taskHostView()?.title).toBe('Other')
        expect(taskHostView()?.state).toBe('running')
    })
})

describe('Retry', () => {
    test('R-a12 (RR-m): only a failed item without a marker is offered Retry, and Retry re-runs it alone', async () => {
        const ran: Record<string, number> = {}
        const count = (name: string) => { ran[name] = (ran[name] ?? 0) + 1 }
        let flaky = 0
        const done = runImportBatch([
            item('refused', async () => { count('refused'); return { kind: 'refused', reason: 'bad' } }),
            item('declined', async () => { count('declined'); return { kind: 'declined' } }),
            item('skipped', async () => { count('skipped'); return { kind: 'skipped' } }),
            item('flaky', async () => { count('flaky'); flaky += 1; return flaky === 1 ? { kind: 'failed', error: 'boom' } : ok }),
            item('marked', async (progress) => { count('marked'); progress.committed(); return { kind: 'failed', error: 'late' } }),
            item('fine', async () => { count('fine'); return ok }),
        ], { task: TASK, declinedReason: 'declined reason' })
        expect(await untilResult(done)).toBe(true)
        const view = taskHostView()
        expect(view?.result?.actions).toEqual([{ id: 'retry', label: language.importTaskRetryFailed(1) }])
        expect(view?.result?.skipped?.map((s) => s.name)).toEqual(['refused', 'declined', 'flaky', 'marked'])
        answerTask({ kind: 'action', id: 'retry' })
        expect(await untilResult(done)).toBe(true)
        expect(taskHostView()?.result?.headline).toBe(language.importTaskImported(1))
        answerTask({ kind: 'ok' })
        await done
        expect(ran).toEqual({ refused: 1, declined: 1, skipped: 1, flaky: 2, marked: 1, fine: 1 })
    })

    test('R-a12 (RR-m): a single failed item with a marker has an unknown data state and no Retry', async () => {
        const done = runImportBatch([item('a', async (progress) => { progress.committed(); return { kind: 'failed', error: 'late' } })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(taskHostView()?.failure?.dataState).toBe('unknown')
        expect(taskHostView()?.failure?.actions ?? []).toEqual([])
        answerTask({ kind: 'ok' })
        await done
    })

    test('R-a12 (RR-m): a single unmarked failure offers Retry, a single refusal and a single decline do not', async () => {
        const failed = runImportBatch([item('a', async () => ({ kind: 'failed', error: 'x' }))], { task: TASK })
        expect(await untilResult(failed)).toBe(true)
        expect(taskHostView()?.failure?.actions).toEqual([{ id: 'retry', label: language.importTaskRetryFailed(1) }])
        answerTask({ kind: 'ok' })
        await failed

        const refused = runImportBatch([item('a', async () => ({ kind: 'refused', reason: 'no' }))], { task: TASK })
        expect(await untilResult(refused)).toBe(true)
        expect(taskHostView()?.failure?.headline).toBe(language.importTaskFailedOne('a'))
        expect(taskHostView()?.failure?.actions ?? []).toEqual([])
        answerTask({ kind: 'ok' })
        await refused

        const declined = await runImportBatch([item('a', async () => ({ kind: 'declined' }))], { task: TASK })
        expect(declined.declined).toBe(1)
        expect(taskHostView()).toBeNull()
    })

    test('R-a11 (RR-m): a retried item gets a fresh round number and a one-item round position', async () => {
        const rounds: { number: number, index: number, count: number }[] = []
        let tries = 0
        const done = runImportBatch([
            item('a', async (progress) => { rounds.push({ ...progress.round }); return ok }),
            item('b', async (progress) => { rounds.push({ ...progress.round }); tries += 1; return tries === 1 ? { kind: 'failed', error: 'x' } : ok }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        answerTask({ kind: 'action', id: 'retry' })
        expect(await untilResult(done)).toBe(true)
        answerTask({ kind: 'ok' })
        await done
        expect(rounds).toEqual([{ number: 0, index: 0, count: 2 }, { number: 0, index: 1, count: 2 }, { number: 1, index: 0, count: 1 }])
    })

    test('R-a16 (RR-m): no Retry round starts after a restore began while the result waited', async () => {
        let runs = 0
        const done = runImportBatch([item('a', async () => { runs += 1; return { kind: 'failed', error: 'x' } })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        beginRestoreRun()
        answerTask({ kind: 'action', id: 'retry' })
        await done
        expect(runs).toBe(1)
    })
})

describe('the busy span', () => {
    test('R-a16 (RR-m): busy and the working token cover each running round, not the wait for the answer', async () => {
        const during: string[][] = []
        const tokens: boolean[] = []
        let tries = 0
        const done = runImportBatch([item('a', async () => {
            during.push(busyKinds())
            tokens.push(inFlightKinds().includes('busy'))
            tries += 1
            return tries === 1 ? { kind: 'failed', error: 'x' } : ok
        })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(busyKinds()).toEqual([])
        expect(inFlightKinds()).not.toContain('busy')
        answerTask({ kind: 'action', id: 'retry' })
        expect(await untilResult(done)).toBe(true)
        expect(busyKinds()).toEqual([])
        answerTask({ kind: 'ok' })
        await done
        expect(during).toEqual([['import'], ['import']])
        expect(tokens).toEqual([true, true])
    })

    test('R-a16 (RR-m): an outer busy handle ends when the first result posts', async () => {
        const outer = beginBusy('import')
        const done = runImportBatch([item('a', async () => ok)], { task: TASK, outerBusy: outer })
        expect(await untilResult(done)).toBe(true)
        expect(busyKinds()).toEqual([])
        answerTask({ kind: 'ok' })
        await done
    })
})

describe('legacy surfaces', () => {
    test('R-a23 (RR-m): a legacy wait left by an item is cleared before the result is posted', async () => {
        const done = runImportBatch([item('a', async () => { alertWait('Saving'); return ok })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(h.alert.v.type).toBe('none')
        answerTask({ kind: 'ok' })
        await done
    })

    test('R-a23 (new-API guard): a normal notice left by an item is not cleared', async () => {
        const done = runImportBatch([item('a', async () => { h.alertStore.set({ type: 'normal', msg: 'kept' }); return ok })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(h.alert.v).toEqual({ type: 'normal', msg: 'kept' })
        answerTask({ kind: 'ok' })
        await done
    })
})

describe('without a task', () => {
    test('R-a14 (new-API guard): the run still gets a progress that never gates and the legacy end message is unchanged', async () => {
        let tasked: boolean | undefined
        const summary = await runImportBatch([item('a', async (progress) => { tasked = progress.tasked; progress.beforeWrite(); return { kind: 'refused', reason: 'no' } })])
        expect(tasked).toBe(false)
        expect(summary.own).toEqual({ kind: 'refused', reason: 'no' })
        expect(h.alert.v.type).toBe('error')
        expect(taskHostView()).toBeNull()
    })
})

describe('composeImportResult', () => {
    const items = (...names: string[]) => names.map((name) => item(name, async () => ok))

    test('a single imported item is one headline with its notes', () => {
        const composed = composeImportResult(items('a'), [{ kind: 'imported', index: null, notes: ['n'] }], [false], {})
        expect(composed).toEqual({ kind: 'finish', result: { headline: language.importTaskImported(1), summary: ['n'] } })
    })

    test('a batch with nothing listed counts the imports and the skipped duplicates', () => {
        const composed = composeImportResult(items('a', 'b', 'c'), [ok, ok, { kind: 'skipped' }], [false, false, false], {})
        expect(composed).toEqual({ kind: 'finish', result: { headline: language.importTaskImported(2), summary: [language.importTaskDuplicatesLeftOut(1)] } })
    })

    test('a batch where nothing imported and something is listed fails with the list', () => {
        const composed = composeImportResult(items('a', 'b'), [{ kind: 'refused', reason: 'r1' }, { kind: 'declined' }], [false, false], { declinedReason: 'd' })
        expect(composed.kind).toBe('fail')
        if (composed.kind === 'fail') {
            expect(composed.failure.headline).toBe(language.importTaskNothingImported)
            expect(composed.failure.dataState).toBe('same')
            expect(composed.failure.skipped).toEqual([{ name: 'a', reason: 'r1' }, { name: 'b', reason: 'd' }])
        }
    })
})
