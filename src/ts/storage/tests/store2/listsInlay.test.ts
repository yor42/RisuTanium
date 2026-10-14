import { describe, expect, it } from 'vitest'
import { hexStemToBase64url, IL_REF_V, parseInlayList, splitHashStems } from '../../store2/format'
import { createListDerivation, DEFAULT_MAX_INLAY_BODY_BYTES, deriveInlayList, mergeInlayLists, overflowInlayList } from '../../store2/lists'
import { chatWith, HEX_A, HEX_B, inlayToken, UUID_A, UUID_B, parsedValue } from './listsFixtures'

describe('inlay list derivation', () => {
    it('finds uuid, asset-shaped and other-shaped ids', () => {
        const text = [inlayToken(UUID_A), inlayToken(`assets/${HEX_A}.png`), inlayToken('Custom Id #1')].join(' ')
        const list = deriveInlayList([{ chats: [chatWith(text)] }])
        expect(list.u).toEqual([UUID_A])
        expect(splitHashStems(list.h)).toEqual([hexStemToBase64url(HEX_A)])
        expect(list.o).toEqual(['Custom Id #1'])
        expect(list.v).toBe(IL_REF_V)
        expect(list.x).toBeUndefined()
        expect(parsedValue(parseInlayList(JSON.parse(JSON.stringify(list))))).toEqual(list)
    })

    it('finds ids in every token kind, in keys, and in uuids that are not inside a token', () => {
        const list = deriveInlayList([{ [UUID_B]: 1, text: `{{inlayed::${UUID_A}}} {{inlayeddata::odd}}`, deep: [[[{ n: `see assets/${HEX_B}.webp` }]]] }])
        expect(list.u).toEqual([UUID_A, UUID_B])
        expect(splitHashStems(list.h)).toEqual([hexStemToBase64url(HEX_B)])
        expect(list.o).toEqual(['odd'])
    })

    it('lower-cases an upper-case uuid', () => {
        const list = deriveInlayList([{ text: inlayToken(UUID_B.toUpperCase()) }])
        expect(list.u).toEqual([UUID_B])
    })

    it('keeps an asset hash given in upper case as the same stem', () => {
        const list = deriveInlayList([{ text: `assets/${HEX_A.toUpperCase()}` }])
        expect(splitHashStems(list.h)).toEqual([hexStemToBase64url(HEX_A)])
    })

    it('keeps all ids of an owner with 5,000 of them', () => {
        const ids = Array.from({ length: 5000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
        const list = deriveInlayList([{ chats: [chatWith(ids.map(inlayToken).join('\n'))] }])
        expect(list.u).toHaveLength(5000)
        expect(list.x).toBeUndefined()
        const others = deriveInlayList([{ text: Array.from({ length: 5000 }, (_, i) => inlayToken(`other-${i}`)).join(' ') }])
        expect(others.o).toHaveLength(5000)
    })

    it('is sorted, unique and byte-stable regardless of order', () => {
        const a = deriveInlayList([{ t: [inlayToken(UUID_B), inlayToken(UUID_A), inlayToken('z'), inlayToken('a'), inlayToken('a')] }])
        const b = deriveInlayList([{ t: [inlayToken('a'), inlayToken(UUID_A), inlayToken('z'), inlayToken(UUID_B)] }])
        expect(JSON.stringify(a)).toBe(JSON.stringify(b))
        expect(a.u).toEqual([UUID_A, UUID_B])
        expect(a.o).toEqual(['a', 'z'])
    })

    it('sets x with empty lists when the body is over the size parameter', () => {
        const text = [inlayToken(UUID_A), inlayToken(UUID_B)].join(' ')
        const small = deriveInlayList([{ text }], { maxInlayBodyBytes: 40 })
        expect(small).toEqual(overflowInlayList())
        expect(small.x).toBe(true)
        const fits = deriveInlayList([{ text }], { maxInlayBodyBytes: 4096 })
        expect(fits.x).toBeUndefined()
        expect(fits.u).toHaveLength(2)
    })

    it('defaults the size parameter to 8 MiB', () => {
        expect(DEFAULT_MAX_INLAY_BODY_BYTES).toBe(8 * 1024 * 1024)
    })
})

describe('inlay list merge', () => {
    it('is a superset of both sides', () => {
        const previous = deriveInlayList([{ t: `${inlayToken(UUID_A)} ${inlayToken('old')} assets/${HEX_A}` }])
        const added = deriveInlayList([{ t: `${inlayToken(UUID_B)} ${inlayToken('new')} assets/${HEX_B}` }])
        const merged = mergeInlayLists(previous, added)
        expect(merged.u).toEqual([UUID_A, UUID_B])
        expect(merged.o).toEqual(['new', 'old'])
        expect(splitHashStems(merged.h)).toEqual([hexStemToBase64url(HEX_A), hexStemToBase64url(HEX_B)].sort())
    })

    it('equals the full derivation of the union of the owners\' text', () => {
        const left = { t: `${inlayToken(UUID_A)} ${inlayToken('x')}` }
        const right = { t: `${inlayToken(UUID_B)} ${inlayToken('y')} assets/${HEX_A}` }
        expect(mergeInlayLists(deriveInlayList([left]), deriveInlayList([right]))).toEqual(deriveInlayList([left, right]))
    })

    it('keeps the overflow marker from either side and overflows when the union is too big', () => {
        const some = deriveInlayList([{ t: inlayToken(UUID_A) }])
        expect(mergeInlayLists(overflowInlayList(), some).x).toBe(true)
        expect(mergeInlayLists(some, overflowInlayList()).x).toBe(true)
        const other = deriveInlayList([{ t: inlayToken(UUID_B) }])
        expect(mergeInlayLists(some, other, { maxInlayBodyBytes: 60 }).x).toBe(true)
    })

    it('never completes a union when a side is older or newer than the current version', () => {
        const current = deriveInlayList([{ t: inlayToken(UUID_A) }])
        const added = deriveInlayList([{ t: inlayToken(UUID_B) }])
        expect(mergeInlayLists(current, added).x).toBeUndefined()
        const olderPrevious = { ...current, v: IL_REF_V - 1 }
        const newerPrevious = { ...current, v: IL_REF_V + 1 }
        const olderAdded = { ...added, v: IL_REF_V - 1 }
        for (const merged of [mergeInlayLists(olderPrevious, added), mergeInlayLists(newerPrevious, added), mergeInlayLists(current, olderAdded)]) {
            expect(merged).toEqual(overflowInlayList())
            expect(merged.u).toEqual([])
        }
    })
})

describe('config-level inlay scan', () => {
    it('covers config, presets, loadouts, plugins and plugin-storage values', () => {
        const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555']
        const derivation = createListDerivation()
        const list = derivation.configInlays({
            config: { note: inlayToken(ids[0]) },
            presets: [{ prompt: inlayToken(ids[1]) }],
            plugins: [{ script: inlayToken(ids[2]) }],
            pluginStorage: { key: { value: inlayToken(ids[3]) } },
            loadouts: [inlayToken(ids[4])],
            statics: undefined,
            characterOrder: undefined,
        })
        expect(list?.u).toEqual(ids)
    })
})
