// @vitest-environment jsdom

/**
 * The loader of deferred chat images: the images of one scan, the app-wide queue behind them, and what ends a read.
 * Reads are driven by hand: the fake observer reports an image only when a test says so, and `load` or `error` is
 * dispatched by the test. The sizes come from the real size cache through a mocked stat, like production.
 *
 * "Warm" means a URL that was read, granted and loaded once. "Exposure" is counted in the test: the sum of the sizes of
 * the distinct URLs that have a real node which the test has not yet loaded or errored.
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
import { createDeferredImageLoader, holdWarmAsks, resetDeferredImagesForTest } from './deferredAssetImages'

const MIB = 1024 * 1024
const URL_OF = (key: string) => 'http://asset.localhost/' + key
type Loader = ReturnType<typeof createDeferredImageLoader>

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

// Every node a test made, the size in MiB of each URL, and the nodes whose read the test ended.
const madeNodes: HTMLImageElement[] = []
const sizeOfUrl: Record<string, number> = {}
const finished = new Set<HTMLImageElement>()
let probeCount = 0

/** Registers `key` with the real size cache and the URL registry, as `getFileSrc` does on Android. */
async function seedSize(key: string, mib: number) {
    transport.sizes[key] = mib * MIB
    sizeOfUrl[URL_OF(key)] = mib
    await androidAssetSizeVerdict(key)
    rememberWholeReadUrl(URL_OF(key), key)
}

/** A deferred image of a stored size of `mib` MiB, as the sanitizer's hook leaves it. */
async function deferredImage(key: string, mib: number): Promise<HTMLImageElement> {
    await seedSize(key, mib)
    const img = document.createElement('img')
    img.setAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE, URL_OF(key))
    img.setAttribute('src', DEFERRED_IMAGE_PLACEHOLDER_SRC)
    img.setAttribute('loading', 'lazy')
    document.body.appendChild(img)
    madeNodes.push(img)
    return img
}

/** A bare node, as `checkImg` hands one to `assign`. */
function bareImage(): HTMLImageElement {
    const img = document.createElement('img')
    document.body.appendChild(img)
    madeNodes.push(img)
    return img
}

const isReal = (img: HTMLImageElement, key: string) => img.getAttribute('src') === URL_OF(key) && !img.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
const isDeferred = (img: HTMLImageElement) => img.getAttribute('src') === DEFERRED_IMAGE_PLACEHOLDER_SRC && img.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)

/** Reports `img` to the only live observer and lets the queue answer. */
async function reach(img: HTMLImageElement) {
    FakeObserver.instances[FakeObserver.instances.length - 1].fire(img)
    await settleMicrotasks()
}

function fireLoad(img: HTMLImageElement) {
    finished.add(img)
    img.dispatchEvent(new Event('load'))
}

function fireError(img: HTMLImageElement) {
    finished.add(img)
    img.dispatchEvent(new Event('error'))
}

/** The sum of the sizes in MiB of the distinct URLs that have a real node not yet loaded or errored by the test. */
function exposure(): number {
    const urls = new Set<string>()
    for (const img of madeNodes) {
        const src = img.getAttribute('src') ?? ''
        if (sizeOfUrl[src] !== undefined && !finished.has(img)) {
            urls.add(src)
        }
    }
    let sum = 0
    for (const url of urls) {
        sum += sizeOfUrl[url]
    }
    return sum
}

/** Gives `img` a box at `top`..`bottom` px; jsdom has no layout, so every other node reports an empty box. */
function placeAt(img: HTMLImageElement, top: number, bottom: number) {
    img.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 10, width: 10, height: bottom - top, x: 0, y: top, toJSON() { return {} } }) as DOMRect
}

/** Makes `key` warm: read, granted and loaded once, then gone from the page. */
async function warmUp(loader: Loader, key: string, mib: number) {
    const first = await deferredImage(key, mib)
    loader.scan(document.body)
    await reach(first)
    fireLoad(first)
    await settleMicrotasks()
    first.remove()
}

/** After every outstanding load, a cold 60 MiB node that is reached must be real with no timer advance: no slot leaked. */
async function slotIsFree(loader: Loader): Promise<boolean> {
    for (let round = 0; round < 4; round++) {
        for (const img of [...madeNodes]) {
            const src = img.getAttribute('src') ?? ''
            if (sizeOfUrl[src] !== undefined && !finished.has(img)) {
                fireLoad(img)
            }
        }
        await settleMicrotasks()
    }
    const key = 'probe' + probeCount++
    const probe = await deferredImage(key, 60)
    loader.scan(document.body)
    await reach(probe)
    return isReal(probe, key)
}

