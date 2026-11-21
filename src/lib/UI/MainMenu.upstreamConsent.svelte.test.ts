// @vitest-environment happy-dom

/**
 * Coverage for `MainMenu.svelte`'s realm preview gated on upstream-service
 * acceptance (T-C2, T-C15 half). Compare `MainMenu.hubStates.svelte.test.ts`,
 * which covers the five populated/offline/pending/failed/empty states once
 * accepted and the consent placeholder itself; this file covers
 * the placeholder's own behaviour in more depth: it never calls `getRisuHub`,
 * it never causes a `'tos'` alert on its own (mount, `online`, a whole-`db`
 * swap), acceptance granted elsewhere loads the preview once without a
 * remount, its own control asks and never opens Realm, and a stray
 * `'consent'` result never reads as the failed state.
 *
 * Mocks follow `MainMenu.hubStates.svelte.test.ts`'s own precedent:
 * `src/ts/characterCards` so no network fetch fires, `src/ts/globalApi.svelte`
 * so `openURL`/`getVersionString` are inert, `src/ts/stores.svelte` for a
 * controllable `DBState.db` and a real `alertStore`, and
 * `./Realm/RealmMain.svelte` stubbed since `$OpenRealmStore` never becomes
 * true here. `src/ts/upstreamAgreement` is never mocked: acceptance is
 * seeded through its own key and test reset, and `askUpstreamAgreement` is
 * called for real to simulate acceptance granted by another view.
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
import { DBState, OpenRealmStore, alertStore } from 'src/ts/stores.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountMainMenu() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(MainMenu, { target, props: {} })
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
    DBState.db.hideRealm = false
    OpenRealmStore.set(false)
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

describe('MainMenu.svelte: the realm preview placeholder before acceptance', () => {
    test('without acceptance, the placeholder shows and getRisuHub is never called', async () => {
        const target = mountMainMenu()
        await settle()

        expect(placeholder(target)).toBeTruthy()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
    })

    // Guard: nothing here ever posts the agreement prompt on its own; only the placeholder's own
    // control does.
    test('no tos alert is posted by mount, by an online event, or by replacing DBState.db wholesale', async () => {
        mountMainMenu()
        await settle()
        expect(get(alertStore).type).not.toBe('tos')

        window.dispatchEvent(new Event('online'))
        await settle()
        expect(get(alertStore).type).not.toBe('tos')

        DBState.db = { hideRealm: false, realmDirectOpen: false, hideAllImages: false } as never
        flushSync()
        await settle()
        expect(get(alertStore).type).not.toBe('tos')
    })

    test('acceptance granted elsewhere loads the preview once, without remounting the component', async () => {
        const target = mountMainMenu()
        await settle()
        expect(placeholder(target)).toBeTruthy()
        const stableNode = target.querySelector('h3')
        expect(stableNode).toBeTruthy()

        const accepted = askUpstreamAgreement()
        await waitFor(() => get(alertStore).type === 'tos', "the agreement prompt")
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await expect(accepted).resolves.toBe(true)
        await settle()

        expect(placeholder(target)).toBeNull()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(target.querySelector('h3')).toBe(stableNode)
    })

    test("clicking the placeholder's control posts the prompt, opens no Realm, and Accept makes exactly one getRisuHub call", async () => {
        const target = mountMainMenu()
        await settle()
        const control = acceptControl(target)
        expect(control).toBeTruthy()

        // The card's own delegated handler sets `$OpenRealmStore` synchronously on any click that
        // reaches it (the placeholder sits outside its `data-realm-preview-list` exemption), so a
        // click that propagated would show up here at once, before Accept is even answered.
        const setSpy = vi.spyOn(OpenRealmStore, 'set')
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', "the agreement prompt")
        expect(setSpy).not.toHaveBeenCalled()
        expect(get(OpenRealmStore)).toBe(false)
        setSpy.mockRestore()

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })

    test("Decline leaves the placeholder in place and makes no request", async () => {
        const target = mountMainMenu()
        await settle()
        const control = acceptControl(target)
        expect(control).toBeTruthy()

        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', "the agreement prompt")
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE } as never)
        await settle()

        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
        expect(placeholder(target)).toBeTruthy()
    })

    // Guard: hideRealm hides the whole realm card, placeholder included, independent of acceptance.
    test('hideRealm true omits the realm card and its placeholder, even without acceptance', async () => {
        DBState.db.hideRealm = true
        const target = mountMainMenu()
        await settle()

        expect(placeholder(target)).toBeNull()
        const aside = target.querySelector('[data-part="home-side"]')
        expect(aside).toBeTruthy()
        expect(Array.from(target.querySelectorAll('button')).some((b) => b.getAttribute('aria-label') === language.hubBrowseMore)).toBe(false)
        expect(target.querySelector('[data-realm-preview-list]')).toBeNull()
        expect(aside!.querySelector('[role="status"]')).toBeNull()
        expect(aside!.querySelectorAll('[data-part="home-community"] > ul > li').length).toBe(4)
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
    })
})

describe('MainMenu.svelte: no failed state before acceptance (T-C15)', () => {
    // Relies on the default mock installed in beforeEach: nothing here ever accepts, so
    // `installConsentDerivedMock()`'s own `isUpstreamAccepted()` branch never diverges from a
    // fixed `'consent'` answer for the duration of this test.
    test('without acceptance, the card never shows "load failed", including after an online event', async () => {
        const target = mountMainMenu()
        await settle()
        expect(target.querySelector('[role="status"]')?.textContent).not.toContain(language.hubLoadFailed)

        window.dispatchEvent(new Event('online'))
        await settle()
        expect(target.querySelector('[role="status"]')?.textContent).not.toContain(language.hubLoadFailed)
    })
})

describe('MainMenu.svelte: the online listener must respect withdrawn acceptance', () => {
    // The online listener must require `$upstreamAccepted` as well as `hubStatus === 'offline'` and
    // `!realmHidden`: `hubStatus` stays 'offline' from an earlier accepted load after acceptance is
    // withdrawn, so without it an `online` event would reach `getRisuHub` for a user who has not agreed.
    test('acceptance withdrawn while offline, then an online event: getRisuHub is not called again', async () => {
        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()
        hubMock.getRisuHub.mockImplementation(async () => ({ ok: false, reason: 'offline' }) as never)

        const target = mountMainMenu()
        await settle()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(placeholder(target)).toBeNull()

        hubMock.getRisuHub.mockClear()
        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        window.dispatchEvent(new StorageEvent('storage', { key: UPSTREAM_AGREEMENT_KEY }))
        await settle()
        expect(get(upstreamAccepted)).toBe(false)
        expect(placeholder(target)).toBeTruthy()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        window.dispatchEvent(new Event('online'))
        await settle()

        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
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
    const target = mountMainMenu()
    hold()
    await settle()
    expect(get(upstreamAccepted)).toBe(false)
    expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    expect(placeholder(target)).toBeTruthy()
    hubMock.getRisuHub.mockClear()
    return target
}

describe('MainMenu.svelte: accepting through the placeholder loads exactly once in every way acceptance can go stale', () => {
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

    // hideRealm is MainMenu's own opt-out; RealmMain has nothing analogous, since closing that view
    // entirely is its only way to stop showing hub content.
    test('S-d, hideRealm turns on while the prompt is pending: Accept issues no reload; turning it off issues exactly one', async () => {
        const target = await setupKeyRemovedThenConsentLoad()

        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')

        DBState.db.hideRealm = true
        flushSync()

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        DBState.db.hideRealm = false
        flushSync()
        await settle()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })

    test('S-d, hideRealm turns on while the prompt is pending: Decline issues no reload while still hidden', async () => {
        const target = await setupKeyRemovedThenConsentLoad()

        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')

        DBState.db.hideRealm = true
        flushSync()

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE } as never)
        await settle()

        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
    })

    // The store already reads `false`, matching storage, by the time Decline runs (S-b's own setup
    // load published that correction already): Decline's own re-publish of the fresh read leaves it
    // unchanged, so turning hideRealm back off finds `$upstreamAccepted` false and issues no reload.
    test('S-d, after a Decline the store correctly stays false, so turning hideRealm back off issues no reload', async () => {
        const target = await setupKeyRemovedThenConsentLoad()

        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')

        DBState.db.hideRealm = true
        flushSync()

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE } as never)
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        DBState.db.hideRealm = false
        flushSync()
        await settle()

        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
        expect(isUpstreamAccepted()).toBe(false)
    })
})

describe('MainMenu.svelte: the placeholder\'s single-load invariant holds under overlapping triggers', () => {
    // Guard: another tab's acceptance, seen only through its own `storage` event (never the
    // placeholder's control), still loads the view exactly once.
    test('store false at mount, click, another tab accepts before this prompt is answered here: still exactly one call after Accept', async () => {
        const target = mountMainMenu()
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

    // Guard: the same double click, starting from a fresh (never-accepted) mount instead of S-b.
    test('S-a, the control is activated twice before the answer, then Accept: still exactly one call', async () => {
        const target = mountMainMenu()
        await settle()
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

    // Guard: a storage write failure on Accept still leaves exactly one reload and no lingering
    // placeholder for the rest of this page's life.
    test('S-b, the storage write throws on Accept: still exactly one call and the placeholder clears', async () => {
        const target = await setupKeyRemovedThenConsentLoad()
        const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded (simulated)')
        })
        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()
        setItemSpy.mockRestore()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(placeholder(target)).toBeNull()
    })

    // The store reads `false` throughout the pending prompt (S-b's own setup load already
    // published the correction, and nothing here answers the prompt yet), so toggling `hideRealm`
    // on and back off before the answer finds `$upstreamAccepted` false the whole time and issues
    // no load; the one load comes only from Accept, once `hideRealm` is back off.
    test('S-b, hideRealm toggles on and back off while the prompt is pending, then Accept: issues no reload before the answer, exactly one after', async () => {
        const target = await setupKeyRemovedThenConsentLoad()
        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await settle()

        DBState.db.hideRealm = true
        flushSync()
        await settle()
        DBState.db.hideRealm = false
        flushSync()
        await settle()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(placeholder(target)).toBeNull()
    })

    // Guard: a whole-`DBState.db` reassignment that leaves `hideRealm` at the same value (plugin
    // `setDatabase`, backup restore) must not itself cause a second reload alongside Accept's own.
    test('S-b, DBState.db is reassigned wholesale (hideRealm unchanged) while the prompt is up, then Accept: still exactly one call', async () => {
        const target = await setupKeyRemovedThenConsentLoad()
        const control = acceptControl(target)
        expect(control).toBeTruthy()
        control!.click()
        await settle()

        DBState.db = { hideRealm: false, realmDirectOpen: false, hideAllImages: false } as never
        flushSync()
        await settle()

        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT } as never)
        await settle()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
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
})
