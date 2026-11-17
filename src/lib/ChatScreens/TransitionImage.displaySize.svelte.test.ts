// @vitest-environment happy-dom

/**
 * TransitionImage on a phone: every portrait decodes asynchronously, and a still portrait is shown at display
 * size through the app-wide shrunk-portrait store. The shrink itself is mocked here; its own behaviour is
 * proven in src/ts/media. The real portraitVariants store runs over those mocks.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { currentPortraitMaxSide, revokePortraitUrl, shrinkPortrait, type ShrinkOutcome } from 'src/ts/media/portraitDisplay'
import { portraitCache, resetPortraitCacheForTest } from 'src/ts/media/portraitVariants'
import TransitionImage from './TransitionImage.svelte'

vi.mock('src/ts/media/portraitDisplay', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/media/portraitDisplay')>()),
    currentPortraitMaxSide: vi.fn(),
    shrinkPortrait: vi.fn(),
    revokePortraitUrl: vi.fn(),
}))

type ClassType = 'waifu' | 'risu' | 'mobile'

const targets: HTMLElement[] = []
const instances: Record<string, unknown>[] = []

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
    for (let i = 0; i < 12; i++) {
        await Promise.resolve()
    }
    flushSync()
}

interface ShrinkCall {
    src: string
    signal: AbortSignal
    d: ReturnType<typeof deferred<ShrinkOutcome>>
}

let shrinkCalls: ShrinkCall[] = []
let eventLog: string[] = []
let phoneMaxSide: number | null = 3072

const shrunkOf = (src: string): ShrinkOutcome => ({ kind: 'shrunk', url: `blob:shrunk-${src.replace('.png', '')}`, width: 2048, height: 3072, bytes: 1 })

/** Every shrink stays pending until the test resolves its deferred. */
function deferShrinks() {
    vi.mocked(shrinkPortrait).mockImplementation((src, _maxSide, signal) => {
        const d = deferred<ShrinkOutcome>()
        shrinkCalls.push({ src, signal, d })
        eventLog.push(`shrink:${src}`)
        signal.addEventListener('abort', () => eventLog.push(`abort:${src}`))
        return d.promise
    })
}

/** Every shrink settles at once as a shrunk portrait named after its source. */
function autoShrinks() {
    vi.mocked(shrinkPortrait).mockImplementation(async (src) => {
        shrinkCalls.push({ src, signal: new AbortController().signal, d: deferred<ShrinkOutcome>() })
        return shrunkOf(src)
    })
}

function mountPlain(src: string[] | Promise<string[]>, classType: ClassType = 'waifu') {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    const instance = mount(TransitionImage, { target, props: { src, classType } })
    instances.push(instance)
    return { target, instance }
}

async function mountState(initial: string[]) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    const props = $state({ src: initial as string[] | Promise<string[]>, classType: 'waifu' as ClassType })
    const instance = mount(TransitionImage, { target, props })
    instances.push(instance)
    await settle()
    return { target, props, instance }
}

const images = (root: HTMLElement) => Array.from(root.querySelectorAll('img'))
const sources = (root: HTMLElement) => images(root).map((img) => img.getAttribute('src'))
const endFade = (root: HTMLElement) => root.querySelectorAll('img.old-image').forEach((img) => img.dispatchEvent(new Event('animationend')))

async function collectUnhandledRejections(run: () => Promise<void>): Promise<unknown[]> {
    const seen: unknown[] = []
    const listener = (reason: unknown) => {
        seen.push(reason)
    }
    process.on('unhandledRejection', listener)
    try {
        await run()
        await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
        process.off('unhandledRejection', listener)
    }
    return seen
}

beforeEach(() => {
    shrinkCalls = []
    eventLog = []
    phoneMaxSide = 3072
    vi.mocked(currentPortraitMaxSide).mockImplementation(() => phoneMaxSide)
    vi.mocked(shrinkPortrait).mockReset()
    vi.mocked(revokePortraitUrl).mockReset()
})

