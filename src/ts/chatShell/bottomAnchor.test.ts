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
})
