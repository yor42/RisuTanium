import { changeLanguage, language } from 'src/lang'
import { repairDatabaseIds } from '../process/chatIds'
import { bytesEqual, FILE_HEADER_V1 } from './blockFrame'
import { HEAD_KEY, LEGACY_MAIN_FILE_KEY, PRE_BLOCKS_PREFIX, rootKey } from './blockKeys'
import { validateLoadedBlocks } from './blockProfileValidate'
import {
    BlockStoreReadError,
    type BlockLayout,
    type BlockSetInput,
    type BlockStoreOwner,
    type DamagedItem,
    type DamagedResult,
    type ReplaceOptions,
    type SeedBlocker,
} from './blockStore'
import type { BootArchiveSession } from './bootArchivePass'
import type { Database } from './database.svelte'
import { isPreBlocksKey } from './mainFileFingerprint'
import { finishMainFileRename } from './mainFileRename'
import { holdAssetSweep, takeMainFileLeftOverLimit } from './pageStorageMode'
import { decodeRisuSave, salvageRisuSave, type SalvageOmittedBlock } from './risuSave'
import type { ByteStore } from './store/contract'
import { StoreNotBinaryError } from './store/errors'
import { completeRestoredTree, treeToBlockSet, treeToBlockSetReported } from './treeToBlockSet'
import { repairCharacterTree, summarizeRepair } from './characterTreeRepair'
import { SaveParkError } from './saveHold'

/**
 * The boot side of the block store: loading the profile through the page's
 * owner, the prompt that offers a numbered backup when the saved data is
 * damaged, the seed of an empty profile, and what boot does once a block
 * profile is installed.
 *
 * The damage path writes nothing before a person chooses: `load()` writes
 * nothing, and the damage prompt's replace runs only after the choice, under a
 * fresh exclusive hold, against exactly the damage the person saw. A refusal
 * to continue is an error thrown as the text the boot stop screen shows; the
 * state on disk is then unchanged, and the next start asks again.
 */

// -- what the boot asks of its surroundings ----------------------------------

/** The prompts boot may show before the app is up. */
export interface BootLoadUi {
    /** Shows text the person reads and acknowledges. */
    notify(text: string): Promise<void>
    /** Offers choices under a short title and resolves the index chosen. */
    choose(title: string, options: readonly string[]): Promise<number>
    confirm(text: string): Promise<boolean>
}

/** The numbered backups, newest first. */
export interface BootBackupSource {
    list(): Promise<number[]>
    read(time: number): Promise<Uint8Array>
}

export interface BootLoadContext {
    owner: BlockStoreOwner
    store: ByteStore
    session: BootArchiveSession
    ui: BootLoadUi
    backups: BootBackupSource
    /**
     * The character an archived character's unit holds, or null when the unit cannot
     * supply one. Used only to give a restored archived character with an unusable id
     * back the id its unit records; without it such a backup is refused. This module
     * does not read the unit store itself.
     */
    readUnitCharacter?(stub: Record<string, unknown>): Promise<unknown>
    /** Never settles: this page is reloading and nothing may go on. */
    waitForReload(): Promise<never>
}

export type BlockProfileLoad =
    | { kind: 'no-head' }
    /** `how` is `store` for a profile read from the block store (the pass may run on it) and `backup` for one the damage prompt replaced it with. */
    | { kind: 'loaded', tree: Database, how: 'store' | 'backup' }

// -- loading -----------------------------------------------------------------

/**
 * Loads the profile from the block store. Resolves `no-head` for a profile
 * that has not been converted (the legacy read follows), and the decoded tree
 * for a block profile: the strict decode runs inside `load()`, so a block that
 * does not decode is damage and nothing is installed. A damaged profile goes
 * through the prompt; a read that keeps failing stops the boot with nothing
 * installed or written.
 */
export async function loadBlockProfile(ctx: BootLoadContext): Promise<BlockProfileLoad> {
    for (;;) {
        let result
        try {
            result = await ctx.owner.load({ validate: validateLoadedBlocks })
        } catch (error) {
            if (error instanceof BlockStoreReadError) {
                console.error(error)
                throw language.saveReadFailed
            }
            throw error
        }
        if (result.kind === 'no-head') {
            return { kind: 'no-head' }
        }
        if (result.kind === 'loaded') {
            return { kind: 'loaded', tree: result.tree, how: 'store' }
        }
        const resolved = await resolveDamage(ctx, result)
        if (resolved.kind === 'installed') {
            return { kind: 'loaded', tree: resolved.tree, how: 'backup' }
        }
    }
}

