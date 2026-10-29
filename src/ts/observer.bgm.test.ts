// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: vi.fn() }))
vi.mock('src/ts/util', () => ({
    sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
}))

type Registry = typeof import('./messageRootRegistry')
type RegistryAction = ReturnType<Registry['registerMessageRoot']>

const HOLD_MS = 2000

// Mirrors the HTMLMediaElement contract the controller depends on: the volume
// setter throws for non-finite and out-of-range values, play() returns a promise.
class FakeAudio extends EventTarget {
    static instances: FakeAudio[] = []
    static playImpl: (audio: FakeAudio) => Promise<void> = () => Promise.resolve()
    loop = false
    src: string
    private level = 1
    playCount = 0
    pause = vi.fn()
    remove = vi.fn()
    constructor(src: string) {
        super()
        this.src = src
        FakeAudio.instances.push(this)
    }
    // A plain method: a vi.fn would attach its own handler to the returned
    // promise and hide an unhandled rejection from the production code.
    play() {
        this.playCount++
        return FakeAudio.playImpl(this)
    }
    get volume() {
        return this.level
    }
    set volume(value: number) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new TypeError('volume must be finite')
        }
        if (value < 0 || value > 1) {
            throw new DOMException('volume out of range', 'IndexSizeError')
        }
        this.level = value
    }
}

let reg: Registry
let dispose: (() => void) | null = null
const handles = new Map<Element, RegistryAction>()

// The pre-fix export returns a promise, so the disposer is recorded only when
// the export returns one.
let startFn: () => () => void

function start() {
    const result = startFn()
    if (typeof result === 'function') {
        dispose = result
    }
    return result
}

const constructed = () => FakeAudio.instances.map(a => a.src)
const pauses = () => FakeAudio.instances.reduce((sum, a) => sum + a.pause.mock.calls.length, 0)
const plays = () => FakeAudio.instances.reduce((sum, a) => sum + a.playCount, 0)
const flush = () => vi.advanceTimersByTimeAsync(0)
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

async function drainMicrotasks() {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve()
    }
}

const ctrlValue = (src: string, volume: string | number = 'auto') => `bgm___${volume}___${src}`
const ctrl = (src: string, volume: string | number = 'auto') =>
    `<div risu-ctrl="${ctrlValue(src, volume)}" style="display:none;"></div>`

function buildRoot(index: number, chatId: string, inner = '') {
    const el = document.createElement('div')
    el.className = 'flex max-w-full justify-center risu-chat'
    el.setAttribute('data-chat-index', String(index))
    el.setAttribute('data-chat-id', chatId)
    el.innerHTML = inner
    return el
}

interface MountOptions {
    before?: Node | null
    parent?: Node
    register?: 'microtask' | 'now' | 'none'
}

// Registration goes through the real action. The default defers it by a
// microtask, the way a Svelte action effect runs after insertion.
function mount(index: number, chatId: string, inner = '', options: MountOptions = {}) {
    const el = buildRoot(index, chatId, inner)
    const parent = options.parent ?? document.body
    parent.insertBefore(el, options.before ?? null)
    const mode = options.register ?? 'microtask'
    const register = () => {
        handles.set(el, reg.registerMessageRoot(el, { index, chatId }))
    }
    if (mode === 'now') {
        register()
    } else if (mode === 'microtask') {
        queueMicrotask(register)
    }
    return el
}

function unmount(el: Element) {
    handles.get(el)?.destroy?.()
    handles.delete(el)
    el.remove()
}

beforeEach(async () => {
    vi.useFakeTimers()
    FakeAudio.instances = []
    FakeAudio.playImpl = () => Promise.resolve()
    vi.stubGlobal('Audio', FakeAudio)
    vi.resetModules()
    reg = await import('./messageRootRegistry')
    startFn = (await import('./observer.svelte')).startObserveDom as unknown as () => () => void
})

