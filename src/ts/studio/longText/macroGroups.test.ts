import { describe, expect, test } from 'vitest'
import { languageEnglish } from '../../../lang/en'
import { MACRO_GROUPS, MACRO_ROWS } from './macroGroups'

describe('the macro table', () => {
    test('C2-U4(a) 66 rows, one for every label, ids unique', () => {
        expect(MACRO_ROWS).toHaveLength(66)
        expect(new Set(MACRO_ROWS.map((row) => row.id)).size).toBe(66)
        expect([...MACRO_ROWS.map((row) => row.id)].sort()).toEqual(Object.keys(languageEnglish.ltMacroRows).sort())
    })

    test('the seven groups are all used, in the order the sheet shows them', () => {
        expect(MACRO_GROUPS).toEqual(['char', 'var', 'time', 'text', 'logic', 'display', 'block'])
        for (const group of MACRO_GROUPS) expect(MACRO_ROWS.some((row) => row.group === group), group).toBe(true)
        expect(MACRO_ROWS.every((row) => MACRO_GROUPS.includes(row.group))).toBe(true)
    })

    test('C2-x34 C2-x35 C2-x36 pick takes arguments, slot takes none, and else and the comment sit in their own groups', () => {
        const find = (id: string) => MACRO_ROWS.find((row) => row.id === id)
        expect(find('pick')).toMatchObject({ kind: 'args', name: 'pick', group: 'time' })
        expect(find('slot')).toMatchObject({ kind: 'plain', name: 'slot', group: 'display' })
        expect(find('else')).toMatchObject({ kind: 'else', group: 'block' })
        expect(find('comment')).toMatchObject({ kind: 'comment', group: 'display' })
    })

    test('block rows carry a head and a matching closer, the rest are the table\'s plain kinds', () => {
        for (const row of MACRO_ROWS) {
            if (row.kind === 'block') {
                expect(row.group).toBe('block')
                expect(row.head.startsWith('#')).toBe(true)
                expect(row.closer.startsWith('{{/')).toBe(true)
                expect(row.closer.endsWith('}}')).toBe(true)
            } else if (row.kind === 'plain' || row.kind === 'args') {
                expect(row.name).toMatch(/^[a-z_]+$/)
            }
        }
    })
})
