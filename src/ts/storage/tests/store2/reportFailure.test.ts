// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

// MOCKED: the alert modules `peerUi` imports; the wording under test shows no alert.
vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/alert'), () => ({
    alertSelect: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

import { changeLanguage, language } from 'src/lang'
import { Store2CommitRefusedError, Store2NotFlushedError } from 'src/ts/storage/store2/saveLoop'
import { StubRefusedError } from 'src/ts/storage/store2/codec'
import { describeSaveFailure, saveFailureClassOf } from 'src/ts/storage/store2/ui/peerUi'

/**
 * What a failing store2 save tells the person (`describeSaveFailure`, applied by `reportFailure` in `globalApi`): a
 * toast at the first failure, an alert once the attempts run out, and the technical text in the sub-message only.
 * Labels: new behaviour for the two store2 failures; guard for the storage-full and unmapped rows (their behaviour is
 * the one the loop already had, in the language's words).
 */

beforeEach(() => {
    changeLanguage('en')
})

describe('the storage-full row keeps its sentence and its long wait', () => {
    test.each([1, 3, 5])('attempt %i: the toast, no alert, five seconds', (attempts) => {
        expect(describeSaveFailure(new Error('quota'), attempts, true)).toEqual({
            toast: language.saveStorageFull,
            alert: null,
            showRaw: false,
            waitMs: 5000,
        })
    })

    test('the sentence says the browser storage is full and the latest edits could not be saved', () => {
        expect(language.saveStorageFull).toContain('Your browser storage is full')
        expect(language.saveStorageFull).toContain('Your latest edits could not be saved.')
    })
})

describe('a commit the storage could not confirm', () => {
    const error = new Store2NotFlushedError()

    test('the first failure is a toast in plain words, with no alert yet', () => {
        expect(describeSaveFailure(error, 1, false)).toEqual({
            toast: language.saveNotFlushed,
            alert: null,
            showRaw: false,
            waitMs: 1000,
        })
    })

    test.each([2, 3, 4])('attempt %i: nothing is shown', (attempts) => {
        expect(describeSaveFailure(error, attempts, false)).toEqual({ toast: null, alert: null, showRaw: false, waitMs: 1000 })
    })

    test('once the attempts run out the alert says it in plain words and the technical text is the sub-message', () => {
        const report = describeSaveFailure(error, 5, false)
        expect(report.alert).toEqual({ msg: language.saveNotFlushed, submsg: error.message })
        expect(report.alert?.msg).not.toContain(error.message)
        expect(report.showRaw).toBe(false)
    })
})

describe('a commit the store refused', () => {
    const error = new Store2CommitRefusedError('marker-present', 'a marker stands')

    test('the first failure is the retrying toast', () => {
        expect(describeSaveFailure(error, 1, false)).toEqual({
            toast: language.saveRetrying,
            alert: null,
            showRaw: false,
            waitMs: 1000,
        })
    })

    test('once the attempts run out the alert says the changes exist only in this tab, and the technical text is the sub-message', () => {
        const report = describeSaveFailure(error, 5, false)
        expect(report.alert).toEqual({ msg: language.saveEscalated, submsg: error.message })
        expect(report.alert?.msg).not.toContain('marker-present')
        expect(language.saveEscalated).toContain('They exist only in this tab')
    })
})

describe('a failure without a wording of its own', () => {
    test('the first failure is the retrying toast and the error is shown as it is only once the attempts run out', () => {
        const error = new Error('held by more than one character')
        expect(describeSaveFailure(error, 1, false)).toEqual({ toast: language.saveRetrying, alert: null, showRaw: false, waitMs: 1000 })
        expect(describeSaveFailure(error, 4, false)).toEqual({ toast: null, alert: null, showRaw: false, waitMs: 1000 })
        expect(describeSaveFailure(error, 5, false)).toEqual({ toast: null, alert: null, showRaw: true, waitMs: 1000 })
    })

    test('a value that is not an Error is reported as text', () => {
        const report = describeSaveFailure('plain text', 5, false)
        expect(report.showRaw).toBe(true)
        expect(report.alert).toBeNull()
    })
})

describe('an edited module stub', () => {
    const edited = new StubRefusedError('module', 'mod-1', null, { name: 'Edited module', reason: 'edited' })

    test.each([1, 2, 4, 5, 9])('attempt %i: no toast, no alert, no raw error, five seconds', (attempts) => {
        expect(describeSaveFailure(edited, attempts, false)).toEqual({ toast: null, alert: null, showRaw: false, waitMs: 5000 })
    })

    test('it is its own failure class', () => {
        expect(saveFailureClassOf(edited, false)).toBe('module-edited')
    })

    test('guard: an uncarriable module stub, a character stub and a plain error keep the generic wording and class', () => {
        const uncarriable = new StubRefusedError('module', 'mod-1', null, { name: 'Edited module', reason: 'uncarriable' })
        const character = new StubRefusedError('character', 'cha-1', null)
        for (const error of [uncarriable, character, new Error('other')]) {
            expect(describeSaveFailure(error, 1, false)).toEqual({ toast: language.saveRetrying, alert: null, showRaw: false, waitMs: 1000 })
            expect(describeSaveFailure(error, 5, false).showRaw).toBe(true)
            expect(saveFailureClassOf(error, false)).toBe('other')
        }
    })

    test('guard: a full storage still wins over the edited stub', () => {
        expect(saveFailureClassOf(edited, true)).toBe('storage-full')
        expect(describeSaveFailure(edited, 1, true).toast).toBe(language.saveStorageFull)
    })
})

describe('the words name the product RisuTanium', () => {
    test.each(['saveEscalated', 'saveNotFlushed'] as const)('%s', (key) => {
        expect(language[key]).toContain('RisuTanium')
        expect(language[key]).not.toContain('RisuAI')
    })
})
