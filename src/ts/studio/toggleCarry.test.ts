import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { addedFromRows, detachingItems, lateOldKeys, planCarry, valueKeysOf, windowDirty, type CarryItem } from './toggleCarry'
import { parseDefinition, textOf, type Definition } from './toggleDef'
import { closeGroup, draftOf, insertRow, moveRow, removeRow, replaceText, setRow } from './toggleDefEdit'
import { corpus, crlf, textArb } from './toggleDefFixtures.test-helpers'

const FAST_CHECK = { seed: 20261116, numRuns: 300 }

const plan = (before: string, after: string): readonly CarryItem[] => planCarry(parseDefinition(before), parseDefinition(after))
const ambiguous = (key: string, reason: 'manyCandidates' | 'unmatched' | 'duplicateKey' | 'options'): CarryItem => ({ kind: 'ambiguous', key, reason })
const rename = (from: string, to: string): CarryItem => ({ kind: 'rename', from, to })

// ---- generators: seven-word keys and labels, so duplicate keys and same-label rows are common ----------------------

const word = fc.constantFrom('a', 'b', 'k', 'x', 'K', 'g', 'h')
const suffix = fc.constantFrom('', '=text', '=textarea', '=select=a,b', '=select=b,a', '=select=a,b,c', '=select', '=select=a')
const valueLine = fc.tuple(word, word, suffix).map(([key, label, tail]) => `${key}=${label}${tail}`)
const structureLine = fc.oneof(
    word.map((label) => `=${label}=divider`),
    word.map((label) => `=${label}=caption`),
    word.map((label) => `g_${label}=${label}=group`),
    word.map((label) => `e_${label}=${label}=groupEnd`),
)
const textOfLines = (lines: readonly string[]): string => lines.join('\n')
const defTextArb: fc.Arbitrary<string> = fc.array(fc.oneof({ weight: 6, arbitrary: valueLine }, { weight: 2, arbitrary: structureLine }), { maxLength: 8 })
    .map(textOfLines)

type Reader = { key: string, label: string, cls: 'check' | 'select' | 'text', options: string[] }

/** A second reading of the rows, written for the tests and independent of the planner. */
function readersOf(text: string): Reader[] {
    const readers: Reader[] = []
    for (const raw of text.split('\n')) {
        const parts = raw.split('=')
        const [key, label, type] = parts
        if (!key || !label || type === 'group' || type === 'groupEnd' || type === 'divider' || type === 'caption') {
            continue
        }
        const cls = type === 'select' ? 'select' : type === 'text' || type === 'textarea' ? 'text' : 'check'
        readers.push({ key, label, cls, options: cls === 'select' ? (parts[3] ?? '').split(',') : [] })
    }
    return readers
}

