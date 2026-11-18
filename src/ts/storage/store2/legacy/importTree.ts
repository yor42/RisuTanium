import { repairDatabaseIds } from '../../../process/chatIds'
import type { TaskPreset } from '../../../process/utility/taskPreset'
import type { JsonObject, JsonValue } from '../../blockFrame'
import type { Database } from '../../database.svelte'
import { repairBotPresetsId } from '../../botPresetRepair'
import { repairCharacterTree, summarizeRepair, type RepairRefusal } from '../../characterTreeRepair'
import { completeRestoredTree } from '../../treeToBlockSet'
import { Store2BackendError } from '../backend/errors'
import type { Store2Backend, Store2Read } from '../backend/types'
import { IMPORT_REPLACES_BASE, type BuildContext, type BuiltCommit, type Committer, type CommitResult } from '../commit'
import { classifyCommitRead } from '../commitKey'
import { builtCommitOf, planScopedEncode, type ScopedPlan } from '../codec/scoped'
import { carryManifest } from '../codec/manifest'
import { CodecError, type EncodedTree, type ListDerivation } from '../codec/types'
import {
    defaultKeyEnv, readUnit, UNIT_TYPE, type KeyEnv, type LegacyList, type Manifest,
} from '../format'
import { withPageUsage } from '../../../usage/usageLedger'
import { withLegacyKeep } from './convert'
import {
    LegacyReadError, readLegacyUnit, resolveLegacyTree, type IncompleteItem, type LegacyEntryReader, type ResolvedLegacyTree,
    type ResolveOptions,
} from './resolve'

/**
 * Importing a decoded legacy-shaped tree (a `.bin` database entry, an old numbered backup) over the profile a store2
 * page already holds. This is the library core of the Settings import, without any page, prompt or string:
 *
 *   1. repairs, in the order the restore has always run them, with the unit of an archived character read through the
 *      injected reader and never through the device store;
 *   2. `resolveLegacyTree` through the same reader; what it could not bring in goes to `hooks.confirmIncomplete`,
 *      and a decline writes nothing;
 *   3. `planScopedEncode` of the whole resolved tree with no `previous`: nothing is reused from the profile being
 *      replaced, so no imported character can take over a unit or an entity id of the current one;
 *   4. one `commit()` over a fresh read of the commit key, `label: 'import'` and `force: true`, so the replaced
 *      `current` always enters `retained`.
 *
 * Invariants:
 *  - Nothing is written before every question is answered and the plan exists. Every refusal before `commit()`
 *    (repair refusal, read failure, decline, unsavable tree, unreadable base) leaves the store as it was.
 *  - The imported manifest carries what the replaced one must not lose (`carryManifest`): `fixed.legacyKeep` (the
 *    stage 5 asset sweep reads it from every manifest the commit key names), fields this build does not know, and the
 *    `req` union. The manifest it is carried from is the one named by `current` of the very read handed to
 *    `commit()`; with a different read the new manifest could name a keep-list unit only an older manifest names,
 *    which an ordinary commit must not do. A base that cannot be read stops the import.
 *  - The decoded tree is released (`ImportSource.tree` set to null) as soon as it is resolved; the plan holds the
 *    encoded units, not the tree, so the commit's build needs nothing of it.
 *
 * The build is `buildImport`, shared with the boot-time installer, which has no `current` to commit over.
 */

export type RepairSummary = ReturnType<typeof summarizeRepair>

/** The decoded tree; the import sets `tree` to null once it no longer needs it. */
export interface ImportSource {
    tree: Database | null
}

