import { BlockSetInvalidError, type BlockSetInput } from './blockStore'
import { presetTemplate, type Database } from './database.svelte'
import { packedNamesOf } from './packedNames'
import { RisuSaveEncoder, type EncoderReport, type toSaveType } from './risuSave'

/**
 * Gives a decoded backup the containers the encoder reads, so every block of
 * the generation it becomes is readable: a backup from an older build may lack
 * a list, and a missing preset list would be written as an empty block, which
 * the strict decode at the next start reports as damage. A missing preset list
 * becomes the default preset, as `setDatabase` makes it. Every whole-state
 * write of a tree decoded from a backup calls this first.
 */
export function completeRestoredTree(tree: Database): void {
    tree.characters ??= []
    tree.modules ??= []
    tree.loadouts ??= []
    tree.plugins ??= []
    if (!Array.isArray(tree.botPresets)) {
        tree.botPresets = [{ ...JSON.parse(JSON.stringify(presetTemplate)), name: 'Default' }]
    }
}

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
    return (await treeToBlockSetReported(tree)).set
}

/**
 * `treeToBlockSet` with what the encoder left out. A caller that installs or
 * restores the tree refuses on a non-empty `excluded`, because the tree it is
 * about to install would then hold entries the saved generation does not.
 * Throws `SaveParkError` when a container is not a list or a character does not
 * serialize to an object; nothing has been written then.
 */
export async function treeToBlockSetReported(tree: Database): Promise<{ set: BlockSetInput, report: EncoderReport }> {
    const encoder = new RisuSaveEncoder()
    await encoder.init(tree, { compression: false })
    const initReport = encoder.getReport()
    await encoder.set(tree, nothingMarked())
    const layout = encoder.snapshotLayout()
    if (layout === null) {
        throw new BlockSetInvalidError('The encoder produced no layout for the tree.')
    }
    const setReport = encoder.getReport()
    const excluded = [...initReport.excluded]
    for (const item of setReport.excluded) {
        if (!excluded.some((seen) => seen.entry === item.entry)) {
            excluded.push(item)
        }
    }
    return {
        set: { layout, packed: packedNamesOf(tree.characters, encoder.getFrozenKeys()) },
        report: { excluded, repairedContainers: initReport.repairedContainers },
    }
}
