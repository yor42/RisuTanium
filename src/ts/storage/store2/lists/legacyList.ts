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

/** What a readable file adds after its own tree: the cold payloads its chain reached, one at a time. */
export interface LegacyFileScan {
    /** A full character the file's cold chain reached. */
    coldCharacter(character: object): void
    /** Any other readable cold payload; scanned for inlay ids only. */
    coldValue(value: unknown): void
    /** The file could not be read to its end: it is listed unreadable. What it already added stays in the list (a superset keeps more). */
    fail(): void
}

/**
 * The legacy list built one file at a time. Only the reference collectors are kept between files, never a decoded
 * tree, so a caller can decode, scan and drop each old file in turn. `deriveLegacyList` is this builder run over files
 * already in hand, so the two cannot disagree.
 */
export class LegacyListBuilder {
    private readonly resolved: ListParams
    private readonly listed = new Map<string, 'ok' | 'unreadable'>()
    private readonly assets = new AssetRefCollector()
    private readonly inlays = new InlayIdCollector()

    constructor(params?: Partial<ListParams>) {
        this.resolved = resolveListParams(params)
    }

    private reserve(key: string, status: 'ok' | 'unreadable'): void {
        if (this.listed.has(key)) {
            throw new RangeError(`Legacy file ${key} is listed twice.`)
        }
        this.listed.set(key, status)
    }

    /** An old file the caller could not decode: listed, and contributes nothing. */
    addUnreadable(key: string): void {
        this.reserve(key, 'unreadable')
    }

    /** A readable old file: its own tree is scanned now, its cold payloads through the returned scan. */
    beginFile(key: string, database: object): LegacyFileScan {
        // Listed unreadable until the scan of its own tree has finished, so a tree that throws is never listed ok.
        this.reserve(key, 'unreadable')
        const db = database as Record<string, unknown>
        collectConfigAssets(this.assets, database, db.characterOrder)
        const characters = Array.isArray(db.characters) ? db.characters : []
        for (const character of characters) {
            if (isPlainRecord(character)) {
                collectCharacterAssets(this.assets, character)
            }
        }
        if (Array.isArray(db.modules)) {
            for (const module of db.modules) {
                if (isPlainRecord(module)) {
                    collectModuleAssets(this.assets, module)
                }
            }
        }
        this.inlays.addAll(database)
        this.listed.set(key, 'ok')
        return {
            coldCharacter: (character) => {
                if (isPlainRecord(character)) {
                    collectCharacterAssets(this.assets, character)
                }
                this.inlays.addAll(character)
            },
            coldValue: (value) => this.inlays.addAll(value),
            fail: () => {
                this.listed.set(key, 'unreadable')
            },
        }
    }

    add(file: LegacyFileInput): void {
        if (file.status !== 'ok') {
            this.addUnreadable(file.key)
            return
        }
        const scan = this.beginFile(file.key, file.database)
        for (const character of file.coldCharacters ?? []) {
            scan.coldCharacter(character)
        }
        for (const value of file.coldValues ?? []) {
            scan.coldValue(value)
        }
    }

    build(): LegacyList {
        const list = this.assets.toList()
        return {
            v: ASSET_REF_V,
            iv: IL_REF_V,
            files: [...this.listed]
                .sort((a, b) => compareCodeUnits(a[0], b[0]))
                .map(([key, status]) => ({ key, status })),
            h: list.h,
            l: sortedUnique(list.l),
            i: inlayListOf(this.inlays, this.resolved),
        }
    }
}

export function deriveLegacyList(files: readonly LegacyFileInput[], params?: Partial<ListParams>): LegacyList {
    const builder = new LegacyListBuilder(params)
    for (const file of files) {
        builder.add(file)
    }
    return builder.build()
}