// -- the damage prompt -------------------------------------------------------

type Resolution = { kind: 'installed', tree: Database } | { kind: 'again' }

/** What a re-check under the hold decided. */
type Recheck =
    | { kind: 'proceed', options: ReplaceOptions }
    /** The situation is gone or changed; `told` is whether the person is told the choice did not happen. */
    | { kind: 'changed', told: boolean }

interface Scenario {
    /** Text shown above the choice. */
    intro: string
    /** What loading the backup leaves on disk and what it costs, shown with the choice; empty for none. */
    note: string
    /** The text of the stop screen. */
    stopped: string
    /** Run under the hold, immediately before the replace. */
    recheck(): Promise<Recheck>
}

async function resolveDamage(ctx: BootLoadContext, damaged: DamagedResult): Promise<Resolution> {
    // Nothing is installed yet, so the prompt is worded in the language the
    // saved settings name, where the root could be read.
    const saved = damaged.rootFields?.language
    changeLanguage(typeof saved === 'string' ? saved : 'en')
    const items = damaged.damage.map((item) => `- ${describeDamagedItem(item)}`).join('\n')
    const seen = await signatureOf(ctx.store, damaged)
    return await offerBackup(ctx, {
        intro: language.saveDamagedNotice(items),
        note: language.saveDamagedKeepNote,
        stopped: language.saveDamagedStopped(items),
        recheck: async () => {
            const again = await ctx.owner.readCommitted({ validate: validateLoadedBlocks })
            if (again.kind !== 'damaged') {
                return { kind: 'changed', told: false }
            }
            if (!sameSignature(seen, await signatureOf(ctx.store, again))) {
                return { kind: 'changed', told: true }
            }
            // With a readable head only the generation it names is kept; with an unreadable one every generation that has a root is.
            return { kind: 'proceed', options: again.generation === null ? { keepAll: true } : { keepDamaged: again.generation } }
        },
    })
}

/**
 * Shows the damage, offers the newest complete backup (D2: the newest that
 * decodes strictly; only when none does, the newest partial one after a
 * confirm that lists what is missing), and replaces the whole state with it
 * after the choice.
 */
async function offerBackup(ctx: BootLoadContext, scenario: Scenario): Promise<Resolution> {
    // The boot hold must not stay up while a person reads a prompt.
    await ctx.session.release()
    const found = await findBackup(ctx.backups)
    if (found.kind === 'none') {
        await ctx.ui.notify(`${scenario.intro}\n\n${language.saveDamagedNoBackup}`)
        throw scenario.stopped
    }
    const date = new Date(found.time * 100).toLocaleString()
    await ctx.ui.notify(scenario.note === '' ? scenario.intro : `${scenario.intro}\n\n${scenario.note}`)
    const choice = await ctx.ui.choose(language.saveDamagedChoiceTitle, [language.saveDamagedLoadBackup(date), language.saveDamagedStop])
    if (choice !== 0) {
        throw scenario.stopped
    }
    if (found.kind === 'partial') {
        const missing = describeOmitted(found.omitted)
        if (!await ctx.ui.confirm(language.saveDamagedPartialConfirm(date, missing.map((line) => `- ${line}`).join('\n')))) {
            throw scenario.stopped
        }
    }

    const tree = found.tree
    const { set, notice } = await buildBackupSet(ctx, tree)

    const release = await takeHold(ctx, scenario.stopped)
    let released = false
    const giveBack = async () => {
        if (!released) {
            released = true
            await release()
        }
    }
    try {
        const verdict = await scenario.recheck()
        if (verdict.kind === 'changed') {
            await giveBack()
            if (verdict.told) {
                await ctx.ui.notify(language.saveDamagedChanged)
            }
            return { kind: 'again' }
        }
        const result = await ctx.owner.replaceWholeState(set, verdict.options)
        switch (result.kind) {
            case 'won':
                await giveBack()
                // The same boot must not sweep what the generation it kept references.
                holdAssetSweep()
                // Acknowledged before boot goes on, so it is read before the app opens; only a replace that won gets here.
                if (notice !== null) {
                    await ctx.ui.notify(notice)
                }
                return { kind: 'installed', tree }
            case 'lost':
            case 'aborted':
                await giveBack()
                await ctx.ui.notify(language.saveDamagedChanged)
                return { kind: 'again' }
            case 'refused':
                await giveBack()
                throw language.saveDamagedTooLarge
            case 'unconfirmed':
                // The write lock stays closed: nothing may save until a reload shows which state is current.
                released = true
                throw language.saveDamagedUnconfirmed
        }
    } catch (error) {
        await giveBack()
        throw error
    }
}

