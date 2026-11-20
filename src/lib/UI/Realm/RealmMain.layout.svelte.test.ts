// @vitest-environment jsdom

/**
 * Structure and names of the RisuRealm hub view (`RealmMain.svelte`, `RealmHubIcon.svelte`): the
 * header Back, the labelled toolbar, the status/pager states and the focus handoff after the
 * agreement is accepted from this view's own button. The grid tile is the real component so the
 * "no nested interactive element" assertion looks at its actual markup.
 *
 * MOCKED: `src/ts/characterCards` (`getRisuHub` is driven per test, nothing reaches a network),
 * `src/ts/alert`, `src/ts/stores.svelte` and the detail popup. Synthetic data only.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { RisuHubResult, hubType } from 'src/ts/characterCards'
import { UPSTREAM_AGREEMENT_ACCEPT, UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

//#region module mocks

const hubMock = vi.hoisted(() => ({
    getRisuHub: vi.fn(async (_arg: unknown): Promise<unknown> => ({ ok: true, cards: [], additionalHTML: '' })),
}))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: hubMock.getRisuHub,
    downloadRisuHub: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/alert'), () => ({
    alertInput: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { blockedRealmCreators: [{ id: 'c1', name: 'One' }], hideAllImages: false, language: 'en' } as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        MobileGUI: writable(false),
        RealmInitialOpenChar: writable(null),
        OpenRealmStore: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('./RealmPopUp.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import { OpenRealmStore, alertStore } from 'src/ts/stores.svelte'
import RealmMain from './RealmMain.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountRealmMain() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(RealmMain, { target, props: {} }))
    flushSync()
    return target
}

async function settle() {
    for (let i = 0; i < 8; i++) {
        await Promise.resolve()
    }
    flushSync()
}

async function waitFor(predicate: () => boolean, expected: string, timeoutMs = 2000): Promise<void> {
    const start = Date.now()
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`timed out waiting for: ${expected}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

function makeChara(name: string): hubType {
    return {
        name, desc: '', download: '', id: name, img: 'x.png', tags: ['a', 'b'],
        viewScreen: 'none', hasLore: true, hasEmotion: true, hasAsset: true, hot: 0,
        license: '', type: 'character',
    }
}

function lastCall(): { sort: string, page: number, nsfw: boolean, search: string } {
    const calls = hubMock.getRisuHub.mock.calls
    return calls[calls.length - 1][0] as { sort: string, page: number, nsfw: boolean, search: string }
}

function pagerButton(target: HTMLElement, label: string): HTMLButtonElement | null {
    return target.querySelector(`button[aria-label="${label}"]`)
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })))
    vi.stubGlobal('open', vi.fn())
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    hubMock.getRisuHub.mockImplementation(async () => ({ ok: true, cards: [makeChara('one')], additionalHTML: '' } satisfies RisuHubResult))
    OpenRealmStore.set(true)
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

describe('RealmMain.svelte: header and toolbar', () => {
    test('the header carries a named Back button that closes the hub, and the page heading', async () => {
        const target = mountRealmMain()
        await settle()

        const header = target.querySelector('header')
        expect(header).toBeTruthy()
        expect(header!.querySelector('h1')?.textContent?.trim()).toBe(language.hub)
        const back = Array.from(header!.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.hubBackToHome)
        expect(back).toBeTruthy()
        expect(back!.classList.contains('risu-focus-ring')).toBe(true)

        back!.click()
        expect(get(OpenRealmStore)).toBe(false)
    })

    test('the search input has an accessible name and the search button is named', async () => {
        const target = mountRealmMain()
        await settle()

        const input = target.querySelector('input') as HTMLInputElement
        const naming = document.getElementById(input.getAttribute('aria-labelledby') ?? '')
        expect(naming?.textContent?.trim()).toBe(language.hubSearchLabel)
        expect(input.getAttribute('aria-describedby')).toBe(input.getAttribute('aria-labelledby'))
        expect(input.placeholder).toBe(language.hubSearchLabel)
        expect(target.querySelector(`button[aria-label="${language.search}"]`)).toBeTruthy()
    })

    test('the sort select offers the five options and a change loads with the mapped sort', async () => {
        const target = mountRealmMain()
        await settle()

        const select = target.querySelector('select') as HTMLSelectElement
        expect(select.closest('label')?.textContent).toContain(language.hubSortLabel)
        expect(Array.from(select.options).map((o) => [o.value, o.textContent?.trim()])).toEqual([
            ['recommended', language.hubSortRecommended],
            ['', language.recent],
            ['trending', language.trending],
            ['downloads', language.downloads],
            ['random', language.random],
        ])
        expect(lastCall().sort).toBe('recommended')

        for (const value of ['trending', 'downloads', 'random', '']) {
            hubMock.getRisuHub.mockClear()
            select.value = value
            select.dispatchEvent(new Event('change', { bubbles: true }))
            await settle()
            expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
            expect(lastCall().sort).toBe(value)
            expect(lastCall().page).toBe(0)
        }
    })

    test('the NSFW toggle exposes aria-pressed and flips it with the load flag', async () => {
        const target = mountRealmMain()
        await settle()
        const nsfw = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'NSFW')!
        expect(nsfw.getAttribute('aria-pressed')).toBe('false')

        nsfw.click()
        await settle()
        expect(nsfw.getAttribute('aria-pressed')).toBe('true')
        expect(lastCall().nsfw).toBe(true)

        nsfw.click()
        await settle()
        expect(nsfw.getAttribute('aria-pressed')).toBe('false')
        expect(lastCall().nsfw).toBe(false)
    })

    test('the blocked-creator count and the import action are visible buttons, with no hamburger menu', async () => {
        const target = mountRealmMain()
        await settle()
        const labels = Array.from(target.querySelectorAll('button')).map((b) => b.textContent?.trim())
        expect(labels).toContain(language.hubBlockedCreatorsCount.replace('{count}', '1'))
        expect(labels).toContain(language.uiCommon.importCharacterFromUrlOrId)
        expect(labels).not.toContain(language.menu)
    })
})

describe('RealmMain.svelte: states and pager', () => {
    test('a pending first load shows the loading status and marks the results busy, with no tiles', async () => {
        hubMock.getRisuHub.mockImplementation(() => new Promise(() => {}))
        const target = mountRealmMain()
        await settle()

        const status = target.querySelector('[role="status"]')
        expect(status?.textContent).toContain(`${language.loading}...`)
        expect(status?.getAttribute('aria-live')).toBe('polite')
        expect(target.querySelector('[aria-busy="true"]')).toBeTruthy()
        expect(target.querySelectorAll('[role="status"]').length).toBe(1)
    })

    test('results stay visible but dimmed while a reload is pending', async () => {
        const target = mountRealmMain()
        await settle()
        expect(target.querySelector('[role="status"]')).toBeNull()
        expect(target.querySelector('[aria-busy="true"]')).toBeNull()

        hubMock.getRisuHub.mockImplementation(() => new Promise(() => {}))
        const select = target.querySelector('select') as HTMLSelectElement
        select.value = 'trending'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()

        expect(target.querySelector('[role="status"]')?.textContent).toContain(`${language.loading}...`)
        expect(target.querySelector('[aria-busy="true"]')).toBeTruthy()
        const grid = target.querySelector('.grid')
        expect(grid?.textContent).toContain('one')
        expect(grid?.classList.contains('opacity-60')).toBe(true)
    })

    test('the pager is hidden when the load failed or came back empty', async () => {
        const target = mountRealmMain()
        await settle()
        const select = target.querySelector('select') as HTMLSelectElement

        hubMock.getRisuHub.mockImplementation(async () => ({ ok: false, reason: 'network' }))
        select.value = 'downloads'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(target.querySelector('[role="status"]')?.textContent).toContain(language.hubLoadFailed)
        expect(pagerButton(target, language.realmNextPage)).toBeNull()

        hubMock.getRisuHub.mockImplementation(async () => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult))
        select.value = 'trending'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(target.querySelector('[role="status"]')?.textContent).toContain(language.hubEmpty)
        expect(pagerButton(target, language.realmNextPage)).toBeNull()
    })

    test('a populated paged list shows named Previous and Next with the page as text, not a button', async () => {
        const target = mountRealmMain()
        await settle()
        // recommended is not paged
        expect(pagerButton(target, language.realmNextPage)).toBeNull()

        const select = target.querySelector('select') as HTMLSelectElement
        select.value = 'downloads'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()

        const previous = pagerButton(target, language.realmPrevPage)!
        const next = pagerButton(target, language.realmNextPage)!
        expect(previous.disabled).toBe(true)
        const indicator = language.hubPageIndicator.replace('{page}', '1')
        expect(Array.from(target.querySelectorAll('button')).some((b) => b.textContent?.trim() === indicator)).toBe(false)
        expect(Array.from(target.querySelectorAll('span')).some((s) => s.textContent?.trim() === indicator)).toBe(true)

        next.click()
        await settle()
        expect(lastCall().page).toBe(1)
        expect(pagerButton(target, language.realmPrevPage)!.disabled).toBe(false)
    })

    test('an empty page after page 0 keeps an enabled Previous that loads page 0, and disables Next', async () => {
        const target = mountRealmMain()
        await settle()
        const select = target.querySelector('select') as HTMLSelectElement
        select.value = 'downloads'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()

        hubMock.getRisuHub.mockImplementation(async () => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult))
        pagerButton(target, language.realmNextPage)!.click()
        await settle()
        expect(target.querySelector('[role="status"]')?.textContent).toContain(language.hubEmpty)
        const previous = pagerButton(target, language.realmPrevPage)
        expect(previous).not.toBeNull()
        expect(previous!.disabled).toBe(false)
        expect(pagerButton(target, language.realmNextPage)!.disabled).toBe(true)

        hubMock.getRisuHub.mockImplementation(async () => ({ ok: true, cards: [makeChara('one')], additionalHTML: '' } satisfies RisuHubResult))
        previous!.click()
        await settle()
        expect(lastCall().page).toBe(0)
    })

    test('a tile is one button with no nested interactive element and text badges for features', async () => {
        const target = mountRealmMain()
        await settle()

        const tile = target.querySelector('.grid > button') as HTMLElement
        expect(tile).toBeTruthy()
        expect(tile.querySelector('[role="button"], button, a, [tabindex]')).toBeNull()
        expect(tile.textContent).toContain(language.realmBadgeEmotion)
        expect(tile.textContent).toContain(language.realmBadgeAssets)
        expect(tile.textContent).toContain(language.realmBadgeLore)
    })
})

describe('RealmMain.svelte: focus after accepting from this view', () => {
    test('accepting through the placeholder button moves focus to the results region once loaded', async () => {
        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        resetUpstreamAgreementForTests()
        hubMock.getRisuHub.mockImplementation(async () => ({ ok: true, cards: [makeChara('one')], additionalHTML: '' } satisfies RisuHubResult))
        const target = mountRealmMain()
        await settle()

        const control = target.querySelector('[data-testid="upstream-consent-accept"]') as HTMLElement
        control.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await waitFor(() => hubMock.getRisuHub.mock.calls.length === 1, 'the acceptance load')

        const region = target.querySelector('[aria-busy]') as HTMLElement
        expect(region.getAttribute('tabindex')).toBe('-1')
        await waitFor(() => document.activeElement === region, 'focus on the results region')
        expect(target.querySelector('.grid')?.textContent).toContain('one')
    })

    test('acceptance that arrives from elsewhere loads without moving focus', async () => {
        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        resetUpstreamAgreementForTests()
        const target = mountRealmMain()
        await settle()
        const region = target.querySelector('[aria-busy]') as HTMLElement

        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        window.dispatchEvent(new StorageEvent('storage', { key: UPSTREAM_AGREEMENT_KEY }))
        await settle()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(document.activeElement).not.toBe(region)
    })
})
