/**
 * Pure rules for the "reload first" offer before a backup export on Android: when to ask, what survives the
 * reload (a short-lived resume note) and what the person's "No" remembers. Everything here takes its inputs as
 * arguments, so the rules can be tested without a page.
 */

/** Ask when the library holds more characters or modules than these. */
export const RELOAD_FIRST_MIN_CHARACTERS = 100
export const RELOAD_FIRST_MIN_MODULES = 30

/** Key of the note that makes the page open the save dialog once after the reload. */
export const RESUME_NOTE_KEY = 'risu-reload-first-resume'
/** A note older than this is dropped unused. */
export const RESUME_NOTE_MAX_AGE_MS = 120_000
/** Key of the person's "No, continue without reloading"; it lasts until the app is closed. */
export const DECLINED_KEY = 'risu-reload-first-declined'

export const RESUME_OPS = ['export-full', 'export-partial'] as const
export type ResumeOp = typeof RESUME_OPS[number]

type NoteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface WorkProbes {
    /** Typed text no save has seen yet (composer, message editors). */
    drafts: boolean
    /** A chat, request, image, tts, embed or busy action is running. */
    inFlight: boolean
    /** A busy action is registered. */
    busy: boolean
    /** An asset, inlay, cold-storage or plugin-bridge write is running. */
    chokePoint: boolean
    /** The save loop is parked on a commit it did not make. */
    parked: boolean
}

/** True when a reload now would cut something off. */
export function workBlocksReload(probes: WorkProbes): boolean {
    return probes.drafts || probes.inFlight || probes.busy || probes.chokePoint || probes.parked
}

export interface SessionUse {
    characterOpened: boolean
    chatSeen: boolean
    marksNow: number
    marksAtReady: number
}

/** Whether the person has done anything since the app started: opened a character, run a chat or made an edit. */
export function hasUsedSinceLaunch(use: SessionUse): boolean {
    return use.characterOpened || use.chatSeen || use.marksNow > use.marksAtReady
}

export interface AskInputs {
    android: boolean
    storeMode: string
    used: boolean
    characters: number
    modules: number
    declined: boolean
    /** Whether `workBlocksReload` is true, or a whole save cannot be asked for. */
    workInFlight: boolean
}

/** Whether to offer the reload before an export. Only an Android page on store2 that was used and holds a large library is asked. */
export function shouldAskReloadFirst(input: AskInputs): boolean {
    if (!input.android || input.storeMode !== 'store2') {
        return false
    }
    if (input.declined || input.workInFlight) {
        return false
    }
    return input.used && (input.characters > RELOAD_FIRST_MIN_CHARACTERS || input.modules > RELOAD_FIRST_MIN_MODULES)
}

export function makeResumeNote(op: ResumeOp, nowMs: number): string {
    return JSON.stringify({ v: 1, op, at: nowMs })
}

function isResumeOp(value: unknown): value is ResumeOp {
    return typeof value === 'string' && (RESUME_OPS as readonly string[]).includes(value)
}

/** The operation a stored note names, or null when it is malformed, of another version, unknown, from the future or too old. */
export function parseResumeNote(raw: unknown, nowMs: number): ResumeOp | null {
    if (typeof raw !== 'string') {
        return null
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return null
    }
    const note = parsed as { v?: unknown, op?: unknown, at?: unknown }
    if (note.v !== 1 || !isResumeOp(note.op)) {
        return null
    }
    if (typeof note.at !== 'number' || !Number.isInteger(note.at)) {
        return null
    }
    const age = nowMs - note.at
    if (age < 0 || age > RESUME_NOTE_MAX_AGE_MS) {
        return null
    }
    return note.op
}

/** Reads the note and removes it before answering, so it runs at most once even when it is stale or corrupt. */
export function takeResumeNote(storage: Pick<Storage, 'getItem' | 'removeItem'> | null, nowMs: number): ResumeOp | null {
    if (storage === null) {
        return null
    }
    try {
        const raw = storage.getItem(RESUME_NOTE_KEY)
        if (raw === null) {
            return null
        }
        storage.removeItem(RESUME_NOTE_KEY)
        return parseResumeNote(raw, nowMs)
    } catch {
        return null
    }
}

/** Writes the note and reads it back; false when the storage is missing, throws or does not keep the value. */
export function writeResumeNote(storage: NoteStorage | null, op: ResumeOp, nowMs: number): boolean {
    if (storage === null) {
        return false
    }
    try {
        const note = makeResumeNote(op, nowMs)
        storage.setItem(RESUME_NOTE_KEY, note)
        return storage.getItem(RESUME_NOTE_KEY) === note
    } catch {
        return false
    }
}

/** Removes the note; false when the storage refused. */
export function clearResumeNote(storage: Pick<Storage, 'removeItem'> | null): boolean {
    if (storage === null) {
        return false
    }
    try {
        storage.removeItem(RESUME_NOTE_KEY)
        return true
    } catch {
        return false
    }
}

export function readDeclined(storage: Pick<Storage, 'getItem'> | null): boolean {
    if (storage === null) {
        return false
    }
    try {
        return storage.getItem(DECLINED_KEY) === '1'
    } catch {
        return false
    }
}

export function writeDeclined(storage: Pick<Storage, 'setItem'> | null): boolean {
    if (storage === null) {
        return false
    }
    try {
        storage.setItem(DECLINED_KEY, '1')
        return true
    } catch {
        return false
    }
}
