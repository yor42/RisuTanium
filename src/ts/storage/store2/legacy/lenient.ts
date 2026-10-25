import type { Database } from '../../database.svelte'
import {
    decodeRisuSave, isBlockFormatSave, salvageRisuSave, type SalvageOmittedKind,
} from '../../risuSave'
import { coalesceFaults, findLegacyFaults, legacyCharactersRefused } from './faults'

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
 * object with a `characters` list. In both formats every shape the store2 codec
 * refuses (`findLegacyFaults`) is named, one entry per kind and one per skipped
 * character slot, because the conversion leaves exactly those out
 * (`dropLegacyFaults`); a block the salvage already named is not named twice.
 * A missing or null part names nothing: no data is dropped. A block-format save
 * is refused when its characters are present and not a list, because installing
 * them as an empty profile would drop them unnamed; a missing list is accepted,
 * since a profile with no characters writes no list.
 */

/**
 * The save cannot be converted leniently: an older-format save decoded to
 * something that is not an object with a `characters` list, or a block-format
 * save holds `characters` that are present and not a list.
 */
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
        if (legacyCharactersRefused(db, false)) {
            throw new LegacyDecodeError()
        }
        const salvaged = Array.from(omitted, ([name, block]) => ({ name, kind: block.kind, reason: block.reason }))
        return { tree: db, skipped: coalesceFaults(findLegacyFaults(db), salvaged) }
    }
    const tree = checkedTree(await decodeRisuSave(bytes))
    return { tree, skipped: coalesceFaults(findLegacyFaults(tree)) }
}
