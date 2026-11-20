// @vitest-environment jsdom

/**
 * The card-detail popup is a modal dialog: it has a role and a name, focus starts on its named close
 * button, a click inside never closes it while a backdrop click, Escape and Back do, the description
 * wraps instead of scrolling sideways, Report and Block live inside the More disclosure, and the
 * import button keeps its download call. MOCKED: `src/ts/characterCards` (hub URL and download),
 * `src/ts/alert` and `src/ts/stores.svelte` (a plain database). Synthetic data only; nothing
 * contacts a host.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { hubType } from 'src/ts/characterCards'

const downloadRisuHubSpy = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    downloadRisuHub: downloadRisuHubSpy,
    getRealmInfo: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { hideAllImages: false, blockedRealmCreators: [] } as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        alertStore: writable({ type: 'none', msg: '' }),
        settingsOpen: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { alertStore } from 'src/ts/stores.svelte'
import { tabbables } from 'src/lib/Nexus/pattern/patternFocus'
import RealmPopUp from './RealmPopUp.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
const showToast = vi.fn()

function makeChara(): hubType {
    return {
        name: 'Layout card',
        desc: 'A long description',
        download: '12',
        id: 'layout-card',
        img: 'cover.png',
        tags: ['tag-one'],
        viewScreen: 'none',
        hasLore: true,
        hasEmotion: false,
        hasAsset: false,
        hot: 0,
        license: 'CC BY 4.0',
        type: 'character',
        creator: 'creator-1',
    }
}

function mountPopUp() {
    const main = document.createElement('main')
    document.body.appendChild(main)
    const target = document.createElement('div')
    main.appendChild(target)
    const props = $state({ openedData: makeChara() as hubType | null })
    mounted.push(mount(RealmPopUp, { target, props }))
    flushSync()
    return { target, props }
}

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

beforeEach(() => {
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    showToast.mockReset()
    downloadRisuHubSpy.mockReset()
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

describe('RealmPopUp.svelte: dialog semantics', () => {
    test('the panel is a modal dialog named by the card title', () => {
        const { target } = mountPopUp()
        const dialog = target.querySelector('[role="dialog"]')!
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        const heading = document.getElementById(dialog.getAttribute('aria-labelledby')!)
        expect(heading?.textContent?.trim()).toBe('Layout card')
    })

    test('the close button is named, focused on open, and closes', () => {
        const { target, props } = mountPopUp()
        const close = target.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement
        expect(close).toBeTruthy()
        expect(document.activeElement).toBe(close)
        close.click()
        flushSync()
        expect(props.openedData).toBeNull()
    })

    test('a click inside the panel does not close; a backdrop click does', () => {
        const { target, props } = mountPopUp()
        ;(target.querySelector('[role="dialog"]') as HTMLElement).click()
        flushSync()
        expect(props.openedData).not.toBeNull()
        ;(target.querySelector('h1') as HTMLElement).click()
        flushSync()
        expect(props.openedData).not.toBeNull()
        ;(target.querySelector('[role="dialog"]')!.parentElement as HTMLElement).click()
        flushSync()
        expect(props.openedData).toBeNull()
    })

    test('Escape closes the popup', () => {
        const { props } = mountPopUp()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        expect(props.openedData).toBeNull()
    })

    test('Escape leaves the popup open while a Report or Block confirm covers the page', () => {
        const { props } = mountPopUp()
        alertStore.set({ type: 'ask', msg: 'confirm' })
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        expect(props.openedData).not.toBeNull()
        alertStore.set({ type: 'none', msg: '' })
    })

    test('the More actions leave the Tab order while the disclosure is closed and rejoin it when open', () => {
        const { target } = mountPopUp()
        const dialog = target.querySelector('[role="dialog"]') as HTMLElement
        const details = target.querySelector('details') as HTMLDetailsElement
        const report = Array.from(details.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.realmReport)!
        expect(tabbables(dialog)).not.toContain(report)
        details.open = true
        details.dispatchEvent(new Event('toggle'))
        flushSync()
        expect(tabbables(dialog)).toContain(report)
    })

    test('hardware Back closes the popup before anything else answers', () => {
        const { props } = mountPopUp()
        expect(pressBack()).toBe(true)
        expect(props.openedData).toBeNull()
        expect(showToast).not.toHaveBeenCalled()
    })
})

describe('RealmPopUp.svelte: layout and content', () => {
    test('no remote Creative Commons image is loaded', () => {
        const { target } = mountPopUp()
        expect(target.querySelector('img[src*="creativecommons"]')).toBeNull()
        expect(target.textContent).toContain('CC BY 4.0')
    })

    test('the description container wraps anywhere and may shrink', () => {
        const { target } = mountPopUp()
        const description = target.querySelector('[data-testid="realm-popup-description"]') as HTMLElement
        expect(description.classList.contains('wrap-anywhere')).toBe(true)
        expect(description.classList.contains('min-w-0')).toBe(true)
    })

    test('Report and Block creator sit inside the More disclosure; import and copy do not', () => {
        const { target } = mountPopUp()
        const details = target.querySelector('details') as HTMLElement
        expect(details.querySelector('summary')?.textContent?.trim()).toBe(language.realmDetailMore)
        const inside = Array.from(details.querySelectorAll('button')).map((b) => b.textContent?.trim())
        expect(inside).toContain(language.realmReport)
        expect(inside).toContain(language.blockRealmCreator)
        expect(inside).not.toContain(language.realmImportAndChat)
        const outside = Array.from(target.querySelectorAll('button')).filter((b) => !details.contains(b)).map((b) => b.textContent?.trim())
        expect(outside).toContain(language.realmImportAndChat)
        expect(outside).toContain(language.realmCopyLink)
    })

    test('import calls the download with the same arguments and closes', () => {
        const { target, props } = mountPopUp()
        const importButton = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.realmImportAndChat) as HTMLElement
        importButton.click()
        flushSync()
        expect(downloadRisuHubSpy).toHaveBeenCalledWith('layout-card', { creator: 'creator-1' })
        expect(props.openedData).toBeNull()
    })
})
