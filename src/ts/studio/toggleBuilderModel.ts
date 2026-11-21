// The pure view model of the toggle list builder: what each row shows, which rows are visible, where a row can move,
// and how a draft changes kind. Everything is computed from a `Definition` and returns data; the builder state and the
// components own timing, focus and writes.
import { appendPosition, lineById, roleOf, textOf, type DefLine, type Definition, type Diagnostic, type DiagnosticCode, type LineId, type Position } from './toggleDef'
import { moveRow, type Refusal, type RowDraft } from './toggleDefEdit'

export type RowType = 'check' | 'select' | 'text' | 'textarea' | 'group' | 'divider' | 'caption' | 'groupEnd' | 'unreadable'
export type NewKind = 'check' | 'select' | 'text' | 'textarea' | 'group' | 'divider' | 'caption'

export interface RowView {
    readonly type: RowType
    /** The name shown for the row: a toggle's label, a divider's or note's text. Empty when the line has none. */
    readonly label: string
    readonly key: string
    readonly optionCount: number
}

const withoutCr = (text: string): string => (text.endsWith('\r') ? text.slice(0, -1) : text)

/** What one line shows. Depends on the line alone, so an unchanged line object never needs it again. */
export function rowViewOf(line: DefLine): RowView {
    const form = line.form
    const label = withoutCr(line.parts[1] ?? '')
    switch (form.kind) {
        case 'value': {
            const optionCount = form.valueKind === 'select' ? (line.parts[3]?.split(',') ?? []).length : 0
            return { type: form.valueKind, label, key: line.parts[0], optionCount }
        }
        case 'group':
            return { type: 'group', label, key: line.parts[0], optionCount: 0 }
        case 'divider':
        case 'caption':
            return { type: form.kind, label, key: '', optionCount: 0 }
        case 'groupEnd':
            return { type: 'groupEnd', label: '', key: '', optionCount: 0 }
        default:
            return { type: 'unreadable', label: '', key: '', optionCount: 0 }
    }
}

/** The diagnostic codes of one line, space separated: a primitive, so an unchanged set never re-renders its row. */
export function flagsOf(def: Definition, id: LineId): string {
    return (def.diagnostics.get(id) ?? []).map((diagnostic) => diagnostic.code).join(' ')
}

export interface OutlineRow {
    readonly id: LineId
    /** 1 for a top row, 2 for a member of a group. */
    readonly level: number
    readonly parentId: LineId | null
    readonly expandable: boolean
    readonly expanded: boolean
    readonly memberCount: number
}

const isPairedEnd = (def: Definition, line: DefLine): boolean =>
    roleOf(line) === 'groupEnd' && def.outline.groups.some((group) => group.end === line.id)

/** The rows the list shows: blank lines and the end lines of groups are hidden, and members of a collapsed group too. */
export function outlineRowsOf(def: Definition, collapsed: ReadonlySet<LineId>): readonly OutlineRow[] {
    const rows: OutlineRow[] = []
    for (const line of def.lines) {
        if (line.form.kind === 'blank' || isPairedEnd(def, line)) {
            continue
        }
        const parentId = def.outline.parentOf.get(line.id) ?? null
        if (parentId !== null && collapsed.has(parentId)) {
            continue
        }
        const info = line.form.kind === 'group' ? def.outline.groups.find((group) => group.group === line.id) : undefined
        rows.push({
            id: line.id,
            level: parentId === null ? 1 : 2,
            parentId,
            expandable: info !== undefined,
            expanded: info !== undefined && !collapsed.has(line.id),
            memberCount: info?.members.filter((member) => lineById(def, member)?.line.form.kind !== 'blank').length ?? 0,
        })
    }
    return rows
}

/** The ids of the visible rows in order, with each row's parent. */
function placeOf(def: Definition, id: LineId): { index: number, parent: LineId | null } | null {
    const rows = outlineRowsOf(def, new Set())
    const index = rows.findIndex((row) => row.id === id)
    return index < 0 ? null : { index, parent: rows[index].parentId }
}

/** The inclusive index range of a line, or of a group with its members and end line. */
function spanIndexes(def: Definition, index: number): { start: number, end: number } {
    const line = def.lines[index]
    if (roleOf(line) !== 'group') {
        return { start: index, end: index }
    }
    const info = def.outline.groups.find((group) => group.group === line.id)
    const endIndex = info && info.end !== null ? lineById(def, info.end)?.index : undefined
    return { start: index, end: endIndex ?? index + (info?.members.length ?? 0) }
}

