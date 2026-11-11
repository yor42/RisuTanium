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
import { languageEnglish } from 'src/lang/en'

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
const sleepSpy = vi.hoisted(() => vi.fn((_ms: number): Promise<void> => new Promise(() => {})))

vi.mock(import('src/ts/util'), () => ({
    sleep: sleepSpy,
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
import { DBState, ShowRealmFrameStore, alertStore } from 'src/ts/stores.svelte'

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
function stubIframeContentWindow(target: HTMLElement): { postMessage: ReturnType<typeof vi.fn> } | null {
    const iframe = target.querySelector('iframe')
    if (!iframe) {
        return null
    }
    const stub = { postMessage: vi.fn() }
    Object.defineProperty(iframe, 'contentWindow', {
        configurable: true,
        value: stub,
    })
    return stub
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

describe('RealmFrame.svelte: only the Realm frame itself is heard and addressed', () => {
    const REALM_ORIGIN = 'https://realm.risuai.net'
    const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'

    type FrameStub = { postMessage: ReturnType<typeof vi.fn> }

    function acceptUpstream(): void {
        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()
    }

    async function settleLong() {
        for (let i = 0; i < 10; i++) {
            await Promise.resolve()
        }
        flushSync()
    }

    async function mountWithFrame(): Promise<FrameStub> {
        acceptUpstream()
        const target = mountRealmFrame()
        const stub = stubIframeContentWindow(target)
        if (!stub) {
            throw new Error('iframe missing')
        }
        await settleLong()
        return stub
    }

    function post(data: unknown, sender: { origin: string, source: unknown }): void {
        window.dispatchEvent(new MessageEvent('message', {
            data,
            origin: sender.origin,
            source: sender.source as Window,
        }))
        flushSync()
    }

    function deferredSleep(): () => void {
        let release = (): void => {}
        sleepSpy.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
        return () => release()
    }

    function characters(): { type: string, realmId: string }[] {
        return DBState.db.characters as unknown as { type: string, realmId: string }[]
    }

    beforeEach(() => {
        DBState.db.characters = [{ type: 'character', realmId: '' }] as unknown as typeof DBState.db.characters
    })

    test.each(['close', 'success'])('regression reproducer: a %s message from a foreign origin is ignored', async (type) => {
        const frame = await mountWithFrame()
        post({ type, id: 'abc123' }, { origin: 'https://evil.example', source: frame })
        await settleLong()

        expect(get(ShowRealmFrameStore)).toBe('character')
        expect(alertMdSpy).not.toHaveBeenCalled()
        expect(characters()[0].realmId).toBe('')
    })

    test.each(['close', 'success'])('regression reproducer: a %s message from the Realm origin but another source is ignored', async (type) => {
        const frame = await mountWithFrame()
        expect(frame).toBeTruthy()
        post({ type, id: 'abc123' }, { origin: REALM_ORIGIN, source: { postMessage: vi.fn() } })
        await settleLong()

        expect(get(ShowRealmFrameStore)).toBe('character')
        expect(alertMdSpy).not.toHaveBeenCalled()
        expect(characters()[0].realmId).toBe('')
    })

    test('regression reproducer: a pong from a foreign origin does not end the handshake', async () => {
        const release = deferredSleep()
        const frame = await mountWithFrame()
        expect(frame.postMessage).toHaveBeenCalledTimes(1)

        post({ type: 'pong' }, { origin: 'https://evil.example', source: frame })
        release()
        await settleLong()

        const sent = frame.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type)
        expect(sent).not.toContain('filedata')
        expect(sent.filter((t) => t === 'ping').length).toBeGreaterThan(1)
    })

    test('regression reproducer: the ping is addressed to the Realm origin, not any origin', async () => {
        const frame = await mountWithFrame()

        expect(frame.postMessage).toHaveBeenCalled()
        expect(frame.postMessage.mock.calls[0][0]).toEqual({ type: 'ping' })
        expect(frame.postMessage.mock.calls[0][1]).toBe(REALM_ORIGIN)
    })

    test('regression reproducer: the file data is addressed to the Realm origin with the transfer pair', async () => {
        const release = deferredSleep()
        const frame = await mountWithFrame()

        post({ type: 'pong' }, { origin: REALM_ORIGIN, source: frame })
        release()
        await settleLong()

        const fileCall = frame.postMessage.mock.calls.find((c) => (c[0] as { type: string }).type === 'filedata')
        expect(fileCall).toBeTruthy()
        const message = fileCall![0] as { type: string, buf: ArrayBuffer[] }
        expect(fileCall![1]).toBe(REALM_ORIGIN)
        expect(fileCall![2]).toEqual(message.buf)
        expect(fileCall![2]).toHaveLength(2)
    })

    test.each([
        ['a backtick', 'a`b'],
        ['a newline', 'a\nb'],
        ['a path', 'x/../y'],
        ['empty', ''],
        ['a number', 123],
        ['an object', {}],
    ])('regression reproducer: a success with an unsafe id (%s) is refused', async (_label, id) => {
        const frame = await mountWithFrame()
        post({ type: 'success', id }, { origin: REALM_ORIGIN, source: frame })
        await settleLong()

        expect(alertMdSpy).not.toHaveBeenCalled()
        expect(characters()[0].realmId).toBe('')
        expect(get(ShowRealmFrameStore)).toBe('character')
    })

    test('regression reproducer: a null data message from the Realm frame is dropped without throwing', async () => {
        const frame = await mountWithFrame()
        const onError = vi.fn()
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        window.addEventListener('error', onError)
        try {
            post(null, { origin: REALM_ORIGIN, source: frame })
            await settleLong()
            expect(onError).not.toHaveBeenCalled()
            expect(consoleError).not.toHaveBeenCalled()
        } finally {
            window.removeEventListener('error', onError)
            consoleError.mockRestore()
        }
    })

    test('guard: a close from the Realm frame closes it', async () => {
        const frame = await mountWithFrame()
        post({ type: 'close' }, { origin: REALM_ORIGIN, source: frame })
        await settleLong()

        expect(get(ShowRealmFrameStore)).toBe('')
    })

    test.each(['abc123', UUID])('guard: a success from the Realm frame with id %s shows the link, stores the id and closes', async (id) => {
        const frame = await mountWithFrame()
        post({ type: 'success', id }, { origin: REALM_ORIGIN, source: frame })
        await settleLong()

        expect(alertMdSpy).toHaveBeenCalledTimes(1)
        expect(alertMdSpy.mock.calls[0][0]).toContain('https://realm.risuai.net/character/' + id)
        expect(characters()[0].realmId).toBe(id)
        expect(get(ShowRealmFrameStore)).toBe('')
    })

    test('guard: a successful file data message from the Realm frame reveals the iframe', async () => {
        const frame = await mountWithFrame()
        const target = document.body
        expect(target.querySelector('.loadmove')).toBeTruthy()
        post({ type: 'filedata', success: true }, { origin: REALM_ORIGIN, source: frame })
        await settleLong()

        expect(target.querySelector('.loadmove')).toBeNull()
        expect(target.querySelector('iframe')?.classList.contains('hidden')).toBe(false)
    })
})

describe('RealmFrame.svelte: an unanswered handshake is bounded and stops with the frame', () => {
    const REALM_ORIGIN = 'https://realm.risuai.net'
    const PING_ATTEMPTS = 50

    type FrameStub = { postMessage: ReturnType<typeof vi.fn> }

    function acceptUpstream(): void {
        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()
    }

    // One macrotask drains every immediately-resolved sleep in the wait loop.
    async function drain(): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        flushSync()
    }

    // The first `resolved` sleeps return at once; later ones never return, so an
    // unbounded loop parks instead of spinning.
    function cappedSleep(resolved: number, onCall?: (call: number) => void): void {
        let calls = 0
        sleepSpy.mockImplementation(() => {
            calls++
            onCall?.(calls)
            return calls <= resolved ? Promise.resolve() : new Promise<void>(() => {})
        })
    }

    function mountWithStub(): FrameStub {
        acceptUpstream()
        const target = mountRealmFrame()
        const stub = stubIframeContentWindow(target)
        if (!stub) {
            throw new Error('iframe missing')
        }
        return stub
    }

    function sentTypes(frame: FrameStub): string[] {
        return frame.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type)
    }

    async function captureRejections(run: () => Promise<void>): Promise<unknown[]> {
        const seen: unknown[] = []
        const handler = (reason: unknown): void => { seen.push(reason) }
        process.on('unhandledRejection', handler)
        try {
            await run()
            await drain()
        } finally {
            process.off('unhandledRejection', handler)
        }
        return seen
    }

    afterEach(() => {
        sleepSpy.mockImplementation(() => new Promise<void>(() => {}))
    })

    test('regression reproducer: with no answer it pings 50 times, 300 ms apart, then alerts, closes and posts no file', async () => {
        cappedSleep(60)
        const frame = mountWithStub()
        await drain()

        expect(sentTypes(frame).filter((t) => t === 'ping')).toHaveLength(PING_ATTEMPTS)
        expect(sleepSpy).toHaveBeenCalledTimes(PING_ATTEMPTS)
        expect(sleepSpy.mock.calls.every((c) => c[0] === 300)).toBe(true)
        const message = languageEnglish.errors.realmUploadNoAnswer
        expect(typeof message).toBe('string')
        expect(message.length).toBeGreaterThan(0)
        expect(alertErrorSpy).toHaveBeenCalledTimes(1)
        expect(alertErrorSpy).toHaveBeenCalledWith(message)
        expect(get(ShowRealmFrameStore)).toBe('')
        expect(sentTypes(frame)).not.toContain('filedata')

        await drain()
        expect(sentTypes(frame).filter((t) => t === 'ping')).toHaveLength(PING_ATTEMPTS)
        expect(alertErrorSpy).toHaveBeenCalledTimes(1)
    })

    test('regression reproducer: destroying the frame during the first wait sends nothing more and throws nothing', async () => {
        let release = (): void => {}
        sleepSpy.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
        const frame = mountWithStub()
        await drain()
        expect(sentTypes(frame)).toEqual(['ping'])

        const rejections = await captureRejections(async () => {
            await unmount(mountedInstances.pop() as never)
            release()
            await drain()
        })

        expect(rejections).toEqual([])
        expect(sentTypes(frame)).toEqual(['ping'])
        expect(alertErrorSpy).not.toHaveBeenCalled()
    })

    test('regression reproducer: destroying the frame during the last allowed wait raises no alert and throws nothing', async () => {
        let release = (): void => {}
        let calls = 0
        sleepSpy.mockImplementation(() => {
            calls++
            if (calls < PING_ATTEMPTS) {
                return Promise.resolve()
            }
            if (calls === PING_ATTEMPTS) {
                return new Promise<void>((resolve) => { release = resolve })
            }
            return new Promise<void>(() => {})
        })
        const frame = mountWithStub()
        await drain()
        expect(sentTypes(frame).filter((t) => t === 'ping')).toHaveLength(PING_ATTEMPTS)

        const rejections = await captureRejections(async () => {
            await unmount(mountedInstances.pop() as never)
            release()
            await drain()
        })

        expect(rejections).toEqual([])
        expect(sentTypes(frame).filter((t) => t === 'ping')).toHaveLength(PING_ATTEMPTS)
        expect(alertErrorSpy).not.toHaveBeenCalled()
        expect(sentTypes(frame)).not.toContain('filedata')
    })

    test('guard: a pong during the last allowed wait still sends the file once, with no alert', async () => {
        let frame: FrameStub | null = null
        cappedSleep(60, (call) => {
            if (call === PING_ATTEMPTS) {
                window.dispatchEvent(new MessageEvent('message', {
                    data: { type: 'pong' },
                    origin: REALM_ORIGIN,
                    source: frame as unknown as Window,
                }))
            }
        })
        frame = mountWithStub()
        await drain()

        expect(sentTypes(frame).filter((t) => t === 'ping')).toHaveLength(PING_ATTEMPTS)
        expect(sentTypes(frame).filter((t) => t === 'filedata')).toHaveLength(1)
        expect(alertErrorSpy).not.toHaveBeenCalled()
        expect(get(ShowRealmFrameStore)).toBe('character')
    })
})
