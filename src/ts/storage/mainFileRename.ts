import { bytesEqual } from './blockFrame'
import { LEGACY_MAIN_FILE_KEY, PRE_BLOCKS_PREFIX } from './blockKeys'
import { decideMainFileRename, isPreBlocksKey, type PreBlocksFile } from './mainFileFingerprint'
import { NODE_BODY_LIMIT_BYTES } from './nodeBodyLimit'
import type { ByteStore } from './store/contract'
import { StoreVersionConflictError } from './store/errors'

/**
 * The finish of a conversion: moves the legacy main file aside once the block
 * store holds the profile, so upstream opening the same folder cannot read a
 * stale save. Keyed on content (`decideMainFileRename`), idempotent, and run at
 * every block-store boot and right after a conversion wins.
 *
 * - No main file: nothing to do.
 * - A `pre-blocks` copy equals it: the copy already happened, the main file is
 *   deleted.
 * - It matches `convertedFrom`: copied to the first free `pre-blocks` name,
 *   then deleted. A `pre-blocks` file with other bytes is never overwritten.
 * - Anything else (a file something wrote after the conversion) is left alone
 *   and never read for state. So is a file that changed between the finish's
 *   read and its delete: the main file is never deleted unless its bytes are
 *   the ones just copied or matched.
 *
 * On the Node server a main file over the body limit cannot be copied through
 * the store: it is left where it is, and the result says so.
 *
 * Never throws. A failure leaves the main file in place, which is the safe
 * state, and the next boot runs the finish again.
 */
export type MainFileRenameResult =
    | { kind: 'no-main-file' }
    | { kind: 'deleted-main' }
    | { kind: 'renamed', target: string }
    /** Not ours to move: no fingerprint matches it and no copy equals it. */
    | { kind: 'left' }
    /** Ours, but the Node server would refuse the copy. */
    | { kind: 'left-over-limit' }
    | { kind: 'failed', error: unknown }

export async function finishMainFileRename(
    store: ByteStore,
    convertedFrom: string | null,
    options: { nodeBodyLimit?: number } = {},
): Promise<MainFileRenameResult> {
    try {
        if (!(await store.has(LEGACY_MAIN_FILE_KEY))) {
            return { kind: 'no-main-file' }
        }
        const preBlocksKeys = (await store.list(PRE_BLOCKS_PREFIX)).filter(isPreBlocksKey).sort()
        if (convertedFrom === null && preBlocksKeys.length === 0) {
            // Nothing could match: the file is not read at all.
            return { kind: 'left' }
        }
        const mainRead = await store.read(LEGACY_MAIN_FILE_KEY)
        const main = mainRead.bytes
        if (main === null) {
            return { kind: 'no-main-file' }
        }
        const preBlocks: PreBlocksFile[] = []
        for (const key of preBlocksKeys) {
            const bytes = (await store.read(key)).bytes
            if (bytes !== null) {
                preBlocks.push({ key, bytes })
            }
        }
        const decision = decideMainFileRename(main, preBlocks, convertedFrom)
        if (decision.action === 'leave') {
            return { kind: 'left' }
        }
        if (decision.action === 'delete-main') {
            return (await deleteMainIfUnchanged(store, main, mainRead.version)) ? { kind: 'deleted-main' } : { kind: 'left' }
        }
        const limit = options.nodeBodyLimit ?? NODE_BODY_LIMIT_BYTES
        if (store.capabilities.conditionalWrites && main.length > limit) {
            return { kind: 'left-over-limit' }
        }
        await store.write(decision.target, main, 'unconditional')
        return (await deleteMainIfUnchanged(store, main, mainRead.version))
            ? { kind: 'renamed', target: decision.target }
            : { kind: 'left' }
    } catch (error) {
        console.error('Moving the converted main file aside failed; it stays where it is:', error)
        return { kind: 'failed', error }
    }
}

/**
 * Deletes the main file only while it is still the bytes the finish read and
 * copied or matched; true when it was deleted. A store with versions deletes
 * against the version of that read, so a write in between makes the store
 * refuse. A store without versions re-reads right before the delete and leaves
 * the file on any difference; a write landing between that re-read and the
 * delete is the one window this store kind cannot close.
 */
async function deleteMainIfUnchanged(store: ByteStore, main: Uint8Array, version: number | null): Promise<boolean> {
    if (store.capabilities.conditionalWrites && version !== null) {
        try {
            await store.delete(LEGACY_MAIN_FILE_KEY, { ifVersion: version })
            return true
        } catch (error) {
            if (error instanceof StoreVersionConflictError) {
                return false
            }
            throw error
        }
    }
    const current = (await store.read(LEGACY_MAIN_FILE_KEY)).bytes
    if (current === null) {
        return true
    }
    if (!bytesEqual(current, main)) {
        return false
    }
    await store.delete(LEGACY_MAIN_FILE_KEY, 'unconditional')
    return true
}
