// @vitest-environment happy-dom

/**
 * Coverage for `RealmMain.svelte`'s browse view gated on upstream-service
 * acceptance (T-C2m, T-C15 half). Compare `RealmMain.hubStates.svelte.test.ts`, which covers
 * the five populated/offline/pending/failed/empty states once accepted;
 * this file covers the placeholder itself: no request at mount, no request
 * from any control while it shows, no request from an `online` event,
 * acceptance granted elsewhere loads it exactly once, and a stray
 * `'consent'` result never reads as the failed state.
 *
 * Mocks follow `RealmMain.hubStates.svelte.test.ts`'s own precedent:
 * `src/ts/characterCards` so no network fetch fires, `src/ts/stores.svelte`
 * for a controllable `selIdState` and a real `alertStore`, and
 * `./RealmHubIcon.svelte`/`./RealmPopUp.svelte` stubbed. Unlike that file,
 * `src/ts/alert` keeps its real exports (only `alertInput` is overridden).
 * `src/ts/upstreamAgreement`'s own `askUpstreamAgreement` is exercised for
 * real here, to simulate acceptance granted by another view, and it is never
 * mocked itself -- acceptance is seeded through its own key and test reset.
 *
 * `getRisuHub`'s mock derives its answer by default from the real module's own
 * `isUpstreamAccepted()` (installed fresh in `beforeEach`, reinstalled by
 * individual tests that need a fixed shape) rather than a value set by hand,
 * so no test here can simulate the unreachable state of a `'consent'`
 * response while storage actually holds an accepted key.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { RisuHubResult } from 'src/ts/characterCards'
import {
    UPSTREAM_AGREEMENT_ACCEPT,
    UPSTREAM_AGREEMENT_DECLINE,
    UPSTREAM_AGREEMENT_KEY,
    askUpstreamAgreement,
    isUpstreamAccepted,
    publishUpstreamAccepted,
    resetUpstreamAgreementForTests,
    upstreamAccepted,
} from 'src/ts/upstreamAgreement'

//#region module mocks

const hubMock = vi.hoisted(() => {
    const getRisuHub = vi.fn(async () => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult))
    return { getRisuHub }
})

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: hubMock.getRisuHub,
    downloadRisuHub: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/alert'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        alertInput: vi.fn(async () => ''),
    }
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        MobileGUI: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('./RealmHubIcon.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./RealmPopUp.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import RealmMain from './RealmMain.svelte'
import { alertStore } from 'src/ts/stores.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountRealmMain() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(RealmMain, { target, props: {} })
    mountedInstances.push(instance)
    flushSync()
    return target
}

async function settle() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
}

function placeholder(target: HTMLElement): HTMLElement | null {
    return target.querySelector('[data-testid="upstream-consent-placeholder"]')
}

function acceptControl(target: HTMLElement): HTMLElement | null {
    return target.querySelector('[data-testid="upstream-consent-accept"]')
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

function searchButton(target: HTMLElement): HTMLButtonElement {
    // The search icon button is the first of the two buttons beside the
    // search input, ahead of the menu button -- found by position, since
    // it carries no text and no test id.
    const buttons = Array.from(target.querySelectorAll('button'))
    return buttons[0]
}

function findByText(target: HTMLElement, text: string): HTMLButtonElement | undefined {
    return Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
}

// The pager only renders once `sort` has moved off its 'recommended' default
// (see the sort buttons above), and carries no test id: its middle button is
// the non-interactive page-number display, found by its text; its immediate
// siblings are the previous/next-page controls.
function pagerArrows(target: HTMLElement): { left: HTMLElement | undefined, right: HTMLElement | undefined } {
    const pageLabel = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === '1')
    return {
        left: pageLabel?.previousElementSibling as HTMLElement | undefined,
        right: pageLabel?.nextElementSibling as HTMLElement | undefined,
    }
}

/** The default `getRisuHub` answer: `'consent'` exactly when a fresh read finds no acceptance,
 * `ok: true` with an empty page otherwise -- never a fixed value a test has to keep in sync by
 * hand with whatever the real module reads. The `'consent'` branch calls the real
 * `publishUpstreamAccepted()` (`src/ts/upstreamAgreement.ts`), exactly as the production
 * `getRisuHub` does on that branch, so this mock never leaves the store disagreeing with the
 * fresh read it just returned. */
