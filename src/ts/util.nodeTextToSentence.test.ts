// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock(import('./platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('./platform'))
vi.mock(import('./characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('./characters'))
vi.mock(import('./stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    CustomGUISettingMenuStore: writable(null),
}) as unknown as typeof import('./stores.svelte'))
vi.mock(import('./storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('./storage/database.svelte'))

import { getNodetextToSentence } from './util'

function parseHtml(html: string): HTMLDivElement {
    const div = document.createElement('div')
    div.innerHTML = html
    return div
}

describe('getNodetextToSentence', () => {
    test('keeps an authored newline after a line-break element', () => {
        const div = parseHtml('Line 1<br>&#10;Line 2')
        expect(getNodetextToSentence(div)).toBe('Line 1\n\nLine 2')
    })

    test('handles consecutive line-break elements', () => {
        const div = parseHtml('First<br><br>Second<br>Third')
        expect(getNodetextToSentence(div)).toBe('First\n\nSecond\nThird')
    })

    test('guard: preserves <br> without trailing newline and inline markdown formatting', () => {
        const div = parseHtml('Hello<br>World <del>Deleted</del> <strong>Bold</strong> <em>Italic</em>')
        expect(getNodetextToSentence(div)).toBe('Hello\nWorld ~Deleted~ **Bold** *Italic*')
    })

    test('guard: keeps a leading newline on a text node that does not follow <br>', () => {
        const div = parseHtml('<span>Start</span>\nNext')
        expect(getNodetextToSentence(div)).toBe('Start\nNext')
    })
})
