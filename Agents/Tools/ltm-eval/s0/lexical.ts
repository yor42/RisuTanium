// Spec 5.3 tokeniser and BM25 scorer, written so S1 can move it into src unchanged: no imports, and only erasable
// TypeScript (no enums, namespaces or parameter properties), so Node's type stripping can load it from .mjs files.

// The M2 stopword list plus the contraction fragments left by splitting at apostrophes.
export const STOPWORDS: ReadonlySet<string> = new Set(
    ('a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those i you he she we they them his her their my your our me him us not no do does did have has had will would can could should shall may might must so than then there here what which who whom whose when where why how s t d ll re ve m').split(' '),
)

const CJK_CLASS = '\\p{Script=Hangul}\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FC\\u3005'
const CJK_FIRST = new RegExp(`[${CJK_CLASS}]`, 'u')
const RUNS = new RegExp(`[${CJK_CLASS}]+|(?:(?![${CJK_CLASS}])[\\p{L}\\p{M}\\p{N}])+`, 'gu')

// NFKC and lowercase first. CJK runs become overlapping code-point bigrams (a run of one character stays a unigram),
// so no bigram crosses a space. Word runs are kept unless they are stopwords; there is no stemming.
// Corner cases, kept deliberately: a run is a maximal span of Hangul, Han, Hiragana and Katakana characters, so a mixed
// Han plus Hangul or Han plus Kana run forms bigrams across the script boundary; a combining mark after a Hangul
// syllable is a non-CJK word character and becomes its own token; NFKC maps compatibility jamo and half-width kana
// before the split. S1 must state which of these readings it keeps.
export function tokenize(text: string): string[] {
    const out: string[] = []
    const norm = text.normalize('NFKC').toLowerCase()
    for (const m of norm.matchAll(RUNS)) {
        const w = m[0]
        if (CJK_FIRST.test(w)) {
            const cs = Array.from(w)
            if (cs.length === 1) out.push(cs[0])
            else for (let i = 0; i < cs.length - 1; i++) out.push(cs[i] + cs[i + 1])
        } else if (!STOPWORDS.has(w)) out.push(w)
    }
    return out
}

export class Bm25Index {
    readonly k1: number
    readonly b: number
    private post = new Map<string, Array<[number, number]>>()
    private lens: number[] = []
    private total = 0
    constructor(k1 = 1.2, b = 0.75) {
        this.k1 = k1
        this.b = b
    }
    add(text: string): number {
        const id = this.lens.length
        const toks = tokenize(text)
        this.lens.push(toks.length)
        this.total += toks.length
        const tf = new Map<string, number>()
        for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
        for (const [t, c] of tf) {
            let p = this.post.get(t)
            if (!p) {
                p = []
                this.post.set(t, p)
            }
            p.push([id, c])
        }
        return id
    }
    get size(): number {
        return this.lens.length
    }
    df(term: string): number {
        return this.post.get(term)?.length ?? 0
    }
    // Never negative: the 1 + inside the logarithm keeps terms with df above N / 2 at or above zero.
    idf(term: string): number {
        const n = this.size
        const d = this.df(term)
        return Math.log(1 + (n - d + 0.5) / (d + 0.5))
    }
    score(text: string): Float64Array {
        return this.scoreTokens(tokenize(text))
    }
    // Query terms are deduplicated. An empty index or an empty query gives zeros.
    scoreTokens(tokens: readonly string[]): Float64Array {
        const n = this.size
        const s = new Float64Array(n)
        if (n === 0) return s
        const avg = this.total / n || 1
        for (const t of new Set(tokens)) {
            const p = this.post.get(t)
            if (!p) continue
            const idf = this.idf(t)
            for (const [i, c] of p) s[i] += (idf * c * (this.k1 + 1)) / (c + this.k1 * (1 - this.b + (this.b * this.lens[i]) / avg))
        }
        return s
    }
}

// Reciprocal rank fusion over 1-based ranks. A ranking lists unit ids best first and only units with a positive score;
// a unit missing from a list adds 0. Ties go to the newer (larger id) unit. Returns every unit that scored in any list.
export function rrfScores(rankings: ReadonlyArray<readonly number[]>, k = 60): Map<number, number> {
    const acc = new Map<number, number>()
    for (const list of rankings) list.forEach((id, i) => acc.set(id, (acc.get(id) ?? 0) + 1 / (k + i + 1)))
    return acc
}
export function rrf(rankings: ReadonlyArray<readonly number[]>, k = 60): number[] {
    const acc = rrfScores(rankings, k)
    return [...acc.keys()].sort((a, b) => acc.get(b)! - acc.get(a)! || b - a)
}

// The k highest-idf distinct query terms among the terms with df >= 1 in the index; ties go to the term that appears
// first in the query. A df = 0 term has the highest idf but cannot match any unit, so it never takes a slot.
export function topIdfTerms(index: Bm25Index, text: string, k: number): string[] {
    const seen = new Set<string>()
    const terms: Array<{ t: string; pos: number }> = []
    for (const t of tokenize(text)) {
        if (seen.has(t)) continue
        seen.add(t)
        if (index.df(t) >= 1) terms.push({ t, pos: terms.length })
    }
    terms.sort((a, b) => index.idf(b.t) - index.idf(a.t) || a.pos - b.pos)
    return terms.slice(0, k).map((x) => x.t)
}

// Admission: a unit passes when it holds a query token whose df is at most max(1, floor(tau * N)). tau = null admits all.
export function admits(index: Bm25Index, unit: string | readonly string[], qTokens: readonly string[], tau: number | null): boolean {
    if (tau === null) return true
    const limit = Math.max(1, Math.floor(tau * index.size))
    const have = new Set(typeof unit === 'string' ? tokenize(unit) : unit)
    for (const t of qTokens) if (have.has(t) && index.df(t) <= limit) return true
    return false
}
