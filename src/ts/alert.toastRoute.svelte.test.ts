/**
 * `alertToast` posts an `info` toast to the app's toast host and never touches the alert store.
 *
 * Drives the REAL `alert.ts` and the REAL `toastHost` singleton over a real `writable` standing in for `alertStore` from
 * `stores.svelte`. Time is fake: the host arms its timers through `setTimeout` at post time. Suspension and pause run
 * inside `$effect.root`, as the host's contract requires.
 *
 * Tests whose title starts with `guard:` pass with or without the same-text drop; every other test fails while the
 * behaviour it names is missing.
 */
import { get, writable } from 'svelte/store'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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

import { changeLanguage, language } from 'src/lang'
import { alertNormalWait, alertSelect, alertToast } from './alert'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from './alertPrompts'
import { alertStore } from './stores.svelte'
import { DEFAULT_TOAST_CONFIG, resetToastHostForTests, toastHost } from './toast/toastHost.svelte'
import { describeSaveFailure } from './storage/store2/ui/peerUi'

//#region helpers

const NONE: alertData = { type: 'none', msg: '' }
const RETRY_STEP_MS = 5050

function shown(): alertData {
    return get(alertStore) as alertData
}

function entries(text: string): number {
    return toastHost.visible.filter((toast) => toast.text === text).length
}

function toastCaughtErrors(): number {
    return (window.__risuTaniumErrors ?? []).filter((record) => record.site === 'toast.post').length
}

/** The body of `showSaveFailure` for a storage-full failure. */
function storageFullAttempt(attempts: number): void {
    const report = describeSaveFailure(new Error('quota'), attempts, true)
    if (report.toast) {
        alertToast(report.toast)
    }
}

/** Runs `body` inside an effect root so the host's suspension and pause have an owner; returns the stop function. */
function inRoot(body: () => void): () => void {
    return $effect.root(body)
}

const stops: Array<() => void> = []

beforeEach(() => {
    vi.useFakeTimers()
    changeLanguage('en')
    resetToastHostForTests()
    resetAlertPromptsForTests()
    alertStore.set(NONE)
})

afterEach(() => {
    while (stops.length > 0) {
        stops.pop()?.()
    }
    resetToastHostForTests()
    resetAlertPromptsForTests()
    alertStore.set(NONE)
    vi.useRealTimers()
})

//#endregion

describe('alertToast posts an info toast and leaves the alert store alone', () => {
    test('T-1 the store stays none, the host shows one info entry and says it once, politely', () => {
        alertToast('x')

        expect(shown()).toEqual(NONE)
        expect(toastHost.visible).toHaveLength(1)
        expect(toastHost.visible[0]).toMatchObject({ kind: 'info', text: 'x' })
        expect(toastHost.polite.text).toBe('x')
        expect(toastHost.polite.seq).toBe(1)
    })

    test('T-2 a notice stays up and unanswered under a toast; the toast shows and is said after the notice closes', async () => {
        let covered = $state(true)
        stops.push(inRoot(() => { toastHost.suspendWhile(() => covered) }))
        flushSync()

        let closed = false
        void alertNormalWait('n').then(() => { closed = true })
        const notice = shown()
        alertToast('x')
        await vi.advanceTimersByTimeAsync(50)

        expect(shown()).toBe(notice)
        expect(shown()).toMatchObject({ type: 'normal', msg: 'n' })
        expect(closed).toBe(false)
        expect(toastHost.suspended).toBe(true)
        expect(toastHost.polite.text).toBe('')

        alertStore.set({ type: 'none', msg: 'yes' })
        await vi.advanceTimersByTimeAsync(50)
        expect(closed).toBe(true)
        covered = false
        flushSync()

        expect(toastHost.suspended).toBe(false)
        expect(toastHost.polite.text).toBe('x')
        expect(entries('x')).toBe(1)
    })

    test('T-3 an open prompt stays the store value under a toast, and its answer still resolves it', async () => {
        const choice = alertSelect(['first', 'second'])
        const prompt = shown()
        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 20)

        alertToast('x')

        expect(shown()).toBe(prompt)
        alertStore.set({ type: 'none', msg: '1' })
        expect(await choice).toBe('1')
        expect(entries('x')).toBe(1)
    })

    test('T-4 a blank text writes nothing to the store, posts nothing and is recorded as a caught error', () => {
        const before = toastCaughtErrors()

        alertToast('')

        expect(shown()).toEqual(NONE)
        expect(toastHost.visible).toHaveLength(0)
        expect(toastCaughtErrors()).toBe(before + 1)
    })

    test('T-5 an info toast from alertToast ends after infoMs, and a hover hold keeps it', () => {
        alertToast('x')
        expect(toastHost.visible).toHaveLength(1)

        toastHost.setHold('hover', true)
        vi.advanceTimersByTime(DEFAULT_TOAST_CONFIG.infoMs + 1000)
        expect(toastHost.visible).toHaveLength(1)

        toastHost.setHold('hover', false)
        vi.advanceTimersByTime(DEFAULT_TOAST_CONFIG.infoMs + 1)
        expect(toastHost.visible).toHaveLength(0)
    })
})

