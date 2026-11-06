import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createBottomFollower, isScrolledToBottom, shouldAnchorBottom } from './bottomAnchor'

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

    function metrics(scrollHeight: number, scrollTop: number) {
        const writes: number[] = []
        const host = { scrollHeight, clientHeight: 100, get scrollTop() { return scrollTop }, set scrollTop(value: number) { writes.push(value); scrollTop = value } }
        return { host: host as unknown as HTMLElement, writes, grow: (to: number) => { host.scrollHeight = to } }
    }

    test('sub-pixel gaps count as the bottom', () => {
        expect(isScrolledToBottom({ scrollHeight: 353.5, clientHeight: 100, scrollTop: 253.25 })).toBe(true)
        expect(isScrolledToBottom({ scrollHeight: 353.5, clientHeight: 100, scrollTop: 204.75 })).toBe(false)
    })
    test('a bottom reader follows the newest row growing to its final height', () => {
        const { host, writes, grow } = metrics(300, 200)
        createBottomFollower(host, {} as Element).sync()
        grow(354)
        fire()
        expect(writes).toEqual([254])
    })
    test('a reader who scrolled up is not moved', () => {
        const { host, writes, grow } = metrics(300, 120)
        const follower = createBottomFollower(host, {} as Element)
        follower.sync()
        grow(354)
        fire()
        expect(writes).toEqual([])
    })
    test('scrolling away stops the following', () => {
        let top = 200
        const { host, writes, grow } = metrics(300, 200)
        Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { writes.push(value); top = value }, configurable: true })
        const follower = createBottomFollower(host, {} as Element)
        follower.sync()
        grow(354)
        fire()
        expect(writes).toEqual([254])
        top = 90
        follower.sync()
        grow(420)
        fire()
        expect(writes).toEqual([254])
    })
    test('one size change writes once, and an unchanged position writes nothing', () => {
        const { host, writes, grow } = metrics(300, 200)
        createBottomFollower(host, {} as Element).sync()
        grow(354)
        fire()
        fire()
        expect(writes).toEqual([254])
    })
    test('the follow gate and dispose are honoured', () => {
        const { host, writes, grow } = metrics(300, 200)
        let allowed = false
        const follower = createBottomFollower(host, {} as Element, () => allowed)
        follower.sync()
        grow(354)
        fire()
        expect(writes).toEqual([])
        allowed = true
        fire()
        expect(writes).toEqual([254])
        follower.dispose()
        expect(disconnected).toBe(true)
    })

    function liveHost(scrollHeight: number, scrollTop: number) {
        const writes: number[] = []
        const target = new EventTarget()
        const host = Object.assign(target, { scrollHeight, clientHeight: 100, scrollTop })
        Object.defineProperty(host, 'scrollTop', { get: () => scrollTop, set: (value: number) => { writes.push(value); scrollTop = value }, configurable: true })
        return { host: host as unknown as HTMLElement, target, writes, grow: (to: number) => { host.scrollHeight = to }, land: (top: number) => { scrollTop = top } }
    }

    test('a late scroll event for our own write after more growth keeps following', () => {
        const { host, writes, grow } = liveHost(300, 200)
        const follower = createBottomFollower(host, {} as Element)
        grow(354)
        fire()
        expect(writes).toEqual([254])
        grow(400)
        follower.sync()
        grow(460)
        fire()
        expect(writes).toEqual([254, 360])
    })
    test('a scroll that moved up turns following off, and reaching the bottom turns it back on', () => {
        const { host, writes, grow, land } = liveHost(300, 200)
        const follower = createBottomFollower(host, {} as Element)
        land(150)
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
    test('reader input followed by a scroll away from the bottom turns following off', () => {
        const { host, target, writes, grow, land } = liveHost(300, 200)
        const follower = createBottomFollower(host, {} as Element)
        target.dispatchEvent(new Event('wheel'))
        grow(400)
        land(200)
        follower.sync()
        fire()
        expect(writes).toEqual([])
    })
    test('reader input alone, or input before the next growth, does not stop the following', () => {
        const { host, target, writes, grow } = liveHost(300, 200)
        const follower = createBottomFollower(host, {} as Element)
        target.dispatchEvent(new Event('pointerdown'))
        grow(354)
        fire()
        grow(400)
        follower.sync()
        fire()
        expect(writes).toEqual([254, 300])
    })
    test('an app jump to the newest message makes later growth follow, though the host was not at the bottom', () => {
        const { host, writes, grow, land } = liveHost(300, 120)
        const follower = createBottomFollower(host, {} as Element)
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
        const follower = createBottomFollower(host, {} as Element)
        grow(354)
        land(200)
        follower.sync()
        fire()
        grow(420)
        fire()
        expect(writes).toEqual([])
    })
    test('after follow a decreased scrollTop turns following off', () => {
        const { host, writes, grow, land } = liveHost(300, 120)
        const follower = createBottomFollower(host, {} as Element)
        grow(354)
        land(200)
        follower.follow()
        land(150)
        follower.sync()
        grow(354)
        fire()
        expect(writes).toEqual([])
    })
    test('follow has no effect while the follow gate is closed', () => {
        const { host, writes, grow, land } = liveHost(300, 120)
        let allowed = false
        const follower = createBottomFollower(host, {} as Element, () => allowed)
        grow(354)
        land(200)
        follower.follow()
        allowed = true
        fire()
        expect(writes).toEqual([])
    })
    test('dispose removes the input listeners', () => {
        const { host, target, writes, grow, land } = liveHost(300, 200)
        const follower = createBottomFollower(host, {} as Element)
        follower.dispose()
        target.dispatchEvent(new Event('wheel'))
        grow(400)
        land(200)
        follower.sync()
        expect(writes).toEqual([])
    })
})
