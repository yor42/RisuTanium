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
    test('reproducer: drops the single newline markdown-it emits after <br>', () => {
        const div = parseHtml('Line 1<br>\nLine 2')
        expect(getNodetextToSentence(div)).toBe('Line 1\nLine 2')
    })

    test('reproducer: handles multiple consecutive <br>\\n soft breaks without doubling', () => {
        const div = parseHtml('First<br>\nSecond<br>\nThird')
        expect(getNodetextToSentence(div)).toBe('First\nSecond\nThird')
    })

    test('reproducer: strips only the first newline after <br>, preserving an intentional blank line', () => {
        const div = parseHtml('First<br>\n\nSecond')
        expect(getNodetextToSentence(div)).toBe('First\n\nSecond')
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
