import { describe, expect, it } from 'vitest'
import { encodeDatabase, type EncodedTree } from '../../store2/codec'
import { ASSET_REF_V, hexStemToBase64url, IL_REF_V, readUnit, splitHashStems, UNIT_TYPE, type AssetList, type InlayList, type ListRef, type UnitType } from '../../store2/format'
import { createListDerivation, deriveCharacterAssets, deriveConfigAssets, deriveInlayList, deriveModuleAssets } from '../../store2/lists'
import { bytesOf, chat, dbWithCharacters, message, mulberry32, prosePool, seededEnv, sparseCharacter, type Obj } from './codecFixtures'
import { HEX_A, HEX_B, HEX_C, inlayToken, UUID_A, UUID_B } from './listsFixtures'

function encode(db: ReturnType<typeof dbWithCharacters>): EncodedTree {
    return encodeDatabase(db, { env: seededEnv(3), lists: createListDerivation(), seq: 1, createdAt: 1_700_000_000_000 })
}

function body<T>(tree: EncodedTree, ref: ListRef, type: UnitType): T {
    const unit = tree.units.find(candidate => candidate.ref[0] === ref[0])
    if (unit === undefined) {
        throw new Error(`No unit for ${ref[0]}`)
    }
    expect(unit.type).toBe(type)
    expect(ref[3]).toBe(type === UNIT_TYPE.assetList ? ASSET_REF_V : IL_REF_V)
    const parsed = readUnit(bytesOf(unit), type)
    if (parsed.status !== 'ok') {
        throw new Error(`Unit ${ref[0]} does not parse: ${parsed.status}`)
    }
    return parsed.value.body as unknown as T
}

function build() {
    const rng = mulberry32(8)
    const pool = prosePool(rng, 6, 20, 60)
    const slot = sparseCharacter(rng, pool, 'chaA', 'Alpha', [
        chat(rng, 0, [{ ...message(rng, pool, 0, 40), data: `${inlayToken(UUID_A)} ${inlayToken('free-form-id')}` }]),
    ], [])
    Object.assign(slot, {
        image: `assets/${HEX_A.toUpperCase()}.PNG`,
        additionalAssets: [['x', 'Custom-Char-Asset.WAV']],
    })
    const module = { name: 'Mod', description: '', id: 'mod-1', lorebook: [], regex: [], trigger: [], assets: [['m', `assets/${HEX_B}.webp`]], icon: 'Mod-Icon.GIF', note: inlayToken(UUID_B) }
    return {
        slot,
        module,
        db: dbWithCharacters([slot], {
            modules: [module],
            customBackground: `assets/${HEX_C}.jpg`,
            userIcon: 'User.PNG',
            botPresets: [{ name: 'P', mainPrompt: inlayToken('preset-id') }],
            pluginCustomStorage: { key: { v: `assets/${HEX_A}` } },
            characterOrder: [{ imgFile: 'Folder.PNG', data: [] }],
            loadouts: [{ id: 'l1', icons: ['Loadout-Icon.PNG'] }],
        }),
    }
}

describe('the real derivation through the codec', () => {
    it('points manifest, shard and module entries at units that match the derivation', () => {
        const { slot, module, db } = build()
        const tree = encode(db)

        const configAl = body<AssetList>(tree, tree.manifest.fixed.configAl, UNIT_TYPE.assetList)
        expect(listHeld(configAl, `assets/${HEX_C}.jpg`)).toBe(true)
        expect(configAl.l).toContain('user.png')
        expect(configAl.l).toContain('folder.png')
        expect(configAl.l).toContain('loadout-icon.png')
        expect(configAl).toEqual(deriveConfigAssets(db as unknown as object, (db as unknown as Obj).characterOrder))

        const fixedIl = body<InlayList>(tree, tree.manifest.fixed.il, UNIT_TYPE.inlayList)
        expect(fixedIl.o).toContain('preset-id')
        expect(splitHashStems(fixedIl.h)).toContain(hexStemToBase64url(HEX_A))
        expect(splitHashStems(fixedIl.h)).toContain(hexStemToBase64url(HEX_C))

        const manifestShards = tree.index.objects?.shards ?? []
        const entry = manifestShards.flatMap(shard => shard.entries).find(candidate => candidate.chaId === 'chaA')
        expect(entry).toBeDefined()
        const al = body<AssetList>(tree, entry!.al, UNIT_TYPE.assetList)
        expect(al.l).toEqual(['custom-char-asset.wav'])
        expect(splitHashStems(al.h)).toEqual([hexStemToBase64url(HEX_A)])
        expect(al).toEqual(deriveCharacterAssets(slot))
        const il = body<InlayList>(tree, entry!.il!, UNIT_TYPE.inlayList)
        expect(il.u).toContain(UUID_A)
        expect(il.o).toEqual(['free-form-id'])
        expect(il).toEqual(deriveInlayList([slot]))

        const moduleEntry = tree.index.objects?.moduleIndex?.entries[0]
        expect(moduleEntry).toBeDefined()
        const mal = body<AssetList>(tree, moduleEntry!.al, UNIT_TYPE.assetList)
        expect(mal.l).toEqual(['mod-icon.gif'])
        expect(splitHashStems(mal.h)).toEqual([hexStemToBase64url(HEX_B)])
        expect(mal).toEqual(deriveModuleAssets(module))
        const mil = body<InlayList>(tree, moduleEntry!.il!, UNIT_TYPE.inlayList)
        expect(mil.u).toEqual([UUID_B])
        expect(mil).toEqual(deriveInlayList([module]))
    })

    it('encodes the same lists byte for byte twice', () => {
        const { db } = build()
        const a = encode(db)
        const b = encode(db)
        const lists = (tree: EncodedTree) => tree.units.filter(unit => unit.type === UNIT_TYPE.assetList || unit.type === UNIT_TYPE.inlayList).map(unit => unit.key)
        expect(lists(a)).toEqual(lists(b))
        expect(lists(a).length).toBeGreaterThanOrEqual(4)
    })
})

function listHeld(list: AssetList, name: string): boolean {
    const hex = /([0-9a-f]{64})/i.exec(name)
    return hex ? splitHashStems(list.h).includes(hexStemToBase64url(hex[1])) : list.l.includes(name.toLowerCase())
}