const positionAtIndex = (def: Definition, index: number): Position =>
    index < def.lines.length ? { before: def.lines[index].id } : 'end'

/** Where a copy of a row goes: right after the row's span. */
export function positionAfter(def: Definition, id: LineId): Position | null {
    const found = lineById(def, id)
    return found ? positionAtIndex(def, spanIndexes(def, found.index).end + 1) : null
}

export type MoveDirection = 'up' | 'down'

/**
 * One visible step of a row: the first position, scanning in the direction from the row's span, where the move is legal
 * and the row's visible index or parent changes. Null when the row cannot move further that way.
 */
export function moveStep(def: Definition, id: LineId, direction: MoveDirection): Definition | null {
    const found = lineById(def, id)
    if (!found) {
        return null
    }
    const before = placeOf(def, id)
    if (before === null) {
        return null
    }
    const { start, end } = spanIndexes(def, found.index)
    const candidates: number[] = []
    if (direction === 'up') {
        for (let index = start - 1; index >= 0; index--) {
            candidates.push(index)
        }
    } else {
        for (let index = end + 2; index <= def.lines.length; index++) {
            candidates.push(index)
        }
    }
    for (const index of candidates) {
        const result = moveRow(def, id, positionAtIndex(def, index))
        if (!result.ok) {
            continue
        }
        const after = placeOf(result.def, id)
        if (after !== null && (after.index !== before.index || after.parent !== before.parent)) {
            return result.def
        }
    }
    return null
}

/** Moves a leaf to the end of a group. */
export function moveToGroup(def: Definition, id: LineId, group: LineId): Definition | null {
    const at = appendPosition(def, group)
    if (at === null) {
        return null
    }
    const result = moveRow(def, id, at)
    return result.ok && result.def !== def ? result.def : null
}

/** Moves a member out of its group, to the place right after the group's span. */
export function moveOutOfGroup(def: Definition, id: LineId): Definition | null {
    const parent = def.outline.parentOf.get(id)
    if (parent === undefined) {
        return null
    }
    const after = positionAfter(def, parent)
    if (after === null) {
        return null
    }
    const result = moveRow(def, id, after)
    return result.ok && result.def !== def ? result.def : null
}

/** Locale keys of the plain-text messages the builder shows; none takes an argument. */
export type TgMessageKey =
    | 'studioTgErrEq' | 'studioTgErrComma' | 'studioTgErrNewline' | 'studioTgErrEmptyKey' | 'studioTgErrEmptyLabel'
    | 'studioTgErrCaption' | 'studioTgStructure' | 'studioTgNotWritten' | 'studioTgCrLine'
    | 'studioTgUnreadable' | 'studioTgDupKey' | 'studioTgKeyEdge' | 'studioTgKeyInner' | 'studioTgKeyTwin' | 'studioTgFewOptions'
    | 'studioTgEmptyGroup' | 'studioTgOrphanEnd' | 'studioTgMarkPartsBeyondFour' | 'studioTgMarkUnknownType'
    | 'studioTgMarkIgnoredOptions' | 'studioTgMarkCr' | 'studioTgMarkGroupOpen' | 'studioTgMarkGroupReplaced'
    | 'studioTgTypeCheck' | 'studioTgTypeSelect' | 'studioTgTypeText' | 'studioTgTypeTextarea' | 'studioTgTypeGroup'
    | 'studioTgTypeDivider' | 'studioTgTypeCaption'
    | 'studioTgMarkPartsBeyondFive' | 'studioTgMarkDefaultNotOption' | 'studioTgMarkIgnoredDefault' | 'studioTgErrDefaultNotOption'