beforeEach(() => {
    transport.android = true
    transport.sizes = {}
    madeNodes.length = 0
    finished.clear()
    probeCount = 0
    for (const key of Object.keys(sizeOfUrl)) {
        delete sizeOfUrl[key]
    }
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

    test('a record with two promoted nodes settles once at the timer, and a late load of either changes nothing', async () => {
        vi.useFakeTimers()
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        loader.scan(document.body)
        await reach(a)
        const twin = await deferredImage('a', 60)
        loader.scan(document.body)
        const c = await deferredImage('c', 60)
        const d = await deferredImage('d', 60)
        loader.scan(document.body)
        await reach(c)
        await reach(d)
        expect(isDeferred(c)).toBe(true)

        await vi.advanceTimersByTimeAsync(29_999)
        expect(isDeferred(c)).toBe(true)
        await vi.advanceTimersByTimeAsync(1)
        expect(isReal(c, 'c')).toBe(true)

        twin.dispatchEvent(new Event('load'))
        a.dispatchEvent(new Event('load'))
        await settleMicrotasks()
        expect(isDeferred(d)).toBe(true)
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

    test('a promoted node that is removed and then loads still gives the slot back', async () => {
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        loader.scan(document.body)
        await reach(a)

        a.remove()
        fireLoad(a)
        await settleMicrotasks()
        expect(await slotIsFree(loader)).toBe(true)
    })

    test('an error ends the read once: the node is neither retried nor observed again, and the slot returns', async () => {
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        loader.scan(document.body)
        await reach(a)

        fireError(a)
        await settleMicrotasks()
        const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
        expect(observer.observed.has(a)).toBe(false)
        expect(a.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)).toBe(false)
        expect(a.getAttribute('src')).toBe(URL_OF('a'))
        expect(await slotIsFree(loader)).toBe(true)
    })
})

describe('an URL that was read lately', () => {
    test('TW1 a warm node waits for a slot while another read holds the queue', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        expect(isReal(v, 'v')).toBe(true)

        const again = await deferredImage('a', 60)
        loader.scan(document.body)
        expect(isDeferred(again)).toBe(true)
        expect(exposure()).toBeLessThanOrEqual(64)
    })

    test('TW1 it is real once the holder loads, and a cold node reached meanwhile queues behind it', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        const again = await deferredImage('a', 60)
        const c = await deferredImage('c', 60)
        loader.scan(document.body)

        fireLoad(v)
        await settleMicrotasks()
        expect(isReal(again, 'a')).toBe(true)
        await reach(c)
        expect(isDeferred(c)).toBe(true)
        expect(exposure()).toBeLessThanOrEqual(64)

        fireLoad(again)
        await settleMicrotasks()
        expect(isReal(c, 'c')).toBe(true)
    })

    test('TW2 a warm node on an empty queue holds its slot, so a cold node reached next waits', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const again = await deferredImage('a', 60)
        const b = await deferredImage('b', 60)
        loader.scan(document.body)
        await settleMicrotasks()
        expect(isReal(again, 'a')).toBe(true)

        await reach(b)
        expect(isDeferred(b)).toBe(true)
        expect(exposure()).toBeLessThanOrEqual(64)
    })

    test('TW3 G a warm node on an empty queue is real after one microtask and was never observed', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const again = await deferredImage('a', 60)
        loader.scan(document.body)
        const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
        expect(observer.observed.has(again)).toBe(false)

        await Promise.resolve()
        expect(isReal(again, 'a')).toBe(true)
    })
})

