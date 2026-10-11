import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
    errors: [] as unknown[],
    busy: [] as string[],
}))

vi.mock('./alert', () => ({
    alertError: (e: unknown) => { h.errors.push(e) },
}))

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
import { outcomeOfError, outcomeReason, runImportBatch, summariseImport, type ImportItem, type ImportOutcome } from './importBatch'

const item = (name: string, run: () => Promise<ImportOutcome>): ImportItem => ({ name, run })
const done = (outcome: ImportOutcome) => () => Promise.resolve(outcome)

class StopLike extends Error {
    reason: string
    constructor(reason: string) {
        super('stop')
        this.name = 'ModuleImportStopped'
        this.reason = reason
    }
}

beforeEach(() => {
    h.errors = []
    h.busy = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('outcomeOfError', () => {
    it('maps a module refusal to a refusal with its text', () => {
        expect(outcomeOfError(new ModuleRefusal('bad module'))).toEqual({ kind: 'refused', reason: 'bad module' })
    })
    it('maps a stop by reason', () => {
        expect(outcomeOfError(new StopLike('declined'))).toEqual({ kind: 'declined' })
        expect(outcomeOfError(new StopLike('skipped'))).toEqual({ kind: 'skipped' })
    })
    it('treats a stop with an unknown reason, any other error and a string as failures', () => {
        expect(outcomeOfError(new StopLike('other')).kind).toBe('failed')
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
    it('runs items one after another inside one busy scope', async () => {
        const order: string[] = []
        const make = (name: string) => item(name, async () => {
            order.push('start:' + name)
            await Promise.resolve()
            order.push('end:' + name)
            return { kind: 'imported', index: null }
        })
        await runImportBatch([make('a'), make('b'), make('c')])
        expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
        expect(h.busy).toEqual(['begin:import', 'end:import'])
        expect(h.errors).toEqual([])
    })

    it('attempts every item after a failure and never rejects', async () => {
        const ran: string[] = []
        const summary = await runImportBatch([
            item('a', async () => { ran.push('a'); throw new Error('boom') }),
            item('b', async () => { ran.push('b'); throw new ModuleRefusal('refused b') }),
            item('c', async () => { ran.push('c'); return { kind: 'imported', index: null } }),
        ])
        expect(ran).toEqual(['a', 'b', 'c'])
        expect(summary.imported).toBe(1)
        expect(h.errors).toEqual([language.importFilesNotImported(2, 3, 'a: boom\nb: refused b')])
        expect(h.busy).toEqual(['begin:import', 'end:import'])
    })

    it('shows a single file its own message', async () => {
        await runImportBatch([item('a', done({ kind: 'refused', reason: 'own text' }))])
        expect(h.errors).toEqual(['own text'])
    })

    it('shows nothing when everything imported or was declined', async () => {
        await runImportBatch([item('a', done({ kind: 'imported', index: 0 })), item('b', done({ kind: 'declined' }))])
        expect(h.errors).toEqual([])
    })

    it('lists a declined file only when the batch names a reason', async () => {
        await runImportBatch([item('a', done({ kind: 'declined' })), item('b', done({ kind: 'imported', index: null }))], { declinedReason: 'why' })
        expect(h.errors).toEqual([language.importFilesNotImported(1, 2, 'a: why')])
    })

    it('calls afterImported for imported outcomes only, and survives its throw', async () => {
        const seen: ImportOutcome[] = []
        await runImportBatch([
            item('a', done({ kind: 'imported', index: 1 })),
            item('b', done({ kind: 'refused', reason: 'no' })),
            item('c', done({ kind: 'imported', index: null })),
        ], {
            afterImported: (outcome) => {
                seen.push(outcome)
                throw new Error('after failed')
            },
        })
        expect(seen).toEqual([{ kind: 'imported', index: 1 }, { kind: 'imported', index: null }])
        expect(h.errors).toEqual([language.importFilesNotImported(1, 3, 'b: no')])
    })

    it('maps a thrown stop to declined or skipped without an error', async () => {
        const summary = await runImportBatch([
            item('a', async () => { throw new StopLike('skipped') }),
            item('b', async () => { throw new StopLike('declined') }),
        ])
        expect(summary.skipped).toBe(1)
        expect(summary.declined).toBe(1)
        expect(h.errors).toEqual([])
    })
})
