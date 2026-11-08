// The read model of one toggle text (the syntax `parseToggleSyntax` reads). Pure: the text is kept as raw lines plus a
// trailing-newline flag, so unedited text round-trips byte for byte, and every reading (rows, outline, structure,
// diagnostics) is computed from those lines. The grammar here copies the engine's, branch for branch; the oracle test
// holds the two together.
import type { sidebarToggle } from '../util'

export type LineId = number & { readonly __toggleLineId: true }
export type Role = 'leaf' | 'group' | 'groupEnd'
export type DropReason = 'noSeparator' | 'emptyKey' | 'emptyLabel' | 'captionNeedsText'
export type ValueKind = 'check' | 'select' | 'text' | 'textarea'
export type LineForm =
    | { kind: 'blank' } | { kind: 'dropped', reason: DropReason } | { kind: 'value', valueKind: ValueKind }
    | { kind: 'group' } | { kind: 'groupEnd' } | { kind: 'divider' } | { kind: 'caption' }
export type DefLine = { readonly id: LineId, readonly raw: string, readonly parts: readonly string[], readonly form: LineForm }
export type Position = { readonly before: LineId } | 'end'
export type GroupInfo = { readonly group: LineId, readonly end: LineId | null, readonly closer: 'end' | 'nextGroup' | 'textEnd', readonly members: readonly LineId[] }
export type Outline = { readonly groups: readonly GroupInfo[], readonly parentOf: ReadonlyMap<LineId, LineId>, readonly strayEnds: readonly LineId[], readonly openAtEnd: LineId | null }
export type Structure = { readonly parentOf: ReadonlyMap<LineId, LineId | null>, readonly endOf: ReadonlyMap<LineId, LineId | null>, readonly stray: ReadonlySet<LineId>, readonly openAtEnd: LineId | null }
export type StructureExemption = { readonly parentOf?: LineId, readonly endOf?: LineId }
export type DiagnosticCode = 'unreadable' | 'partsBeyondFour' | 'unknownType' | 'ignoredOptions' | 'crInLine'
    | 'duplicateKey' | 'keyLookalike' | 'keyEdgeSpace' | 'keyInteriorSpace' | 'selectFewOptions'
    | 'emptyGroup' | 'groupReplaced' | 'groupOpenAtEnd' | 'strayGroupEnd'
export type Diagnostic = { readonly code: DiagnosticCode, readonly severity: 'error' | 'warning' | 'hint', readonly related?: readonly LineId[] }
export type Definition = { readonly lines: readonly DefLine[], readonly trailingNewline: boolean, readonly nextId: number, readonly outline: Outline, readonly diagnostics: ReadonlyMap<LineId, readonly Diagnostic[]> }

const asId = (n: number): LineId => n as LineId

/**
 * The one line classifier, in the engine's branch order and without trimming or case folding. It does not reject
 * `'\n'`: a raw holding one is not a line, and callers refuse it before classifying.
 */
export function lineOf(id: LineId, raw: string): DefLine {
    const parts = raw.split('=')
    const [key, value, type] = parts
    let form: LineForm
    if (type === 'group' || type === 'groupEnd' || type === 'divider') {
        form = { kind: type }
    } else if (type === 'caption' && value) {
        form = { kind: 'caption' }
    } else if (key && value) {
        form = { kind: 'value', valueKind: type === 'select' || type === 'text' || type === 'textarea' ? type : 'check' }
    } else if (/^[ \t]*\r?$/.test(raw)) {
        form = { kind: 'blank' }
    } else if (type === 'caption') {
        form = { kind: 'dropped', reason: 'captionNeedsText' }
    } else if (parts.length < 2) {
        form = { kind: 'dropped', reason: 'noSeparator' }
    } else if (!key) {
        form = { kind: 'dropped', reason: 'emptyKey' }
    } else {
        form = { kind: 'dropped', reason: 'emptyLabel' }
    }
    return Object.freeze({ id, raw, parts: Object.freeze(parts), form: Object.freeze(form) })
}

export function roleOf(line: DefLine): Role {
    return line.form.kind === 'group' ? 'group' : line.form.kind === 'groupEnd' ? 'groupEnd' : 'leaf'
}

function outlineOf(lines: readonly DefLine[]): Outline {
    const groups: GroupInfo[] = []
    const parentOf = new Map<LineId, LineId>()
    const strayEnds: LineId[] = []
    type Open = { group: LineId, members: LineId[] }
    const finish = (open: Open, end: LineId | null, closer: GroupInfo['closer']) => {
        groups.push({ group: open.group, end, closer, members: open.members })
    }
    let open: Open | null = null
    for (const line of lines) {
        const role = roleOf(line)
        if (role === 'group') {
            if (open) {
                finish(open, null, 'nextGroup')
            }
            open = { group: line.id, members: [] }
        } else if (role === 'groupEnd') {
            if (open) {
                finish(open, line.id, 'end')
                open = null
            } else {
                strayEnds.push(line.id)
            }
        } else if (open) {
            open.members.push(line.id)
            parentOf.set(line.id, open.group)
        }
    }
    let openAtEnd: LineId | null = null
    if (open) {
        finish(open, null, 'textEnd')
        openAtEnd = open.group
    }
    return { groups, parentOf, strayEnds, openAtEnd }
}