describe('planCarry basics', () => {
    it('P-1: an unchanged text plans nothing over the corpus, its CRLF form and generated texts', () => {
        for (const entry of corpus) {
            for (const text of [entry.text, crlf(entry.text)]) {
                const def = parseDefinition(text)
                expect(planCarry(def, def), entry.name).toEqual([])
            }
        }
        fc.assert(fc.property(textArb, (text) => {
            const def = parseDefinition(text)
            return planCarry(def, def).length === 0
        }), FAST_CHECK)
    })

    it('P-2: key-preserving edits plan nothing', () => {
        const edit = fc.tuple(fc.constantFrom('label', 'move', 'remove', 'close', 'insertNew', 'insertDup'), fc.nat(40), fc.nat(40))
        fc.assert(fc.property(defTextArb, edit, (text, [kind, i, j]) => {
            const def = parseDefinition(text)
            if (def.lines.length === 0) {
                return true
            }
            const line = def.lines[i % def.lines.length]
            const draft = draftOf(line)
            let result: { ok: boolean, def?: Definition } | null = null
            if (kind === 'label' && draft && draft.kind !== 'caption' && draft.kind !== 'divider' && line.form.kind === 'value') {
                result = setRow(def, line.id, { ...draft, label: 'Zed' })
            } else if (kind === 'move') {
                const at = j % (def.lines.length + 1)
                result = moveRow(def, line.id, at === def.lines.length ? 'end' : { before: def.lines[at].id })
            } else if (kind === 'remove') {
                result = removeRow(def, line.id)
            } else if (kind === 'close') {
                result = closeGroup(def, line.id)
            } else if (kind === 'insertNew') {
                result = insertRow(def, 'end', { kind: 'check', key: 'fresh', label: 'k' })
            } else if (kind === 'insertDup' && draft && line.form.kind === 'value' && draft.kind !== 'caption' && draft.kind !== 'divider' && draft.kind !== 'group') {
                result = insertRow(def, 'end', draft)
            }
            return !result || !result.ok || !result.def || planCarry(def, result.def).length === 0
        }), FAST_CHECK)
    })

    it('P-2: removing one of several same-key rows, or a group of same-label members, plans nothing', () => {
        const several = parseDefinition('k=A\nk=B=text\nx=X')
        const removed = removeRow(several, several.lines[0].id)
        expect(removed.ok && planCarry(several, removed.def)).toEqual([])
        const group = parseDefinition('g=G=group\na=On\nb=On\nc=On\ng_end=G=groupEnd\nz=Z')
        const gone = removeRow(group, group.lines[0].id)
        expect(gone.ok && planCarry(group, gone.def)).toEqual([])
    })

    it('P-8: the plan follows the baseline text order and leaves its inputs unchanged', () => {
        const before = parseDefinition('b=B=select=x,y\na=A')
        const after = parseDefinition('b=B=select=y,x\na=A=select=1,2')
        const beforeText = textOf(before)
        const afterText = textOf(after)
        expect(planCarry(before, after)).toEqual([
            { kind: 'optionRemap', key: 'b', remap: [1, 0], removed: [] },
            { kind: 'kindChange', key: 'a', from: 'check', to: 'select' },
        ])
        expect(textOf(before)).toBe(beforeText)
        expect(textOf(after)).toBe(afterText)
    })

    it('P-9: keys are exact, with no trim and no case folding', () => {
        expect(plan('combat=A', 'combat =A')).toEqual([rename('combat', 'combat ')])
        expect(plan('combat=A', 'Combat=A')).toEqual([rename('combat', 'Combat')])
        expect(plan('combat=A\nCombat=B', 'combat=A\nCombat=B')).toEqual([])
    })

    it('P-11: the plan depends on the two texts, not on line ids', () => {
        const swapped = replaceText(parseDefinition('a=A\nb=B'), 'b=B\na=A')
        expect(planCarry(parseDefinition('a=A\nb=B'), swapped)).toEqual([])
        const base = parseDefinition('a=A\nb=B=select=x,y')
        expect(planCarry(base, replaceText(base, textOf(base)))).toEqual([])
        fc.assert(fc.property(defTextArb, defTextArb, (first, second) => {
            const def = parseDefinition(first)
            expect(planCarry(def, replaceText(def, second))).toEqual(planCarry(parseDefinition(first), parseDefinition(second)))
        }), FAST_CHECK)
    })
})

describe('planCarry renames (N-10)', () => {
    it('P-3: a unique removed/added pair of equal label and class is a rename', () => {
        expect(plan('a=Mode', 'b=Mode')).toEqual([rename('a', 'b')])
        expect(plan('a=Mode=text', 'b=Mode=textarea')).toEqual([rename('a', 'b')])
    })

    it('P-3: ties on a signature ask on every key involved', () => {
        expect(plan('a=Mode\nb=Mode', 'c=Mode')).toEqual([ambiguous('a', 'manyCandidates'), ambiguous('b', 'manyCandidates')])
        expect(plan('a=Mode', 'b=Mode\nc=Mode')).toEqual([ambiguous('a', 'manyCandidates')])
    })

    it('P-3: rows of keys read by several rows count as candidates', () => {
        expect(plan('a=Mode\nb=Mode\nb=Other', 'c=Mode')).toEqual([ambiguous('a', 'manyCandidates'), ambiguous('b', 'manyCandidates')])
        expect(plan('a=Mode', 'c=Mode\nd=Mode\nd=Other')).toEqual([ambiguous('a', 'manyCandidates')])
        expect(plan('b=Mode\nb=Other', 'c=Mode')).toEqual([ambiguous('b', 'manyCandidates')])
    })

    it('P-3: a different label asks, and removals with nothing added never ask', () => {
        expect(plan('a=Mode', 'b=Other')).toEqual([ambiguous('a', 'unmatched')])
        expect(plan('a=Mode\nb=X', 'b=X')).toEqual([])
        expect(plan('a=On\nb=On', '')).toEqual([])
        expect(plan('g=G=group\na=On\nb=On\ng_end=G=groupEnd', '')).toEqual([])
        expect(plan('a=A', 'a=A')).toEqual([])
    })

    it('P-3: a rename onto a key the baseline reads is held or passes by reading, never renamed', () => {
        expect(plan('a=A\nb=B=select=x,y', 'b=A\nb=B=select=x,y')).toEqual([ambiguous('b', 'duplicateKey')])
        expect(plan('a=A\nb=B', 'b=A\nb=B')).toEqual([])
    })

    it('P-5: a rename that also changes the class is not paired', () => {
        expect(plan('a=Mode', 'b=Mode=text')).toEqual([])
        expect(plan('a=Mode', 'b=Mode=text\nc=Other')).toEqual([ambiguous('a', 'unmatched')])
    })
})

