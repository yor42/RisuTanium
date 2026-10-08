import { language } from "src/lang";
import { BlockSetGateError, retireGeneration, type BlockSetInput } from "../storage/blockStore";
import type { Database } from "../storage/database.svelte";
import { finishMainFileRename } from "../storage/mainFileRename";
import { getPageBlockOwner } from "../storage/pageBlockOwner";
import { getPageStorageMode, pendingConvertedFrom, setPageStorageMode } from "../storage/pageStorageMode";
import { getAppStore } from "../storage/store/appStore";
import { DBState } from "../stores.svelte";
import { readColdStorageItem } from "../process/coldstorage.svelte";
import { repairCharacterTree, summarizeRepair } from "../storage/characterTreeRepair";
import { isCharacterEntry } from "../storage/characterIds";
import { SaveParkError } from "../storage/saveHold";
import { treeToBlockSetReported } from "../storage/treeToBlockSet";

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
 * - `unsavable`: a block would not load back, so the write gate refused it
 *   before anything was written.
 */
export type RestoreWrite =
    | { kind: 'won' }
    | { kind: 'not-happened', aborted: boolean }
    | { kind: 'unconfirmed' }
    | { kind: 'too-large', blockName: string, length: number, limit: number }
    | { kind: 'unsavable', blockName: string }

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
    let result: Awaited<ReturnType<typeof owner.replaceWholeState>>
    try {
        result = await owner.replaceWholeState(set, {
            preFlip: busyAtFlip,
            ...(convertedFrom === undefined ? {} : { convertedFrom, convertedAt: Date.now() }),
        })
    } catch (error) {
        if (error instanceof BlockSetGateError) {
            return { kind: 'unsavable', blockName: error.blockName }
        }
        throw error
    }
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

export { completeRestoredTree } from "../storage/treeToBlockSet";

/**
 * The character an archived character's unit holds, or null when the unit
 * cannot supply one: it is missing, cannot be read, or holds no character.
 */
export async function readArchivedUnitCharacter(stub: Record<string, unknown>): Promise<unknown> {
    const key = stub.coldstorage
    if (typeof key !== 'string' || key === '') {
        return null
    }
    try {
        const read = await readColdStorageItem(key)
        if (read.status !== 'ok') {
            return null
        }
        const value = read.value as { character?: unknown } | null | undefined
        return value?.character ?? null
    } catch (error) {
        console.error(error)
        return null
    }
}

/**
 * Makes the character list of a tree decoded from a backup one the save can
 * hold, before it is written: entries that are not characters are left out, a
 * missing id is filled, an id that cannot key a block is replaced with the
 * lists that named it following, and an archived character takes back the id
 * its unit records. Answers the text that refuses the restore (an archived
 * character with an unusable id whose unit cannot supply a usable, unique one
 * cannot be restored), or the notice of what was repaired, null when nothing was.
 */
export async function repairRestoredCharacters(tree: Database): Promise<RestoredRepair> {
    const repair = await repairCharacterTree(tree, 'restore', { readUnitCharacter: readArchivedUnitCharacter })
    if (repair.refusals.length > 0) {
        return { refusal: language.restoreRefusedArchivedId(repair.refusals[0].name) }
    }
    const { dropped, changed, recovered } = summarizeRepair(repair.notices)
    return { notice: dropped + changed + recovered > 0 ? language.restoreRepairedNotice(dropped, changed, recovered) : null }
}

/** The restore is refused with `refusal`, or goes on; `notice` says what the repair did and is shown once the restore has landed. */
export type RestoredRepair =
    | { refusal: string }
    | { notice: string | null }

export type RestoreSetBuild =
    | { set: BlockSetInput }
    | { refusal: string }

/**
 * The block set a restore writes, or the text that refuses the restore when
 * the tree still holds something the save cannot keep (an entry the encoder
 * left out, a container that is not a list, a character that does not serialize
 * to an object). Nothing has been written either way.
 */
export async function buildRestoreSet(tree: Database): Promise<RestoreSetBuild> {
    try {
        const { set, report } = await treeToBlockSetReported(tree)
        if (report.excluded.length > 0) {
            const names = report.excluded.map((item) =>
                isCharacterEntry(item.entry) && typeof item.entry.name === 'string' && item.entry.name !== ''
                    ? `"${item.entry.name}"`
                    : 'an entry that is not a character')
            return { refusal: language.restoreRefusedUnsavable(Array.from(new Set(names)).join(', ')) }
        }
        return { set }
    } catch (error) {
        if (error instanceof SaveParkError) {
            return { refusal: language.restoreRefusedUnsavable(language.saveBlockLabel(error.what)) }
        }
        throw error
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