/** The message for a refused field value (DD-105): the refusal's code names the rule it broke. */
export function fieldErrorKeyOf(refusal: Refusal): TgMessageKey {
    switch (refusal.code) {
        case 'fieldHasEquals': return 'studioTgErrEq'
        case 'optionHasComma': return 'studioTgErrComma'
        case 'fieldHasNewline':
        case 'rawHasNewline': return 'studioTgErrNewline'
        case 'fieldHasCr':
        case 'rawHasCr': return 'studioTgCrLine'
        case 'emptyKey': return 'studioTgErrEmptyKey'
        case 'emptyLabel': return 'studioTgErrEmptyLabel'
        case 'captionNeedsText': return 'studioTgErrCaption'
        case 'defaultNotOption': return 'studioTgErrDefaultNotOption'
        case 'changesRole':
        case 'changesStructure': return 'studioTgStructure'
        default: return 'studioTgNotWritten'
    }
}

export function diagnosticKeyOf(code: DiagnosticCode): TgMessageKey {
    switch (code) {
        case 'unreadable': return 'studioTgUnreadable'
        case 'partsBeyondFour': return 'studioTgMarkPartsBeyondFour'
        case 'partsBeyondFive': return 'studioTgMarkPartsBeyondFive'
        case 'defaultNotOption': return 'studioTgMarkDefaultNotOption'
        case 'ignoredDefault': return 'studioTgMarkIgnoredDefault'
        case 'unknownType': return 'studioTgMarkUnknownType'
        case 'ignoredOptions': return 'studioTgMarkIgnoredOptions'
        case 'crInLine': return 'studioTgMarkCr'
        case 'duplicateKey': return 'studioTgDupKey'
        case 'keyLookalike': return 'studioTgKeyTwin'
        case 'keyEdgeSpace': return 'studioTgKeyEdge'
        case 'keyInteriorSpace': return 'studioTgKeyInner'
        case 'selectFewOptions': return 'studioTgFewOptions'
        case 'emptyGroup': return 'studioTgEmptyGroup'
        case 'groupReplaced': return 'studioTgMarkGroupReplaced'
        case 'groupOpenAtEnd': return 'studioTgMarkGroupOpen'
        case 'strayGroupEnd': return 'studioTgOrphanEnd'
    }
}

export function typeKeyOf(type: Exclude<RowType, 'groupEnd' | 'unreadable'>): TgMessageKey {
    switch (type) {
        case 'check': return 'studioTgTypeCheck'
        case 'select': return 'studioTgTypeSelect'
        case 'text': return 'studioTgTypeText'
        case 'textarea': return 'studioTgTypeTextarea'
        case 'group': return 'studioTgTypeGroup'
        case 'divider': return 'studioTgTypeDivider'
        case 'caption': return 'studioTgTypeCaption'
    }
}

/**
 * Holds the text of a single-line field while an IME composes: nothing is written until the composition ends, the
 * composed value is then written once, and a flush (blur, hide, unmount) writes a value still held.
 */
export function createCompositionGate(write: (value: string) => void) {
    let composing = false
    let held: string | null = null
    return {
        get composing(): boolean { return composing },
        start(): void { composing = true },
        input(value: string, isComposing: boolean): void {
            if (composing || isComposing) {
                held = value
                return
            }
            held = null
            write(value)
        },
        end(value: string): void {
            composing = false
            held = null
            write(value)
        },
        flush(): void {
            if (held === null) {
                return
            }
            const value = held
            held = null
            composing = false
            write(value)
        },
    }
}

export function newDraft(kind: NewKind, key: string, label: string): RowDraft {
    switch (kind) {
        case 'select':
            return { kind, key, label, options: [] }
        case 'divider':
            return { kind, label }
        case 'caption':
            return { kind, text: label }
        default:
            return { kind, key, label }
    }
}

/**
 * The default a select keeps when its options change from `before` to `after`. The default follows its option by text,
 * never by index: reorders, additions and edits of other options keep it; renaming the default option (exactly one slot
 * changed, and it held the default) renames the default; removing it, or changing several options so it cannot be
 * traced, clears it. A rename to '' returns '', which the writer refuses with `defaultNotOption`.
 */
export function followDefault(before: readonly string[], after: readonly string[], current: string | undefined): string | undefined {
    if (current === undefined) {
        return undefined
    }
    if (after.includes(current)) {
        return current
    }
    if (before.length === after.length) {
        const changed: number[] = []
        for (let index = 0; index < before.length; index++) {
            if (before[index] !== after[index]) {
                changed.push(index)
            }
        }
        if (changed.length === 1 && before[changed[0]] === current) {
            return after[changed[0]]
        }
    }
    return undefined
}

