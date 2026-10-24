import type { Database } from '../../database.svelte'
import {
    decodeRisuSave, isBlockFormatSave, salvageRisuSave, type SalvageOmittedKind,
} from '../../risuSave'

/**
 * The lenient decode behind "convert without these", the user-chosen exit when
 * the strict decode of the main file and of every numbered backup failed. The
 * strict decode stays the default everywhere else.
 *
 * A block-format save is read by `salvageRisuSave`: it leaves out each block it
 * cannot use and names it. It never consults the block cache, so on this path a
 * block the file itself lacks is left out and named even where the cache holds
 * an older copy; cache-filled blocks no longer count as present. The older
 * msgpack formats have no blocks: today's decoder may guess an older format and
 * return whatever it decodes, so the result is accepted only when it is an
 * object with a `characters` list, and the only thing named there is a
 * `botPresets` that is present and not a list (kind `presets`), because the
 * conversion replaces it with the Default preset. A missing or null `botPresets`
 * names nothing: no data is dropped. A block-format save is not held to that: a
 * profile with no characters writes no list, and its root block was already
 * required by the decoder.
 */

/** An older-format save decoded to something that is not a database: no object with a `characters` list. */
export class LegacyDecodeError extends Error {
    constructor() {
        super('The save decoded to something that is not a database (no characters list).')
        this.name = 'LegacyDecodeError'
    }
}

export interface SkippedLegacyEntry {
    /** The block name; for a character, its `chaId`. */
    name: string
    kind: SalvageOmittedKind
    /** The failure's message, for diagnostics only. */
    reason: string
}

export interface LenientLegacyDecode {
    tree: Database
    /** Every block left out, characters included; empty when the block-format decode left nothing out. */
    skipped: SkippedLegacyEntry[]
}

function checkedTree(tree: unknown): Database {
    if (typeof tree !== 'object' || tree === null || !Array.isArray((tree as { characters?: unknown }).characters)) {
        throw new LegacyDecodeError()
    }
    return tree as Database
}

export async function decodeLegacyLenient(bytes: Uint8Array): Promise<LenientLegacyDecode> {
    if (isBlockFormatSave(bytes)) {
        const { db, omitted } = await salvageRisuSave(bytes)
        return {
            tree: db,
            skipped: Array.from(omitted, ([name, block]) => ({ name, kind: block.kind, reason: block.reason })),
        }
    }
    const tree = checkedTree(await decodeRisuSave(bytes))
    const presets = (tree as { botPresets?: unknown }).botPresets
    const skipped: SkippedLegacyEntry[] = presets === undefined || presets === null || Array.isArray(presets)
        ? []
        : [{ name: 'botPresets', kind: 'presets', reason: 'The presets are not a list.' }]
    return { tree, skipped }
}
