import { describe, expect, it, vi } from 'vitest'

// The collector is a pure function; the modules below only start effects that need a live UI.
vi.mock('../../../translator/translator', () => ({}))
vi.mock('../../../parser/parser.svelte', () => ({ risuChatParser: vi.fn() }))
vi.mock('../../../process/modules', () => ({ moduleUpdate: vi.fn() }))

import { getUncleanablesSync } from '../../../globalApi.svelte'
import { ASSET_REF_V, hexStemToBase64url, parseAssetList, splitHashStems, type AssetList } from '../../store2/format'
import { deriveCharacterAssets, deriveConfigAssets, deriveModuleAssets, isHashStemKey } from '../../store2/lists'
import { ASSET_KINDS, asDatabase, HEX_A, HEX_B, listHolds, ORDER_KIND, richDatabase, type Obj, parsedValue } from './listsFixtures'

function derive(scope: 'character' | 'module' | 'config', owner: Obj): AssetList {
    switch (scope) {
        case 'character': return deriveCharacterAssets(owner)
        case 'module': return deriveModuleAssets(owner)
        case 'config': return deriveConfigAssets(owner, owner.characterOrder)
    }
}

describe('asset list derivation, one field kind at a time', () => {
    for (const kind of ASSET_KINDS) {
        it(`keeps the asset held only in ${kind.kind}`, () => {
            const list = derive(kind.scope, kind.owner(kind.name))
            expect(listHolds(list, kind.name)).toBe(true)
        })
    }

    it('keeps the asset held only in the character-order folder image', () => {
        const list = deriveConfigAssets({}, [{ imgFile: ORDER_KIND.name, data: [] }, 'plain-id'])
        expect(listHolds(list, ORDER_KIND.name)).toBe(true)
    })
})

describe('loadout icons in the config list', () => {
    const icon = `assets/${HEX_A}.png`
    const loadouts = [{ id: 'l1', icons: [icon, 'Custom-Icon.PNG', 5] }, { id: 'l2' }, 'not-a-loadout']

    it('keeps icons of loadouts passed apart from the config root, as the codec holds them', () => {
        const list = deriveConfigAssets({}, [], loadouts)
        expect(listHolds(list, icon)).toBe(true)
        expect(listHolds(list, 'Custom-Icon.PNG')).toBe(true)
    })

    it('keeps icons of loadouts carried by a whole old database', () => {
        expect(listHolds(deriveConfigAssets({ loadouts }, []), icon)).toBe(true)
    })

    it('holds nothing for loadouts without icons', () => {
        expect(deriveConfigAssets({}, [], [{ id: 'l' }, { icons: 'x' }])).toEqual({ v: ASSET_REF_V, h: '', l: [] })
    })
})

describe('asset list against today\'s keep-set collector', () => {
    it('holds every basename the collector keeps on a database with every field kind', () => {
        const db = richDatabase()
        const kept = getUncleanablesSync(asDatabase(db))
        expect(kept.length).toBeGreaterThanOrEqual(ASSET_KINDS.length + 1)

        const characters = db.characters as Obj[]
        const modules = db.modules as Obj[]
        const config = deriveConfigAssets(db, db.characterOrder)
        const lists = [config, ...characters.map(deriveCharacterAssets), ...modules.map(deriveModuleAssets)]
        for (const name of kept) {
            expect(lists.some(list => listHolds(list, name)), name).toBe(true)
        }
    })

    it('puts hashed names in h whatever their extension case, and custom ids in l lower-cased', () => {
        const list = deriveCharacterAssets({
            image: `assets/${HEX_A.toUpperCase()}.PNG`,
            additionalAssets: [['a', `assets/${HEX_A}.png`], ['b', `assets\\${HEX_B}.Webp`], ['c', 'My-Custom_ID.WAV']],
        })
        expect(splitHashStems(list.h)).toHaveLength(2)
        expect(list.l).toEqual(['my-custom_id.wav'])
    })
})

describe('hash versus literal classification of a comparison key', () => {
    const hex64 = HEX_A
    it('classes exactly 64 lower-case hex digits without extension as a hash', () => {
        expect(hex64).toHaveLength(64)
        expect(isHashStemKey(hex64)).toBe(true)
    })

    it('classes everything else as a literal', () => {
        expect(isHashStemKey(`${hex64}.png`)).toBe(false)
        expect(isHashStemKey(hex64.slice(1))).toBe(false)
        expect(isHashStemKey(`${hex64}a`)).toBe(false)
        expect(isHashStemKey(hex64.toUpperCase())).toBe(false)
        expect(isHashStemKey('my-custom_id.wav')).toBe(false)
        expect(isHashStemKey('')).toBe(false)
    })

    it('agrees with the lists: an extensionless 64-digit name lands in h, upper-case after key folding too', () => {
        expect(splitHashStems(deriveCharacterAssets({ image: hex64 }).h)).toEqual([hexStemToBase64url(hex64)])
        expect(splitHashStems(deriveCharacterAssets({ image: hex64.toUpperCase() }).h)).toEqual([hexStemToBase64url(hex64)])
        expect(deriveCharacterAssets({ image: hex64.slice(1) }).l).toEqual([hex64.slice(1)])
    })
})

describe('asset list shape', () => {
    it('is sorted, unique, versioned and byte-stable', () => {
        const owner = {
            additionalAssets: [['a', 'zz.png'], ['b', 'AA.png'], ['c', 'zz.PNG'], ['d', `assets/${HEX_B}.png`], ['e', `assets/${HEX_A}.png`]],
        }
        const first = deriveCharacterAssets(owner)
        const second = deriveCharacterAssets({ additionalAssets: [...owner.additionalAssets].reverse() })
        expect(first).toEqual(second)
        expect(JSON.stringify(first)).toBe(JSON.stringify(second))
        expect(first.v).toBe(ASSET_REF_V)
        expect(first.l).toEqual(['aa.png', 'zz.png'])
        const stems = splitHashStems(first.h)
        expect(stems).toEqual([...stems].sort())
        expect(parsedValue(parseAssetList(JSON.parse(JSON.stringify(first))))).toEqual(first)
    })

    it('is empty and valid for an owner without references', () => {
        expect(deriveModuleAssets({})).toEqual({ v: ASSET_REF_V, h: '', l: [] })
    })

    it('ignores non-string and empty names', () => {
        expect(deriveCharacterAssets({ image: '', emotionImages: [['a', 5], 'x', ['b']], vits: { files: { a: null } } }))
            .toEqual({ v: ASSET_REF_V, h: '', l: [] })
    })
})