/**
 * The block set the chosen backup is written as. The tree is made one the save
 * can hold first, as every restore does: entries that are not characters are
 * left out, a missing or unusable id is replaced, and an archived character
 * takes back the id its unit records. A backup that still cannot be saved is
 * refused by throwing the text the boot stop screen shows; nothing has been
 * written.
 */
async function buildBackupSet(ctx: BootLoadContext, tree: Database): Promise<{ set: BlockSetInput, notice: string | null }> {
    const repair = await repairCharacterTree(tree, 'restore', { readUnitCharacter: ctx.readUnitCharacter })
    if (repair.refusals.length > 0) {
        throw language.restoreRefusedArchivedId(repair.refusals[0].name)
    }
    const { dropped, changed, recovered } = summarizeRepair(repair.notices)
    const notice = dropped + changed + recovered > 0 ? language.restoreRepairedNotice(dropped, changed, recovered) : null
    repairDatabaseIds(tree)
    completeRestoredTree(tree)
    try {
        const { set, report } = await treeToBlockSetReported(tree)
        if (report.excluded.length > 0) {
            throw language.restoreRefusedUnsavable('an entry of the backup')
        }
        return { set, notice }
    } catch (error) {
        if (error instanceof SaveParkError) {
            throw language.restoreRefusedUnsavable(language.saveBlockLabel(error.what))
        }
        throw error
    }
}
/**
 * The fresh exclusive hold for the replace. Where Web Locks exist and another
 * tab is open, the replace does not proceed: the person is told to close it
 * and retries, or stops. Without Web Locks the replace is behind a confirm.
 */
async function takeHold(ctx: BootLoadContext, stopped: string): Promise<() => Promise<void>> {
    for (;;) {
        const hold = await ctx.session.acquireReplaceHold()
        if (hold.kind === 'held') {
            return hold.release
        }
        if (hold.kind === 'unlocked') {
            if (hold.reason === 'no-web-locks' && !await ctx.ui.confirm(language.restoreNoLockWarningConfirm)) {
                throw stopped
            }
            return async () => { }
        }
        if (hold.reloading) {
            return await ctx.waitForReload()
        }
        const choice = await ctx.ui.choose(language.saveDamagedOtherTab, [language.saveDamagedRetry, language.saveDamagedStop])
        if (choice !== 0) {
            throw stopped
        }
    }
}

type FoundBackup =
    | { kind: 'complete', time: number, tree: Database }
    | { kind: 'partial', time: number, tree: Database, omitted: Map<string, SalvageOmittedBlock> }
    | { kind: 'none' }