function installConsentDerivedMock() {
    hubMock.getRisuHub.mockImplementation(async () => {
        if (isUpstreamAccepted()) {
            return { ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult
        }
        publishUpstreamAccepted()
        return { ok: false, reason: 'consent' } as never
    })
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })))
    vi.stubGlobal('open', vi.fn())
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    installConsentDerivedMock()
})

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
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

describe('RealmMain.svelte desktop: the placeholder before acceptance', () => {
    test('without acceptance, the placeholder shows and getRisuHub is never called', async () => {
        const target = mountRealmMain()
        await settle()

        expect(placeholder(target)).toBeTruthy()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
    })

    test('clicking every present control (sort, NSFW, pager, search) makes no request and posts no prompt', async () => {
        const target = mountRealmMain()
        await settle()
        expect(placeholder(target)).toBeTruthy()

        // Sort first, while it still starts at its 'recommended' default:
        // the search button below also resets sort to '' whenever sort is
        // 'recommended' or 'random' at the moment it is clicked, so clicking
        // search first would silently invalidate the "Recent" lookup that
        // follows it.
        const recent = findByText(target, language.recent)
        expect(recent).toBeTruthy()
        recent!.click()
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        const trending = findByText(target, language.trending)
        expect(trending).toBeTruthy()
        trending!.click()
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        const random = findByText(target, language.random)
        expect(random).toBeTruthy()
        random!.click()
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        const downloads = findByText(target, language.downloads)
        expect(downloads).toBeTruthy()
        downloads!.click()
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        const nsfw = findByText(target, 'NSFW')
        expect(nsfw).toBeTruthy()
        nsfw!.click()
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        // The pager only shows once sort has left 'recommended', which the
        // clicks above already caused (downloads).
        const { left, right } = pagerArrows(target)
        expect(left).toBeTruthy()
        expect(right).toBeTruthy()
        left!.click()
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
        right!.click()
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        // Sort is already off 'recommended'/'random' (downloads), so this
        // click cannot silently reset it.
        const search = searchButton(target)
        expect(search).toBeTruthy()
        search.click()
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        expect(get(alertStore).type).not.toBe('tos')
    })

    test('an online event while the placeholder shows makes no request and posts no prompt', async () => {
        const target = mountRealmMain()
        await settle()
        expect(placeholder(target)).toBeTruthy()

        window.dispatchEvent(new Event('online'))
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
        expect(get(alertStore).type).not.toBe('tos')
    })

    test('acceptance granted elsewhere loads the view exactly once, and typing afterwards makes none', async () => {
        const target = mountRealmMain()
        await settle()
        expect(placeholder(target)).toBeTruthy()

        const accepted = askUpstreamAgreement()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await expect(accepted).resolves.toBe(true)
        await settle()

        expect(placeholder(target)).toBeNull()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)

        const search = target.querySelector('input') as HTMLInputElement
        search.value = 'typed'
        search.dispatchEvent(new Event('input'))
        await settle()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })

    test("clicking the placeholder's control posts the prompt; Accept makes exactly one getRisuHub call; Decline makes none", async () => {
        let target = mountRealmMain()
        await settle()
        let control = acceptControl(target)
        expect(control).toBeTruthy()

        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE } as never)
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
        expect(placeholder(target)).toBeTruthy()

        // This instance's own effect would react to the acceptance granted
        // below and issue its own getRisuHub call too, so it is unmounted
        // first: the call count checked below comes only from the mount
        // that follows.
        const firstInstance = mountedInstances.pop()
        mountedTargets.pop()
        await unmount(firstInstance as never)
        target.remove()

        target = mountRealmMain()
        await settle()
        control = acceptControl(target)
        expect(control).toBeTruthy()

        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })
})

