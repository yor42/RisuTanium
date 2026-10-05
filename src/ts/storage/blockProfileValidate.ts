import { assembleLegacyFile, type DamagedItem, type LoadedBlocks } from './blockStore'
import { parseFramedBlock } from './blockFrame'
import { ROOT_BLOCK_NAME, isFixedBlockName, ownBlockKey, rootKey, stubsKey } from './blockKeys'
import type { Database } from './database.svelte'
import { decodeRisuSave } from './risuSave'

/**
 * The validation hook of a block-store boot: the loaded blocks decoded the way
 * the application will read them, strictly. A block whose frame and checksum
 * hold but whose content does not decode is damage ("unreadable content"), not
 * a partial profile: the loader checks frames and checksums, never whether a
 * payload parses, so only this hook can tell. It is `ValidateOptions.validate`
 * for `BlockStoreOwner.load` and `readCommitted`, which return the tree it
 * decoded so boot decodes once.
 */
export async function validateLoadedBlocks(loaded: LoadedBlocks): Promise<Database | readonly DamagedItem[]> {
    let message: string
    try {
        return await decodeRisuSave(assembleLegacyFile(loaded), { strict: true }) as Database
    } catch (error) {
        message = error instanceof Error ? error.message : String(error)
    }
    return unreadableContentOf(loaded, message)
}

/**
 * Names the blocks whose payload is not JSON. The strict decode reports the
 * first failure without the block's name, so each block is looked at again; a
 * failure none of them explains (a missing remote file, an unknown block type)
 * is reported against the save as a whole.
 */
function unreadableContentOf(loaded: LoadedBlocks, decodeMessage: string): DamagedItem[] {
    const packed = new Set(loaded.packed)
    const found: DamagedItem[] = []
    const candidates: Array<[string, Uint8Array]> = [[ROOT_BLOCK_NAME, loaded.root], ...loaded.blocks]
    for (const [name, bytes] of candidates) {
        let payload: Uint8Array
        try {
            payload = parseFramedBlock(bytes, 0).payload
        } catch {
            continue
        }
        // The plugin-storage block with no payload is how an absent field is written.
        if (payload.length === 0 && name === 'pluginStorage') {
            continue
        }
        try {
            JSON.parse(new TextDecoder().decode(payload))
        } catch (error) {
            const part: DamagedItem['part'] = name === ROOT_BLOCK_NAME ? 'root'
                : packed.has(name) ? 'stub'
                : isFixedBlockName(name) ? 'fixed' : 'character'
            const key = name === ROOT_BLOCK_NAME ? rootKey(loaded.generation)
                : packed.has(name) ? stubsKey(loaded.generation)
                : ownBlockKey(loaded.generation, name)
            found.push({ part, name, key, kind: 'unreadable-content', detail: error instanceof Error ? error.message : String(error) })
        }
    }
    if (found.length > 0) {
        return found
    }
    return [{ part: 'root', name: ROOT_BLOCK_NAME, key: rootKey(loaded.generation), kind: 'unreadable-content', detail: decodeMessage }]
}
