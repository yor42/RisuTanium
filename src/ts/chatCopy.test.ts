// @vitest-environment happy-dom

/**
 * `copyPlainText` puts plain text on the clipboard and reports the outcome once.
 *
 * Invariants pinned here:
 *  - `navigator.clipboard.writeText` is called synchronously, exactly once, with the text;
 *  - `document.execCommand('copy')` runs only when the clipboard API is absent, throws or rejects;
 *  - a failed outcome names the FIRST failure, even when the fallback also fails;
 *  - the temporary textarea is removed and focus returns to the element that had it before the copy;
 *  - a rejected write leaves no unhandled rejection.
 *
 * The clipboard and `execCommand` are recording stubs; a passing test says
 * nothing about a real browser's gesture or permission rules.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { copyPlainText, stripThoughtsForCopy, type CopyOutcome } from './chatCopy'

const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const realExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')

function stubClipboard(writeText: () => Promise<void>): ReturnType<typeof vi.fn> {
    const spy = vi.fn(writeText)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true })
    return spy
}

function removeClipboard(): void {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
}

function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
    const exec = vi.fn(() => result)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true })
    return exec
}

function removeExecCommand(): void {
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true })
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
}

async function copy(text: string): Promise<CopyOutcome[]> {
    const outcomes: CopyOutcome[] = []
    copyPlainText(text, (outcome) => outcomes.push(outcome))
    await new Promise((resolve) => setTimeout(resolve, 10))
    return outcomes
}

beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    removeExecCommand()
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    document.body.replaceChildren()
    if (realClipboard) {
        Object.defineProperty(navigator, 'clipboard', realClipboard)
    } else {
        Reflect.deleteProperty(navigator, 'clipboard')
    }
    if (realExecCommand) {
        Object.defineProperty(document, 'execCommand', realExecCommand)
    } else {
        Reflect.deleteProperty(document, 'execCommand')
    }
})

describe('copyPlainText with a working clipboard', () => {
    test('calls writeText synchronously once with the text and reports success once', async () => {
        const writeText = stubClipboard(async () => {})
        const exec = stubExecCommand(true)
        const outcomes: CopyOutcome[] = []

        copyPlainText('hello', (outcome) => outcomes.push(outcome))

        expect(writeText).toHaveBeenCalledTimes(1)
        expect(writeText).toHaveBeenCalledWith('hello')
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(outcomes).toEqual([{ ok: true }])
        expect(exec).not.toHaveBeenCalled()
    })
})

describe('copyPlainText when the write is rejected', () => {
    test('falls back to execCommand and reports success when it returns true', async () => {
        const writeText = stubClipboard(async () => {
            throw new DOMException('denied', 'NotAllowedError')
        })
        const exec = stubExecCommand(true)

        const outcomes = await copy('hello')

        expect(writeText).toHaveBeenCalledTimes(1)
        expect(exec).toHaveBeenCalledTimes(1)
        expect(exec).toHaveBeenCalledWith('copy')
        expect(outcomes).toEqual([{ ok: true }])
        expect(unhandled).toEqual([])
    })

    test('names the rejection when execCommand returns false', async () => {
        stubClipboard(async () => {
            throw new DOMException('denied', 'NotAllowedError')
        })
        stubExecCommand(false)

        expect(await copy('hello')).toEqual([{ ok: false, errorName: 'NotAllowedError' }])
        expect(unhandled).toEqual([])
    })

    test('names the rejection when execCommand is absent', async () => {
        stubClipboard(async () => {
            throw new DOMException('denied', 'NotAllowedError')
        })

        expect(await copy('hello')).toEqual([{ ok: false, errorName: 'NotAllowedError' }])
    })

    test('names a non-Error rejection UnknownError', async () => {
        stubClipboard(async () => {
            throw 'denied'
        })

        expect(await copy('hello')).toEqual([{ ok: false, errorName: 'UnknownError' }])
        expect(unhandled).toEqual([])
    })

    test('treats a synchronous throw like a rejection', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: () => {
                    throw new TypeError('bad')
                },
            },
            configurable: true,
        })

        expect(await copy('hello')).toEqual([{ ok: false, errorName: 'TypeError' }])
    })
})

describe('copyPlainText when the clipboard API is absent', () => {
    test('uses execCommand and reports success when it returns true', async () => {
        removeClipboard()
        const exec = stubExecCommand(true)

        expect(await copy('hello')).toEqual([{ ok: true }])
        expect(exec).toHaveBeenCalledTimes(1)
    })

    test('reports NotSupportedError when execCommand is absent too', async () => {
        removeClipboard()

        expect(await copy('hello')).toEqual([{ ok: false, errorName: 'NotSupportedError' }])
    })

    test('reports NotSupportedError when execCommand returns false', async () => {
        removeClipboard()
        stubExecCommand(false)

        expect(await copy('hello')).toEqual([{ ok: false, errorName: 'NotSupportedError' }])
    })
})

describe('the execCommand fallback', () => {
    test('selects the text in a temporary textarea, removes it, and restores focus', async () => {
        removeClipboard()
        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()
        let copiedValue: string | undefined
        let sawArea = false
        const exec = vi.fn(() => {
            const area = document.querySelector('textarea')
            sawArea = area !== null
            copiedValue = area?.value.slice(area.selectionStart, area.selectionEnd)
            return true
        })
        Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true })

        await copy('some text')

        expect(sawArea).toBe(true)
        expect(copiedValue).toBe('some text')
        expect(document.querySelector('textarea')).toBeNull()
        expect(document.activeElement).toBe(input)
    })

    test('removes the textarea when execCommand throws', async () => {
        removeClipboard()
        Object.defineProperty(document, 'execCommand', {
            value: () => {
                throw new Error('boom')
            },
            configurable: true,
            writable: true,
        })

        expect(await copy('hello')).toEqual([{ ok: false, errorName: 'NotSupportedError' }])
        expect(document.querySelector('textarea')).toBeNull()
    })
})

// Feature tests of `stripThoughtsForCopy`. A line break is `\n` or `\r\n`; the run before a
// removed block wins a tie with the run after it.
describe('stripThoughtsForCopy', () => {
    const T = '<Thoughts>x</Thoughts>'

    const table: { name: string; input: string; expected: string }[] = [
        { name: 'a leading block and its line breaks are removed', input: `${T}\n\nHello`, expected: 'Hello' },
        { name: 'a leading block followed by CRLF breaks is removed with them', input: `${T}\r\n\r\nHello`, expected: 'Hello' },
        { name: 'line breaks before a leading block are dropped with it', input: `\n\n${T}\nHello`, expected: 'Hello' },
        { name: 'an indented first line keeps its indentation', input: `${T}\n  Hello`, expected: '  Hello' },
        { name: 'a tab-indented first line keeps its tab', input: `${T}\n\n\tHello`, expected: '\tHello' },
        { name: 'a mid-document block keeps the paragraph break', input: `para1\n\n${T}\n\npara2`, expected: 'para1\n\npara2' },
        { name: 'a mid-document block with a single break each side keeps one break', input: `a\n${T}\nb`, expected: 'a\nb' },
        { name: 'CRLF breaks on both sides stay CRLF', input: `a\r\n\r\n${T}\r\n\r\nb`, expected: 'a\r\n\r\nb' },
        { name: 'a longer run after the block wins over a shorter run before it', input: `a\n${T}\n\nb`, expected: 'a\n\nb' },
        { name: 'a longer run before the block wins over a shorter run after it', input: `a\n\n${T}\nb`, expected: 'a\n\nb' },
        { name: 'a mixed join keeps the longer run as written (CRLF run after)', input: `a\n${T}\r\n\r\nb`, expected: 'a\r\n\r\nb' },
        { name: 'a mixed join keeps the longer run as written (LF run before)', input: `a\n\n${T}\r\nb`, expected: 'a\n\nb' },
        { name: 'a tie between an LF run before and a CRLF run after keeps the run before', input: `a\n\n${T}\r\n\r\nb`, expected: 'a\n\nb' },
        { name: 'a tie between a CRLF run before and an LF run after keeps the run before', input: `a\r\n\r\n${T}\n\nb`, expected: 'a\r\n\r\nb' },
        { name: 'a three-break run before the block stays three', input: `a\n\n\n${T}\nb`, expected: 'a\n\n\nb' },
        { name: 'a three-break run after the block stays three', input: `a\n${T}\n\n\nb`, expected: 'a\n\n\nb' },
        { name: 'a block inside a line leaves the surrounding spaces as written', input: `a ${T} b`, expected: 'a  b' },
        { name: 'a block glued to words joins them', input: `a${T}b`, expected: 'ab' },
        { name: 'line breaks before a block at the end of the text stay', input: `a\n\n${T}`, expected: 'a\n\n' },
        { name: 'a nested block is removed whole', input: `a\n\n<Thoughts>o<Thoughts>i</Thoughts>t</Thoughts>\n\nb`, expected: 'a\n\nb' },
        { name: 'two blocks are both removed', input: `${T}\n\nHello\n\n${T}\n\nWorld`, expected: 'Hello\n\nWorld' },
        { name: 'two adjacent blocks are removed together', input: `a\n\n${T}${T}\n\nb`, expected: 'a\n\nb' },
        { name: 'an unclosed block is kept', input: 'a\n\n<Thoughts>never closed', expected: 'a\n\n<Thoughts>never closed' },
        {
            name: 'a closed block inside an unclosed outer block is removed and the outer tag is kept',
            input: '<Thoughts>outer\n\n<Thoughts>inner</Thoughts>\n\ntail',
            expected: '<Thoughts>outer\n\ntail',
        },
        { name: 'the wrong case is kept', input: 'a\n\n<thoughts>x</thoughts>\n\nb', expected: 'a\n\n<thoughts>x</thoughts>\n\nb' },
        { name: 'a stray close tag is kept', input: `a</Thoughts>\n\n${T}\n\nb`, expected: 'a</Thoughts>\n\nb' },
        { name: 'markdown and HTML around the block are untouched', input: `**bold** <b>x</b>\n\n${T}\n\n# head\n<br>`, expected: '**bold** <b>x</b>\n\n# head\n<br>' },
        { name: 'text that already holds the private-use character still strips', input: `a\uE000${T}b`, expected: 'a\uE000b' },
    ]

    for (const row of table) {
        test(row.name, () => {
            expect(stripThoughtsForCopy(row.input)).toBe(row.expected)
        })
    }

    for (const input of [`${T}`, `\n${T}\n`, `${T}  `, `${T}\r\n\r\n${T}`]) {
        test(`a thinking-only message returns the input unchanged: ${JSON.stringify(input)}`, () => {
            expect(stripThoughtsForCopy(input)).toBe(input)
        })
    }

    for (const input of ['', 'Hello', '  a\r\n\r\n\r\nb\t \n', 'a <thoughts>x</thoughts> b\n\n\nc', 'a</Thoughts>b']) {
        test(`text with no closed thinking is byte-identical: ${JSON.stringify(input)}`, () => {
            expect(stripThoughtsForCopy(input)).toBe(input)
        })
    }
})