afterEach(() => {
    if (typeof dispose === 'function') {
        dispose()
    }
    dispose = null
    for (const handle of handles.values()) {
        handle.destroy?.()
    }
    handles.clear()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

describe('idle cost', () => {
    it('T-I1 runs no document query and holds no timer while idle', async () => {
        mount(5, 'm5', ctrl('/a.mp3') + '<pre x-hl-lang="js"><code>x</code></pre>', { register: 'now' })
        start()
        await flush()
        const spy = vi.spyOn(Document.prototype, 'querySelectorAll')
        await advance(10000)
        expect(spy).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('governing control', () => {
    it.each([
        ['older root first', false],
        ['newest root first', true],
    ])('T-G1 plays only the newest message (%s)', async (_name, newestFirst) => {
        const newest = () => mount(5, 'm5', ctrl('/b.mp3'), { register: 'now' })
        const older = () => mount(3, 'm3', ctrl('/a.mp3'), { register: 'now' })
        if (newestFirst) {
            newest()
            older()
        } else {
            older()
            newest()
        }
        start()
        await flush()
        await advance(1000)
        expect(constructed()).toEqual(['/b.mp3'])
        expect(pauses()).toBe(0)
    })

    it.each([
        ['after the oldest root', 'after'],
        ['before every root', 'before'],
    ])('T-G2 scroll-back never changes the track (%s)', async (_name, where) => {
        const newest = mount(5, 'm5', ctrl('/b.mp3'), { register: 'now' })
        start()
        await flush()
        expect(constructed()).toEqual(['/b.mp3'])
        mount(2, 'm2', ctrl('/c.mp3'), { register: 'now', before: where === 'before' ? newest : null })
        await flush()
        await advance(500)
        expect(constructed()).toEqual(['/b.mp3'])
        expect(pauses()).toBe(0)
    })

    it('T-R1 authored data-chat-index inside an older message cannot outrank a newer one', async () => {
        mount(3, 'm3', `<div data-chat-index="999">${ctrl('/f.mp3')}</div>`, { register: 'now' })
        mount(5, 'm5', ctrl('/b.mp3'), { register: 'now' })
        start()
        await flush()
        await advance(500)
        expect(constructed()).toEqual(['/b.mp3'])
    })

    it('T-R1b an unregistered element with a forged rank is outside every message', async () => {
        document.body.insertAdjacentHTML('beforeend',
            `<div data-chat-index="9999" data-chat-id="m5">${ctrl('https://x/y.mp3')}</div>`)
        mount(5, 'm5', ctrl('/b.mp3'), { register: 'now' })
        start()
        await flush()
        await advance(500)
        expect(constructed()).toEqual(['/b.mp3'])
    })

    it('T-R2 a control outside any message plays only when no message control is mounted', async () => {
        document.body.insertAdjacentHTML('beforeend', ctrl('/x.mp3'))
        const root = mount(5, 'm5', ctrl('/b.mp3'), { register: 'now' })
        start()
        await flush()
        await advance(500)
        expect(constructed()).toEqual(['/b.mp3'])
        unmount(root)
        await flush()
        expect(constructed()).toEqual(['/b.mp3', '/x.mp3'])
        expect(pauses()).toBe(1)
    })

    it('T-R3 two controls in one message: the first in document order governs', async () => {
        mount(5, 'm5', ctrl('/a.mp3') + ctrl('/b.mp3'), { register: 'now' })
        start()
        await flush()
        await advance(500)
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it.each([
        ['10 over 9, 10 first', 10, '/ten.mp3', 9, '/nine.mp3', true],
        ['10 over 9, 9 first', 10, '/ten.mp3', 9, '/nine.mp3', false],
        ['0 over -1, 0 first', 0, '/zero.mp3', -1, '/first.mp3', true],
        ['0 over -1, -1 first', 0, '/zero.mp3', -1, '/first.mp3', false],
    ])('T-R4 ranks compare as integers (%s)', async (_name, hi, hiSrc, lo, loSrc, hiFirst) => {
        const addHi = () => mount(hi, `h${hi}`, ctrl(hiSrc), { register: 'now' })
        const addLo = () => mount(lo, `l${lo}`, ctrl(loSrc), { register: 'now' })
        if (hiFirst) {
            addHi()
            addLo()
        } else {
            addLo()
            addHi()
        }
        start()
        await flush()
        await advance(500)
        expect(constructed()).toEqual([hiSrc])
    })

    it('T-R5 an equal-rank tie follows document order, not insertion order', async () => {
        const root = mount(5, 'm5', '', { register: 'now' })
        start()
        await flush()
        root.insertAdjacentHTML('beforeend', ctrl('/b.mp3'))
        root.insertAdjacentHTML('afterbegin', ctrl('/a.mp3'))
        await flush()
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it('T-R6 a registry update re-ranks without any DOM mutation', async () => {
        mount(5, 'm5', ctrl('/b.mp3'), { register: 'now' })
        const lower = mount(3, 'm3', ctrl('/a.mp3'), { register: 'now' })
        start()
        await flush()
        expect(constructed()).toEqual(['/b.mp3'])
        handles.get(lower)?.update?.({ index: 9, chatId: 'm3' })
        await flush()
        expect(constructed()).toEqual(['/b.mp3', '/a.mp3'])
    })
})

describe('discovery', () => {
    it('T-C1 plays controls that were mounted before start', async () => {
        mount(5, 'm5', ctrl('/a.mp3'), { register: 'now' })
        start()
        await flush()
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it('T-D1 plays a nested control inserted after start without any poll interval', async () => {
        start()
        await flush()
        mount(5, 'm5', `<div><div>${ctrl('/a.mp3')}</div></div>`)
        await drainMicrotasks()
        await flush()
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it('T-D2 plays a control whose risu-ctrl attribute is added after insertion', async () => {
        start()
        await flush()
        const root = mount(5, 'm5', '<div class="slot"></div>')
        await drainMicrotasks()
        await flush()
        expect(constructed()).toEqual([])
        root.querySelector('.slot')!.setAttribute('risu-ctrl', ctrlValue('/a.mp3'))
        await drainMicrotasks()
        await flush()
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it('T-C2 ignores a non-bgm control and does not silence the governing bgm', async () => {
        mount(7, 'm7', '<div risu-ctrl="other___x"></div>', { register: 'now' })
        mount(5, 'm5', ctrl('/b.mp3'), { register: 'now' })
        start()
        await flush()
        expect(constructed()).toEqual(['/b.mp3'])
    })

    it('T-O1 never reconciles before a late-registered root is known (cold start)', async () => {
        start()
        let delivered = false
        const probe = new MutationObserver(() => { delivered = true })
        probe.observe(document.documentElement, { childList: true, subtree: true })
        await flush()
        expect(constructed()).toEqual([])
        document.body.insertAdjacentHTML('afterbegin', ctrl('/g.mp3'))
        const container = document.createElement('div')
        const root = buildRoot(0, 'm0', ctrl('/b.mp3'))
        container.append(root)
        document.body.append(container)
        await Promise.resolve()
        expect(delivered).toBe(true)
        await drainMicrotasks()
        expect(constructed()).toEqual([])
        handles.set(root, reg.registerMessageRoot(root, { index: 0, chatId: 'm0' }))
        await flush()
        await advance(1000)
        expect(constructed()).toEqual(['/b.mp3'])
        probe.disconnect()
    })

    it('T-O1b a root registered while detached plays the message control only', async () => {
        start()
        await flush()
        document.body.insertAdjacentHTML('afterbegin', ctrl('/g.mp3'))
        const container = document.createElement('div')
        const root = buildRoot(0, 'm0', ctrl('/b.mp3'))
        container.append(root)
        handles.set(root, reg.registerMessageRoot(root, { index: 0, chatId: 'm0' }))
        document.body.append(container)
        await drainMicrotasks()
        await flush()
        await advance(1000)
        expect(constructed()).toEqual(['/b.mp3'])
    })

    it('T-T1 a control added and removed in one task is never constructed', async () => {
        const root = mount(5, 'm5', '', { register: 'now' })
        start()
        await flush()
        root.insertAdjacentHTML('beforeend', ctrl('/a.mp3'))
        root.lastElementChild!.remove()
        await flush()
        await advance(1000)
        expect(constructed()).toEqual([])
    })

    it('T-T2 a governing control moved inside its root is neither paused nor rebuilt', async () => {
        const root = mount(5, 'm5', '<div class="w1">' + ctrl('/c.mp3') + '</div><div class="w2"></div>', { register: 'now' })
        start()
        await flush()
        const control = root.querySelector('[risu-ctrl]')!
        root.querySelector('.w2')!.appendChild(control)
        await flush()
        await advance(3000)
        expect(pauses()).toBe(0)
        expect(constructed()).toEqual(['/c.mp3'])
    })
})

describe('playback rules', () => {
    it('T-L1 loops the governing track and never re-creates it', async () => {
        mount(5, 'm5', ctrl('/a.mp3'), { register: 'now' })
        start()
        await flush()
        expect(FakeAudio.instances[0].loop).toBe(true)
        FakeAudio.instances[0].dispatchEvent(new Event('ended'))
        await advance(500)
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it('T-S1 pauses when the governing message is removed', async () => {
        const root = mount(5, 'm5', ctrl('/a.mp3'), { register: 'now' })
        start()
        await flush()
        unmount(root)
        await flush()
        expect(pauses()).toBe(1)
        await advance(500)
        expect(pauses()).toBe(1)
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it.each([
        ['volume above 1', ctrlValue('/b.mp3', 2)],
        ['volume NaN', ctrlValue('/b.mp3', 'abc')],
        ['empty source', ctrlValue('', 'auto')],
    ])('T-X1 a malformed newest control is silent and does not fall back (%s)', async (_name, value) => {
        mount(6, 'm6', `<div risu-ctrl="${value}"></div>`, { register: 'now' })
        mount(3, 'm3', ctrl('/older.mp3'), { register: 'now' })
        start()
        await flush()
        await advance(500)
        expect(constructed()).toEqual([])
        mount(7, 'm7', ctrl('/e.mp3'), { register: 'now' })
        await flush()
        expect(constructed()).toEqual(['/e.mp3'])
        document.body.insertAdjacentHTML('beforeend', '<pre x-hl-lang="js"><code>x</code></pre>')
        const code = document.body.querySelector('code')!
        code.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        expect(document.getElementById('code-contextmenu')).not.toBeNull()
    })

    it('T-P1 a denied play() stays silent and is never retried', async () => {
        FakeAudio.playImpl = () => Promise.reject(new DOMException('', 'NotAllowedError'))
        const root = mount(5, 'm5', ctrl('/a.mp3'), { register: 'now' })
        start()
        await flush()
        document.body.insertAdjacentHTML('beforeend', '<div class="unrelated"></div>')
        await flush()
        unmount(root)
        mount(5, 'm5', ctrl('/a.mp3'), { register: 'now' })
        await flush()
        await advance(500)
        expect(constructed()).toEqual(['/a.mp3'])
        expect(plays()).toBe(1)
    })

    it('T-P2 an AbortError after a pause is consumed', async () => {
        let rejectPlay: (reason: unknown) => void = () => {}
        FakeAudio.playImpl = () => new Promise<void>((_resolve, reject) => { rejectPlay = reject })
        const root = mount(5, 'm5', ctrl('/a.mp3'), { register: 'now' })
        start()
        await flush()
        unmount(root)
        await flush()

        const captured: unknown[] = []
        const capture = (reason: unknown) => { captured.push(reason) }
        process.on('unhandledRejection', capture)
        try {
            rejectPlay(new DOMException('', 'AbortError'))
            vi.useRealTimers()
            await new Promise(resolve => setTimeout(resolve, 0))
        } finally {
            process.off('unhandledRejection', capture)
        }
        expect(captured).toEqual([])
        expect(pauses()).toBe(1)
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it('T-V1 applies a volume change on the same source without a new track', async () => {
        const root = mount(5, 'm5', ctrl('/a.mp3'), { register: 'now' })
        start()
        await flush()
        root.querySelector('[risu-ctrl]')!.setAttribute('risu-ctrl', ctrlValue('/a.mp3', 0.2))
        await flush()
        await advance(200)
        expect(FakeAudio.instances[0].volume).toBe(0.2)
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it('T-E1 a throw during reconcile leaves discovery working', async () => {
        FakeAudio.playImpl = (audio) => {
            if (audio.src === '/boom.mp3') {
                throw new Error('boom')
            }
            return Promise.resolve()
        }
        vi.spyOn(console, 'error').mockImplementation(() => {})
        mount(5, 'm5', ctrl('/boom.mp3'), { register: 'now' })
        start()
        await flush()
        mount(6, 'm6', ctrl('/e.mp3'), { register: 'now' })
        document.body.insertAdjacentHTML('beforeend', '<pre x-hl-lang="js"><code>x</code></pre>')
        await flush()
        expect(constructed()).toEqual(['/boom.mp3', '/e.mp3'])
        document.body.querySelector('code')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        expect(document.getElementById('code-contextmenu')).not.toBeNull()
    })
})

describe('remount hold', () => {
    async function playing() {
        const root = mount(5, 'm5', ctrl('/a.mp3'), { register: 'now' })
        start()
        await flush()
        expect(constructed()).toEqual(['/a.mp3'])
        return root
    }

    it('T-H1 keeps the track when the control returns within the hold', async () => {
        const old = await playing()
        unmount(old)
        const fresh = mount(5, 'm5', '', { register: 'now' })
        await flush()
        await advance(HOLD_MS / 2)
        fresh.insertAdjacentHTML('beforeend', ctrl('/a.mp3'))
        await flush()
        await advance(HOLD_MS * 2)
        expect(pauses()).toBe(0)
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it('T-H2 stops exactly at the end of the hold when the control never returns', async () => {
        const old = await playing()
        unmount(old)
        mount(5, 'm5', '', { register: 'now' })
        await flush()
        await advance(HOLD_MS - 1)
        expect(pauses()).toBe(0)
        await advance(2)
        expect(pauses()).toBe(1)
        await advance(HOLD_MS * 2)
        expect(pauses()).toBe(1)
    })

    it('T-H3 an older control cannot take over during the hold', async () => {
        const old = await playing()
        unmount(old)
        mount(5, 'm5', '', { register: 'now' })
        await flush()
        mount(3, 'm3', ctrl('/c.mp3'), { register: 'now' })
        await flush()
        await advance(HOLD_MS - 100)
        expect(constructed()).toEqual(['/a.mp3'])
        expect(pauses()).toBe(0)
    })

    it('T-H4 a message without a chat id gets no hold', async () => {
        const old = mount(5, '', ctrl('/a.mp3'), { register: 'now' })
        start()
        await flush()
        unmount(old)
        mount(5, '', '', { register: 'now' })
        await flush()
        expect(pauses()).toBe(1)
    })

    it('T-R1c an unregistered element with the held chat id does not keep a hold', async () => {
        const old = await playing()
        unmount(old)
        document.body.insertAdjacentHTML('beforeend', '<div class="risu-chat" data-chat-index="5" data-chat-id="m5"></div>')
        await flush()
        expect(pauses()).toBe(1)
    })

    it('T-H5 a remounted root that already holds another source switches at once', async () => {
        const old = await playing()
        unmount(old)
        mount(5, 'm5', ctrl('/d.mp3'), { register: 'now' })
        await flush()
        expect(pauses()).toBe(1)
        expect(constructed()).toEqual(['/a.mp3', '/d.mp3'])
    })

    it('T-H5b a remounted root holding a malformed control goes silent at once', async () => {
        const old = await playing()
        unmount(old)
        mount(5, 'm5', `<div risu-ctrl="${ctrlValue('/d.mp3', 2)}"></div>`, { register: 'now' })
        await flush()
        expect(pauses()).toBe(1)
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it('T-H6 a same-source take-over moves the hold to the new owner message', async () => {
        const older = mount(3, 'm3', ctrl('/a.mp3'), { register: 'now' })
        start()
        await flush()
        const newer = mount(4, 'm4', ctrl('/a.mp3'), { register: 'now' })
        await flush()
        unmount(older)
        await flush()
        newer.firstElementChild!.remove()
        await flush()
        expect(pauses()).toBe(0)
        await advance(HOLD_MS + 1)
        expect(pauses()).toBe(1)
        expect(constructed()).toEqual(['/a.mp3'])
    })

    it('T-H7 a same-source take-over cancels the hold so a later vanish is held again', async () => {
        const old = await playing()
        unmount(old)
        const fresh = mount(5, 'm5', '', { register: 'now' })
        await flush()
        await advance(HOLD_MS / 2)
        fresh.insertAdjacentHTML('beforeend', ctrl('/a.mp3'))
        await flush()
        await advance(HOLD_MS)
        fresh.firstElementChild!.remove()
        await flush()
        expect(pauses()).toBe(0)
        await advance(HOLD_MS + 1)
        expect(pauses()).toBe(1)
    })

    it('T-H8 removing a control that sits outside any message stops playback', async () => {
        document.body.insertAdjacentHTML('beforeend', ctrl('/x.mp3'))
        start()
        await flush()
        expect(constructed()).toEqual(['/x.mp3'])
        document.body.firstElementChild!.remove()
        await flush()
        expect(pauses()).toBe(1)
    })
})

describe('reconcile failure', () => {
    it('T-E2 a throw while starting a track stops the half-started player', async () => {
        FakeAudio.playImpl = () => {
            throw new Error('boom')
        }
        vi.spyOn(console, 'error').mockImplementation(() => {})
        mount(5, 'm5', ctrl('/boom.mp3'), { register: 'now' })
        start()
        await flush()
        expect(constructed()).toEqual(['/boom.mp3'])
        expect(pauses()).toBe(1)
    })
})

describe('start contract', () => {
    it('T-M2 a second start returns the same disposer and observes once', () => {
        const observe = vi.spyOn(MutationObserver.prototype, 'observe')
        const first = start()
        const second = start()
        expect(second).toBe(first)
        expect(observe).toHaveBeenCalledTimes(1)
    })
})

describe('message root registry', () => {
    it('registers, updates and unregisters a root', () => {
        const el = document.createElement('div')
        const inner = document.createElement('span')
        el.append(inner)
        document.body.append(el)
        const action = reg.registerMessageRoot(el, { index: 4, chatId: 'a' })
        expect(reg.messageRootOf(inner)).toEqual({ root: el, info: { index: 4, chatId: 'a' } })
        action.update({ index: 6, chatId: 'b' })
        expect(reg.messageRootOf(el)?.info).toEqual({ index: 6, chatId: 'b' })
        expect(reg.connectedMessageRoots().map(r => r.root)).toEqual([el])
        el.remove()
        expect(reg.connectedMessageRoots()).toEqual([])
        action.destroy()
        expect(reg.messageRootOf(el)).toBeNull()
    })
})
