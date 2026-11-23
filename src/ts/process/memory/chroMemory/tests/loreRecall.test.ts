import { describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Message } from 'src/ts/storage/database.svelte'
import { pickHashRand } from 'src/ts/util'
import { splitSentMessages } from 'src/ts/cbs'
import { admits, Bm25Index, tokenize } from '../lexical'
import { createLoreIndexStore, type LoreIndexDeps, type LoreIndexStore } from '../loreIndex'
import {
    EXCLUDED_DECORATORS,
    INERT_DECORATORS,
    LORE_MAX_PICKS,
    NEUTRAL_DECORATORS,
    createLoreRecallStep,
    loreQueryOf,
    markLoreRecallTrimmed,
    scoreLoreCandidates,
    staticExclusion,
    staticallyEligible,
    type LoreRecallEntry,
    type LoreRecallView,
    type LoreRender,
} from '../loreRecall'
import { chroLoreTrace } from '../traceStore'

// util.ts and cbs.ts pull the app's reactive modules in; these start effects at import that need a running app.
vi.mock('src/ts/parser/parser.svelte', () => ({ risuChatParser: (text: string) => text }))
vi.mock('src/ts/process/modules', () => ({ moduleUpdate: () => {}, getModules: () => [] }))

function manual() {
    const queue: Array<() => void> = []
    let clock = 0
    let hashCalls = 0
    const deps: LoreIndexDeps = {
        hash: (c) => { hashCalls++; return pickHashRand(5555, c) },
        schedule: (run) => { queue.push(run) },
        now: () => ++clock,
    }
    return {
        deps,
        pending: () => queue.length,
        hashCalls: () => hashCalls,
        resetHashCalls: () => { hashCalls = 0 },
        drain: () => { while (queue.length) queue.shift()!() },
    }
}

const TARGET: LoreRecallEntry = {
    key: 'zorvath',
    content: 'The glacier bastion of Zorvath holds frozen cannons',
    id: 'target',
    mode: 'normal',
}

function fillers(n: number): LoreRecallEntry[] {
    return Array.from({ length: n }, (_, i) => ({
        key: `key${i}`,
        content: `Filler number ${i} market weather harvest road`,
        id: `f${i}`,
        mode: 'normal',
    }))
}

interface Options {
    missed?: number[]
    decorators?: Record<number, string[]>
    limit?: number
    cut?: boolean
    linked?: string[]
    tokens?: (i: number, text: string) => number
    texts?: Record<number, string>
    query?: string
    mode?: 'shadow' | 'inject'
    tau?: number | null
    /** Overrides the shipped N; the render bound follows as 2N + 2. */
    picks?: number
    unused?: number
    render?: (i: number) => Promise<LoreRender>
    /** The entries the index is built from; defaults to the live ones. */
    indexed?: LoreRecallEntry[]
    store?: LoreIndexStore
    /** The scheduler harness the given store was built with. */
    m?: ReturnType<typeof manual>
}

async function recall(entries: LoreRecallEntry[], o: Options = {}) {
    const m = o.m ?? manual()
    const store = o.store ?? createLoreIndexStore(m.deps)
    const missed = new Map<number, { body: string, decorators: readonly string[] }>()
    entries.forEach((e, i) => {
        if (!o.missed || o.missed.includes(i)) missed.set(i, { body: e.content, decorators: o.decorators?.[i] ?? [] })
    })
    const rendered: number[] = []
    const limit = o.limit ?? 100000
    const view: LoreRecallView = {
        entries,
        characterCount: entries.length,
        chatCount: 0,
        moduleOwners: [],
        missed,
        cutForBudget: o.cut === true,
        loreToken: limit,
        unusedTokens: o.unused ?? limit,
        limit,
        linkedIds: new Set(o.linked ?? []),
        render: o.render
            ? (i) => { rendered.push(i); return o.render!(i) }
            : async (i) => {
                rendered.push(i)
                const text = o.texts?.[i] ?? entries[i].content
                return { text, tokens: o.tokens ? o.tokens(i, text) : text.length }
            },
    }
    const indexView = { ...view, entries: o.indexed ?? entries }
    store.ensure('c', indexView)
    m.drain()
    m.resetHashCalls()
    const step = createLoreRecallStep({
        mode: o.mode ?? 'inject',
        settings: { loreRecallCap: 5000 },
        query: o.query ?? 'what about the frozen cannons',
        ownerKey: 'c',
        chatKey: 'chat1',
        deps: { store, hash: (c) => { m.deps.hash(c); return pickHashRand(5555, c) }, now: m.deps.now, tau: o.tau, ...(o.picks === undefined ? {} : { maxPicks: o.picks, maxRenders: 2 * o.picks + 2 }) },
    })
    const picks = await step.run(view)
    return { picks, trace: get(chroLoreTrace)!, rendered, m, store, view, step }
}

