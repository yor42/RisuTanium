// The state of one toggle list builder over a text port: the parsed definition, the open row editor, the unwritten new
// row, and every edit the list offers. Each edit computes the next definition with the pure edit operations, passes the
// carry guard while key edits are not live, and writes the whole string through the port. A refused edit writes
// nothing and leaves the definition as it was.
import { untrack } from 'svelte'
import { recordCaughtError } from '../caughtErrors'
import type { FavouriteRef } from '../chatShell/toggleFavourites'
import { DBState } from '../stores.svelte'
import type { StudioRefusal } from './history/ownerHistory.svelte'
import type { ToggleTextPort, TogglePortMode } from './edit/toggleTextPort'
import { isModuleStub } from '../storage/moduleStub'
import { workingPresetsOf } from './itemText'
import {
    convertDraft,
    dropsOptions,
    followDefault,
    moveOutOfGroup,
    moveStep,
    moveToGroup,
    newDraft,
    outlineRowsOf,
    positionAfter,
    type MoveDirection,
    type NewKind,
    type OutlineRow,
} from './toggleBuilderModel'
import { addedFromRows, detachingItems, lateOldKeys, planCarry, valueKeysOf, type CarryItem } from './toggleCarry'
import {
    applyCarry,
    planCarryWrites,
    undoCarry as undoCarryWrites,
    type CarryJournal,
    type CarryPlanned,
    type CarryReach,
    type CarryValuePort,
} from './toggleCarryApply'
import { clearPending, holdSession, readPending, writePending } from './toggleCarryPending'
import {
    appendPosition,
    lineById,
    parseDefinition,
    textOf,
    type Definition,
    type LineId,
    type Position,
} from './toggleDef'
import {
    closeGroup,
    draftOf,
    insertRow,
    insertText,
    removeRow,
    replaceText,
    setRaw,
    setRow,
    type EditResult,
    type Refusal,
    type RowDraft,
} from './toggleDefEdit'
import { copyKey, keysOfText, suggestKey } from './toggleKeys'

/**
 * While false, an edit that would rename, reinterpret or drop a key present when the page was opened is not written:
 * the values saved under that key would be left behind. Carrying values over turns it on: with it live, a key edit is
 * written and the saved-values question (see `CarryDeps`) asks what to do with the values under the old key.
 */
export const TOGGLE_KEY_EDITS_LIVE = true

export type RowOrigin = 'base' | 'new'
export interface RemovedLines {
    readonly index: number
    readonly raws: readonly string[]
    readonly label: string
}
export type EditFailure =
    | { readonly ok: false, readonly kind: 'field', readonly refusal: Refusal }
    | { readonly ok: false, readonly kind: 'held' }
    | { readonly ok: false, readonly kind: 'refused', readonly reason: StudioRefusal }
    | { readonly ok: false, readonly kind: 'unavailable' }
    | { readonly ok: false, readonly kind: 'cantMove' }
export type EditOutcome =
    | { readonly ok: true, readonly removed?: RemovedLines, readonly movedTo?: number, readonly optionsDropped?: true }
    | EditFailure

export interface BuilderOptions {
    readonly keyEditsLive: boolean
    /** The owner prefix of keys for rows without a usable name. */
    readonly stem: string
    /** The keys the other readable sources of the app define; a suggested key avoids them. */
    readonly appKeys: ReadonlySet<string>
    /** The saved-values question and its carry; absent, the builder asks nothing and writes no record. */
    readonly carry?: CarryDeps
}

/** What the saved-values question needs from the app: where values live, and the owner's favourites source. */
export interface CarryDeps {
    /** Read at checkpoints and at Carry, never reactively. */
    readonly reach: () => CarryReach
    readonly values: CarryValuePort
    /** `character:<chaId>` or `module:<moduleId>`: the favourites source that follows a renamed key. */
    readonly starSource: string
    readonly stars: { has(ref: FavouriteRef): boolean, rename(ref: FavouriteRef, to: string): void }
    /** `own`: the owner's chats only; `loaded`: the chats of every loaded character. */
    readonly reachKind: 'own' | 'loaded'
    /**
     * A preset owner only: the question also names the active preset when it defines a key that is renamed, because the
     * value under that key stays where the active preset still reads it.
     */
    readonly namesActiveKeeps?: boolean
}

