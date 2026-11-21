import { language } from '../../lang'
import { fillLang } from '../../lang/fill'
import { safeStructuredClone } from '../polyfill'
import { shareSafePreset } from '../shareStrip'
import type { botPreset, Database } from './database.svelte'
import { createPresetFolder, presetFolderOf, withoutPresetMeta } from './presetMeta'

/**
 * A preset bundle is the payload of a `.risup` envelope whose `type` is `presetBundle`. Every entry is what a single
 * export writes (share-stripped, without id, folder id and slot); folders travel as names only. Nothing here imports a
 * value from `database.svelte`, so the module loads unchanged in every harness that replaces it.
 */
export const PRESET_BUNDLE_TYPE = 'presetBundle'
export const PRESET_BUNDLE_FORMAT = 1
export const MAX_BUNDLE_PRESETS = 1000
/** UTF-16 length of the longest folder name a bundle carries. */
export const MAX_BUNDLE_FOLDER_NAME = 200
/** The answer of the preview prompt that imports nothing. */
export const PRESET_BUNDLE_CANCEL = 'cancel'

export interface PresetBundleEntry {
    preset: botPreset
    folder?: string
}

export interface PresetBundlePayload {
    format: typeof PRESET_BUNDLE_FORMAT
    presets: PresetBundleEntry[]
}

/** One preset of a parsed bundle: the untrusted preset object plus the values the preview shows. */
export interface BundleRow {
    preset: Record<string, unknown>
    name: string
    folder: string | null
    aiModel: string
}

export interface ParsedBundle {
    rows: BundleRow[]
}

/** A refusal the person can read; the message is already in their language. */
export class PresetBundleError extends Error {}

/** Turns an untrusted preset object into one with the single-import trust rule applied. */
export type PresetBundleIntake = (raw: Record<string, unknown>) => Promise<botPreset>

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tooMany(): PresetBundleError {
    return new PresetBundleError(fillLang(language.errors.presetBundleTooMany, { max: MAX_BUNDLE_PRESETS }))
}

/** The longest prefix of `name` within the folder-name cap that ends on a whole code point. */
function cutFolderName(name: string): string {
    if (name.length <= MAX_BUNDLE_FOLDER_NAME) {
        return name
    }
    let cut = ''
    for (const point of name) {
        if (cut.length + point.length > MAX_BUNDLE_FOLDER_NAME) {
            break
        }
        cut += point
    }
    return cut
}

/**
 * The payload of `presets`, in the given order. Each preset is cloned, stripped of its meta and share-stripped in the
 * order `downloadPreset` uses, so a bundle entry equals a single export. Every payload this builds passes
 * `parsePresetBundlePayload`.
 */
export function buildPresetBundlePayload(db: Pick<Database, 'presetFolders'>, presets: botPreset[]): PresetBundlePayload {
    if (presets.length > MAX_BUNDLE_PRESETS) {
        throw tooMany()
    }
    const entries: PresetBundleEntry[] = presets.map((p) => {
        const folderName = presetFolderOf(db, p)?.name
        const exported = shareSafePreset(withoutPresetMeta(safeStructuredClone(p)))
        const entry: PresetBundleEntry = { preset: exported }
        const folder = typeof folderName === 'string' ? cutFolderName(folderName) : ''
        if (folder !== '') {
            entry.folder = folder
        }
        return entry
    })
    return { format: PRESET_BUNDLE_FORMAT, presets: entries }
}

/**
 * Validates an untrusted decoded payload as a whole. Any failure refuses the bundle, so nothing is written for a
 * bundle with a bad entry among good ones.
 */
export function parsePresetBundlePayload(inner: unknown): ParsedBundle {
    const invalid = () => new PresetBundleError(language.errors.presetBundleInvalid)
    if (!isPlainObject(inner) || inner.format !== PRESET_BUNDLE_FORMAT || !Array.isArray(inner.presets)) {
        throw invalid()
    }
    if (inner.presets.length < 1) {
        throw invalid()
    }
    if (inner.presets.length > MAX_BUNDLE_PRESETS) {
        throw tooMany()
    }
    const rows: BundleRow[] = []
    for (const entry of inner.presets as unknown[]) {
        if (!isPlainObject(entry) || !isPlainObject(entry.preset)) {
            throw invalid()
        }
        const folder = entry.folder
        if (folder !== undefined && folder !== null && (typeof folder !== 'string' || folder.length > MAX_BUNDLE_FOLDER_NAME)) {
            throw invalid()
        }
        const preset = entry.preset
        rows.push({
            preset,
            name: typeof preset.name === 'string' ? preset.name : 'Imported',
            folder: typeof folder === 'string' && folder !== '' ? folder : null,
            aiModel: typeof preset.aiModel === 'string' ? preset.aiModel : '',
        })
    }
    return { rows }
}

/**
 * The name each ticked row lands under, null for an unticked row. A name already taken, by an existing preset or by a
 * ticked row earlier in the bundle, becomes `name (n)` with the first free n from 2. The preview and the commit share
 * this function, so the names shown are the names written.
 */
export function planPresetNames(existing: readonly string[], rowNames: readonly string[], ticked: readonly boolean[]): (string | null)[] {
    const taken = new Set(existing)
    return rowNames.map((base, i) => {
        if (!ticked[i]) {
            return null
        }
        let name = base
        for (let n = 2; taken.has(name); n++) {
            name = `${base} (${n})`
        }
        taken.add(name)
        return name
    })
}

/**
 * The ticked indices an answer of the preview prompt names: a non-empty JSON array of distinct in-range integers. Cancel, a malformed answer and an empty selection all return null, which imports nothing.
 */
export function parsePresetBundleAnswer(answer: string, count: number): number[] | null {
    if (answer === PRESET_BUNDLE_CANCEL) {
        return null
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(answer)
    } catch {
        return null
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
        return null
    }
    const seen = new Set<number>()
    for (const index of parsed as unknown[]) {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count || seen.has(index)) {
            return null
        }
        seen.add(index)
    }
    return [...seen]
}

/**
 * Appends the ticked rows to `getDb().botPresets`, never replacing a preset. Every ticked row runs through `intake`
 * first; names, folders and pushes happen only after all intakes resolved, so a failing intake writes no preset and no
 * folder. A folder resolves to the first folder of that exact name, else one is created, so a name makes at most one folder. The
 * database is read after the intakes, because the answer to the preview may take any time and a restore replaces it.
 * Returns how many presets were added.
 */
export async function commitPresetBundle(
    getDb: () => Pick<Database, 'botPresets' | 'presetFolders'>,
    parsed: ParsedBundle,
    ticked: readonly boolean[],
    intake: PresetBundleIntake,
): Promise<number> {
    const chosen = parsed.rows.filter((_, i) => ticked[i] === true)
    const staged: botPreset[] = []
    for (const row of chosen) {
        staged.push(await intake(structuredClone(row.preset)))
    }
    const db = getDb()
    if (!Array.isArray(db.botPresets)) {
        db.botPresets = []
    }
    const existing = db.botPresets.map((p) => p?.name).filter((name): name is string => typeof name === 'string')
    const names = planPresetNames(existing, chosen.map((row) => row.name), chosen.map(() => true))
    staged.forEach((preset, i) => {
        preset.name = names[i] ?? chosen[i].name
        const folder = chosen[i].folder
        if (folder === null) {
            return
        }
        //A folder created for an earlier row is found by name, so one name makes one folder.
        preset.folderId = (db.presetFolders ?? []).find((candidate) => candidate.name === folder)?.id ?? createPresetFolder(db, folder)
    })
    db.botPresets.push(...staged)
    return staged.length
}