describe('copies of one URL', () => {
    /** Two nodes of `key` in two message wrappers, each scanned by its own loader. */
    async function twoLoaders(first: Loader, key: string, mib: number) {
        const x = await deferredImage(key, mib)
        const y = await deferredImage(key, mib)
        const wrapX = document.createElement('div')
        const wrapY = document.createElement('div')
        document.body.append(wrapX, wrapY)
        wrapX.appendChild(x)
        wrapY.appendChild(y)
        const second = createDeferredImageLoader()
        first.scan(wrapX)
        second.scan(wrapY)
        await settleMicrotasks()
        return { x, y, second }
    }

    test('TW-dup-room a warm pair of 10 MiB in one scan is real after microtasks with no report', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 's', 10)
        const x = await deferredImage('s', 10)
        const y = await deferredImage('s', 10)
        loader.scan(document.body)
        await settleMicrotasks()

        expect({ x: isReal(x, 's'), y: isReal(y, 's') }).toEqual({ x: true, y: true })
    })

    test('TW-dup-room a warm pair of 60 MiB in one scan is real after microtasks with no report', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const x = await deferredImage('a', 60)
        const y = await deferredImage('a', 60)
        loader.scan(document.body)
        await settleMicrotasks()

        expect({ x: isReal(x, 'a'), y: isReal(y, 'a') }).toEqual({ x: true, y: true })
    })

    test('TW-dup-room a warm pair of 10 MiB in two loaders is real after microtasks', async () => {
        const first = createDeferredImageLoader()
        await warmUp(first, 's', 10)
        const { x, y } = await twoLoaders(first, 's', 10)

        expect({ x: isReal(x, 's'), y: isReal(y, 's') }).toEqual({ x: true, y: true })
    })

    test('TW-dup-room a warm pair of 60 MiB in two loaders is real after microtasks, under one slot', async () => {
        const first = createDeferredImageLoader()
        await warmUp(first, 'a', 60)
        const { x, y } = await twoLoaders(first, 'a', 60)

        expect({ x: isReal(x, 'a'), y: isReal(y, 'a') }).toEqual({ x: true, y: true })
        expect(exposure()).toBeLessThanOrEqual(64)
    })

    test('TW-dup-room a warm pair of 10 MiB in two loaders holds one grant: a cold 54 MiB node still fits', async () => {
        const first = createDeferredImageLoader()
        await warmUp(first, 's', 10)
        const { second } = await twoLoaders(first, 's', 10)

        const c = await deferredImage('c', 54)
        second.scan(document.body)
        await reach(c)
        expect(isReal(c, 'c')).toBe(true)
    })

    test('TW-dup-busy a warm pair waits for the holder, both are promoted at its one grant, a cold node waits for their load', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        const x = await deferredImage('a', 60)
        const y = await deferredImage('a', 60)
        const c = await deferredImage('c', 60)
        loader.scan(document.body)
        await settleMicrotasks()
        expect(isDeferred(x)).toBe(true)
        expect(isDeferred(y)).toBe(true)

        fireLoad(v)
        await settleMicrotasks()
        expect({ x: isReal(x, 'a'), y: isReal(y, 'a') }).toEqual({ x: true, y: true })
        await reach(c)
        expect(isDeferred(c)).toBe(true)
        expect(exposure()).toBeLessThanOrEqual(64)

        fireLoad(x)
        await settleMicrotasks()
        expect(isReal(c, 'c')).toBe(true)
    })

    test('TW-reading-attach a node for a URL being read is real at once, takes no slot, and its own load settles the read', async () => {
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
        expect(isReal(twin, 'a')).toBe(true)
        expect(exposure()).toBeLessThanOrEqual(64)

        // The twin, not the first node, loads: the one read ends and w gets the slot.
        fireLoad(twin)
        await settleMicrotasks()
        await reach(w)
        expect(isReal(w, 'w')).toBe(true)
    })

    test('a record settles on whichever promoted node loads first, once', async () => {
        const loader = createDeferredImageLoader()
        const a = await deferredImage('a', 60)
        loader.scan(document.body)
        await reach(a)
        const twin = await deferredImage('a', 60)
        loader.scan(document.body)
        const w = await deferredImage('w', 60)
        const z = await deferredImage('z', 60)
        loader.scan(document.body)
        await reach(w)
        await reach(z)
        expect(isDeferred(w)).toBe(true)

        fireLoad(a)
        await settleMicrotasks()
        expect(isReal(w, 'w')).toBe(true)
        // The second promoted node's load is a stale event of a settled record.
        fireLoad(twin)
        await settleMicrotasks()
        expect(isDeferred(z)).toBe(true)
    })
})

