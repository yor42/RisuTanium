// The state of one toggle list builder over a text port: the parsed definition, the open row editor, the unwritten new
// row, and every edit the list offers. Each edit computes the next definition with the pure edit operations, passes the
// carry guard while key edits are not live, and writes the whole string through the port. A refused edit writes
// nothing and leaves the definition as it was.
import { DBState } from '../stores.svelte'
import type { StudioRefusal } from './history/ownerHistory.svelte'
import type { ToggleTextPort, TogglePortMode } from './edit/toggleTextPort'
import { isModuleStub } from '../storage/moduleStub'
import { workingPresetsOf } from './itemText'
import {
    convertDraft,
    dropsOptions,
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
import { detachingItems, planCarry, valueKeysOf } from './toggleCarry'
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
 * the values saved under that key would be left behind. Carrying values over turns it on.
 */
export const TOGGLE_KEY_EDITS_LIVE = false

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
    for (const preset of workingPresetsOf(DBState.db)) {
        add(preset.toggles)
    }
    return keys
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
            def = replaceText(def, live)
            following.clear()
            if (editor && !lineById(def, editor.id)) {
                editor = null
            } else if (editor) {
                editor = { id: editor.id, origin: originOf(editor.id) }
            }
        },

        clearError(): void { error = null },

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
            return draft === null || draft.kind !== 'select' ? { ok: true } : setDraft(id, { ...draft, options: nextOptions }, mode)
        },
        changeKind(id: LineId, to: Exclude<NewKind, 'group'>): EditOutcome {
            const draft = draftFor(id)
            if (draft === null || draft.kind === 'group') {
                return { ok: true }
            }
            const label = draft.kind === 'caption' ? draft.text : draft.label
            const converted = convertDraft(draft, to, suggestKey(label, takenKeys(id), options.stem))
            const outcome = setDraft(id, converted, 'single')
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
