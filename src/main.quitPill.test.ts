// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { languageKorean } from './lang/ko'

/**
 * `src/main.ts` mounts the Back-quit pill and wires it to the quit guard. The test imports the real entry module
 * with real Svelte and the real Back guard, presses Back through the host hook and reads only the DOM, so it can run
 * against a base without the pill. The warning text is the mocked locale string; the generic toast is a spy.
 * Time is `Date.now` and the pill's timers under fake timers started before the entry module loads.
 */

const QUIT_WINDOW = 2000
const WARNING = 'press back again'
const KO_QUIT_COPY = '종료하려면 뒤로 가기를 한번 더 누르세요'

const seen = vi.hoisted(() => ({
    alertToast: vi.fn(),
    closeDialog: vi.fn(),
    covered: false,
    flushPage: vi.fn(),
}))

vi.mock('./ts/polyfill', () => ({}))
vi.mock('core-js/actual', () => ({}))
vi.mock('./ts/storage/database.svelte', () => ({}))
vi.mock('./ts/globalApi.svelte', () => ({ holdsOwnTabPresence: () => true }))
vi.mock('./App.svelte', () => ({ default: () => {} }))
vi.mock('./ts/bootstrap', () => ({ loadData: vi.fn() }))
vi.mock('./ts/hotkey', () => ({ initHotkey: vi.fn() }))
vi.mock('./preload', () => ({ preLoadCheck: vi.fn() }))
vi.mock('./ts/android/keepAliveService', () => ({ startKeepAliveService: vi.fn() }))
vi.mock('./ts/process/saveOnHide', () => ({ startSaveOnHide: vi.fn(), flushPageBeforeLeaving: seen.flushPage }))
vi.mock('./ts/alertPrompts', () => ({ pageCovered: () => seen.covered }))
vi.mock('./ts/alertBack', () => ({ closeDialogForBack: seen.closeDialog }))
vi.mock('./ts/alert', () => ({ alertToast: seen.alertToast }))
vi.mock('./lang', () => ({ language: { alerts: { pressBackAgainToQuit: WARNING }, uiCommon: { close: 'close' } } }))
vi.mock('./ts/storage/store2/bootDispatch', () => ({ dispatchStore2Boot: vi.fn() }))
vi.mock('./ts/drive/backuplocal', () => ({ loadBackupAtBoot: vi.fn() }))
vi.mock('./ts/storage/store2/ui/productionBootUi', () => ({ createProductionBootUi: () => ({}) }))

// Svelte is reloaded with the entry module after every module reset; the flush must come from that same instance.
let flushSync: () => void = () => {}

function pressBack(): boolean {
    const hook = window.__risuTaniumBack
    if (hook === undefined) {
        throw new Error('the Back hook is not installed')
    }
    const answer = hook()
    flushSync()
    return answer
}

function advance(ms: number): void {
    vi.advanceTimersByTime(ms)
    flushSync()
}

const findPill = (): Element | null => document.querySelector('[data-part="quit-pill"]')
const findRegion = (): Element | null => document.querySelector('[data-part="quit-pill-region"]')

function setVisibility(state: 'hidden' | 'visible'): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
}

async function loadEntry(): Promise<void> {
    flushSync = (await import('svelte')).flushSync
    await import('./main')
    flushSync()
}

beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    vi.resetModules()
    seen.alertToast.mockClear()
    seen.closeDialog.mockClear()
    seen.covered = false
    document.body.innerHTML = '<div id="app"></div><div id="preloading"></div>'
    const guard = await import('./ts/backHandlers')
    guard.resetBackHandlersForTests()
    await loadEntry()
}, 30_000)

afterEach(async () => {
    const guard = await import('./ts/backHandlers')
    guard.resetBackHandlersForTests()
    delete (document as unknown as Record<string, unknown>).visibilityState
    vi.useRealTimers()
})

