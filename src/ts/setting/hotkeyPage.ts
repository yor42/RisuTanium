import { defaultHotkeys, type Hotkey } from '../defaulthotkeys'
import { chordsEqual, type Chord } from '../hotkeyChord'
import type { UndoAction } from '../toast/toastHost.svelte'

/**
 * The rules of the Shortcuts page, apart from the component. Live rows come in as arguments; this module reads no
 * store. Rows are written in place so the generic deep effect over `hotkeys` still sees every change.
 */

export interface HotkeyGroup {
    id: 'msg' | 'nav' | 'tools'
    actions: readonly string[]
}

export const HOTKEY_GROUPS: readonly HotkeyGroup[] = [
    { id: 'msg', actions: ['reroll', 'unreroll', 'translate', 'remove', 'edit', 'copy', 'send'] },
    { id: 'nav', actions: ['settings', 'home', 'presets', 'persona', 'prevChar', 'nextChar', 'quickMenu', 'quickSettings', 'loadout', 'focusInput', 'scrollToActiveChar'] },
    { id: 'tools', actions: ['toggleCSS', 'toggleLog', 'previewRequest', 'popupEditor'] },
]

export interface FixedRow {
    action: 'esc' | 'enter'
    chord: Chord
}

export const FIXED_ROWS: readonly FixedRow[] = [
    { action: 'esc', chord: { key: 'Escape', ctrl: false, alt: false, shift: false } },
    { action: 'enter', chord: { key: 'Enter', ctrl: false, alt: false, shift: false } },
]

export const EMPTY_CHORD: Readonly<Chord> = Object.freeze({ key: '', ctrl: false, alt: false, shift: false })

export function rowChord(row: Hotkey): Chord {
    return { key: row.key ?? '', ctrl: !!row.ctrl, alt: !!row.alt, shift: !!row.shift }
}

function exactlyEqual(a: Chord, b: Chord): boolean {
    return a.key === b.key && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift
}

/** The rows the page lists: the first row of each allowlisted action, in group order. Hidden and unknown actions are left out. */
export function listedRows(rows: readonly Hotkey[], options: { scrollToActiveChar: boolean }): Hotkey[] {
    const listed: Hotkey[] = []
    for (const group of HOTKEY_GROUPS) {
        for (const action of group.actions) {
            if (action === 'scrollToActiveChar' && !options.scrollToActiveChar) {
                continue
            }
            const row = rows.find((candidate) => candidate.action === action)
            if (row) {
                listed.push(row)
            }
        }
    }
    return listed
}

/** Keys that no row may take: Esc, Enter and, until the preset slots are rows, Ctrl+1..9. */
export function fixedChordFor(chord: Chord): Chord | null {
    for (const fixed of FIXED_ROWS) {
        if (chordsEqual(fixed.chord, chord)) {
            return fixed.chord
        }
    }
    if (chord.ctrl && !chord.alt && !chord.shift && /^[1-9]$/.test(chord.key)) {
        return chord
    }
    return null
}

export type Conflict =
    | { kind: 'action', action: string, otherOld: Chord }
    | { kind: 'fixed', chord: Chord }

/** `otherOld` is the chord this action holds now, which a swap hands to the other action. */
export function findConflict(listed: readonly Hotkey[], action: string, chord: Chord): Conflict | null {
    const fixed = fixedChordFor(chord)
    if (fixed) {
        return { kind: 'fixed', chord: fixed }
    }
    const own = listed.find((row) => row.action === action)
    const otherOld = own ? rowChord(own) : { ...EMPTY_CHORD }
    for (const row of listed) {
        if (row.action !== action && chordsEqual(rowChord(row), chord)) {
            return { kind: 'action', action: row.action, otherOld }
        }
    }
    return null
}

export interface DuplicateInfo {
    /** Distinct chords held by two or more listed rows. */
    count: number
    /** For each action that shares its chord, the other actions on it. */
    partners: Map<string, string[]>
}

export function duplicateGroups(listed: readonly Hotkey[]): DuplicateInfo {
    const partners = new Map<string, string[]>()
    const seen = new Set<Hotkey>()
    let count = 0
    for (const row of listed) {
        if (seen.has(row)) {
            continue
        }
        const chord = rowChord(row)
        const same = listed.filter((other) => chordsEqual(rowChord(other), chord))
        if (same.length < 2) {
            continue
        }
        count++
        for (const member of same) {
            seen.add(member)
            partners.set(member.action, same.filter((other) => other !== member).map((other) => other.action))
        }
    }
    return { count, partners }
}