describe('a repeated text is shown and said once', () => {
    test('T-9 the same text twice within infoMs is one entry and one announcement', () => {
        alertToast('x')
        const seq = toastHost.polite.seq
        vi.advanceTimersByTime(1000)

        alertToast('x')

        expect(entries('x')).toBe(1)
        expect(toastHost.polite.seq).toBe(seq)
    })

    test('T-9b after the entry ends the same text shows and is said again', () => {
        alertToast('x')
        const seq = toastHost.polite.seq
        vi.advanceTimersByTime(DEFAULT_TOAST_CONFIG.infoMs + 1)
        expect(toastHost.visible).toHaveLength(0)

        alertToast('x')

        expect(entries('x')).toBe(1)
        expect(toastHost.polite.seq).toBe(seq + 1)
    })

    test('T-12 two different texts are two entries', () => {
        alertToast('a')
        alertToast('b')

        expect(toastHost.visible.map((toast) => toast.text)).toEqual(['a', 'b'])
    })

    test('T-10 a 5 s storage-full retry shows at most one copy and says it at attempts 1, 13 and 25', () => {
        const spoken: number[] = []
        let lastSeq = toastHost.polite.seq
        for (let attempt = 1; attempt <= 25; attempt++) {
            storageFullAttempt(attempt)
            expect(entries(language.saveStorageFull)).toBeLessThanOrEqual(1)
            if (toastHost.polite.seq !== lastSeq) {
                spoken.push(attempt)
                lastSeq = toastHost.polite.seq
            }
            vi.advanceTimersByTime(RETRY_STEP_MS)
        }

        expect(spoken).toEqual([1, 13, 25])
    })

    test('T-10b while a modal shell pauses the timers the retry keeps one entry', () => {
        stops.push(inRoot(() => { toastHost.pauseWhile(() => true) }))
        flushSync()

        for (let attempt = 1; attempt <= 25; attempt++) {
            storageFullAttempt(attempt)
            expect(entries(language.saveStorageFull)).toBe(1)
            vi.advanceTimersByTime(RETRY_STEP_MS)
        }

        expect(toastHost.paused).toBe(true)
        expect(entries(language.saveStorageFull)).toBe(1)
    })

    test('T-11 repeats under a covering alert are said once at release, not joined', () => {
        let covered = $state(true)
        stops.push(inRoot(() => { toastHost.suspendWhile(() => covered) }))
        flushSync()

        for (let attempt = 1; attempt <= 13; attempt++) {
            storageFullAttempt(attempt)
            vi.advanceTimersByTime(RETRY_STEP_MS)
        }
        for (let repeat = 0; repeat < 12; repeat++) {
            alertToast(language.saveStorageFull)
        }
        covered = false
        flushSync()

        expect(entries(language.saveStorageFull)).toBe(1)
        expect(toastHost.polite.text).toBe(language.saveStorageFull)
    })

    test('T-13 guard: the read of the toast list does not subscribe the calling effect', () => {
        let runs = 0
        stops.push(inRoot(() => {
            $effect(() => {
                runs += 1
                alertToast('x')
            })
        }))
        flushSync()
        expect(runs).toBe(1)

        vi.advanceTimersByTime(DEFAULT_TOAST_CONFIG.infoMs + 1)
        flushSync()
        alertToast('other')
        flushSync()

        expect(runs).toBe(1)
    })
})
