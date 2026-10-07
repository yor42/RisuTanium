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
 * fetch ever fires. `src/ts/alert` is mocked following the sink test's own
 * precedent. `./RealmHubIcon.svelte` and `./RealmPopUp.svelte` are stubbed
 * to trivial components, also following that precedent: this file is not
 * about the populated grid's own markup, only about which result the card
 * ends up reflecting.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
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
        // `src/ts/upstreamAgreement.ts` reads and writes this store directly,
        // never through `src/ts/alert.ts` -- a mock lacking it leaves the
        // agreement helper writing to `undefined`.
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// Stubbed out entirely, following the sink test's precedent -- neither is
// itself under test here.
vi.mock('./RealmHubIcon.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./RealmPopUp.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import RealmMain from './RealmMain.svelte'

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

// Clicking "Trending" (desktop, non-mobile sort row) is a second,
// independent `getHub()` call site distinct from the one that fires at
// mount -- one of the roughly eight named in the file header.
function clickTrending(target: HTMLElement) {
    const button = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.trending)
    expect(button).toBeTruthy()
    button!.click()
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
})