/** One line of the question, already resolved to the keys and labels the text names. */
export type CarryLine =
    | { readonly kind: 'key', readonly from: string, readonly to: string }
    | { readonly kind: 'options', readonly key: string }
    | { readonly kind: 'kind', readonly key: string }
    | { readonly kind: 'drop', readonly label: string }
    | { readonly kind: 'unclear', readonly key: string }
    | { readonly kind: 'late', readonly key: string, readonly now: string | null }

export interface CarryQuestion {
    readonly lines: readonly CarryLine[]
    /** Some item can be carried; otherwise the only answer is OK. */
    readonly carryable: boolean
    /** Some carried item renumbers option indexes. */
    readonly numbers: boolean
    /** The preview of the writes; its signature is what the shown question was about. */
    readonly planned: CarryPlanned
    /** The current keys the question is about: their rows carry the flag. */
    readonly flagged: ReadonlySet<string>
    /** Every key rename of the question, late lines included: the uses list reads where the old keys are still read. */
    readonly renames: readonly UsesRename[]
    /** The renamed keys the active preset still defines, with its name; empty unless the owner asked for it. */
    readonly activeKeeps: readonly { readonly key: string, readonly name: string }[]
}

/** One key rename the uses list is about. */
export type UsesRename = { readonly from: string, readonly to: string }

export type CarryEventKind = 'shown' | 'cancelled' | 'recheck' | 'undone'
export type CarryEvent = { readonly kind: CarryEventKind, readonly n: number }
export type CarryOutcome =
    | { readonly ok: true, readonly token: number }
    | { readonly ok: false, readonly reason: 'unavailable' | 'stale' | 'failed' }
export type UndoCarryOutcome = { readonly ok: true } | { readonly ok: false, readonly reason: 'gone' | 'changed' }

interface CarryJournalSlot {
    readonly token: number
    readonly journal: CarryJournal
    readonly replaced: readonly { readonly from: string, readonly to: string }[]
    readonly baseline: Definition
    readonly t0: Definition
}

interface PendingRow {
    readonly kind: Extract<NewKind, 'check' | 'select' | 'text' | 'textarea' | 'caption'>
    readonly group: LineId | null
}
interface OpenEditor {
    readonly id: LineId
    readonly origin: RowOrigin
}

/** The owner whose toggle definition a builder edits. */
export type ToggleTarget =
    | { readonly kind: 'character', readonly chaId: string }
    | { readonly kind: 'module', readonly moduleId: string }
    | { readonly kind: 'preset', readonly presetId: string }

/** The toggle keys the app's other readable sources define: characters, resident modules and working presets, except the edited owner's own. */
export function appToggleKeys(except: ToggleTarget): ReadonlySet<string> {
    const keys = new Set<string>()
    const add = (text: unknown) => {
        if (typeof text === 'string') {
            for (const key of keysOfText(text)) {
                keys.add(key)
            }
        }
    }
    for (const character of DBState.db.characters ?? []) {
        if (character && character.type !== 'group' && !(except.kind === 'character' && character.chaId === except.chaId)) {
            add(character.customModuleToggle)
        }
    }
    for (const module of DBState.db.modules ?? []) {
        if (module && !isModuleStub(module) && !(except.kind === 'module' && module.id === except.moduleId)) {
            add(module.customModuleToggle)
        }
    }
    workingPresetsOf(DBState.db).forEach((preset, index) => {
        if (!(except.kind === 'preset' && DBState.db.botPresets?.[index]?.id === except.presetId)) {
            add(preset.toggles)
        }
    })
    return keys
}

/** The renamed keys the active preset (the `prompt` source of the reach) defines, each with that preset's name. */
function activeKeepsOf(renames: readonly UsesRename[], reach: CarryReach): CarryQuestion['activeKeeps'] {
    const active = reach.others.find((other) => other.id === 'prompt')
    if (!active) {
        return []
    }
    const keys = keysOfText(active.text)
    return renames.filter((rename) => keys.has(rename.from)).map((rename) => ({ key: rename.from, name: active.name }))
}

