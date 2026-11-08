// The canonical line writer and the edit operations of the toggle model. Pure: every operation returns a new
// `Definition` built by `buildDefinition` (so it is in canonical form) or a typed refusal and no model. An operation
// keeps the structure of every line that existed before (its group, its end line, which group is open at the end of the
// text), apart from one named exemption per operation, or it refuses; positions are line-id anchors.
import {
    buildDefinition,
    lineById,
    lineOf,
    parseDefinition,
    roleOf,
    sameStructure,
    structureOf,
    type DefLine,
    type Definition,
    type LineId,
    type Position,
    type Role,
    type Structure,
    type StructureExemption,
} from './toggleDef'

export type RowDraft =
    | { kind: 'check' | 'text' | 'textarea', key: string, label: string }
    | { kind: 'select', key: string, label: string, options: readonly string[] }
    | { kind: 'group', key: string, label: string }
    | { kind: 'divider', label: string }
    | { kind: 'caption', text: string }
export type FieldRefusal =
    | { code: 'fieldHasEquals' | 'fieldHasNewline' | 'fieldHasCr', field: 'key' | 'label' | 'option' | 'text', optionIndex?: number }
    | { code: 'optionHasComma', optionIndex: number }
    | { code: 'emptyKey' | 'emptyLabel' | 'captionNeedsText' }
export type Refusal =
    | FieldRefusal
    | { code: 'unknownLine', id: LineId }
    | { code: 'rawHasNewline' | 'rawHasCr' | 'emptyFragment' | 'moveIntoOwnSpan' | 'pairedEnd' | 'notAGroup' | 'alreadyClosed' }
    | { code: 'changesRole', from: Role, to: Role }
    | { code: 'changesStructure', affected: readonly LineId[], firstLegal: Position | null }
export type EditResult = { ok: true, def: Definition, relocatedTo?: Position } | { ok: false, refusal: Refusal }
export type RewriteLoss = { tail: readonly string[], unknownType: string | null, strayOptions: string | null, trailingCr: boolean, structuralKey: string | null }

const asId = (n: number): LineId => n as LineId

// ---- the canonical writer --------------------------------------------------------------------------------------

function charRefusal(value: string, field: 'key' | 'label' | 'option' | 'text', optionIndex?: number): FieldRefusal | null {
    const code = value.includes('=') ? 'fieldHasEquals' : value.includes('\n') ? 'fieldHasNewline' : value.includes('\r') ? 'fieldHasCr' : null
    if (code === null) {
        return null
    }
    return optionIndex === undefined ? { code, field } : { code, field, optionIndex }
}

function fieldRefusal(draft: RowDraft): FieldRefusal | null {
    if (draft.kind === 'caption') {
        return charRefusal(draft.text, 'text') ?? (draft.text === '' ? { code: 'captionNeedsText' } : null)
    }
    if (draft.kind === 'divider') {
        return charRefusal(draft.label, 'label')
    }
    const chars = charRefusal(draft.key, 'key') ?? charRefusal(draft.label, 'label')
    if (chars) {
        return chars
    }
    if (draft.kind === 'select') {
        for (let index = 0; index < draft.options.length; index++) {
            const option = draft.options[index]
            const refused = charRefusal(option, 'option', index)
            if (refused) {
                return refused
            }
            if (option.includes(',')) {
                return { code: 'optionHasComma', optionIndex: index }
            }
        }
    }
    if (draft.kind === 'group') {
        return null
    }
    if (draft.key === '') {
        return { code: 'emptyKey' }
    }
    return draft.label === '' ? { code: 'emptyLabel' } : null
}

/**
 * The one line a draft writes, or the refusal. Every written line holds an `=`, so it is never the empty string, and
 * `parseToggleSyntax` reads it back as exactly the described row.
 */
export function canonicalLine(draft: RowDraft): string | FieldRefusal {
    const refused = fieldRefusal(draft)
    if (refused) {
        return refused
    }
    switch (draft.kind) {
        case 'check':
            return `${draft.key}=${draft.label}`
        case 'text':
        case 'textarea':
            return `${draft.key}=${draft.label}=${draft.kind}`
        case 'select':
            return `${draft.key}=${draft.label}=select${draft.options.length > 0 ? `=${draft.options.join(',')}` : ''}`
        case 'group':
            return `${draft.key}=${draft.label}=group`
        case 'divider':
            return `=${draft.label}=divider`
        case 'caption':
            return `=${draft.text}=caption`
    }
}

/** The end line of a group line. The engine never reads an end line's key or label, so this cannot fail. */
export function canonicalEndLine(groupLine: DefLine): string {
    const key = (groupLine.parts[0] ?? '').replace(/\r/g, '')
    const label = (groupLine.parts[1] ?? '').replace(/\r/g, '')
    return `${key === '' ? '' : `${key}_end`}=${label}=groupEnd`
}