describe('the same URL again', () => {
    test('TW-idem G a warm URL assigned twice does not hold the queue after its load', async () => {
        vi.useFakeTimers()
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const img = bareImage()
        loader.assign(img, URL_OF('a'))
        await settleMicrotasks()
        loader.assign(img, URL_OF('a'))
        await settleMicrotasks()

        const c = await deferredImage('c', 60)
        loader.scan(document.body)
        await reach(c)
        fireLoad(img)
        await settleMicrotasks()
        expect(isReal(img, 'a')).toBe(true)
        expect(isReal(c, 'c')).toBe(true)
        // No timer advance is needed for c: the second assign did not queue a read of its own.
        await vi.advanceTimersByTimeAsync(30_000)
        expect(isReal(c, 'c')).toBe(true)
    })

    test('TW-idem-cold a second assign of the same URL does not make the node wait on its own read', async () => {
        const loader = createDeferredImageLoader()
        await seedSize('a', 60)
        const img = bareImage()
        loader.assign(img, URL_OF('a'))
        await reach(img)
        const c = await deferredImage('c', 60)
        loader.scan(document.body)
        await reach(c)
        expect(isDeferred(c)).toBe(true)

        loader.assign(img, URL_OF('a'))
        await settleMicrotasks()
        fireLoad(img)
        await settleMicrotasks()
        expect(isReal(img, 'a')).toBe(true)
        expect(isReal(c, 'c')).toBe(true)
    })

    test('assign of the same URL while the node waits in the queue or is observed changes nothing', async () => {
        const loader = createDeferredImageLoader()
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        await seedSize('a', 60)
        const img = bareImage()
        loader.assign(img, URL_OF('a'))
        const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
        expect(observer.observed.has(img)).toBe(true)

        loader.assign(img, URL_OF('a'))
        expect(isDeferred(img)).toBe(true)
        expect(observer.observed.has(img)).toBe(true)

        await reach(img)
        loader.assign(img, URL_OF('a'))
        expect(isDeferred(img)).toBe(true)
        fireLoad(v)
        await settleMicrotasks()
        expect(isReal(img, 'a')).toBe(true)
    })

    test('assign of the same URL after the node loaded leaves it real at once, with no new read', async () => {
        const loader = createDeferredImageLoader()
        await seedSize('a', 60)
        const img = bareImage()
        loader.assign(img, URL_OF('a'))
        await reach(img)
        fireLoad(img)
        await settleMicrotasks()
        expect(isReal(img, 'a')).toBe(true)

        loader.assign(img, URL_OF('a'))
        expect(isReal(img, 'a')).toBe(true)
        await settleMicrotasks()
        expect(await slotIsFree(loader)).toBe(true)
    })

    test('a scan again while the node waits in the queue asks for nothing more', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        const again = await deferredImage('a', 60)
        loader.scan(document.body)
        loader.scan(document.body)
        loader.scan(document.body)
        fireLoad(v)
        await settleMicrotasks()
        expect(isReal(again, 'a')).toBe(true)

        fireLoad(again)
        expect(await slotIsFree(loader)).toBe(true)
    })
})

describe('a node that changes its URL', () => {
    test('TW-retarget a node queued for one URL and assigned another is read for the new one', async () => {
        const loader = createDeferredImageLoader()
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        await seedSize('a', 60)
        await seedSize('b', 60)
        const img = bareImage()
        loader.assign(img, URL_OF('a'))
        await reach(img)
        loader.assign(img, URL_OF('b'))
        await reach(img)

        fireLoad(v)
        await settleMicrotasks()
        expect(isReal(img, 'b')).toBe(true)
        expect(exposure()).toBeLessThanOrEqual(64)
    })

    test('TW-retarget-back a node queued for a, assigned b and then a again is read for a', async () => {
        const loader = createDeferredImageLoader()
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        await seedSize('a', 60)
        await seedSize('b', 60)
        const img = bareImage()
        loader.assign(img, URL_OF('a'))
        await reach(img)
        loader.assign(img, URL_OF('b'))
        loader.assign(img, URL_OF('a'))

        fireLoad(v)
        await settleMicrotasks()
        expect(isReal(img, 'a')).toBe(true)
    })

    test('assign of a small file to a node queued for a large one keeps the small file after the grant', async () => {
        const loader = createDeferredImageLoader()
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        await seedSize('a', 60)
        await seedSize('small', 1)
        const img = bareImage()
        loader.assign(img, URL_OF('a'))
        await reach(img)

        loader.assign(img, URL_OF('small'))
        expect(img.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)).toBe(false)
        fireLoad(v)
        await settleMicrotasks()
        expect(img.getAttribute('src')).toBe(URL_OF('small'))
        expect(img.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)).toBe(false)
    })

    test('L1 a promoted node assigned another URL leaves its old read holding the slot until the 30 s timer', async () => {
        vi.useFakeTimers()
        const loader = createDeferredImageLoader()
        await seedSize('a', 60)
        await seedSize('b', 60)
        const img = bareImage()
        loader.assign(img, URL_OF('a'))
        await reach(img)
        expect(isReal(img, 'a')).toBe(true)

        loader.assign(img, URL_OF('b'))
        await reach(img)
        expect(isReal(img, 'b')).toBe(false)
        await vi.advanceTimersByTimeAsync(29_999)
        expect(isReal(img, 'b')).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(isReal(img, 'b')).toBe(true)
    })

    test('a node dropped at the grant and put back while the record reads is promoted by the next scan', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        const x = await deferredImage('a', 60)
        const y = await deferredImage('a', 60)
        loader.scan(document.body)
        y.remove()

        fireLoad(v)
        await settleMicrotasks()
        expect(isReal(x, 'a')).toBe(true)
        expect(isDeferred(y)).toBe(true)
        document.body.appendChild(y)
        loader.scan(document.body)
        await settleMicrotasks()
        expect(isReal(y, 'a')).toBe(true)
    })
})

