// @vitest-environment jsdom

/**
 * The loader of deferred chat images: the images of one scan, the app-wide queue behind them, and what ends a read.
 * Reads are driven by hand: the fake observer reports an image only when a test says so, and `load` or `error` is
 * dispatched by the test. The sizes come from the real size cache through a mocked stat, like production.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const transport = vi.hoisted(() => ({ android: true, sizes: {} as Record<string, number> }))

vi.mock('../../ts/storage/tauriByteTransport', () => ({
    isAndroidTransport: () => transport.android,
    statStoredSize: async (key: string) => transport.sizes[key] ?? 0,
}))

import {
    DEFERRED_IMAGE_PLACEHOLDER_SRC, DEFERRED_IMAGE_SRC_ATTRIBUTE, androidAssetSizeVerdict, rememberWholeReadUrl, resetAssetUrlGateForTest,
} from '../../ts/storage/assetUrlGate'
import { createDeferredImageLoader, resetDeferredImagesForTest } from './deferredAssetImages'

const MIB = 1024 * 1024
const URL_OF = (key: string) => 'http://asset.localhost/' + key

class FakeObserver {
    static instances: FakeObserver[] = []
    observed = new Set<Element>()
    disconnected = 0
    constructor(public callback: IntersectionObserverCallback, public init: Record<string, unknown>) {
        FakeObserver.instances.push(this)
    }
    observe(element: Element) { this.observed.add(element) }
    unobserve(element: Element) { this.observed.delete(element) }
    disconnect() { this.disconnected++; this.observed.clear() }
    /** Reports `element` as inside the margin. */
    fire(element: Element) {
        this.callback([{ target: element, isIntersecting: true }] as never, this as never)
    }
}
Object.defineProperty(FakeObserver.prototype, 'scrollMargin', { get: () => '' })

async function settleMicrotasks() {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve()
    }
}

/** A deferred image of a stored size of `mib` MiB, as the sanitizer's hook leaves it. */
async function deferredImage(key: string, mib: number): Promise<HTMLImageElement> {
    transport.sizes[key] = mib * MIB
    await androidAssetSizeVerdict(key)
    rememberWholeReadUrl(URL_OF(key), key)
    const img = document.createElement('img')
    img.setAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE, URL_OF(key))
    img.setAttribute('src', DEFERRED_IMAGE_PLACEHOLDER_SRC)
    img.setAttribute('loading', 'lazy')
    document.body.appendChild(img)
    return img
}

const isReal = (img: HTMLImageElement, key: string) => img.getAttribute('src') === URL_OF(key) && !img.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
const isDeferred = (img: HTMLImageElement) => img.getAttribute('src') === DEFERRED_IMAGE_PLACEHOLDER_SRC && img.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)

/** Reports `img` to the only live observer and lets the queue answer. */
async function reach(img: HTMLImageElement) {
    FakeObserver.instances[FakeObserver.instances.length - 1].fire(img)
    await settleMicrotasks()
}

beforeEach(() => {
    transport.android = true
    transport.sizes = {}
    FakeObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    resetAssetUrlGateForTest()
    resetDeferredImagesForTest()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
})

describe('what ends a read', () => {
    test('a granted image gets its real source at once and loads eagerly; the next waits for its load', async () => {
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        const b = await deferredImage('b', 60)
        loader.scan(document.body)

        await reach(a)
        await reach(b)
        expect(isReal(a, 'a')).toBe(true)
        expect(a.getAttribute('loading')).toBe('eager')
        expect(isDeferred(b)).toBe(true)

        a.dispatchEvent(new Event('load'))
        await settleMicrotasks()
        expect(isReal(b, 'b')).toBe(true)
    })

    test('an error ends the read like a load', async () => {
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        const b = await deferredImage('b', 60)
        loader.scan(document.body)
        await reach(a)
        await reach(b)

        a.dispatchEvent(new Event('error'))
        await settleMicrotasks()
        expect(isReal(b, 'b')).toBe(true)
    })

    test('the placeholder\'s own load does not end a read', async () => {
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        const b = await deferredImage('b', 60)
        loader.scan(document.body)
        await reach(a)
        await reach(b)

        a.setAttribute('src', DEFERRED_IMAGE_PLACEHOLDER_SRC)
        a.dispatchEvent(new Event('load'))
        await settleMicrotasks()
        expect(isDeferred(b)).toBe(true)
    })

    test('an image removed before its grant gets nothing and gives its slot back', async () => {
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        const b = await deferredImage('b', 60)
        const c = await deferredImage('c', 60)
        loader.scan(document.body)
        await reach(a)
        await reach(b)
        await reach(c)

        b.remove()
        a.dispatchEvent(new Event('load'))
        await settleMicrotasks()
        expect(isDeferred(b)).toBe(true)
        expect(isReal(c, 'c')).toBe(true)
    })

    test('a read that never ends gives its slot back after 30 seconds', async () => {
        vi.useFakeTimers()
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        const b = await deferredImage('b', 60)
        loader.scan(document.body)
        await reach(a)
        await reach(b)
        expect(isDeferred(b)).toBe(true)

        await vi.advanceTimersByTimeAsync(29_999)
        expect(isDeferred(b)).toBe(true)
        await vi.advanceTimersByTimeAsync(1)
        expect(isReal(b, 'b')).toBe(true)
    })

    test('a load after the timer released the slot changes nothing', async () => {
        vi.useFakeTimers()
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        const b = await deferredImage('b', 60)
        const c = await deferredImage('c', 60)
        loader.scan(document.body)
        await reach(a)
        await reach(b)
        await reach(c)
        await vi.advanceTimersByTimeAsync(30_000)
        expect(isReal(b, 'b')).toBe(true)
        expect(isDeferred(c)).toBe(true)

        a.dispatchEvent(new Event('load'))
        await settleMicrotasks()
        expect(isDeferred(c)).toBe(true)
    })

    test('dispose stops observing', async () => {
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        loader.scan(document.body)
        const observer = FakeObserver.instances[0]
        expect(observer.observed.has(a)).toBe(true)

        loader.dispose()
        expect(observer.disconnected).toBeGreaterThan(0)
        expect(observer.observed.size).toBe(0)
    })
})