afterEach(() => {
    vi.useRealTimers()
    for (const instance of instances.splice(0)) {
        unmount(instance)
    }
    for (const target of targets.splice(0)) {
        target.remove()
    }
    resetPortraitCacheForTest()
    vi.restoreAllMocks()
})

describe('decoding and sizes', () => {
    test('T1: every portrait image decodes asynchronously on all six sites', async () => {
        phoneMaxSide = null
        const plain = mountPlain(['normal', 'a.png', 'b.png'])
        const emp = mountPlain(['emp', 'a.png', 'b.png'])
        await settle()
        expect(images(plain.target).map((img) => img.getAttribute('decoding'))).toEqual(['async', 'async'])
        expect(images(emp.target).map((img) => img.getAttribute('decoding'))).toEqual(['async', 'async'])

        for (const style of ['normal', 'emp']) {
            const fade = await mountState([style, 'a.png', 'b.png'])
            fade.props.src = [style, 'c.png', 'd.png']
            await settle()
            expect(fade.target.querySelectorAll('img.old-image').length).toBe(2)
            expect(fade.target.querySelectorAll('img.new-image').length).toBe(2)
            expect(images(fade.target).map((img) => img.getAttribute('decoding'))).toEqual(['async', 'async', 'async', 'async'])
        }
    })

    test('T2: on a phone a large still shows the shrunk URL with its known size', async () => {
        autoShrinks()
        const { target } = mountPlain(['normal', 'a.png'])
        await settle()
        const [img] = images(target)
        expect(img.getAttribute('src')).toBe('blob:shrunk-a')
        expect(img.getAttribute('width')).toBe('2048')
        expect(img.getAttribute('height')).toBe('3072')
    })

    test('T3: on desktop or tablet the original is shown and nothing is shrunk', async () => {
        phoneMaxSide = null
        autoShrinks()
        const { target } = mountPlain(['normal', 'a.png'])
        await settle()
        expect(sources(target)).toEqual(['a.png'])
        expect(images(target)[0].getAttribute('width')).toBeNull()
        expect(shrinkPortrait).not.toHaveBeenCalled()
    })

    test('T4: a failed or rejected shrink shows the original with no unhandled rejection', async () => {
        vi.mocked(shrinkPortrait).mockImplementation(async (src) => (src === 'a.png' ? { kind: 'original' } : Promise.reject(new Error('shrink failed'))))
        const seen = await collectUnhandledRejections(async () => {
            const first = mountPlain(['normal', 'a.png'])
            const second = mountPlain(['normal', 'b.png'])
            await settle()
            expect(sources(first.target)).toEqual(['a.png'])
            expect(sources(second.target)).toEqual(['b.png'])
        })
        expect(seen).toEqual([])
    })

    test('T8: a data URL takes the same path and an empty string is shown as it is', async () => {
        vi.mocked(shrinkPortrait).mockImplementation(async () => ({ kind: 'original' }))
        const data = 'data:image/png;base64,iVBOR'
        const withData = mountPlain(['normal', data])
        const withEmpty = mountPlain(['normal', ''])
        await settle()
        expect(sources(withData.target)).toEqual([data])
        expect(sources(withEmpty.target)).toEqual([''])
        expect(shrinkPortrait).toHaveBeenCalledTimes(1)
    })
})