describe('where a warm node asks', () => {
    test('TW-far a warm node more than 1250 px below or above the viewport is observed, not asked, and asks when reported', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        await warmUp(loader, 'b', 60)
        const below = await deferredImage('a', 60)
        const above = await deferredImage('b', 60)
        placeAt(below, window.innerHeight + 1251, window.innerHeight + 1351)
        placeAt(above, -1351, -1251)
        loader.scan(document.body)
        await settleMicrotasks()

        const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
        expect(isDeferred(below)).toBe(true)
        expect(isDeferred(above)).toBe(true)
        expect(observer.observed.has(below)).toBe(true)
        expect(observer.observed.has(above)).toBe(true)

        await reach(below)
        expect(isReal(below, 'a')).toBe(true)
    })

    test('TW-near-margin G a warm node 1000 px below the viewport is real with no report', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const near = await deferredImage('a', 60)
        placeAt(near, window.innerHeight + 1000, window.innerHeight + 1100)
        loader.scan(document.body)
        await settleMicrotasks()

        expect(isReal(near, 'a')).toBe(true)
    })

    test('the band edges count as near: exactly 1250 px below the viewport and exactly 1250 px above it', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 10)
        await warmUp(loader, 'b', 10)
        const below = await deferredImage('a', 10)
        const above = await deferredImage('b', 10)
        placeAt(below, window.innerHeight + 1250, window.innerHeight + 1350)
        placeAt(above, -1350, -1250)
        loader.scan(document.body)
        await settleMicrotasks()

        expect({ below: isReal(below, 'a'), above: isReal(above, 'b') }).toEqual({ below: true, above: true })
    })

    test('every warm node of a scan is tested against its own box', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 10)
        await warmUp(loader, 'b', 10)
        const near = await deferredImage('a', 10)
        const far = await deferredImage('b', 10)
        placeAt(near, 100, 200)
        placeAt(far, window.innerHeight + 5000, window.innerHeight + 5100)
        loader.scan(document.body)
        await settleMicrotasks()

        expect(isReal(near, 'a')).toBe(true)
        expect(isDeferred(far)).toBe(true)
    })

    test('an assign of a warm URL near the viewport is real after microtasks; far from it, observed', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 10)
        await warmUp(loader, 'b', 10)
        const near = bareImage()
        const far = bareImage()
        placeAt(far, window.innerHeight + 5000, window.innerHeight + 5100)
        loader.assign(near, URL_OF('a'))
        loader.assign(far, URL_OF('b'))
        await settleMicrotasks()

        expect(isReal(near, 'a')).toBe(true)
        expect(isDeferred(far)).toBe(true)
    })
})

describe('loader lifetime', () => {
    test('TW-dispose a loader disposed with a node still waiting for a grant gives the slot back at the grant', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        const again = await deferredImage('a', 60)
        loader.scan(document.body)
        loader.dispose()
        again.remove()

        fireLoad(v)
        await settleMicrotasks()
        expect(await slotIsFree(createDeferredImageLoader())).toBe(true)
    })

    test('a record asked by a disposed loader still reads to its end', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const again = await deferredImage('a', 60)
        loader.scan(document.body)
        loader.dispose()
        await settleMicrotasks()
        expect(isReal(again, 'a')).toBe(true)

        const c = await deferredImage('c', 60)
        const other = createDeferredImageLoader()
        other.scan(document.body)
        await reach(c)
        expect(isDeferred(c)).toBe(true)
        fireLoad(again)
        await settleMicrotasks()
        expect(isReal(c, 'c')).toBe(true)
    })
})

