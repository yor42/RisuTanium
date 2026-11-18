// The click-time half of a merge and the pure helpers its preview shares. Nothing here reads the database, writes an
// owner or touches the page.
//
// The guarantee: `mergeAtClick` rebuilds the model from the live owner and compares it with the one the person was shown,
// and calls `apply` only when they are equal. It is synchronous end to end (no await between the rebuild, the compare
// and the write), and it reads no derived or cached "is it fresh" flag: the flag is a courtesy that disables the button
// early, this is what keeps a model the person did not see from being written.

import { language } from '../../../lang'
import type { StudioKind } from '../ownerModel'
import { ASSET_FOLDER_KEY } from './assetOwnerKeys'
import { readFolderDoc } from './folderCodec'
import type { ChatCountResult, CountQuery, EnablingCountResult } from './mergeCounts'
import { mergePreviewEquals, type AssetArrayName, type MergePreview, type ModuleSource } from './mergePreview'
import type { CloseMatchSettings } from './referenceScan'
import { enumerateTargets, parseTargetPath, type TargetOwner, type TargetPair } from './referenceTargets'

export type MergeOutcome<R> =
    | { kind: 'stale' }
    | { kind: 'applied', result: R }

/**
 * Rebuilds the model and writes it only when it equals `previewed`. `rebuild` reads the live owner; `apply` receives the
 * rebuilt model (never `previewed`), so what is written is what was just read.
 */
export function mergeAtClick<R>(previewed: MergePreview, rebuild: () => MergePreview, apply: (current: MergePreview) => R): MergeOutcome<R> {
    const current = rebuild()
    if (!mergePreviewEquals(current, previewed)) {
        return { kind: 'stale' }
    }
    return { kind: 'applied', result: apply(current) }
}

/** What the preview reads and counts. The list builds it over the live owner; a test builds it over plain data. */
export interface MergeSource {
    /** The live owner the model is built from, or null once it is gone. */
    targetOwner(): TargetOwner | null
    /** The enabled modules' rows, for a character owner's near-name lookup and the modules that hold a name. */
    modules(): readonly ModuleSource[]
    settings(): CloseMatchSettings
    /** Character owner: the chats that still name a removed name. Never rejects; an abort resolves `aborted`. `onProgress` receives the figures reached so far while it runs. */
    countChats(query: CountQuery, signal: AbortSignal, onProgress?: (partial: ChatCountResult) => void): Promise<ChatCountResult>
    /** Module owner: the characters the module is enabled for that still name a removed name. Never rejects. `onProgress` receives the figures reached so far while it runs. */
    countCharacters(query: CountQuery, signal: AbortSignal, onProgress?: (partial: EnablingCountResult) => void): Promise<EnablingCountResult>
    /** Module owner: the module is enabled for every character, by the setting or the integration list. */
    enabledEverywhere(): boolean
    characterName(chaId: string): string
}

// ---------------------------------------------------------------- the early staleness check

/** What the early check compares: every scanned text, the array's rows and the folder document, each by value. */
export interface OwnerSnapshot {
    pairs: TargetPair[]
    rows: string[][]
    folder: string
}

function rowsOf(owner: TargetOwner, array: AssetArrayName): string[][] {
    const rows = owner.kind === 'module' ? owner.source.assets : array === 'emotionImages' ? owner.source.emotionImages : owner.source.additionalAssets
    return (rows ?? []).map((row) => [...row])
}

// The folder document as the merge reads it: the listed folders and each name's folder, or the raw stored value when
// this build cannot read it. A change that moves a name's folder, or the folder order, changes the string.
function folderKeyOf(owner: TargetOwner): string {
    const stored = owner.kind === 'character' ? owner.source.extentions?.[ASSET_FOLDER_KEY] : owner.source[ASSET_FOLDER_KEY]
    const read = readFolderDoc(stored)
    return JSON.stringify(read.state === 'unreadable' ? { state: read.state, stored: stored ?? null } : { state: read.state, order: read.doc.additional.order, of: read.doc.additional.of })
}

/** Reads the live owner through its proxies, so a derived over it follows every text, row and folder entry it holds. */
export function ownerSnapshotOf(owner: TargetOwner, array: AssetArrayName): OwnerSnapshot {
    return { pairs: enumerateTargets(owner), rows: rowsOf(owner, array), folder: folderKeyOf(owner) }
}

function tuplesEqual(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i])
}

/** The ordered `(path, text)` pairs, the rows (same length, element-wise equal tuples) and the folder document all equal. */
export function ownerSnapshotsEqual(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
    return a.folder === b.folder
        && a.rows.length === b.rows.length
        && a.rows.every((row, i) => tuplesEqual(row, b.rows[i]))
        && a.pairs.length === b.pairs.length
        && a.pairs.every((pair, i) => pair.path === b.pairs[i].path && pair.text === b.pairs[i].text)
}

// ---------------------------------------------------------------- places

/** A section of the preview shows this many hits before "Show more". */
export const MERGE_PLACE_CAP = 50

function fieldLabelOf(field: string): string {
    switch (field) {
        case 'desc': return language.description
        case 'firstMessage': return language.firstMessage
        case 'exampleMessage': return language.exampleMessage
        case 'systemPrompt': return language.systemPrompt
        case 'replaceGlobalNote': return language.replaceGlobalNote
        case 'additionalText': return language.additionalText
        case 'personality': return language.personality
        case 'scenario': return language.scenario
        case 'backgroundHTML':
        case 'backgroundEmbedding': return language.backgroundHTML
        case 'defaultVariables': return language.defaultVariables
        case 'translatorNote': return language.translatorNote
        case 'creatorNotes': return language.creatorNotes
        case 'cjs': return language.charjs
        default: return field
    }
}

