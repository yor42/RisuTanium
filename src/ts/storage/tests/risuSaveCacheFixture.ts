/**
 * Test helper: the entries the legacy block cache (`risuSaveCache`) holds for a
 * profile whose encoder cached every block it wrote, which is how upstream
 * builds leave it. The encoder in this repository writes no cache entry, so a
 * test of the legacy decoder's cache fallback plants these entries itself.
 */
import { parseBlocks } from './risuSaveBlockFile'

export interface BlockCacheEntry {
    type: number
    data: string
    name: string
}

/** One `risuSaveBlock_<name>` entry per block of `file`, as an uncompressed block's text. */
export function cacheEntriesOf(file: Uint8Array): Array<[string, BlockCacheEntry]> {
    return parseBlocks(file).map((block) => [
        `risuSaveBlock_${block.name}`,
        { type: block.type, data: new TextDecoder().decode(block.payload), name: block.name },
    ])
}
