// @vitest-environment jsdom

/**
 * Component-level coverage for the realm card's five-state model in
 * `MainMenu.svelte` (Stage 2 of the home-screen rework; see
 * `Agents/Live-State.md`). `MainMenu.hubHtmlSink.svelte.test.ts` covers only
 * the announcement banner's sanitizer wiring; this file covers the card
 * itself: the offline/pending/failed/empty/populated states, the
 * `realmDirectOpen` regression this stage is most likely to introduce
 * silently, `hideRealm`, the four-row clamp, and the generation guard that
 * makes an out-of-order (or out-of-order-*failing*) response harmless.
 *
 * `src/ts/characterCards` is mocked so `getRisuHub`'s resolved
 * `RisuHubResult` can be driven directly per test, and so no network fetch
 * ever fires. `./Realm/RealmMain.svelte` (mounted only once `$OpenRealmStore`
 * is true, which this file never sets) is stubbed to a trivial component,
 * following the `ChatBody.svelte`/`PartialEditController.svelte` precedent in
 * `Chat.messageEditor.svelte.test.ts`. `./Realm/RealmPreviewRow.svelte` is
 * NOT stubbed: its click behaviour (setting `$RealmInitialOpenChar` only
 * when `realmDirectOpen` is true) is exactly what several tests below guard.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { RisuHubResult, hubType } from 'src/ts/characterCards'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

//#region module mocks

const hubMock = vi.hoisted(() => {
    let impl: (arg: unknown) => Promise<unknown> = async () => ({
        ok: true,
        cards: [],
        additionalHTML: '',
    })
    const getRisuHub = vi.fn((arg: unknown) => impl(arg))
    return {
        getRisuHub,
        setImpl(next: (arg: unknown) => Promise<unknown> | unknown) {
            impl = async (arg: unknown) => next(arg)
        },
        setPending(promiseFactory: () => Promise<unknown>) {
            impl = () => promiseFactory()
        },
    }
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
        // `src/ts/upstreamAgreement.ts` reads and writes this store directly,
        // never through `src/ts/alert.ts` -- a mock lacking it leaves the
        // agreement helper writing to `undefined`.
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// Stubbed out entirely -- not rendered ($OpenRealmStore stays false in every
// test here) and not itself under test (see file header).
vi.mock('./Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import MainMenu from './MainMenu.svelte'
import { DBState, OpenRealmStore, RealmInitialOpenChar } from 'src/ts/stores.svelte'

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

function mountMainMenuWithInstance() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(MainMenu, { target, props: {} })
    mountedInstances.push(instance)
    flushSync()
    return { target, instance }
}

// Waits out loadHubPreview's `await getRisuHub(...)` plus its follow-on
// state writes, then forces a DOM flush.
async function flushHub() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
}

function makeChara(name: string): hubType {
    return {
        name,
        desc: '',
        download: '',
        id: name,
        img: '',
        tags: [],
        viewScreen: 'none',
        hasLore: false,
        hasEmotion: false,
        hasAsset: false,
        hot: 0,
        license: '',
        type: 'character',
    }
}

function statusMarker(target: HTMLElement): string | null {
    return target.querySelector('[role="status"]')?.textContent?.trim() ?? null
}

function previewRowButtons(target: HTMLElement): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll('button'))
}

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
        resolve = res
    })
    return { promise, resolve }
}

// Every case here is about the five-state model itself, not the agreement
// gate, so acceptance is seeded through the module before each one -- the
// one test that also covers the unaccepted placeholder withdraws and
// re-seeds it around just its own assertions (see that test).
beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
})

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    DBState.db.hideRealm = false
    DBState.db.realmDirectOpen = false
    DBState.db.hideAllImages = false
    OpenRealmStore.set(false)
    RealmInitialOpenChar.set(null)
    hubMock.setImpl(async () => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult))
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    vi.clearAllMocks()
})

describe('MainMenu.svelte realm card: the five-state model', () => {
    test('each of the five states renders its own marker, and no two states render the same text', async () => {
        // consent -- withdrawn ahead of the module-wide seed above, so this
        // mount starts from the same "nothing accepted yet" state a fresh
        // profile boots into.
        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        resetUpstreamAgreementForTests()
        let target = mountMainMenu()
        flushSync()
        const consentPlaceholder = target.querySelector('[data-testid="upstream-consent-placeholder"]')
        expect(consentPlaceholder).toBeTruthy()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
        const consentMarker = consentPlaceholder?.textContent?.trim() ?? null

        // This instance's own effect would react to the acceptance seeded
        // below and load its own preview too, so it is unmounted first: the
        // markers checked below come only from the mount that follows.
        const consentInstance = mountedInstances.pop()
        mountedTargets.pop()
        await unmount(consentInstance as never)
        target.remove()

        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()

        // pending -- synchronous, before the load's promise ever resolves
        hubMock.setPending(() => new Promise(() => {}))
        target = mountMainMenu()
        const pendingMarker = statusMarker(target)
        expect(pendingMarker).toContain(`${language.loading}...`)

        // offline
        hubMock.setImpl(() => ({ ok: false, reason: 'offline' } satisfies RisuHubResult))
        target = mountMainMenu()
        await flushHub()
        const offlineMarker = statusMarker(target)
        expect(offlineMarker).toContain(language.hubOffline)

        // failed
        hubMock.setImpl(() => ({ ok: false, reason: 'network' } satisfies RisuHubResult))
        target = mountMainMenu()
        await flushHub()
        const failedMarker = statusMarker(target)
        expect(failedMarker).toContain(language.hubLoadFailed)

        // empty
        hubMock.setImpl(() => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult))
        target = mountMainMenu()
        await flushHub()
        const emptyMarker = statusMarker(target)
        expect(emptyMarker).toContain(language.hubEmpty)

        // populated -- no role="status" region at all
        hubMock.setImpl(() => ({ ok: true, cards: [makeChara('populated-chara')], additionalHTML: '' } satisfies RisuHubResult))
        target = mountMainMenu()
        await flushHub()
        expect(statusMarker(target)).toBeNull()
        const rows = previewRowButtons(target).map((b) => b.textContent?.trim())
        expect(rows.some((t) => t?.includes('populated-chara'))).toBe(true)

        const markers = [consentMarker, pendingMarker, offlineMarker, failedMarker, emptyMarker]
        expect(markers.every((m) => typeof m === 'string' && m.length > 0)).toBe(true)
        expect(new Set(markers).size).toBe(markers.length)
    })

    test('the pending state exposes role="status" inside an aria-live region', () => {
        hubMock.setPending(() => new Promise(() => {}))
        const target = mountMainMenu()
        const status = target.querySelector('[role="status"]')
        expect(status).toBeTruthy()
        expect(status?.getAttribute('aria-live')).toBe('polite')
        expect(status?.textContent).toContain(language.loading)
    })

    test('Retry in the failed state re-invokes the loader and transitions out of failure', async () => {
        let call = 0
        hubMock.setImpl(() => {
            call += 1
            return call === 1
                ? ({ ok: false, reason: 'network' } satisfies RisuHubResult)
                : ({ ok: true, cards: [makeChara('recovered')], additionalHTML: '' } satisfies RisuHubResult)
        })
        const target = mountMainMenu()
        await flushHub()
        expect(statusMarker(target)).toContain(language.hubLoadFailed)

        const retryButton = previewRowButtons(target).find((b) => b.textContent?.trim() === language.hubRetry)
        expect(retryButton).toBeTruthy()
        retryButton!.click()
        await flushHub()

        expect(statusMarker(target)).toBeNull()
        const rows = previewRowButtons(target).map((b) => b.textContent?.trim())
        expect(rows.some((t) => t?.includes('recovered'))).toBe(true)
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(2)
    })

    test('the offline control is inert: aria-disabled but not disabled, and clicking it issues no request', async () => {
        hubMock.setImpl(() => ({ ok: false, reason: 'offline' } satisfies RisuHubResult))
        const target = mountMainMenu()
        await flushHub()

        const retryButton = previewRowButtons(target).find((b) => b.textContent?.trim() === language.hubRetry)
        expect(retryButton).toBeTruthy()
        expect(retryButton!.getAttribute('aria-disabled')).toBe('true')
        expect(retryButton!.hasAttribute('disabled')).toBe(false)

        const callsBefore = hubMock.getRisuHub.mock.calls.length
        retryButton!.click()
        flushSync()
        expect(hubMock.getRisuHub.mock.calls.length).toBe(callsBefore)
    })

    test('an online event leaves the offline state and reloads; the listener is removed on teardown', async () => {
        let call = 0
        hubMock.setImpl(() => {
            call += 1
            return call === 1
                ? ({ ok: false, reason: 'offline' } satisfies RisuHubResult)
                : ({ ok: true, cards: [makeChara('back-online')], additionalHTML: '' } satisfies RisuHubResult)
        })
        const { target, instance } = mountMainMenuWithInstance()
        await flushHub()
        expect(statusMarker(target)).toContain(language.hubOffline)

        window.dispatchEvent(new Event('online'))
        await flushHub()

        expect(statusMarker(target)).toBeNull()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(2)

        const removeSpy = vi.spyOn(window, 'removeEventListener')
        await unmount(instance as never)
        expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function))
        removeSpy.mockRestore()

        window.dispatchEvent(new Event('online'))
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(2)
    })

    test('realmDirectOpen true sets $RealmInitialOpenChar on a preview row click; false leaves it untouched', async () => {
        const chara = makeChara('direct-open-chara')
        hubMock.setImpl(() => ({ ok: true, cards: [chara], additionalHTML: '' } satisfies RisuHubResult))

        DBState.db.realmDirectOpen = true
        let target = mountMainMenu()
        await flushHub()
        let row = previewRowButtons(target).find((b) => b.textContent?.includes('direct-open-chara'))
        expect(row).toBeTruthy()
        row!.click()
        flushSync()
        expect(get(RealmInitialOpenChar)).toEqual(chara)
        expect(get(OpenRealmStore)).toBe(true)

        RealmInitialOpenChar.set(null)
        OpenRealmStore.set(false)
        DBState.db.realmDirectOpen = false

        target = mountMainMenu()
        await flushHub()
        row = previewRowButtons(target).find((b) => b.textContent?.includes('direct-open-chara'))
        expect(row).toBeTruthy()
        row!.click()
        flushSync()
        expect(get(RealmInitialOpenChar)).toBeNull()
        expect(get(OpenRealmStore)).toBe(true)
    })

    test('hideRealm true omits the realm card entirely and leaves four grid children', () => {
        DBState.db.hideRealm = true
        const target = mountMainMenu()
        flushSync()
        const grid = target.querySelector('.grid')
        expect(grid).toBeTruthy()
        expect(grid!.children.length).toBe(4)
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
    })

    test('the populated list clamps to ten rows even when more cards come back', async () => {
        // 15, not just past 10: this would still fail with the clamp removed
        // entirely (every card would render) as well as with the clamp
        // reverted to a smaller number, unlike a card count barely over the
        // bound under test.
        const cards = Array.from({ length: 15 }, (_, i) => makeChara(`clamp-chara-${i}`))
        hubMock.setImpl(() => ({ ok: true, cards, additionalHTML: '' } satisfies RisuHubResult))
        const target = mountMainMenu()
        await flushHub()
        const rows = previewRowButtons(target).filter((b) => b.textContent?.includes('clamp-chara-'))
        expect(rows.length).toBe(10)
    })

    test('the banner renders after the Related Links grid, is sanitized, and updates once the fetch resolves', async () => {
        hubMock.setImpl(() => ({
            ok: true,
            cards: [],
            additionalHTML: '<img src=x onerror="alert(1)"><p>banner text</p>',
        } satisfies RisuHubResult))
        const target = mountMainMenu()
        flushSync()
        // A naive relocation of the {@html} expression that keeps reading a
        // frozen binding would render nothing here, forever.
        expect(target.innerHTML).not.toContain('banner text')

        await flushHub()

        expect(target.innerHTML).not.toContain('onerror')
        expect(target.innerHTML).not.toContain('<img')
        expect(target.innerHTML).toContain('<p>banner text</p>')

        const grid = target.querySelector('.grid')
        expect(grid).toBeTruthy()
        // The innermost div wrapping just the sanitized output, not an
        // ancestor whose innerHTML happens to also contain the substring.
        const bannerHost = Array.from(target.querySelectorAll('div')).find(
            (d) => d.innerHTML.trim() === '<p>banner text</p>',
        )
        expect(bannerHost).toBeTruthy()
        // eslint-disable-next-line no-bitwise
        expect(Boolean(grid!.compareDocumentPosition(bannerHost!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    })

    test('reassigning DBState.db with hideRealm unchanged does not refetch; changing hideRealm does', async () => {
        hubMock.setImpl(() => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult))
        mountMainMenu()
        await flushHub()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)

        // Simulate a whole-object swap (backup restore, plugin setDatabase)
        // that leaves hideRealm at the same value.
        const swapped = { hideRealm: false, realmDirectOpen: false, hideAllImages: false }
        DBState.db = swapped as never
        flushSync()
        await flushHub()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)

        // hideRealm actually changing must still trigger a refetch.
        DBState.db.hideRealm = true
        flushSync()
        DBState.db.hideRealm = false
        flushSync()
        await flushHub()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(2)
    })

    test('two overlapping loads resolving out of order: the later one wins', async () => {
        const first = deferred<RisuHubResult>()
        const second = deferred<RisuHubResult>()
        let call = 0
        hubMock.setPending(() => {
            call += 1
            return call === 1 ? first.promise : second.promise
        })

        const target = mountMainMenu()
        flushSync()
        expect(call).toBe(1)

        // Trigger a second, independent load without touching internals: two
        // real effect runs via a public, persisted setting.
        DBState.db.hideRealm = true
        flushSync()
        DBState.db.hideRealm = false
        flushSync()
        expect(call).toBe(2)

        second.resolve({ ok: true, cards: [makeChara('second-load')], additionalHTML: '' })
        await flushHub()
        let rows = previewRowButtons(target).map((b) => b.textContent?.trim())
        expect(rows.some((t) => t?.includes('second-load'))).toBe(true)

        first.resolve({ ok: true, cards: [makeChara('first-load')], additionalHTML: '' })
        await flushHub()
        rows = previewRowButtons(target).map((b) => b.textContent?.trim())
        expect(rows.some((t) => t?.includes('first-load'))).toBe(false)
        expect(rows.some((t) => t?.includes('second-load'))).toBe(true)
    })

    test('a superseded load failing after a newer load succeeded: the populated list survives', async () => {
        const first = deferred<RisuHubResult>()
        const second = deferred<RisuHubResult>()
        let call = 0
        hubMock.setPending(() => {
            call += 1
            return call === 1 ? first.promise : second.promise
        })

        const target = mountMainMenu()
        flushSync()

        DBState.db.hideRealm = true
        flushSync()
        DBState.db.hideRealm = false
        flushSync()
        expect(call).toBe(2)

        second.resolve({ ok: true, cards: [makeChara('still-here')], additionalHTML: '' })
        await flushHub()
        expect(statusMarker(target)).toBeNull()

        // The older, superseded request now fails. An unguarded failure path
        // (or a guard applied only to the success path) would stomp the
        // populated list back to the failure state.
        first.resolve({ ok: false, reason: 'network' })
        await flushHub()

        expect(statusMarker(target)).toBeNull()
        const rows = previewRowButtons(target).map((b) => b.textContent?.trim())
        expect(rows.some((t) => t?.includes('still-here'))).toBe(true)
    })
})

describe('MainMenu.svelte realm card: hideRealm reaching the announcement banner and the online handler', () => {
    test('hideRealm true on a whole DBState.db swap hides the announcement banner, not just the card', async () => {
        hubMock.setImpl(() => ({ ok: true, cards: [], additionalHTML: '<p>banner text</p>' } satisfies RisuHubResult))
        const target = mountMainMenu()
        await flushHub()
        expect(target.innerHTML).toContain('banner text')

        // A whole-object swap, not a plain property set: this is the path
        // (backup restore, plugin setDatabase) that leaves the component
        // mounted with hubAnnouncement still populated from the
        // earlier fetch, which is exactly what let the banner escape the
        // hideRealm guard.
        DBState.db = { hideRealm: true, realmDirectOpen: false, hideAllImages: false } as never
        flushSync()

        expect(target.innerHTML).not.toContain('banner text')
    })

    test('the online handler does not fetch while the realm is hidden', async () => {
        hubMock.setImpl(() => ({ ok: false, reason: 'offline' } satisfies RisuHubResult))
        mountMainMenu()
        await flushHub()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)

        // Same whole-db-swap path as above: hubStatus stays 'offline' (the
        // swap itself issues no fetch, since realmHidden is now true), so a
        // later 'online' event is the only thing that could still fire a
        // request for this opted-out user.
        DBState.db = { hideRealm: true, realmDirectOpen: false, hideAllImages: false } as never
        flushSync()

        window.dispatchEvent(new Event('online'))
        await flushHub()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
    })
})

describe('MainMenu.svelte realm card: the delegated card click and the controls that must not trigger it', () => {
    test('clicking the card body (outside the preview list) opens RisuRealm', async () => {
        hubMock.setImpl(() => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult))
        const target = mountMainMenu()
        await flushHub()

        const statusRegion = target.querySelector('[role="status"]') as HTMLElement | null
        expect(statusRegion).toBeTruthy()
        statusRegion!.click()
        flushSync()

        expect(get(OpenRealmStore)).toBe(true)
    })

    test('clicking a preview row does not also trigger the delegated card handler', async () => {
        const chara = makeChara('row-target')
        hubMock.setImpl(() => ({ ok: true, cards: [chara], additionalHTML: '' } satisfies RisuHubResult))
        const target = mountMainMenu()
        await flushHub()

        // The row's own onClick already sets $OpenRealmStore = true, so a
        // redundant delegated-handler invocation on top of it would not
        // change the final value -- only the call count reveals whether the
        // delegated handler's closest() check actually bailed.
        const setSpy = vi.spyOn(OpenRealmStore, 'set')
        const row = previewRowButtons(target).find((b) => b.textContent?.includes('row-target'))
        expect(row).toBeTruthy()
        row!.click()
        flushSync()

        expect(setSpy).toHaveBeenCalledTimes(1)
        setSpy.mockRestore()
    })

    test('clicking the failed-state Retry control does not open RisuRealm', async () => {
        hubMock.setImpl(() => ({ ok: false, reason: 'network' } satisfies RisuHubResult))
        const target = mountMainMenu()
        await flushHub()

        const retryButton = previewRowButtons(target).find((b) => b.textContent?.trim() === language.hubRetry)
        expect(retryButton).toBeTruthy()
        retryButton!.click()
        flushSync()

        expect(get(OpenRealmStore)).toBe(false)
    })

    test('clicking the offline-state Retry control does not open RisuRealm', async () => {
        hubMock.setImpl(() => ({ ok: false, reason: 'offline' } satisfies RisuHubResult))
        const target = mountMainMenu()
        await flushHub()

        const retryButton = previewRowButtons(target).find((b) => b.textContent?.trim() === language.hubRetry)
        expect(retryButton).toBeTruthy()
        retryButton!.click()
        flushSync()

        expect(get(OpenRealmStore)).toBe(false)
    })

    test('the title button opens RisuRealm and carries an accessible name describing the browse action', async () => {
        hubMock.setImpl(() => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult))
        const target = mountMainMenu()
        await flushHub()

        const titleButton = Array.from(target.querySelectorAll('button')).find(
            (b) => b.textContent?.trim() === language.hub,
        )
        expect(titleButton).toBeTruthy()
        // Describes the action (Browse RisuRealm), not just the product name
        // (RisuRealm) the visible text already gives -- this button is the
        // only keyboard path into the card's browse action now that the
        // separate header button is gone.
        expect(titleButton!.getAttribute('aria-label')).toBe(language.hubBrowseMore)
        expect(titleButton!.getAttribute('aria-label')).not.toBe(language.hub)

        titleButton!.click()
        flushSync()
        expect(get(OpenRealmStore)).toBe(true)
    })
})