export interface ImportRequest {
    source: ImportSource
    /** Reads the cold-storage units the tree's pointers name (the `.bin` entries, or the page's legacy units). */
    reader: LegacyEntryReader
    committer: Committer
    backend: Store2Backend
    lists: ListDerivation
    env?: KeyEnv
    resolve?: ResolveOptions
    /**
     * A keep list for old files the profile still holds (built with `LegacyListBuilder`), written as the imported
     * manifest's `fixed.legacyKeep` in place of the carried one. Absent, the replaced manifest's keep set is carried.
     */
    legacyKeep?: LegacyList
    /**
     * The page's own task presets, kept by value: a `.bin` carries none, so the list the page holds is set on the imported
     * tree. Absent or empty: the imported profile has none. The tree's own `taskPresets` key is removed either way.
     */
    taskPresets?: readonly JsonObject[]
    /**
     * The page's own installed theme packs, kept by value: a `.bin` carries none, so the list the page holds is set on the
     * imported tree. Absent or empty: the imported profile has none. The tree's own `themePacks` key is removed either way.
     */
    themePacks?: readonly JsonValue[]
    /**
     * The page's own active theme pack id (a record id or a `builtin:<slug>`), kept as it is. Carried on its own: it is set
     * whether or not the page holds any record. Absent: the imported profile has none; the tree's own key is removed either way.
     */
    activeThemePack?: string
    /**
     * The page's own usage ledger keys (`u1|...`, values as they are), kept by value: a `.bin` carries none, so they are set
     * beside the imported file's own non-usage `statics` keys. Absent: the imported profile has none. The file's own usage
     * keys, of any version, are removed either way.
     */
    usageStatics?: JsonObject
    /**
     * The page's own per-model price overrides, kept by value: a `.bin` carries none. Absent: the imported profile has none.
     * The tree's own `usagePriceOverrides` key is removed either way.
     */
    usagePriceOverrides?: JsonObject
}

export interface ImportHooks {
    /** What the resolve could not bring in. `false` declines: nothing is written. */
    confirmIncomplete(items: readonly IncompleteItem[]): Promise<boolean>
    /** Observes the import's phases. Synchronous and return value ignored: it can neither delay nor fail the import. */
    onPhase?(phase: string): void
}

/** Calls `hooks.onPhase` without awaiting it and without letting it throw: an observer never decides the import's outcome. */
export function notePhase(hooks: ImportHooks, phase: string): void {
    try {
        hooks.onPhase?.(phase)
    } catch {
        // An observer that fails is ignored.
    }
}

/**
 * What the import came to. The commit's own outcomes pass through unchanged (`conflict`, `unknown`, `failed`,
 * `refused` with `marker-present` among its reasons, `abandoned` with its cause); the rest were decided before
 * any write. A `build` that throws propagates out of `commit()` as the committer defines (`Store2BulkAbortError` on
 * the bulk path).
 */
export type ImportOutcome =
    | (Extract<CommitResult, { status: 'committed' }> & { repair: RepairSummary })
    | Exclude<CommitResult, { status: 'committed' }>
    | { status: 'declined' }
    /** A unit could not be read (as opposed to being absent): the file changed or the store failed. */
    | { status: 'read-failed', error: LegacyReadError }
    /** An archived character cannot be given a usable, unique id. */
    | { status: 'repair-refused', refusals: readonly RepairRefusal[] }
    /** The codec cannot hold the tree (a container that is not a list, a character that is not an object). */
    | { status: 'unsavable', detail: string }
    /** The manifest `current` names is absent, damaged or unreadable, so its keep set cannot be carried. */
    | { status: 'base-unreadable', detail: string }

/** What the imported manifest keeps of the one it replaces, or an explicit keep list. */
export interface ImportKeep {
    /** The manifest named by `current` of the read the build is committed over. */
    base?: Manifest
    list?: LegacyList
}

export interface ImportBuild {
    newUnits: number
    build(context: BuildContext): Promise<BuiltCommit> | BuiltCommit
}

/**
 * What `buildImport` builds from: the number of units the commit writes (the manifest included) and the step that
 * produces them under the attempt's context. A `ScopedPlan` satisfies it (`finalize` returns the planned tree); a
 * streamed import returns the built commit itself, after uploading its other units through the context. Either way
 * `finalize` is called once per attempt, and `newUnits` is known before any key exists.
 */
