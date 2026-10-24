import type { toSaveType } from "./risuSave"
import { MEASURE } from "../process/memory/measureFlag"
import { noteSignal } from "./netSignalMeter"

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
 * Marks a character for save. No-op for a falsy or non-string id, so callers
 * can pass `char?.chaId` straight through without their own guard. Before
 * `installCharacterSaveMarks` has run, the id is queued rather than dropped
 * (see `pendingQueue` above).
 */
export function markCharacterForSave(chaId: unknown): void {
    if (!chaId || typeof chaId !== 'string') {
        return
    }
    if (MEASURE) {
        noteSignal('api', chaId)
    }
    if (!installed) {
        pendingQueue.add(chaId)
        return
    }
    appendIfAbsent(installed.tracker, chaId)
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
    if (pendingQueue.size > 0) {
        for (const id of pendingQueue) {
            appendIfAbsent(opts.tracker, id)
        }
        pendingQueue.clear()
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
}
