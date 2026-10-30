/**
 * Graph memory's read ranks the chat's graph with the real `HypaProcesser` store and cosine ranking: the
 * entries it returns are the closest matches of each search, at most three per query term and per
 * connection hop. Only the embedding source (`runEmbedding`), the cache (`localforage`), the database and
 * the chat variable are replaced, so nothing here says anything about a native or remote embedding backend.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    /** The vector of each text the embedding source is asked for. */
    vectors: {} as Record<string, number[]>,
    /** The stored graph of the chat, as the chat variable holds it. */
    graph: '' as string,
}))

vi.mock('localforage', () => {
    const store = new Map<string, unknown>()
    return { default: { createInstance: () => ({
        getItem: vi.fn(async (key: string) => store.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
        removeItem: vi.fn(async (key: string) => { store.delete(key) }),
    }) } }
})
vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: vi.fn() }))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: vi.fn(() => ({})) }))
vi.mock('src/ts/util', () => ({ appendLastPath: vi.fn((base: string, path: string) => `${base}/${path}`) }))
vi.mock('src/ts/secretRef', () => ({ resolveSecret: vi.fn(async (s: string) => s) }))
vi.mock('src/ts/parser/chatVar.svelte', () => ({
    getChatVar: vi.fn(() => h.graph),
    setChatVar: vi.fn(),
}))
vi.mock('../transformers', () => ({
    runEmbedding: vi.fn(async (inputs: string[]) => inputs.map((text) => {
        const vector = h.vectors[text]
        if (!vector) { throw new Error(`no test vector for ${text}`) }
        return Float32Array.from(vector)
    })),
}))

//#endregion

//#region fixtures

type Entry = { name: string, summary: string, connections: string[] }
type ReadResult = Array<{ queryTerm: string, entries: Entry[] }>

/** A unit vector at `angle` radians from the first axis: the smaller the angle to the query, the closer the entry. */
const at = (angle: number) => [Math.cos(angle), Math.sin(angle)]

const entry = (name: string, connections: string[] = []): Entry => ({ name, summary: `about ${name}`, connections })

async function read(graph: Entry[], query: string[]): Promise<{ text: string, results: ReadResult }> {
    h.graph = JSON.stringify(graph)
    const { GraphMemClient } = await import('../mcp/graphmem')
    const out = await new GraphMemClient().callTool('readMemory', { query })
    const text = out.map((x) => x.type === 'text' ? x.text : '').join('')
    let results: ReadResult = []
    try { results = JSON.parse(text) } catch { /* an answer that is not the result list */ }
    return { text, results }
}

const namesOf = (results: ReadResult, index = 0) => results[index].entries.map((e) => e.name)

beforeEach(() => {
    h.vectors = { q: at(0) }
    h.graph = ''
})

//#endregion

describe('graph memory read', () => {
    test('a read of a graph with entries returns the entry closest to the query', async () => {
        h.vectors = { q: at(0), near: at(0.1), mid: at(0.8), far: at(1.5) }

        const { results } = await read([entry('far'), entry('near'), entry('mid')], ['q'])

        expect(results).toHaveLength(1)
        expect(namesOf(results)[0]).toBe('near')
    })

    test('one query term returns at most the three closest entries of its first hop, closest first', async () => {
        h.vectors = { q: at(0), e1: at(0.1), e2: at(0.2), e3: at(0.3), e4: at(0.4), e5: at(0.5) }

        const { results } = await read([entry('e4'), entry('e2'), entry('e5'), entry('e1'), entry('e3')], ['q'])

        expect(namesOf(results)).toEqual(['e1', 'e2', 'e3'])
    })

    test('the connections of the entries found are searched at the next depth and add their own closest matches without repeating an entry', async () => {
        h.vectors = {
            q: at(0), hopterm: at(1.5),
            a: at(0.1), b: at(0.2), c: at(0.3), d: at(0.4),
            z1: at(1.2), z2: at(1.3), z3: at(1.4), z4: at(1.5),
        }
        const graph = [
            // `a` names the same connection twice and `b` connects back to the query term, whose matches are already found.
            entry('a', ['hopterm', 'hopterm']), entry('b', ['q']), entry('c'), entry('d'),
            entry('z1'), entry('z2'), entry('z3'), entry('z4'),
        ]

        const { results } = await read(graph, ['q'])

        const names = namesOf(results)
        expect(names).toEqual(['a', 'b', 'c', 'z4', 'z3', 'z2'])
        expect(new Set(names).size).toBe(names.length)
    })

    test('a graph that names an entry twice is read without an error and returns that entry once', async () => {
        h.vectors = { q: at(0), twin: at(0.1), other: at(0.9) }

        const { results } = await read([entry('twin'), entry('other'), entry('twin')], ['q'])

        expect(namesOf(results)).toEqual(['twin', 'other'])
    })

    test('a name repeated among the closest matches does not displace the next distinct entry from the three returned', async () => {
        h.vectors = { q: at(0), a: at(0.1), b: at(0.2), c: at(0.3), d: at(0.4) }

        const { results } = await read([entry('a'), entry('a'), entry('b'), entry('c'), entry('d')], ['q'])

        expect(namesOf(results)).toEqual(['a', 'b', 'c'])
    })

    test('guard: a read of an empty graph answers that there are no entries', async () => {
        const { text } = await read([], ['q'])

        expect(text).toContain('No memory entries found')
    })
})