// ---- drafts and what a rewrite would lose ----------------------------------------------------------------------

/**
 * The draft that rewrites a line canonically, or null for a blank, dropped or group-end line. The kind always comes from
 * the line's form, never from a cleaned part. One trailing `\r` is removed, and only from the last present part when that
 * part is the key, the label or the options text; any other `\r` stays so a later write refuses it.
 */
export function draftOf(line: DefLine): RowDraft | null {
    const form = line.form
    const last = line.parts.length - 1
    const part = (index: number): string => {
        const value = line.parts[index] ?? ''
        return index === last && (index === 0 || index === 1 || index === 3) && value.endsWith('\r') ? value.slice(0, -1) : value
    }
    switch (form.kind) {
        case 'value': {
            if (form.valueKind === 'select') {
                return { kind: 'select', key: part(0), label: part(1), options: line.parts[3] === undefined ? [] : part(3).split(',') }
            }
            return { kind: form.valueKind, key: part(0), label: part(1) }
        }
        case 'group':
            return { kind: 'group', key: part(0), label: part(1) }
        case 'divider':
            return { kind: 'divider', label: part(1) }
        case 'caption':
            return { kind: 'caption', text: part(1) }
        default:
            return null
    }
}

/** What a canonical rewrite of the line would drop. */
export function rewriteLoss(line: DefLine): RewriteLoss {
    const form = line.form
    const none: RewriteLoss = { tail: [], unknownType: null, strayOptions: null, trailingCr: false, structuralKey: null }
    if (form.kind === 'blank' || form.kind === 'dropped') {
        return none
    }
    const trailingCr = line.raw.endsWith('\r')
    if (form.kind === 'value') {
        const type = line.parts[2]
        return {
            tail: line.parts.slice(4),
            unknownType: form.valueKind === 'check' && type !== undefined && type !== '' ? type : null,
            strayOptions: form.valueKind !== 'select' ? (line.parts[3] ?? null) : null,
            trailingCr,
            structuralKey: null,
        }
    }
    const structuralKey = (form.kind === 'divider' || form.kind === 'caption') && line.parts[0] !== '' ? line.parts[0] : null
    return { ...none, tail: line.parts.slice(3), trailingCr, structuralKey }
}

// ---- operation plumbing ----------------------------------------------------------------------------------------

const unknownLine = (id: LineId): EditResult => ({ ok: false, refusal: { code: 'unknownLine', id } })
const refuse = (refusal: Refusal): EditResult => ({ ok: false, refusal })

/** The line index a position names, or the anchor id that no line carries. */
function resolve(def: Definition, at: Position): { index: number } | { missing: LineId } {
    if (at === 'end') {
        return { index: def.lines.length }
    }
    const found = lineById(def, at.before)
    return found ? { index: found.index } : { missing: at.before }
}

function positionAt(def: Definition, index: number): Position {
    return index < def.lines.length ? { before: def.lines[index].id } : 'end'
}

/** The ids present before whose place an edit changes, in text order; the same rule as `sameStructure`, but listing. */
function affectedIds(def: Definition, before: Structure, after: Structure, exempt: StructureExemption): LineId[] {
    const hit = new Set<LineId>()
    for (const [id, parent] of before.parentOf) {
        if (!after.parentOf.has(id)) {
            continue
        }
        if (id !== exempt.parentOf && after.parentOf.get(id) !== parent) {
            hit.add(id)
        }
        if (before.stray.has(id) !== after.stray.has(id)) {
            hit.add(id)
        }
    }
    for (const [id, end] of before.endOf) {
        if (after.endOf.has(id) && id !== exempt.endOf && after.endOf.get(id) !== end) {
            hit.add(id)
        }
    }
    const wasOpen = before.openAtEnd
    const survives = wasOpen !== null && after.parentOf.has(wasOpen) && wasOpen !== exempt.endOf
    if (survives ? after.openAtEnd !== wasOpen : after.openAtEnd !== null) {
        if (survives && wasOpen !== null) {
            hit.add(wasOpen)
        }
        if (after.openAtEnd !== null && before.parentOf.has(after.openAtEnd)) {
            hit.add(after.openAtEnd)
        }
    }
    return def.lines.filter((line) => hit.has(line.id)).map((line) => line.id)
}

type Attempt = { def: Definition, legal: boolean, affected: LineId[] }

function attempt(def: Definition, lines: readonly DefLine[], nextId: number, exempt: StructureExemption): Attempt {
    const candidate = buildDefinition(lines, def.trailingNewline, nextId)
    const before = structureOf(def)
    const after = structureOf(candidate)
    const legal = sameStructure(before, after, exempt)
    return { def: candidate, legal, affected: legal ? [] : affectedIds(def, before, after, exempt) }
}

