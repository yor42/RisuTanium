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
import { copyPlainText, type CopyOutcome } from './chatCopy'

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