/** Puts removed lines back into the current live text as one new step; the toast's Undo uses it. */
export function restoreLines(port: ToggleTextPort, removed: RemovedLines): EditOutcome {
    const live = parseDefinition(port.read())
    const at: Position = removed.index < live.lines.length ? { before: live.lines[removed.index].id } : 'end'
    const result = insertText(live, at, removed.raws.join('\n'))
    if (result.ok === false) {
        return { ok: false, kind: 'field', refusal: result.refusal }
    }
    const written = port.write(textOf(result.def), 'single')
    if (written === null) {
        return { ok: false, kind: 'unavailable' }
    }
    return written.ok === false ? { ok: false, kind: 'refused', reason: written.reason } : { ok: true }
}

export function createToggleBuilder(port: ToggleTextPort, options: BuilderOptions) {
    let def = $state.raw<Definition>(parseDefinition(port.read()))
    const visitKeys = valueKeysOf(def)
    let editor = $state.raw<OpenEditor | null>(null)
    let pending = $state.raw<PendingRow | null>(null)
    let collapsed = $state.raw<ReadonlySet<LineId>>(new Set())
    let error = $state.raw<EditFailure | null>(null)
    // Rows whose key still follows the name: new rows until the author edits the key.
    const following = new Set<LineId>()

    // The saved-values question. `baselineDef` is the definition the saved values were written under; `t0` is the text this
    // instance started the window with. Everything here is instance memory except the record `writePending` keeps.
    const deps = options.carry
    let baselineDef = def
    let t0 = def
    // Lines the list created in this window: never a rename target. Only `typePending` and `duplicate` add to it, and
    // only a text-view write or a resync (rows re-derived from text) empties it, besides a new window.
    const listCreated = new Set<LineId>()
    let question = $state.raw<CarryQuestion | null>(null)
    let carried = $state.raw(false)
    let notKept = $state.raw(false)
    let lastEvent = $state.raw<CarryEvent | null>(null)
    // The renames the uses list keeps showing after Carry or Leave answered the question, until Update all, Close, a
    // new question or the end of the visit of this item.
    let keptRenames = $state.raw<readonly UsesRename[]>([])
    let journal: CarryJournalSlot | null = null
    let tokens = 0

    /** A kept rename stays offered only while the live definition defines its `to` and no longer defines its `from`. */
    function stillHeld(kept: readonly UsesRename[]): readonly UsesRename[] {
        const keys = valueKeysOf(def)
        return kept.filter((rename) => keys.has(rename.to) && !keys.has(rename.from))
    }

    function say(kind: CarryEventKind): void {
        lastEvent = { kind, n: (lastEvent?.n ?? 0) + 1 }
    }

    function addedNow(): ReadonlySet<string> {
        const rows: { key: string, origin: RowOrigin }[] = []
        for (const line of def.lines) {
            if (line.form.kind === 'value') {
                rows.push({ key: line.parts[0], origin: listCreated.has(line.id) ? 'new' : 'base' })
            }
        }
        return addedFromRows(rows)
    }

    function baselineLabelOf(key: string): string {
        const line = baselineDef.lines.find((candidate) => candidate.form.kind === 'value' && candidate.parts[0] === key)
        return line ? line.parts[1].replace(/\r$/, '') : key
    }

    /** The question for the baseline and the current text, or null when nothing asks. Reads reach, so never reactive. */
    function buildQuestion(): CarryQuestion | null {
        if (!deps) {
            return null
        }
        return untrack(() => {
            const added = addedNow()
            const items = planCarry(baselineDef, def, added)
            if (items.length === 0) {
                return null
            }
            const late = lateOldKeys(baselineDef, t0, def, added)
            const renamed = new Map<string, string>()
            const renames: UsesRename[] = []
            for (const item of items) {
                if (item.kind === 'rename') {
                    renamed.set(item.from, item.to)
                    renames.push({ from: item.from, to: item.to })
                }
            }
            const reach = deps.reach()
            const lines: CarryLine[] = []
            const flagged = new Set<string>()
            const live: CarryItem[] = []
            const lateShown = new Set<string>()
            for (const item of items) {
                const old = item.kind === 'rename' ? item.from : item.key
                const now = renamed.get(old) ?? old
                if (late.has(old)) {
                    if (!lateShown.has(old)) {
                        lateShown.add(old)
                        lines.push({ kind: 'late', key: old, now: renamed.has(old) ? now : null })
                        flagged.add(now)
                    }
                    continue
                }
                live.push(item)
                switch (item.kind) {
                    case 'rename':
                        lines.push({ kind: 'key', from: item.from, to: item.to })
                        flagged.add(item.to)
                        break
                    case 'optionRemap':
                        lines.push({ kind: 'options', key: now })
                        flagged.add(now)
                        break
                    case 'kindChange':
                        lines.push({ kind: 'kind', key: now })
                        flagged.add(now)
                        break
                    case 'drop':
                        lines.push({ kind: 'drop', label: baselineLabelOf(item.key) })
                        break
                    case 'ambiguous':
                        lines.push({ kind: 'unclear', key: item.key })
                        break
                }
            }
            return {
                lines,
                carryable: live.some((item) => item.kind === 'rename' || item.kind === 'optionRemap'),
                numbers: live.some((item) => item.kind === 'optionRemap'),
                planned: planCarryWrites(live, reach),
                flagged,
                renames,
                activeKeeps: deps.namesActiveKeeps === true ? activeKeepsOf(renames, reach) : [],
            }
        })
    }

    /** A new window: the saved values are taken to match the current text, and no list row is new any more. */
    function startWindow(): void {
        baselineDef = def
        t0 = def
        listCreated.clear()
    }

    function cancelQuestion(): void {
        question = null
        startWindow()
        clearPending(port.owner)
        notKept = false
        say('cancelled')
    }

    function refreshQuestion(): void {
        const next = buildQuestion()
        if (next === null) {
            cancelQuestion()
        } else {
            question = next
        }
    }

    /** Shows the question when the plan asks; hides it, as a cancellation, when the plan became empty. */
    function checkpoint(): void {
        if (!deps) {
            return
        }
        const next = buildQuestion()
        if (next === null) {
            if (question !== null) {
                cancelQuestion()
            }
            return
        }
        const first = question === null
        question = next
        if (first) {
            keptRenames = []
            say('shown')
        }
    }

    /** At the window's first landed definition write the baseline is stored, unless a question is already kept. */
    function recordWindow(): void {
        if (!deps || !port.view().editable || readPending(port.owner).status === 'ok') {
            return
        }
        // An owner whose history lasts for this page only keeps its question in memory too, never on the device.
        if (port.carryKept === 'session') {
            holdSession(port.owner, textOf(baselineDef))
            notKept = true
        } else if (writePending(port.owner, textOf(baselineDef)) === 'memoryOnly') {
            notKept = true
        }
    }

    /** Runs in the task of every landed definition write, after the port accepted it and the definition was taken in. */
    function landed(): void {
        if (!deps) {
            return
        }
        recordWindow()
        if (question !== null) {
            refreshQuestion()
        }
    }

    function mountWindow(): void {
        if (!deps) {
            return
        }
        const record = readPending(port.owner)
        if (record.status !== 'ok') {
            return
        }
        baselineDef = parseDefinition(record.baseline)
        notKept = record.kept === 'session'
        const next = buildQuestion()
        if (next === null) {
            startWindow()
            clearPending(port.owner)
            notKept = false
        } else {
            question = next
        }
    }

    /** Takes text in that the port holds: rows are re-derived from it, so no row is new and no key follows a name. */
    function takeIn(live: string): void {
        def = replaceText(def, live)
        following.clear()
        listCreated.clear()
        if (editor && !lineById(def, editor.id)) {
            editor = null
        } else if (editor) {
            editor = { id: editor.id, origin: originOf(editor.id) }
        }
        if (keptRenames.length > 0) {
            keptRenames = stillHeld(keptRenames)
        }
        if (question !== null) {
            refreshQuestion()
        }
    }

    function originOf(id: LineId): RowOrigin {
        const line = lineById(def, id)?.line
        return line && line.form.kind === 'value' && visitKeys.has(line.parts[0]) ? 'base' : 'new'
    }

    function takenKeys(except?: LineId): Set<string> {
        const taken = new Set(options.appKeys)
        for (const line of def.lines) {
            if (line.form.kind === 'value' && line.id !== except) {
                taken.add(line.parts[0])
            }
        }
        return taken
    }

    function fail(failure: EditFailure): EditFailure {
        error = failure
        return failure
    }

    function commit(next: Definition, mode: TogglePortMode, guarded: boolean): EditFailure | null {
        if (!options.keyEditsLive && guarded && detachingItems(planCarry(def, next), visitKeys).length > 0) {
            return fail({ ok: false, kind: 'held' })
        }
        const result = port.write(textOf(next), mode)
        if (result === null) {
            return fail({ ok: false, kind: 'unavailable' })
        }
        if (result.ok === false) {
            return fail({ ok: false, kind: 'refused', reason: result.reason })
        }
        def = next
        error = null
        landed()
        return null
    }

    function apply(result: EditResult, mode: TogglePortMode, guarded: boolean): EditOutcome {
        if (result.ok === false) {
            return fail({ ok: false, kind: 'field', refusal: result.refusal })
        }
        return commit(result.def, mode, guarded) ?? { ok: true }
    }

    function setDraft(id: LineId, draft: RowDraft, mode: TogglePortMode): EditOutcome {
        const origin = editor?.id === id ? editor.origin : originOf(id)
        return apply(setRow(def, id, draft), mode, origin === 'base')
    }

    function draftFor(id: LineId): RowDraft | null {
        const line = lineById(def, id)?.line
        return line ? draftOf(line) : null
    }

    function openEditor(id: LineId): void {
        editor = { id, origin: originOf(id) }
        pending = null
        error = null
    }

    /** The place a new top row or a new member goes, closing a group left open at the end of the text first. */
    function slotFor(group: LineId | null): { base: Definition, at: Position } | null {
        if (group !== null) {
            const at = appendPosition(def, group)
            return at === null ? null : { base: def, at }
        }
        if (def.outline.openAtEnd === null) {
            return { base: def, at: 'end' }
        }
        const closed = closeGroup(def, def.outline.openAtEnd)
        return closed.ok ? { base: closed.def, at: 'end' } : null
    }

    function insertAt(group: LineId | null, draft: RowDraft): { outcome: EditOutcome, id: LineId | null } {
        const slot = slotFor(group)
        if (slot === null) {
            return { outcome: fail({ ok: false, kind: 'cantMove' }), id: null }
        }
        const id = slot.base.nextId as LineId
        const inserted = insertRow(slot.base, slot.at, draft)
        const outcome = apply(inserted, 'single', false)
        if (outcome.ok && group !== null && collapsed.has(group)) {
            const next = new Set(collapsed)
            next.delete(group)
            collapsed = next
        }
        return { outcome, id: outcome.ok ? id : null }
    }

    mountWindow()

    return {
        /** The owner the port writes; the refusal texts name it. */
        owner: port.owner,
        get def() { return def },
        get editor() { return editor },
        get pending() { return pending },
        get collapsed() { return collapsed },
        get error() { return error },
        get visitKeys() { return visitKeys },
        get keyEditsLive() { return options.keyEditsLive },
        rows(): readonly OutlineRow[] { return outlineRowsOf(def, collapsed) },

        /** Takes the live text in when it changed outside the builder; writes nothing. */
        resync(live: string): void {
            if (live === textOf(def)) {
                return
            }
            takeIn(live)
        },

        /**
         * The one entry of a text-view write. A change that would rename, reinterpret or drop a visit key while key edits
         * are not live is held before anything is written. A landed write takes the text in and runs the record and
         * question bookkeeping in the same task. Null when nothing is left to report.
         */
        writeText(next: Definition): EditFailure | null {
            const before = def
            if (!options.keyEditsLive && detachingItems(planCarry(before, next), visitKeys).length > 0) {
                return { ok: false, kind: 'held' }
            }
            const text = textOf(next)
            if (text === textOf(before)) {
                return null
            }
            const result = port.write(text, 'typing')
            if (result === null) {
                return { ok: false, kind: 'unavailable' }
            }
            if (result.ok === false) {
                return { ok: false, kind: 'refused', reason: result.reason }
            }
            takeIn(text)
            landed()
            return null
        },

        clearError(): void { error = null },

        /** The open saved-values question, or null. */
        get question() { return question },
        /** A carry of this instance that can still be undone. */
        get carried() { return carried },
        /** The open question lives only until this page is closed. */
        get carryNotKept() { return notKept },
        /** The latest thing worth announcing; `n` grows with every event. */
        get carryEvent() { return lastEvent },
        get carryReach() { return deps?.reachKind ?? null },
        /** Decides whether the question shows now; callers run it where a field is left or an option or kind changed. */
        checkpoint,

        /** The renames the uses list is about: the open question's, else those kept after Carry or Leave. */
        get usesRenames(): readonly UsesRename[] {
            return question !== null && question.renames.length > 0 ? question.renames : stillHeld(keptRenames)
        },
        /** Whether the list shows renames the question no longer holds, so it offers Close. */
        get usesKept(): boolean { return !(question !== null && question.renames.length > 0) && stillHeld(keptRenames).length > 0 },
        /** Close of the uses list: the kept renames end. An open question keeps its own. */
        dismissUses(): void { keptRenames = [] },
        /** An update all landed: the kept renames end, as their uses were just rewritten. */
        noteUpdated(): void { keptRenames = [] },

        /** Writes the carryable items' values in one task, then answers the question. */
        carryValues(): CarryOutcome {
            const shown = question
            if (!deps || shown === null || !shown.carryable || !port.view().editable) {
                return { ok: false, reason: 'unavailable' }
            }
            const fresh = buildQuestion()
            if (fresh === null) {
                cancelQuestion()
                return { ok: false, reason: 'stale' }
            }
            const result = applyCarry(fresh.planned, shown.planned.signature, deps.values)
            if (result.ok === false) {
                if (result.reason === 'stale') {
                    question = fresh
                    say('recheck')
                }
                return { ok: false, reason: result.reason }
            }
            const source = deps.starSource
            const replaced = fresh.planned.star.filter((star) => deps.stars.has({ s: source, k: star.from }) && !deps.stars.has({ s: source, k: star.to }))
            for (const star of fresh.planned.star) {
                try {
                    deps.stars.rename({ s: source, k: star.from }, star.to)
                } catch (failure) {
                    recordCaughtError('studio.toggleCarry.stars', failure)
                }
            }
            tokens += 1
            journal = { token: tokens, journal: result.journal, replaced, baseline: baselineDef, t0 }
            keptRenames = fresh.renames
            carried = true
            startWindow()
            question = null
            clearPending(port.owner)
            notKept = false
            return { ok: true, token: tokens }
        },

        /** Leave or OK: the saved values are taken to match the current text, and nothing else is written. */
        answerCarry(): void {
            if (question === null) {
                return
            }
            keptRenames = question.renames
            journal = null
            carried = false
            question = null
            startWindow()
            clearPending(port.owner)
            notKept = false
        },

        /** Undoes the carry of this instance. A token of another carry, or none left, is `gone` and writes nothing. */
        undoCarry(token?: number): UndoCarryOutcome {
            const slot = journal
            if (!deps || slot === null || (token !== undefined && slot.token !== token)) {
                return { ok: false, reason: 'gone' }
            }
            journal = null
            carried = false
            keptRenames = []
            const result = undoCarryWrites(slot.journal, deps.values)
            if (result.ok === false) {
                return { ok: false, reason: 'changed' }
            }
            const source = deps.starSource
            for (const star of slot.replaced) {
                try {
                    deps.stars.rename({ s: source, k: star.to }, star.from)
                } catch (failure) {
                    recordCaughtError('studio.toggleCarry.stars', failure)
                }
            }
            baselineDef = slot.baseline
            t0 = slot.t0
            const reopened = buildQuestion()
            if (reopened === null) {
                startWindow()
                say('cancelled')
            } else {
                question = reopened
                holdSession(port.owner, textOf(baselineDef))
                notKept = true
                say('undone')
            }
            return { ok: true }
        },

        /** The builder ends with its Studio visit: no carry can be undone, and a question that no longer asks is dropped. */
        dispose(): void {
            journal = null
            carried = false
            keptRenames = []
            if (deps && question === null && planCarry(baselineDef, def, addedNow()).length === 0) {
                clearPending(port.owner)
            }
        },

        open(id: LineId): void { openEditor(id) },
        close(): void {
            editor = null
            pending = null
        },
        toggleCollapsed(id: LineId): void {
            const next = new Set(collapsed)
            if (!next.delete(id)) {
                next.add(id)
            }
            collapsed = next
        },
        /** A value row whose origin is base keeps its key, kind and options while key edits are not live. */
        isLocked(id: LineId): boolean {
            const line = lineById(def, id)?.line
            return !options.keyEditsLive && editor?.id === id && editor.origin === 'base' && line?.form.kind === 'value'
        },

        setLabel(id: LineId, label: string): EditOutcome {
            const draft = draftFor(id)
            if (draft === null) {
                return { ok: true }
            }
            if (draft.kind === 'caption') {
                return setDraft(id, { kind: 'caption', text: label }, 'typing')
            }
            if (following.has(id) && draft.kind !== 'divider') {
                return setDraft(id, { ...draft, label, key: suggestKey(label, takenKeys(id), options.stem) }, 'typing')
            }
            return setDraft(id, { ...draft, label }, 'typing')
        },
        setKey(id: LineId, key: string): EditOutcome {
            const draft = draftFor(id)
            if (draft === null || draft.kind === 'divider' || draft.kind === 'caption') {
                return { ok: true }
            }
            following.delete(id)
            return setDraft(id, { ...draft, key }, 'typing')
        },
        setOptions(id: LineId, nextOptions: readonly string[], mode: TogglePortMode = 'typing'): EditOutcome {
            const draft = draftFor(id)
            if (draft === null || draft.kind !== 'select') {
                return { ok: true }
            }
            const followed = followDefault(draft.options, nextOptions, draft.default)
            const { default: _previous, ...rest } = draft
            const outcome = setDraft(id, followed === undefined ? { ...rest, options: nextOptions } : { ...rest, options: nextOptions, default: followed }, mode)
            if (outcome.ok && mode === 'single') {
                checkpoint()
            }
            return outcome
        },
        /** The checkbox's start-on flag (`'1'`) or the select's starting option text; null clears it. Other rows have none. */
        setDefault(id: LineId, value: string | null): EditOutcome {
            const draft = draftFor(id)
            if (draft === null || (draft.kind !== 'check' && draft.kind !== 'select')) {
                return { ok: true }
            }
            let next: RowDraft
            if (draft.kind === 'check') {
                const { default: _previous, ...rest } = draft
                next = value === '1' ? { ...rest, default: '1' } : rest
            } else {
                const { default: _previous, ...rest } = draft
                next = value === null ? rest : { ...rest, default: value }
            }
            const outcome = setDraft(id, next, 'single')
            if (outcome.ok) {
                checkpoint()
            }
            return outcome
        },
        changeKind(id: LineId, to: Exclude<NewKind, 'group'>): EditOutcome {
            const draft = draftFor(id)
            if (draft === null || draft.kind === 'group') {
                return { ok: true }
            }
            const label = draft.kind === 'caption' ? draft.text : draft.label
            const converted = convertDraft(draft, to, suggestKey(label, takenKeys(id), options.stem))
            const outcome = setDraft(id, converted, 'single')
            if (outcome.ok) {
                checkpoint()
            }
            return outcome.ok && dropsOptions(draft, converted) ? { ok: true, optionsDropped: true } : outcome
        },
        setRawLine(id: LineId, raw: string): EditOutcome {
            const origin = editor?.id === id ? editor.origin : originOf(id)
            return apply(setRaw(def, id, raw), 'typing', origin === 'base')
        },

        /** Starts an addition. A divider and a group are written at once; the others wait for a first valid name. */
        startAdd(kind: NewKind, group: LineId | null): EditOutcome {
            if (kind === 'divider' || kind === 'group') {
                const key = kind === 'group' ? suggestKey('', takenKeys(), options.stem) : ''
                const draft = newDraft(kind, key, '')
                const { outcome, id } = insertAt(group, draft)
                if (id !== null) {
                    if (kind === 'group') {
                        following.add(id)
                    }
                    openEditor(id)
                }
                return outcome
            }
            editor = null
            pending = { kind, group }
            error = null
            return { ok: true }
        },
        /** The name typed into the unwritten row: the first valid one writes it. An empty name writes nothing. */
        typePending(label: string): EditOutcome {
            const row = pending
            if (row === null || label === '') {
                return { ok: true }
            }
            const key = row.kind === 'caption' ? '' : suggestKey(label, takenKeys(), options.stem)
            const { outcome, id } = insertAt(row.group, newDraft(row.kind, key, label))
            if (id !== null) {
                if (row.kind !== 'caption') {
                    following.add(id)
                }
                listCreated.add(id)
                if (question !== null) {
                    refreshQuestion()
                }
                openEditor(id)
            }
            return outcome
        },

        deleteRow(id: LineId): EditOutcome {
            const found = lineById(def, id)
            if (!found) {
                return { ok: true }
            }
            const result = removeRow(def, id)
            if (result.ok === false) {
                return fail({ ok: false, kind: 'field', refusal: result.refusal })
            }
            const count = def.lines.length - result.def.lines.length
            const draft = draftOf(found.line)
            const label = draft === null ? '' : draft.kind === 'caption' ? draft.text : draft.label
            const removed: RemovedLines = { index: found.index, raws: def.lines.slice(found.index, found.index + count).map((line) => line.raw), label }
            const failure = commit(result.def, 'single', true)
            if (failure) {
                return failure
            }
            if (editor?.id === id || (editor && !lineById(def, editor.id))) {
                editor = null
            }
            return { ok: true, removed }
        },
        duplicate(id: LineId): EditOutcome {
            const draft = draftFor(id)
            const at = positionAfter(def, id)
            if (draft === null || draft.kind === 'group' || at === null) {
                return { ok: true }
            }
            const copy: RowDraft = draft.kind === 'divider' || draft.kind === 'caption' ? draft : { ...draft, key: copyKey(draft.key, takenKeys()) }
            const created = def.nextId as LineId
            const outcome = apply(insertRow(def, at, copy), 'single', false)
            if (outcome.ok) {
                listCreated.add(created)
                if (question !== null) {
                    refreshQuestion()
                }
                openEditor(created)
                if (copy.kind !== 'divider' && copy.kind !== 'caption') {
                    following.delete(created)
                }
            }
            return outcome
        },
        move(id: LineId, direction: MoveDirection): EditOutcome {
            return placed(id, moveStep(def, id, direction))
        },
        moveToGroup(id: LineId, group: LineId): EditOutcome {
            return placed(id, moveToGroup(def, id, group))
        },
        moveOut(id: LineId): EditOutcome {
            return placed(id, moveOutOfGroup(def, id))
        },
    }

    function placed(id: LineId, next: Definition | null): EditOutcome {
        if (next === null) {
            return fail({ ok: false, kind: 'cantMove' })
        }
        const failure = commit(next, 'single', originOf(id) === 'base')
        if (failure) {
            return failure
        }
        const parent = def.outline.parentOf.get(id)
        if (parent !== undefined && collapsed.has(parent)) {
            const expanded = new Set(collapsed)
            expanded.delete(parent)
            collapsed = expanded
        }
        const index = outlineRowsOf(def, collapsed).findIndex((row) => row.id === id)
        return { ok: true, movedTo: index + 1 }
    }
}

export type ToggleBuilder = ReturnType<typeof createToggleBuilder>
