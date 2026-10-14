import { ASSET_REF_V, IL_REF_V, type LegacyList } from '../format'
import { AssetRefCollector, collectCharacterAssets, collectConfigAssets, collectModuleAssets } from './assetList'
import { inlayListOf } from './inlayList'
import { resolveListParams, type ListParams } from './params'
import { compareCodeUnits, InlayIdCollector, isPlainRecord, sortedUnique } from './scan'

/**
 * The legacy list (type 20): the union of the asset and inlay references of
 * every old file present at conversion. A pure function of files the caller has
 * already decoded; it reads no storage. Whether `remotes/` pointers were
 * resolved is the caller's: this takes whatever it supplies.
 */

/** An old file the caller could not decode: listed, and contributes nothing. */
export interface UnreadableLegacyFile {
    key: string
    status: 'unreadable'
}

export interface ReadableLegacyFile {
    key: string
    status: 'ok'
    /** The decoded old `Database`. */
    database: object
    /** Full characters the file's cold chain reached, in addition to `database.characters`. */
    coldCharacters?: readonly object[]
    /** Any other readable cold payloads (chats, plugin values); scanned for inlay ids only. */
    coldValues?: readonly unknown[]
}

export type LegacyFileInput = UnreadableLegacyFile | ReadableLegacyFile

export function deriveLegacyList(files: readonly LegacyFileInput[], params?: Partial<ListParams>): LegacyList {
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
        files: [...files]
            .sort((a, b) => compareCodeUnits(a.key, b.key))
            .map(file => ({ key: file.key, status: file.status })),
        h: list.h,
        l: sortedUnique(list.l),
        i: inlayListOf(inlays, resolved),
    }
}
