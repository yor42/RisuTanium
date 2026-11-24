// The lorebook settings of a character as history drafts: the "use global settings" switch, the four flags and the two
// numbers of `LoreBookSetting.svelte`. Each builder reads the live properties through the reader it is handed and
// returns drafts; the service completes them with before values and the guard anchors, so a builder never computes
// either. The shapes written are the classic ones: a boundary flag also sets or deletes its `loreExt.risu_*` mirror,
// which the card export reads, in the same step.

import type { LiveReader } from '../history/historyModel'
import type { ObjDraft, PropValue } from '../history/objectListOps'
import type { ObjBuildResult } from '../history/ownerHistory.svelte'
import type { PropName } from '../history/objectLists'

export type LoreFlag = 'recursiveScanning' | 'fullWordMatching' | 'fullWordAsciiBoundary' | 'cjkWordStart'
export type LoreNumber = 'scanDepth' | 'tokenBudget'
export type LoreSettingsBuilder = (id: string, live: LiveReader) => ObjBuildResult

export const LORE_NUMBER_RANGE: Readonly<Record<LoreNumber, { min: number; max: number }>> = {
    scanDepth: { min: 0, max: 20 },
    tokenBudget: { min: 0, max: 4096 },
}

// The card-extension keys the export reads (`risu_fullWordAsciiBoundary`, `risu_cjkWordStart`).
export const LORE_EXT_KEY = {
    fullWordAsciiBoundary: 'risu_fullWordAsciiBoundary',
    cjkWordStart: 'risu_cjkWordStart',
} as const

const SETTINGS_LABEL = { kind: 'prop', prop: 'loreSettings' } as const
const REFUSED: ObjBuildResult = { ok: false, reason: 'precondition' }
const UNCHANGED: ObjBuildResult = { ok: false, reason: 'unchanged' }

function readProp(live: LiveReader, prop: PropName): PropValue | null {
    return live.prop?.(prop) ?? null
}

function done(drafts: ObjDraft[], coalesceKey: string | null): ObjBuildResult {
    return { ok: true, label: SETTINGS_LABEL, drafts, coalesceKey }
}

function isBoundaryFlag(flag: LoreFlag): flag is keyof typeof LORE_EXT_KEY {
    return flag === 'fullWordAsciiBoundary' || flag === 'cjkWordStart'
}

// A typed value, rounded to a whole number and held inside the field's range. Anything that is not a finite number
// (an emptied input) has no value to write.
export function clampLoreNumber(field: LoreNumber, raw: number | null): number | null {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    const range = LORE_NUMBER_RANGE[field]
    return Math.min(range.max, Math.max(range.min, Math.round(raw)))
}

// On: the character follows the app's settings, so `loreSettings` is absent. Off: it is seeded with the app's values and
// recursive scanning off, exactly those three keys. Never touches `loreExt`.
export function buildUseGlobal(on: boolean, global: { scanDepth: number; tokenBudget: number }): LoreSettingsBuilder {
    return (_id, live) => {
        const current = readProp(live, 'loreSettings')
        if (current === null) return REFUSED
        if (on) {
            return current.had ? done([{ op: 'propSet', prop: 'loreSettings', after: { had: false } }], null) : UNCHANGED
        }
        if (current.had) return REFUSED
        if (!Number.isFinite(global.scanDepth) || !Number.isFinite(global.tokenBudget)) return REFUSED
        const value = { tokenBudget: global.tokenBudget, scanDepth: global.scanDepth, recursiveScanning: false }
        return done([{ op: 'propSet', prop: 'loreSettings', after: { had: true, value } }], null)
    }
}

// A flag is a discrete switch: its step never merges with another. It never seeds `loreSettings`.
export function buildLoreFlag(flag: LoreFlag, on: boolean): LoreSettingsBuilder {
    return (_id, live) => {
        const settings = readProp(live, 'loreSettings')
        if (settings === null || !settings.had) return REFUSED
        const drafts: ObjDraft[] = [{ op: 'propSet', prop: 'loreSettings', after: { had: true, value: { ...settings.value, [flag]: on } } }]
        if (isBoundaryFlag(flag)) {
            const key = LORE_EXT_KEY[flag]
            const ext = readProp(live, 'loreExt')
            if (ext === null) return REFUSED
            if (on) {
                drafts.push({ op: 'propSet', prop: 'loreExt', after: { had: true, value: { ...(ext.had ? ext.value : {}), [key]: true } } })
            } else if (ext.had) {
                const { [key]: _removed, ...rest } = ext.value
                drafts.push({ op: 'propSet', prop: 'loreExt', after: { had: true, value: rest } })
            }
        }
        return done(drafts, null)
    }
}

// Typing coalesces per field: two fields never share a step.
export function buildLoreNumber(field: LoreNumber, raw: number | null): LoreSettingsBuilder {
    return (_id, live) => {
        const value = clampLoreNumber(field, raw)
        if (value === null) return UNCHANGED
        const settings = readProp(live, 'loreSettings')
        if (settings === null || !settings.had) return REFUSED
        return done([{ op: 'propSet', prop: 'loreSettings', after: { had: true, value: { ...settings.value, [field]: value } } }], `loreSettings:${field}`)
    }
}