function splice(def: Definition, index: number, removeCount: number, inserted: readonly DefLine[]): DefLine[] {
    return [...def.lines.slice(0, index), ...inserted, ...def.lines.slice(index + removeCount)]
}

/** The first candidate after `index`, in text order and ending with 'end', where `build` gives a legal result. */
function firstLegalAfter(def: Definition, index: number, build: (candidate: number) => Attempt): { position: Position, attempt: Attempt } | null {
    for (let candidate = index + 1; candidate <= def.lines.length; candidate++) {
        const tried = build(candidate)
        if (tried.legal) {
            return { position: positionAt(def, candidate), attempt: tried }
        }
    }
    return null
}

// ---- operations ------------------------------------------------------------------------------------------------

export function setRow(def: Definition, id: LineId, draft: RowDraft): EditResult {
    const found = lineById(def, id)
    if (!found) {
        return unknownLine(id)
    }
    const from = roleOf(found.line)
    const to: Role = draft.kind === 'group' ? 'group' : 'leaf'
    if (from !== to) {
        return refuse({ code: 'changesRole', from, to })
    }
    const raw = canonicalLine(draft)
    if (typeof raw !== 'string') {
        return refuse(raw)
    }
    return { ok: true, def: buildDefinition(splice(def, found.index, 1, [lineOf(id, raw)]), def.trailingNewline, def.nextId) }
}

export function setRaw(def: Definition, id: LineId, raw: string): EditResult {
    const found = lineById(def, id)
    if (!found) {
        return unknownLine(id)
    }
    if (raw.includes('\n')) {
        return refuse({ code: 'rawHasNewline' })
    }
    if (raw.includes('\r')) {
        return refuse({ code: 'rawHasCr' })
    }
    const line = lineOf(id, raw)
    const from = roleOf(found.line)
    const to = roleOf(line)
    if (from !== to) {
        return refuse({ code: 'changesRole', from, to })
    }
    return { ok: true, def: buildDefinition(splice(def, found.index, 1, [line]), def.trailingNewline, def.nextId) }
}

export function insertRow(def: Definition, at: Position, draft: RowDraft): EditResult {
    const anchor = resolve(def, at)
    if ('missing' in anchor) {
        return unknownLine(anchor.missing)
    }
    const index = anchor.index
    const raw = canonicalLine(draft)
    if (typeof raw !== 'string') {
        return refuse(raw)
    }
    const inserted: DefLine[] = [lineOf(asId(def.nextId), raw)]
    if (draft.kind !== 'group') {
        return { ok: true, def: buildDefinition(splice(def, index, 0, inserted), def.trailingNewline, def.nextId + 1) }
    }
    inserted.push(lineOf(asId(def.nextId + 1), canonicalEndLine(inserted[0])))
    const nextId = def.nextId + 2
    const build = (candidate: number) => attempt(def, splice(def, candidate, 0, inserted), nextId, {})
    const requested = build(index)
    if (requested.legal) {
        return { ok: true, def: requested.def }
    }
    const later = firstLegalAfter(def, index, build)
    return refuse({ code: 'changesStructure', affected: requested.affected, firstLegal: later ? later.position : null })
}

export function insertText(def: Definition, at: Position, fragment: string): EditResult {
    const anchor = resolve(def, at)
    if ('missing' in anchor) {
        return unknownLine(anchor.missing)
    }
    const index = anchor.index
    const segments = fragment.split('\n')
    if (segments[segments.length - 1] === '') {
        segments.pop()
    }
    if (segments.length === 0) {
        return refuse({ code: 'emptyFragment' })
    }
    const inserted = segments.map((raw, position) => lineOf(asId(def.nextId + position), raw))
    let nextId = def.nextId + inserted.length
    // The fragment is folded on its own: only the group still open at its end gets an end line.
    const open = buildDefinition(inserted, true, nextId).outline.openAtEnd
    const openLine = open === null ? undefined : inserted.find((line) => line.id === open)
    if (openLine) {
        inserted.push(lineOf(asId(nextId), canonicalEndLine(openLine)))
        nextId++
    }
    const build = (candidate: number) => attempt(def, splice(def, candidate, 0, inserted), nextId, {})
    const requested = build(index)
    if (requested.legal) {
        return { ok: true, def: requested.def }
    }
    const later = firstLegalAfter(def, index, build)
    if (!later) {
        return refuse({ code: 'changesStructure', affected: requested.affected, firstLegal: null })
    }
    return { ok: true, def: later.attempt.def, relocatedTo: later.position }
}