describe('entry by state', () => {
    const entries = ['scan again', 'assign same', 'assign other', 'dispose', 'remove'] as const
    const states = ['observed', 'queued', 'reading', 'loaded'] as const

    for (const state of states) {
        for (const entry of entries) {
            test(`${entry} while ${state}: exposure stays within 64 MiB and no slot leaks`, async () => {
                vi.useFakeTimers()
                const loader = createDeferredImageLoader()
                const holder = await deferredImage('h', 60)
                await deferredImage('o', 60)
                await seedSize('a', 60)
                const img = bareImage()
                loader.scan(document.body)
                loader.assign(img, URL_OF('a'))
                if (state === 'queued') {
                    await reach(holder)
                    await reach(img)
                } else if (state === 'reading') {
                    await reach(img)
                } else if (state === 'loaded') {
                    await reach(img)
                    fireLoad(img)
                    await settleMicrotasks()
                }
                expect(exposure()).toBeLessThanOrEqual(64)

                if (entry === 'scan again') {
                    loader.scan(document.body)
                } else if (entry === 'assign same') {
                    loader.assign(img, URL_OF('a'))
                } else if (entry === 'assign other') {
                    loader.assign(img, URL_OF('o'))
                } else if (entry === 'dispose') {
                    loader.dispose()
                } else {
                    img.remove()
                }
                await settleMicrotasks()
                expect(exposure()).toBeLessThanOrEqual(64)

                // Known exception (L1): a promoted node that is assigned another URL leaves the read it started holding
                // its slot until the 30 s timer, because that node's load can no longer settle it.
                if (entry === 'assign other' && state === 'reading') {
                    await vi.advanceTimersByTimeAsync(30_000)
                }
                expect(await slotIsFree(entry === 'dispose' ? createDeferredImageLoader() : loader)).toBe(true)
            })
        }
    }
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
        await seedSize('big', 60)
        await seedSize('small', 1)
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

    test('off Android nothing is deferred: a large file is assigned at once', async () => {
        transport.android = false
        const loader = createDeferredImageLoader()
        await seedSize('big', 60)
        const big = bareImage()

        loader.assign(big, URL_OF('big'))
        expect(big.getAttribute('src')).toBe(URL_OF('big'))
        expect(big.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)).toBe(false)
    })
})