describe('static eligibility (T8)', () => {
    // Spelled out so a name dropped from EXCLUDED_DECORATORS still has its own row.
    const specNames = [
        'probability', 'activate_only_after', 'activate_only_every', 'keep_activate_after_match', 'dont_activate_after_match',
        'is_greeting', 'activate', 'dont_activate', 'additional_keys', 'exclude_keys', 'exclude_keys_all', 'position', 'depth',
        'reverse_depth', 'role', 'disable_ui_prompt', 'ignore_on_max_context', 'end', 'scan_depth',
    ]
    const excludedNames = [...specNames, 'inject_lore', 'inject_at', 'inject_replace', 'inject_prepend', 'inject_future']
    const rows: Array<[string, Partial<LoreRecallEntry>, string[]]> = [
        ...excludedNames.map((n): [string, Partial<LoreRecallEntry>, string[]] => [`decorator ${n}`, {}, [n]]),
        ['selective', { selective: true }, []],
        ['regex keys', { useRegex: true }, []],
        ['empty key', { key: '' }, []],
        ['whitespace key', { key: '  ' }, []],
        ['comma-only key', { key: ' , ' }, []],
        ['constant mode', { mode: 'constant' }, []],
    ]

    test('new rule: the table is 19 spec names plus 5 inject variants and the entry-property rows', () => {
        expect(EXCLUDED_DECORATORS.size).toBe(19)
        expect(rows).toHaveLength(24 + 6)
    })

    test('control: the unmodified target ranks first and is recalled', async () => {
        const r = await recall([...fillers(30), TARGET])
        expect(r.picks).toEqual([30])
        expect(r.trace.outcome).toBe('placed')
        expect(r.trace.items[0].rank.lexical).toBe(1)
    })

    test.each(rows)('new rule: %s excludes a top-ranked miss', async (_name, patch, decorators) => {
        const target = { ...TARGET, ...patch }
        const r = await recall([...fillers(30), target], { decorators: { 30: decorators } })
        expect(r.picks).toEqual([])
        expect(r.trace.candidates.staticExcluded).toBe(1)
        expect(r.trace.items).toEqual([])
    })

    test('new rule: child and folder modes are never eligible', () => {
        for (const mode of ['child', 'folder', 'constant']) {
            expect(staticallyEligible({ ...TARGET, mode }, [], new Set()), mode).toBe(false)
        }
        expect(staticallyEligible(TARGET, [], new Set())).toBe(true)
    })

    test.each([...NEUTRAL_DECORATORS, ...INERT_DECORATORS])('new rule: neutral or inert decorator %s does not exclude', async (name) => {
        const r = await recall([...fillers(30), TARGET], { decorators: { 30: [name] } })
        expect(r.picks).toEqual([30])
    })

    test('new rule: an unknown decorator name neither excludes nor matters', () => {
        expect(staticExclusion(TARGET, ['some_future_decorator'], new Set())).toBeNull()
    })

    test('R-L: a parent a child entry links to is never recalled and is counted', async () => {
        const r = await recall([...fillers(30), TARGET], { linked: ['target'] })
        expect(r.picks).toEqual([])
        expect(r.trace.candidates.linked).toBe(1)
        expect(staticExclusion(TARGET, [], new Set(['target']))).toBe('linked')
        expect(staticExclusion({ ...TARGET, id: undefined }, [], new Set(['target']))).toBeNull()
    })
})

