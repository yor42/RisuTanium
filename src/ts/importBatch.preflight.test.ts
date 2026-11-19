/**
 * `runImportBatch` with `preflight`: the confirm wait before any item runs, outside the busy scope, and what each answer
 * ends in. The real `alertTask.svelte.ts` and `busyActions.ts` run; the alert store is a recorder. The card's rendering
 * is tested with the card.
 *
 * Labels: (RR-m) new behaviour pinned by mutants; (CG) compatibility guard that holds before and after.
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
import { runImportBatch, type ImportItem, type ImportOutcome } from './importBatch'
import * as importBatch from './importBatch'
import { alertTask, answerTask, confirmTask, declineTask, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing, taskShown } from './alertTask.svelte'
import { taskMiB, type TaskClock, type TaskConfirm } from '../lib/Nexus/pattern/taskProgress'
import { beginBusy, busyKinds } from './process/memory/busyActions'
import { beginRestoreRun, resetRestoreInProgressForTests } from './drive/restoreInProgress'

const TASK = { title: 'Importing', steps: ['read', 'check', 'assets', 'add'] as const }
const ok: ImportOutcome = { kind: 'imported', index: null }
const MiB = 1024 * 1024

const opts = (extra: Record<string, unknown> = {}) => ({ task: TASK, preflight: true, ...extra }) as Parameters<typeof runImportBatch>[1]

type Sized = ImportItem & { size?: number }
const item = (name: string, run: ImportItem['run'] = async () => ok, size?: number): Sized => ({ name, run, ...(size === undefined ? {} : { size }) })

async function until(condition: () => boolean): Promise<boolean> {
    for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 0))
    return condition()
}
const confirmShowing = () => until(() => taskHostView()?.state === 'confirm')
const resultShowing = () => until(() => taskResultShowing())

beforeEach(() => {
    h.alert.v = { type: 'none', msg: '' }
    let now = 0
    const clock: TaskClock = {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => { },
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    resetTaskHostForTests()
    resetRestoreInProgressForTests()
    vi.restoreAllMocks()
})

describe('the preflight wait', () => {
    // R3-16
    test('R3-16 (RR-m): nothing runs and no busy scope begins until confirm; the items then run in order inside busy', async () => {
        const order: string[] = []
        const during: string[][] = []
        const run = (name: string): ImportItem['run'] => async () => { order.push(name); during.push(busyKinds()); return ok }
        const done = runImportBatch([item('a', run('a')), item('b', run('b'))], opts())
        expect(await confirmShowing()).toBe(true)
        expect(order).toEqual([])
        expect(busyKinds()).toEqual([])
        confirmTask()
        expect(await resultShowing()).toBe(true)
        expect(order).toEqual(['a', 'b'])
        expect(during).toEqual([['import'], ['import']])
        answerTask({ kind: 'ok' })
        expect((await done).imported).toBe(2)
    })

    // R3-17
    test('R3-17 (RR-m): declining runs nothing, begins no busy scope, posts no result and reports notStarted', async () => {
        const run = vi.fn(async () => ok)
        const done = runImportBatch([item('a', run), item('b', run)], opts())
        expect(await confirmShowing()).toBe(true)
        declineTask()
        const summary = await done
        expect(run).not.toHaveBeenCalled()
        expect(busyKinds()).toEqual([])
        expect((summary as { notStarted?: true }).notStarted).toBe(true)
        expect(summary.imported).toBe(0)
        expect(taskShown()).toBe(false)
        expect(taskResultShowing()).toBe(false)
    })

    // R3-18
    test('R3-18 (RR-m): a newer task replaces the preflight, nothing runs and the action ends silently', async () => {
        const run = vi.fn(async () => ok)
        const done = runImportBatch([item('a', run), item('b', run)], opts())
        expect(await confirmShowing()).toBe(true)
        alertTask({ title: 'Other', steps: [{ label: 'x' }] })
        const summary = await done
        expect(run).not.toHaveBeenCalled()
        expect((summary as { notStarted?: true }).notStarted).toBe(true)
        expect(console.error).not.toHaveBeenCalled()
        expect(busyKinds()).toEqual([])
    })

    // G1-E2 closed answer
    test('G1-E2 (RR-m): a preflight card that is closed runs nothing and ends silently', async () => {
        const run = vi.fn(async () => ok)
        const done = runImportBatch([item('a', run), item('b', run)], opts())
        expect(await confirmShowing()).toBe(true)
        resetTaskHostForTests()
        const summary = await done
        expect(run).not.toHaveBeenCalled()
        expect((summary as { notStarted?: true }).notStarted).toBe(true)
        expect(busyKinds()).toEqual([])
        expect(console.error).not.toHaveBeenCalled()
    })

    // G1-E2 restore began during the wait
    test('G1-E2 (RR-m): a restore that begins during the wait ends the action silently after confirm', async () => {
        const run = vi.fn(async () => ok)
        const done = runImportBatch([item('a', run), item('b', run)], opts())
        expect(await confirmShowing()).toBe(true)
        beginRestoreRun()
        confirmTask()
        const summary = await done
        expect(run).not.toHaveBeenCalled()
        expect(busyKinds()).toEqual([])
        expect((summary as { notStarted?: true }).notStarted).toBe(true)
        expect(taskShown()).toBe(false)
    })

    // R3-21
    test('R3-21 (RR-m): the caller outer busy scope ends before the sheet waits', async () => {
        const outer = beginBusy('import')
        expect(busyKinds()).toEqual(['import'])
        const done = runImportBatch([item('a'), item('b')], opts({ outerBusy: outer }))
        expect(await confirmShowing()).toBe(true)
        expect(busyKinds()).toEqual([])
        declineTask()
        await done
    })
})

describe('when the preflight does not show', () => {
    test('R3-19 (RR-m): one item opens in running, and a Retry round never asks again', async () => {
        const single = runImportBatch([item('a')], opts())
        expect(await resultShowing()).toBe(true)
        answerTask({ kind: 'ok' })
        await single

        const fail: ImportOutcome = { kind: 'failed', error: 'x' }
        const states: (string | undefined)[] = []
        let tries = 0
        const done = runImportBatch([
            item('a', async () => { states.push(taskHostView()?.state); tries++; return tries <= 2 ? fail : ok }),
            item('b', async () => { states.push(taskHostView()?.state); tries++; return tries <= 2 ? fail : ok }),
        ], opts())
        expect(await confirmShowing()).toBe(true)
        confirmTask()
        expect(await resultShowing()).toBe(true)
        answerTask({ kind: 'action', id: 'retry' })
        await until(() => tries >= 4)
        expect(await resultShowing()).toBe(true)
        expect(states).toEqual(['running', 'running', 'running', 'running'])
        answerTask({ kind: 'ok' })
        await done
    })

    test('R3-19 (RR-m): two items with preflight show the confirm, one item shows none', async () => {
        const two = runImportBatch([item('a'), item('b')], opts())
        expect(await confirmShowing()).toBe(true)
        declineTask()
        await two
        const one = runImportBatch([item('a')], opts())
        expect(await resultShowing()).toBe(true)
        expect(taskHostView()?.state).not.toBe('confirm')
        answerTask({ kind: 'ok' })
        await one
    })

    test('(CG) without the option two items run at once, as before', async () => {
        const run = vi.fn(async () => ok)
        const done = runImportBatch([item('a', run), item('b', run)], { task: TASK })
        expect(await resultShowing()).toBe(true)
        expect(run).toHaveBeenCalledTimes(2)
        answerTask({ kind: 'ok' })
        await done
    })
})

describe('composeImportPreflight', () => {
    const compose = (items: ImportItem[]): TaskConfirm | null =>
        importBatch.composeImportPreflight(items)

    // R3-20
    test('R3-20 (RR-m): the card states the count and the exact total, only when every size is known', async () => {
        const done = runImportBatch([item('a', undefined, 1 * MiB), item('b', undefined, 2 * MiB)], opts())
        expect(await confirmShowing()).toBe(true)
        const confirm = taskHostView()?.confirm
        expect(confirm?.headline).toBe(language.importPreflightHeadline(2))
        expect(confirm?.consequences).toContain(language.importPreflightSize(taskMiB(3 * MiB)))
        expect(confirm?.primaryLabel).toBe(language.importPreflightStart)
        expect(confirm?.cancelLabel).toBe(language.cancel)
        declineTask()
        await done

        const partial = runImportBatch([item('a', undefined, 1 * MiB), item('b')], opts())
        expect(await confirmShowing()).toBe(true)
        const lines = taskHostView()?.confirm?.consequences ?? []
        expect(lines).toEqual([language.importPreflightAdds])
        declineTask()
        await partial
    })

    test('R3-20 (RR-m): fewer than two items compose nothing; a negative or non-finite size drops the size line', () => {
        expect(compose([item('a', undefined, MiB)])).toBeNull()
        const full = compose([item('a', undefined, MiB), item('b', undefined, MiB)])
        expect(full?.consequences?.length).toBe(2)
        for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(compose([item('a', undefined, MiB), item('b', undefined, bad)])?.consequences).toEqual([language.importPreflightAdds])
        }
    })
})
