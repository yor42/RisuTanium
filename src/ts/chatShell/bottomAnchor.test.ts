import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createBottomFollower, isScrolledToBottom, shouldAnchorBottom } from './bottomAnchor'
import type { IntentDirection, ReaderIntentListener, ReaderIntentSource } from './readerIntent'
import { asShellFocus } from './shellFocus'

describe('T bottom anchor decision', () => {
    test('anchors the newest edge when a visible bottom reader gets a shorter viewport', () => {
        expect(shouldAnchorBottom({ wasAtBottom: true, surfaceHidden: false, previousHeight: 640, nextHeight: 380 })).toBe(true)
    })
    test('does not move a reader above the bottom or a hidden surface', () => {
        expect(shouldAnchorBottom({ wasAtBottom: false, surfaceHidden: false, previousHeight: 640, nextHeight: 380 })).toBe(false)
        expect(shouldAnchorBottom({ wasAtBottom: true, surfaceHidden: true, previousHeight: 640, nextHeight: 380 })).toBe(false)
        expect(shouldAnchorBottom({ wasAtBottom: true, surfaceHidden: false, previousHeight: 380, nextHeight: 640 })).toBe(false)
    })
})

function fakeIntent() {
    const listeners = new Set<ReaderIntentListener>()
    const source: ReaderIntentSource = { subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
    return { source, count: () => listeners.size, send: (direction: IntentDirection) => { for (const listener of [...listeners]) listener({ direction, distance: 30, source: 'touch' }) } }
}

describe('bottom follower', () => {
    let fire: () => void = () => {}
    let disconnected = false
    class FakeObserver {
        constructor(callback: () => void) { fire = callback }
        observe(): void {}
        disconnect(): void { disconnected = true }
    }
    beforeEach(() => { disconnected = false; vi.stubGlobal('ResizeObserver', FakeObserver) })
    afterEach(() => { vi.unstubAllGlobals() })

    const newest = () => 5

    function liveHost(scrollHeight: number, scrollTop: number) {
        const writes: number[] = []
        const target = new EventTarget()
        const host = Object.assign(target, { scrollHeight, clientHeight: 100, scrollTop })
        Object.defineProperty(host, 'scrollTop', { get: () => scrollTop, set: (value: number) => { writes.push(value); scrollTop = value }, configurable: true })
        return { host: host as unknown as HTMLElement, target, writes, grow: (to: number) => { host.scrollHeight = to }, land: (top: number) => { scrollTop = top } }
    }

    function follow(host: HTMLElement, canFollow: () => boolean = () => true) {
        const intent = fakeIntent()
        return { intent, follower: createBottomFollower(host, {} as Element, canFollow, intent.source, newest) }
    }

    test('sub-pixel gaps count as the bottom', () => {
        expect(isScrolledToBottom({ scrollHeight: 353.5, clientHeight: 100, scrollTop: 253.25 })).toBe(true)
        expect(isScrolledToBottom({ scrollHeight: 353.5, clientHeight: 100, scrollTop: 204.75 })).toBe(false)
    })
    test('a bottom reader follows the newest row growing to its final height', () => {
        const { host, writes, grow } = liveHost(300, 200)
        follow(host).follower.sync()
        grow(354)
        fire()
        expect(writes).toEqual([254])
    })
    test('a reader who started away from the bottom is not moved', () => {
        const { host, writes, grow } = liveHost(300, 120)
        follow(host).follower.sync()
        grow(354)
        fire()
        expect(writes).toEqual([])
    })
    test('one size change writes once, and an unchanged position writes nothing', () => {
        const { host, writes, grow } = liveHost(300, 200)
        follow(host).follower.sync()
        grow(354)
        fire()
        fire()
        expect(writes).toEqual([254])
    })
    describe('while a step hold is in flight', () => {
        function heldFollower(host: HTMLElement) {
            const state = { held: false }
            const intent = fakeIntent()
            return { state, follower: createBottomFollower(host, {} as Element, () => true, intent.source, newest, () => state.held) }
        }
        test('a resize writes nothing, and a reader off the bottom is not re-entered by the transient layout', () => {
            const { host, writes, grow, land } = liveHost(300, 100)
            const { state, follower } = heldFollower(host)
            expect(follower.isFollowing()).toBe(false)
            state.held = true
            land(200)
            follower.sync()
            expect(follower.isFollowing()).toBe(false)
            grow(354)
            fire()
            expect(writes).toEqual([])
            state.held = false
            land(100)
            follower.sync()
            expect(follower.isFollowing()).toBe(false)
        })
        test('a following reader gets the skipped size change applied by the first sync after the hold, once', () => {
            const { host, writes, grow } = liveHost(300, 200)
            const { state, follower } = heldFollower(host)
            expect(follower.isFollowing()).toBe(true)
            state.held = true
            grow(354)
            fire()
            follower.sync()
            expect(writes).toEqual([])
            state.held = false
            follower.sync()
            expect(writes).toEqual([254])
            follower.sync()
            expect(writes).toEqual([254])
        })
        test('a reader released during the hold does not get the skipped size change applied', () => {
            const { host, writes, grow } = liveHost(300, 200)
            const { state, follower } = heldFollower(host)
            state.held = true
            grow(354)
            fire()
            follower.release()
            state.held = false
            follower.sync()
            expect(writes).toEqual([])
        })
    })
    test('the follow gate and dispose are honoured', () => {
        const { host, writes, grow } = liveHost(300, 200)
        let allowed = false
        const { follower, intent } = follow(host, () => allowed)
        follower.sync()
        grow(354)
        fire()
        expect(writes).toEqual([])
        allowed = true
        fire()
        expect(writes).toEqual([254])
        follower.dispose()
        expect(disconnected).toBe(true)
        expect(intent.count()).toBe(0)
    })
    test('a late scroll event for our own write after more growth keeps following', () => {
        const { host, writes, grow } = liveHost(300, 200)
        const { follower } = follow(host)
        grow(354)
        fire()
        expect(writes).toEqual([254])
        grow(400)
        follower.sync()
        grow(460)
        fire()
        expect(writes).toEqual([254, 360])
    })

    // T-A4a: a clamp or an anchoring adjustment lowers scrollTop with no reader input behind it.
    test('a scrollTop decrease with no gesture does not stop following', () => {
        const { host, writes, grow, land } = liveHost(300, 200)
        const { follower } = follow(host)
        land(150)
        follower.sync()
        expect(follower.isFollowing()).toBe(true)
        grow(354)
        fire()
        expect(writes).toEqual([254])
    })
    // T-A4b: a tap raises pointerdown and touchstart but is no scrolling.
    test('a tap followed by a clamp scroll keeps following', () => {
        const { host, target, writes, grow, land } = liveHost(300, 200)
        const { follower } = follow(host)
        target.dispatchEvent(new Event('pointerdown'))
        target.dispatchEvent(new Event('touchstart'))
        land(150)
        follower.sync()
        grow(354)
        fire()
        expect(writes).toEqual([254])
    })
    // T-A4c
    test('an older intent leaves following, a newer intent does not, and reaching the bottom re-enters', () => {
        const { host, writes, grow, land } = liveHost(300, 200)
        const { follower, intent } = follow(host)
        intent.send('newer')
        expect(follower.isFollowing()).toBe(true)
        intent.send('older')
        expect(follower.isFollowing()).toBe(false)
        grow(354)
        fire()
        expect(writes).toEqual([])
        land(254)
        follower.sync()
        expect(follower.isFollowing()).toBe(true)
        grow(400)
        fire()
        expect(writes).toEqual([300])
    })
    test('release after an app jump away is not pulled back, and the bottom re-enters', () => {
        const { host, writes, grow, land } = liveHost(300, 200)
        const { follower } = follow(host)
        land(120)
        follower.release()
        follower.sync()
        grow(354)
        fire()
        expect(writes).toEqual([])
        land(254)
        follower.sync()
        grow(400)
        fire()
        expect(writes).toEqual([300])
    })
    test('an app jump to the newest message makes later growth follow, though the host was not at the bottom', () => {
        const { host, writes, grow, land } = liveHost(300, 120)
        const { follower } = follow(host)
        grow(354)
        land(200)
        follower.follow()
        fire()
        grow(420)
        fire()
        expect(writes).toEqual([254, 320])
    })
    test('without the jump a reader away from the bottom is not followed', () => {
        const { host, writes, grow, land } = liveHost(300, 120)
        const { follower } = follow(host)
        grow(354)
        land(200)
        follower.sync()
        fire()
        grow(420)
        fire()
        expect(writes).toEqual([])
    })
    test('follow has no effect while the follow gate is closed', () => {
        const { host, writes, grow, land } = liveHost(300, 120)
        let allowed = false
        const { follower } = follow(host, () => allowed)
        grow(354)
        land(200)
        follower.follow()
        allowed = true
        fire()
        expect(writes).toEqual([])
    })
    describe('while the newest message is not mounted', () => {
        function windowed(host: HTMLElement, held: () => boolean = () => false) {
            const state = { mounted: true }
            const intent = fakeIntent()
            return { state, follower: createBottomFollower(host, {} as Element, () => true, intent.source, newest, held, () => state.mounted) }
        }
        test('T7: a size change at the bottom of the mounted rows writes nothing until the newest message is mounted', () => {
            const { host, writes, grow } = liveHost(300, 200)
            const { state, follower } = windowed(host)
            expect(follower.isFollowing()).toBe(true)
            state.mounted = false
            grow(354)
            fire()
            expect(writes).toEqual([])
            state.mounted = true
            fire()
            expect(writes).toEqual([254])
        })
        test('T7: reaching the bottom of the mounted rows does not enter following', () => {
            const { host, land } = liveHost(300, 120)
            const { state, follower } = windowed(host)
            expect(follower.isFollowing()).toBe(false)
            land(200)
            state.mounted = false
            follower.sync()
            expect(follower.isFollowing()).toBe(false)
            state.mounted = true
            follower.sync()
            expect(follower.isFollowing()).toBe(true)
        })
        test('T7: a size change skipped during a hold is not applied while the newest message is unmounted', () => {
            const { host, writes, grow } = liveHost(300, 200)
            const hold = { held: false }
            const { state, follower } = windowed(host, () => hold.held)
            hold.held = true
            grow(354)
            fire()
            hold.held = false
            state.mounted = false
            follower.sync()
            expect(writes).toEqual([])
            state.mounted = true
            follower.sync()
            expect(writes).toEqual([])
        })
        test('T7: follow has no effect until the newest message is mounted', () => {
            const { host } = liveHost(300, 120)
            const { state, follower } = windowed(host)
            state.mounted = false
            follower.follow()
            expect(follower.isFollowing()).toBe(false)
            state.mounted = true
            follower.follow()
            expect(follower.isFollowing()).toBe(true)
        })
    })
    test('after dispose an older intent changes nothing', () => {
        const { host } = liveHost(300, 200)
        const { follower, intent } = follow(host)
        follower.dispose()
        intent.send('older')
        expect(follower.isFollowing()).toBe(true)
    })
})

// T-A6: the focus rule. Real rows carry the attributes the shell renders.
describe('bottom follower focus rule', () => {
    let fire: () => void = () => {}
    class FakeObserver {
        constructor(callback: () => void) { fire = callback }
        observe(): void {}
        disconnect(): void {}
    }
    let current: { host: HTMLElement, writes: number[], grow: (to: number) => void } | null = null
    let height = 300
    let top = 200
    const newest = () => 5

    function domHost(): HTMLElement {
        const host = document.createElement('main')
        Object.defineProperty(host, 'scrollHeight', { get: () => height, configurable: true })
        Object.defineProperty(host, 'clientHeight', { value: 100, configurable: true })
        const writes: number[] = []
        Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { writes.push(value); top = value }, configurable: true })
        for (let index = -1; index <= 5; index++) {
            const row = document.createElement('article')
            row.setAttribute('data-part', 'chat-message')
            row.setAttribute('data-chat-index', String(index))
            row.tabIndex = 0
            const button = document.createElement('button')
            row.appendChild(button)
            host.appendChild(row)
        }
        document.body.appendChild(host)
        current = { host, writes, grow: (to) => { height = to } }
        return host
    }
    const rowAt = (index: number) => current!.host.querySelector<HTMLElement>(`article[data-chat-index="${index}"]`)!

    beforeEach(() => { height = 300; top = 200; vi.stubGlobal('ResizeObserver', FakeObserver) })
    afterEach(() => { current?.host.remove(); current = null; vi.unstubAllGlobals(); vi.useRealTimers() })

    function start() {
        const host = domHost()
        const intent = fakeIntent()
        const follower = createBottomFollower(host, {} as Element, () => true, intent.source, newest)
        return { host, follower, writes: current!.writes, grow: current!.grow }
    }

    test('T-A6a a user focus on an older row leaves following, so the next growth writes nothing', () => {
        const { follower, writes, grow } = start()
        rowAt(2).focus()
        expect(follower.isFollowing()).toBe(false)
        grow(354)
        fire()
        expect(writes).toEqual([])
    })
    test('T-A6a a focus on a control inside an older row, and on the first message, also leaves', () => {
        const first = start()
        rowAt(3).querySelector('button')!.focus()
        expect(first.follower.isFollowing()).toBe(false)
        first.follower.dispose()
        current!.host.remove()
        const second = start()
        rowAt(-1).focus()
        expect(second.follower.isFollowing()).toBe(false)
    })
    test('T-A6b the shell\'s own focus on an older row keeps following', () => {
        const { follower, writes, grow } = start()
        asShellFocus(() => rowAt(2).focus())
        expect(follower.isFollowing()).toBe(true)
        grow(354)
        fire()
        expect(writes).toEqual([254])
    })
    test('T-A6c focus on the newest row keeps following, and a focus already resting there stays harmless when a reply is appended', () => {
        const { follower } = start()
        rowAt(5).focus()
        expect(follower.isFollowing()).toBe(true)
        // A reply appended later makes row 5 non-newest; no focusin fires, so nothing changes.
        expect(follower.isFollowing()).toBe(true)
    })
    test('T-A6c the newest index is read at event time', () => {
        const host = domHost()
        let newestNow = 5
        const follower = createBottomFollower(host, {} as Element, () => true, fakeIntent().source, () => newestNow)
        newestNow = 6
        rowAt(5).focus()
        expect(follower.isFollowing()).toBe(false)
    })
    test('T-A6d a focusin right after the window regained focus is not the reader\'s; one after the timeout is', () => {
        vi.useFakeTimers()
        const { follower } = start()
        window.dispatchEvent(new Event('blur'))
        window.dispatchEvent(new Event('focus'))
        rowAt(2).focus()
        expect(follower.isFollowing()).toBe(true)
        vi.advanceTimersByTime(1)
        rowAt(3).focus()
        expect(follower.isFollowing()).toBe(false)
    })
    test('a focusin outside any row, such as the load-more button, is ignored', () => {
        const { host, follower } = start()
        const stray = document.createElement('button')
        host.appendChild(stray)
        stray.focus()
        expect(follower.isFollowing()).toBe(true)
    })
    test('dispose removes the focus listener', () => {
        const { follower } = start()
        follower.dispose()
        rowAt(2).focus()
        expect(follower.isFollowing()).toBe(true)
    })
})