describe('identity and live content (T9, T9d)', () => {
    test('T9 a: two live entries sharing an id are both skipped', async () => {
        const dup = { ...TARGET, id: 'same' }
        const r = await recall([...fillers(30), dup, { ...dup, content: dup.content + ' also' }], { tau: null })
        expect(r.picks).toEqual([])
        expect(r.trace.candidates.duplicate).toBeGreaterThan(0)
    })

    test('T9 a: two live id-less entries with identical content are both skipped', async () => {
        const a: LoreRecallEntry = { key: 'a', content: TARGET.content, mode: 'normal' }
        const r = await recall([...fillers(30), a, { ...a, key: 'b' }], { tau: null })
        expect(r.picks).toEqual([])
        expect(r.trace.candidates.duplicate).toBeGreaterThan(0)
    })

    test('T9 b: a same-length edit ranks from the stale index and packs the live text', async () => {
        const live: LoreRecallEntry = { ...TARGET, content: TARGET.content.replace('cannons', 'cannont') }
        expect(live.content.length).toBe(TARGET.content.length)
        const r = await recall([...fillers(30), live], { indexed: [...fillers(30), TARGET], tau: null })
        expect(r.picks).toEqual([30])
        expect(r.rendered).toEqual([30])
        expect(r.trace.items[0].tokens).toBe(live.content.length)
    })

    test('T9 c: an id-less entry edited at the same length is an identity miss and requests a rebuild', async () => {
        const original: LoreRecallEntry = { key: 'zorvath', content: TARGET.content, mode: 'normal' }
        const edited: LoreRecallEntry = { ...original, content: original.content.replace('cannons', 'cannont') }
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const requestRebuild = vi.spyOn(store, 'requestRebuild')
        const r = await recall([...fillers(30), edited], { indexed: [...fillers(30), original], store, m })
        expect(r.picks).toEqual([])
        expect(r.trace.candidates.identityMiss).toBe(1)
        expect(requestRebuild).toHaveBeenCalledTimes(1)
    })

    test('T9d 2: two live entries with id "" and different contents are duplicates and request no rebuild', async () => {
        const a: LoreRecallEntry = { ...TARGET, id: '' }
        const b: LoreRecallEntry = { ...TARGET, id: '', content: TARGET.content + ' again' }
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const requestRebuild = vi.spyOn(store, 'requestRebuild')
        const r = await recall([...fillers(30), a, b], { tau: null, store, m })
        expect(r.picks).toEqual([])
        expect(r.trace.candidates.duplicate).toBe(2)
        expect(requestRebuild).not.toHaveBeenCalled()
    })

    test('T9d 3: a single entry with id "" is recalled and requests no rebuild', async () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const requestRebuild = vi.spyOn(store, 'requestRebuild')
        const r = await recall([...fillers(30), { ...TARGET, id: '' }], { store, m })
        expect(r.picks).toEqual([30])
        expect(requestRebuild).not.toHaveBeenCalled()
    })

    test('T9d 4: an id-less entry is recalled through the real content-hash identity', async () => {
        const r = await recall([...fillers(30), { ...TARGET, id: undefined }])
        expect(r.picks).toEqual([30])
    })
})

