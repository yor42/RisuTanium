import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
    errors: [] as unknown[],
    busy: [] as string[],
}))

vi.mock('./alert', () => ({
    alertError: (e: unknown) => { h.errors.push(e) },
    alertClear: () => { },
}))

vi.mock('./stores.svelte', () => ({ alertStore: { subscribe: (run: (v: { type: string }) => void) => { run({ type: 'none' }); return () => { } } } }))

vi.mock('./process/memory/busyActions', () => ({
    withBusy: async <T>(kind: string, work: () => Promise<T>): Promise<T> => {
        h.busy.push('begin:' + kind)
        try {
            return await work()
        } finally {
            h.busy.push('end:' + kind)
        }
    },
}))

import { language } from 'src/lang'
import { ModuleRefusal } from './process/moduleRefusal'
import { ModuleImportStopped } from './process/moduleImportStop'
import { outcomeOfError, outcomeReason, runImportBatch, summariseImport, type ImportItem, type ImportOutcome } from './importBatch'
import { answerTask, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing } from './alertTask.svelte'
import type { TaskClock, TaskView } from '../lib/Nexus/pattern/taskProgress'

const item = (name: string, run: () => Promise<ImportOutcome>): ImportItem => ({ name, run })
const done = (outcome: ImportOutcome) => () => Promise.resolve(outcome)

const TASK = { title: 'Importing', steps: ['read', 'check', 'assets', 'add'] as const }

/** Runs the batch on its card, answers OK and returns the card it ended on (null when it closed without one) and the summary. */
async function runOnCard(items: ImportItem[], declinedReason?: string, afterImported?: (outcome: ImportOutcome) => void) {
    const run = runImportBatch(items, { task: TASK, declinedReason, afterImported })
    let ended = false
    void run.then(() => { ended = true })
    for (let i = 0; i < 400 && !ended && !taskResultShowing(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const card: TaskView | null = taskResultShowing() ? taskHostView() : null
    if (card) answerTask({ kind: 'ok' })
    return { card, summary: await run }
}

beforeEach(() => {
    h.errors = []
    h.busy = []
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
})

describe('outcomeOfError', () => {
    it('maps a module refusal to a refusal with its text', () => {
        expect(outcomeOfError(new ModuleRefusal('bad module'))).toEqual({ kind: 'refused', reason: 'bad module' })
    })
    it('maps the real ModuleImportStopped class by its reason', () => {
        expect(outcomeOfError(new ModuleImportStopped('declined'))).toEqual({ kind: 'declined' })
        expect(outcomeOfError(new ModuleImportStopped('skipped'))).toEqual({ kind: 'skipped' })
    })
    it('treats an error that only imitates the stop by name, any other error and a string as failures', () => {
        const imitation = Object.assign(new Error('stop'), { name: 'ModuleImportStopped', reason: 'declined' })
        expect(outcomeOfError(imitation).kind).toBe('failed')
        const error = new Error('x')
        expect(outcomeOfError(error)).toEqual({ kind: 'failed', error })
        expect(outcomeOfError('text')).toEqual({ kind: 'failed', error: 'text' })
    })
})

describe('outcomeReason', () => {
    it('gives the refusal text, the failure message and nothing for the rest', () => {
        expect(outcomeReason({ kind: 'refused', reason: 'r' })).toBe('r')
        expect(outcomeReason({ kind: 'failed', error: new Error('e') })).toBe('e')
        expect(outcomeReason({ kind: 'failed', error: 's' })).toBe('s')
        expect(outcomeReason({ kind: 'skipped' })).toBe('')
        expect(outcomeReason({ kind: 'declined' })).toBe('')
    })
})

describe('summariseImport', () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => item('f' + i, done({ kind: 'declined' })))

    it('lists refused and failed files and counts the total', () => {
        const s = summariseImport(items(3), [
            { kind: 'imported', index: null },
            { kind: 'refused', reason: 'no' },
            { kind: 'failed', error: new Error('boom') },
        ])
        expect(s.message).toBe(language.importFilesNotImported(2, 3, 'f1: no\nf2: boom'))
        expect(s.imported).toBe(1)
        expect(s.notImported).toBe(2)
    })

    it('counts a skipped file but never lists it', () => {
        const s = summariseImport(items(3), [
            { kind: 'skipped' },
            { kind: 'refused', reason: 'no' },
            { kind: 'skipped' },
        ])
        expect(s.skipped).toBe(2)
        expect(s.message).toBe(language.importFilesNotImported(1, 3, 'f1: no'))
    })

    it('has no message when everything imported or was skipped', () => {
        const s = summariseImport(items(2), [{ kind: 'imported', index: null }, { kind: 'skipped' }])
        expect(s.message).toBeNull()
        expect(s.own).toBeNull()
        expect(s.imported).toBe(1)
        expect(s.skipped).toBe(1)
    })

    it('is silent about a declined file without a reason', () => {
        const s = summariseImport(items(2), [{ kind: 'declined' }, { kind: 'imported', index: null }])
        expect(s.message).toBeNull()
        expect(s.declined).toBe(1)
        expect(s.notImported).toBe(0)
    })

    it('lists a declined file with the given reason', () => {
        const s = summariseImport(items(2), [{ kind: 'declined' }, { kind: 'imported', index: null }], { declinedReason: 'declined low-level' })
        expect(s.message).toBe(language.importFilesNotImported(1, 2, 'f0: declined low-level'))
        expect(s.declined).toBe(1)
        expect(s.notImported).toBe(1)
    })

    it('appends the notes of imported files after the list', () => {
        const s = summariseImport(items(3), [
            { kind: 'imported', index: null, notes: ['note A'] },
            { kind: 'refused', reason: 'no' },
            { kind: 'imported', index: null, notes: ['note B', 'note C'] },
        ])
        expect(s.message).toBe(language.importFilesNotImported(1, 3, 'f1: no') + '\nnote A\nnote B\nnote C')
        expect(s.notes).toEqual(['note A', 'note B', 'note C'])
    })

    it('hands back the notes without a message when nothing is listed', () => {
        const s = summariseImport(items(1), [{ kind: 'imported', index: null, notes: ['only note'] }])
        expect(s.message).toBeNull()
        expect(s.notes).toEqual(['only note'])
    })

    it('gives a single file its own outcome, except a summary-only refusal', () => {
        const own = summariseImport(items(1), [{ kind: 'refused', reason: 'no' }])
        expect(own.own).toEqual({ kind: 'refused', reason: 'no' })
        expect(own.message).toBeNull()

        const failed = summariseImport(items(1), [{ kind: 'failed', error: 'x' }])
        expect(failed.own).toEqual({ kind: 'failed', error: 'x' })

        const summaryOnly = summariseImport(items(1), [{ kind: 'refused', reason: 'no', summaryOnly: true }])
        expect(summaryOnly.own).toBeNull()
        expect(summaryOnly.message).toBe(language.importFilesNotImported(1, 1, 'f0: no'))
    })

    it('ignores the normal flag of a refusal in a summary', () => {
        const s = summariseImport(items(2), [{ kind: 'refused', reason: 'no', normal: true }, { kind: 'imported', index: null }])
        expect(s.message).toBe(language.importFilesNotImported(1, 2, 'f0: no'))
    })
})