/** The inclusive index range of a line, or of a group with its members and end line. */
function rangeOf(def: Definition, index: number): { start: number, end: number } {
    const line = def.lines[index]
    if (roleOf(line) !== 'group') {
        return { start: index, end: index }
    }
    const info = def.outline.groups.find((group) => group.group === line.id)
    const endIndex = info && info.end !== null ? lineById(def, info.end)?.index : undefined
    return { start: index, end: endIndex ?? index + (info?.members.length ?? 0) }
}

const isPairedEnd = (def: Definition, line: DefLine): boolean =>
    roleOf(line) === 'groupEnd' && def.outline.groups.some((group) => group.end === line.id)

export function removeRow(def: Definition, id: LineId): EditResult {
    const found = lineById(def, id)
    if (!found) {
        return unknownLine(id)
    }
    if (isPairedEnd(def, found.line)) {
        return refuse({ code: 'pairedEnd' })
    }
    const range = rangeOf(def, found.index)
    const lines = splice(def, range.start, range.end - range.start + 1, [])
    if (roleOf(found.line) !== 'group') {
        return { ok: true, def: buildDefinition(lines, def.trailingNewline, def.nextId) }
    }
    const tried = attempt(def, lines, def.nextId, {})
    return tried.legal
        ? { ok: true, def: tried.def }
        : refuse({ code: 'changesStructure', affected: tried.affected, firstLegal: null })
}

export function moveRow(def: Definition, id: LineId, to: Position): EditResult {
    const found = lineById(def, id)
    if (!found) {
        return unknownLine(id)
    }
    const anchor = resolve(def, to)
    if ('missing' in anchor) {
        return unknownLine(anchor.missing)
    }
    const target = anchor.index
    if (isPairedEnd(def, found.line)) {
        return refuse({ code: 'pairedEnd' })
    }
    const { start, end } = rangeOf(def, found.index)
    if (target > start && target <= end) {
        return refuse({ code: 'moveIntoOwnSpan' })
    }
    if (target === start || target === end + 1) {
        return { ok: true, def }
    }
    const moved = def.lines.slice(start, end + 1)
    const lines = splice(def, start, moved.length, [])
    lines.splice(target > end ? target - moved.length : target, 0, ...moved)
    // A moved leaf may change its own group; a group span or a stray end may not re-parent anything.
    const exempt: StructureExemption = roleOf(found.line) === 'leaf' ? { parentOf: id } : {}
    const tried = attempt(def, lines, def.nextId, exempt)
    return tried.legal
        ? { ok: true, def: tried.def }
        : refuse({ code: 'changesStructure', affected: tried.affected, firstLegal: null })
}

export function closeGroup(def: Definition, group: LineId): EditResult {
    const found = lineById(def, group)
    if (!found) {
        return unknownLine(group)
    }
    const info = roleOf(found.line) === 'group' ? def.outline.groups.find((candidate) => candidate.group === group) : undefined
    if (!info) {
        return refuse({ code: 'notAGroup' })
    }
    if (info.end !== null) {
        return refuse({ code: 'alreadyClosed' })
    }
    let index = def.lines.length
    if (info.closer === 'nextGroup') {
        const next = def.lines.findIndex((line, position) => position > found.index && roleOf(line) === 'group')
        index = next === -1 ? def.lines.length : next
    }
    const endLine = lineOf(asId(def.nextId), canonicalEndLine(found.line))
    const tried = attempt(def, splice(def, index, 0, [endLine]), def.nextId + 1, { endOf: group })
    return tried.legal
        ? { ok: true, def: tried.def }
        : refuse({ code: 'changesStructure', affected: tried.affected, firstLegal: null })
}

/** Free text with no structure rule. Lines outside the changed middle keep their ids (the leftmost prefix, the rightmost suffix). */
export function replaceText(def: Definition, text: string): Definition {
    const parsed = parseDefinition(text)
    const next = parsed.lines
    const old = def.lines
    let prefix = 0
    while (prefix < old.length && prefix < next.length && old[prefix].raw === next[prefix].raw) {
        prefix++
    }
    let suffix = 0
    const cap = Math.min(old.length, next.length) - prefix
    while (suffix < cap && old[old.length - 1 - suffix].raw === next[next.length - 1 - suffix].raw) {
        suffix++
    }
    const oldMiddle = old.length - prefix - suffix
    const newMiddle = next.length - prefix - suffix
    let nextId = def.nextId
    const lines: DefLine[] = []
    for (let position = 0; position < next.length; position++) {
        if (position < prefix) {
            lines.push(old[position])
        } else if (position >= next.length - suffix) {
            lines.push(old[old.length - (next.length - position)])
        } else if (oldMiddle === newMiddle) {
            const previous = old[position]
            lines.push(previous.raw === next[position].raw ? previous : lineOf(previous.id, next[position].raw))
        } else {
            lines.push(lineOf(asId(nextId++), next[position].raw))
        }
    }
    return buildDefinition(lines, parsed.trailingNewline, nextId)
}