describe('admission (T10, T10b)', () => {
    test('T10: a query of terms common to every entry admits nothing, and nothing is packed', async () => {
        const r = await recall(fillers(40), { query: 'market weather harvest road' })
        expect(r.picks).toEqual([])
        expect(r.trace.outcome).toBe('nothing-admitted')
        expect(r.trace.admission.rejected).toBeGreaterThan(0)
    })

    test('T10: a rare query term is admitted', async () => {
        const r = await recall([...fillers(40), TARGET], { query: 'market weather frozen' })
        expect(r.picks).toEqual([40])
    })

    test('T10: a score of 0 is never packed', async () => {
        const r = await recall([...fillers(40), TARGET], { query: 'unrelated nothing matches qqqq', tau: null })
        expect(r.picks).toEqual([])
        expect(r.trace.outcome).toBe('no-candidates')
        expect(r.rendered).toEqual([])
    })

    test('T10: admission disabled (tau null) packs a common-term hit that tau 0.05 rejects', async () => {
        const entries = fillers(40)
        const off = await recall(entries, { query: 'market', tau: null })
        const on = await recall(entries, { query: 'market' })
        expect(off.picks.length).toBeGreaterThan(0)
        expect(on.picks).toEqual([])
    })

    test('T10b: the rare-token score equals lexical.admits over 40 documents, 20 queries and four taus', () => {
        let seed = 12345
        const rnd = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff
            return seed / 0x7fffffff
        }
        const vocab = Array.from({ length: 60 }, (_, i) => `term${i}`)
        const pick = (n: number) => Array.from({ length: n }, () => vocab[Math.floor(Math.pow(rnd(), 2) * vocab.length)])
        const docs = Array.from({ length: 40 }, () => pick(3 + Math.floor(rnd() * 8)).join(' '))
        const index = new Bm25Index()
        for (const d of docs) index.add(d)
        for (let q = 0; q < 20; q++) {
            const query = pick(1 + Math.floor(rnd() * 5)).join(' ')
            const qTokens = [...new Set(tokenize(query))]
            for (const tau of [0.01, 0.05, 0.2, null]) {
                const scores = index.scoreTokens(qTokens)
                const expected = docs.map((_, i) => i).filter((i) => scores[i] > 0 && admits(index, tokenize(docs[i]), qTokens, tau))
                const got = scoreLoreCandidates(index, query, tau).ranked.map((x) => x.doc).sort((a, b) => a - b)
                expect(got, `${query} @ ${tau}`).toEqual(expected)
            }
        }
    })

    test('new rule: ranking orders by score, then by the lower document id', () => {
        const index = new Bm25Index()
        index.add('frozen frozen cannons')
        index.add('frozen cannons')
        index.add('frozen cannons')
        index.add('market')
        const { ranked } = scoreLoreCandidates(index, 'frozen cannons', null)
        expect(ranked.map((x) => x.doc)).toEqual([0, 1, 2].sort((a, b) => ranked.find((r) => r.doc === b)!.score - ranked.find((r) => r.doc === a)!.score || a - b))
        expect(ranked[1].doc).toBeLessThan(ranked[2].doc)
    })
})

