/**
 * The pure parts of the inlay cleanup: which ids a string walk finds in deleted
 * data, which of them a text still mentions, and that a walk gives the event
 * loop a turn. Synthetic data only.
 */
import { describe, expect, test, vi } from 'vitest'
import { CHUNK_CHARS, IdMatcher, Pacer, Scanner, collectInlayIds, walkStrings } from '../inlayCleanup'

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = {}
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({ getDatabase: vi.fn() }) as unknown as typeof import('src/ts/storage/database.svelte'))

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'aaaaaaaa-0000-4000-8000-000000000002'

describe('acceptance: collectInlayIds', () => {
    test('finds the id of every token head in every string, array element and object key of the value', async () => {
        const found = new Set<string>()
        await collectInlayIds({
            chats: [{ message: [{ data: `a {{inlay::${A}}} b {{inlayed::${B}}}` }, { data: '{{inlayeddata::sig-1}}' }] }],
            scriptstate: { '{{inlay::as-key}}': 'x' },
            note: 'no token here',
        }, found, new Pacer())
        expect([...found].sort()).toEqual([A, B, 'as-key', 'sig-1'].sort())
    })

    test('finds an id that holds quotes and backslashes exactly as written', async () => {
        const found = new Set<string>()
        await collectInlayIds(['{{inlay::odd"id\\x}}'], found, new Pacer())
        expect([...found]).toEqual(['odd"id\\x'])
    })

    test('ignores text that only looks like a token', async () => {
        const found = new Set<string>()
        await collectInlayIds(['{{inlayx::a}}', '{{inlay:a}}', '{inlay::a}', '{{inlay::'], found, new Pacer())
        expect(found.size).toBe(0)
    })
})

describe('acceptance: IdMatcher', () => {
    test('a uuid is found as a substring of a longer text, matched exactly as the token lookup matches it, and the others stay', () => {
        const matcher = new IdMatcher([A, B])
        matcher.scan(`prefix-${B.toUpperCase()}-suffix`)
        expect(matcher.remaining()).toEqual([A, B])
        matcher.scan(`prefix-${A}-suffix`)
        expect(matcher.remaining()).toEqual([B])
        matcher.scan('nothing')
        expect(matcher.remaining()).toEqual([B])
        matcher.scan(`{"pic":"${B}"}`)
        expect(matcher.size).toBe(0)
    })

    test('a uuid that continues a hexadecimal run is still found', () => {
        const matcher = new IdMatcher([A])
        matcher.scan(`f${A}`)
        expect(matcher.size).toBe(0)
    })

    test('an id that is not a uuid is found by plain substring, including a path with slashes and dots', () => {
        const id = 'assets/0123abcd.png'
        const matcher = new IdMatcher([id, 'odd"id\\x'])
        matcher.scan(`{"image":"${id}"}`)
        expect(matcher.remaining()).toEqual(['odd"id\\x'])
        matcher.scan('has odd"id\\x inside')
        expect(matcher.size).toBe(0)
    })

    test('an id is found when uuid-shaped text overlaps its start', () => {
        // The first 28 characters are the head of a uuid, so the uuid-shaped run that starts there swallows the id's first 8 characters.
        const matcher = new IdMatcher([A])
        matcher.scan(`11111111-2222-4333-8444-5555${A}`)
        expect(matcher.size).toBe(0)

        const joined = new IdMatcher([A, B])
        joined.scan(`11111111-2222-4333-8444-555555555555${A}${B}`)
        expect(joined.size).toBe(0)
    })

    test('a text shorter than any id removes nothing', () => {
        const matcher = new IdMatcher([A, 'assets/long-id.png'])
        matcher.scan('short')
        expect(matcher.size).toBe(2)
    })
})

describe('acceptance: Scanner', () => {
    test('an id that straddles the boundary of two pieces of a long string is found, and no piece is longer than the limit', async () => {
        const id = 'assets/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png'
        const at = CHUNK_CHARS - 20
        const text = 'x'.repeat(at) + id + 'y'.repeat(3 * CHUNK_CHARS)
        const matcher = new IdMatcher([id, A])
        const pieces: number[] = []
        const original = matcher.scan.bind(matcher)
        vi.spyOn(matcher, 'scan').mockImplementation((piece: string) => { pieces.push(piece.length); original(piece) })
        const done = await new Scanner(matcher, null).scan(text, new Pacer())
        expect(done).toBe(false)
        expect(matcher.remaining()).toEqual([A])
        expect(Math.max(...pieces)).toBeLessThanOrEqual(CHUNK_CHARS)
        expect(pieces.length).toBeGreaterThan(3)
    })

    test('a short string is scanned whole, and a long one yields once the slice has passed', async () => {
        let clock = 0
        const reading = vi.spyOn(performance, 'now').mockImplementation(() => { clock += 30; return clock })
        try {
            const pacer = new Pacer()
            const turns = vi.spyOn(pacer, 'yield')
            const matcher = new IdMatcher([A])
            expect(await new Scanner(matcher, null).scan('short', pacer)).toBe(false)
            expect(turns).not.toHaveBeenCalled()
            await new Scanner(matcher, null).scan('z'.repeat(5 * CHUNK_CHARS), pacer)
            expect(turns.mock.calls.length).toBeGreaterThan(1)
        } finally {
            reading.mockRestore()
        }
    })
})

describe('acceptance: walkStrings', () => {
    test('follows arrays and plain objects, skips binary values, and can be stopped', async () => {
        const seen: string[] = []
        const result = await walkStrings({ a: ['x', { b: 'y' }], c: new Uint8Array([1]), d: new Blob(['z']), e: 5, f: null }, (text) => {
            seen.push(text)
        }, new Pacer())
        expect(result).toEqual({ stopped: false, tooDeep: false })
        expect(seen.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'x', 'y'])

        let count = 0
        const stopped = await walkStrings(['1', '2', '3'], () => { count++; return true }, new Pacer())
        expect(stopped.stopped).toBe(true)
        expect(count).toBe(1)
    })

    test('hands an object key to the visitor like any other string', async () => {
        const matcher = new IdMatcher([A])
        const scanner = new Scanner(matcher, null)
        await walkStrings({ [A]: 'value' }, (text) => scanner.scan(text, new Pacer()), new Pacer())
        expect(matcher.size).toBe(0)
    })

    test('reports a value nested deeper than it follows instead of skipping it silently', async () => {
        let deep: unknown = 'bottom'
        for (let i = 0; i < 200; i++) {
            deep = [deep]
        }
        const seen: string[] = []
        const result = await walkStrings(deep, (text) => { seen.push(text) }, new Pacer())
        expect(result.tooDeep).toBe(true)
        expect(seen).toEqual([])
    })

    test('gives the event loop a turn so that no stretch of walking outlasts the slice limit by more than a step of the clock', async () => {
        // A clock that advances 10 ms per reading, so the slices are decided by the walk's own checks.
        let clock = 0
        const reading = vi.spyOn(performance, 'now').mockImplementation(() => { clock += 10; return clock })
        try {
            const value = Array.from({ length: 40_000 }, (_, i) => ({ id: `item-${i}`, text: 'x'.repeat(40) }))
            let turns = 0
            const timer = setInterval(() => { turns++ }, 1)
            const pacer = new Pacer()
            let count = 0
            await walkStrings(value, () => { count++ }, pacer)
            clearInterval(timer)
            expect(count).toBe(40_000 * 4)
            expect(turns).toBeGreaterThan(0)
            expect(pacer.longestSliceMs).toBeLessThanOrEqual(60)
        } finally {
            reading.mockRestore()
        }
    })
})
