import type { toSaveType } from "./risuSave"
import { MEASURE } from "../process/memory/measureFlag"
import { noteSignal } from "./netSignalMeter"
import { isUsableCharacterId } from "./characterIds"

/**
 * Fork-specific internal API (CHORE-01). The maintainer's chosen design only
 * auto-tracks the selected character plus whole-array/element replacement
 * (the identity tracker in dbChangeEffects.svelte.ts) -- every other writer
 * that mutates a non-selected character in place must call
 * `markCharacterForSave(chaId)` explicitly so the
 * next save actually re-encodes it.
 */

/** Requests a save; the concrete meaning depends on what saveDb() has installed. */
export type CharacterSaveMarkScheduler = () => void

export interface CharacterSaveMarksTarget {
    tracker: toSaveType
    schedule: CharacterSaveMarkScheduler
}

let installed: CharacterSaveMarksTarget | null = null

// Marks requested before saveDb() has installed anything are queued here
// instead of being silently dropped. In production this window should never
// be reached (saveDb() installs before its first `await`, and it has exactly
// one, un-awaited caller), but the queue exists so a mark can
// never race the install and vanish, and so tests that call
// `markCharacterForSave` before installing anything don't lose it either.
const pendingQueue = new Set<string>()

type SettingsFlag = 'botPreset' | 'modules' | 'loadouts' | 'plugins' | 'pluginCustomStorage'

// The explicit write hook's counterpart of `pendingQueue`: settings flags requested after a first install and while
// nothing is installed. Before the very first install the hook's marks are dropped instead (see `markDbWrite`).
const pendingFlags = new Set<SettingsFlag>()
let everInstalled = false

// The tracker flag a top-level `db` key sets. Every other key lives in the root block, which every pass encodes.
const SETTINGS_FLAG_OF_KEY: Readonly<Record<string, SettingsFlag>> = {
    botPresets: 'botPreset',
    botPresetsId: 'botPreset',
    modules: 'modules',
    loadouts: 'loadouts',
    plugins: 'plugins',
    pluginCustomStorage: 'pluginCustomStorage',
}
const ALL_SETTINGS_FLAGS: readonly SettingsFlag[] = ['botPreset', 'modules', 'loadouts', 'plugins', 'pluginCustomStorage']

/**
 * What the explicit write hook (dbWriteHook.ts) reports for one `DBState` write.
 * - `owner`: a write under this character's unit.
 * - `placed`: a value was just put into the list as a new character; `id` is its `chaId`, which may be unusable.
 * - `setting`: a write under this top-level `db` key.
 * - `listShape`: the character list changed shape at key `prop` (a move, a truncation, a placement with no usable id).
 * - `listWhole`: the whole character list was replaced.
 * - `root`: a write on the root object itself; replacing `db` marks every settings block.
 * - `fallback`: a write the hook could not pin to a character (`cause`); `id` is the selected character's id, when known.
 */
export type DbWriteMark =
    | { kind: 'owner', id: string | number }
    | { kind: 'placed', id: unknown }
    | { kind: 'setting', key: string }
    | { kind: 'listShape', prop: string }
    | { kind: 'listWhole' }
    | { kind: 'root', prop: string }
    | { kind: 'fallback', cause: 'noCharId' | 'error', id?: unknown }

/**
 * Appends `id` to `tracker.character` at the end, only if it is not already
 * present. Shared by `markCharacterForSave` and the identity tracker effect
 * (dbChangeEffects.svelte.ts) -- both need the exact same "append once, at
 * the end, never displace the sticky front" rule.
 */
export function appendIfAbsent(tracker: toSaveType, id: string): void {
    if (!tracker.character.includes(id)) {
        tracker.character.push(id)
    }
}

/**
 * The one rule for which ids a mark may name: any non-empty string (store2 saves every string as a legal handle,
 * reserved and oversized ones included), or a number that passes `isUsableCharacterId`. Refuses 0, -0, NaN,
 * +/-Infinity, '' and every non-string.
 */
function isMarkableId(id: unknown): id is string | number {
    if (typeof id === 'number') {
        return isUsableCharacterId(id)
    }
    return typeof id === 'string' && id !== ''
}

