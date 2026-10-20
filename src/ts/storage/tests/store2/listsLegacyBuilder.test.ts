import { describe, expect, it } from 'vitest'
import { ASSET_REF_V, IL_REF_V, type LegacyList } from '../../store2/format'
import {
    AssetRefCollector, collectCharacterAssets, collectConfigAssets, collectModuleAssets, deriveLegacyList, inlayListOf,
    InlayIdCollector, resolveListParams, type LegacyFileInput,
} from '../../store2/lists'
import { LegacyListBuilder } from '../../store2/lists/legacyList'
import { compareCodeUnits, isPlainRecord, sortedUnique } from '../../store2/lists/scan'
import { chatWith, HEX_A, HEX_B, inlayToken, UUID_A, UUID_B } from './listsFixtures'

/**
 * The incremental legacy list builder. `deriveLegacyList` delegates to it, so the guard that matters is that the
 * delegation changed no byte of the output: `referenceDerive` is the whole-input derivation as it was written before the
 * builder existed, kept here as the oracle.
 */

function referenceDerive(files: readonly LegacyFileInput[], params?: Parameters<typeof resolveListParams>[0]): LegacyList {
    const resolved = resolveListParams(params)
    const keys = new Set<string>()
    for (const file of files) {
        if (keys.has(file.key)) {
            throw new RangeError(`Legacy file ${file.key} is listed twice.`)
        }
        keys.add(file.key)
    }
    const assets = new AssetRefCollector()
    const inlays = new InlayIdCollector()
    for (const file of files) {
        if (file.status !== 'ok') {
            continue
        }
        const db = file.database as Record<string, unknown>
        collectConfigAssets(assets, file.database, db.characterOrder)
        const characters = Array.isArray(db.characters) ? db.characters : []
        for (const character of [...characters, ...(file.coldCharacters ?? [])]) {
            if (isPlainRecord(character)) {
                collectCharacterAssets(assets, character)
            }
        }
        if (Array.isArray(db.modules)) {
            for (const module of db.modules) {
                if (isPlainRecord(module)) {
                    collectModuleAssets(assets, module)
                }
            }
        }
        inlays.addAll(file.database)
        inlays.addAll(file.coldCharacters)
        inlays.addAll(file.coldValues)
    }
    const list = assets.toList()
    return {
        v: ASSET_REF_V,
        iv: IL_REF_V,
        files: [...files].sort((a, b) => compareCodeUnits(a.key, b.key)).map(file => ({ key: file.key, status: file.status })),
        h: list.h,
        l: sortedUnique(list.l),
        i: inlayListOf(inlays, resolved),
    }
}

const fileA: LegacyFileInput = {
    key: 'database/database.bin',
    status: 'ok',
    database: {
        customBackground: `assets/${HEX_A}.png`,
        characterOrder: ['a'],
        characters: [{ chaId: 'a', image: 'Old-A.PNG', chats: [chatWith(inlayToken(UUID_A))] }],
        modules: [{ id: 'm', icon: 'ModIcon.gif' }],
    },
}

const fileB: LegacyFileInput = {
    key: 'database/dbbackup-1.bin',
    status: 'ok',
    database: { characters: [{ chaId: 'stub', image: 'stub.png' }] },
    coldCharacters: [{ chaId: 'cold', additionalAssets: [['x', `assets/${HEX_B}.webp`]], chats: [chatWith(inlayToken('odd-id'))] }],
    coldValues: [{ text: inlayToken(UUID_B) }, { text: inlayToken('second-odd') }],
}

const unreadable: LegacyFileInput = { key: 'database/dbbackup-2.bin', status: 'unreadable' }

