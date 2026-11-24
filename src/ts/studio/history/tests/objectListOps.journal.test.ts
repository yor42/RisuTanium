// The visit journal's tail merge and line inversion (S7-0 stage 0b). Rows come from the classic producers' golden.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { entryAnchor, journalAppend, lineOpsOf, type ObjEntry, type ObjFamilyOp, type ObjJournalEntry, type ObjSetOp } from '../objectListOps'

interface Golden {
    blank: { globalLore: ObjEntry[] }
}
const golden: Golden = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'loreClassic.golden.json'), 'utf8'))
const [ADDED] = golden.blank.globalLore

function commentOp(from: string, to: string): ObjSetOp {
    return {
        op: 'objSet',
        list: 'lore',
        index: 0,
        field: 'comment',
        before: { had: true, value: from },
        after: { had: true, value: to },
        anchorBefore: entryAnchor('lore', { ...ADDED, comment: from }) as number,
        anchorAfter: entryAnchor('lore', { ...ADDED, comment: to }) as number,
    }
}

describe('journalAppend', () => {
    test('consecutive edits of one field merge into one entry without mutating either op', () => {
        const a = commentOp('A', 'B')
        const b = commentOp('B', 'C')
        const frozen = [JSON.stringify(a), JSON.stringify(b)]
        const first: ObjJournalEntry = { ops: [a] }
        const journal: ObjJournalEntry[] = [first]
        journalAppend(journal, [b])
        expect(journal).toHaveLength(1)
        expect(journal[0].ops[0]).toMatchObject({ before: { had: true, value: 'A' }, after: { had: true, value: 'C' } })
        expect(journal[0]).not.toBe(first)
        expect([JSON.stringify(a), JSON.stringify(b)]).toEqual(frozen)
    })

    test('an edit that returns the field to its start removes the entry', () => {
        const journal: ObjJournalEntry[] = [{ ops: [commentOp('A', 'B')] }]
        journalAppend(journal, [commentOp('B', 'A')])
        expect(journal).toEqual([])
    })

    test('different fields, rows or a broken anchor chain stay separate entries; an empty plan adds nothing', () => {
        const journal: ObjJournalEntry[] = [{ ops: [commentOp('A', 'B')] }]
        journalAppend(journal, [{ ...commentOp('B', 'C'), index: 1 }])
        journalAppend(journal, [{ ...commentOp('C', 'D'), field: 'content' }])
        journalAppend(journal, [commentOp('X', 'Y')])
        journalAppend(journal, [])
        expect(journal).toHaveLength(4)
    })

    test('a different field on the same row with a matching value and anchor chain stays a separate entry', () => {
        const a = commentOp('A', 'B')
        const b: ObjSetOp = { ...commentOp('B', 'C'), field: 'content', before: a.after, anchorBefore: a.anchorAfter }
        const journal: ObjJournalEntry[] = [{ ops: [a] }]
        journalAppend(journal, [b])
        expect(journal).toHaveLength(2)
    })

    test('a same-field edit whose value matches but whose anchor chain is broken stays a separate entry', () => {
        const a = commentOp('A', 'B')
        const b: ObjSetOp = { ...commentOp('B', 'C'), anchorBefore: a.anchorAfter + 1 }
        const journal: ObjJournalEntry[] = [{ ops: [a] }]
        journalAppend(journal, [b])
        expect(journal).toHaveLength(2)
    })

    test('propSet entries merge by property', () => {
        const prop = (before: unknown, after: unknown): ObjFamilyOp => ({ op: 'propSet', prop: 'loreSettings', before, after }) as ObjFamilyOp
        const journal: ObjJournalEntry[] = [{ ops: [prop({ had: false }, { had: true, value: { x: 1 } })] }]
        journalAppend(journal, [prop({ had: true, value: { x: 1 } }, { had: true, value: { x: 2 } })])
        expect(journal).toHaveLength(1)
        expect(journal[0].ops[0]).toMatchObject({ before: { had: false }, after: { had: true, value: { x: 2 } } })
        journalAppend(journal, [prop({ had: true, value: { x: 2 } }, { had: false })])
        expect(journal).toEqual([])
    })
})

describe('lineOpsOf', () => {
    test('newest entry first, each entry reversed and inverted', () => {
        const a = commentOp('A', 'B')
        const b = commentOp('B', 'C')
        const c = commentOp('X', 'Y')
        const ops = lineOpsOf([{ ops: [a] }, { ops: [b, c] }])
        expect(ops.map((op) => (op.op === 'objSet' ? [op.before, op.after] : null))).toEqual([
            [c.op === 'objSet' && c.after, c.op === 'objSet' && c.before],
            [b.op === 'objSet' && b.after, b.op === 'objSet' && b.before],
            [a.op === 'objSet' && a.after, a.op === 'objSet' && a.before],
        ])
    })
})