describe('planCarry kinds, options, drops, duplicates', () => {
    it('P-5: class changes are kindChange and text/textarea share a class', () => {
        expect(plan('k=L', 'k=L=select=x,y')).toEqual([{ kind: 'kindChange', key: 'k', from: 'check', to: 'select' }])
        expect(plan('k=L=select=x,y', 'k=L=text')).toEqual([{ kind: 'kindChange', key: 'k', from: 'select', to: 'text' }])
        expect(plan('k=L=text', 'k=L=textarea')).toEqual([])
        expect(plan('k=L=textarea', 'k=L=text')).toEqual([])
    })

    it('P-4: option strings: prefix, in-place rename and identity plan nothing', () => {
        expect(plan('k=L=select=x,y', 'k=L=select=x,y,z')).toEqual([])
        expect(plan('k=L=select=x,y,z', 'k=L=select=x,q,z')).toEqual([])
        expect(plan('k=L=select=x,y', 'k=L=select=x,y')).toEqual([])
    })

    it('P-4: a permutation is a remap, and a removed option maps to the first option', () => {
        expect(plan('k=L=select=x,y,z', 'k=L=select=z,x,y')).toEqual([{ kind: 'optionRemap', key: 'k', remap: [1, 2, 0], removed: [] }])
        expect(plan('k=L=select=x,y', 'k=L=select=y,x,z')).toEqual([{ kind: 'optionRemap', key: 'k', remap: [1, 0], removed: [] }])
        expect(plan('k=L=select=x,y,z', 'k=L=select=x,z')).toEqual([{ kind: 'optionRemap', key: 'k', remap: [0, 0, 1], removed: [1] }])
        expect(plan('k=L=select=x,y', 'k=L=select=y')).toEqual([{ kind: 'optionRemap', key: 'k', remap: [0, 0], removed: [0] }])
    })

    it('P-4: removal plus a new string, duplicates and zero options ask', () => {
        expect(plan('k=L=select=x,y,z', 'k=L=select=x,q')).toEqual([ambiguous('k', 'options')])
        expect(plan('k=L=select=x,x', 'k=L=select=x')).toEqual([ambiguous('k', 'options')])
        expect(plan('k=L=select=x,y', 'k=L=select=x,x,y')).toEqual([ambiguous('k', 'options')])
        expect(plan('k=L=select=x,y', 'k=L=select')).toEqual([ambiguous('k', 'options')])
        expect(plan('k=L=select', 'k=L=select')).toEqual([])
    })

    it('P-4: options that changed on a renamed flow ask and the rename is withheld; unchanged options keep the rename', () => {
        expect(plan('a=L=select=x,y,z', 'b=L=select=y,q,x')).toEqual([ambiguous('a', 'options')])
        expect(plan('a=L=select=x,y', 'b=L=select=y,x')).toEqual([rename('a', 'b'), { kind: 'optionRemap', key: 'a', remap: [1, 0], removed: [] }])
        expect(plan('a=L=select=x,y', 'b=L=select=x,y')).toEqual([rename('a', 'b')])
    })

    it('P-4: a trailing CR on the last option is not part of the option', () => {
        expect(plan(crlf('k=L=select=x,y\n'), 'k=L=select=x,y\n')).toEqual([])
        expect(plan(crlf('k=L=select=x,y\n'), crlf('k=L=select=y,x\n'))).toEqual([{ kind: 'optionRemap', key: 'k', remap: [1, 0], removed: [] }])
    })

    it('P-6: a value row turned into a divider or caption with its label is a drop', () => {
        expect(plan('k=Label', '=Label=divider')).toEqual([{ kind: 'drop', key: 'k', to: 'divider' }])
        expect(plan('k=Label', '=Label=caption')).toEqual([{ kind: 'drop', key: 'k', to: 'caption' }])
        expect(plan('k=Label', '=Label=divider\n=Label=caption')).toEqual([{ kind: 'drop', key: 'k', to: 'divider' }])
    })

    it('P-6: deleting a row beside a pre-existing same-text divider is not a drop', () => {
        expect(plan('k=Label\n=Label=divider', '=Label=divider')).toEqual([])
        expect(plan('k=Label\n=Label=caption', '=Label=caption')).toEqual([])
    })

    it('P-7: removing a reading of a duplicated key never asks; a new reading does, with no other item', () => {
        expect(plan('k=A\nk=B=text', 'k=A')).toEqual([])
        expect(plan('k=A', 'k=A\nk=B=text')).toEqual([ambiguous('k', 'duplicateKey')])
        expect(plan('k=A=select=x,y', 'k=A=select=y,x\nk=A')).toEqual([ambiguous('k', 'duplicateKey')])
        expect(plan('k=A\nk=A=text', 'k=A=text\nk=A')).toEqual([])
    })
})

