import { language } from "src/lang";
import { retireGeneration, type BlockSetInput } from "../storage/blockStore";
import { presetTemplate, type Database } from "../storage/database.svelte";
import { finishMainFileRename } from "../storage/mainFileRename";
import { getPageBlockOwner } from "../storage/pageBlockOwner";
import { getPageStorageMode, pendingConvertedFrom, setPageStorageMode } from "../storage/pageStorageMode";
import { getAppStore } from "../storage/store/appStore";
import { DBState } from "../stores.svelte";

/**
 * What the whole-state restores (the `.bin` restore and the internal-backup
 * load) do with a replace's answer.
 *
 * - `won`: the head names the restored generation and the page is a block page.
 * - `not-happened`: another tab or device moved the head first (`lost`), or the
 *   busy guard refused at the flip (`aborted`). Nothing live changed. The
 *   restore's own generation is normally removed, but it may be left behind
 *   (an unknown flip outcome that re-read another head, a head mismatch whose
 *   re-read failed, an abort whose removal failed); the next boot reports it
 *   as an unused generation. `aborted` means the guard has already told the
 *   person why.
 * - `unconfirmed`: the head switch could not be confirmed. The page must reload
 *   to see which state is current, and must not save in the meantime.
 * - `too-large`: a block is over the Node server's request limit. Nothing was
 *   written.
 */
export type RestoreWrite =
    | { kind: 'won' }
    | { kind: 'not-happened', aborted: boolean }
    | { kind: 'unconfirmed' }
    | { kind: 'too-large', blockName: string, length: number, limit: number }

/**
 * Replaces the profile's whole state with `set` through the page's one block
 * owner. The caller holds the page's write lock for the whole call, so no save
 * iteration's earlier layout can land in the restored generation, and passes a
 * synchronous busy check that is asked once more at the flip.
 *
 * A page whose profile is still the legacy main file (no head) converts by
 * restoring: the new head carries the fingerprint of the main file boot read,
 * and on a win the page becomes a block page and the old main file is moved
 * aside, so the save loop's next iteration is a plain commit.
 *
 * Throws when the page has no owner (the read-only OPFS page, which the callers
 * refuse earlier) or when the replace itself fails; nothing is installed then.
 */
export async function replaceWithRestoredSet(set: BlockSetInput, busyAtFlip: () => boolean): Promise<RestoreWrite> {
    const owner = await getPageBlockOwner()
    if (owner === null) {
        throw new Error('This page has no block store to restore into.')
    }
    const mode = getPageStorageMode()
    const convertedFrom = pendingConvertedFrom()
    const result = await owner.replaceWholeState(set, {
        preFlip: busyAtFlip,
        ...(convertedFrom === undefined ? {} : { convertedFrom, convertedAt: Date.now() }),
    })
    switch (result.kind) {
        case 'won':
            if (mode.kind === 'legacy') {
                setPageStorageMode({ kind: 'block' })
                await finishMainFileRename(await getAppStore(), mode.convertedFrom)
            }
            return { kind: 'won' }
        case 'lost':
            if (result.reason === 'generation-damaged') {
                // The head never named this generation, so removing it is safe whatever else happens.
                if (result.generation !== null) {
                    try {
                        await retireGeneration(await getAppStore(), result.generation)
                    } catch (error) {
                        console.error('Removing the unused generation of a failed restore failed:', error)
                    }
                }
                throw new Error('The restored generation did not read back as written.')
            }
            return { kind: 'not-happened', aborted: false }
        case 'aborted':
            return { kind: 'not-happened', aborted: true }
        case 'unconfirmed':
            return { kind: 'unconfirmed' }
        case 'refused':
            return { kind: 'too-large', blockName: result.blockName, length: result.length, limit: result.limit }
    }
}

/**
 * Gives a decoded backup the containers the encoder reads, so every block of
 * the generation it becomes is readable: a backup from an older build may lack
 * a list, and a missing preset list would be written as an empty block, which
 * the strict decode at the next start reports as damage. A missing preset list
 * becomes the default preset, as `setDatabase` makes it.
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

/** The display names of the live profile's characters by chaId, for naming what a restore leaves out. */
export function currentCharacterNames(): Map<string, string> {
    const names = new Map<string, string>()
    for (const character of (DBState.db as Database | undefined)?.characters ?? []) {
        if (character?.chaId !== undefined && typeof character.name === 'string' && character.name !== '') {
            names.set(String(character.chaId), character.name)
        }
    }
    return names
}

/** The confirm text of a restore that leaves blocks out. */
export function leftOutQuestion(lines: readonly string[]): string {
    return language.restoreLeftOutConfirm(lines.map((line) => `- ${line}`).join('\n'))
}