describe('packing (T11)', () => {
    function matching(n: number): LoreRecallEntry[] {
        return Array.from({ length: n }, (_, i) => ({
            key: `m${i}`,
            content: 'frozen ' + 'pad '.repeat(i),
            id: `m${i}`,
            mode: 'normal',
        }))
    }
    const base = () => [...fillers(20), ...matching(6)]
    const idx = (k: number) => 20 + k

    test('new rule: picks follow rank order and stop at N', async () => {
        const r = await recall(base(), { tau: null, query: 'frozen', tokens: () => 5, picks: 3 })
        expect(r.picks).toEqual([idx(0), idx(1), idx(2)])
        const shipped = await recall(base(), { tau: null, query: 'frozen', tokens: () => 5 })
        expect(shipped.picks).toEqual([idx(0)])
        expect(shipped.picks).toHaveLength(LORE_MAX_PICKS)
    })

    test('new rule: whole entries only, an overflowing entry is skipped and the walk continues', async () => {
        const r = await recall(base(), { tau: null, query: 'frozen', limit: 12, picks: 3, tokens: (i) => (i === idx(0) ? 50 : 5) })
        expect(r.picks).toEqual([idx(1), idx(2)])
        expect(r.trace.budget.used).toBe(10)
    })

    test('new rule: the limit binds the total', async () => {
        const r = await recall(base(), { tau: null, query: 'frozen', limit: 9, tokens: () => 5 })
        expect(r.picks).toEqual([idx(0)])
        const none = await recall(base(), { tau: null, query: 'frozen', limit: 4, tokens: () => 5 })
        expect(none.picks).toEqual([])
        expect(none.trace.outcome).toBe('nothing-fit')
    })

    test('new rule: an empty render is dropped and the next entry is taken', async () => {
        const r = await recall(base(), { tau: null, query: 'frozen', texts: { [idx(0)]: '   ' }, tokens: () => 5, picks: 3 })
        expect(r.picks).toEqual([idx(1), idx(2), idx(3)])
        expect(r.trace.droppedEmpty).toBe(1)
    })

    test('new rule: renders are bounded by 2N + 2', async () => {
        const r = await recall([...fillers(20), ...matching(10)], { tau: null, query: 'frozen', texts: Object.fromEntries(Array.from({ length: 10 }, (_, k) => [idx(k), ''])) })
        expect(r.picks).toEqual([])
        expect(r.rendered).toHaveLength(2 * LORE_MAX_PICKS + 2)
    })

    test('new rule: only a keyword miss is a candidate', async () => {
        const r = await recall(base(), { tau: null, query: 'frozen', missed: [idx(2), idx(3)], tokens: () => 5, picks: 3 })
        expect(r.picks).toEqual([idx(2), idx(3)])
    })

    test('new rule: a budget-cut turn, no budget, an empty query and a building index return nothing', async () => {
        const cut = await recall(base(), { tau: null, query: 'frozen', cut: true })
        expect(cut.picks).toEqual([])
        expect(cut.trace.outcome).toBe('budget-cut')
        const none = await recall(base(), { tau: null, query: 'frozen', limit: NaN })
        expect(none.picks).toEqual([])
        expect(none.trace.outcome).toBe('no-budget')
        const zero = await recall(base(), { tau: null, query: 'frozen', limit: 0 })
        expect(zero.trace.outcome).toBe('no-budget')
        const empty = await recall(base(), { tau: null, query: '' })
        expect(empty.trace.outcome).toBe('no-query')
        expect(empty.picks).toEqual([])
    })

    test('new rule: an index that is not ready recalls nothing, then recalls once the scheduler drains', async () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const entries = [...fillers(30), TARGET]
        const view = { entries, characterCount: entries.length, chatCount: 0, moduleOwners: [] as string[] }
        const full: LoreRecallView = {
            ...view,
            missed: new Map(entries.map((e, i) => [i, { body: e.content, decorators: [] as string[] }])),
            cutForBudget: false,
            loreToken: 1000,
            unusedTokens: 1000,
            limit: 1000,
            linkedIds: new Set(),
            render: async (i) => ({ text: entries[i].content, tokens: 10 }),
        }
        const step = createLoreRecallStep({ mode: 'inject', settings: { loreRecallCap: 5000 }, query: 'frozen cannons', ownerKey: 'c', chatKey: 'chat1', deps: { store, hash: (c) => pickHashRand(5555, c), now: m.deps.now } })
        expect(await step.run(full)).toEqual([])
        expect(get(chroLoreTrace)!.outcome).toBe('index-building')
        expect(get(chroLoreTrace)!.index.state).toBe('building')
        m.drain()
        expect(await step.run(full)).toEqual([30])
        expect(get(chroLoreTrace)!.index.state).toBe('ready')
    })
})

describe('query (T12)', () => {
    const msg = (data: string, extra: Partial<Message> = {}): Message => ({ role: 'user', data, ...extra })
    const q = (messages: Message[]) => loreQueryOf(messages, splitSentMessages)

    test('new rule: the newest sent message tail is the query', () => {
        expect(q([msg('first'), msg('second', { role: 'char' }), msg('third')])).toBe('third')
    })

    test('new rule: a hidden newest message is skipped', () => {
        expect(q([msg('visible'), msg('hidden', { disabled: true })])).toBe('visible')
    })

    test('new rule: messages before an allBefore reset are not sent', () => {
        expect(q([msg('old'), msg('reset', { disabled: 'allBefore' })])).toBe('')
        expect(q([msg('old'), msg('reset', { disabled: 'allBefore' }), msg('after')])).toBe('after')
    })

    test('new rule: a char message being continued is still the newest sent message', () => {
        expect(q([msg('hello'), msg('half a reply', { role: 'char' })])).toBe('half a reply')
    })

    test('new rule: empty chat and non-string data give an empty query', () => {
        expect(q([])).toBe('')
        expect(loreQueryOf([msg('x')], () => ({ sent: [{ role: 'user', data: 5 as unknown as string }] }))).toBe('')
    })

    test('new rule: only the last 500 code points are used and a surrogate pair is never split', () => {
        const data = 'a'.repeat(100) + 'b'.repeat(500)
        expect(q([msg(data)])).toBe('b'.repeat(500))
        const emoji = '\u{1F600}'.repeat(400)
        const tail = q([msg('x'.repeat(200) + emoji)])
        expect(Array.from(tail)).toHaveLength(500)
        expect(tail.startsWith('x'.repeat(100))).toBe(true)
        expect(tail.endsWith(emoji)).toBe(true)
        const boundary = q([msg('\u{1F600}' + 'z'.repeat(500))])
        expect(boundary).toBe('z'.repeat(500))
    })
})

