// @vitest-environment node
import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
    createSerialTokenCounter,
    createTokenCounter,
    estimateTokens,
    type TokenCounterDeps,
    type TokenResult,
    type TokenRoute,
} from './tokenCount'

const localRoute: TokenRoute = { kind: 'local', tokenizer: 'claude' }

function makeDeps(overrides: Partial<TokenCounterDeps> = {}): TokenCounterDeps & { encoded: string[] } {
    const encoded: string[] = []
    return {
        encoded,
        encode: async (text: string) => {
            encoded.push(text)
            return new Array<number>(text.length).fill(1)
        },
        modelName: () => 'Model X',
        route: () => localRoute,
        ...overrides,
    }
}

describe('A2-u1 token result labels', () => {
    test('a local route gives an app-count with the tokenizer and model', async () => {
        const deps = makeDeps()
        const result = await createTokenCounter(deps).count('hello')
        expect(result).toEqual({ kind: 'app-count', count: 5, tokenizer: 'claude', model: 'Model X' })
        expect(deps.encoded).toEqual(['hello'])
    })

    test('online-only and unavailable routes give an estimate and never call encode', async () => {
        const online = makeDeps({ route: () => ({ kind: 'online-only' }) })
        const onlineResult = await createTokenCounter(online).count('hello')
        expect(onlineResult).toEqual({ kind: 'estimate', count: estimateTokens('hello'), model: 'Model X', reason: 'online-only' })
        expect(online.encoded).toEqual([])

        const missing = makeDeps({ route: () => ({ kind: 'unavailable', reason: 'plugin-tokenizer-missing' }) })
        const missingResult = await createTokenCounter(missing).count('hello')
        expect(missingResult).toEqual({ kind: 'estimate', count: estimateTokens('hello'), model: 'Model X', reason: 'unavailable' })
        expect(missing.encoded).toEqual([])
    })

    test('an encode rejection gives an error estimate', async () => {
        const deps = makeDeps({ encode: async () => { throw new Error('boom') } })
        const result = await createTokenCounter(deps).count('abcd')
        expect(result).toEqual({ kind: 'estimate', count: estimateTokens('abcd'), model: 'Model X', reason: 'error' })
    })

    test('prepare is applied before encode and before an estimate', async () => {
        const deps = makeDeps({ prepare: (text) => text.replace(/\{\{user\}\}/g, 'U') })
        const result = await createTokenCounter(deps).count('{{user}}{{user}}')
        expect(deps.encoded).toEqual(['UU'])
        expect(result).toMatchObject({ kind: 'app-count', count: 2 })

        const online = makeDeps({ prepare: () => '가'.repeat(8), route: () => ({ kind: 'online-only' }) })
        const estimate = await createTokenCounter(online).count('x')
        expect(estimate).toMatchObject({ kind: 'estimate', count: estimateTokens('가'.repeat(8)) })
    })
})

describe('A2-u1b throwing dependencies', () => {
    test('a throwing prepare gives an error estimate of the raw text', async () => {
        const deps = makeDeps({ prepare: () => { throw new Error('prepare') } })
        const result = await createTokenCounter(deps).count('가가가가')
        expect(result).toEqual({ kind: 'estimate', count: 4, model: 'Model X', reason: 'error' })
        expect(deps.encoded).toEqual([])
    })

    test('a synchronously throwing encode gives an error estimate', async () => {
        const deps = makeDeps({ encode: () => { throw new Error('sync') } })
        const result = await createTokenCounter(deps).count('abcd')
        expect(result).toMatchObject({ kind: 'estimate', reason: 'error' })
    })

    test('a throwing route gives an error estimate and encode is not called', async () => {
        const deps = makeDeps({ route: () => { throw new Error('route') } })
        const result = await createTokenCounter(deps).count('abcd')
        expect(result).toMatchObject({ kind: 'estimate', reason: 'error' })
        expect(deps.encoded).toEqual([])
    })

    test('a throwing modelName gives an empty model name and does not reject', async () => {
        const deps = makeDeps({ modelName: () => { throw new Error('name') } })
        const counter = createTokenCounter(deps)
        const ok = await counter.count('abc')
        expect(ok).toEqual({ kind: 'app-count', count: 3, tokenizer: 'claude', model: '' })
        const failing = createTokenCounter(makeDeps({ modelName: () => { throw new Error('name') }, route: () => { throw new Error('route') } }))
        expect(await failing.count('abc')).toMatchObject({ kind: 'estimate', model: '', reason: 'error' })
    })
})

