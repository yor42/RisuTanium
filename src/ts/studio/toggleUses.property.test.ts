// Class G (property): texts are concatenated fragments, each carrying its expected hit by construction, so the
// expectation never comes from the scanner under test.
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { planFromScan, scanReach, type UpdatePlan, type UpdateReach } from './toggleUpdateAll'
import { scanTextUses } from './toggleUses'

// A fragment is `before + key + after`, or plain text when `key` is null.
interface Fragment {
    readonly before: string
    readonly key: string | null
    readonly after: string
}

const READERS: readonly (readonly [string, string])[] = [
    ['{{getglobalvar::toggle_', '}}'],
    ['{{getglobalvar:toggle_', '}}'],
    ['{#getglobalvar::toggle_', '::x}}'],
    ['{{#when::toggle::', '}}Z{{/}}'],
    ['{{#when::', '::tis::1}}Z{{/}}'],
    ['{{? @toggle_', ' + 1}}'],
    ['{{calc::@toggle_', '*2}}'],
]
const FILLERS = [
    'text ', '{{? 2*3}}', 'toggle_a ', '{{getglobalvar::other}}', '{{getglobalvar::toggle_{{? 1}}}}',
    '<user>', '<CHAR>', '<Bot>', '<char>', '}} ', '#} ',
]

const readerOf = (keys: readonly string[]) => fc.record({
    template: fc.constantFrom(...READERS),
    key: fc.constantFrom(...keys),
}).map(({ template, key }): Fragment => ({ before: template[0], key, after: template[1] }))
const fillerOf = fc.constantFrom(...FILLERS).map((text): Fragment => ({ before: text, key: null, after: '' }))

function fragmentsOf(keys: readonly string[]) {
    return fc.array(fc.oneof({ weight: 2, arbitrary: readerOf(keys) }, { weight: 3, arbitrary: fillerOf }), { minLength: 1, maxLength: 8 })
        .filter((list) => list.some((fragment) => fragment.key !== null))
}

function render(list: readonly Fragment[], rename: (key: string) => string = (key) => key): { text: string, hits: [number, string][] } {
    let text = ''
    const hits: [number, string][] = []
    for (const fragment of list) {
        text += fragment.before
        if (fragment.key !== null) {
            const key = rename(fragment.key)
            hits.push([text.length, key])
            text += key
        }
        text += fragment.after
    }
    return { text, hits }
}

const reachOf = (text: string): UpdateReach => ({
    owners: [{ ref: { kind: 'character', chaId: 'c' }, key: 'character:c', name: 'C', toggleText: '', targets: [{ path: 'desc', text, cls: 'rewritable' }] }],
    unreached: [],
})

function planOf(text: string, renames: { from: string, to: string }[]): UpdatePlan {
    const reach = reachOf(text)
    return planFromScan(reach, scanReach(reach, new Set(renames.map((rename) => rename.from))), renames, new Set())
}

const applied = (text: string, plan: UpdatePlan): string => (plan.writes.length === 0 ? text : plan.writes[0].after)
const plainHits = (text: string, keys: readonly string[]): [number, string][] =>
    scanTextUses(text, 'desc', 'rewritable', new Set(keys)).filter((hit) => !hit.flag).map((hit) => [hit.offset, hit.key])

const OPTIONS = { seed: 20261119, numRuns: 250 }

describe('UP1 single rename', () => {
    const keys = ['a', 'kk', 'zz']

    test('(1) the scanner finds exactly the constructed hits, whatever tags and fillers sit between them', () => {
        fc.assert(fc.property(fragmentsOf(keys), (list) => {
            const { text, hits } = render(list)
            expect(plainHits(text, keys)).toEqual(hits)
        }), OPTIONS)
    })

    test('(2) renaming a to qq leaves no a and puts qq at the shifted offsets; (3) renaming back restores the text', () => {
        fc.assert(fc.property(fragmentsOf(keys), (list) => {
            const { text } = render(list)
            const plan = planOf(text, [{ from: 'a', to: 'qq' }])
            const next = applied(text, plan)
            const expected = render(list, (key) => (key === 'a' ? 'qq' : key))
            expect(next).toBe(expected.text)
            expect(plainHits(next, ['a'])).toEqual([])
            expect(plainHits(next, ['qq'])).toEqual(expected.hits.filter(([, key]) => key === 'qq'))
            expect(applied(next, planOf(next, [{ from: 'qq', to: 'a' }]))).toBe(text)
        }), OPTIONS)
    })
})

describe('UP2 swap', () => {
    test('renaming {a to b, b to a} gives the fragments rebuilt with the two keys swapped', () => {
        fc.assert(fc.property(fragmentsOf(['a', 'b', 'kk']), (list) => {
            const { text } = render(list)
            const plan = planOf(text, [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
            const swap = (key: string) => (key === 'a' ? 'b' : key === 'b' ? 'a' : key)
            expect(applied(text, plan)).toBe(render(list, swap).text)
        }), OPTIONS)
    })
})

test('the generator reaches every reader template, tags and keys (a vacuous property proves nothing)', () => {
    const seen = new Set<string>()
    fc.assert(fc.property(fragmentsOf(['a', 'b']), (list) => {
        for (const fragment of list) {
            seen.add(fragment.key === null ? fragment.before : fragment.before + '|' + fragment.key)
        }
    }), { seed: 1, numRuns: 400 })
    for (const [before] of READERS) {
        expect([...seen].some((entry) => entry.startsWith(before + '|'))).toBe(true)
    }
    expect(seen.has('<user>') && seen.has('<CHAR>') && seen.has('<Bot>')).toBe(true)
})