describe('what stays on screen', () => {
    test('T5: a, then b, then a shrinks a once', async () => {
        autoShrinks()
        const { target, props } = await mountState(['normal', 'a.png'])
        props.src = ['normal', 'b.png']
        await settle()
        endFade(target)
        await settle()
        props.src = ['normal', 'a.png']
        await settle()
        endFade(target)
        await settle()
        expect(sources(target)).toEqual(['blob:shrunk-a'])
        expect(shrinkCalls.filter((call) => call.src === 'a.png')).toHaveLength(1)
    })

    test('T6: a fading old set is not revoked, and unmount revokes nothing', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        autoShrinks()
        const { target, props, instance } = await mountState(['normal', 'a.png'])
        props.src = ['normal', 'b.png']
        await settle()
        expect(target.querySelectorAll('img.old-image')).toHaveLength(1)
        endFade(target)
        await settle()
        expect(revokePortraitUrl).not.toHaveBeenCalled()
        unmount(instance)
        instances.splice(instances.indexOf(instance), 1)
        expect(revokePortraitUrl).not.toHaveBeenCalled()
    })

    test('T7: a slow request that settles after a newer one is never shown', async () => {
        deferShrinks()
        const { target, props } = await mountState(['normal', 'a.png'])
        props.src = ['normal', 'b.png']
        await settle()
        shrinkCalls.find((call) => call.src === 'b.png')?.d.resolve(shrunkOf('b.png'))
        await settle()
        expect(sources(target)).toEqual(['blob:shrunk-b'])
        shrinkCalls.find((call) => call.src === 'a.png')?.d.resolve(shrunkOf('a.png'))
        await settle()
        expect(sources(target)).toEqual(['blob:shrunk-b'])
    })

    test('T7b: an older request that is still complete when a newer one needs more is never committed', async () => {
        deferShrinks()
        const { target, props } = await mountState(['normal', 'x.png'])
        props.src = ['normal', 'x.png', 'y.png']
        await settle()
        shrinkCalls.find((call) => call.src === 'x.png')?.d.resolve(shrunkOf('x.png'))
        await settle()
        expect(images(target)).toHaveLength(0)
        shrinkCalls.find((call) => call.src === 'y.png')?.d.resolve(shrunkOf('y.png'))
        await settle()
        expect(sources(target)).toEqual(['blob:shrunk-x', 'blob:shrunk-y'])
    })

    test('T10a: the previous portrait stays until the new one is ready', async () => {
        deferShrinks()
        const { target, props } = await mountState(['normal', 'a.png'])
        shrinkCalls[0].d.resolve(shrunkOf('a.png'))
        await settle()
        expect(sources(target)).toEqual(['blob:shrunk-a'])
        props.src = ['normal', 'b.png']
        await settle()
        expect(sources(target)).toEqual(['blob:shrunk-a'])
        shrinkCalls[1].d.resolve(shrunkOf('b.png'))
        await settle()
        expect(sources(target).sort()).toEqual(['blob:shrunk-a', 'blob:shrunk-b'])
        endFade(target)
        await settle()
        expect(sources(target)).toEqual(['blob:shrunk-b'])
    })

    test('T10b: a cold mount on a phone renders nothing until the shrunk set is ready', async () => {
        deferShrinks()
        const { target } = mountPlain(['normal', 'a.png'])
        await settle()
        expect(images(target)).toHaveLength(0)
        shrinkCalls[0].d.resolve(shrunkOf('a.png'))
        await settle()
        expect(sources(target)).toEqual(['blob:shrunk-a'])
    })
})

