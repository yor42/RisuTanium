import { BlockTooLargeError, CommitLockTimeoutError, retireGeneration, type BlockLayout, type BlockSetInput, type BlockStoreOwner } from './blockStore'
import { finishMainFileRename } from './mainFileRename'
import { packedNamesOf, type PackableCharacter } from './packedNames'
import { getPageStorageMode, pendingConvertedFrom, setPageStorageMode } from './pageStorageMode'
import type { ByteStore } from './store/contract'

/**
 * One save of the page's state into the block store, as the save loop asks for
 * it: a commit into the live generation, or, on a page whose profile is still
 * the legacy main file, the conversion into a block profile. The loop holds the
 * page's write lock around the call. Nothing here writes the legacy main file.
 *
 * Every outcome is a value; only a failure the loop classifies on its own
 * (a read or write that threw) is thrown.
 */

export type SaveStepStop =
    /** Another writer committed since this page's last acknowledged root. */
    | 'peer-commit'
    /** The head names another generation: a whole-state replace happened elsewhere. */
    | 'head-moved'
    /** The generation's root is gone. */
    | 'generation-gone'
    /** Another page or device converted the profile while this one still held the legacy file. */
    | 'converted-elsewhere'

export type SaveStep =
    /** The state is in the store. `wrote` is false when nothing differed from what the store holds. */
    | { kind: 'saved', wrote: boolean, seq: number, converted: boolean, mainFileLeftInPlace: boolean }
    | { kind: 'stopped', reason: SaveStepStop, peerSeq: number | null }
    /** A Node write was refused as stale: another device changed `key`. */
    | { kind: 'conflict', key: string }
    | { kind: 'too-large', blockName: string, length: number, limit: number }
    /** The commit lock was not granted in time: the next iteration asks again. */
    | { kind: 'lock-timeout' }
    /** A conversion's new generation did not read back; its generation was removed when it could be. */
    | { kind: 'conversion-damaged', generation: string | null }
    /** The switch's outcome could not be established: the page must reload. */
    | { kind: 'unconfirmed' }

/** The part of the page's owner a save uses. */
export type SaveStepOwner = Pick<BlockStoreOwner, 'isLive' | 'commitSave' | 'replaceWholeState' | 'committedState'>

export interface SaveStepDeps {
    owner: SaveStepOwner
    store: ByteStore
    /** The Node body limit the rename finish measures a main file against; defaults to the server's. */
    nodeBodyLimit?: number
}

export interface SaveStepRequest {
    input: BlockSetInput
    /** Off Node only: overwrite what the peer committed, taking `peerSeq` as the base. */
    saveMine?: { peerSeq: number }
}

/**
 * The names whose block lives in the stubs pack, restricted to the blocks of
 * `layout`: a character archived while the encoder was still working can be
 * packed in the database and not yet in the layout, and a block set that names
 * a pack member it does not hold is not a save.
 */
export function packedForLayout(
    layout: BlockLayout,
    characters: ReadonlyArray<PackableCharacter>,
    frozenKeys: ReadonlySet<string>,
): Set<string> {
    const present = new Set(layout.keys)
    const packed = new Set<string>()
    for (const name of packedNamesOf(characters, frozenKeys)) {
        if (present.has(name)) {
            packed.add(name)
        }
    }
    return packed
}

export async function performSaveStep(deps: SaveStepDeps, request: SaveStepRequest): Promise<SaveStep> {
    const mode = getPageStorageMode()
    if (mode.kind === 'read-only') {
        throw new Error('A read-only page does not save.')
    }
    try {
        if (mode.kind === 'legacy' && !deps.owner.isLive()) {
            return await convert(deps, request.input, mode.convertedFrom)
        }
        return await commit(deps.owner, request)
    } catch (error) {
        if (error instanceof CommitLockTimeoutError) {
            return { kind: 'lock-timeout' }
        }
        if (error instanceof BlockTooLargeError) {
            return { kind: 'too-large', blockName: error.blockName, length: error.length, limit: error.limit }
        }
        throw error
    }
}

async function commit(owner: SaveStepOwner, request: SaveStepRequest): Promise<SaveStep> {
    const result = await owner.commitSave(request.input, request.saveMine === undefined ? {} : { saveMine: request.saveMine })
    switch (result.kind) {
        case 'committed':
            return { kind: 'saved', wrote: result.wrote, seq: result.seq, converted: false, mainFileLeftInPlace: false }
        case 'stopped':
            return { kind: 'stopped', reason: result.reason, peerSeq: result.peerSeq }
        case 'conflict':
            return { kind: 'conflict', key: result.key }
    }
}

/**
 * The conversion: a whole-state replace that only proceeds while there is no
 * head, naming the main file boot read. When it wins the page is a block page
 * and the main file is moved aside at once.
 */
async function convert(deps: SaveStepDeps, input: BlockSetInput, bootFingerprint: string | null): Promise<SaveStep> {
    const convertedFrom = pendingConvertedFrom()
    const result = await deps.owner.replaceWholeState(input, {
        requireAbsentHead: true,
        convertedFrom,
        convertedAt: convertedFrom === undefined ? undefined : Date.now(),
    })
    switch (result.kind) {
        case 'won': {
            setPageStorageMode({ kind: 'block' })
            const renamed = await finishMainFileRename(deps.store, bootFingerprint, { nodeBodyLimit: deps.nodeBodyLimit })
            return {
                kind: 'saved',
                wrote: true,
                seq: deps.owner.committedState()?.seq ?? 0,
                converted: true,
                mainFileLeftInPlace: renamed.kind === 'left-over-limit',
            }
        }
        case 'lost':
            if (result.reason === 'generation-damaged') {
                // The head never named this generation, so removing it is safe whatever else happens.
                if (result.generation !== null) {
                    try {
                        await retireGeneration(deps.store, result.generation)
                    } catch (error) {
                        console.error('Removing the unused generation of a failed conversion failed:', error)
                    }
                }
                return { kind: 'conversion-damaged', generation: result.generation }
            }
            return { kind: 'stopped', reason: 'converted-elsewhere', peerSeq: null }
        case 'unconfirmed':
            return { kind: 'unconfirmed' }
        case 'refused':
            return { kind: 'too-large', blockName: result.blockName, length: result.length, limit: result.limit }
        case 'aborted':
            throw new Error('The conversion was aborted by a check it did not ask for.')
    }
}
