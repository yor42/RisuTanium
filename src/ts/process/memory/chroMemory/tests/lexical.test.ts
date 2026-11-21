import { describe, expect, test } from 'vitest'
import { Bm25Index, rareTerms, tokenize } from '../lexical'

describe('tokenize', () => {
    test('new rule: the three S0 corner readings are kept', () => {
        // A mixed Han plus Hangul run forms bigrams across the script boundary.
        expect(tokenize('漢한')).toEqual(['漢한'])
        expect(tokenize('漢字한글')).toEqual(['漢字', '字한', '한글'])
        // A combining mark after a Hangul syllable is its own token (NFKC leaves the pair composed or not as normalised).
        expect(tokenize('가́')).toEqual(tokenize('가́'.normalize('NFKC')))
        // NFKC maps half-width kana before the split.
        expect(tokenize('ｶﾀｶﾅ')).toEqual(tokenize('カタカナ'))
        expect(tokenize('The quick, the lazy dog')).toEqual(['quick', 'lazy', 'dog'])
    })
})

const UNITS = ['alpha beta filler words here', 'alpha gamma extra', 'beta delta epsilon zeta zeta', 'delta eta theta']

function fresh(n: number): Bm25Index {
    const index = new Bm25Index()
    for (const u of UNITS.slice(0, n)) index.add(u)
    return index
}

describe('Bm25Index.truncate', () => {
    test('new rule: truncating to n scores exactly like a fresh index over the first n units', () => {
        const queries = ['alpha', 'beta gamma delta', 'delta zeta eta theta', 'epsilon beta']
        for (let n = 0; n <= UNITS.length; n++) {
            const cut = fresh(UNITS.length)
            cut.truncate(n)
            const ref = fresh(n)
            expect(cut.size).toBe(ref.size)
            for (const term of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']) {
                expect(cut.df(term)).toBe(ref.df(term))
            }
            for (const q of queries) {
                expect(Array.from(cut.score(q))).toEqual(Array.from(ref.score(q)))
                expect(rareTerms(cut, q, 0.005)).toEqual(rareTerms(ref, q, 0.005))
            }
        }
    })

    test('new rule: a truncated index accepts appends like a fresh one', () => {
        const cut = fresh(3)
        cut.truncate(1)
        cut.add(UNITS[3])
        const ref = new Bm25Index()
        ref.add(UNITS[0])
        ref.add(UNITS[3])
        expect(Array.from(cut.score('delta alpha'))).toEqual(Array.from(ref.score('delta alpha')))
    })

    test('guard: truncating at or past the size changes nothing', () => {
        const index = fresh(2)
        const before = Array.from(index.score('alpha'))
        index.truncate(2)
        index.truncate(9)
        expect(index.size).toBe(2)
        expect(Array.from(index.score('alpha'))).toEqual(before)
    })
})