/** The draft of another leaf kind that keeps the row's name and key; a select dropping to another kind loses its options. */
export function convertDraft(draft: RowDraft, to: Exclude<NewKind, 'group'>, fallbackKey: string): RowDraft {
    const key = draft.kind === 'divider' || draft.kind === 'caption' ? fallbackKey : draft.key
    const label = draft.kind === 'caption' ? draft.text : draft.label
    return newDraft(to, key, label)
}

// ---- the text view ----------------------------------------------------------------------------------------------

/** Whether a line holds a carriage return that is not its final character: the text field can neither show nor keep it. */
export function hasInteriorCr(def: Definition): boolean {
    return def.lines.some((line) => withoutCr(line.raw).includes('\r'))
}

/** The text as the field shows it. A field's value never holds a carriage return, so one trailing `\r` per line is left out. */
export function displayTextOf(def: Definition): string {
    return textOf(def).split('\n').map(withoutCr).join('\n')
}

/**
 * The text a field value stands for. Lines outside the changed middle keep their original bytes, `\r` included, so one
 * edited line changes only its own bytes. A changed or new line is written as typed, with a `\r` only when the text is
 * uniformly CRLF (at least one line ending, every one of them `\r\n`) and the line is followed by a newline.
 * `withKeptCr(def, displayTextOf(def))` is `textOf(def)`.
 */
export function withKeptCr(def: Definition, fieldText: string): string {
    const original = textOf(def).split('\n')
    const shown = original.map(withoutCr)
    const typed = fieldText.replace(/\r\n?/g, '\n').split('\n')
    let prefix = 0
    while (prefix < shown.length && prefix < typed.length && shown[prefix] === typed[prefix]) {
        prefix++
    }
    let suffix = 0
    const cap = Math.min(shown.length, typed.length) - prefix
    while (suffix < cap && shown[shown.length - 1 - suffix] === typed[typed.length - 1 - suffix]) {
        suffix++
    }
    const terminated = original.slice(0, -1)
    const crlf = terminated.length > 0 && terminated.every((raw) => raw.endsWith('\r'))
    const result: string[] = []
    for (let index = 0; index < typed.length; index++) {
        if (index < prefix) {
            result.push(original[index])
        } else if (index >= typed.length - suffix) {
            result.push(original[original.length - (typed.length - index)])
        } else {
            result.push(crlf && index < typed.length - 1 ? `${typed[index]}\r` : typed[index])
        }
    }
    return result.join('\n')
}

export interface LineMark {
    /** 1-based line number in the text field. */
    readonly line: number
    readonly code: DiagnosticCode
    readonly severity: Diagnostic['severity']
}

/** One mark per diagnostic, at the number of the line it belongs to. */
export function lineMarksOf(def: Definition): readonly LineMark[] {
    const marks: LineMark[] = []
    def.lines.forEach((line, index) => {
        for (const diagnostic of def.diagnostics.get(line.id) ?? []) {
            marks.push({ line: index + 1, code: diagnostic.code, severity: diagnostic.severity })
        }
    })
    return marks
}

/** The offset of a line's start in `displayTextOf(def)`; 0 for an unknown line. */
export function caretOffsetOf(def: Definition, id: LineId): number {
    let offset = 0
    for (const line of def.lines) {
        if (line.id === id) {
            return offset
        }
        offset += withoutCr(line.raw).length + 1
    }
    return 0
}

/** The index of the line an offset of a field text falls on. */
export function lineIndexAtOffset(fieldText: string, offset: number): number {
    let index = 0
    for (let at = fieldText.indexOf('\n'); at >= 0 && at < offset; at = fieldText.indexOf('\n', at + 1)) {
        index++
    }
    return index
}

/** The list row a line belongs to: the line's own row, or the nearest row above it when the line has none (blank, group end). */
export function rowAtLine(def: Definition, lineIndex: number): LineId | null {
    let found: LineId | null = null
    for (const row of outlineRowsOf(def, new Set())) {
        const index = lineById(def, row.id)?.index ?? -1
        if (index > lineIndex) {
            break
        }
        found = row.id
    }
    return found
}

/** Whether a conversion from `from` to `to` throws option strings away. */
export function dropsOptions(from: RowDraft, to: RowDraft): boolean {
    return from.kind === 'select' && from.options.length > 0 && to.kind !== 'select'
}
