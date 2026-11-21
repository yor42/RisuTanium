// @vitest-environment jsdom
/**
 * The story card's last line (`storySnippet.ts`).
 *
 * Invariants exercised here:
 * - The snippet is plain text, never markup: tags, macros and markdown are
 *   stripped, and macros are never resolved.
 * - The last message of any role is used; an empty, archived or unloaded chat
 *   has no snippet and the first message is never substituted.
 * - Work is bounded: a huge message yields at most 200 characters.
 */
import { describe, test, expect } from 'vitest'
import type { Chat } from '../../../ts/storage/database.svelte'
import { coldStorageHeader, formatColdStorageLoadError } from '../../../ts/process/coldstorageData'
import { storySnippet } from './storySnippet'

function chatOf(...messages: Array<{ role?: 'user' | 'char'; data: unknown }>): Chat {
    return {
        id: 'c', name: 'n', note: '', localLore: [],
        message: messages.map((m, i) => ({ role: m.role ?? 'char', data: m.data, time: i })),
    } as unknown as Chat
}

function last(data: unknown): string {
    return storySnippet(chatOf({ data: 'first' }, { data }))
}

describe('storySnippet', () => {
    test('S3a-U7: markup, macros and markdown are stripped, not resolved', () => {
        expect(last('<img src=x onerror=alert(1)>{{char}} *hi*')).toBe('hi')
        expect(last('Hello {{user}}')).toBe('Hello')
        expect(last('{{#if {{getvar::x}}}}shown{{/if}} tail')).toBe('shown tail')
        expect(last('{{char}}')).toBe('')
        expect(last('<b></b>')).toBe('')
        expect(last('<style>.a{color:red}</style>Real')).toBe('Real')
        expect(last('<STYLE>.a{}</STYLE>Real')).toBe('Real')
        expect(last('<script>x()</script>')).toBe('')
        expect(last('Visible <script>never closed')).toBe('Visible')
        expect(last('Text {{unclosed')).toBe('Text')
        expect(last('[link](https://x.invalid) and ![pic](p.png)')).toBe('link and pic')
    })

    test('S3a-U7: the output holds no markup an HTML parser would turn into elements', () => {
        const out = last('<img src=x onerror=alert(1)><a href="javascript:x">l</a> **b** <iframe src=x></iframe>')
        const host = document.createElement('div')
        host.textContent = out
        expect(host.children).toHaveLength(0)
        expect(out).not.toMatch(/[<>]/)
        expect(out).toBe('l b')
    })

    test('S3a-U7: the last message of any role is used', () => {
        const chat = chatOf({ role: 'char', data: 'from char' }, { role: 'user', data: 'from user' })
        expect(storySnippet(chat)).toBe('from user')
    })

    test('S3a-U7: an empty chat, a null chat and a non-string body give nothing', () => {
        expect(storySnippet(null)).toBe('')
        expect(storySnippet(chatOf())).toBe('')
        expect(last(42)).toBe('')
        expect(last(undefined)).toBe('')
    })

    test('S3a-U7: a huge message is cut to 200 characters', () => {
        const out = last('word '.repeat(10_000))
        expect(out.length).toBeLessThanOrEqual(200)
        expect(out.length).toBeGreaterThan(0)
    })

    test('S3a-U8: an unloaded chat has no snippet', () => {
        expect(storySnippet(chatOf({ data: `${coldStorageHeader}unit-9` }, { data: 'tail' }))).toBe('')
        expect(storySnippet(chatOf({ data: formatColdStorageLoadError('k') }, { data: 'tail' }))).toBe('')
    })
})
