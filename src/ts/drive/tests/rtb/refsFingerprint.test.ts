import { describe, test, expect } from 'vitest'
import { REFS_TABLE } from 'src/ts/storage/store2/format/refsOf'
import { UNIT_TYPE } from 'src/ts/storage/store2/format/versions'
import { V1_REF_STRINGS, checkRefs, checkReqTokens, normalizeRefs } from 'src/ts/drive/rtb/refsFingerprint'

describe('the v1 refs strings', () => {
    test('are the walkable rows of the refs table: 32 rows less the three commit rows and the legacyKeep row', () => {
        expect(REFS_TABLE.length).toBe(32)
        expect(V1_REF_STRINGS.length).toBe(28)
        expect(new Set(V1_REF_STRINGS).size).toBe(28)
        for (const row of REFS_TABLE) {
            const text = `${row.type}:${row.path}`
            const skipped = row.type === UNIT_TYPE.commit || text === '2:fixed.legacyKeep.unit'
            expect(V1_REF_STRINGS.includes(text)).toBe(!skipped)
        }
    })
})

describe('T13lib refs membership and grammar', () => {
    test('all 28 v1 strings, in any order, and an empty list are accepted', () => {
        expect(checkRefs([...V1_REF_STRINGS])).toEqual({ kind: 'ok' })
        expect(checkRefs([])).toEqual({ kind: 'ok' })
    })

    test('a well-formed string the table lacks is newer and is named', () => {
        expect(checkRefs(['3:entries[].future'])).toEqual({ kind: 'newer', refs: ['3:entries[].future'] })
        expect(checkRefs([V1_REF_STRINGS[0], '99:other', '2:fixed.legacyKeep.unit'])).toEqual({
            kind: 'newer',
            refs: ['99:other', '2:fixed.legacyKeep.unit'],
        })
    })

    test.each([
        ['a leading zero in the type', '02:x'],
        ['type 0', '0:x'],
        ['type 256', '256:x'],
        ['four digits', '1000:x'],
        ['an empty path', '2:'],
        ['no separator', 'x'],
        ['no type', ':x'],
        ['a signed type', '+2:x'],
    ])('a malformed string is damaged, not newer: %s', (_label, text) => {
        expect(checkRefs([text]).kind).toBe('damaged')
    })

    test('type 1 and type 255 are well-formed', () => {
        expect(checkRefs(['1:x', '255:x']).kind).toBe('newer')
    })

    test('a number element and a refs value that is not an array are damaged', () => {
        expect(checkRefs([5]).kind).toBe('damaged')
        expect(checkRefs([null]).kind).toBe('damaged')
        expect(checkRefs('2:fixed.config').kind).toBe('damaged')
        expect(checkRefs({}).kind).toBe('damaged')
        expect(checkRefs(null).kind).toBe('damaged')
    })

    test('a malformed element wins over a newer one', () => {
        expect(checkRefs(['99:other', '02:x']).kind).toBe('damaged')
    })

    test('an injected table decides membership, and an alias keeps a renamed path known', () => {
        expect(checkRefs(['2:a', '2:b'], { table: ['2:a'] })).toEqual({ kind: 'newer', refs: ['2:b'] })
        expect(checkRefs(['2:a', '2:b'], { table: ['2:a'], aliases: ['2:b'] })).toEqual({ kind: 'ok' })
    })
})

describe('T-refsord order and duplicates are not refused on read', () => {
    test('unsorted and duplicated refs are accepted', () => {
        const reversed = [...V1_REF_STRINGS].reverse()
        expect(checkRefs(reversed)).toEqual({ kind: 'ok' })
        expect(checkRefs([V1_REF_STRINGS[0], V1_REF_STRINGS[0], V1_REF_STRINGS[1]])).toEqual({ kind: 'ok' })
    })

    test('the writer form is sorted by the default string order and deduplicated', () => {
        expect(normalizeRefs(['3:b', '10:a', '3:a', '3:b'])).toEqual(['10:a', '3:a', '3:b'])
        expect(normalizeRefs([])).toEqual([])
    })
})

describe('req tokens of the manifest copy', () => {
    test('known tokens and an empty list are accepted', () => {
        expect(checkReqTokens([])).toEqual({ kind: 'ok' })
        expect(checkReqTokens(['chat-alt', 'task-presets', 'module-buckets'])).toEqual({ kind: 'ok' })
    })

    test('an unknown token is newer and is named', () => {
        expect(checkReqTokens(['chat-alt', 'future-token'])).toEqual({ kind: 'newer', tokens: ['future-token'] })
    })

    test('a list that is not an array of strings is damaged', () => {
        expect(checkReqTokens('chat-alt').kind).toBe('damaged')
        expect(checkReqTokens([1]).kind).toBe('damaged')
        expect(checkReqTokens(null).kind).toBe('damaged')
    })

    test('an injected known set replaces the default', () => {
        expect(checkReqTokens(['x'], new Set(['x']))).toEqual({ kind: 'ok' })
        expect(checkReqTokens(['chat-alt'], new Set(['x'])).kind).toBe('newer')
    })
})