describe('an URL that was read lately or is being read', () => {
    test('a node for a warm URL takes its real source without a slot', async () => {
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        loader.scan(document.body)
        await reach(a)
        a.dispatchEvent(new Event('load'))
        await settleMicrotasks()

        // Another URL holds the whole queue.
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        expect(isReal(v, 'v')).toBe(true)

        const again = await deferredImage('a', 60)
        loader.scan(document.body)
        expect(isReal(again, 'a')).toBe(true)
    })

    test('a node for an URL in flight waits for that read and takes no slot of its own', async () => {
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        loader.scan(document.body)
        await reach(a)
        expect(isReal(a, 'a')).toBe(true)

        const twin = await deferredImage('a', 60)
        const w = await deferredImage('w', 60)
        loader.scan(document.body)
        const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
        expect(observer.observed.has(twin)).toBe(false)
        expect(isDeferred(twin)).toBe(true)

        a.dispatchEvent(new Event('load'))
        await settleMicrotasks()
        expect(isReal(twin, 'a')).toBe(true)

        // The twin held no slot, so w is granted at once.
        await reach(w)
        expect(isReal(w, 'w')).toBe(true)
    })
})

describe('the observer', () => {
    test('observes against the viewport with the 1250 px margin and a scroll margin', async () => {
        const loader = createDeferredImageLoader()
        await deferredImage('a', 60)
        loader.scan(document.body)

        const init = FakeObserver.instances[0].init
        expect(init.root ?? null).toBeNull()
        expect(init.rootMargin).toBe('1250px 0px')
        expect(init.scrollMargin).toBe('1250px 0px')
    })

    test('an image that is not a deferred one is not observed', async () => {
        const loader = createDeferredImageLoader()
        const plain = document.createElement('img')
        plain.setAttribute('src', URL_OF('p'))
        document.body.appendChild(plain)
        loader.scan(document.body)

        expect(FakeObserver.instances.flatMap((o) => [...o.observed])).toHaveLength(0)
        expect(plain.getAttribute('src')).toBe(URL_OF('p'))
    })
})

describe('where the WebView cannot scroll-margin an observer', () => {
    test('without scrollMargin every deferred image gets its real source at once and stays lazy', async () => {
        class NoMargin {
            static created = 0
            constructor() { NoMargin.created++ }
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        vi.stubGlobal('IntersectionObserver', NoMargin)
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        const b = await deferredImage('b', 60)
        loader.scan(document.body)

        expect(isReal(a, 'a')).toBe(true)
        expect(isReal(b, 'b')).toBe(true)
        expect(a.getAttribute('loading')).toBe('lazy')
        expect(NoMargin.created).toBe(0)
    })

    test('without an IntersectionObserver every deferred image gets its real source at once', async () => {
        vi.stubGlobal('IntersectionObserver', undefined)
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        loader.scan(document.body)

        expect(isReal(a, 'a')).toBe(true)
    })
})

describe('assign', () => {
    test('a large file waits in the queue and a small one is assigned at once', async () => {
        const loader = createDeferredImageLoader()
        transport.sizes.big = 60 * MIB
        transport.sizes.small = 1 * MIB
        await androidAssetSizeVerdict('big')
        await androidAssetSizeVerdict('small')
        rememberWholeReadUrl(URL_OF('big'), 'big')
        rememberWholeReadUrl(URL_OF('small'), 'small')
        const big = document.createElement('img')
        const small = document.createElement('img')
        document.body.append(big, small)

        loader.assign(small, URL_OF('small'))
        expect(small.getAttribute('src')).toBe(URL_OF('small'))

        loader.assign(big, URL_OF('big'))
        expect(isDeferred(big)).toBe(true)
        await reach(big)
        expect(isReal(big, 'big')).toBe(true)
    })
})