function nestedLabelOf(head: 'depth_prompt' | 'newGenData', field: string): string {
    if (head === 'depth_prompt') {
        return language.depthPrompt
    }
    switch (field) {
        case 'prompt': return language.imgGenPrompt
        case 'negative': return language.imgGenNegatives
        case 'instructions': return language.imgGenInstructions
        case 'emotionInstructions': return language.emotionInstructions
        default: return field
    }
}

/** The words that name a registry target: the field's own label, or the kind's label with a 1-based index. */
export function placeLabelOf(ownerKind: 'character' | 'module', path: string): string {
    const parsed = parseTargetPath(ownerKind, path)
    if (parsed === null) {
        return path
    }
    if ('greeting' in parsed) {
        return language.studioAssetPlaceAltFirstMessage(parsed.greeting + 1)
    }
    if ('trigger' in parsed) {
        const make = parsed.section === 'effect' ? language.studioAssetPlaceTriggerEffect : language.studioAssetPlaceTriggerCondition
        return make(language.triggerScript, parsed.trigger + 1, parsed.entry + 1, parsed.field)
    }
    if ('entry' in parsed) {
        return language.studioAssetPlaceNumbered(parsed.entry === 'lore' ? language.loreBook : language.regexScript, parsed.index + 1)
    }
    if ('nested' in parsed) {
        return nestedLabelOf(parsed.nested, parsed.field)
    }
    return fieldLabelOf(parsed.field)
}

export interface JumpTarget {
    kind: StudioKind
    itemId: string
}

/**
 * The Studio kind and item that hold a registry target: lore and regex entries by index, the scripts item for a
 * trigger, the html item for the background text, the basic item for the description and first messages, and the
 * advanced item for every other field. Null for a path that is no registry address.
 */
export function jumpTargetOf(ownerKind: 'character' | 'module', ownerId: string, path: string): JumpTarget | null {
    const parsed = parseTargetPath(ownerKind, path)
    if (parsed === null) {
        return null
    }
    const at = (kind: StudioKind, index: number): JumpTarget => ({ kind, itemId: `${ownerId}/${kind}:${index}` })
    if ('greeting' in parsed) {
        return at('basic', 0)
    }
    if ('trigger' in parsed) {
        return at('scripts', 0)
    }
    if ('entry' in parsed) {
        return at(parsed.entry, parsed.index)
    }
    if ('nested' in parsed) {
        return at('advanced', 0)
    }
    switch (parsed.field) {
        case 'desc':
        case 'firstMessage': return at('basic', 0)
        case 'backgroundHTML':
        case 'backgroundEmbedding': return at('html', 0)
        default: return at('advanced', 0)
    }
}

export interface PlaceGroup<T> {
    path: string
    items: T[]
}

/** The items grouped by place, places in order of their first item and items in their own order. */
export function groupByPlace<T extends { path: string }>(items: readonly T[]): PlaceGroup<T>[] {
    const groups = new Map<string, PlaceGroup<T>>()
    for (const item of items) {
        const group = groups.get(item.path)
        if (group) {
            group.items.push(item)
        } else {
            groups.set(item.path, { path: item.path, items: [item] })
        }
    }
    return [...groups.values()]
}

// ---------------------------------------------------------------- counts

export interface ConfirmFacts {
    /** The characters whose own text or resident chats still name a removed name, with their hit counts. */
    hits: { chaId: string, count: number }[]
    /** Cold-stub characters that were not read. */
    archived: number
    /** The scan ended with every character read: a failed or aborted scan, or none yet, is not finished. */
    finished: boolean
}

/** What the module confirm lists and decides on. A scan that has not answered is an unfinished one with nothing found. */
export function confirmFactsOf(result: EnablingCountResult | null): ConfirmFacts {
    if (result === null) {
        return { hits: [], archived: 0, finished: false }
    }
    const hits = result.characters
        .map((entry) => ({ chaId: entry.chaId, count: entry.textHits + entry.chatHits }))
        .filter((entry) => entry.count > 0)
    return { hits, archived: result.archivedCharacters, finished: result.state === 'done' }
}

/** The module merge opens its confirm for any hit, any archived character or a scan that has not finished. */
export function needsConfirm(facts: ConfirmFacts): boolean {
    return !facts.finished || facts.hits.length > 0 || facts.archived > 0
}

/**
 * The second line of the merge toast for a character owner: the chats that still mention a removed name, "at least n"
 * while the count has not finished, and the archived chats that were not read. Absent for a module owner and when there
 * is nothing to say.
 */
export function mergeToastLine(ownerKind: 'character' | 'module', names: readonly string[], count: ChatCountResult | null): string | undefined {
    if (ownerKind !== 'character') {
        return undefined
    }
    const old = names.join(', ')
    const found = count?.chats ?? 0
    const lines: string[] = []
    if (count?.state !== 'done') {
        lines.push(language.studioAssetMergeChats(language.studioAssetMergeAtLeast(found), old))
    } else if (found > 0) {
        lines.push(language.studioAssetMergeChats(found, old))
    }
    const archived = count?.archivedChats ?? 0
    if (archived > 0) {
        lines.push(language.studioAssetMergeArchivedChats(archived))
    }
    return lines.length === 0 ? undefined : lines.join(' ')
}