export function defaultChordOf(action: string): Chord | null {
    const base = defaultHotkeys.find((entry) => entry.action === action)
    return base ? rowChord(base) : null
}

export function isChanged(row: Hotkey): boolean {
    const base = defaultChordOf(row.action)
    if (!base) {
        return false
    }
    const current = rowChord(row)
    return current.key.toLowerCase() !== base.key.toLowerCase() ||
        current.ctrl !== base.ctrl || current.alt !== base.alt || current.shift !== base.shift
}

export interface PlanStep {
    action: string
    before: Chord
    after: Chord
}

function stepFor(row: Hotkey, after: Chord): PlanStep {
    return { action: row.action, before: rowChord(row), after: { ...after } }
}

export function planSet(row: Hotkey, chord: Chord): PlanStep[] {
    return [stepFor(row, chord)]
}

/** This action takes the chord and the other action takes this action's old chord (unbound when that was empty). */
export function planSwap(row: Hotkey, other: Hotkey, chord: Chord): PlanStep[] {
    const old = rowChord(row)
    return [stepFor(row, chord), stepFor(other, old.key ? old : EMPTY_CHORD)]
}

export function planUnbind(row: Hotkey): PlanStep[] {
    return [stepFor(row, EMPTY_CHORD)]
}

export function planReset(row: Hotkey): PlanStep[] {
    const base = defaultChordOf(row.action)
    return base ? [stepFor(row, base)] : []
}

/** Listed rows that differ from their default; hidden rows keep their values. */
export function planResetAll(listed: readonly Hotkey[]): PlanStep[] {
    const steps: PlanStep[] = []
    for (const row of listed) {
        if (isChanged(row)) {
            steps.push(...planReset(row))
        }
    }
    return steps
}

function writeChord(row: Hotkey, chord: Chord): void {
    row.key = chord.key
    row.ctrl = chord.ctrl
    row.alt = chord.alt
    row.shift = chord.shift
}

/** Writes the `after` side of every step in place on the live rows. Returns false when a row is gone. */
export function applyPlan(rows: readonly Hotkey[], plan: readonly PlanStep[]): boolean {
    const targets = plan.map((step) => rows.find((row) => row.action === step.action))
    if (targets.some((row) => !row)) {
        return false
    }
    plan.forEach((step, at) => writeChord(targets[at]!, step.after))
    return true
}

let undoCounter = 0

export interface HotkeyUndoTexts {
    undone: string
    refused: string
    failed: string
}

/**
 * The Undo for a shortcut change. It re-reads the live rows when it runs and refuses when any affected row no longer
 * holds the chord this change wrote, so a later edit is never overwritten.
 */
export function hotkeyUndoAction(getRows: () => readonly Hotkey[], plan: readonly PlanStep[], texts: HotkeyUndoTexts): UndoAction {
    const kept = plan.map((step) => ({ action: step.action, before: { ...step.before }, after: { ...step.after } }))
    return {
        id: 'hotkey:' + (++undoCounter),
        failedText: texts.failed,
        run() {
            const rows = getRows()
            const targets = kept.map((step) => rows.find((row) => row.action === step.action))
            const stale = kept.some((step, at) => {
                const row = targets[at]
                return !row || !exactlyEqual(rowChord(row), step.after)
            })
            if (stale) {
                return { ok: false, text: texts.refused, after: 'close' }
            }
            kept.forEach((step, at) => writeChord(targets[at]!, step.before))
            return { ok: true, text: texts.undone }
        },
    }
}

/** Below 768 px, with no fine pointer and no keyboard seen, the page lists the shortcuts without editing. */
export function pageReadOnly(state: { width: number, finePointer: boolean, keyboardSeen: boolean }): boolean {
    return state.width < 768 && !state.finePointer && !state.keyboardSeen
}

/** A keydown with Ctrl, Alt or the command key shows a keyboard is attached. Shift is no signal: soft keyboards set it. */
export function keyboardSignal(ev: { ctrlKey: boolean, altKey: boolean, metaKey: boolean }): boolean {
    return ev.ctrlKey || ev.altKey || ev.metaKey
}
