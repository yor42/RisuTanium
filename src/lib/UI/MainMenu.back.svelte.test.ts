// @vitest-environment jsdom

/**
 * `MainMenu.svelte`: Back closes the Realm full view, as the view's own Back arrow does, and the
 * optional `header` snippet is shown on the landing only (never inside the Realm full view).
 *
 * MOCKED: the module set of `MainMenu.hubStates.svelte.test.ts` (same directory). The back registry
 * and the quit guard are real, so a press that no handler takes shows up as the guard's warning.
 */

import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { dispatchBack, installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'

//#region module mocks

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: vi.fn(() => new Promise(() => {})),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({
        db: { hideRealm: false, realmDirectOpen: false, hideAllImages: false } as unknown as Record<string, unknown>,
    })
    return {
        DBState: state,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('./Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import MainMenu from './MainMenu.svelte'
import { OpenRealmStore } from 'src/ts/stores.svelte'

const showToast = vi.fn()
const mountedInstances: unknown[] = []
const mountedTargets: HTMLElement[] = []

function mountMainMenu(props: Record<string, unknown> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(MainMenu, { target, props }))
    flushSync()
    return target
}

function openRealmFromTitle(target: HTMLElement): void {
    const title = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.hubBrowseMore}"]`)
    expect(title).toBeTruthy()
    title!.click()
    flushSync()
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    showToast.mockReset()
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    OpenRealmStore.set(false)
    resetBackHandlersForTests()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

describe('MainMenu: Back and the header', () => {
    test('Back closes the Realm full view (regression reproducer: without the handler the store stays open)', () => {
        const target = mountMainMenu()
        openRealmFromTitle(target)
        expect(get(OpenRealmStore)).toBe(true)

        expect(dispatchBack()).toBe(true)
        flushSync()

        expect(get(OpenRealmStore)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('guard: with the Realm view closed Back reaches the quit guard', () => {
        mountMainMenu()
        expect(get(OpenRealmStore)).toBe(false)

        expect(dispatchBack()).toBe(true)

        expect(showToast).toHaveBeenCalledTimes(1)
        expect(get(OpenRealmStore)).toBe(false)
    })

    test('the header snippet shows on the landing and is absent while the Realm view is open', () => {
        const header = createRawSnippet(() => ({ render: () => '<button data-testid="home-header">Library</button>' }))
        const target = mountMainMenu({ header })
        expect(target.querySelector('[data-testid="home-header"]')).not.toBeNull()

        openRealmFromTitle(target)
        expect(target.querySelector('[data-testid="home-header"]')).toBeNull()

        OpenRealmStore.set(false)
        flushSync()
        expect(target.querySelector('[data-testid="home-header"]')).not.toBeNull()
    })

    test('without a header snippet the landing renders none', () => {
        const target = mountMainMenu()
        expect(target.querySelector('[data-testid="home-header"]')).toBeNull()
    })
})
