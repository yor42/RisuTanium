// @vitest-environment jsdom

/**
 * Component-level coverage for `RealmMain.svelte`'s Stage 2 adaptation to
 * the discriminated `RisuHubResult` contract (`src/ts/characterCards.ts`;
 * see `Agents/Live-State.md`). `RealmMain.hubHtmlSink.svelte.test.ts`
 * already covers the sanitizer wiring for a single fetch; this file covers
 * two things that test does not:
 *
 * - the banner keeps updating on every subsequent `getHub()` call, not just
 *   the one at mount -- guarding the frozen-at-mount bug this stage fixes
 *   more broadly than "it works once";
 * - the generation guard, which matters more here than on the home card's
 *   single Retry because `getHub()` has roughly eight independent call
 *   sites (search, sort, paging, NSFW). Two of those call sites (the
 *   initial mount and a sort-button click) are used below to produce two
 *   real, independently-timed loads.
 *
 * `src/ts/characterCards` is mocked so `getRisuHub`'s resolved
 * `RisuHubResult` can be driven and sequenced per test, and so no network
 * fetch ever fires. The real grid cards exercise the click path and the
 * popup is stubbed so an attempt to mount it can be observed directly.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { RisuHubResult, hubType } from 'src/ts/characterCards'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests, upstreamAccepted } from 'src/ts/upstreamAgreement'

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
    downloadRisuHub: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/alert'), () => ({
    alertInput: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    // See RealmMain.hubHtmlSink.svelte.test.ts for why selIdState /
    // selectedCharID are supplied even though this file's tests don't read
    // them: RealmMain's real `src/ts/hubHtml.ts` import graph reaches
    // `src/ts/parser/parser.svelte.ts`, which touches them at module load.
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        MobileGUI: writable(false),
        RealmInitialOpenChar: writable(null),
        OpenRealmStore: writable(true),
        // `src/ts/upstreamAgreement.ts` reads and writes this store directly,
        // never through `src/ts/alert.ts` -- a mock lacking it leaves the
        // agreement helper writing to `undefined`.
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// The popup's real markup is covered by RealmPopUp.parts.svelte.test.ts.
const popupMock = vi.hoisted(() => vi.fn(() => ({ destroy: () => {} })))
vi.mock('./RealmPopUp.svelte', () => ({ default: popupMock }))

//#endregion

import RealmMain from './RealmMain.svelte'
import { RealmInitialOpenChar } from 'src/ts/stores.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountRealmMain({ initialList, getInitialList = () => initialList ?? null }: {
    initialList?: Promise<RisuHubResult>,
    getInitialList?: () => Promise<RisuHubResult> | null,
} = {}) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(RealmMain, { target, props: { getInitialList } })
    mountedInstances.push(instance)
    flushSync()
    return target
}

// Waits out getHub()'s `await getRisuHub(...)` plus its follow-on state
// writes, then forces a DOM flush.
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

function bannerText(target: HTMLElement): string {
    // The sink div is the one whose entire innerHTML is the sanitized
    // announcement -- see RealmMain.hubHtmlSink.svelte.test.ts.
    const host = Array.from(target.querySelectorAll('div')).find((d) => /^<p>.*<\/p>$/.test(d.innerHTML.trim()))
    return host?.textContent?.trim() ?? ''
}

// Choosing "Trending" in the sort select is a second, independent
// `getHub()` call site distinct from the one that fires at mount -- one of
// the roughly eight named in the file header.
function clickTrending(target: HTMLElement) {
    const select = target.querySelector('select')
    expect(select).toBeTruthy()
    expect(Array.from(select!.options).some((o) => o.textContent?.trim() === language.trending)).toBe(true)
    select!.value = 'trending'
    select!.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
        resolve = res
    })
    return { promise, resolve }
}

// This suite's own assertions are about banner reactivity and the
// generation guard, not the agreement gate, so acceptance is seeded through
// the module for every case.
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
    hubMock.setImpl(async () => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult))
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    vi.clearAllMocks()
})

describe('RealmMain.svelte: shared Realm request context', () => {
    test('a cached list cannot revive a withdrawn agreement on mount', async () => {
        const keepStore = upstreamAccepted.subscribe(() => {})
        try {
            localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
            expect(get(upstreamAccepted)).toBe(true)
            const target = mountRealmMain({ initialList: Promise.resolve({
                ok: true, cards: [makeChara('cached')], additionalHTML: '<p>cached banner</p>', blockedCreatorsKey: '[]',
            }) })
            await flushHub()

            expect(get(upstreamAccepted)).toBe(false)
            expect(target.querySelector('[data-testid="upstream-consent-placeholder"]')).not.toBeNull()
            expect(bannerText(target)).toBe('')
            expect(hubMock.getRisuHub).not.toHaveBeenCalled()
        } finally {
            keepStore()
        }
    })

    test('a visible grid card cannot open after the saved agreement is cleared', async () => {
        hubMock.setImpl(() => ({ ok: true, cards: [makeChara('grid card')], additionalHTML: '' }))
        const target = mountRealmMain()
        await flushHub()
        const card = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.includes('grid card'))
        expect(card).toBeTruthy()

        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        card!.click()
        await flushHub()

        expect(popupMock).not.toHaveBeenCalled()
        expect(target.querySelector('[data-testid="upstream-consent-placeholder"]')).not.toBeNull()
    })

    test('a direct-open handoff cannot open after the saved agreement is cleared', async () => {
        const target = mountRealmMain()
        await flushHub()
        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        RealmInitialOpenChar.set(makeChara('direct card'))
        await flushHub()

        expect(get(RealmInitialOpenChar)).toBeNull()
        expect(popupMock).not.toHaveBeenCalled()
        expect(target.querySelector('[data-testid="upstream-consent-placeholder"]')).not.toBeNull()
    })

    test('a cached response cannot render after agreement is withdrawn during the wait', async () => {
        const shared = deferred<RisuHubResult>()
        const target = mountRealmMain({ initialList: shared.promise })
        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        shared.resolve({ ok: true, cards: [makeChara('late')], additionalHTML: '<p>late banner</p>', blockedCreatorsKey: '[]' })
        await flushHub()

        expect(target.querySelector('[data-testid="upstream-consent-placeholder"]')).not.toBeNull()
        expect(bannerText(target)).toBe('')
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
    })

    test('an in-flight preview must still be valid when it resolves', async () => {
        const shared = deferred<RisuHubResult>()
        let initial: Promise<RisuHubResult> | null = shared.promise
        const target = mountRealmMain({ getInitialList: () => initial })
        initial = null
        shared.resolve({ ok: true, cards: [makeChara('expired')], additionalHTML: '<p>expired banner</p>', blockedCreatorsKey: '[]' })
        await flushHub()

        expect(hubMock.getRisuHub).toHaveBeenCalledExactlyOnceWith({ search: '', page: 0, nsfw: false, sort: 'recommended' })
        expect(bannerText(target)).toBe('')
    })

    test('a shared response for a different block list triggers a fresh load', async () => {
        const shared = deferred<RisuHubResult>()
        const target = mountRealmMain({ initialList: shared.promise })
        shared.resolve({ ok: true, cards: [makeChara('mismatch')], additionalHTML: '<p>mismatch banner</p>', blockedCreatorsKey: '["previous"]' })
        await flushHub()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(bannerText(target)).toBe('')
    })

    test('fallback ignores an unsubmitted search draft, which Search still submits', async () => {
        const shared = deferred<RisuHubResult>()
        const target = mountRealmMain({ initialList: shared.promise })
        const input = target.querySelector<HTMLInputElement>('input')!
        input.value = 'unsubmitted draft'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        shared.resolve({ ok: false, reason: 'network' })
        await flushHub()
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(hubMock.getRisuHub).toHaveBeenLastCalledWith({ search: '', page: 0, nsfw: false, sort: 'recommended' })

        target.querySelector<HTMLButtonElement>(`[aria-label="${language.search}"]`)!.click()
        await flushHub()
        expect(hubMock.getRisuHub).toHaveBeenLastCalledWith({ search: 'unsubmitted draft', page: 0, nsfw: false, sort: '' })
    })

    test('accepting with Trending selected loads Trending instead of a cached recommended list', async () => {
        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        resetUpstreamAgreementForTests()
        const target = mountRealmMain({ initialList: Promise.resolve({
            ok: true, cards: [makeChara('recommended')], additionalHTML: '<p>recommended banner</p>', blockedCreatorsKey: '[]',
        }) })
        clickTrending(target)
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()
        await flushHub()

        expect(hubMock.getRisuHub).toHaveBeenCalledExactlyOnceWith({ search: '', page: 0, nsfw: false, sort: 'trending' })
        expect(bannerText(target)).toBe('')
    })
})

describe('RealmMain.svelte: banner reactivity and the generation guard', () => {
    test('the banner updates on a second getHub() call, not just the one at mount', async () => {
        hubMock.setImpl(() => ({ ok: true, cards: [], additionalHTML: '<p>first banner</p>' } satisfies RisuHubResult))
        const target = mountRealmMain()
        await flushHub()
        expect(bannerText(target)).toBe('first banner')

        hubMock.setImpl(() => ({ ok: true, cards: [], additionalHTML: '<p>second banner</p>' } satisfies RisuHubResult))
        clickTrending(target)
        await flushHub()

        expect(bannerText(target)).toBe('second banner')
    })

    test('two overlapping loads resolving out of order: the later one wins', async () => {
        const mountLoad = deferred<RisuHubResult>()
        const trendingLoad = deferred<RisuHubResult>()
        let call = 0
        hubMock.setPending(() => {
            call += 1
            return call === 1 ? mountLoad.promise : trendingLoad.promise
        })

        const target = mountRealmMain()
        expect(call).toBe(1)

        clickTrending(target)
        expect(call).toBe(2)

        // The later call (sort click) resolves first.
        trendingLoad.resolve({ ok: true, cards: [makeChara('trending-chara')], additionalHTML: '<p>trending banner</p>' })
        await flushHub()
        expect(statusMarker(target)).toBeNull()
        expect(bannerText(target)).toBe('trending banner')

        // The stale mount-time call resolves after it, and must not undo it.
        mountLoad.resolve({ ok: true, cards: [], additionalHTML: '<p>stale banner</p>' })
        await flushHub()

        expect(statusMarker(target)).toBeNull()
        expect(bannerText(target)).toBe('trending banner')
    })

    test('a superseded load failing after a newer load succeeded: the populated card survives', async () => {
        const mountLoad = deferred<RisuHubResult>()
        const trendingLoad = deferred<RisuHubResult>()
        let call = 0
        hubMock.setPending(() => {
            call += 1
            return call === 1 ? mountLoad.promise : trendingLoad.promise
        })

        const target = mountRealmMain()
        clickTrending(target)
        expect(call).toBe(2)

        trendingLoad.resolve({ ok: true, cards: [makeChara('still-here')], additionalHTML: '' })
        await flushHub()
        expect(statusMarker(target)).toBeNull()

        // The older, superseded mount-time request now fails late. An
        // unguarded failure path (or a guard applied only to the success
        // path) would stomp the populated card back to the failure state.
        mountLoad.resolve({ ok: false, reason: 'network' })
        await flushHub()

        expect(statusMarker(target)).toBeNull()
    })

    test('reuses a populated initialList without calling getRisuHub again', async () => {
        const shared = deferred<RisuHubResult>()
        const target = mountRealmMain({ initialList: shared.promise })
        expect(hubMock.getRisuHub).not.toHaveBeenCalled()

        shared.resolve({ ok: true, cards: [makeChara('from-preview')], additionalHTML: '<p>shared banner</p>', blockedCreatorsKey: '[]' })
        await flushHub()

        expect(hubMock.getRisuHub).not.toHaveBeenCalled()
        expect(statusMarker(target)).toBeNull()
        expect(bannerText(target)).toBe('shared banner')
    })

    test('falls back to getRisuHub when initialList resolves empty or failed', async () => {
        hubMock.setImpl(() => ({ ok: true, cards: [makeChara('retried')], additionalHTML: '<p>retry banner</p>' } satisfies RisuHubResult))
        const target = mountRealmMain({
            initialList: Promise.resolve({ ok: false, reason: 'network' } satisfies RisuHubResult),
        })
        await flushHub()

        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)
        expect(statusMarker(target)).toBeNull()
        expect(bannerText(target)).toBe('retry banner')
    })

    test('drops a superseded initialList when the user changes sort before it resolves', async () => {
        const shared = deferred<RisuHubResult>()
        const trendingLoad = deferred<RisuHubResult>()
        hubMock.setPending(() => trendingLoad.promise)

        const target = mountRealmMain({ initialList: shared.promise })
        clickTrending(target)
        expect(hubMock.getRisuHub).toHaveBeenCalledTimes(1)

        trendingLoad.resolve({ ok: true, cards: [makeChara('trending')], additionalHTML: '<p>trending</p>' })
        await flushHub()
        expect(bannerText(target)).toBe('trending')

        shared.resolve({ ok: true, cards: [makeChara('stale')], additionalHTML: '<p>stale</p>' })
        await flushHub()
        expect(bannerText(target)).toBe('trending')
    })
})
