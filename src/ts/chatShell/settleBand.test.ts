// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CvLayoutModel, ESTIMATE_PX } from '../../lib/ChatShell/cvLayoutModel.test-helpers'
import { settleBand } from './settleBand'

const HOST_HEIGHT = 600
let list: HTMLElement
let model: CvLayoutModel
let heights: Map<number, number>

// The list as the message list renders it: newest row first, the first message and the load-more button after the oldest message,
// and `older` on every container but the newest three.
function build(count: number, options: { first?: boolean, loadMore?: boolean } = {}): void {
    list = document.createElement('div')
    list.dataset.part = 'chat-message-list'
    const addRow = (part: string, index: number, older: boolean): void => {
        const container = document.createElement('div')
        container.dataset.part = part
        container.className = older ? 'chat-message-container older' : 'chat-message-container'
        const article = document.createElement('article')
        article.dataset.part = 'chat-message'
        article.dataset.chatIndex = String(index)
        container.appendChild(article)
        list.appendChild(container)
    }
    for (let index = count - 1; index >= 0; index--) addRow('chat-message-container', index, index < count - 3)
    if (options.first) addRow('chat-first-message', -1, false)
    if (options.loadMore) {
        const button = document.createElement('button')
        button.dataset.part = 'chat-load-more'
        list.appendChild(button)
    }
    document.body.appendChild(list)
    model = new CvLayoutModel({ list, hostHeight: () => HOST_HEIGHT, realHeight: (index) => heights.get(index) ?? 100 })
}
function container(index: number): HTMLElement {
    const found = model.containerOf(index)
    if (!found) throw new Error(`row ${index} is not mounted`)
    return found
}
function forcedIndexes(): number[] {
    return model.mountedIndexes().filter((index) => container(index).style.getPropertyValue('content-visibility') === 'visible')
}
function range(from: number, to: number): number[] {
    return Array.from({ length: to - from + 1 }, (_, offset) => from + offset)
}

beforeEach(() => {
    heights = new Map()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const index = model.indexOf(this)
        if (index === null) return new DOMRect(0, 0, 0, 0)
        const rect = model.rectOf(index)
        return new DOMRect(0, rect.top, 0, rect.height)
    })
})
afterEach(() => {
    list?.remove()
    vi.restoreAllMocks()
})

describe('the layout model', () => {
    test('a skipped row is laid out at the estimate, and a forced row at its real size after the next read', () => {
        build(10)
        expect(model.rectOf(5).height).toBe(ESTIMATE_PX)
        container(5).style.setProperty('content-visibility', 'visible')
        expect(model.rectOf(5).height).toBe(100)
        container(5).style.removeProperty('content-visibility')
        expect(model.rectOf(5).height).toBe(100)
        expect(model.rectOf(8).height).toBe(100)
    })
    test('resolving a row above the anchor moves the scroll position by the change, so the anchor stays still', () => {
        build(10)
        model.write(model.rectOf(5).top + 1200)
        const anchorBefore = model.rectOf(7).top
        container(3).style.setProperty('content-visibility', 'visible')
        expect(model.rectOf(7).top).toBeCloseTo(anchorBefore, 6)
    })
})

describe('settleBand', () => {
    test('U1: forces the target, then older rows until the span above is covered and newer rows until the span below is', () => {
        build(40)
        model.write(model.rectOf(20).top - 200)
        settleBand(container(20), { above: 200, below: 400 })
        // The walk forces in batches of 2, then 4: the older side stops after 2 rows (200 px), the newer side after 6 (700 px from the target top).
        expect(forcedIndexes()).toEqual([...range(18, 20), ...range(21, 26)])
        expect(model.rectOf(20).height).toBe(100)
    })
    test('U1: a tall target covers the span below by itself', () => {
        build(40)
        heights.set(20, 3000)
        settleBand(container(20), { above: 200, below: 400 })
        expect(forcedIndexes()).toEqual([18, 19, 20])
    })
    test('U1: a zero reach forces the target alone', () => {
        build(40)
        settleBand(container(20), { above: 0, below: 0 })
        expect(forcedIndexes()).toEqual([20])
    })
    test('U2: rows above the target are the following siblings in the DOM, so an above-only reach never forces a newer row', () => {
        build(40)
        settleBand(container(20), { above: 300, below: 0 })
        // Batches of 2 then 4 older rows: 200 px is short of 300, 600 px is past it.
        expect(forcedIndexes()).toEqual(range(14, 20))
        expect(container(21).style.getPropertyValue('content-visibility')).toBe('')
    })
    test('U2: a below-only reach forces newer rows and no older one', () => {
        build(40)
        settleBand(container(20), { above: 0, below: 450 })
        expect(forcedIndexes()).toEqual(range(20, 26))
    })
    test('U1: the walk stops where the rows run out and forces the first message but not the load-more button', () => {
        build(6, { first: true, loadMore: true })
        const button = list.querySelector<HTMLElement>('[data-part="chat-load-more"]') as HTMLElement
        settleBand(container(1), { above: 5000, below: 0 })
        expect(forcedIndexes()).toEqual([-1, 0, 1])
        expect(button.style.getPropertyValue('content-visibility')).toBe('')
    })
    test('U3: the release removes the property from the forced rows only, and a second call does nothing', () => {
        build(40)
        container(5).style.setProperty('content-visibility', 'visible')
        const release = settleBand(container(20), { above: 200, below: 400 })
        expect(forcedIndexes()).toContain(20)
        release()
        expect(forcedIndexes()).toEqual([5])
        container(20).style.setProperty('content-visibility', 'visible')
        release()
        expect(forcedIndexes()).toEqual([5, 20])
    })
    test('U3: a row that was already forced before the band is not released by it', () => {
        build(40)
        container(19).style.setProperty('content-visibility', 'visible')
        const release = settleBand(container(20), { above: 200, below: 0 })
        release()
        expect(forcedIndexes()).toEqual([19])
    })
    test('U3: the release works on rows that have left the document', () => {
        build(40)
        const release = settleBand(container(20), { above: 200, below: 400 })
        const rows = forcedIndexes().map(container)
        list.remove()
        expect(() => release()).not.toThrow()
        for (const row of rows) expect(row.style.getPropertyValue('content-visibility')).toBe('')
    })
})