describe('cache sharing', () => {
    test('T9: a swap cancels the portrait it no longer needs, after the new one is requested', async () => {
        deferShrinks()
        const { props } = await mountState(['normal', 'a.png'])
        props.src = ['normal', 'b.png']
        await settle()
        expect(eventLog).toEqual(['shrink:a.png', 'shrink:b.png', 'abort:a.png'])
    })

    test('T9: a portrait both sets need keeps its job', async () => {
        deferShrinks()
        const { props } = await mountState(['normal', 'x.png', 'a.png'])
        props.src = ['normal', 'x.png', 'b.png']
        await settle()
        expect(shrinkCalls.filter((call) => call.src === 'x.png')).toHaveLength(1)
        expect(shrinkCalls.find((call) => call.src === 'x.png')?.signal.aborted).toBe(false)
        expect(shrinkCalls.find((call) => call.src === 'a.png')?.signal.aborted).toBe(true)
    })

    test('T9: unmount cancels pending work no other instance wants', async () => {
        deferShrinks()
        const { instance } = await mountState(['normal', 'b.png'])
        unmount(instance)
        instances.splice(instances.indexOf(instance), 1)
        expect(shrinkCalls[0].signal.aborted).toBe(true)
    })

    test('T11: a new instance shows a cached portrait without shrinking again', async () => {
        autoShrinks()
        const first = mountPlain(['normal', 'a.png'])
        await settle()
        unmount(first.instance)
        instances.splice(instances.indexOf(first.instance), 1)
        vi.mocked(shrinkPortrait).mockImplementation(() => new Promise(() => {}))
        const second = mountPlain(['normal', 'a.png'], 'risu')
        await settle()
        expect(sources(second.target)).toEqual(['blob:shrunk-a'])
        expect(shrinkCalls).toHaveLength(1)
        expect(revokePortraitUrl).not.toHaveBeenCalled()
    })

    test('T12: two instances needing the same portrait share one job and one URL', async () => {
        deferShrinks()
        const first = mountPlain(['normal', 'a.png'], 'waifu')
        const second = mountPlain(['normal', 'a.png'], 'risu')
        await settle()
        expect(shrinkCalls).toHaveLength(1)
        unmount(first.instance)
        instances.splice(instances.indexOf(first.instance), 1)
        expect(shrinkCalls[0].signal.aborted).toBe(false)
        shrinkCalls[0].d.resolve(shrunkOf('a.png'))
        await settle()
        expect(sources(second.target)).toEqual(['blob:shrunk-a'])
        unmount(second.instance)
        instances.splice(instances.indexOf(second.instance), 1)
        expect(revokePortraitUrl).not.toHaveBeenCalled()
    })

    test.each(['first', 'second'])('T13: module state does not leak between tests (%s)', async () => {
        autoShrinks()
        const { target } = mountPlain(['normal', 'a.png'])
        await settle()
        expect(shrinkCalls).toHaveLength(1)
        expect(sources(target)).toEqual(['blob:shrunk-a'])
    })
})

describe('superseded requests release their references', () => {
    function entryFor(key: string) {
        return portraitCache().snapshotForTest().entries.find((entry) => entry.key === `3072|${key}`)
    }

    test('T14: a rejected newer request releases what only the older request wanted', async () => {
        deferShrinks()
        const { props } = await mountState(['normal', 'a.png'])
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        props.src = Promise.reject(new Error('emotion lookup failed'))
        await settle()
        expect(shrinkCalls[0].signal.aborted).toBe(true)
        expect(entryFor('a.png')).toBeUndefined()
    })

    test('T14: a request equal to the shown set releases a superseded pending one', async () => {
        deferShrinks()
        const { props } = await mountState(['normal', 'a.png'])
        shrinkCalls[0].d.resolve(shrunkOf('a.png'))
        await settle()
        props.src = ['normal', 'c.png']
        await settle()
        expect(shrinkCalls[1].src).toBe('c.png')
        props.src = ['normal', 'a.png']
        await settle()
        expect(shrinkCalls[1].signal.aborted).toBe(true)
        expect(entryFor('c.png')).toBeUndefined()
    })

    test('T14: a settled entry of a superseded request ends with no reference', async () => {
        deferShrinks()
        const { props } = await mountState(['normal', 'a.png'])
        shrinkCalls[0].d.resolve(shrunkOf('a.png'))
        await settle()
        props.src = ['normal', 'c.png']
        await settle()
        const later = deferred<string[]>()
        props.src = later.promise
        await settle()
        shrinkCalls[1].d.resolve(shrunkOf('c.png'))
        await settle()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        later.reject(new Error('emotion lookup failed'))
        await settle()
        expect(entryFor('c.png')?.refs).toBe(0)
    })

    describe('T15: a theme switch while a job is pending', () => {
        async function switchTheme() {
            deferShrinks()
            const a = mountPlain(['normal', 'a.png'], 'waifu')
            await settle()
            unmount(a.instance)
            instances.splice(instances.indexOf(a.instance), 1)
            const b = mountPlain(['normal', 'a.png'], 'risu')
            await settle()
            expect(shrinkCalls).toHaveLength(2)
            expect(shrinkCalls[0].signal.aborted).toBe(true)
            return b
        }

        test('(i) the old job is cancelled', async () => {
            const b = await switchTheme()
            shrinkCalls[0].d.resolve({ kind: 'cancelled' })
            await settle()
            shrinkCalls[1].d.resolve({ kind: 'shrunk', url: 'blob:j2', width: 2048, height: 3072, bytes: 1 })
            await settle()
            expect(sources(b.target)).toEqual(['blob:j2'])
            expect(revokePortraitUrl).not.toHaveBeenCalled()
        })

        test('(ii) the old job still produced a URL: it is revoked once and never shown', async () => {
            const b = await switchTheme()
            shrinkCalls[0].d.resolve({ kind: 'shrunk', url: 'blob:j1', width: 2048, height: 3072, bytes: 1 })
            await settle()
            expect(vi.mocked(revokePortraitUrl).mock.calls).toEqual([['blob:j1']])
            expect(images(b.target)).toHaveLength(0)
            shrinkCalls[1].d.resolve({ kind: 'shrunk', url: 'blob:j2', width: 2048, height: 3072, bytes: 1 })
            await settle()
            expect(sources(b.target)).toEqual(['blob:j2'])
            expect(vi.mocked(revokePortraitUrl).mock.calls).toEqual([['blob:j1']])
        })
    })
})

