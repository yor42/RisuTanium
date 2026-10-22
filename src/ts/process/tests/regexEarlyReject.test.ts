/**
 * `leadingLazyDotCannotMatch` (`../regexEarlyReject`): the early rejection of
 * regexes that begin with a lazy dot.
 *
 * The contract is one-sided: whenever the helper answers `true`, a fresh
 * `new RegExp(pattern, flags)` must not match the input. `false` is always
 * allowed, so a second guard keeps the helper from bailing on everything.
 *
 * - The fixed cases pin the shapes where a naive "search REST" is wrong:
 *   top-level `|`, backreferences, a quantified leading group, lookbehind and
 *   word boundaries that need the text before index 1, and the flags that
 *   change what `.` or the search position means.
 * - The differential corpus is generated from a seeded grammar and checked
 *   against the real engine.
 * - The mutant cases run the same corpus against an independent
 *   reimplementation of the recogniser with one bail removed and require the
 *   corpus to catch it.
 *
 * Tests titled `guard:` pin behaviour that must be preserved; the differential
 * and mutant tests are the evidence that the helper never rejects a match.
 */
import { describe, test, expect } from 'vitest'
import { leadingLazyDotCannotMatch } from '../regexEarlyReject'

type CannotMatch = (input: string, flag: string, data: string) => boolean

const leadForms: { text: string, from: number }[] = [
    { text: '(.+?)', from: 1 },
    { text: '.+?', from: 1 },
    { text: '(.*?)', from: 0 },
    { text: '.*?', from: 0 },
]

// Lazy forms first: a greedy form would read a following `?` as its quantifier.
const anchoredLeadForms: { text: string, from: number }[] = [
    { text: '^(.*?)', from: 0 },
    { text: '^.*?', from: 0 },
    { text: '^(.*)', from: 0 },
    { text: '^.*', from: 0 },
    { text: '^(.+?)', from: 1 },
    { text: '^.+?', from: 1 },
    { text: '^(.+)', from: 1 },
    { text: '^.+', from: 1 },
]

