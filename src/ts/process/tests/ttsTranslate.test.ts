/**
 * `translateForSpeech`: the guard around `translateWholeText` for auto speech. It never rejects, falls back to the
 * original text on any failure, and resolves to null as soon as any of its signals aborts. The translator is a mock
 * whose behaviour each test chooses.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

const translateWholeTextMock = vi.hoisted(() => vi.fn())

vi.mock('../../translator/translator', () => ({ translateWholeText: translateWholeTextMock }))

import { translateForSpeech } from '../ttsTranslate'

afterEach(() => {
    translateWholeTextMock.mockReset()
    vi.restoreAllMocks()
})

function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void, reject: (error: Error) => void } {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

async function flush(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
}

describe('translateForSpeech', () => {
    test('TG-1 guard: a translator failure resolves to the original text, warns, and never rejects', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        translateWholeTextMock.mockRejectedValue(new TypeError('offline'))

        const result = await translateForSpeech('hello', [new AbortController().signal])

        expect(result).toBe('hello')
        expect(warn).toHaveBeenCalledTimes(1)
    })

    test('guard: the translation and the note reach the translator', async () => {
        translateWholeTextMock.mockResolvedValue('[T]hello')

        const result = await translateForSpeech('hello', [new AbortController().signal], 'NOTE')

        expect(result).toBe('[T]hello')
        expect(translateWholeTextMock).toHaveBeenCalledWith('hello', { translatorNote: 'NOTE' })
    })

    test('TG-2 guard: an already-aborted signal gives null without a translator call; each signal aborted mid-wait gives null', async () => {
        const aborted = new AbortController()
        aborted.abort()
        expect(await translateForSpeech('hello', [new AbortController().signal, aborted.signal])).toBeNull()
        expect(translateWholeTextMock).not.toHaveBeenCalled()

        for (const index of [0, 1]) {
            const controllers = [new AbortController(), new AbortController()]
            const held = deferred<string>()
            translateWholeTextMock.mockReturnValue(held.promise)
            const outcome = translateForSpeech('hello', controllers.map((c) => c.signal))
            await flush()
            controllers[index].abort()
            expect(await outcome).toBeNull()
            held.resolve('late')
        }
    })

    test('TG-3 guard: a translator failure that arrives after an abort is not an unhandled rejection', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const unhandled = vi.fn()
        process.on('unhandledRejection', unhandled)
        try {
            const controller = new AbortController()
            const held = deferred<string>()
            translateWholeTextMock.mockReturnValue(held.promise)
            const outcome = translateForSpeech('hello', [controller.signal])
            await flush()
            controller.abort()
            expect(await outcome).toBeNull()
            held.reject(new TypeError('late failure'))
            await flush()

            expect(unhandled).not.toHaveBeenCalled()
        } finally {
            process.off('unhandledRejection', unhandled)
        }
    })

    test('guard: the abort listeners are removed once the race settles', async () => {
        translateWholeTextMock.mockResolvedValue('[T]hello')
        const signal = new AbortController().signal
        const remove = vi.spyOn(signal, 'removeEventListener')

        await translateForSpeech('hello', [signal])

        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    })
})