export interface ImportUnits {
    newUnits: number
    finalize(context: BuildContext): EncodedTree | BuiltCommit | Promise<BuiltCommit>
}

/**
 * The commit build of an import: the plan's tree under the attempt's mint, its manifest carrying `keep.base`
 * (`carryManifest`), and, with `keep.list`, the list as one more unit that the manifest's `legacyKeep` names (the
 * shape the conversion gives its own keep list). The same object serves the commit of a page and the installer of a
 * boot, which add their own `convertedFrom` or label.
 */
export function buildImport(plan: ImportUnits, keep: ImportKeep = {}): ImportBuild {
    const carry = (built: BuiltCommit): BuiltCommit => {
        built.manifest.body = carryManifest(keep.base, built.manifest.body)
        return built
    }
    const carried: ImportBuild = {
        newUnits: plan.newUnits,
        build(context) {
            const made = plan.finalize(context)
            if (made instanceof Promise) {
                return made.then(carry)
            }
            return carry('manifestKey' in made ? builtCommitOf(made) : made)
        },
    }
    // An explicit list replaces the carried keep set (it is written after the carry), through the conversion's own wrapper.
    return keep.list === undefined ? carried : withLegacyKeep(carried, keep.list)
}

/** The character an archived character's unit holds, read through `reader`; null when the unit cannot supply one. A failed read rejects. */
async function readStubCharacter(reader: LegacyEntryReader, stub: Record<string, unknown>): Promise<unknown> {
    const key = stub.coldstorage
    if (typeof key !== 'string' || key === '') {
        return null
    }
    const read = await readLegacyUnit(reader, key, 'stub')
    if (read.status !== 'ok') {
        return null
    }
    const value = read.value as { character?: unknown } | null | undefined
    return value?.character ?? null
}

export type TreeRepairResult =
    | { status: 'repaired', summary: RepairSummary }
    | { status: 'refused', refusals: readonly RepairRefusal[] }

/**
 * Makes a decoded tree one the codec can hold, in the order the restore has always run the repairs: the character
 * list (an archived character takes back the id its unit records, read through `reader`), chat and character ids, the
 * containers the encoder reads, then a preset id that names no preset. The tree is changed in place; the caller owns
 * it. A read failure of the reader rejects (`LegacyReadError`).
 */
export async function repairImportTree(tree: Database, reader: LegacyEntryReader): Promise<TreeRepairResult> {
    const repaired = await repairCharacterTree(tree, 'restore', { readUnitCharacter: stub => readStubCharacter(reader, stub) })
    if (repaired.refusals.length > 0) {
        return { status: 'refused', refusals: repaired.refusals }
    }
    repairDatabaseIds(tree)
    repairImportRoot(tree)
    return { status: 'repaired', summary: summarizeRepair(repaired.notices) }
}

/**
 * The repairs of everything outside the character list, run after the character and id repairs: the containers the
 * encoder reads (`completeRestoredTree`), then a preset id that names no preset (`repairBotPresetsId`), in that order.
 * Shared by the whole and the streamed prepare, so neither can run one without the other. The tree is changed in place.
 */
export function repairImportRoot(tree: Database): void {
    completeRestoredTree(tree)
    repairBotPresetsId(tree)
}

/**
 * Sets the page's own task presets, installed theme packs, active theme pack, usage keys and price overrides on a
 * resolved database, which holds a copy of the file's root: a `.bin` carries none of them (its export leaves them out), so
 * a key of that name in the file is dropped (for `statics`, its usage keys only), and only what `request` passes is set.
 * `resolveLegacyTree` has already removed `taskPresets`. Shared by the whole and the streamed prepare.
 */
