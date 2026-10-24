// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import { Store2PayloadTooLargeError } from '../../store2/backend'
import { COMMIT_KEY, FENCE_KEY } from '../../store2/format/keys'
import { UNIT_TYPE, UNIT_TYPE_IDS } from '../../store2/format/versions'
import { tooLargeLabel, tooLargePartOf, type TooLargePart } from '../../store2/tooLargeLabel'

const MIB = 1024 * 1024

describe('the part a refused body was', () => {
    test.each<[string, number, TooLargePart]>([
        ['commit', UNIT_TYPE.commit, 'saveRecord'],
        ['manifest', UNIT_TYPE.manifest, 'saveIndex'],
        ['shard', UNIT_TYPE.shard, 'characterList'],
        ['characterCore', UNIT_TYPE.characterCore, 'character'],
        ['lore', UNIT_TYPE.lore, 'lorebook'],
        ['scripts', UNIT_TYPE.scripts, 'scripts'],
        ['chatCore', UNIT_TYPE.chatCore, 'chat'],
        ['chatChunk', UNIT_TYPE.chatChunk, 'chatPart'],
        ['module', UNIT_TYPE.module, 'module'],
        ['moduleIndex', UNIT_TYPE.moduleIndex, 'moduleList'],
        ['configRoot', UNIT_TYPE.configRoot, 'settings'],
        ['preset', UNIT_TYPE.preset, 'preset'],
        ['plugin', UNIT_TYPE.plugin, 'plugin'],
        ['pluginStorageValue', UNIT_TYPE.pluginStorageValue, 'pluginData'],
        ['pluginStorageBucket', UNIT_TYPE.pluginStorageBucket, 'pluginData'],
        ['assetList', UNIT_TYPE.assetList, 'fileList'],
        ['legacyList', UNIT_TYPE.legacyList, 'fileList'],
        ['inlayList', UNIT_TYPE.inlayList, 'fileList'],
        ['order', UNIT_TYPE.order, 'characterOrder'],
        ['loadouts', UNIT_TYPE.loadouts, 'loadouts'],
        ['statics', UNIT_TYPE.statics, 'generic'],
        ['sweepRecord', UNIT_TYPE.sweepRecord, 'generic'],
        ['fenceRecord', UNIT_TYPE.fenceRecord, 'generic'],
        ['deletionSnapshot', UNIT_TYPE.deletionSnapshot, 'generic'],
    ])('the %s unit type (%i) is the %s part', (_name, unitType, part) => {
        expect(tooLargePartOf('store2/example', unitType)).toBe(part)
    })

    test('the table above covers every unit type of the format', () => {
        expect(UNIT_TYPE_IDS).toHaveLength(24)
        for (const type of UNIT_TYPE_IDS) {
            expect(tooLargePartOf('store2/example', type)).toBeTypeOf('string')
        }
    })

    test('an unknown or absent unit type is the generic part', () => {
        expect(tooLargePartOf('store2/example', 99)).toBe('generic')
        expect(tooLargePartOf('store2/example', 0)).toBe('generic')
        expect(tooLargePartOf('store2/example', null)).toBe('generic')
        expect(tooLargePartOf(null, null)).toBe('generic')
    })

    test('the commit key and the fence key are the save record whatever the unit type', () => {
        expect(tooLargePartOf(COMMIT_KEY, null)).toBe('saveRecord')
        expect(tooLargePartOf(COMMIT_KEY, UNIT_TYPE.chatChunk)).toBe('saveRecord')
        expect(tooLargePartOf(FENCE_KEY, UNIT_TYPE.chatChunk)).toBe('saveRecord')
    })
})

describe('the words and the size of a refused body', () => {
    test('the label is built from the error alone', () => {
        const error = new Store2PayloadTooLargeError('413', 'store2/example', 3 * MIB, UNIT_TYPE.chatChunk)
        expect(tooLargeLabel(error)).toBe(language.saveUnitLabel('chatPart', 3 * MIB))
        expect(tooLargeLabel(error)).toBe('a part of a chat (3.0 MiB)')
        expect(tooLargeLabel(new Store2PayloadTooLargeError('413', COMMIT_KEY, MIB, null))).toBe('the save record (1.0 MiB)')
    })

    test('a size is rounded up to one decimal, never down to the limit it exceeds', () => {
        const limit = 100 * MIB
        expect(language.saveUnitLabel('chat', limit + 0.03 * MIB)).toBe('a chat (100.1 MiB)')
        expect(language.saveUnitLabel('chat', limit + 1)).toBe('a chat (100.1 MiB)')
        expect(language.saveUnitLabel('chat', limit)).toBe('a chat (100.0 MiB)')
        expect(language.saveUnitLabel('chat', 0.5 * MIB)).toBe('a chat (0.5 MiB)')
    })

    test('a missing size leaves the words alone, and an unnamed part reads as a part of the data', () => {
        expect(language.saveUnitLabel('chat', null)).toBe('a chat')
        expect(language.saveUnitLabel('generic', null)).toBe('a part of your data')
        expect(language.saveUnitLabel('somethingNew', null)).toBe('a part of your data')
    })
})