describe('while a list opens', () => {
    // A loader made before any hold, with a warm URL of its own, tells whether the hold gate is on. It never joins a
    // hold's waiting set, so it does not keep any hold alive.
    let probe: Loader
    let probeRoot: HTMLElement

    async function makeGateProbe() {
        probe = createDeferredImageLoader()
        probeRoot = document.createElement('div')
        document.body.appendChild(probeRoot)
        await warmUp(probe, 'gate', 10)
    }

    /** The gate is on when a warm node without a box is observed rather than asked. An asked node is loaded again to free its slot. */
    async function gateIsOn(): Promise<boolean> {
        const node = await deferredImage('gate', 10)
        probeRoot.replaceChildren(node)
        probe.scan(probeRoot)
        await settleMicrotasks()
        const asked = isReal(node, 'gate')
        if (asked) {
            fireLoad(node)
            await settleMicrotasks()
        }
        node.remove()
        return !asked
    }

    function newRoot(): HTMLElement {
        const root = document.createElement('div')
        document.body.appendChild(root)
        return root
    }

    const lastObserver = () => FakeObserver.instances[FakeObserver.instances.length - 1]

    test('T1 a warm node near the viewport is observed, not asked, and stays unrequested when it is far at the release', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 10)
        const near = await deferredImage('a', 10)
        placeAt(near, 100, 200)
        const release = holdWarmAsks()
        loader.scan(document.body)
        await settleMicrotasks()

        expect(isDeferred(near)).toBe(true)
        expect(lastObserver().observed.has(near)).toBe(true)

        placeAt(near, window.innerHeight + 5000, window.innerHeight + 5100)
        release()
        await settleMicrotasks()
        expect(isDeferred(near)).toBe(true)
        expect(lastObserver().observed.has(near)).toBe(true)
        expect(await slotIsFree(loader)).toBe(true)
    })

    test('T1 assign: a warm URL assigned near the viewport is observed, not asked', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 10)
        const img = bareImage()
        placeAt(img, 100, 200)
        const release = holdWarmAsks()
        loader.assign(img, URL_OF('a'))
        await settleMicrotasks()

        expect(isDeferred(img)).toBe(true)
        expect(lastObserver().observed.has(img)).toBe(true)
        release()
    })

    test('T2 a near warm node under a hold is real at its first report, and the release changes nothing', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 10)
        const near = await deferredImage('a', 10)
        placeAt(near, 100, 200)
        const release = holdWarmAsks()
        loader.scan(document.body)
        await settleMicrotasks()
        expect(isDeferred(near)).toBe(true)
        expect(lastObserver().observed.has(near)).toBe(true)

        await reach(near)
        expect(isReal(near, 'a')).toBe(true)
        expect(exposure()).toBe(10)
        release()
        await settleMicrotasks()
        expect(isReal(near, 'a')).toBe(true)
        expect(exposure()).toBe(10)
    })

    test('T3: a hold with no waiting loader ends at its release', async () => {
        await makeGateProbe()
        const release = holdWarmAsks()
        expect(await gateIsOn()).toBe(true)
        release()
        expect(await gateIsOn()).toBe(false)
    })

    test('T4 a released hold whose loader never scans ends at 1500 ms and not before', async () => {
        vi.useFakeTimers()
        await makeGateProbe()
        const release = holdWarmAsks()
        createDeferredImageLoader()
        release()

        await vi.advanceTimersByTimeAsync(1499)
        expect(await gateIsOn()).toBe(true)
        await vi.advanceTimersByTimeAsync(1)
        expect(await gateIsOn()).toBe(false)
        expect(await slotIsFree(createDeferredImageLoader())).toBe(true)
    })

    test('T5 holds overlap: a second release of one hold does not end the other, and the other ends at its own release', async () => {
        await makeGateProbe()
        const releaseA = holdWarmAsks()
        const releaseB = holdWarmAsks()

        releaseA()
        releaseA()
        expect(await gateIsOn()).toBe(true)
        releaseB()
        expect(await gateIsOn()).toBe(false)
    })

    test('T5 order: releasing the later hold first leaves the earlier one active until its own release', async () => {
        await makeGateProbe()
        const releaseA = holdWarmAsks()
        const releaseB = holdWarmAsks()

        releaseB()
        expect(await gateIsOn()).toBe(true)
        releaseA()
        expect(await gateIsOn()).toBe(false)
    })

    test('T6 G: under a hold the queue still admits one record per URL within 64 MiB and in order', async () => {
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 60)
        const v = await deferredImage('v', 60)
        loader.scan(document.body)
        await reach(v)
        expect(isReal(v, 'v')).toBe(true)

        const release = holdWarmAsks()
        const x = await deferredImage('a', 60)
        const y = await deferredImage('a', 60)
        const c = await deferredImage('c', 60)
        placeAt(x, 100, 200)
        placeAt(y, 300, 400)
        loader.scan(document.body)
        await settleMicrotasks()
        expect(isDeferred(x)).toBe(true)
        expect(isDeferred(y)).toBe(true)

        await reach(x)
        await reach(y)
        expect(isDeferred(x)).toBe(true)
        expect(isDeferred(y)).toBe(true)
        expect(exposure()).toBeLessThanOrEqual(64)

        fireLoad(v)
        await settleMicrotasks()
        expect(isReal(x, 'a')).toBe(true)
        expect(isReal(y, 'a')).toBe(true)
        expect(exposure()).toBeLessThanOrEqual(64)

        await reach(c)
        expect(isDeferred(c)).toBe(true)
        fireLoad(x)
        fireLoad(y)
        await settleMicrotasks()
        expect(isReal(c, 'c')).toBe(true)
        expect(exposure()).toBeLessThanOrEqual(64)
        release()
    })

    test('T7 G: under a hold a node of a URL that is being read is real at once, and a cold node still asks only when reported', async () => {
        const loader = createDeferredImageLoader()
        const first = await deferredImage('v', 10)
        loader.scan(document.body)
        await reach(first)
        expect(isReal(first, 'v')).toBe(true)

        const release = holdWarmAsks()
        const again = await deferredImage('v', 10)
        const cold = await deferredImage('w', 10)
        loader.scan(document.body)
        await settleMicrotasks()
        expect(isReal(again, 'v')).toBe(true)
        expect(isDeferred(cold)).toBe(true)
        expect(lastObserver().observed.has(cold)).toBe(true)

        await reach(cold)
        expect(isReal(cold, 'w')).toBe(true)
        release()
    })

    test('T8: a reset ends every hold and its timer, and an old release cannot end a later hold', async () => {
        vi.useFakeTimers()
        await makeGateProbe()
        const releaseOld = holdWarmAsks()
        resetDeferredImagesForTest()
        await makeGateProbe()
        expect(await gateIsOn()).toBe(false)

        await vi.advanceTimersByTimeAsync(1000)
        holdWarmAsks()
        expect(await gateIsOn()).toBe(true)
        releaseOld()
        await vi.advanceTimersByTimeAsync(500)
        expect(await gateIsOn()).toBe(true)
        await vi.advanceTimersByTimeAsync(999)
        expect(await gateIsOn()).toBe(true)
        await vi.advanceTimersByTimeAsync(1)
        expect(await gateIsOn()).toBe(false)
    })

    test('T9 a loader made during a hold keeps it open after the release until it scans rendered markup', async () => {
        await makeGateProbe()
        const release = holdWarmAsks()
        const loader = createDeferredImageLoader()
        const root = newRoot()
        release()
        expect(await gateIsOn()).toBe(true)

        loader.scan(root, false)
        expect(await gateIsOn()).toBe(true)
        loader.scan(root, true)
        expect(await gateIsOn()).toBe(false)
    })

    test('T9 default: a scan without the argument counts as rendered', async () => {
        await makeGateProbe()
        const release = holdWarmAsks()
        const loader = createDeferredImageLoader()
        release()
        expect(await gateIsOn()).toBe(true)

        loader.scan(newRoot())
        expect(await gateIsOn()).toBe(false)
    })

    test('T9 unsupported: a scan where the WebView cannot scroll-margin an observer still counts as rendered', async () => {
        await makeGateProbe()
        const release = holdWarmAsks()
        const loader = createDeferredImageLoader()
        release()
        expect(await gateIsOn()).toBe(true)

        class NoMargin {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        vi.stubGlobal('IntersectionObserver', NoMargin)
        loader.scan(newRoot(), false)
        loader.scan(newRoot(), true)
        vi.stubGlobal('IntersectionObserver', FakeObserver)
        expect(await gateIsOn()).toBe(false)
    })

    test('T10 a loader disposed during a hold stops holding it open', async () => {
        await makeGateProbe()
        const release = holdWarmAsks()
        const loader = createDeferredImageLoader()
        release()
        expect(await gateIsOn()).toBe(true)

        loader.dispose()
        expect(await gateIsOn()).toBe(false)
    })

    test('T11 a rendered scan alone does not end a hold whose list has not signalled', async () => {
        await makeGateProbe()
        const release = holdWarmAsks()
        const loader = createDeferredImageLoader()
        loader.scan(newRoot(), true)
        expect(await gateIsOn()).toBe(true)

        release()
        expect(await gateIsOn()).toBe(false)
    })

    test('T12: a loader made before the hold does not keep it open', async () => {
        const early = createDeferredImageLoader()
        await makeGateProbe()
        const release = holdWarmAsks()
        expect(await gateIsOn()).toBe(true)

        release()
        expect(await gateIsOn()).toBe(false)
        early.dispose()
    })

    test('T13 one loader waits in both of two overlapping holds, and its rendered scan ends both', async () => {
        await makeGateProbe()
        const releaseA = holdWarmAsks()
        const releaseB = holdWarmAsks()
        const loader = createDeferredImageLoader()
        const root = newRoot()
        releaseA()
        releaseB()
        expect(await gateIsOn()).toBe(true)

        loader.scan(root, true)
        expect(await gateIsOn()).toBe(false)
    })

    test('T14 a held scan reads no box; the reads resume once the hold has ended', async () => {
        await makeGateProbe()
        const loader = createDeferredImageLoader()
        await warmUp(loader, 'a', 10)
        const nodes = [await deferredImage('a', 10), await deferredImage('a', 10)]
        let reads = 0
        for (const node of nodes) {
            placeAt(node, 100, 200)
            const boxOf = node.getBoundingClientRect
            node.getBoundingClientRect = () => { reads++; return boxOf.call(node) }
        }
        const release = holdWarmAsks()
        loader.scan(document.body)
        await settleMicrotasks()
        expect(reads).toBe(0)
        expect(nodes.every(isDeferred)).toBe(true)

        release()
        loader.scan(document.body)
        await settleMicrotasks()
        expect(reads).toBeGreaterThan(0)
    })
})