export function applyImportOverlay(
    database: Database, request: Pick<ImportRequest, 'taskPresets' | 'themePacks' | 'activeThemePack' | 'usageStatics' | 'usagePriceOverrides'>,
): void {
    if (request.taskPresets !== undefined && request.taskPresets.length > 0) {
        // The objects stay open: the type names the fields this build reads, the stored object keeps every key.
        database.taskPresets = request.taskPresets.map(preset => structuredClone(preset) as unknown as TaskPreset)
    }
    delete database.themePacks
    delete database.activeThemePack
    if (request.activeThemePack !== undefined) {
        database.activeThemePack = request.activeThemePack
    }
    if (request.themePacks !== undefined && request.themePacks.length > 0) {
        database.themePacks = request.themePacks.map(pack => structuredClone(pack))
    }
    const statics = withPageUsage(database.statics as JsonValue | undefined, request.usageStatics)
    if (statics !== (database.statics as JsonValue | undefined)) {
        // The file's statics is JSON read from a file, so it is not checked against the field's type; a value that is not an
        // object is replaced by the defaults whenever the page has usage, and is otherwise returned as it was.
        database.statics = statics as Database['statics']
    }
    delete database.usagePriceOverrides
    if (request.usagePriceOverrides !== undefined) {
        // Stored overrides are plain JSON whose shape this build reads leniently, as the task presets above.
        database.usagePriceOverrides = structuredClone(request.usagePriceOverrides) as unknown as Database['usagePriceOverrides']
    }
}

/**
 * The incomplete-data question of an import. True when nothing is incomplete or the caller confirmed; false is the
 * decline, after which nothing is written. Shared by the whole and the streamed prepare, which ask it at most once.
 */
export async function confirmImportIncomplete(incomplete: readonly IncompleteItem[], hooks: Pick<ImportHooks, 'confirmIncomplete'>): Promise<boolean> {
    return incomplete.length === 0 || await hooks.confirmIncomplete(incomplete)
}

async function planResolved(
    hold: { resolved: ResolvedLegacyTree | null }, options: { lists: ListDerivation, env: KeyEnv },
): Promise<ScopedPlan | { status: 'unsavable', detail: string }> {
    const database = hold.resolved?.database
    hold.resolved = null
    if (database === undefined) {
        throw new TypeError('The resolved tree was already released.')
    }
    try {
        return await planScopedEncode(
            database,
            { env: options.env, lists: options.lists, seq: 0, createdAt: options.env.now() },
            { modules: true, characters: 'all' },
        )
    } catch (error) {
        if (error instanceof CodecError) {
            return { status: 'unsavable', detail: error.message }
        }
        throw error
    }
}

export type BaseManifest =
    | { status: 'none' }
    | { status: 'ok', manifest: Manifest }
    | { status: 'unreadable', detail: string }
    | { status: 'failed', cause: Store2BackendError }

/**
 * The manifest `current` of `read` names. `none` when `read` is not a parsed key naming a current: the commit itself
 * refuses such a read, and nothing is built.
 */
export async function baseManifestOf(backend: Store2Backend, read: Store2Read): Promise<BaseManifest> {
    const classified = classifyCommitRead(read)
    if (classified.status !== 'parsed' || classified.value.current === null) {
        return { status: 'none' }
    }
    const key = classified.value.current.key
    let bytes: Uint8Array | null
    try {
        bytes = (await backend.readUnits([key])).get(key) ?? null
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'failed', cause: error }
        }
        throw error
    }
    if (bytes === null) {
        return { status: 'unreadable', detail: `The current manifest ${key} is absent.` }
    }
    const unit = readUnit(bytes, UNIT_TYPE.manifest)
    if (unit.status !== 'ok' && unit.status !== 'stale') {
        return { status: 'unreadable', detail: `The current manifest ${key} cannot be read: ${unit.reason}` }
    }
    return { status: 'ok', manifest: unit.value.body as Manifest }
}

