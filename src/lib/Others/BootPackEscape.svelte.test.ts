// @vitest-environment jsdom
/**
 * `BootPackEscape.svelte` over the real safe-mode module (TA-11, the component half): absent without a pack and present with
 * one, hides 5 s after `loadedStore` (fake timers), paused while it holds focus or the pointer, one offer per load, the notice
 * instead of the offer when the flag is on, the flag turning on after the offer switches to the notice, a read-only page hides the
 * action, and the tap runs the turn-off and then shows neither offer nor notice. FAKED: the database reader, the page mode, the
 * busy answers and the turn-off leaf (TA-15 runs the real one on the save loop).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    readOnly: false,
    turnOff: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({ downloadFile: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: h.db },
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/gui/systemBars'), () => ({ syncSystemBars: vi.fn() }) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/pageStorageMode'), () => ({
    getPageStorageMode: vi.fn(() => (h.readOnly ? { kind: 'read-only', reason: 'too-new', source: 'main' } : { kind: 'store2' })),
}) as unknown as typeof import('src/ts/storage/pageStorageMode'))
vi.mock(import('src/ts/process/memory/busyActions'), () => ({ isBusy: vi.fn(() => false) }) as unknown as typeof import('src/ts/process/memory/busyActions'))
vi.mock(import('src/ts/drive/restoreInProgress'), () => ({ restoreInProgress: vi.fn(() => false) }) as unknown as typeof import('src/ts/drive/restoreInProgress'))
vi.mock('src/ts/themePack/turnOff', () => ({ turnOffThemePack: h.turnOff, registerPackRequestCanceller: vi.fn() }))

import { language } from 'src/lang'
import { loadedStore } from 'src/ts/stores.svelte'
import { PACK_SCHEME_NAME } from 'src/ts/gui/colorscheme'
import { enterPackSafeMode, offerBootEscape, resetPackSafeModeForTests } from 'src/ts/themePack/packSafeMode.svelte'
import BootPackEscape from './BootPackEscape.svelte'

const USER = { bgcolor: '#101820', darkbg: '#0a1016', borderc: '#445566', selected: '#223344', draculared: '#ff5555', textcolor: '#e0e8f0', textcolor2: '#a0a8b0', darkBorderc: '#334455', darkbutton: '#203040', type: 'dark' }

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function mountBanner(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ target, app: mount(BootPackEscape, { target }) as unknown as Record<string, unknown> })
    return target
}

function root(target: HTMLElement): HTMLElement | null {
    return target.querySelector<HTMLElement>('[data-part="boot-pack-escape"]')
}

function action(target: HTMLElement, name: 'turn-off' | 'dismiss'): HTMLButtonElement | null {
    const label = name === 'turn-off' ? language.packEscapeTurnOff : language.packEscapeDismiss
    return [...target.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === label) ?? null
}

function setPack(active: boolean): void {
    for (const key of Object.keys(h.db)) delete h.db[key]
    Object.assign(h.db, { colorScheme: structuredClone(USER), colorSchemeName: 'custom', customColorScheme: structuredClone(USER) })
    if (active) h.db.activeThemePack = 'builtin:banana-cocoa'
}

beforeEach(() => {
    vi.useFakeTimers()
    setPack(true)
    h.readOnly = false
    h.turnOff.mockReset()
    resetPackSafeModeForTests()
    loadedStore.set(false)
})

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    resetPackSafeModeForTests()
    vi.useRealTimers()
})

describe('TA-11: the offer', () => {
    test('is absent without a pack and present with one', () => {
        setPack(false)
        offerBootEscape(h.db)
        const target = mountBanner()
        flushSync()
        expect(root(target)).toBeNull()
        resetPackSafeModeForTests()
        setPack(true)
        offerBootEscape(h.db)
        flushSync()
        expect(root(target)).not.toBeNull()
        expect(root(target)!.getAttribute('aria-label')).toBe(language.packEscapeLabel)
        expect(action(target, 'turn-off')!.textContent).toBe(language.packEscapeTurnOff)
        expect(action(target, 'dismiss')!.textContent).toBe(language.packEscapeDismiss)
    })

    test('takes no initial focus', () => {
        offerBootEscape(h.db)
        const target = mountBanner()
        flushSync()
        expect(root(target)!.contains(document.activeElement)).toBe(false)
    })

    test('stays while the app is booting and hides 5 s after loadedStore', () => {
        offerBootEscape(h.db)
        const target = mountBanner()
        flushSync()
        vi.advanceTimersByTime(60_000)
        flushSync()
        expect(root(target)).not.toBeNull()
        loadedStore.set(true)
        flushSync()
        vi.advanceTimersByTime(4_900)
        flushSync()
        expect(root(target)).not.toBeNull()
        vi.advanceTimersByTime(200)
        flushSync()
        expect(root(target)).toBeNull()
    })

    test('is paused while it holds focus, and the 5 s run again once it lets go', () => {
        offerBootEscape(h.db)
        const target = mountBanner()
        loadedStore.set(true)
        flushSync()
        action(target, 'dismiss')!.focus()
        root(target)!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
        flushSync()
        vi.advanceTimersByTime(30_000)
        flushSync()
        expect(root(target)).not.toBeNull()
        root(target)!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
        flushSync()
        vi.advanceTimersByTime(4_900)
        flushSync()
        expect(root(target)).not.toBeNull()
        vi.advanceTimersByTime(200)
        flushSync()
        expect(root(target)).toBeNull()
    })

    test('is paused while the pointer is over it', () => {
        offerBootEscape(h.db)
        const target = mountBanner()
        loadedStore.set(true)
        flushSync()
        root(target)!.dispatchEvent(new Event('pointerenter'))
        flushSync()
        vi.advanceTimersByTime(30_000)
        flushSync()
        expect(root(target)).not.toBeNull()
        root(target)!.dispatchEvent(new Event('pointerleave'))
        flushSync()
        vi.advanceTimersByTime(5_100)
        flushSync()
        expect(root(target)).toBeNull()
    })

    test('Dismiss hides it and it is not offered again in this load', () => {
        offerBootEscape(h.db)
        const target = mountBanner()
        flushSync()
        action(target, 'dismiss')!.click()
        flushSync()
        expect(root(target)).toBeNull()
        offerBootEscape(h.db)
        flushSync()
        expect(root(target)).toBeNull()
    })
})

describe('TA-11: the notice', () => {
    test('with the flag already on, the notice shows instead of the offer, has no timer and offers the turn-off', () => {
        enterPackSafeMode('url')
        offerBootEscape(h.db)
        const target = mountBanner()
        loadedStore.set(true)
        flushSync()
        expect(root(target)!.textContent).toContain(language.packSafeModeNotice)
        expect(action(target, 'turn-off')).not.toBeNull()
        vi.advanceTimersByTime(600_000)
        flushSync()
        expect(root(target)).not.toBeNull()
    })

    test('the flag turning on after the offer switches the banner to the notice', () => {
        offerBootEscape(h.db)
        const target = mountBanner()
        flushSync()
        expect(root(target)!.textContent).not.toContain(language.packSafeModeNotice)
        enterPackSafeMode('shortcut')
        flushSync()
        expect(root(target)!.textContent).toContain(language.packSafeModeNotice)
    })

    test('a read-only page shows the notice with Dismiss only', () => {
        h.readOnly = true
        enterPackSafeMode('url')
        offerBootEscape(h.db)
        const target = mountBanner()
        flushSync()
        expect(root(target)!.textContent).toContain(language.packSafeModeNotice)
        expect(action(target, 'turn-off')).toBeNull()
        expect(action(target, 'dismiss')).not.toBeNull()
    })

    test('a tap on a read-only page turns the offer into the notice without the action and never calls the turn-off', () => {
        h.readOnly = true
        offerBootEscape(h.db)
        const target = mountBanner()
        flushSync()
        action(target, 'turn-off')!.click()
        flushSync()
        expect(root(target)!.textContent).toContain(language.packSafeModeNotice)
        expect(action(target, 'turn-off')).toBeNull()
        expect(h.turnOff).not.toHaveBeenCalled()
    })
})

describe('TA-11: the tap', () => {
    test('a successful turn-off removes the banner: neither offer nor notice', () => {
        offerBootEscape(h.db)
        const target = mountBanner()
        flushSync()
        action(target, 'turn-off')!.click()
        flushSync()
        expect(h.turnOff).toHaveBeenCalledTimes(1)
        expect(root(target)).toBeNull()
    })
})

describe('the banner paints from the scheme turning the pack off restores', () => {
    test('under the pack scheme name with an unreadable copy the inline colours are the user scheme, opaque', () => {
        h.db.colorScheme = { ...USER, bgcolor: '#ff00ff', textcolor: '#ff00ff' }
        h.db.colorSchemeName = PACK_SCHEME_NAME
        h.db.themePackSchemeSnapshot = { name: 'custom', scheme: structuredClone(USER) }
        offerBootEscape(h.db)
        const target = mountBanner()
        flushSync()
        const style = root(target)!.style
        expect(style.backgroundColor).toBe('rgb(16, 24, 32)')
        expect(style.color).toBe('rgb(224, 232, 240)')
    })
})
