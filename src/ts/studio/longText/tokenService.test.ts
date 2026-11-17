import { afterEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
    const state = { created: 0, texts: [] as string[] }
    return {
        ...state,
        counterModule: () => ({
            createAppTokenCounter: () => {
                h.created += 1
                return {
                    count: async (text: string) => {
                        h.texts.push(text)
                        return { kind: 'app-count' as const, count: text.length, tokenizer: 'o200k_base' as const, model: 'M' }
                    },
                }
            },
        }),
    }
})

// The app counter drags the tokenizer and the database in; its module is replaced by a counter that records calls.
vi.mock('./tokenCountApp', () => h.counterModule())

import { requestTokens, setTokenCounterForTests } from './tokenService'

afterEach(() => {
    setTokenCounterForTests(null)
    h.created = 0
    h.texts.length = 0
})

describe('E1-U2 the token service', () => {
    test('the app counter is created once for any number of requests', async () => {
        const first = await requestTokens('a', 'abc')
        const second = await requestTokens('b', 'abcd')
        expect(first).toMatchObject({ kind: 'app-count', count: 3 })
        expect(second).toMatchObject({ kind: 'app-count', count: 4 })
        expect(h.created).toBe(1)
    })

    test('a newer request with the same key supersedes the older one, which resolves null', async () => {
        const older = requestTokens('k', 'old')
        const newer = requestTokens('k', 'newer')
        expect(await older).toBeNull()
        expect(await newer).toMatchObject({ count: 5 })
        expect(h.texts).toEqual(['newer'])
    })

    test('E1-x09 E1-x10 a failed import resolves null and the next request imports again', async () => {
        // A fresh module registry and a throwing factory make the dynamic import of the counter module reject.
        vi.resetModules()
        vi.doMock('./tokenCountApp', () => { throw new Error('import failed') })
        const fresh = await import('./tokenService')
        await expect(fresh.requestTokens('k', 'abc')).resolves.toBeNull()
        vi.doMock('./tokenCountApp', () => h.counterModule())
        await expect(fresh.requestTokens('k', 'abc')).resolves.toMatchObject({ kind: 'app-count', count: 3 })
        expect(h.created).toBe(1)
    })

    test('the test seam replaces the counter and null restores the real one', async () => {
        const request = vi.fn(async () => null)
        setTokenCounterForTests({ request })
        expect(await requestTokens('k', 'x')).toBeNull()
        expect(request).toHaveBeenCalledWith('k', 'x')
        expect(h.created).toBe(0)
        setTokenCounterForTests(null)
        expect(await requestTokens('k', 'xy')).toMatchObject({ count: 2 })
        expect(h.created).toBe(1)
    })
})
