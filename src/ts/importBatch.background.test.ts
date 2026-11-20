/**
 * `runImportBatch` with `background`: the card the runner opens offers "Keep going in the background", the summary says
 * when a round was sent there, a dismissed toast ends the action like OK, a Modules-style round holds the offer until its
 * last duplicate decision, and a backgrounded or replaced round never clears an unrelated wait. The real
 * `alertTask.svelte.ts` and `busyActions.ts` run; the alert store is a recorder and the toast presenter is a fake.
 *
 * Labels: (RR) fails on the tree before the wiring; (CG) compatibility guard that holds before and after; (U) pins a
 * rule through mutants.
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

import { runImportBatch, type ImportItem, type ImportOutcome } from './importBatch'
import {
    alertTask,
    answerTask,
    backgroundOffered,
    backgroundTask,
    confirmTask,
    resetTaskHostForTests,
    setTaskClockForTests,
    setTaskToastPresenter,
    taskHostView,
    taskResultShowing,
    taskShown,
    type TaskToastPresenter,
} from './alertTask.svelte'
import type { TaskClock } from '../lib/Nexus/pattern/taskProgress'
import { isBusy } from './process/memory/busyActions'

const TASK = { title: 'Importing', steps: ['read', 'check', 'assets', 'add'] as const }
const ok: ImportOutcome = { kind: 'imported', index: null }
const bad: ImportOutcome = { kind: 'failed', error: 'x' }

type Ends = { open(): void, end(): void }
let ends: Ends[] = []
let presenterEnds: { id: number, returnFocus: boolean }[] = []

function installPresenter(): void {
    ends = []
    presenterEnds = []
    const presenter: TaskToastPresenter = {
        post: (_view, on) => { ends.push(on); return ends.length },
        update: () => { },
        end: (id, opts) => { presenterEnds.push({ id, returnFocus: opts.returnFocus }) },
    }
    setTaskToastPresenter(presenter)
}

function deferred<T>(): { promise: Promise<T>, resolve(value: T): void } {
    let resolve: (value: T) => void = () => { }
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
}

const item = (name: string, run: ImportItem['run'] = async () => ok): ImportItem => ({ name, run })

async function until(condition: () => boolean): Promise<boolean> {
    for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 0))
    return condition()
}
const resultShowing = () => until(() => taskResultShowing())
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// The toast's end acts only once the result is posted, so it is offered until the action settles.
async function endToastWhenDone(done: Promise<unknown>): Promise<void> {
    let finished = false
    void done.then(() => { finished = true }, () => { finished = true })
    await until(() => { ends[0]?.end(); return finished })
}

beforeEach(() => {
    h.alert.v = { type: 'none', msg: '' }
    const clock: TaskClock = {
        now: () => 0,
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => { },
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    installPresenter()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

describe('the card offers the background', () => {
    test('R4-23 (RR): a spec with background opens a running card that offers it, and a spec without does not', async () => {
        const gate = deferred<ImportOutcome>()
        const done = runImportBatch([item('a', () => gate.promise)], { task: { ...TASK, background: true } })
        await until(() => taskHostView()?.state === 'running')
        expect(taskHostView()?.background).toBe(true)
        gate.resolve(ok)
        expect(await resultShowing()).toBe(true)
        answerTask({ kind: 'ok' })
        expect((await done).backgrounded).toBeUndefined()

        const other = deferred<ImportOutcome>()
        const plain = runImportBatch([item('a', () => other.promise)], { task: TASK })
        await until(() => taskHostView()?.state === 'running')
        expect(taskHostView()?.background).toBeUndefined()
        other.resolve(ok)
        expect(await resultShowing()).toBe(true)
        answerTask({ kind: 'ok' })
        await plain
    })

    test('R4-23 (RR): with a preflight the confirm card cannot be backgrounded, the confirmed card can', async () => {
        const gate = deferred<ImportOutcome>()
        const done = runImportBatch([item('a', () => gate.promise), item('b')], { task: { ...TASK, background: true }, preflight: true })
        await until(() => taskHostView()?.state === 'confirm')
        expect(backgroundTask()).toBe(false)
        expect(taskShown()).toBe(true)
        confirmTask()
        await until(() => taskHostView()?.state === 'running')
        expect(taskHostView()?.background).toBe(true)
        expect(backgroundTask()).toBe(true)
        gate.resolve(ok)
        await endToastWhenDone(done)
        const summary = await done
        expect(summary.backgrounded).toBe(true)
    })

    test('R4-23 (RR): a Retry round opens a card that offers the background again', async () => {
        const states: (true | undefined)[] = []
        let tries = 0
        const done = runImportBatch([item('a', async () => { states.push(taskHostView()?.background); return ++tries === 1 ? bad : ok })], { task: { ...TASK, background: true } })
        expect(await resultShowing()).toBe(true)
        answerTask({ kind: 'action', id: 'retry' })
        await until(() => tries === 2)
        expect(await resultShowing()).toBe(true)
        expect(states).toEqual([true, true])
        answerTask({ kind: 'ok' })
        await done
    })

    test('R4-23 (RR): a backgrounded failed result with Retry that is dismissed ends the action and starts no second round', async () => {
        let runs = 0
        const gate = deferred<ImportOutcome>()
        const done = runImportBatch([item('a', async () => { runs++; return gate.promise })], { task: { ...TASK, background: true } })
        await until(() => taskHostView()?.state === 'running')
        expect(backgroundTask()).toBe(true)
        gate.resolve(bad)
        await endToastWhenDone(done)
        const summary = await done
        expect(runs).toBe(1)
        expect(summary.backgrounded).toBe(true)
        expect(summary.notImported).toBe(1)
    })

    test('R-b (RR): a round that was backgrounded keeps the action backgrounded when a reopened Retry round is answered in front', async () => {
        let tries = 0
        const gate = deferred<ImportOutcome>()
        const done = runImportBatch([item('a', async () => (++tries === 1 ? gate.promise : ok))], { task: { ...TASK, background: true } })
        await until(() => taskHostView()?.state === 'running')
        expect(backgroundTask()).toBe(true)
        gate.resolve(bad)
        // The failed result waits on its toast; reopening it brings the card back in front.
        expect(await until(() => { ends[0]?.open(); return taskResultShowing() })).toBe(true)
        answerTask({ kind: 'action', id: 'retry' })
        await until(() => tries === 2)
        expect(await resultShowing()).toBe(true)
        answerTask({ kind: 'ok' })
        const summary = await done
        expect(tries).toBe(2)
        expect(summary.backgrounded).toBe(true)
    })
})

describe('a held offer', () => {
    test('R4-37 (RR): the offer comes with the last file\'s decision when no file replaced', async () => {
        const seen: (true | undefined)[] = []
        const done = runImportBatch([
            item('a', async (progress) => { progress.decided(false); seen.push(taskHostView()?.background); return ok }),
            item('b', async (progress) => { seen.push(taskHostView()?.background); progress.decided(false); seen.push(taskHostView()?.background); return ok }),
        ], { task: { ...TASK, background: true, backgroundHeld: true } })
        expect(await resultShowing()).toBe(true)
        expect(seen).toEqual([undefined, undefined, true])
        answerTask({ kind: 'ok' })
        await done
    })

    test('R4-37 (U): a decision reported through a nested progress counts like the file\'s own', async () => {
        const seen: (true | undefined)[] = []
        const done = runImportBatch([
            item('a', async (progress) => { progress.nested().nested().decided(false); seen.push(taskHostView()?.background); return ok }),
        ], { task: { ...TASK, background: true, backgroundHeld: true } })
        expect(await resultShowing()).toBe(true)
        expect(seen).toEqual([true])
        answerTask({ kind: 'ok' })
        await done
    })

    test('R4-37 (RR): a Replace in an earlier file keeps the offer away for the rest of the round', async () => {
        const seen: (true | undefined)[] = []
        const done = runImportBatch([
            item('a', async (progress) => { progress.decided(true); return ok }),
            item('b', async (progress) => { progress.decided(false); seen.push(taskHostView()?.background); return ok }),
        ], { task: { ...TASK, background: true, backgroundHeld: true } })
        expect(await resultShowing()).toBe(true)
        expect(seen).toEqual([undefined])
        answerTask({ kind: 'ok' })
        await done
    })

    test('R4-37 (RR): a one-file round is offered at its decision', async () => {
        const seen: (true | undefined)[] = []
        const done = runImportBatch([
            item('a', async (progress) => { seen.push(taskHostView()?.background); progress.decided(false); seen.push(taskHostView()?.background); return ok }),
        ], { task: { ...TASK, background: true, backgroundHeld: true } })
        expect(await resultShowing()).toBe(true)
        expect(seen).toEqual([undefined, true])
        answerTask({ kind: 'ok' })
        await done
    })

    test('R4-37 (RR): a Retry round starts held again', async () => {
        let tries = 0
        const seen: (true | undefined)[] = []
        const done = runImportBatch([
            item('a', async (progress) => {
                progress.decided(false)
                tries++
                if (tries === 2) seen.push(taskHostView()?.background)
                return tries === 1 ? bad : ok
            }),
        ], { task: { ...TASK, background: true, backgroundHeld: true } })
        expect(await resultShowing()).toBe(true)
        answerTask({ kind: 'action', id: 'retry' })
        expect(await until(() => tries === 2)).toBe(true)
        expect(await resultShowing()).toBe(true)
        // The retry's own decision offered the new card; it did not inherit the first card's offer.
        expect(seen).toEqual([true])
        answerTask({ kind: 'ok' })
        await done
    })
})

describe('a round that may replace guards the other cards', () => {
    test('E-1 (RR): while a replaced round runs, no card offers the background until that round ends', async () => {
        const a = deferred<ImportOutcome>()
        const b = deferred<ImportOutcome>()
        const done = runImportBatch([
            item('a', async (progress) => { await a.promise; progress.decided(false); return ok }),
            item('b', async (progress) => { await b.promise; progress.decided(false); return ok }),
        ], { task: { ...TASK, background: true, backgroundHeld: true }, mayReplace: true })
        await until(() => taskHostView()?.state === 'running')
        // A drop card replaces the running round's card.
        alertTask({ title: 'Drop', steps: [{ label: 'x' }], background: true })
        expect(backgroundOffered()).toBe(false)
        expect(backgroundTask()).toBe(false)
        a.resolve(ok)
        await settle()
        expect(backgroundOffered()).toBe(false)
        b.resolve(ok)
        await until(() => backgroundOffered())
        expect(backgroundOffered()).toBe(true)
        resetTaskHostForTests()
        await done
    })

    test('E-1 (RR): a round in front releases the guard when its last decision is made, then offers', async () => {
        const seen: boolean[] = []
        const done = runImportBatch([
            item('a', async (progress) => { seen.push(backgroundOffered()); progress.decided(false); seen.push(backgroundOffered()); return ok }),
        ], { task: { ...TASK, background: true, backgroundHeld: true }, mayReplace: true })
        expect(await resultShowing()).toBe(true)
        expect(seen).toEqual([false, true])
        answerTask({ kind: 'ok' })
        await done
        expect(backgroundOffered()).toBe(true)
    })

    test('E-1 (RR): a throwing round releases the guard at its end', async () => {
        const done = runImportBatch([
            item('a', async () => { throw new Error('boom') }),
        ], { task: { ...TASK, background: true, backgroundHeld: true }, mayReplace: true })
        expect(await resultShowing()).toBe(true)
        expect(backgroundOffered()).toBe(true)
        answerTask({ kind: 'ok' })
        await done
    })

    test('E-1 (CG): a round that may not replace never holds the guard', async () => {
        const gate = deferred<ImportOutcome>()
        const done = runImportBatch([item('a', () => gate.promise)], { task: { ...TASK, background: true } })
        await until(() => taskHostView()?.state === 'running')
        expect(backgroundOffered()).toBe(true)
        gate.resolve(ok)
        expect(await resultShowing()).toBe(true)
        answerTask({ kind: 'ok' })
        await done
    })
})

describe('the stale-wait probe', () => {
    const running = () => until(() => taskHostView()?.state === 'running')

    test('R4-29 (RR, U): a backgrounded round leaves an unrelated wait on screen at its end', async () => {
        const gate = deferred<ImportOutcome>()
        const done = runImportBatch([item('a', () => gate.promise)], { task: { ...TASK, background: true } })
        await running()
        expect(backgroundTask()).toBe(true)
        h.alertStore.set({ type: 'wait', msg: 'other work' })
        gate.resolve(ok)
        for (let i = 0; i < 20; i++) await settle()
        expect(h.alert.v.type).toBe('wait')
        await endToastWhenDone(done)
        await done
    })

    test('R4-29 (U): a replaced (detached) round leaves an unrelated wait on screen at its end', async () => {
        const gate = deferred<ImportOutcome>()
        const done = runImportBatch([item('a', () => gate.promise)], { task: { ...TASK, background: true } })
        await running()
        const other = alertTask({ title: 'Other', steps: [{ label: 'x' }] })
        h.alertStore.set({ type: 'wait', msg: 'other work' })
        gate.resolve(ok)
        await done
        expect(h.alert.v.type).toBe('wait')
        other.close()
    })

    test('R4-29 (U): a reopened card that finishes in front still clears a stale wait its own item left', async () => {
        const gate = deferred<ImportOutcome>()
        const done = runImportBatch([item('a', () => gate.promise)], { task: { ...TASK, background: true } })
        await running()
        expect(backgroundTask()).toBe(true)
        ends[0].open()
        expect(taskShown()).toBe(true)
        h.alertStore.set({ type: 'wait', msg: 'stale callee wait' })
        gate.resolve(ok)
        expect(await resultShowing()).toBe(true)
        expect(h.alert.v.type).toBe('none')
        answerTask({ kind: 'ok' })
        await done
    })

    test('R4-29 (CG): a foreground round clears a stale wait before its result', async () => {
        const gate = deferred<ImportOutcome>()
        const done = runImportBatch([item('a', () => gate.promise)], { task: TASK })
        await running()
        h.alertStore.set({ type: 'wait', msg: 'stale callee wait' })
        gate.resolve(ok)
        expect(await resultShowing()).toBe(true)
        expect(h.alert.v.type).toBe('none')
        answerTask({ kind: 'ok' })
        await done
    })
})

describe('afterRound', () => {
    test('R4-30 (RR): runs once per round after the files and before the result, inside the busy scope', async () => {
        const calls: { round: number, resultShowing: boolean, busy: boolean }[] = []
        let tries = 0
        const done = runImportBatch([item('a', async () => (++tries === 1 ? bad : ok))], {
            task: TASK,
            afterRound: (round) => { calls.push({ round, resultShowing: taskResultShowing(), busy: isBusy() }) },
        })
        expect(await resultShowing()).toBe(true)
        answerTask({ kind: 'action', id: 'retry' })
        await until(() => tries === 2)
        expect(await resultShowing()).toBe(true)
        answerTask({ kind: 'ok' })
        await done
        expect(calls).toEqual([
            { round: 0, resultShowing: false, busy: true },
            { round: 1, resultShowing: false, busy: true },
        ])
    })

    test('R4-30 (RR): a throw is logged and the result still posts', async () => {
        const done = runImportBatch([item('a')], { task: TASK, afterRound: () => { throw new Error('boom') } })
        expect(await resultShowing()).toBe(true)
        expect(console.error).toHaveBeenCalled()
        answerTask({ kind: 'ok' })
        expect((await done).imported).toBe(1)
    })
})