describe('guard: deriveLegacyList is byte-identical to the whole-input derivation it replaced', () => {
    const cases: [string, LegacyFileInput[], Parameters<typeof resolveListParams>[0]?][] = [
        ['no files', []],
        ['one file', [fileA]],
        ['a file with cold characters and values', [fileB]],
        ['several files and an unreadable one', [fileA, fileB, unreadable]],
        ['the same files in another order', [unreadable, fileB, fileA]],
        ['an inlay body over the size parameter', [fileA, fileB], { maxInlayBodyBytes: 30 }],
    ]

    it.each(cases)('%s', (_label, files, params) => {
        expect(JSON.stringify(deriveLegacyList(files, params))).toBe(JSON.stringify(referenceDerive(files, params)))
    })

    it('still refuses the same key twice, before any list is returned', () => {
        expect(() => deriveLegacyList([fileA, fileA])).toThrow(RangeError)
    })
})

describe('new behaviour: the builder', () => {
    it('built file by file with each cold payload scanned as it is read, it equals the whole-input derivation', () => {
        const builder = new LegacyListBuilder()
        builder.add(fileA)
        if (fileB.status !== 'ok') {
            throw new Error('fixture')
        }
        const scan = builder.beginFile(fileB.key, fileB.database)
        // Interleaved on purpose: the collectors are sets, so the order the payloads arrive in cannot matter.
        scan.coldValue(fileB.coldValues?.[0])
        scan.coldCharacter(fileB.coldCharacters?.[0] as object)
        scan.coldValue(fileB.coldValues?.[1])
        builder.addUnreadable(unreadable.key)
        expect(JSON.stringify(builder.build())).toBe(JSON.stringify(referenceDerive([fileA, fileB, unreadable])))
    })

    it('a file whose scan failed is listed unreadable, and what it had added stays in the list', () => {
        const builder = new LegacyListBuilder()
        if (fileB.status !== 'ok') {
            throw new Error('fixture')
        }
        const scan = builder.beginFile(fileB.key, fileB.database)
        scan.coldCharacter(fileB.coldCharacters?.[0] as object)
        scan.fail()
        const list = builder.build()
        expect(list.files).toEqual([{ key: fileB.key, status: 'unreadable' }])
        expect(list.h).not.toBe('')
        expect(list.i.o).toEqual(['odd-id'])
    })

    it('a file whose own tree cannot be scanned is never listed ok', () => {
        const builder = new LegacyListBuilder()
        const hostile = { get characterOrder(): never { throw new Error('unreadable tree') } }
        expect(() => builder.beginFile('database/dbbackup-9.bin', hostile)).toThrow('unreadable tree')
        expect(builder.build().files).toEqual([{ key: 'database/dbbackup-9.bin', status: 'unreadable' }])
    })

    it('refuses a key listed twice, whichever way it was added', () => {
        const builder = new LegacyListBuilder()
        builder.addUnreadable('k')
        expect(() => builder.addUnreadable('k')).toThrow(RangeError)
        expect(() => builder.beginFile('k', {})).toThrow(RangeError)
    })

    it('keeps only the collected references between files, never a decoded tree', () => {
        const builder = new LegacyListBuilder()
        const database = {
            customBackground: `assets/${HEX_A}.png`,
            characters: [{ chaId: 'held', image: 'held.png', chats: [chatWith(inlayToken(UUID_A))] }],
        }
        const cold = { chaId: 'cold-held', chats: [chatWith(inlayToken('odd-held'))] }
        const scan = builder.beginFile('database/dbbackup-3.bin', database)
        scan.coldCharacter(cold)
        const suspects = new Set<unknown>([database, database.characters, database.characters[0], cold, cold.chats])
        const seen = new Set<unknown>()
        const pending: unknown[] = [builder]
        while (pending.length > 0) {
            const value = pending.pop()
            if (typeof value !== 'object' || value === null || seen.has(value)) {
                continue
            }
            seen.add(value)
            expect(suspects.has(value)).toBe(false)
            for (const key of Reflect.ownKeys(value)) {
                pending.push((value as Record<PropertyKey, unknown>)[key])
            }
            if (value instanceof Map || value instanceof Set) {
                pending.push(...value)
            }
        }
        expect(builder.build().l).toEqual(['held.png'])
    })
})
