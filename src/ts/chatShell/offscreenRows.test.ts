// @vitest-environment jsdom
// Off-screen classification measures each row's container, never the article inside it: a read inside a skipped container forces that row's layout.
import { describe, expect, test, vi } from 'vitest'
import { offscreenRowCounts } from './offscreenRows'

function rect(top: number, height: number): DOMRect {
    return { x: 0, y: top, top, left: 0, right: 0, bottom: top + height, width: 0, height, toJSON: () => ({}) }
}
function stub(element: HTMLElement, top: number, height: number): ReturnType<typeof vi.fn> {
    const read = vi.fn(() => rect(top, height))
    element.getBoundingClientRect = read
    return read
}
// The template's shape: a list of containers, each holding one article.
function list(): HTMLElement {
    const rows = document.createElement('div')
    rows.setAttribute('data-part', 'chat-message-list')
    return rows
}
function container(rows: HTMLElement, index: number): { box: HTMLElement, article: HTMLElement } {
    const box = document.createElement('div')
    box.setAttribute('data-part', 'chat-message-container')
    box.className = 'older'
    const article = document.createElement('article')
    article.setAttribute('data-part', 'chat-message')
    article.setAttribute('data-chat-index', String(index))
    box.appendChild(article)
    rows.appendChild(box)
    return { box, article }
}
function scroller(): HTMLElement {
    const host = document.createElement('main')
    stub(host, 0, 600)
    return host
}

describe('offscreenRowCounts', () => {
    test('U1: the container decides the class and the article is never read', () => {
        const rows = list()
        const { box, article } = container(rows, 5)
        stub(box, -400, 100)
        const articleRead = stub(article, 100, 100)
        expect(offscreenRowCounts(scroller(), rows)).toEqual({ newer: 0, older: 1 })
        expect(articleRead).not.toHaveBeenCalled()
    })
    test('U2: a first message without a container is measured through its own article', () => {
        const rows = list()
        const wrapper = document.createElement('div')
        wrapper.setAttribute('data-part', 'chat-first-message')
        const article = document.createElement('article')
        article.setAttribute('data-part', 'chat-message')
        article.setAttribute('data-chat-index', '-1')
        wrapper.appendChild(article)
        rows.appendChild(wrapper)
        stub(article, -300, 100)
        expect(offscreenRowCounts(scroller(), rows)).toEqual({ newer: 0, older: 1 })
    })
    test('U3: a container holding only a render-failed note is not counted', () => {
        const rows = list()
        const box = document.createElement('div')
        box.setAttribute('data-part', 'chat-message-container')
        const failed = document.createElement('div')
        failed.setAttribute('data-part', 'chat-message-failed')
        box.appendChild(failed)
        rows.appendChild(box)
        stub(box, 900, 100)
        expect(offscreenRowCounts(scroller(), rows)).toEqual({ newer: 0, older: 0 })
    })
    test('U4: a row touching an edge counts, a row straddling an edge does not', () => {
        const rows = list()
        stub(container(rows, 1).box, 600, 50)
        stub(container(rows, 2).box, -50, 50)
        stub(container(rows, 3).box, 590, 50)
        stub(container(rows, 4).box, -40, 50)
        expect(offscreenRowCounts(scroller(), rows)).toEqual({ newer: 1, older: 1 })
    })
    test('no list mounted counts nothing', () => {
        expect(offscreenRowCounts(scroller(), undefined)).toEqual({ newer: 0, older: 0 })
    })
})
