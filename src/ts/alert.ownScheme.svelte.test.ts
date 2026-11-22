/**
 * The `ownScheme: 'saveGuard'` option of `alertConfirm`, `alertSelect` and `alertError` reaches the value
 * `alertStore` holds, and is absent when the caller does not pass it. The restore no-lock helper raises its
 * confirmation with the flag.
 *
 * Drives the REAL `alert.ts` against a real `writable` standing in for `alertStore`. Every test is a
 * compatibility guard: the flag is new, so nothing here fails for a defect that existed before it.
 */
import { get, writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { alertData } from './alert'

//#region module mocks

vi.mock(import('./stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('./stores.svelte'))

vi.mock(import('./storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('./storage/database.svelte'))

vi.mock(import('./platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('./platform'))

//#endregion

import { alertConfirm, alertError, alertSelect } from './alert'
import { alertStore } from './stores.svelte'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from './alertPrompts'
import { confirmRestoreWithoutTabCheck } from './drive/restoreNoLockWarning'

/** The prompt on screen, then the answer that ends it so the pending call settles. */
async function shownThenAnswered<T>(pending: Promise<T>): Promise<alertData> {
    const shown = get(alertStore)
    await new Promise<void>((resolve) => setTimeout(resolve, ANSWER_GUARD_MS + 20))
    alertStore.set({ type: 'none', msg: 'yes' })
    await pending
    return shown
}

afterEach(() => {
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
    vi.restoreAllMocks()
})

describe('ownScheme plumbing', () => {
    test('alertConfirm puts the flag on the alert only when asked', async () => {
        const flagged = await shownThenAnswered(alertConfirm('keep?', { ownScheme: 'saveGuard' }))
        expect(flagged.type).toBe('ask')
        expect(flagged.ownScheme).toBe('saveGuard')
        resetAlertPromptsForTests()
        const plain = await shownThenAnswered(alertConfirm('keep?'))
        expect(plain.type).toBe('ask')
        expect('ownScheme' in plain).toBe(false)
    })

    test('alertSelect puts the flag on the alert only when asked', async () => {
        const flagged = await shownThenAnswered(alertSelect(['a', 'b'], 'title', { cancel: '1', ownScheme: 'saveGuard' }))
        expect(flagged.type).toBe('select')
        expect(flagged.ownScheme).toBe('saveGuard')
        expect(flagged.cancelAnswer).toBe('1')
        resetAlertPromptsForTests()
        const plain = await shownThenAnswered(alertSelect(['a', 'b'], 'title', { cancel: '1' }))
        expect('ownScheme' in plain).toBe(false)
    })

    test('alertError puts the flag on the alert only when asked', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        alertError('save failed', { ownScheme: 'saveGuard' })
        expect(get(alertStore).type).toBe('error')
        expect(get(alertStore).ownScheme).toBe('saveGuard')
        alertError('save failed')
        expect('ownScheme' in get(alertStore)).toBe(false)
    })

    test('the restore no-lock helper asks the no-lock text with the flag', async () => {
        const shown = await shownThenAnswered(confirmRestoreWithoutTabCheck())
        expect(shown.type).toBe('ask')
        expect(shown.msg).toBe(language.restoreNoLockWarningConfirm)
        expect(shown.ownScheme).toBe('saveGuard')
    })
})