describe('A2-u2 estimateTokens', () => {
    test('empty, single and wide characters', () => {
        expect(estimateTokens('')).toBe(0)
        expect(estimateTokens('a')).toBe(1)
        expect(estimateTokens('가'.repeat(4))).toBeGreaterThan(estimateTokens('a'.repeat(4)))
        expect(estimateTokens('가'.repeat(4))).toBe(4)
        expect(estimateTokens('a'.repeat(4))).toBe(1)
        expect(estimateTokens('漢かカ')).toBe(3)
    })

    test('each wide range counts one token per character; an astral CJK character counts as one other code point', () => {
        expect(estimateTokens('ᄀ'.repeat(4))).toBe(4)
        expect(estimateTokens('ㄱ'.repeat(4))).toBe(4)
        expect(estimateTokens('㐀'.repeat(4))).toBe(4)
        expect(estimateTokens('漢'.repeat(4))).toBe(4)
        // U+20000 lies outside every wide range and is one code point, not two surrogates: 4 x 0.25 = 1.
        expect(estimateTokens('\u{20000}'.repeat(4))).toBe(1)
    })

    test('rounds up, not to nearest', () => {
        expect(estimateTokens('aaaaa')).toBe(2)
    })

    test('a lone surrogate does not throw', () => {
        expect(() => estimateTokens('a\uD800b')).not.toThrow()
        expect(estimateTokens('\uD800')).toBe(1)
    })

    test('monotone under append', () => {
        fc.assert(
            fc.property(fc.string({ unit: 'binary' }), fc.string({ unit: 'binary' }), (a, b) => {
                expect(estimateTokens(a + b)).toBeGreaterThanOrEqual(estimateTokens(a))
            }),
            { seed: 20261108, numRuns: 200 },
        )
    })
})

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void }
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const result = (count: number): TokenResult => ({ kind: 'app-count', count, tokenizer: 'claude', model: 'm' })

describe('A2-u3 serial counter', () => {
    test('the second count starts only after the first settles', async () => {
        const gates = new Map<string, Deferred<TokenResult>>()
        const started: string[] = []
        const serial = createSerialTokenCounter({
            count: (text) => {
                started.push(text)
                const gate = deferred<TokenResult>()
                gates.set(text, gate)
                return gate.promise
            },
        })
        const first = serial.request('a', 'one')
        const second = serial.request('b', 'two')
        await settle()
        expect(started).toEqual(['one'])
        gates.get('one')!.resolve(result(1))
        await settle()
        expect(started).toEqual(['one', 'two'])
        gates.get('two')!.resolve(result(2))
        expect(await first).toEqual(result(1))
        expect(await second).toEqual(result(2))
    })

    test('a newer same-key request supersedes an unstarted one, which never starts', async () => {
        const gates = new Map<string, Deferred<TokenResult>>()
        const started: string[] = []
        const serial = createSerialTokenCounter({
            count: (text) => {
                started.push(text)
                const gate = deferred<TokenResult>()
                gates.set(text, gate)
                return gate.promise
            },
        })
        const blocker = serial.request('other', 'blocker')
        const stale = serial.request('k', 'stale')
        const fresh = serial.request('k', 'fresh')
        await settle()
        gates.get('blocker')!.resolve(result(9))
        await settle()
        gates.get('fresh')!.resolve(result(3))
        expect(await stale).toBeNull()
        expect(await fresh).toEqual(result(3))
        expect(await blocker).toEqual(result(9))
        expect(started).toEqual(['blocker', 'fresh'])
    })

    test('a newer same-key request makes a running one resolve null', async () => {
        const gates = new Map<string, Deferred<TokenResult>>()
        const serial = createSerialTokenCounter({
            count: (text) => {
                const gate = deferred<TokenResult>()
                gates.set(text, gate)
                return gate.promise
            },
        })
        const running = serial.request('k', 'running')
        await settle()
        const fresh = serial.request('k', 'fresh')
        gates.get('running')!.resolve(result(1))
        await settle()
        gates.get('fresh')!.resolve(result(2))
        expect(await running).toBeNull()
        expect(await fresh).toEqual(result(2))
    })

    test('different keys never supersede each other', async () => {
        const serial = createSerialTokenCounter({ count: async (text) => result(text.length) })
        const a = serial.request('a', 'xx')
        const b = serial.request('b', 'xxx')
        expect(await a).toEqual(result(2))
        expect(await b).toEqual(result(3))
    })
})

describe('A2-u3b serial counter robustness', () => {
    test('the chain continues after a rejecting count', async () => {
        let calls = 0
        const serial = createSerialTokenCounter({
            count: async () => {
                calls += 1
                if (calls === 1) throw new Error('reject')
                return result(calls)
            },
        })
        expect(await serial.request('a', 'x')).toBeNull()
        expect(await serial.request('b', 'y')).toEqual(result(2))
    })

    test('the chain continues after a throwing count', async () => {
        let calls = 0
        const serial = createSerialTokenCounter({
            count: () => {
                calls += 1
                if (calls === 1) throw new Error('throw')
                return Promise.resolve(result(calls))
            },
        })
        expect(await serial.request('a', 'x')).toBeNull()
        expect(await serial.request('b', 'y')).toEqual(result(2))
    })
})

describe('A2-u5 route and encode share one synchronous turn', () => {
    test('encode sees the setting that route() read', async () => {
        const setting = { tokenizer: 'before' }
        let seenByEncode = ''
        const deps: TokenCounterDeps = {
            modelName: () => 'm',
            route: () => {
                const route: TokenRoute = { kind: 'local', tokenizer: 'claude' }
                queueMicrotask(() => { setting.tokenizer = 'after' })
                return route
            },
            encode: async () => {
                seenByEncode = setting.tokenizer
                return [1]
            },
        }
        await createTokenCounter(deps).count('x')
        expect(seenByEncode).toBe('before')
    })
})
