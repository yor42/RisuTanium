// @vitest-environment jsdom

/**
 * `HomeShell.svelte`: Home's landing (the real `MainMenu` with the Library button in its header)
 * and the lazily loaded library. Every creation starts at the landing; the landing stays up while
 * the library chunk is pending; a chunk that fails to load goes back to the landing and reports
 * the error.
 *
 * MOCKED: the module set of `MainMenu.hubStates.svelte.test.ts` (`src/lib/UI`). `HomeLibrary` is a
 * marker stand-in (its own behaviour is tested in `HomeLibrary.svelte.test.ts`), and `alertError` is
 * the only export of a stand-in alert module.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'

//#region module mocks

const alertErrorSpy = vi.hoisted(() => vi.fn())

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

vi.mock('../Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

vi.mock('src/ts/alert', () => ({ alertError: alertErrorSpy }))

const libraryStub = vi.hoisted(() => (anchor: Comment) => {
    const marker = document.createElement('div')
    marker.setAttribute('data-testid', 'library-stub')
    anchor.parentNode!.insertBefore(marker, anchor)
})
vi.mock('./HomeLibrary.svelte', () => ({ default: libraryStub }))

//#endregion

import HomeShell from './HomeShell.svelte'
import { homeView, requestHomeLibrary, showHomeLanding } from './homeView.svelte'
import { OpenRealmStore } from 'src/ts/stores.svelte'

const mountedInstances: unknown[] = []
const mountedTargets: HTMLElement[] = []

function mountShell(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(HomeShell, { target }))
    flushSync()
    return target
}

async function settleChunk(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        await tick()
        flushSync()
    }
}

const libraryShown = (root: HTMLElement): boolean => root.querySelector('[data-testid="library-stub"]') !== null
const landingShown = (root: HTMLElement): boolean => root.textContent?.includes('test-version') === true

function libraryButton(root: HTMLElement): HTMLButtonElement {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.character)
    if (!button) {
        throw new Error('Library button not found')
    }
    return button
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    alertErrorSpy.mockClear()
    showHomeLanding()
})

afterEach(async () => {
    OpenRealmStore.set(false)
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetBackHandlersForTests()
    showHomeLanding()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

describe('HomeShell', () => {
    // First in the file: it replaces the stand-in with a module that throws, for this test only.
    test('a library chunk that fails to load returns to the landing and reports the error', async () => {
        vi.doMock('./HomeLibrary.svelte', () => {
            throw new Error('chunk failed to load')
        })
        const root = mountShell()
        libraryButton(root).click()
        flushSync()
        expect(homeView.view).toBe('library')
        expect(landingShown(root)).toBe(true)

        try {
            await vi.waitFor(() => expect(alertErrorSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
            await settleChunk()

            expect(homeView.view).toBe('landing')
            expect(landingShown(root)).toBe(true)
            expect(libraryShown(root)).toBe(false)
            expect(alertErrorSpy.mock.calls[0][0]).toBeInstanceOf(Error)
        } finally {
            vi.doMock('./HomeLibrary.svelte', () => ({ default: libraryStub }))
        }
    })

    test('the Library button opens the library; the landing stays up until the chunk is ready', async () => {
        const root = mountShell()
        expect(landingShown(root)).toBe(true)
        expect(libraryShown(root)).toBe(false)

        libraryButton(root).click()
        flushSync()
        expect(homeView.view).toBe('library')
        expect(landingShown(root)).toBe(true)
        expect(libraryShown(root)).toBe(false)

        await vi.waitFor(() => expect(libraryShown(root)).toBe(true), { timeout: 5000 })
        expect(landingShown(root)).toBe(false)
    })

    test('showHomeLanding brings the landing back from the library', async () => {
        const root = mountShell()
        libraryButton(root).click()
        await vi.waitFor(() => expect(libraryShown(root)).toBe(true), { timeout: 5000 })

        showHomeLanding()
        flushSync()
        expect(libraryShown(root)).toBe(false)
        expect(landingShown(root)).toBe(true)
    })

    test('the mode switcher sits in the landing header and is hidden while the Realm view is open', () => {
        const root = mountShell()
        const group = root.querySelector('fieldset')
        expect(group).not.toBeNull()
        expect(group!.querySelector('legend')!.textContent).toBe(language.homeModeSwitcherLabel)
        expect(group!.querySelectorAll('input[type="radio"]').length).toBe(3)

        OpenRealmStore.set(true)
        flushSync()
        expect(root.querySelector('fieldset')).toBeNull()

        OpenRealmStore.set(false)
        flushSync()
        expect(root.querySelector('fieldset')).not.toBeNull()
    })

    test('every creation starts at the landing, even when the library was left open', async () => {
        const first = mountShell()
        libraryButton(first).click()
        await vi.waitFor(() => expect(libraryShown(first)).toBe(true), { timeout: 5000 })

        await unmount(mountedInstances.pop() as never)
        mountedTargets.pop()!.remove()
        expect(homeView.view).toBe('library')

        const second = mountShell()
        expect(homeView.view).toBe('landing')
        expect(landingShown(second)).toBe(true)
        expect(libraryShown(second)).toBe(false)
    })

    test('F T13b: a requested library is shown by the creation in the same tick and consumed by it', async () => {
        requestHomeLibrary()
        const first = mountShell()
        expect(homeView.view).toBe('library')
        await vi.waitFor(() => expect(libraryShown(first)).toBe(true), { timeout: 5000 })

        await unmount(mountedInstances.pop() as never)
        mountedTargets.pop()!.remove()
        const second = mountShell()
        expect(homeView.view).toBe('landing')
        expect(landingShown(second)).toBe(true)
        expect(libraryShown(second)).toBe(false)
        await tick()
    })

    test('G T13b: a request not used by a creation expires after the tick, so a later creation starts at the landing', async () => {
        requestHomeLibrary()
        await tick()
        await tick()

        const root = mountShell()
        expect(homeView.view).toBe('landing')
        expect(landingShown(root)).toBe(true)
        expect(libraryShown(root)).toBe(false)
    })
})
