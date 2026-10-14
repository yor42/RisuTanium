import { describe, expect, it } from 'vitest'
import { ASSET_REF_V, IL_REF_V, parseLegacyList, splitHashStems, hexStemToBase64url } from '../../store2/format'
import { deriveLegacyList, type LegacyFileInput } from '../../store2/lists'
import { chatWith, HEX_A, HEX_B, inlayToken, UUID_A, UUID_B, parsedValue } from './listsFixtures'

const fileA: LegacyFileInput = {
    key: 'database/database.bin',
    status: 'ok',
    database: {
        customBackground: `assets/${HEX_A}.png`,
        characters: [{ chaId: 'a', image: 'Old-A.PNG', chats: [chatWith(inlayToken(UUID_A))] }],
        modules: [{ id: 'm', icon: 'ModIcon.gif' }],
    },
}

const fileB: LegacyFileInput = {
    key: 'database/dbbackup-1.bin',
    status: 'ok',
    database: { characters: [{ chaId: 'stub', image: 'stub.png' }] },
    coldCharacters: [{ chaId: 'cold', additionalAssets: [['x', `assets/${HEX_B}.webp`]], chats: [chatWith(inlayToken('odd-id'))] }],
    coldValues: [{ text: inlayToken(UUID_B) }],
}

describe('legacy list', () => {
    it('is the union over the readable files, with the inlay body of their text', () => {
        const list = deriveLegacyList([fileA, fileB])
        expect(list.v).toBe(ASSET_REF_V)
        expect(list.iv).toBe(IL_REF_V)
        expect(splitHashStems(list.h)).toEqual([hexStemToBase64url(HEX_A), hexStemToBase64url(HEX_B)].sort())
        expect(list.l).toEqual(['modicon.gif', 'old-a.png', 'stub.png'])
        expect(list.i.u).toEqual([UUID_A, UUID_B])
        expect(list.i.o).toEqual(['odd-id'])
        expect(list.files).toEqual([{ key: 'database/database.bin', status: 'ok' }, { key: 'database/dbbackup-1.bin', status: 'ok' }])
        expect(parsedValue(parseLegacyList(JSON.parse(JSON.stringify(list))))).toEqual(list)
    })

    it('lists an unreadable file as unreadable and takes nothing from it', () => {
        const unreadable: LegacyFileInput = { key: 'database/dbbackup-2.bin', status: 'unreadable' }
        const withBad = deriveLegacyList([fileA, unreadable])
        const without = deriveLegacyList([fileA])
        expect(withBad.files).toEqual([{ key: 'database/database.bin', status: 'ok' }, { key: 'database/dbbackup-2.bin', status: 'unreadable' }])
        expect({ ...withBad, files: [] }).toEqual({ ...without, files: [] })
        expect(deriveLegacyList([unreadable])).toEqual({
            v: ASSET_REF_V, iv: IL_REF_V, files: [{ key: 'database/dbbackup-2.bin', status: 'unreadable' }], h: '', l: [],
            i: { v: IL_REF_V, u: [], h: '', o: [] },
        })
    })

    it('does not read an unreadable file even when it carries content', () => {
        const poisoned = { key: 'x', status: 'unreadable', database: fileA.status === 'ok' ? fileA.database : {} } as LegacyFileInput
        expect(deriveLegacyList([poisoned]).l).toEqual([])
    })

    it('is deterministic in the order of the input files', () => {
        const forward = deriveLegacyList([fileA, fileB, { key: 'database/dbbackup-2.bin', status: 'unreadable' }])
        const reverse = deriveLegacyList([{ key: 'database/dbbackup-2.bin', status: 'unreadable' }, fileB, fileA])
        expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse))
    })

    it('refuses the same key twice', () => {
        expect(() => deriveLegacyList([fileA, fileA])).toThrow(RangeError)
    })

    it('sets x on the inlay body when it is over the size parameter', () => {
        expect(deriveLegacyList([fileA, fileB], { maxInlayBodyBytes: 30 }).i.x).toBe(true)
    })
})
