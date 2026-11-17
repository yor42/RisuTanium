import { describe, test, expect } from 'vitest'
import { SIDE_SECTION_IDS, type SideSectionId } from 'src/ts/drive/rtb/entryNames'
import type { OmittedEntry } from 'src/ts/drive/rtb/manifest'
import type { SectionRow } from 'src/ts/drive/rtb/sections'
import { decideSideSection, decideSideSections } from 'src/ts/drive/rtb/sideDecision'

const ID: SideSectionId = 'side.iris'

function row(id: string, v: number): SectionRow {
    return { id, v, required: false, prefix: `s/${id.slice(5)}/`, entries: 1, bytes: 0, meta: null }
}

function omit(kind: string, name: string, reason: string): OmittedEntry {
    return { kind, name, reason }
}

describe('decideSideSection (T6, R)', () => {
    test('a v1 row restores', () => {
        const r = row(ID, 1)
        expect(decideSideSection(ID, [r], [])).toEqual({ kind: 'restore', id: ID, row: r })
    })

    test('a v1 row that is also omitted is a conflict, the store is left (MC-2045)', () => {
        expect(decideSideSection(ID, [row(ID, 1)], [omit('side', ID, 'unreadable')])).toEqual({ kind: 'leave', id: ID, status: 'conflict' })
    })

    test('a v2 row clears and is named newer', () => {
        expect(decideSideSection(ID, [row(ID, 2)], [])).toEqual({ kind: 'clear', id: ID, status: 'newer', v: 2 })
    })

    test('a v2 row that is also omitted is a conflict', () => {
        expect(decideSideSection(ID, [row(ID, 2)], [omit('side', ID, 'x')])).toEqual({ kind: 'leave', id: ID, status: 'conflict' })
    })

    test('an omitted entry alone leaves the store, whatever its reason', () => {
        for (const reason of ['unreadable', 'some reason this build never heard of', '']) {
            expect(decideSideSection(ID, [], [omit('side', ID, reason)])).toEqual({ kind: 'leave', id: ID, status: 'omitted', reason })
        }
    })

    test('an omitted entry of another kind or name does not match', () => {
        expect(decideSideSection(ID, [], [omit('asset', ID, 'unreadable')])).toEqual({ kind: 'clear', id: ID, status: 'absent' })
        expect(decideSideSection(ID, [], [omit('side', 'side.google-search', 'unreadable')])).toEqual({ kind: 'clear', id: ID, status: 'absent' })
    })

    test('nothing at all clears the store as absent', () => {
        expect(decideSideSection(ID, [], [])).toEqual({ kind: 'clear', id: ID, status: 'absent' })
    })

    test('a row of another id does not count', () => {
        expect(decideSideSection(ID, [row('side.google-search', 1)], [])).toEqual({ kind: 'clear', id: ID, status: 'absent' })
    })
})

describe('decideSideSections', () => {
    test('one action per side section in id order', () => {
        const actions = decideSideSections([row('side.iris', 1)], [omit('side', 'side.ui-prefs', 'unreadable')])
        expect(actions.map((a) => a.id)).toEqual(SIDE_SECTION_IDS)
        expect(actions.find((a) => a.id === 'side.iris')?.kind).toBe('restore')
        expect(actions.find((a) => a.id === 'side.ui-prefs')).toMatchObject({ kind: 'leave', status: 'omitted' })
        expect(actions.filter((a) => a.kind === 'clear')).toHaveLength(6)
    })
})