describe('detachingItems and valueKeysOf', () => {
    it('P-10: keeps only items whose old key is a visit key', () => {
        const items: readonly CarryItem[] = [
            rename('a', 'b'),
            { kind: 'optionRemap', key: 'c', remap: [1, 0], removed: [] },
            { kind: 'kindChange', key: 'd', from: 'check', to: 'text' },
            { kind: 'drop', key: 'e', to: 'divider' },
            ambiguous('f', 'unmatched'),
        ]
        expect(detachingItems(items, new Set(['a', 'd', 'f']))).toEqual([items[0], items[2], items[4]])
        expect(detachingItems(items, new Set(['b']))).toEqual([])
        expect(detachingItems(items, new Set())).toEqual([])
    })

    it('valueKeysOf lists exact value row keys only', () => {
        expect([...valueKeysOf(parseDefinition('a=A\nb =B\n=d=divider\ng=G=group\njunk'))]).toEqual(['a', 'b '])
    })
})

describe('planCarry output invariants and safe application', () => {
    it('P-12: over random texts the plan is well formed', () => {
        fc.assert(fc.property(defTextArb, defTextArb, (before, after) => {
            const baseReaders = readersOf(before)
            const currentReaders = readersOf(after)
            const baseKeys = new Set(baseReaders.map((reader) => reader.key))
            const currentKeys = new Set(currentReaders.map((reader) => reader.key))
            const items = planCarry(parseDefinition(before), parseDefinition(after))
            const froms = items.filter((item) => item.kind === 'rename').map((item) => item.from)
            const tos = items.filter((item) => item.kind === 'rename').map((item) => item.to)
            expect(new Set(froms).size).toBe(froms.length)
            expect(new Set(tos).size).toBe(tos.length)
            const perKey = new Map<string, CarryItem[]>()
            for (const item of items) {
                const key = item.kind === 'rename' ? item.from : item.key
                expect(baseKeys.has(key)).toBe(true)
                perKey.set(key, [...(perKey.get(key) ?? []), item])
                if (item.kind === 'rename') {
                    expect(currentKeys.has(item.from)).toBe(false)
                    expect(baseKeys.has(item.to)).toBe(false)
                    expect(currentKeys.has(item.to)).toBe(true)
                }
                if (item.kind === 'optionRemap') {
                    const source = baseReaders.find((reader) => reader.key === item.key)
                    const target = items.find((other) => other.kind === 'rename' && other.from === item.key)
                    const targetKey = target && target.kind === 'rename' ? target.to : item.key
                    const result = currentReaders.find((reader) => reader.key === targetKey)
                    expect(item.remap.length).toBe(source?.options.length)
                    expect(item.remap.every((index) => Number.isInteger(index) && index >= 0 && index < (result?.options.length ?? 0))).toBe(true)
                    for (const index of item.removed) {
                        expect(item.remap[index]).toBe(0)
                    }
                }
            }
            for (const group of perKey.values()) {
                if (group.some((item) => item.kind === 'ambiguous')) {
                    expect(group.length).toBe(1)
                }
            }
        }), FAST_CHECK)
    })

    it('P-13: applying the plan moves values only along unique pairs and never onto another key the baseline reads', () => {
        fc.assert(fc.property(defTextArb, defTextArb, (before, after) => {
            const baseReaders = readersOf(before)
            const currentReaders = readersOf(after)
            const baseKeys = new Set(baseReaders.map((reader) => reader.key))
            const currentKeys = new Set(currentReaders.map((reader) => reader.key))
            const removedRows = baseReaders.filter((reader) => !currentKeys.has(reader.key))
            const addedRows = currentReaders.filter((reader) => !baseKeys.has(reader.key))
            const sameSignature = (left: Reader, right: Reader): boolean => left.label === right.label && left.cls === right.cls
            const singleRow = (rows: Reader[], key: string): boolean => rows.filter((reader) => reader.key === key).length === 1
            const partners = new Map<string, string>()
            for (const removed of removedRows) {
                const removedMatches = removedRows.filter((other) => sameSignature(other, removed))
                const addedMatches = addedRows.filter((other) => sameSignature(other, removed))
                if (removedMatches.length === 1 && addedMatches.length === 1
                    && singleRow(baseReaders, removed.key) && singleRow(currentReaders, addedMatches[0].key)) {
                    partners.set(removed.key, addedMatches[0].key)
                }
            }

            const items = planCarry(parseDefinition(before), parseDefinition(after))
            const renames = items.filter((item) => item.kind === 'rename')
            for (const item of renames) {
                expect(partners.get(item.from)).toBe(item.to)
            }
            for (const [from, to] of partners) {
                const asked = items.some((item) => item.kind === 'ambiguous' && item.key === from)
                expect(asked || renames.some((item) => item.from === from && item.to === to)).toBe(true)
            }

            const seed = new Map<string, string>()
            for (const reader of baseReaders) {
                seed.set(reader.key, reader.cls === 'select' ? '1' : `v:${reader.key}`)
            }
            for (const key of addedRows.map((reader) => reader.key)) {
                seed.set(key, `old:${key}`)
            }
            const applyIn = (keys: readonly string[]): Map<string, string> => {
                const result = new Map(seed)
                for (const key of keys) {
                    for (const item of items.filter((candidate) => candidate.kind === 'optionRemap' && candidate.key === key)) {
                        const value = result.get(key)
                        if (item.kind === 'optionRemap' && value !== undefined && /^\d+$/.test(value) && Number(value) < item.remap.length) {
                            result.set(key, String(item.remap[Number(value)]))
                        }
                    }
                    for (const item of items.filter((candidate) => candidate.kind === 'rename' && candidate.from === key)) {
                        const value = result.get(key)
                        if (item.kind === 'rename' && value !== undefined) {
                            result.set(item.to, value)
                            result.delete(item.from)
                        }
                    }
                }
                return result
            }
            const keys = [...baseKeys]
            const forward = applyIn(keys)
            const reversed = applyIn([...keys].reverse())
            expect([...forward].sort()).toEqual([...reversed].sort())

            const kept = [...baseKeys].filter((key) => currentKeys.has(key) && !items.some((item) => (item.kind === 'rename' ? item.from : item.key) === key))
            for (const key of kept) {
                expect(forward.get(key)).toBe(seed.get(key))
            }
            const sources = new Map(renames.map((item) => [item.to, item.from]))
            for (const added of addedRows.map((reader) => reader.key)) {
                const value = forward.get(added)
                const source = sources.get(added)
                if (source === undefined) {
                    expect(value).toBe(`old:${added}`)
                } else {
                    expect(partners.get(source)).toBe(added)
                    const remapped = items.some((item) => item.kind === 'optionRemap' && item.key === source)
                    if (!remapped) {
                        expect(value).toBe(seed.get(source))
                    }
                }
            }
        }), FAST_CHECK)
    })
})