describe('RealmMain.svelte: no failed state before acceptance (T-C15)', () => {
    // Relies on the default mock installed in beforeEach: nothing here ever accepts, so
    // `installConsentDerivedMock()`'s own `isUpstreamAccepted()` branch never diverges from a
    // fixed `'consent'` answer for the duration of this test.
    test('without acceptance, the view never shows "load failed", including after an online event', async () => {
        const target = mountRealmMain()
        await settle()
        expect(target.querySelector('[role="status"]')?.textContent).not.toContain(language.hubLoadFailed)

        window.dispatchEvent(new Event('online'))
        await settle()
        expect(target.querySelector('[role="status"]')?.textContent).not.toContain(language.hubLoadFailed)
    })
})

/** S-b setup: the key is removed without a `storage` event, so the store stays cached `true`
 * across the removal while a fresh read already disagrees. The subscription that keeps the
 * store's cached value alive across the `removeItem` is released only once the mounted
 * component's own subscription is in place to keep it alive in turn, so the mounted component
 * still observes the stale `true` and, per the acceptance effect, issues one `getRisuHub` call.
 * That call's own `'consent'` branch publishes the fresh read via `publishUpstreamAccepted()`
 * (`src/ts/upstreamAgreement.ts`), correcting the store to `false` before this function returns --
 * the placeholder shows because the store now agrees with storage, not because it disagrees. */
async function setupKeyRemovedThenConsentLoad(): Promise<HTMLElement> {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    const hold = upstreamAccepted.subscribe(() => {})
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    const target = mountRealmMain()
    hold()
    await settle()
    expect(get(upstreamAccepted)).toBe(false)
    expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    expect(placeholder(target)).toBeTruthy()
    hubMock.getRisuHub.mockClear()
    return target
}

describe('RealmMain.svelte: accepting through the placeholder loads exactly once in every way acceptance can go stale', () => {
    // A subscriber attached before the mount keeps `upstreamAccepted`'s cached value at `true`
    // across the `removeItem` below, since nothing dispatches a `storage` event for a same-tab
    // removal -- the mounted component's own subscription then reads that same cached value
    // instead of re-reading storage itself, so the store still says accepted while storage does not.
    test('S-b, the key is removed without a storage event: Accept reloads exactly once', async () => {
        const target = await setupKeyRemovedThenConsentLoad()

        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(placeholder(target)).toBeNull()
    })

    test('S-b, the key is removed without a storage event: Decline reloads never', async () => {
        const target = await setupKeyRemovedThenConsentLoad()

        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE } as never)
        await settle()

        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
        expect(placeholder(target)).toBeTruthy()
    })

    // The store already agrees with storage (`false`) once S-b's own setup load has published the
    // fresh read, so this `key:null` event, arriving before the click, finds nothing to correct and
    // is a no-op for the store -- the outcome below matches S-b exactly.
    test('S-c, as S-b plus a key:null storage event before the click: Accept reloads exactly once', async () => {
        const target = await setupKeyRemovedThenConsentLoad()

        window.dispatchEvent(new StorageEvent('storage', { key: null }))
        await settle()
        expect(get(upstreamAccepted)).toBe(false)

        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(placeholder(target)).toBeNull()
    })

    test('S-c, as S-b plus a key:null storage event before the click: Decline reloads never', async () => {
        const target = await setupKeyRemovedThenConsentLoad()

        window.dispatchEvent(new StorageEvent('storage', { key: null }))
        await settle()
        expect(get(upstreamAccepted)).toBe(false)

        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE } as never)
        await settle()

        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
        expect(placeholder(target)).toBeTruthy()
    })
})

