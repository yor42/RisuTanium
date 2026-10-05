import { BlockSetInvalidError, type BlockSetInput } from './blockStore'
import type { Database } from './database.svelte'
import { packedNamesOf } from './packedNames'
import { RisuSaveEncoder, type toSaveType } from './risuSave'

/** `set` consumes the list of marked characters, so each call needs its own. */
function nothingMarked(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

/**
 * A decoded tree as the block set a whole-state replace takes: every block as
 * a fresh encoder frames it, in the encoder's order, plus the names that live
 * in the stubs pack.
 *
 * The encoder is fresh on every call and has no cache, no remote files and no
 * store behind it, so this reads nothing but `tree` and writes nothing at all;
 * the same tree gives the same blocks on any page. The blocks are uncompressed.
 */
export async function treeToBlockSet(tree: Database): Promise<BlockSetInput> {
    const encoder = new RisuSaveEncoder()
    await encoder.init(tree, { compression: false })
    await encoder.set(tree, nothingMarked())
    const layout = encoder.snapshotLayout()
    if (layout === null) {
        throw new BlockSetInvalidError('The encoder produced no layout for the tree.')
    }
    return { layout, packed: packedNamesOf(tree.characters, encoder.getFrozenKeys()) }
}