/**
 * Marks a character for save. No-op for a falsy or non-string id that is not
 * a usable number, so callers can pass `char?.chaId` straight through without
 * their own guard. A usable number is queued as the raw number: the legacy
 * loop's no-reload filter compares marks with the raw chaId. Before
 * `installCharacterSaveMarks` has run, the id is queued rather than dropped
 * (see `pendingQueue` above).
 */
export function markCharacterForSave(chaId: unknown): void {
    if (!isMarkableId(chaId)) {
        return
    }
    // toSave.character is declared string[] but holds raw chaIds, numbers included.
    const id = chaId as string
    if (MEASURE) {
        noteSignal('api', String(id))
    }
    if (!installed) {
        pendingQueue.add(id)
        return
    }
    appendIfAbsent(installed.tracker, id)
    installed.schedule()
}

/**
 * Applies one mark of the explicit write hook. A character id is one `isMarkableId` accepts, the same rule
 * `markCharacterForSave` applies; any other id marks no character, but the mark still schedules. The tracker's declared
 * `string[]` holds the raw id at runtime, as `frontUnshiftSelected` already does, and consumers that compare by string
 * (the legacy `RisuSaveEncoder.set`, `String(m)`) or key a usable number (store2 `marksOf`) see it.
 * Every mark ends in exactly one `schedule()`.
 *
 * Before the first `installCharacterSaveMarks` nothing is applied: the base page has no marks then either, and a
 * boot load that runs before the save wiring must not raise a save. After a first install, a mark made while
 * nothing is installed is queued like `markCharacterForSave`'s.
 */
export function markDbWrite(mark: DbWriteMark): void {
    if (!installed && !everInstalled) {
        return
    }
    let id: string | number | undefined
    let flags: readonly SettingsFlag[] = []
    switch (mark.kind) {
        case 'owner':
        case 'placed':
            if (isMarkableId(mark.id)) id = mark.id
            break
        case 'setting': {
            const flag = SETTINGS_FLAG_OF_KEY[mark.key]
            if (flag !== undefined) flags = [flag]
            break
        }
        case 'root':
            if (mark.prop === 'db') flags = ALL_SETTINGS_FLAGS
            break
        case 'fallback':
            if (isMarkableId(mark.id)) id = mark.id
            break
        case 'listShape':
        case 'listWhole':
            break
    }
    if (MEASURE && id !== undefined) {
        noteSignal('api', String(id))
    }
    // The queue and the tracker hold raw chaIds, numbers included, though both are declared string-typed.
    const rawId = id as string | undefined
    if (!installed) {
        if (rawId !== undefined) pendingQueue.add(rawId)
        for (const flag of flags) pendingFlags.add(flag)
        return
    }
    if (rawId !== undefined) {
        appendIfAbsent(installed.tracker, rawId)
    }
    for (const flag of flags) {
        installed.tracker[flag] = true
    }
    installed.schedule()
}

/**
 * Installs (or re-installs, to swap the scheduler) the tracker/scheduler pair
 * that `markCharacterForSave` writes into. Draining the pre-install queue on
 * every install is harmless when the queue is already empty (the common,
 * re-install case in saveDb()'s boot sequence).
 */
export function installCharacterSaveMarks(opts: CharacterSaveMarksTarget): void {
    installed = opts
    everInstalled = true
    if (pendingQueue.size > 0 || pendingFlags.size > 0) {
        for (const id of pendingQueue) {
            appendIfAbsent(opts.tracker, id)
        }
        pendingQueue.clear()
        for (const flag of pendingFlags) {
            opts.tracker[flag] = true
        }
        pendingFlags.clear()
        opts.schedule()
    }
}

/** Uninstalls the current tracker/scheduler, so a later mark is queued again. */
export function uninstallCharacterSaveMarks(): void {
    installed = null
}

/**
 * Test-only: clears both the installed tracker/scheduler and any queued
 * marks, so tests never leak marks into each other.
 */
export function resetCharacterSaveMarksForTest(): void {
    installed = null
    pendingQueue.clear()
    pendingFlags.clear()
    everInstalled = false
}
