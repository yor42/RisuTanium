import { BlockTooLargeError, type BlockSetInput, type BlockStoreOwner } from './blockStore'
import { validateLoadedBlocks } from './blockProfileValidate'
import type { BootReread } from './bootArchivePass'
import { HEAD_KEY } from './blockKeys'
import { finishMainFileRename } from './mainFileRename'
import { getPageStorageMode, noteMainFileLeftOverLimit, pendingConvertedFrom, setPageStorageMode } from './pageStorageMode'
import type { ByteStore } from './store/contract'

/**
 * The two effects of the boot archive pass that depend on where the profile
 * lives: committing the pass's result and reading storage again after a pass
 * that failed. Both follow the page's storage mode.
 *
 * - `block`: the commit is a save into the live generation (`commitSave`), and
 *   the re-read is the committed state, decoded.
 * - `legacy` (no head yet): the commit is the conversion, a whole-state
 *   replace against "no head" that records the fingerprint of the main file
 *   boot read; when it wins the page is a block page and the rename finish
 *   moves the main file aside at once. The re-read is the main file, unless a
 *   head has appeared meanwhile: another page converted the profile, the main
 *   file is not its state, and the re-read fails so the boot stops and a reload
 *   loads the converted profile.
 *
 * A commit that does not happen throws; whatever it left behind is garbage the
 * previous root (or the main file) does not list, so the previous state stays
 * authoritative. Nothing here writes the main file.
 */

/** A commit that did not happen, for a reason other than size. */
export class BootCommitFailed extends Error {
    constructor(public readonly detail: string) {
        super(`The boot commit did not happen: ${detail}`)
        this.name = 'BootCommitFailed'
    }
}

export interface BootPassSeamDeps {
    owner: BlockStoreOwner
    store: ByteStore
    /** The page's own legacy main-file read: the re-read of a legacy profile whose conversion did not happen. */
    readMainFile(): Promise<Uint8Array | null | undefined>
    /** The Node body limit the rename finish measures a main file against; defaults to the server's. */
    nodeBodyLimit?: number
}

export interface BootPassSeams {
    commit(input: BlockSetInput): Promise<void>
    reread(): Promise<BootReread>
}

export function createBootPassSeams(deps: BootPassSeamDeps): BootPassSeams {
    return {
        async commit(input) {
            const mode = getPageStorageMode()
            if (mode.kind === 'block') {
                const result = await deps.owner.commitSave(input)
                if (result.kind === 'committed') {
                    return
                }
                throw new BootCommitFailed(result.kind === 'stopped' ? `stopped (${result.reason})` : `a conflict on ${result.key}`)
            }
            if (mode.kind !== 'legacy') {
                throw new BootCommitFailed(`the page is in the "${mode.kind}" storage mode`)
            }
            const result = await deps.owner.replaceWholeState(input, { requireAbsentHead: true, convertedFrom: pendingConvertedFrom() })
            if (result.kind === 'won') {
                setPageStorageMode({ kind: 'block' })
                const renamed = await finishMainFileRename(deps.store, mode.convertedFrom, { nodeBodyLimit: deps.nodeBodyLimit })
                if (renamed.kind === 'left-over-limit') {
                    noteMainFileLeftOverLimit()
                }
                return
            }
            if (result.kind === 'refused') {
                throw new BlockTooLargeError(result.blockName, result.length, result.limit)
            }
            throw new BootCommitFailed(`the conversion ended ${result.kind}${result.kind === 'lost' ? ` (${result.reason})` : ''}`)
        },

        async reread() {
            if (getPageStorageMode().kind === 'block') {
                const result = await deps.owner.readCommitted({ validate: validateLoadedBlocks })
                return result.kind === 'loaded' ? { kind: 'tree', tree: result.tree } : { kind: 'damaged' }
            }
            if (await deps.store.has(HEAD_KEY)) {
                // Another page or device converted the profile while this one booted, so the main file is not its state.
                throw new BootCommitFailed('the profile was converted by another page while this one was loading; reload the page')
            }
            return { kind: 'bytes', bytes: await deps.readMainFile() }
        },
    }
}