describe('RealmMain.svelte: the placeholder\'s single-load invariant holds under overlapping triggers', () => {
    // Guard: another tab's acceptance, seen only through its own `storage` event (never the
    // placeholder's control), still loads the view exactly once.
    test('store false at mount, click, another tab accepts before this prompt is answered here: still exactly one call after Accept', async () => {
        const target = mountRealmMain()
        await settle()
        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')

        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        window.dispatchEvent(new StorageEvent('storage', { key: UPSTREAM_AGREEMENT_KEY }))
        await settle()
        const midCalls = hubMock.getRisuHub.mock.calls.length

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()

        expect(midCalls).toBe(1)
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })

    // Guard: same as above, starting from the S-b setup (store already `false`, one load already
    // made and cleared) instead of a fresh mount. The other tab's event is a genuine `false` -> `true`
    // transition here, so the acceptance effect reacts to it directly and loads before Accept is even
    // answered; Accept's own resolution then reconfirms the same already-`true` value, which the
    // store's equality check recognises as nothing new (a same-value set notifies nobody), so it
    // issues no second load.
    test('S-b, then another tab accepts (a storage event naming the key) before this prompt is answered: still exactly one call after Accept', async () => {
        const target = await setupKeyRemovedThenConsentLoad()
        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')

        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        window.dispatchEvent(new StorageEvent('storage', { key: UPSTREAM_AGREEMENT_KEY }))
        await settle()
        const midCalls = hubMock.getRisuHub.mock.calls.length

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()

        expect(midCalls).toBe(1)
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })

    // The store already reads `false` from S-b's own setup load, so this `key:null` event finds
    // nothing to correct and is a no-op; Accept afterwards is the only real `false` -> `true`
    // transition, and the acceptance effect's single load comes from that transition alone.
    test('S-b, click, then a key:null storage event arrives while the prompt is up, then Accept: still exactly one call', async () => {
        const target = await setupKeyRemovedThenConsentLoad()
        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')

        window.dispatchEvent(new StorageEvent('storage', { key: null }))
        await settle()
        expect(get(upstreamAccepted)).toBe(false)

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })

    // Two clicks before either answer join the same pending prompt; one Accept must still leave
    // exactly one reload, not one per click that joined it.
    test('S-b, the control is activated twice before the answer, then Accept: still exactly one call', async () => {
        const target = await setupKeyRemovedThenConsentLoad()
        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await settle()
        control!.click()
        await settle()

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })

    // An answer that resolves after the component has already been torn down must not run a load
    // against dead state: the prompt's promise does outlive the component, but an unmounted view
    // must load nothing when it settles.
    test('S-b, click, unmount while the prompt is up, then Accept: zero calls reach the dead instance', async () => {
        const target = await setupKeyRemovedThenConsentLoad()
        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await settle()

        const instance = mountedInstances.pop()
        mountedTargets.pop()
        await unmount(instance as never)
        target.remove()

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()

        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
    })

    // The store can also be corrected to true by something other than a click here: another tab's
    // acceptance reaching this view purely through the `storage` event, with no click on this
    // instance's own control at all.
    test('S-b, another tab accepts (a storage event naming the key), with no click here: the view loads once and the placeholder clears', async () => {
        const target = await setupKeyRemovedThenConsentLoad()

        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        window.dispatchEvent(new StorageEvent('storage', { key: UPSTREAM_AGREEMENT_KEY }))
        await settle()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(placeholder(target)).toBeNull()
    })

    // The store already reads `false` (S-b's own setup load corrected it), so `getHub()`'s own
    // `!$upstreamAccepted` guard alone blocks this click; the click still reaches the button, but
    // no request follows it.
    test('S-b, the search control is clicked while the placeholder still shows: makes no request', async () => {
        const target = await setupKeyRemovedThenConsentLoad()

        searchButton(target).click()
        await settle()

        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
    })
})