function isDatabaseObject(value: unknown): value is Database {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The newest backup that decodes strictly; failing that, the newest that has an intact part. */
async function findBackup(backups: BootBackupSource): Promise<FoundBackup> {
    let times: number[]
    try {
        times = await backups.list()
    } catch (error) {
        console.error(error)
        return { kind: 'none' }
    }
    for (const time of times) {
        try {
            const tree = await decodeRisuSave(await backups.read(time), { strict: true })
            if (isDatabaseObject(tree)) {
                return { kind: 'complete', time, tree }
            }
        } catch (error) {
            console.error(error)
        }
    }
    for (const time of times) {
        try {
            const { db, omitted } = await salvageRisuSave(await backups.read(time))
            if (isDatabaseObject(db)) {
                return { kind: 'partial', time, tree: db, omitted }
            }
        } catch (error) {
            console.error(error)
        }
    }
    return { kind: 'none' }
}

/**
 * The lines of a partial-backup confirm: every character and kind the intact
 * tree lacks. A character is named by `names` (chaId to display name) when the
 * caller knows it, and by its block name otherwise. Empty when nothing the
 * person cares about was left out.
 */
export function describeOmitted(omitted: ReadonlyMap<string, SalvageOmittedBlock>, names?: ReadonlyMap<string, string>): string[] {
    const lines: string[] = []
    const kinds = new Set<string>()
    let unreadable = 0
    for (const [blockName, block] of omitted) {
        switch (block.kind) {
            case 'character':
                lines.push(names?.get(blockName) ?? blockName)
                break
            case 'other':
                unreadable++
                break
            case 'ignored':
                break
            default:
                kinds.add(block.kind)
        }
    }
    if (kinds.has('presets')) lines.push(language.internalBackupLeftOutPresets)
    if (kinds.has('modules')) lines.push(language.internalBackupLeftOutModules)
    if (kinds.has('loadouts')) lines.push(language.internalBackupLeftOutLoadouts)
    if (kinds.has('plugins')) lines.push(language.internalBackupLeftOutPlugins)
    if (kinds.has('pluginStorage')) lines.push(language.internalBackupLeftOutPluginData)
    if (unreadable > 0) lines.push(`${unreadable} ${language.internalBackupLeftOutUnreadable}`)
    return lines
}

function describeDamagedItem(item: DamagedItem): string {
    return language.saveDamageItem(item.part, item.name, item.kind)
}

// -- telling one damage from another ---------------------------------------------

/**
 * What a damage result stands on: the head's bytes, the damaged root's bytes
 * (or its absence) and the damaged items. The replace proceeds only while a
 * fresh read under the hold shows the same, whatever the damage kind: an
 * unreadable head or root has no generation or sequence number to compare.
 */
interface DamageSignature {
    head: Uint8Array | 'absent' | 'not-binary'
    root: Uint8Array | 'absent' | 'not-binary' | 'none'
    generation: string | null
    items: string
}

async function readOrMarker(store: ByteStore, key: string): Promise<Uint8Array | 'absent' | 'not-binary'> {
    try {
        const { bytes } = await store.read(key)
        return bytes === null ? 'absent' : bytes
    } catch (error) {
        if (error instanceof StoreNotBinaryError) {
            return 'not-binary'
        }
        throw error
    }
}

async function signatureOf(store: ByteStore, damaged: DamagedResult): Promise<DamageSignature> {
    return {
        head: await readOrMarker(store, HEAD_KEY),
        root: damaged.generation === null ? 'none' : await readOrMarker(store, rootKey(damaged.generation)),
        generation: damaged.generation,
        items: JSON.stringify(damaged.damage.map((item) => [item.part, item.name, item.key, item.kind])),
    }
}

function sameBytesOrMarker(a: Uint8Array | string, b: Uint8Array | string): boolean {
    if (typeof a === 'string' || typeof b === 'string') {
        return a === b
    }
    return bytesEqual(a, b)
}

function sameSignature(a: DamageSignature, b: DamageSignature): boolean {
    return a.generation === b.generation
        && a.items === b.items
        && sameBytesOrMarker(a.head, b.head)
        && sameBytesOrMarker(a.root, b.root)
}

// -- seeding an empty profile ------------------------------------------------

export type SeedBoot =
    /** The seed won: `tree` is the profile to install. `leftover` are generations an interrupted earlier seed left. */
    | { kind: 'installed', tree: Database, leftover: readonly string[] }
    /** Another page created a head meanwhile: load again and carry on with its state. */
    | { kind: 'load-again' }
    /** Something sits where an empty profile would be written, and a backup was chosen instead: the same as `loadBlockProfile`'s backup. */
    | { kind: 'backup', tree: Database }

/** The file a layout encodes to: the header and every block, as a legacy decoder reads it. */
export function layoutFileBytes(layout: BlockLayout): Uint8Array {
    const out = new Uint8Array(FILE_HEADER_V1.length + layout.blocks.reduce((sum, block) => sum + block.length, 0))
    out.set(FILE_HEADER_V1, 0)
    let offset = FILE_HEADER_V1.length
    for (const block of layout.blocks) {
        out.set(block, offset)
        offset += block.length
    }
    return out
}

/** The profile an empty install starts from: the containers every save holds, and nothing else. */
function emptyProfile(): Database {
    return {
        characters: [],
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
    } as unknown as Database
}

/**
 * Seeds an empty profile when there is no head and no main file. A seed never
 * goes over data: if the owner finds a main file, a copy of one or a numbered
 * backup it does not seed, and the boot offers the newest backup (when one
 * exists) or stops naming what was found. A seed that loses to another page
 * loads that page's state; one whose generation does not read back is tried
 * once more and then stops the boot.
 */
export async function seedEmptyBlockProfile(ctx: BootLoadContext): Promise<SeedBoot> {
    for (let attempt = 1; ; attempt++) {
        const set = await treeToBlockSet(emptyProfile())
        const seeded = await ctx.owner.seedEmptyProfile(set)
        if (seeded.kind === 'blocked') {
            return await resolveBlockedSeed(ctx, seeded.found)
        }
        const result = seeded.result
        switch (result.kind) {
            case 'won': {
                const tree = await decodeRisuSave(layoutFileBytes(set.layout), { strict: true }) as Database
                return { kind: 'installed', tree, leftover: seeded.leftoverGenerations }
            }
            case 'lost':
                if (result.reason === 'generation-damaged') {
                    if (attempt >= 2) {
                        throw language.saveSeedFailed
                    }
                    continue
                }
                return { kind: 'load-again' }
            case 'unconfirmed':
                throw language.saveDamagedUnconfirmed
            default:
                throw language.saveSeedFailed
        }
    }
}

async function resolveBlockedSeed(ctx: BootLoadContext, found: readonly SeedBlocker[]): Promise<SeedBoot> {
    // A head means another page created the profile after this boot looked: its
    // state is what to load, and neither "no current save" nor a backup is true.
    if (found.some((blocker) => blocker.kind === 'head')) {
        return { kind: 'load-again' }
    }
    const what = language.saveSeedBlocked(found.map((blocker) => blocker.kind))
    const hasBackup = found.some((blocker) => blocker.kind === 'numbered-backup')
    if (!hasBackup) {
        await ctx.session.release()
        throw what
    }
    const resolved = await offerBackup(ctx, {
        intro: what,
        note: '',
        stopped: what,
        recheck: async () => {
            const again = await ctx.owner.readCommitted()
            return again.kind === 'no-head' ? { kind: 'proceed', options: { requireAbsentHead: true } } : { kind: 'changed', told: false }
        },
    })
    return resolved.kind === 'installed' ? { kind: 'backup', tree: resolved.tree } : { kind: 'load-again' }
}

// -- what boot does after a block profile is installed ---------------------------

/** A notice the boot posts, in the language the installed settings select. */
export type BootNotice =
    | { kind: 'leftover-generations', count: number }
    | { kind: 'main-file-left' }
    | { kind: 'opfs-read-only' }

/**
 * Whether the store holds an older copy of the main file next to the block
 * profile: a pre-conversion copy (`database.pre-blocks*`), or, on a block
 * profile, the legacy main file itself (`database.bin`) left in place. The
 * startup asset sweep does not run while one does, because the copy may
 * reference assets the live profile does not; it resumes once the copy is
 * gone. On a profile with no block head the main file is the live save and
 * does not count. A listing or presence check that fails counts as "exists",
 * so the sweep stays off.
 */
export async function olderMainFileCopyExists(store: ByteStore): Promise<boolean> {
    try {
        if ((await store.list(PRE_BLOCKS_PREFIX)).some(isPreBlocksKey)) {
            return true
        }
        return (await store.has(HEAD_KEY)) && (await store.has(LEGACY_MAIN_FILE_KEY))
    } catch (error) {
        console.error('The older copies of the main file could not be checked; the startup asset sweep stays off:', error)
        return true
    }
}

/**
 * The steps that follow the install of a profile the block store holds, each
 * of which is best effort: the rename finish that moves the converted main
 * file aside, the inventory that decides whether the startup asset sweep may
 * run (never while a kept generation exists) and whether unused save data
 * is left over. A step that fails is logged; the boot goes on, and a failed
 * inventory holds the asset sweep off.
 */
export async function finishBlockBoot(owner: BlockStoreOwner, store: ByteStore): Promise<BootNotice[]> {
    const notices: BootNotice[] = []
    // A conversion that won inside the pass ran the finish already and noted what it found.
    let leftOverLimit = takeMainFileLeftOverLimit()
    const state = owner.committedState()
    if (state !== null) {
        const renamed = await finishMainFileRename(store, state.convertedFrom)
        leftOverLimit = leftOverLimit || renamed.kind === 'left-over-limit'
    }
    if (leftOverLimit) {
        notices.push({ kind: 'main-file-left' })
    }
    try {
        const inventory = await owner.inventory()
        if (inventory.kept.length > 0) {
            holdAssetSweep()
        }
        if (inventory.leftover.length > 0) {
            notices.push({ kind: 'leftover-generations', count: inventory.leftover.length })
        }
    } catch (error) {
        console.error('The generations of the block store could not be listed; the startup asset sweep stays off:', error)
        holdAssetSweep()
    }
    return notices
}