describe('runImportBatch', () => {
    it('runs items one after another inside one busy scope per round', async () => {
        const order: string[] = []
        const make = (name: string) => item(name, async () => {
            order.push('start:' + name)
            await Promise.resolve()
            order.push('end:' + name)
            return { kind: 'imported', index: null }
        })
        const { card } = await runOnCard([make('a'), make('b'), make('c')])
        expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
        //Each round is one busy scope, ended with its result; the answer is awaited outside it.
        expect(h.busy).toEqual(['begin:import', 'end:import'])
        expect(card?.result?.headline).toBe(language.importTaskImported(3))
        expect(h.errors).toEqual([])
    })

    it('attempts every item after a failure and never rejects', async () => {
        const ran: string[] = []
        const { card, summary } = await runOnCard([
            item('a', async () => { ran.push('a'); throw new Error('boom') }),
            item('b', async () => { ran.push('b'); throw new ModuleRefusal('refused b') }),
            item('c', async () => { ran.push('c'); return { kind: 'imported', index: null } }),
        ])
        expect(ran).toEqual(['a', 'b', 'c'])
        expect(summary.imported).toBe(1)
        expect(card?.result?.skipped).toEqual([{ name: 'a', reason: 'boom' }, { name: 'b', reason: 'refused b' }])
        expect(h.busy).toEqual(['begin:import', 'end:import'])
    })

    it('shows a single file its own message on the card', async () => {
        const { card } = await runOnCard([item('a', done({ kind: 'refused', reason: 'own text' }))])
        expect(card?.failure?.headline).toBe(language.importTaskFailedOne('a'))
        expect(card?.failure?.detail).toBe('own text')
    })

    it('shows a result with no listed files when everything imported or was declined', async () => {
        const { card } = await runOnCard([item('a', done({ kind: 'imported', index: 0 })), item('b', done({ kind: 'declined' }))])
        expect(card?.result?.skipped).toBeUndefined()
        expect(card?.failure).toBeUndefined()
    })

    it('lists a declined file only when the batch names a reason', async () => {
        const { card } = await runOnCard([item('a', done({ kind: 'declined' })), item('b', done({ kind: 'imported', index: null }))], 'why')
        expect(card?.result?.skipped).toEqual([{ name: 'a', reason: 'why' }])
    })

    it('calls afterImported for imported outcomes only, and survives its throw', async () => {
        const seen: ImportOutcome[] = []
        const { card } = await runOnCard([
            item('a', done({ kind: 'imported', index: 1 })),
            item('b', done({ kind: 'refused', reason: 'no' })),
            item('c', done({ kind: 'imported', index: null })),
        ], undefined, (outcome) => {
            seen.push(outcome)
            throw new Error('after failed')
        })
        expect(seen).toEqual([{ kind: 'imported', index: 1 }, { kind: 'imported', index: null }])
        expect(card?.result?.skipped).toEqual([{ name: 'b', reason: 'no' }])
    })

    it('maps a thrown stop to declined or skipped without an error', async () => {
        const { summary, card } = await runOnCard([
            item('a', async () => { throw new ModuleImportStopped('skipped') }),
            item('b', async () => { throw new ModuleImportStopped('declined') }),
        ])
        expect(summary.skipped).toBe(1)
        expect(summary.declined).toBe(1)
        expect(card?.failure).toBeUndefined()
        expect(h.errors).toEqual([])
    })
})