describe('planCarry over the corpus', () => {
    it('plans nothing when a text is re-parsed from its own bytes', () => {
        for (const entry of corpus) {
            expect(planCarry(parseDefinition(entry.text), parseDefinition(textOf(parseDefinition(entry.text)))), entry.name).toEqual([])
        }
    })
})

describe('addedFromRows (G-F4)', () => {
    it('holds a key only while every row with that key is new', () => {
        expect([...addedFromRows([])]).toEqual([])
        expect([...addedFromRows([{ key: 'b', origin: 'new' }])]).toEqual(['b'])
        expect([...addedFromRows([{ key: 'b', origin: 'base' }])]).toEqual([])
        expect([...addedFromRows([{ key: 'b', origin: 'base' }, { key: 'b', origin: 'new' }])]).toEqual([])
        expect([...addedFromRows([{ key: 'b', origin: 'new' }, { key: 'b', origin: 'new' }, { key: 'a', origin: 'base' }])]).toEqual(['b'])
    })
})

describe('planCarry with the keys the list created (R-F1, G-F2, G-F3)', () => {
    const planWith = (before: string, after: string, added: readonly string[]): readonly CarryItem[] =>
        planCarry(parseDefinition(before), parseDefinition(after), new Set(added))

    it('R-F1: a list-created key is never a rename target or an unmatched addition', () => {
        expect(plan('a=Mode\n', 'b=Style\n')).toEqual([ambiguous('a', 'unmatched')])
        expect(planWith('a=Mode\n', 'b=Style\n', ['b'])).toEqual([])
    })

    it('G-F2: an excluded key leaves the pairing to the other added keys', () => {
        expect(planWith('a=Mode\n', 'b=Mode\n', ['b'])).toEqual([])
        expect(planWith('a=Mode\n', 'b=Mode\nc=Mode\n', ['c'])).toEqual([rename('a', 'b')])
        expect(plan('a=Mode\n', 'b=Mode\nc=Mode\n')).toEqual([ambiguous('a', 'manyCandidates')])
    })

    it('G-F3: a kept key, a removed key or garbage in the set gives the plan without it', () => {
        const base = 'a=Mode\nk=Keep\n'
        const current = 'b=Mode\nk=Keep\n'
        const without = plan(base, current)
        expect(without).toEqual([rename('a', 'b')])
        expect(planWith(base, current, ['k'])).toEqual(without)
        expect(planWith(base, current, ['a'])).toEqual(without)
        expect(planWith(base, current, ['zzz', ''])).toEqual(without)
    })

    it('P-12x: an empty set is the two-argument plan, and a renamed-to key is never in the set', () => {
        fc.assert(fc.property(defTextArb, defTextArb, fc.array(word, { maxLength: 4 }), (before, after, keys) => {
            const base = parseDefinition(before)
            const current = parseDefinition(after)
            expect(planCarry(base, current, new Set())).toEqual(planCarry(base, current))
            const added: ReadonlySet<string> = new Set<string>(keys)
            for (const item of planCarry(base, current, added)) {
                if (item.kind === 'rename') {
                    expect(added.has(item.to)).toBe(false)
                }
            }
            const baseKeys = valueKeysOf(base)
            const effective = new Set([...added].filter((key) => valueKeysOf(current).has(key) && !baseKeys.has(key)))
            expect(planCarry(base, current, added)).toEqual(planCarry(base, current, effective))
        }), FAST_CHECK)
    })
})