describe('reactivity', () => {
    test('T16: only a change of src runs processSrc, not a classType change or a fade ending', async () => {
        autoShrinks()
        const cache = portraitCache()
        const create = cache.createHolder.bind(cache)
        let retainCount = 0
        vi.spyOn(cache, 'createHolder').mockImplementation(() => {
            const holder = create()
            const real = holder.retain.bind(holder)
            holder.retain = (keep) => {
                retainCount++
                real(keep)
            }
            return holder
        })
        const { target, props } = await mountState(['normal', 'a.png'])
        const retainCalls = () => retainCount
        expect(retainCalls()).toBe(1)
        props.classType = 'risu'
        await settle()
        expect(retainCalls()).toBe(1)
        expect(shrinkCalls).toHaveLength(1)
        props.src = ['normal', 'b.png']
        await settle()
        expect(retainCalls()).toBe(2)
        endFade(target)
        await settle()
        // The one extra call is the old set's release when its fade ends; a re-run of processSrc would add another.
        expect(retainCalls()).toBe(3)
        expect(shrinkCalls).toHaveLength(2)
    })

    test('a fade that ends releases the old set\'s references', async () => {
        autoShrinks()
        const { target, props } = await mountState(['normal', 'a.png'])
        props.src = ['normal', 'b.png']
        await settle()
        const refsOf = (key: string) => portraitCache().snapshotForTest().entries.find((entry) => entry.key === `3072|${key}`)?.refs
        expect(refsOf('a.png')).toBe(1)
        endFade(target)
        await settle()
        expect(refsOf('a.png')).toBe(0)
        expect(refsOf('b.png')).toBe(1)
    })

    test('a fade that ends while a newer shrunk set is awaited does not cancel it', async () => {
        deferShrinks()
        const { target, props } = await mountState(['normal', 'a.png'])
        shrinkCalls[0].d.resolve(shrunkOf('a.png'))
        await settle()
        props.src = ['normal', 'b.png']
        await settle()
        shrinkCalls[1].d.resolve(shrunkOf('b.png'))
        await settle()
        props.src = ['normal', 'c.png']
        await settle()
        endFade(target)
        await settle()
        expect(shrinkCalls[2].signal.aborted).toBe(false)
        shrinkCalls[2].d.resolve(shrunkOf('c.png'))
        await settle()
        expect(sources(target).sort()).toEqual(['blob:shrunk-b', 'blob:shrunk-c'])
    })
})
