import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

// The parser module graph is not under test: the JSON extraction and the model catalog are replaced.
vi.mock('src/ts/model/modellist', () => ({ LLMFlags: { deepSeekThinkingOutput: 7 } }))
vi.mock('src/ts/process/templates/jsonSchema', () => ({ extractJSON: (data: unknown) => String(data) }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { characters: [] } } }))

import type { ReplyBlobBase } from './blob'
import { RECOVERED_REPLACER_WAIT_MS, boundedRecoveredReplacers, recoveredText } from './reconcile'

/**
 * C3-1..C3-4 (AS-9, MC-3798): each after-request replacer on a recovered reply gets one bounded wait. A replacer
 * that has not settled by then leaves the text as it was, the next replacer still runs, a throw still rejects, and
 * a replacer that settles in time applies. The wiring in bootstrap is not covered here (a named limitation).
 */

const base: ReplyBlobBase = {
    target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha',
    generationInfo: { generationId: '0b9c1a7e-0000-4000-8000-000000000001' }, promptInfo: {}, escape: false, requestedMs: 1,
}
const parseRule = { kind: 'openai-chat' as const, deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }
const blob = { ...base, parse: parseRule }
const body = (content: string) => JSON.stringify({ choices: [{ message: { content } }] })

type Replacer = (text: string, type: string) => string | Promise<string>

function recover(replacers: Replacer[]): Promise<string | null> {
    return recoveredText(200, body('model'), blob, {
        escape: (text) => text,
        replacers: boundedRecoveredReplacers(replacers),
    })
}

const never = (): Promise<string> => new Promise<string>(() => {})

describe('boundedRecoveredReplacers', () => {
    // recoveredText loads the parser module on its first call; load it before fake timers so a test's clock only measures the replacers.
    beforeAll(async () => {
        await recover([])
    }, 60_000)
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    test('C3-1: a replacer that never settles leaves the text unchanged after the wait', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const seen: Array<[string, string]> = []
        const result = recover([(text, type) => { seen.push([text, type]); return never() }])
        let done = false
        void result.then(() => { done = true })
        await vi.advanceTimersByTimeAsync(RECOVERED_REPLACER_WAIT_MS - 1)
        expect(done).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(await result).toBe('model')
        expect(seen).toEqual([['model', 'model']])
        expect(RECOVERED_REPLACER_WAIT_MS).toBe(60_000)
    })

    test('C3-2: after a timeout the next replacer runs on the unchanged text', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const second = vi.fn(async (text: string) => `${text}+second`)
        const result = recover([never, second])
        await vi.advanceTimersByTimeAsync(RECOVERED_REPLACER_WAIT_MS)
        expect(await result).toBe('model+second')
        expect(second).toHaveBeenCalledWith('model', 'model')
    })

    test('C3-2b: a result that arrives after the wait is dropped', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        let late: (value: string) => void = () => {}
        const slow = () => new Promise<string>((resolve) => { late = resolve })
        const result = recover([slow, async (text) => `${text}+next`])
        await vi.advanceTimersByTimeAsync(RECOVERED_REPLACER_WAIT_MS)
        late('LATE')
        expect(await result).toBe('model+next')
    })

    test('C3-2c: a rejection that arrives after the wait is logged and not left unhandled', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        let fail: (error: Error) => void = () => {}
        const slow = () => new Promise<string>((_, reject) => { fail = reject })
        const result = recover([slow])
        await vi.advanceTimersByTimeAsync(RECOVERED_REPLACER_WAIT_MS)
        expect(await result).toBe('model')
        const error = new Error('late')
        fail(error)
        await vi.advanceTimersByTimeAsync(0)
        expect(warn).toHaveBeenCalledWith('A recovered reply replacer', error)
    })

    test('C3-3: a replacer that throws rejects the step, whether it throws or rejects', async () => {
        await expect(recover([() => { throw new Error('sync') }])).rejects.toThrow('sync')
        await expect(recover([async () => { throw new Error('async') }])).rejects.toThrow('async')
    })

    test('C3-4: replacers that settle in time apply in order, and no timer is left running', async () => {
        const result = recover([async (text) => `${text}+a`, (text) => `${text}+b`])
        expect(await result).toBe('model+a+b')
        expect(vi.getTimerCount()).toBe(0)
    })

    test('C3-5: a throw leaves no timer running', async () => {
        await expect(recover([async () => { throw new Error('x') }])).rejects.toThrow('x')
        expect(vi.getTimerCount()).toBe(0)
    })

    test('C3-6: each replacer gets its own wait', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const result = recover([never, never, async (text) => `${text}+last`])
        await vi.advanceTimersByTimeAsync(RECOVERED_REPLACER_WAIT_MS)
        await vi.advanceTimersByTimeAsync(RECOVERED_REPLACER_WAIT_MS)
        expect(await result).toBe('model+last')
    })

    test('C3-7: the wait is the argument, and the list is read when the step runs', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const list = new Set<Replacer>()
        const step = boundedRecoveredReplacers(list, 5)
        list.add(never)
        list.add(async (text) => `${text}+x`)
        const result = step('t')
        await vi.advanceTimersByTimeAsync(5)
        expect(await result).toBe('t+x')
    })
})