describe('the Back-quit pill', () => {
    test('B-R1 the first Back shows the pill in a polite status region with the locale text and an inert icon', () => {
        expect(pressBack()).toBe(true)
        const pill = findPill()
        expect(pill, 'the quit pill is mounted after the first Back').not.toBeNull()
        const region = pill?.closest('[aria-live="polite"]')
        expect(region?.getAttribute('aria-live')).toBe('polite')
        expect(pill?.textContent?.trim()).toBe(WARNING)
        const icon = pill?.querySelector('svg')
        expect(icon).not.toBeNull()
        expect(icon?.getAttribute('aria-hidden')).toBe('true')
    })

    test('B-R2 the pill is plain until 1800 ms, leaving until 2000 ms and gone at 2000 ms', () => {
        pressBack()
        advance(QUIT_WINDOW - 201)
        expect(findPill(), 'present at 1799 ms').not.toBeNull()
        expect(findPill()?.hasAttribute('data-leaving')).toBe(false)
        advance(1)
        expect(findPill()?.hasAttribute('data-leaving'), 'leaving at 1800 ms').toBe(true)
        advance(QUIT_WINDOW - 1 - 1800)
        expect(findPill(), 'present at 1999 ms').not.toBeNull()
        advance(1)
        expect(findPill(), 'gone at 2000 ms').toBeNull()
    })

    test('B-R4 the warning does not go through the generic toast', () => {
        pressBack()
        expect(seen.alertToast).not.toHaveBeenCalled()
        expect(findPill()).not.toBeNull()
    })

    test('B-R5 the region persists and every warning is a new node', () => {
        const region = findRegion()
        expect(region, 'the live region is mounted before any warning').not.toBeNull()
        pressBack()
        const first = findPill()
        expect(first).not.toBeNull()
        advance(QUIT_WINDOW)
        expect(findPill()).toBeNull()
        expect(pressBack()).toBe(true)
        const second = findPill()
        expect(second).not.toBeNull()
        expect(second).not.toBe(first)
        expect(findRegion()).toBe(region)
    })

    test('B-R5b a warning while the pill is still showing replaces it with a new node and restarts the window', () => {
        pressBack()
        const first = findPill()
        advance(1000)
        // A clock moved back past the arm makes the next press warn again while the first pill is still up.
        vi.setSystemTime(Date.now() - 1500)
        expect(pressBack()).toBe(true)
        const second = findPill()
        expect(second).not.toBeNull()
        expect(second, 'a re-warning renders a fresh node').not.toBe(first)
        // The first warning's timers are cancelled: its leave and hide times fall inside this span.
        advance(1000)
        expect(findPill(), 'the first warning timers no longer hide the pill').not.toBeNull()
        expect(findPill()?.hasAttribute('data-leaving'), 'the first warning timers no longer start the fade').toBe(false)
        advance(QUIT_WINDOW - 1 - 1000)
        expect(findPill(), 'the window restarted at the second warning').not.toBeNull()
        advance(1)
        expect(findPill()).toBeNull()
    })

    test('B-R7 a handled press hides the pill at once', async () => {
        const guard = await import('./ts/backHandlers')
        pressBack()
        expect(findPill()).not.toBeNull()
        guard.registerBackHandler(() => true)
        advance(500)
        expect(pressBack()).toBe(true)
        expect(findPill(), 'the pill is gone after a handled press').toBeNull()
        // 1900 ms after the warning: the cancelled fade time has passed, the cancelled hide time has not.
        advance(1400)
        expect(findPill(), 'no leftover fade timer brings the pill back').toBeNull()
        advance(QUIT_WINDOW)
        expect(findPill(), 'no leftover timer brings the pill back').toBeNull()
    })

    test('B-R8 the page going hidden hides the pill at once', () => {
        pressBack()
        expect(findPill()).not.toBeNull()
        setVisibility('hidden')
        flushSync()
        expect(findPill(), 'the pill is gone when the page is hidden').toBeNull()
        // 1900 ms after the warning: the cancelled fade time has passed, the cancelled hide time has not.
        advance(1900)
        expect(findPill(), 'no leftover fade timer brings the pill back').toBeNull()
        advance(QUIT_WINDOW)
        expect(findPill(), 'no leftover timer brings the pill back').toBeNull()
    })

    test('B-R10 the pill takes no focus and the region announces the whole pill', () => {
        const focusable = 'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]'
        const before = document.activeElement
        pressBack()
        const region = findRegion()
        expect(findPill()).not.toBeNull()
        expect(region?.getAttribute('aria-atomic')).toBe('true')
        expect(region?.hasAttribute('tabindex')).toBe(false)
        expect(region?.querySelectorAll(focusable).length, 'nothing inside the region is focusable').toBe(0)
        expect(document.activeElement, 'showing the pill moves no focus').toBe(before)
    })

    test('RB1 when the pill goes the region stays, empty and with no role, so no role name is spoken alone', () => {
        const region = findRegion()
        expect(region).not.toBeNull()
        pressBack()
        advance(QUIT_WINDOW)
        expect(findPill()).toBeNull()
        expect(findRegion(), 'the region persists').toBe(region)
        expect(region?.textContent?.trim()).toBe('')
        expect(region?.getAttribute('role'), 'a named role is read alone when the region empties').toBeNull()
        expect(region?.getAttribute('aria-live')).toBe('polite')
        expect(region?.getAttribute('aria-atomic')).toBe('true')
    })

    test('RB2 (guard) over one warning cycle the region text is the pill text then empty, and leaving changes only data-leaving', () => {
        const region = findRegion()
        expect(region).not.toBeNull()
        // Only content changes are observed: an attribute change such as data-leaving is not one.
        const observer = new MutationObserver(() => {})
        observer.observe(region as Element, { childList: true, subtree: true, characterData: true })
        const steps: Array<{ text: string | undefined, contentChanges: number }> = []
        const sample = (): void => {
            steps.push({ text: region?.textContent?.trim(), contentChanges: observer.takeRecords().length })
        }
        pressBack()
        sample()
        advance(QUIT_WINDOW - 201)
        sample()
        advance(1)
        sample()
        expect(findPill()?.hasAttribute('data-leaving')).toBe(true)
        advance(QUIT_WINDOW - 1800)
        sample()
        observer.disconnect()

        expect(findPill()).toBeNull()
        expect(steps.map((step) => step.text)).toEqual([WARNING, WARNING, WARNING, ''])
        expect(steps[0].contentChanges, 'showing the pill changes the content').toBeGreaterThan(0)
        expect(steps[1].contentChanges, 'holding changes nothing').toBe(0)
        expect(steps[2].contentChanges, 'the leaving step changes no content').toBe(0)
        expect(steps[3].contentChanges, 'removal changes the content').toBeGreaterThan(0)
    })

    test('B-R6 the Korean copy is the DD-008 wording', () => {
        expect(languageKorean.alerts.pressBackAgainToQuit).toBe(KO_QUIT_COPY)
    })
})

describe('compatibility guards', () => {
    test('B-G1 a second Back inside the window quits', () => {
        expect(pressBack()).toBe(true)
        advance(QUIT_WINDOW - 1)
        expect(pressBack()).toBe(false)
    })

    test('B-G2 a handled press shows no pill and no generic toast', async () => {
        const guard = await import('./ts/backHandlers')
        guard.registerBackHandler(() => true)
        expect(pressBack()).toBe(true)
        expect(findPill()).toBeNull()
        expect(seen.alertToast).not.toHaveBeenCalled()
    })

    test('B-G3 a covered page closes the dialog and shows no pill', () => {
        seen.covered = true
        expect(pressBack()).toBe(true)
        expect(seen.closeDialog).toHaveBeenCalledTimes(1)
        expect(findPill()).toBeNull()
    })
})
