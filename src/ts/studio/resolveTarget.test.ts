import { describe, expect, test } from 'vitest'
import type { loreBook } from '../storage/database.svelte'
import { buildOwnerModel } from './ownerModel'
import { resolveStudioTarget } from './resolveTarget'
import { parseStudioTarget } from './studioTarget'
import { liveLoreListOf } from './loreEntryLookup'
import type { StudioOwnerType } from './studioTarget'
import { loreEntries, makeCharacter, makeChat, makeInput, makePlugin, makePreset, regexEntries, residentModule, stubModule } from './studioFixtures.test-helpers'

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

describe('3k lorebook entry by id', () => {
    const named = (id: string, comment: string): loreBook => ({ id, comment, key: `${comment}-key`, secondkey: '', insertorder: 100, content: '', mode: 'normal', alwaysActive: false, selective: false })
    const character = makeCharacter({
        globalLore: [named('g1', 'Castle'), named('shared', 'Twin A'), named('shared', 'Twin B')],
        chats: [makeChat({ id: 'chat-1', name: 'First chat', localLore: [named('shared', 'Chat twin'), named('only-chat', 'Chat only')] })],
    })
    const modules = [residentModule('m1', { lorebook: [named('x', 'Mod A'), named('y', 'Mod B')] })]
    const idModel = buildOwnerModel(makeInput({ character, modules, enabledModules: ['m1'] }))
    const loreOf = (owner: { type: StudioOwnerType, id: string }) => liveLoreListOf(owner, character, modules)
    const resolveId = (query: string, reader: ((owner: { type: StudioOwnerType, id: string }) => unknown) | null = loreOf) =>
        resolveStudioTarget(idModel, parseStudioTarget(query), reader ?? undefined)
    const gone = (key: string) => ({ ownerKey: key, kind: 'lore', itemId: null, notice: { key: 'studioLoreEntryGone' } })

    test('regression reproducer: the entry opens at its present index, after a reorder or a rename', () => {
        expect(resolveId('owner=character:cha-1&kind=lore&entry=g1')).toMatchObject({ kind: 'lore', itemId: 'cha-1/lore:0', notice: null })
        const moved = makeCharacter({ globalLore: [named('a', 'New first'), named('shared', 'Twin A'), named('g1', 'Renamed castle')] })
        const movedModel = buildOwnerModel(makeInput({ character: moved }))
        const result = resolveStudioTarget(movedModel, parseStudioTarget('owner=character:cha-1&kind=lore&entry=g1'), (owner) => liveLoreListOf(owner, moved, []))
        expect(result).toMatchObject({ kind: 'lore', itemId: 'cha-1/lore:2', notice: null })
    })

    test('the entry is looked up in the owner list the target names, a chat or a module', () => {
        expect(resolveId('owner=chat:chat-1&kind=lore&entry=only-chat')).toMatchObject({ itemId: 'chat-1/lore:1', notice: null })
        expect(resolveId('owner=module:m1&kind=lore&entry=y')).toMatchObject({ itemId: 'm1/lore:1', notice: null })
    })

    test('regression reproducer: the entry id wins over a stale item index', () => {
        expect(resolveId('owner=character:cha-1&kind=lore&item=cha-1/lore:2&entry=g1')).toMatchObject({ itemId: 'cha-1/lore:0', notice: null })
    })

    test('regression reproducer: a gone, shared or foreign id opens the list with the entry-gone notice', () => {
        expect(resolveId('owner=character:cha-1&kind=lore&entry=vanished')).toEqual(gone('character:cha-1'))
        expect(resolveId('owner=character:cha-1&kind=lore&entry=shared')).toEqual(gone('character:cha-1'))
        expect(resolveId('owner=character:cha-1&kind=lore&entry=only-chat')).toEqual(gone('character:cha-1'))
        expect(resolveId('owner=module:m1&kind=lore&entry=g1')).toEqual(gone('module:m1'))
    })

    test('the same id in a character entry and in its chat link does not collide', () => {
        expect(resolveId('owner=chat:chat-1&kind=lore&entry=shared')).toMatchObject({ itemId: 'chat-1/lore:0', notice: null })
    })

    test('regression reproducer: with no reader the entry cannot be found and the list opens with the notice', () => {
        expect(resolveId('owner=character:cha-1&kind=lore&entry=g1', null)).toEqual(gone('character:cha-1'))
    })
})