function normalisedKey(key: string): string {
    return key.toLowerCase().replace(/[\s_]/gu, '')
}

function readingOf(form: LineForm): string {
    return form.kind === 'value' ? `value:${form.valueKind}` : form.kind
}

function diagnosticsOf(lines: readonly DefLine[], outline: Outline): ReadonlyMap<LineId, readonly Diagnostic[]> {
    const map = new Map<LineId, Diagnostic[]>()
    const add = (id: LineId, diagnostic: Diagnostic) => {
        const list = map.get(id)
        if (list) {
            list.push(diagnostic)
        } else {
            map.set(id, [diagnostic])
        }
    }
    const withRelated = (code: DiagnosticCode, severity: Diagnostic['severity'], related: readonly LineId[]): Diagnostic =>
        related.length > 0 ? { code, severity, related } : { code, severity }

    const valueRows = lines.filter((line) => line.form.kind === 'value')
    const byKey = new Map<string, LineId[]>()
    const byNormalised = new Map<string, DefLine[]>()
    for (const row of valueRows) {
        byKey.set(row.parts[0], [...(byKey.get(row.parts[0]) ?? []), row.id])
        const normalised = normalisedKey(row.parts[0])
        if (normalised) {
            byNormalised.set(normalised, [...(byNormalised.get(normalised) ?? []), row])
        }
    }

    for (const line of lines) {
        const form = line.form
        if (form.kind === 'blank') {
            continue
        }
        if (form.kind === 'dropped') {
            add(line.id, { code: 'unreadable', severity: 'error' })
            continue
        }
        if (line.parts.length > 4) {
            add(line.id, { code: 'partsBeyondFour', severity: 'warning' })
        }
        if (line.raw.endsWith('\r')) {
            const stripped = lineOf(line.id, line.raw.slice(0, -1))
            if (readingOf(stripped.form) !== readingOf(form)) {
                add(line.id, { code: 'crInLine', severity: 'warning' })
            }
        }
        if (form.kind !== 'value') {
            continue
        }
        const type = line.parts[2]
        if (type !== undefined && type !== '' && type !== 'select' && type !== 'text' && type !== 'textarea') {
            add(line.id, { code: 'unknownType', severity: 'warning' })
        }
        if (line.parts[3] !== undefined && form.valueKind !== 'select') {
            add(line.id, { code: 'ignoredOptions', severity: 'warning' })
        }
        if (form.valueKind === 'select' && (line.parts[3]?.split(',') ?? []).length < 2) {
            add(line.id, { code: 'selectFewOptions', severity: 'warning' })
        }
        const key = line.parts[0]
        const sameKey = (byKey.get(key) ?? []).filter((id) => id !== line.id)
        if (sameKey.length > 0) {
            add(line.id, { code: 'duplicateKey', severity: 'warning', related: sameKey })
        }
        const lookalikes = (byNormalised.get(normalisedKey(key)) ?? []).filter((other) => other.parts[0] !== key).map((other) => other.id)
        if (lookalikes.length > 0) {
            add(line.id, { code: 'keyLookalike', severity: 'warning', related: lookalikes })
        }
        if (/^\s|\s$/u.test(key)) {
            add(line.id, { code: 'keyEdgeSpace', severity: 'warning' })
        }
        if (/\s/u.test(key.trim())) {
            add(line.id, { code: 'keyInteriorSpace', severity: 'hint' })
        }
    }

    const byId = new Map(lines.map((line) => [line.id, line]))
    for (const info of outline.groups) {
        const group = byId.get(info.group)
        if (!group) {
            continue
        }
        if (!info.members.some((id) => byId.get(id)?.form.kind === 'value')) {
            const groupKey = group.parts[0]
            const sameText = valueRows.filter((row) => row.parts[0] === groupKey).map((row) => row.id)
            add(info.group, withRelated('emptyGroup', 'warning', sameText))
        }
        if (info.closer === 'nextGroup') {
            const index = lines.findIndex((line) => line.id === info.group)
            const next = lines.slice(index + 1).find((line) => roleOf(line) === 'group')
            add(info.group, withRelated('groupReplaced', 'hint', next ? [next.id] : []))
        } else if (info.closer === 'textEnd') {
            add(info.group, { code: 'groupOpenAtEnd', severity: 'warning' })
        }
    }
    for (const id of outline.strayEnds) {
        add(id, { code: 'strayGroupEnd', severity: 'hint' })
    }
    return map
}

/**
 * The only constructor of a `Definition`. It puts the lines into canonical form, so every model is a fixed point of
 * `parseDefinition(textOf(model))` on raws and flag: a last raw of exactly `''` with the flag false is dropped and the
 * flag set (the same bytes), and a model with no lines has the flag false. Only an exact `''` drops; whitespace-only and
 * CR-only last lines are user bytes. It keeps the given `nextId` and the kept line objects.
 */
