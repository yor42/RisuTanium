// The stored record of an installed theme pack (layout A: one stored archive per pack), its reader, and the input the
// install needs from a verified pack. The record lives under `Database.themePacks` as plain data; a build that cannot
// read an entry keeps it untouched (an unreadable or newer-version entry is shown as broken and can only be removed).
import { PACK_ARCHIVE_KEY } from './packRefs'

export type PackMode = 'light' | 'dark'

export interface PackFontEntry {
    file: string
    license: string
    attribution?: string
}

/**
 * What the install needs from a verified pack. `packId` is the manifest's optional "id": it is a required key of type
 * `string | undefined` here and in the intake's manifest type, so a rename on either side is a compile error where the
 * two meet.
 */
export interface PackManifestFields {
    packId: string | undefined
    name: string
    version: string
    license: string
    attribution: string
    modes: readonly PackMode[]
    fonts: readonly PackFontEntry[]
}

/** Stored record, layout A. Persisted under `Database.themePacks`; never rewritten by a build that cannot read it. */
export interface ThemePackRecordV1 {
    v: 1
    id: string
    packId?: string
    name: string
    version: string
    license: string
    attribution: string
    modes: PackMode[]
    fonts: PackFontEntry[]
    archive: string
    bytes: number
    installedAt: number
}

export type PackReadFailure = 'notAnObject' | 'unknownVersion' | 'badField'
export type PackReadResult = { ok: true, record: ThemePackRecordV1 } | { ok: false, reason: PackReadFailure, field?: string }

function isRecordObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value !== ''
}

function badField(field: string): PackReadResult {
    return { ok: false, reason: 'badField', field }
}

function readFonts(value: unknown): PackFontEntry[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const fonts: PackFontEntry[] = []
    for (const item of value as unknown[]) {
        if (!isRecordObject(item)) {
            return null
        }
        const file = item.file
        const license = item.license
        const attribution = item.attribution
        if (typeof file !== 'string' || !file.startsWith('fonts/') || !isNonEmptyString(license)) {
            return null
        }
        if (attribution !== undefined && typeof attribution !== 'string') {
            return null
        }
        const font: PackFontEntry = { file, license }
        if (typeof attribution === 'string') {
            font.attribution = attribution
        }
        fonts.push(font)
    }
    return fonts
}

function readModes(value: unknown): PackMode[] | null {
    if (!Array.isArray(value) || value.length === 0) {
        return null
    }
    const modes: PackMode[] = []
    for (const item of value as unknown[]) {
        if ((item !== 'light' && item !== 'dark') || modes.includes(item)) {
            return null
        }
        modes.push(item)
    }
    return modes
}

/**
 * Reads a stored value by explicit field reads into a new object. Extra keys are ignored (they stay in storage), an
 * optional key that is absent or an own `undefined` reads as absent, and `archive` must be the one key form an install
 * writes, so a crafted record cannot point at a user's asset. The reader is never stricter than the intake: `packId` is
 * any non-empty string here. It never mutates `value`.
 */
export function readPackRecord(value: unknown): PackReadResult {
    if (!isRecordObject(value)) {
        return { ok: false, reason: 'notAnObject' }
    }
    if (value.v !== 1) {
        return { ok: false, reason: 'unknownVersion' }
    }
    const { id, name, version, license, attribution, packId, archive, bytes, installedAt } = value
    if (!isNonEmptyString(id)) {
        return badField('id')
    }
    if (!isNonEmptyString(name)) {
        return badField('name')
    }
    if (!isNonEmptyString(version)) {
        return badField('version')
    }
    if (!isNonEmptyString(license)) {
        return badField('license')
    }
    if (!isNonEmptyString(attribution)) {
        return badField('attribution')
    }
    // Absent and an own undefined both read as absent; anything else must be a non-empty string.
    if (packId !== undefined && !isNonEmptyString(packId)) {
        return badField('packId')
    }
    const readPackId: string | undefined = typeof packId === 'string' ? packId : undefined
    const modes = readModes(value.modes)
    if (modes === null) {
        return badField('modes')
    }
    const fonts = readFonts(value.fonts)
    if (fonts === null) {
        return badField('fonts')
    }
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
        return badField('bytes')
    }
    if (typeof installedAt !== 'number' || !Number.isFinite(installedAt)) {
        return badField('installedAt')
    }
    if (typeof archive !== 'string' || !PACK_ARCHIVE_KEY.test(archive)) {
        return badField('archive')
    }
    const record: ThemePackRecordV1 = { v: 1, id, name, version, license, attribution, modes, fonts, archive, bytes, installedAt }
    if (readPackId !== undefined) {
        record.packId = readPackId
    }
    return { ok: true, record }
}

export interface PackListEntry {
    index: number
    entry: unknown
    read: PackReadResult
}

/**
 * Every entry of `themePacks` in order, readable or not. `entry` is the value as stored (the live proxy when given the
 * live list, never a copy); `[]` when the value is absent or not an array.
 */
export function listThemePacks(themePacks: unknown): PackListEntry[] {
    if (!Array.isArray(themePacks)) {
        return []
    }
    const entries: PackListEntry[] = []
    for (let index = 0; index < themePacks.length; index++) {
        const entry: unknown = themePacks[index]
        entries.push({ index, entry, read: readPackRecord(entry) })
    }
    return entries
}