describe('the renumbering window (G-W1)', () => {
    const select = (key: string, options: string, label = 'S'): string => `${key}=${label}=select=${options}\n`
    const lateOf = (baseline: string, t0: string, current: string): string[] =>
        [...lateOldKeys(parseDefinition(baseline), parseDefinition(t0), parseDefinition(current))]

    it('W1 to W4: a change older than this window makes the old key late', () => {
        expect(lateOf(select('s', 'x,y'), select('s', 'y,x'), select('d', 'y,x'))).toEqual(['s'])
        expect(lateOf(select('s', 'x,y'), select('d', 'y,x'), select('d', 'y,x'))).toEqual(['s'])
        expect(lateOf(select('s', 'x,y'), select('s', 'y,x'), select('s', 'y,x'))).toEqual(['s'])
        expect(lateOf(select('s', 'x,y'), select('d', 'x,y'), select('d', 'y,x'))).toEqual(['s'])
    })

    it('W5 to W7: a change made wholly in this window is not late', () => {
        expect(lateOf(select('s', 'x,y'), select('s', 'x,y'), select('d', 'y,x'))).toEqual([])
        expect(lateOf(select('s', 'x,y'), select('s', 'x,y'), select('s', 'y,x'))).toEqual([])
        expect(lateOf(select('s', 'x,y'), select('s', 'x,y'), select('s', 'y,x'))).toEqual([])
    })

    it('W8: a failed clear leaves the carried text as T0, so the key is late, renamed or not', () => {
        expect(lateOf(select('s', 'x,y'), select('s', 'y,x'), select('s', 'y,x'))).toEqual(['s'])
        expect(lateOf(select('s', 'x,y'), select('d', 'y,x'), select('d', 'y,x'))).toEqual(['s'])
    })

    it('W9: one late key does not make a plain rename of another key late', () => {
        const baseline = `${select('s', 'x,y')}t=T\n`
        const t0 = `${select('s', 'y,x')}t=T\n`
        const current = `${select('s', 'y,x')}u=T\n`
        expect(lateOf(baseline, t0, current)).toEqual(['s'])
    })

    it('W10: an option appended in an earlier visit still makes the later reorder late', () => {
        expect(lateOf(select('s', 'x,y'), select('s', 'x,y,z'), select('s', 'z,x,y'))).toEqual(['s'])
    })

    it('W11: a label changed in an earlier visit is not a reading', () => {
        expect(lateOf(select('s', 'x,y'), select('s', 'x,y', 'Other'), select('s', 'y,x', 'Other'))).toEqual([])
    })

    it('W12: only the key whose earlier change is older than this window is late', () => {
        const pair = (s: string, t: string): string => select('s', s) + select('t', t, 'T')
        expect(lateOf(pair('x,y', 'p,q'), pair('x,y', 'q,p'), pair('y,x', 'q,p'))).toEqual(['t'])
    })

    it('a list-created key is not a rename target for the lateness plan either', () => {
        const baseline = parseDefinition(select('s', 'x,y'))
        const t0 = parseDefinition(select('s', 'y,x'))
        const current = parseDefinition(select('d', 'y,x'))
        expect([...lateOldKeys(baseline, t0, current)]).toEqual(['s'])
        expect([...lateOldKeys(baseline, t0, current, new Set(['d']))]).toEqual([])
    })

    it('windowDirty compares readings as sets, treats a key absent from T0 as dirty and ignores kept check rows', () => {
        const dirty = (baseline: string, t0: string): string[] => [...windowDirty(parseDefinition(baseline), parseDefinition(t0))]
        expect(dirty('a=A\n', 'a=A\n')).toEqual([])
        expect(dirty('a=A\n', 'b=A\n')).toEqual(['a'])
        expect(dirty(select('s', 'x,y'), select('s', 'y,x'))).toEqual(['s'])
        expect(dirty(select('s', 'x,y'), select('s', 'x,y'))).toEqual([])
        expect(dirty('a=A\n', 'a=A=text\n')).toEqual(['a'])
        expect(dirty('a=A\na=A\n', 'a=A\n')).toEqual([])
        expect(dirty('a=A=select=x,y\n', 'a=A=select=x,y\na=A=select=y,x\n')).toEqual(['a'])
        expect(dirty('a=A=select=x,y\na=A=select=y,x\n', 'a=A=select=x,y\n')).toEqual(['a'])
    })

    it('a drop or kind change is not an option renumbering and is never late', () => {
        expect(lateOf('a=A\nb=B\n', 'b=B\n', 'b=B\n=A=divider\n')).toEqual([])
        expect(lateOf('a=A\n', 'a=A=text\n', 'a=A=text\n')).toEqual([])
    })
})
