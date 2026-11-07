import { describe, expect, test } from 'vitest'
import { buildOwnerModel } from './ownerModel'
import { resolveStudioTarget } from './resolveTarget'
import { parseStudioTarget } from './studioTarget'
import { loreEntries, makeCharacter, makeInput, makePlugin, makePreset, regexEntries, residentModule, stubModule } from './studioFixtures.test-helpers'

const model = buildOwnerModel(makeInput({
    character: makeCharacter({ globalLore: loreEntries(3), customscript: regexEntries(1) }),
    modules: [residentModule('m1', { regex: [{ comment: 'r', in: '', out: '', type: 'editinput' }] }), stubModule('s1')],
    enabledModules: ['m1', 's1'],
    presets: [makePreset('Main'), makePreset('Other')],
    activePreset: 0,
    plugins: [makePlugin('plug')],
}))

function resolve(query: string) {
    return resolveStudioTarget(model, parseStudioTarget(query))
}

describe('3k target resolution and notices', () => {
    test('no owner asked for opens the root without a notice', () => {
        expect(resolve('from=chat')).toEqual({ ownerKey: null, kind: null, itemId: null, notice: null })
    })

    test('the owner root, a kind and an item resolve without a notice', () => {
        expect(resolve('owner=character:cha-1')).toMatchObject({ ownerKey: 'character:cha-1', kind: null, itemId: null, notice: null })
        expect(resolve('owner=character:cha-1&kind=lore')).toMatchObject({ kind: 'lore', itemId: null, notice: null })
        expect(resolve('owner=character:cha-1&kind=lore&item=cha-1/lore:2')).toMatchObject({ kind: 'lore', itemId: 'cha-1/lore:2', notice: null })
        expect(resolve('owner=module:m1&kind=regex&item=m1/regex:0')).toMatchObject({ ownerKey: 'module:m1', itemId: 'm1/regex:0' })
        expect(resolve('owner=preset:1')).toMatchObject({ ownerKey: 'preset:1', notice: null })
        expect(resolve('owner=plugin:plug&kind=plugincode')).toMatchObject({ ownerKey: 'plugin:plug', kind: 'plugin', notice: null })
    })

    test('a kind alias reaches the scripts kind', () => {
        expect(resolve('owner=character:cha-1&kind=trigger')).toMatchObject({ kind: 'scripts' })
    })

    test('malformed input is not found', () => {
        expect(resolve('owner=nonsense')).toEqual({ ownerKey: null, kind: null, itemId: null, notice: { key: 'studioNotFound' } })
        expect(resolve('owner=%E0%A4%A')).toMatchObject({ notice: { key: 'studioNotFound' } })
    })

    test('an unknown owner, another character and a wrong type are not found', () => {
        expect(resolve('owner=module:ghost').notice).toEqual({ key: 'studioNotFound' })
        expect(resolve('owner=character:someone-else').notice).toEqual({ key: 'studioNotFound' })
        expect(resolve('owner=module:cha-1').notice).toEqual({ key: 'studioNotFound' })
        expect(resolve('owner=character:m1').notice).toEqual({ key: 'studioNotFound' })
    })

    test('a kind the owner does not support opens the owner root with the fallback notice', () => {
        expect(resolve('owner=character:cha-1&kind=plugin')).toEqual({
            ownerKey: 'character:cha-1', kind: null, itemId: null,
            notice: { key: 'studioDeepKindFallback', ownerName: 'Alice' },
        })
        expect(resolve('owner=preset:0&kind=lore').notice).toEqual({ key: 'studioDeepKindFallback', ownerName: 'Main' })
        expect(resolve('owner=character:cha-1&kind=nonsense').notice).toMatchObject({ key: 'studioDeepKindFallback' })
    })

    test('an unloaded module supports no kind, so any kind falls back', () => {
        expect(resolve('owner=module:s1&kind=lore')).toMatchObject({ ownerKey: 'module:s1', kind: null, notice: { key: 'studioDeepKindFallback' } })
        expect(resolve('owner=module:s1')).toMatchObject({ ownerKey: 'module:s1', notice: null })
    })

    test('a missing item opens its kind with the item notice', () => {
        expect(resolve('owner=character:cha-1&kind=lore&item=cha-1/lore:99')).toEqual({
            ownerKey: 'character:cha-1', kind: 'lore', itemId: null,
            notice: { key: 'studioDeepItemMissing', ownerName: 'Alice', kind: 'lore' },
        })
    })

    test('an item without a kind is found across the owner, or opens the root with the item notice', () => {
        expect(resolve('owner=character:cha-1&item=cha-1/regex:0')).toMatchObject({ kind: 'regex', itemId: 'cha-1/regex:0', notice: null })
        expect(resolve('owner=character:cha-1&item=cha-1/lore:99')).toEqual({
            ownerKey: 'character:cha-1', kind: null, itemId: null,
            notice: { key: 'studioDeepItemMissing', ownerName: 'Alice', kind: null },
        })
    })

    test('an item of another kind is not accepted under the named kind', () => {
        expect(resolve('owner=character:cha-1&kind=regex&item=cha-1/lore:0').notice).toMatchObject({ key: 'studioDeepItemMissing', kind: 'regex' })
    })
})