export function buildDefinition(lines: readonly DefLine[], trailingNewline: boolean, nextId: number): Definition {
    let kept = lines
    let flag = trailingNewline
    if (!flag && kept.length > 0 && kept[kept.length - 1].raw === '') {
        kept = kept.slice(0, -1)
        flag = true
    }
    if (kept.length === 0) {
        flag = false
    }
    const outline = outlineOf(kept)
    return Object.freeze({ lines: kept, trailingNewline: flag, nextId, outline, diagnostics: diagnosticsOf(kept, outline) })
}

export function parseDefinition(text: string): Definition {
    const segments = text.split('\n')
    let flag = false
    if (segments[segments.length - 1] === '') {
        segments.pop()
        flag = true
    }
    const lines = segments.map((raw, index) => lineOf(asId(index), raw))
    return buildDefinition(lines, flag, lines.length)
}

export function textOf(def: Definition): string {
    return def.lines.map((line) => line.raw).join('\n') + (def.trailingNewline ? '\n' : '')
}

/** The rows `parseToggleSyntax(textOf(def))` returns, object for object. */
export function rowsOf(def: Definition): sidebarToggle[] {
    const rows: sidebarToggle[] = []
    for (const line of def.lines) {
        const form = line.form
        const [key, value, type] = line.parts
        if (form.kind === 'group' || form.kind === 'groupEnd' || form.kind === 'divider') {
            rows.push({ key, value, type: form.kind, children: [] } as sidebarToggle)
        } else if (form.kind === 'caption') {
            rows.push({ key, value, type: 'caption' })
        } else if (form.kind === 'value') {
            const options = line.parts[3]?.split(',') ?? []
            rows.push({ key, value, type: form.valueKind === 'check' ? undefined : form.valueKind, options } as sidebarToggle)
        }
    }
    return rows
}

export function structureOf(def: Definition): Structure {
    const parentOf = new Map<LineId, LineId | null>()
    for (const line of def.lines) {
        parentOf.set(line.id, def.outline.parentOf.get(line.id) ?? null)
    }
    const endOf = new Map<LineId, LineId | null>()
    for (const info of def.outline.groups) {
        endOf.set(info.group, info.end)
    }
    return { parentOf, endOf, stray: new Set(def.outline.strayEnds), openAtEnd: def.outline.openAtEnd }
}

/**
 * Whether an edit kept the structure of every line present before and after, apart from the named exemption. A new id
 * is not constrained here. No edit may let a different group swallow the end of the text.
 */
export function sameStructure(before: Structure, after: Structure, exempt: StructureExemption): boolean {
    for (const [id, parent] of before.parentOf) {
        if (after.parentOf.has(id) && id !== exempt.parentOf && after.parentOf.get(id) !== parent) {
            return false
        }
        if (after.parentOf.has(id) && before.stray.has(id) !== after.stray.has(id)) {
            return false
        }
    }
    for (const [id, end] of before.endOf) {
        if (after.endOf.has(id) && id !== exempt.endOf && after.endOf.get(id) !== end) {
            return false
        }
    }
    const openBefore = before.openAtEnd
    if (openBefore !== null && after.parentOf.has(openBefore) && openBefore !== exempt.endOf) {
        return after.openAtEnd === openBefore
    }
    return after.openAtEnd === null
}

/** Where a leaf becomes the last member of group `g`; for `null`, where a top-level line goes. */
export function appendPosition(def: Definition, group: LineId | null): Position | null {
    if (group === null) {
        return def.outline.openAtEnd === null ? 'end' : null
    }
    const info = def.outline.groups.find((candidate) => candidate.group === group)
    if (!info) {
        return null
    }
    if (info.end !== null) {
        return { before: info.end }
    }
    if (info.closer === 'nextGroup') {
        const index = def.lines.findIndex((line) => line.id === group)
        const next = def.lines.slice(index + 1).find((line) => roleOf(line) === 'group')
        return next ? { before: next.id } : 'end'
    }
    return 'end'
}

/** UTF-16 offsets of a line in `textOf(def)`; `end` excludes the line's newline. */
export function spanOf(def: Definition, id: LineId): { start: number, end: number } | null {
    let start = 0
    for (const line of def.lines) {
        if (line.id === id) {
            return { start, end: start + line.raw.length }
        }
        start += line.raw.length + 1
    }
    return null
}

const indexCache = new WeakMap<Definition, Map<LineId, number>>()

export function lineById(def: Definition, id: LineId): { line: DefLine, index: number } | null {
    let index = indexCache.get(def)
    if (!index) {
        index = new Map(def.lines.map((line, position) => [line.id, position]))
        indexCache.set(def, index)
    }
    const position = index.get(id)
    return position === undefined ? null : { line: def.lines[position], index: position }
}
