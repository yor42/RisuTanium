// @vitest-environment happy-dom

/**
 * `getEmotion` puts a style marker ('normal' or 'emp') in front of the image
 * URLs. The marker is never an image: with no image to show, nothing renders.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import TransitionImage, { FADE_FALLBACK_MS } from './TransitionImage.svelte'

const targets: HTMLElement[] = []
const instances: Record<string, unknown>[] = []

async function render(src: string[]): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    instances.push(mount(TransitionImage, { target, props: { src, classType: 'waifu' } }))
    await Promise.resolve()
    flushSync()
    return target
}

const sources = (root: HTMLElement) => Array.from(root.querySelectorAll('img')).map((img) => img.getAttribute('src'))

const newSources = (root: HTMLElement) => Array.from(root.querySelectorAll('img.new-image')).map((img) => img.getAttribute('src'))
const oldSources = (root: HTMLElement) => Array.from(root.querySelectorAll('img.old-image')).map((img) => img.getAttribute('src'))

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

// Promise turns only, so it also works under fake timers.
async function settle() {
    for (let i = 0; i < 6; i++) {
        await Promise.resolve()
    }
    flushSync()
}

async function mountState(initial: string[]) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    const props = $state({ src: initial as string[] | Promise<string[]>, classType: 'waifu' as const })
    const instance = mount(TransitionImage, { target, props })
    instances.push(instance)
    await settle()
    return { target, props, instance }
}

async function collectUnhandledRejections(run: () => Promise<void>): Promise<unknown[]> {
    const seen: unknown[] = []
    const listener = (reason: unknown) => {
        seen.push(reason)
    }
    process.on('unhandledRejection', listener)
    try {
        await run()
        // One real macrotask so Node reports a rejection nobody handled.
        await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
        process.off('unhandledRejection', listener)
    }
    return seen
}

const REJECTED_PREFIX = 'TransitionImage: emotion images rejected'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    for (const instance of instances.splice(0)) {
        unmount(instance)
    }
    for (const target of targets.splice(0)) {
        target.remove()
    }
})

describe('TransitionImage style marker', () => {
    test('reproducer: a lone normal marker renders no image', async () => {
        const root = await render(['normal'])
        expect(sources(root)).toEqual([])
    })

    test('reproducer: a lone emp marker renders no image', async () => {
        const root = await render(['emp'])
        expect(sources(root)).toEqual([])
    })

    test('guard: the marker is split off a list of images, which render in order', async () => {
        const root = await render(['normal', 'a.png', 'b.png'])
        expect(sources(root)).toEqual(['a.png', 'b.png'])
    })

    test('guard: a later non-empty list renders images again after a lone marker', async () => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        targets.push(target)
        const props = $state({ src: ['normal', 'a.png'] as string[] | Promise<string[]>, classType: 'waifu' as const })
        instances.push(mount(TransitionImage, { target, props }))
        await Promise.resolve()
        flushSync()
        expect(sources(target)).toEqual(['a.png'])

        props.src = Promise.resolve(['emp'])
        flushSync()
        await Promise.resolve()
        await Promise.resolve()
        flushSync()
        expect(sources(target)).toEqual([])

        props.src = Promise.resolve(['normal', 'b.png'])
        flushSync()
        await Promise.resolve()
        await Promise.resolve()
        flushSync()
        expect(sources(target)).toEqual(['b.png'])
        expect(target.querySelectorAll('img.old-image').length).toBe(0)
    })

    test('guard: the emp marker keeps its stacked layout', async () => {
        const root = await render(['emp', 'a.png', 'b.png'])
        expect(sources(root)).toEqual(['a.png', 'b.png'])
        expect(root.querySelectorAll('img')[0].style.width).toBe('80%')
    })
})

describe('TransitionImage request ordering', () => {
    test('reproducer: a slower older request resolving last never replaces the newer one', async () => {
        const { target, props } = await mountState(['normal', 'x.png'])
        const a = deferred<string[]>()
        const b = deferred<string[]>()
        props.src = a.promise
        flushSync()
        props.src = b.promise
        flushSync()
        b.resolve(['normal', 'b.png'])
        await settle()
        a.resolve(['normal', 'a.png'])
        await settle()
        expect(sources(target)).not.toContain('a.png')
        expect(newSources(target)).toEqual(['b.png'])
    })

    test('reproducer: a late lone marker from an older request does not blank the newer image', async () => {
        const { target, props } = await mountState(['normal', 'x.png'])
        const a = deferred<string[]>()
        const b = deferred<string[]>()
        props.src = a.promise
        flushSync()
        props.src = b.promise
        flushSync()
        b.resolve(['normal', 'b.png'])
        await settle()
        a.resolve(['emp'])
        await settle()
        expect(sources(target)).toContain('b.png')
    })

    test('guard: equal content in a new promise starts no fade', async () => {
        const { target, props } = await mountState(['normal', 'a.png'])
        props.src = Promise.resolve(['normal', 'a.png'])
        await settle()
        expect(oldSources(target)).toEqual([])
        expect(sources(target)).toEqual(['a.png'])
    })
})

describe('TransitionImage rejected request', () => {
    test('reproducer: a rejected request is logged once and keeps the displayed portrait', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const failure = new Error('missing character')
        const { target, props } = await mountState(['normal', 'a.png'])
        const seen = await collectUnhandledRejections(async () => {
            props.src = Promise.reject(failure)
            await settle()
        })
        const ours = warn.mock.calls.filter((call) => call[0] === REJECTED_PREFIX)
        expect(seen).toEqual([])
        expect(ours.length).toBe(1)
        expect(ours[0][1]).toBe(failure)
        expect(sources(target)).toEqual(['a.png'])
        expect(oldSources(target)).toEqual([])
    })

    test('reproducer: a newer failed request supersedes an older in-flight success', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { target, props } = await mountState(['normal', 'x.png'])
        const a = deferred<string[]>()
        const b = deferred<string[]>()
        const seen = await collectUnhandledRejections(async () => {
            props.src = a.promise
            flushSync()
            props.src = b.promise
            flushSync()
            b.reject(new Error('missing character'))
            await settle()
            a.resolve(['normal', 'a.png'])
            await settle()
        })
        expect(seen).toEqual([])
        expect(sources(target)).toEqual(['x.png'])
        expect(oldSources(target)).toEqual([])
    })
})

describe('TransitionImage received array', () => {
    test('reproducer: the array handed in is not mutated', async () => {
        const list = ['normal', 'a.png']
        await render(list)
        expect(list).toEqual(['normal', 'a.png'])
    })

    test('reproducer: the same array rendered twice renders its images both times', async () => {
        const list = ['normal', 'a.png']
        const first = await render(list)
        expect(sources(first)).toEqual(['a.png'])
        unmount(instances.pop()!)
        const second = await render(list)
        expect(sources(second)).toEqual(['a.png'])
    })
})

describe('TransitionImage fade fallback', () => {
    async function startFade() {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const state = await mountState(['normal', 'a.png'])
        state.props.src = Promise.resolve(['normal', 'b.png'])
        await settle()
        return state
    }

    test('reproducer: an old layer whose animationend never fires is removed by the fallback, not before the CSS fade ends', async () => {
        const { target } = await startFade()
        expect(oldSources(target)).toEqual(['a.png'])
        vi.advanceTimersByTime(500)
        flushSync()
        expect(oldSources(target)).toEqual(['a.png'])
        vi.advanceTimersByTime(FADE_FALLBACK_MS - 500 + 1)
        flushSync()
        expect(oldSources(target)).toEqual([])
        expect(sources(target)).toEqual(['b.png'])
    })

    test('guard: animationend ends the fade at once and the cancelled fallback changes nothing later', async () => {
        const { target } = await startFade()
        const old = target.querySelector('img.old-image')!
        old.dispatchEvent(new Event('animationend'))
        flushSync()
        expect(oldSources(target)).toEqual([])
        expect(sources(target)).toEqual(['b.png'])
        vi.advanceTimersByTime(FADE_FALLBACK_MS * 2)
        flushSync()
        expect(sources(target)).toEqual(['b.png'])
    })

    test('guard: the timer of an earlier fade never cuts a later fade short', async () => {
        const { target, props } = await startFade()
        vi.advanceTimersByTime(FADE_FALLBACK_MS / 2)
        props.src = Promise.resolve(['normal', 'c.png'])
        await settle()
        expect(oldSources(target)).toEqual(['b.png'])
        vi.advanceTimersByTime(FADE_FALLBACK_MS / 2 + 1)
        flushSync()
        expect(oldSources(target)).toEqual(['b.png'])
    })

    test('guard: unmounting cancels the timer and a late result schedules nothing', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const baseline = vi.getTimerCount()
        const { props, instance } = await mountState(['normal', 'a.png'])
        props.src = Promise.resolve(['normal', 'b.png'])
        await settle()
        expect(vi.getTimerCount()).toBe(baseline + 1)
        const late = deferred<string[]>()
        props.src = late.promise
        flushSync()
        instances.splice(instances.indexOf(instance), 1)
        unmount(instance)
        expect(vi.getTimerCount()).toBe(baseline)
        late.resolve(['normal', 'c.png'])
        await settle()
        expect(vi.getTimerCount()).toBe(baseline)
    })
})