describe('shadow and errors (T13, T14)', () => {
    test('T13: shadow mode returns nothing and traces what it would place', async () => {
        const r = await recall([...fillers(30), TARGET], { mode: 'shadow' })
        expect(r.picks).toEqual([])
        expect(r.trace.outcome).toBe('would-place')
        expect(r.trace.mode).toBe('shadow')
        expect(r.trace.items).toHaveLength(1)
        expect(r.trace.items[0].source).toEqual({ kind: 'lore', from: 'character', index: 30, name: 'zorvath' })
        expect(r.trace.items[0].rank).toEqual({ lexical: 1, dense: null, fused: null })
    })

    test('T14: a throwing render returns nothing and traces an error', async () => {
        const r = await recall([...fillers(30), TARGET], { render: async () => { throw new Error('render exploded') } })
        expect(r.picks).toEqual([])
        expect(r.trace.outcome).toBe('error')
        expect(r.trace.error).toBe('render exploded')
        expect(r.trace.items).toEqual([])
    })

    test('T14: a throwing index returns nothing and traces an error cut to 200 characters', async () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const real = store.ensure.bind(store)
        let calls = 0
        vi.spyOn(store, 'ensure').mockImplementation((...args) => {
            if (calls++ === 0) return real(...args)
            throw new Error('x'.repeat(500))
        })
        const r = await recall([...fillers(30), TARGET], { store, m })
        expect(r.picks).toEqual([])
        expect(r.trace.outcome).toBe('error')
        expect(r.trace.error).toHaveLength(200)
    })

    test('new rule: the trace records the budget, the index and the trim, and a trim mark keeps the rest', async () => {
        const r = await recall([...fillers(30), TARGET], { limit: 900, unused: 900 })
        expect(r.trace.budget).toMatchObject({ loreToken: 900, unused: 900, cap: 5000, limit: 900, used: TARGET.content.length })
        expect(r.trace.index).toMatchObject({ state: 'ready', entries: 31 })
        expect(r.trace.trimmed).toBeNull()
        markLoreRecallTrimmed('chat1', 1)
        expect(get(chroLoreTrace)!.trimmed).toEqual({ removed: 1 })
        expect(get(chroLoreTrace)!.outcome).toBe('placed')
        markLoreRecallTrimmed('other-chat', 4)
        expect(get(chroLoreTrace)!.trimmed).toEqual({ removed: 1 })
    })

    test('new rule: a subscriber that throws never reaches the send', async () => {
        let armed = false
        const stop = chroLoreTrace.subscribe(() => { if (armed) throw new Error('subscriber') })
        armed = true
        await expect(recall([...fillers(30), TARGET])).resolves.toBeDefined()
        stop()
    })
})

describe('prefilter (T31)', () => {
    const idless = (key: string, content: string): LoreRecallEntry => ({ key, content, mode: 'normal' })
    const D = idless('d', 'frozen cannons here')

    test('T31 a: when every live entry of the doc length is activated, no hash is computed and the result matches the prefilter-off result', async () => {
        const E: LoreRecallEntry = { key: 'e', content: 'frozen docks of the north padding padding', id: 'e', mode: 'normal' }
        const entries = [...fillers(30), D, E]
        const r = await recall(entries, { tau: null, missed: [31] })
        expect(r.picks).toEqual([31])
        expect(r.m.hashCalls()).toBe(0)
        // the same entries with D also missed: D ranks first, so the prefilter-off outcome picks D first
        const all = await recall(entries, { tau: null })
        expect(all.picks[0]).toBe(30)
        expect(all.m.hashCalls()).toBeGreaterThan(0)
    })

    test('T31 b: one missed entry of that length makes the send hash each live entry of that length once', async () => {
        const D2 = idless('d2', 'frozen cannons hare')
        expect(D2.content.length).toBe(D.content.length)
        const r = await recall([...fillers(30), D, D2], { tau: null, missed: [31] })
        expect(r.m.hashCalls()).toBe(2)
        expect(r.picks).toEqual([31])
    })
})
