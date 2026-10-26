// @vitest-environment happy-dom

/**
 * Coverage for `RealmFrame.svelte`'s upstream-agreement gate (T-C9): the
 * upload iframe must never start loading, and no card/preset/module export
 * must run, before the user has accepted upstream's terms. Once accepted,
 * the existing upload flow (iframe render, export, postMessage handshake)
 * is unchanged.
 *
 * `src/ts/alert`, `src/ts/realm`, `src/ts/storage/database.svelte` and
 * `src/ts/realmUploadUrl` are mocked so no real export, encoding or network
 * work runs; `src/ts/util`'s `sleep` is mocked so the ping-wait loop never
 * actually waits. `src/ts/stores.svelte` is mocked for a controllable
 * `ShowRealmFrameStore` and a real `alertStore`, per the agreement module's
 * own import (`src/ts/upstreamAgreement.ts` never imports `alert.ts`).
 * `src/ts/upstreamAgreement` itself is never mocked: acceptance is seeded
 * through its own key and test reset.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

//#region module mocks

const shareRealmCardDataSpy = vi.hoisted(() => vi.fn(async () => ({
    name: new ArrayBuffer(1),
    data: new ArrayBuffer(1),
})))
const downloadPresetSpy = vi.hoisted(() => vi.fn(async () => ({
    buf: new Uint8Array(),
    data: { name: 'preset' } as unknown as Record<string, unknown>,
})))
const alertMdSpy = vi.hoisted(() => vi.fn())
const alertErrorSpy = vi.hoisted(() => vi.fn())
const getRealmUploadUrlSpy = vi.hoisted(() => vi.fn(() => 'https://realm.risuai.net/upload'))

vi.mock(import('src/ts/alert'), () => ({
    alertMd: alertMdSpy,
    alertError: alertErrorSpy,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/realm'), () => ({
    shareRealmCardData: shareRealmCardDataSpy,
}) as unknown as typeof import('src/ts/realm'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    downloadPreset: downloadPresetSpy,
}) as unknown as typeof import('src/ts/storage/database.svelte'))

const realmModuleJsonSpy = vi.hoisted(() => vi.fn(async (_index: number): Promise<{ json: string, name: string } | null> => null))

vi.mock(import('src/ts/process/moduleUse'), () => ({
    realmModuleJson: realmModuleJsonSpy,
}) as unknown as typeof import('src/ts/process/moduleUse'))

vi.mock(import('src/ts/realmUploadUrl'), () => ({
    getRealmUploadUrl: getRealmUploadUrlSpy,
}) as unknown as typeof import('src/ts/realmUploadUrl'))

// Never resolves: the real ping/pong handshake this backs (`waitPing` in
// RealmFrame.svelte) has no partner in this test, so a resolving mock would
// spin the wait loop forever instead of leaving it parked after one attempt.
vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(() => new Promise(() => {})),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { characters: [] } as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ShowRealmFrameStore: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import RealmFrame from './RealmFrame.svelte'
import { ShowRealmFrameStore, alertStore } from 'src/ts/stores.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountRealmFrame() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(RealmFrame, { target, props: {} })
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

// Records every element ever added anywhere under `document.body` for as
// long as it runs, so an iframe that renders and is then removed within the
// same mount is still caught -- a check of the final DOM alone would miss
// it, and so would a check of only `addedNodes`' current contents: a node
// added and later removed within the same synchronous flush is delivered as
// one mutation whose `addedNodes` holds a container the iframe already sat
// inside, and a second mutation whose `removedNodes` takes that same iframe
// back out before this observer's callback ever gets to look -- by then, a
// live traversal of the added container finds nothing. `removedNodes`
// carries the detached iframe itself, which nothing mutates further once
// removed, so it stays a reliable record of what was there for a moment. A `Set`
// keyed by node identity, not a running count: the same iframe can surface
// from more than one mutation record (its own container being added, then
// the iframe itself being added or removed inside it) without a second
// iframe ever having existed.
function observeIframeInsertions(): { stop(): Element[] } {
    const seen = new Set<Element>()
    function collect(nodeList: NodeList): void {
        for (const node of Array.from(nodeList)) {
            if (!(node instanceof Element)) {
                continue
            }
            if (node.tagName === 'IFRAME') {
                seen.add(node)
            }
            for (const iframe of Array.from(node.querySelectorAll('iframe'))) {
                seen.add(iframe)
            }
        }
    }
    function record(records: MutationRecord[]): void {
        for (const mutation of records) {
            collect(mutation.addedNodes)
            collect(mutation.removedNodes)
        }
    }
    const observer = new MutationObserver(record)
    observer.observe(document.body, { childList: true, subtree: true })
    return {
        stop(): Element[] {
            record(observer.takeRecords())
            observer.disconnect()
            return Array.from(seen)
        },
    }
}

// With page loading disabled, a rendered iframe never gets a real
// `contentWindow`, so the component's own ping loop (waiting for a partner
// that never answers in this suite) would reject on its very first message
// post. Called right after a mount that rendered an iframe, before anything
// awaits further, so that loop finds a harmless stand-in instead.
function stubIframeContentWindow(target: HTMLElement): void {
    const iframe = target.querySelector('iframe')
    if (!iframe) {
        return
    }
    Object.defineProperty(iframe, 'contentWindow', {
        configurable: true,
        value: { postMessage: vi.fn() },
    })
}

beforeEach(() => {
    // A real Window's `disableIframePageLoading` setting: without it, an
    // accepted mount's <iframe> would try to actually navigate.
    ;(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    ShowRealmFrameStore.set('character')
})

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    ShowRealmFrameStore.set('')
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    vi.clearAllMocks()
})

describe('RealmFrame.svelte: the upload iframe never starts before acceptance', () => {
    test('without acceptance, no iframe renders, no export runs, and the store is reset', async () => {
        const watcher = observeIframeInsertions()
        const target = mountRealmFrame()
        stubIframeContentWindow(target)
        await settle()
        const everInserted = watcher.stop()

        expect(everInserted.length).toBe(0)
        expect(target.querySelector('iframe')).toBeNull()
        expect(shareRealmCardDataSpy).not.toHaveBeenCalled()
        expect(downloadPresetSpy).not.toHaveBeenCalled()
        expect(get(ShowRealmFrameStore)).toBe('')
    })

    test('with acceptance, the iframe renders and the export runs', async () => {
        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()

        const target = mountRealmFrame()
        stubIframeContentWindow(target)
        await settle()

        const iframe = target.querySelector('iframe')
        expect(iframe).toBeTruthy()
        expect(iframe?.getAttribute('src')).toBe('https://realm.risuai.net/upload')
        expect(shareRealmCardDataSpy).toHaveBeenCalledTimes(1)
    })
})

describe('RealmFrame.svelte: a failed card export never reaches the upload iframe', () => {
    function acceptUpstream(): void {
        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()
    }

    test('when the share returns null, nothing is posted, the frame closes and the alert stays', async () => {
        acceptUpstream()
        const failure = { type: 'error', msg: 'synthetic export failure' } as const
        alertStore.set(failure)
        shareRealmCardDataSpy.mockResolvedValueOnce(null as never)

        const target = mountRealmFrame()
        const postMessage = vi.fn()
        const iframe = target.querySelector('iframe')
        Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage } })
        await settle()

        expect(shareRealmCardDataSpy).toHaveBeenCalledTimes(1)
        expect(postMessage).not.toHaveBeenCalled()
        expect(get(ShowRealmFrameStore)).toBe('')
        expect(get(alertStore)).toEqual(failure)
    })

    test('when a module payload is null, nothing is posted, no card share runs and the frame closes', async () => {
        acceptUpstream()
        ShowRealmFrameStore.set('module:0')
        realmModuleJsonSpy.mockResolvedValueOnce(null)

        const target = mountRealmFrame()
        const postMessage = vi.fn()
        const iframe = target.querySelector('iframe')
        Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage } })
        await settle()

        expect(realmModuleJsonSpy).toHaveBeenCalledWith(0)
        expect(shareRealmCardDataSpy).not.toHaveBeenCalled()
        expect(postMessage).not.toHaveBeenCalled()
        expect(get(ShowRealmFrameStore)).toBe('')
    })

    test('when the share rejects, the error is shown, nothing is posted and the frame closes', async () => {
        acceptUpstream()
        const failure = new Error('synthetic image read failure')
        shareRealmCardDataSpy.mockRejectedValueOnce(failure)

        const target = mountRealmFrame()
        const postMessage = vi.fn()
        const iframe = target.querySelector('iframe')
        Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage } })
        await settle()

        expect(alertErrorSpy).toHaveBeenCalledWith(failure)
        expect(postMessage).not.toHaveBeenCalled()
        expect(get(ShowRealmFrameStore)).toBe('')
    })
})