/** The plan of a tree that was repaired, resolved and confirmed, with the summary of the repairs. */
export interface PreparedImport {
    plan: ScopedPlan
    repair: RepairSummary
}

/** What `prepareImport` ends in before any write: everything of `ImportOutcome` that is decided without the commit key. */
export type PrepareStop = Extract<ImportOutcome, { status: 'declined' | 'read-failed' | 'repair-refused' | 'unsavable' }>

/**
 * Steps 1 to 3 of the import, shared by the page commit and the boot installer: repairs, resolve, the incomplete-data
 * question, the plan. Nothing is written. The decoded tree is released once resolved.
 *
 * Invariant: a streamed prepare (`prepareImportStream`) runs the same steps over a file it reads in pieces. Every
 * step here that is not tied to the whole tree being resident is one shared function (`repairCharacterIds`,
 * `resolveLegacyCharacter`, `repairImportRoot`, `resolveLegacyRoot`, `applyImportOverlay`, `confirmImportIncomplete`)
 * that both prepares call. A step added to this prepare must be added to the streamed prepare through a shared
 * function, or the streamed prepare must return 'whole' for the files it affects, so the two never drift.
 */
export async function prepareImport(
    request: Pick<ImportRequest, 'source' | 'reader' | 'lists' | 'env' | 'resolve' | 'taskPresets' | 'themePacks' | 'activeThemePack' | 'usageStatics' | 'usagePriceOverrides'>, hooks: ImportHooks,
): Promise<PreparedImport | PrepareStop> {
    let tree = request.source.tree
    if (tree === null) {
        throw new TypeError('The decoded tree was already released.')
    }
    const hold: { resolved: ResolvedLegacyTree | null } = { resolved: null }
    let repair: RepairSummary
    let incomplete: readonly IncompleteItem[]
    try {
        const repaired = await repairImportTree(tree, request.reader)
        if (repaired.status === 'refused') {
            return { status: 'repair-refused', refusals: repaired.refusals }
        }
        repair = repaired.summary
        notePhase(hooks, 'import repaired')
        const resolved = await resolveLegacyTree(tree, request.reader, request.resolve)
        notePhase(hooks, 'import resolved')
        applyImportOverlay(resolved.database, request)
        incomplete = resolved.incomplete
        hold.resolved = resolved
    } catch (error) {
        if (error instanceof LegacyReadError) {
            return { status: 'read-failed', error }
        }
        throw error
    }
    tree = null
    request.source.tree = null

    if (!(await confirmImportIncomplete(incomplete, hooks))) {
        return { status: 'declined' }
    }
    const env: KeyEnv = request.env ?? defaultKeyEnv
    const plan = await planResolved(hold, { lists: request.lists, env })
    if ('status' in plan) {
        return plan
    }
    notePhase(hooks, `import planned, ${plan.newUnits} units`)
    return { plan, repair }
}

export async function importLegacyTree(request: ImportRequest, hooks: ImportHooks): Promise<ImportOutcome> {
    const prepared = await prepareImport(request, hooks)
    if ('status' in prepared) {
        return prepared
    }
    const { plan, repair } = prepared

    // The base is read from the very commit-key read the commit is made over.
    let read: Store2Read
    let base: BaseManifest
    try {
        read = await request.committer.readCommit()
        base = await baseManifestOf(request.backend, read)
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'failed', cause: error }
        }
        throw error
    }
    if (base.status === 'failed') {
        return { status: 'failed', cause: base.cause }
    }
    if (base.status === 'unreadable') {
        return { status: 'base-unreadable', detail: base.detail }
    }
    const built = buildImport(plan, { base: base.status === 'ok' ? base.manifest : undefined, list: request.legacyKeep })
    notePhase(hooks, 'import commit start')
    const result = await request.committer.commit(read, { newUnits: built.newUnits, build: built.build, label: 'import', force: true, carry: IMPORT_REPLACES_BASE })
    return result.status === 'committed' ? { ...result, repair } : result
}