describe('leadingLazyDotCannotMatch anchored leads', () => {
    test('guard: a REST absent from the text is rejected, with and without m', () => {
        for(const lead of anchoredLeadForms){
            for(const flag of ['s', 'ms', 'sg', 'msg']){
                expect(leadingLazyDotCannotMatch(`${lead.text}#(alpha|beta)$`, flag, 'no marker\nhere')).toBe(true)
            }
        }
    })

    test('guard: a REST that matches only after a newline is not rejected, with m off and on', () => {
        for(const lead of anchoredLeadForms){
            for(const flag of ['s', 'ms']){
                expect(leadingLazyDotCannotMatch(`${lead.text}#(alpha|beta)$`, flag, 'first\nx#beta')).toBe(false)
            }
        }
    })

    test('guard: the minimum span of the lead decides a REST at index 0', () => {
        expect(leadingLazyDotCannotMatch('^(.*)a', 's', 'a')).toBe(false)
        expect(leadingLazyDotCannotMatch('^(.+)a', 's', 'a')).toBe(true)
        expect(leadingLazyDotCannotMatch('^.*?a', 'ms', 'a')).toBe(false)
        expect(leadingLazyDotCannotMatch('^.+?a', 'ms', 'a')).toBe(true)
    })

    test('guard: no s flag, a unicode or sticky flag, an alternation or a quantified lead is left to the full regex', () => {
        expect(leadingLazyDotCannotMatch('^(.*)#', 'm', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('^(.*)#', 'ms' + 'u', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('^(.*)#', 'msy', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('^(.*)#|b', 'ms', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('^(.*)?#', 'ms', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('^(.+)*#', 'ms', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('^(.*)(a)\\1', 'ms', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('(^.*)#', 'ms', 'zz')).toBe(false)
    })
})

describe('leadingLazyDotCannotMatch fixed cases', () => {
    test('guard: a REST that cannot match at index 1 or later is rejected', () => {
        expect(leadingLazyDotCannotMatch('(.+?)#(alpha|beta)$', 'sm', 'x'.repeat(100))).toBe(true)
        expect(leadingLazyDotCannotMatch('.+?b', 's', 'b')).toBe(true)
        expect(leadingLazyDotCannotMatch('.+?a', 'sg', 'a')).toBe(true)
        expect(leadingLazyDotCannotMatch('(.+?)', 's', '')).toBe(true)
    })

    test('guard: a REST that matches at index 1 or later is not rejected', () => {
        expect(leadingLazyDotCannotMatch('(.+?)b', 's', 'abc')).toBe(false)
        expect(leadingLazyDotCannotMatch('.*?a', 's', 'a')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)(.)', 's', 'ab')).toBe(false)
    })

    test('guard: an empty REST rejects only where the lead itself cannot match', () => {
        expect(leadingLazyDotCannotMatch('.+?', 's', '')).toBe(true)
        expect(leadingLazyDotCannotMatch('.+?', 's', 'a')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)', 's', 'a')).toBe(false)
        expect(leadingLazyDotCannotMatch('.*?', 's', '')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.*?)', 's', 'a')).toBe(false)
    })

    test('guard: a top-level alternation is left to the full regex', () => {
        expect(leadingLazyDotCannotMatch('(.+?)b|c', 's', 'c')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)b|c', 's', 'zz')).toBe(false)
    })

    test('guard: a backreference is left to the full regex', () => {
        expect(leadingLazyDotCannotMatch('(.+?)(.)\\2', 's', 'xaa')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)(.)\\2', 's', 'xab')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)(?<n>a)\\k<n>', 's', 'xaa')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)[\\1]', 's', 'zz')).toBe(false)
    })

    test('guard: a quantified leading group is left to the full regex', () => {
        expect(leadingLazyDotCannotMatch('(.+?)?b', 's', 'b')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)*b', 's', 'b')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)+b', 's', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?){2}b', 's', 'zz')).toBe(false)
    })

    test('guard: lookbehind and word boundaries see the text before index 1', () => {
        expect(leadingLazyDotCannotMatch('(.+?)(?<=a)b', 's', 'ab')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)\\bfoo', 's', ' foo')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)\\b', 's', 'a')).toBe(false)
        expect(leadingLazyDotCannotMatch('.+?\\Bb', 's', 'ab')).toBe(false)
    })

    test('guard: the flags that change what the lead means are left to the full regex', () => {
        expect(leadingLazyDotCannotMatch('.+?x', '', 'a\nx')).toBe(false)
        expect(leadingLazyDotCannotMatch('.+?x', 'g', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)b', 'su', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)b', 'sv', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)b', 'sy', 'zz')).toBe(false)
    })

    test('guard: unbalanced or unterminated constructs and non-lazy leads are left to the full regex', () => {
        expect(leadingLazyDotCannotMatch('(.+?)(a', 's', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)[a', 's', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)a\\', 's', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('.+b', 's', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+)b', 's', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?|x)b', 's', 'zz')).toBe(false)
    })

    test('guard: an invalid pattern is not rejected and does not throw', () => {
        expect(leadingLazyDotCannotMatch('(.+?)[b-a]', 's', 'zz')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)(?<n>a)(?<n>b)', 's', 'zz')).toBe(false)
    })

    test('guard: the cached answer follows the data, not the first call', () => {
        expect(leadingLazyDotCannotMatch('(.+?)q', 's', 'zz')).toBe(true)
        expect(leadingLazyDotCannotMatch('(.+?)q', 's', 'zzq')).toBe(false)
        expect(leadingLazyDotCannotMatch('(.+?)q', 's', 'zz')).toBe(true)
    })

    test('guard: more patterns than the cache holds still answer correctly', () => {
        for(let i = 0; i < 600; i++){
            expect(leadingLazyDotCannotMatch(`(.+?)k${i}z`, 's', `ak${i}z`)).toBe(false)
            expect(leadingLazyDotCannotMatch(`(.+?)k${i}z`, 's', `a${i}`)).toBe(true)
        }
        expect(leadingLazyDotCannotMatch('(.+?)k1z', 's', 'ak1z')).toBe(false)
    })
})

function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const atoms = [
    'a', 'b', 'ab', 'x', '#', '1', '.', '\\.', '\\d', '\\w', '\\n', '\\b', '\\B', '^', '$',
    '[ab]', '[^a]', '[)]', '[(]', '[|]', '[]]', '[^]]', '[a\\]]', '[\\]b]', '[]', '[^]',
    '(a)', '(a|b)', '(?:ab|b)', '(?<n>a)', '(ab)', '((a)b)', '(a|)',
    '(?=a)', '(?!b)', '(?<=a)', '(?<!a)', '(?=(a))',
    '\\1', '\\2', '\\k<n>', '\\10', '[\\1]',
]
const quantifiers = ['', '', '', '*', '+', '?', '{1,2}', '*?', '+?', '??', '{2}']
const flagParts = ['s', 'm', 'i', 'g', 'u']
const inputs = [
    '', 'a', 'b', 'ab', 'ba', 'aa', 'aab', 'abab', '#', 'x#a', '1a', 'a\nb', '\n', 'a\nab', '\u{1F600}', 'a\u{1F600}a', ' b', 'bb\n',
    'a\n#a', 'x\nb', 'a\r\nb', 'a b',
]

function buildPatterns(random: () => number, count: number): string[] {
    const patterns: string[] = []
    const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]
    while(patterns.length < count){
        const alternatives: string[] = []
        const alternativeCount = random() < 0.2 ? 2 : 1
        for(let a = 0; a < alternativeCount; a++){
            let seq = ''
            const length = Math.floor(random() * 4)
            for(let i = 0; i < length; i++){
                seq += pick(atoms) + pick(quantifiers)
            }
            alternatives.push(seq)
        }
        patterns.push(alternatives.join('|'))
    }
    return patterns
}

function buildFlags(random: () => number): string[] {
    const list = ['s', 'sm', 'si', 'sg', 'smg', 'smi', 'su', 'm', 'g', 'sgi']
    while(list.length < 14){
        let flags = ''
        for(const part of flagParts){
            if(random() < 0.5){
                flags += part
            }
        }
        list.push(flags)
    }
    return list
}

interface DifferentialResult {
    cases: number
    rejected: number
    anchoredCases: number
    anchoredRejected: number
    violations: string[]
}

function runDifferential(cannotMatch: CannotMatch, seed: number, patternCount: number): DifferentialResult {
    const random = seededRandom(seed)
    const rests = buildPatterns(random, patternCount)
    const flagList = buildFlags(random)
    const result: DifferentialResult = { cases: 0, rejected: 0, anchoredCases: 0, anchoredRejected: 0, violations: [] }
    for(const rest of rests){
        for(const lead of leadForms.concat(anchoredLeadForms)){
            const anchored = lead.text.startsWith('^')
            const pattern = lead.text + rest
            for(const flags of flagList){
                try{
                    new RegExp(pattern, flags)
                }
                catch{
                    // Invalid combinations never reach the helper in production.
                    continue
                }
                for(const data of inputs){
                    result.cases++
                    if(anchored){
                        result.anchoredCases++
                    }
                    if(cannotMatch(pattern, flags, data)){
                        result.rejected++
                        if(anchored){
                            result.anchoredRejected++
                        }
                        if(new RegExp(pattern, flags).test(data)){
                            result.violations.push(`${flags} /${pattern}/ on ${JSON.stringify(data)}`)
                        }
                    }
                }
            }
        }
    }
    return result
}

/**
 * An independent reimplementation of the recogniser, with one bail optionally
 * removed, used to check the corpus is sensitive to that removal. It is not the
 * helper under test. With no mutation it must honour the same one-sided
 * contract.
 */
function mutantCannotMatch(mutation: 'none' | 'noPipeBail' | 'noBackrefBail'): CannotMatch {
    return (input, flag, data) => {
        if(!flag.includes('s') || /[yuv]/.test(flag)){
            return false
        }
        const lead = leadForms.concat(anchoredLeadForms).find((candidate) => input.startsWith(candidate.text))
        if(!lead){
            return false
        }
        const rest = input.slice(lead.text.length)
        if(rest.length > 0 && '*+?{'.includes(rest[0])){
            return false
        }
        let depth = 0
        let inClass = false
        for(let i = 0; i < rest.length; i++){
            const c = rest[i]
            if(c === '\\'){
                const next = rest[i + 1]
                if(next === undefined){
                    return false
                }
                if(mutation !== 'noBackrefBail' && ((next >= '1' && next <= '9') || next === 'k')){
                    return false
                }
                i++
            }
            else if(inClass){
                if(c === ']'){
                    inClass = false
                }
            }
            else if(c === '['){
                inClass = true
                if(rest[i + 1] === '^'){
                    i++
                }
                if(rest[i + 1] === ']'){
                    i++
                    inClass = false
                }
            }
            else if(c === '('){
                depth++
            }
            else if(c === ')'){
                depth--
                if(depth < 0){
                    return false
                }
            }
            else if(c === '|' && depth === 0 && mutation !== 'noPipeBail'){
                return false
            }
        }
        if(depth !== 0 || inClass){
            return false
        }
        try{
            const search = new RegExp(rest, flag.replace(/g/g, '') + 'g')
            search.lastIndex = lead.from
            return search.exec(data) === null
        }
        catch{
            return false
        }
    }
}

// Each corpus run takes seconds and runs several times slower under a loaded
// full suite, so the default 5 s timeout is too tight.
describe('leadingLazyDotCannotMatch differential', { timeout: 60_000 }, () => {
    test('whenever the helper rejects, the real regex has no match, and the helper rejects often', () => {
        const result = runDifferential(leadingLazyDotCannotMatch, 20261022, 700)
        expect(result.violations.slice(0, 5)).toEqual([])
        expect(result.cases).toBeGreaterThan(200000)
        expect(result.anchoredCases).toBeGreaterThan(100000)
        expect(result.anchoredRejected / result.anchoredCases).toBeGreaterThan(0.1)
        // An always-bail helper would also satisfy the one-sided check.
        expect(result.rejected / result.cases).toBeGreaterThan(0.1)
    })

    test('guard: a second seed agrees', () => {
        const result = runDifferential(leadingLazyDotCannotMatch, 7, 700)
        expect(result.violations.slice(0, 5)).toEqual([])
        expect(result.rejected / result.cases).toBeGreaterThan(0.1)
    })

    test('guard: the independent reimplementation of the recogniser passes the corpus, so the mutants differ only by their removed bail', () => {
        const result = runDifferential(mutantCannotMatch('none'), 20261022, 700)
        expect(result.violations.slice(0, 5)).toEqual([])
    })

    test('mutant: a recogniser without the top-level alternation bail is caught', () => {
        const result = runDifferential(mutantCannotMatch('noPipeBail'), 20261022, 700)
        expect(result.violations.length).toBeGreaterThan(0)
    })

    test('mutant: a recogniser without the backreference bail is caught', () => {
        const result = runDifferential(mutantCannotMatch('noBackrefBail'), 20261022, 700)
        expect(result.violations.length).toBeGreaterThan(0)
    })
})
