import fc from 'fast-check'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'

/**
 * The toggle model against the real engine parser and the real toggles panel. This is the only file that imports
 * `parseToggleSyntax`; the neighbours it pulls in are mocked, never the parser. Each case is a new-behaviour guard: the
 * module is new, so its red proof is the named mutant, not a run on the unchanged base.
 */

const h = vi.hoisted(() => ({
    db: { globalChatVariables: {} as Record<string, string>, customPromptTemplateToggle: '', jailbreakToggle: false } as Record<string, unknown>,
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))
vi.mock(import('src/ts/process/modules'), () => ({
    getModuleToggles: () => '',
}) as unknown as typeof import('src/ts/process/modules'))

import { parseToggleSyntax } from 'src/ts/util'
import { buildPanelModel, type PanelItem } from 'src/ts/chatShell/togglePanel'
import {
    buildDefinition,
    lineById,
    lineOf,
    parseDefinition,
    roleOf,
    rowsOf,
    sameStructure,
    structureOf,
    textOf,
    type Definition,
    type DefLine,
    type LineId,
    type Position,
    type Role,
    type StructureExemption,
} from './toggleDef'
import {
    canonicalEndLine,
    canonicalLine,
    closeGroup,
    draftOf,
    insertRow,
    insertText,
    moveRow,
    removeRow,
    replaceText,
    setRaw,
    setRow,
    type EditResult,
    type RowDraft,
} from './toggleDefEdit'
import { corpus, crlf, lineArb, oracleSameStructure, oracleStructure, structureTextArb, textArb } from './toggleDefFixtures.test-helpers'

const id = (n: number): LineId => n as LineId
const oracleOf = (def: Definition) => oracleStructure(parseToggleSyntax, def.lines.map((line) => line.raw), def.lines.map((line) => line.id))
const realRole = (raw: string): Role => {
    const type = parseToggleSyntax(raw)[0]?.type
    return type === 'group' ? 'group' : type === 'groupEnd' ? 'groupEnd' : 'leaf'
}

describe('1-7 the parser is the real one', () => {
    test('the engine parser is not mocked and reads a CR-suffixed type as a check row', () => {
        expect(vi.isMockFunction(parseToggleSyntax)).toBe(false)
        expect(parseToggleSyntax('g=G=group\r')).toStrictEqual([{ key: 'g', value: 'G', type: undefined, options: [] }])
        expect(parseToggleSyntax('g=G=group')[0].type).toBe('group')
    })
})

describe('1-8 fixture differential', () => {
    test('rowsOf equals the engine parser on every corpus text, LF and CRLF', () => {
        for (const entry of corpus) {
            for (const text of [entry.text, crlf(entry.text)]) {
                expect(rowsOf(parseDefinition(text)), entry.name).toStrictEqual(parseToggleSyntax(text))
            }
        }
    })

    test('W-I1 literal', () => {
        const text = 'k=v\n=c=caption'
        expect(rowsOf(parseDefinition(text))).toStrictEqual([{ key: 'k', value: 'v', type: undefined, options: [] }, { key: '', value: 'c', type: 'caption' }])
        expect(rowsOf(parseDefinition(text))).toStrictEqual(parseToggleSyntax(text))
        expect(rowsOf(parseDefinition(''))).toStrictEqual(parseToggleSyntax(''))
    })
})

describe('1-9 identity on generated texts (compatibility guard: passes for any split-and-join)', () => {
    test('textOf reproduces any text', () => {
        fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (text) => textOf(parseDefinition(text)) === text), { numRuns: 300 })
    })
})

describe('1-10 differential on generated texts', () => {
    test('rowsOf equals the engine parser', () => {
        fc.assert(fc.property(textArb, (text) => {
            expect(rowsOf(parseDefinition(text))).toStrictEqual(parseToggleSyntax(text))
        }), { numRuns: 600 })
    })
})

type Projected =
    | { type: 'row', key: string, label: string, kind: string, options: string[] }
    | { type: 'caption', label: string }
    | { type: 'divider', label: string }
    | { type: 'group', label: string, children: Projected[] }

function projectPanel(items: PanelItem[]): Projected[] {
    return items.map((item): Projected => {
        if (item.type === 'group') {
            return { type: 'group', label: item.label, children: projectPanel(item.children) }
        }
        if (item.type === 'row') {
            return { type: 'row', key: item.key, label: item.label, kind: item.kind, options: item.options }
        }
        return { type: item.type, label: item.label }
    })
}

/** What the panel shows, read from the model's outline: top-level lines, then each group with its members. */
function projectDef(def: Definition): Projected[] {
    const leaf = (id: LineId): Projected | null => {
        const line = lineById(def, id)?.line
        if (!line) {
            return null
        }
        if (line.form.kind === 'caption') {
            return { type: 'caption', label: line.parts[1] }
        }
        if (line.form.kind === 'divider') {
            return { type: 'divider', label: line.parts[1] }
        }
        if (line.form.kind === 'value') {
            const kind = line.form.valueKind
            return { type: 'row', key: line.parts[0], label: line.parts[1], kind, options: kind === 'select' ? (line.parts[3]?.split(',') ?? []) : [] }
        }
        return null
    }
    const push = (target: Projected[], item: Projected | null) => {
        const before = target.at(-1)
        if (item && !(item.type === 'divider' && before?.type === 'divider' && before.label === item.label)) {
            target.push(item)
        }
    }
    const items: Projected[] = []
    for (const line of def.lines) {
        if (roleOf(line) === 'group') {
            const info = def.outline.groups.find((group) => group.group === line.id)
            const children: Projected[] = []
            for (const member of info?.members ?? []) {
                push(children, leaf(member))
            }
            // A group is present for the divider dedupe even when it holds no row; hidden groups leave only at the end.
            items.push({ type: 'group', label: line.parts[1], children })
        } else if (roleOf(line) === 'leaf' && !def.outline.parentOf.has(line.id)) {
            push(items, leaf(line.id))
        }
    }
    return items.filter((item) => item.type !== 'group' || item.children.some((child) => child.type === 'row'))
}

const dividerAroundEmptyGroup = '==divider\na=a=group\na_end=a=groupEnd\n==divider'

const panelOf = (text: string): PanelItem[] => buildPanelModel([{ id: 't', kind: 'module', name: 't', text }]).sources[0].items

describe('1-11 panel projection (A10)', () => {
    test('the outline gives the panel items on the corpus', () => {
        for (const entry of corpus) {
            expect(projectDef(parseDefinition(entry.text)), entry.name).toEqual(projectPanel(panelOf(entry.text)))
        }
    })

    test('the outline gives the panel items on generated texts, and emptyGroup matches a hidden group', () => {
        fc.assert(fc.property(structureTextArb, (text) => {
            const def = parseDefinition(text)
            expect(projectDef(def)).toEqual(projectPanel(panelOf(text)))
            const shown = panelOf(text).filter((item) => item.type === 'group').length
            const groups = def.outline.groups.length
            const empty = def.outline.groups.filter((info) => (def.diagnostics.get(info.group) ?? []).some((diagnostic) => diagnostic.code === 'emptyGroup')).length
            expect(groups - empty).toBe(shown)
        }), { numRuns: 200, examples: [[dividerAroundEmptyGroup]] })
    })

    test('an empty group between equal dividers keeps both dividers, in the outline and in the panel', () => {
        const expected = [{ type: 'divider', label: '' }, { type: 'divider', label: '' }]
        expect(projectPanel(panelOf(dividerAroundEmptyGroup))).toEqual(expected)
        expect(projectDef(parseDefinition(dividerAroundEmptyGroup))).toEqual(expected)
    })
})

describe('O-1 role fidelity', () => {
    test('roleOf equals the engine reading of the line alone', () => {
        const lineAlone = fc.oneof(lineArb, fc.string({ unit: fc.constantFrom('a', 'g', '=', '\r', ' ', ','), maxLength: 20 }))
        fc.assert(fc.property(lineAlone, (raw) => roleOf(lineOf(id(0), raw)) === realRole(raw)), { numRuns: 500 })
        expect(roleOf(lineOf(id(0), 'g=G=group\r'))).toBe('leaf')
        expect(realRole('g=G=group\r')).toBe('leaf')
        expect(roleOf(lineOf(id(0), 'g=G=group'))).toBe('group')
    })
})

describe('O-2 structure fidelity', () => {
    test('structureOf equals the oracle fold over the engine parser', () => {
        for (const entry of corpus) {
            const def = parseDefinition(entry.text)
            expect(structureOf(def), entry.name).toEqual(oracleOf(def))
        }
        fc.assert(fc.property(structureTextArb, (text) => {
            const def = parseDefinition(text)
            expect(structureOf(def)).toEqual(oracleOf(def))
        }), { numRuns: 400 })
    })
})

// ---- the canonical writer against the engine parser ------------------------------------------------------------

const fieldArb = fc.string({ unit: fc.constantFrom('a', 'b', 'K', ' ', '\t', '😀', '-'), maxLength: 4 })
const requiredArb = fc.string({ unit: fc.constantFrom('a', 'b', 'K', ' ', '\t', '😀', '-'), minLength: 1, maxLength: 4 })
const valueKindArb = fc.constantFrom('check', 'text', 'textarea')

/** Drafts the writer accepts: required fields non-empty, no `=`, newline, CR or option comma. */
const draftArb: fc.Arbitrary<RowDraft> = fc.oneof(
    fc.tuple(valueKindArb, requiredArb, requiredArb).map(([kind, key, label]): RowDraft => ({ kind, key, label })),
    fc.tuple(requiredArb, requiredArb, fc.array(fieldArb, { maxLength: 4 })).map(([key, label, options]): RowDraft => ({ kind: 'select', key, label, options })),
    fc.tuple(fieldArb, fieldArb).map(([key, label]): RowDraft => ({ kind: 'group', key, label })),
    fieldArb.map((label): RowDraft => ({ kind: 'divider', label })),
    requiredArb.map((text): RowDraft => ({ kind: 'caption', text })),
)

/** The row the engine must read from the line a draft writes. */
function expectedRow(draft: RowDraft) {
    switch (draft.kind) {
        case 'check':
            return { key: draft.key, value: draft.label, type: undefined, options: [] }
        case 'text':
        case 'textarea':
            return { key: draft.key, value: draft.label, type: draft.kind, options: [] }
        case 'select':
            return { key: draft.key, value: draft.label, type: 'select', options: [...draft.options] }
        case 'group':
            return { key: draft.key, value: draft.label, type: 'group', children: [] }
        case 'divider':
            return { key: '', value: draft.label, type: 'divider', children: [] }
        case 'caption':
            return { key: '', value: draft.text, type: 'caption' }
    }
}

function corrupt(draft: RowDraft, bad: string, which: number): RowDraft {
    switch (draft.kind) {
        case 'caption':
            return { ...draft, text: draft.text + bad }
        case 'divider':
            return { ...draft, label: draft.label + bad }
        case 'select': {
            const slot = which % (2 + draft.options.length)
            if (slot === 0) {
                return { ...draft, key: draft.key + bad }
            }
            if (slot === 1) {
                return { ...draft, label: draft.label + bad }
            }
            return { ...draft, options: draft.options.map((option, index) => (index === slot - 2 ? option + bad : option)) }
        }
        default:
            return which % 2 === 0 ? { ...draft, key: draft.key + bad } : { ...draft, label: draft.label + bad }
    }
}

describe('O-W1 the written line is read back as the described row', () => {
    test('every accepted draft parses to its row, and the end line parses as a group end', () => {
        fc.assert(fc.property(draftArb, (draft) => {
            const line = canonicalLine(draft)
            if (typeof line !== 'string') {
                throw new Error('an accepted draft was refused')
            }
            expect(parseToggleSyntax(line)).toStrictEqual([expectedRow(draft)])
            if (draft.kind === 'group') {
                expect(parseToggleSyntax(canonicalEndLine(lineOf(id(0), line)))[0].type).toBe('groupEnd')
            }
        }), { numRuns: 500 })
    })

    test('W-I4 literals: select with no options and with one empty option', () => {
        expect(parseToggleSyntax(canonicalLine({ kind: 'select', key: 'k', label: 'l', options: [''] }) as string)).toStrictEqual([{ key: 'k', value: 'l', type: 'select', options: [''] }])
        expect(parseToggleSyntax(canonicalLine({ kind: 'select', key: 'k', label: 'l', options: [] }) as string)).toStrictEqual([{ key: 'k', value: 'l', type: 'select', options: [] }])
        expect(parseToggleSyntax(canonicalEndLine(lineOf(id(0), 'g=G=group')))[0].type).toBe('groupEnd')
        expect(canonicalEndLine(lineOf(id(0), 'g=G=group'))).toBe('g_end=G=groupEnd')
    })
})

describe('O-W2 refused drafts', () => {
    test('a forbidden character in any field is always refused', () => {
        fc.assert(fc.property(draftArb, fc.constantFrom('=', '\n', '\r'), fc.nat(8), (draft, bad, which) => {
            expect(typeof canonicalLine(corrupt(draft, bad, which))).toBe('object')
        }), { numRuns: 400 })
    })

    test('a comma in an option and an empty required field are always refused', () => {
        fc.assert(fc.property(draftArb, fc.nat(4), (draft, which) => {
            if (draft.kind === 'select' && draft.options.length > 0) {
                const slot = which % draft.options.length
                const comma = { ...draft, options: draft.options.map((option, index) => (index === slot ? `${option},` : option)) }
                expect(canonicalLine(comma)).toEqual({ code: 'optionHasComma', optionIndex: slot })
            }
            if (draft.kind === 'caption') {
                expect(canonicalLine({ ...draft, text: '' })).toEqual({ code: 'captionNeedsText' })
            } else if (draft.kind !== 'divider' && draft.kind !== 'group') {
                expect(canonicalLine({ ...draft, key: '' })).toEqual({ code: 'emptyKey' })
                expect(canonicalLine({ ...draft, label: '' })).toEqual({ code: 'emptyLabel' })
            }
        }), { numRuns: 300 })
    })
})

describe('O-W3 draftOf round trip', () => {
    test('rewriting a value line from its own draft keeps the kind the engine read, LF and CRLF', () => {
        fc.assert(fc.property(structureTextArb, (text) => {
            for (const variant of [text, crlf(text)]) {
                const def = parseDefinition(variant)
                for (const line of def.lines) {
                    if (line.form.kind !== 'value') {
                        continue
                    }
                    const draft = draftOf(line)
                    if (!draft) {
                        throw new Error('a value line has no draft')
                    }
                    const result = setRow(def, line.id, draft)
                    if (!result.ok) {
                        continue
                    }
                    const written = result.def.lines.find((candidate) => candidate.id === line.id)
                    expect(parseToggleSyntax(written?.raw ?? '')[0].type).toBe(parseToggleSyntax(line.raw)[0].type)
                }
            }
        }), { numRuns: 300 })
    })
})

describe('O-L edit locality', () => {
    test('a valid setRow changes only that line and only that engine entry', () => {
        fc.assert(fc.property(structureTextArb, fc.nat(30), draftArb, (text, pick, draft) => {
            const def = parseDefinition(text)
            const leaves = def.lines.filter((line) => roleOf(line) === 'leaf')
            if (leaves.length === 0 || draft.kind === 'group') {
                return
            }
            const target = leaves[pick % leaves.length]
            const result = setRow(def, target.id, draft)
            if (result.ok === false) {
                throw new Error(`refused: ${result.refusal.code}`)
            }
            const next = result.def
            next.lines.forEach((line, index) => {
                if (line.id !== target.id) {
                    expect(line).toBe(def.lines[index])
                }
            })
            expect(next.trailingNewline).toBe(def.trailingNewline)
            const written = next.lines[def.lines.indexOf(target)].raw
            const expected = def.lines.flatMap((line) => parseToggleSyntax(line === target ? written : line.raw))
            expect(parseToggleSyntax(textOf(next))).toStrictEqual(expected)
        }), { numRuns: 300 })
    })
})

// ---- random operation sequences ----------------------------------------------------------------------------------

type OpName = 'setRow' | 'setRaw' | 'insertRow' | 'insertText' | 'removeRow' | 'moveRow' | 'closeGroup'
const opNames: OpName[] = ['setRow', 'setRaw', 'insertRow', 'insertText', 'removeRow', 'moveRow', 'closeGroup']
type OpSpec = { op: number, a: number, b: number, draft: RowDraft, raw: string, fragment: string }
type Step = {
    name: OpName
    result: EditResult
    exempt: StructureExemption
    target: DefLine | null
    anchor: Position | null
    draft: RowDraft | null
    raw: string | null
    fragment: string | null
}

const rawArb = fc.oneof(fc.constant(''), lineArb, fc.constantFrom('x=y=group', 'x_end=X=groupEnd', 'junk', 'p=P', 'a\nb'))
const fragmentArb = fc.oneof(structureTextArb, structureTextArb.map((fragment) => `${fragment}\n\n`), lineArb, fc.constantFrom('\n', '\n\n', 'g=G=group\n\n', 'a=A\n'))
const specArb: fc.Arbitrary<OpSpec> = fc.record({ op: fc.nat(8), a: fc.nat(60), b: fc.nat(60), draft: draftArb, raw: rawArb, fragment: fragmentArb })
const sequenceArb = fc.tuple(structureTextArb, fc.array(specArb, { maxLength: 6 }))

const positionFor = (def: Definition, n: number): Position => {
    const index = n % (def.lines.length + 1)
    return index === def.lines.length ? 'end' : { before: def.lines[index].id }
}
const indexOfPosition = (def: Definition, at: Position): number => (at === 'end' ? def.lines.length : def.lines.findIndex((line) => line.id === at.before))
const rawsOfDef = (def: Definition): string[] => def.lines.map((line) => line.raw)

function runOp(def: Definition, spec: OpSpec): Step | null {
    const name = opNames[spec.op % opNames.length]
    const count = def.lines.length
    const target = count > 0 ? def.lines[spec.a % count] : null
    const anchor = positionFor(def, spec.b)
    const step = { name, target, anchor: null, draft: null, raw: null, fragment: null, exempt: {} }
    switch (name) {
        case 'setRow':
            return target ? { ...step, result: setRow(def, target.id, spec.draft), draft: spec.draft } : null
        case 'setRaw':
            return target ? { ...step, result: setRaw(def, target.id, spec.raw), raw: spec.raw } : null
        case 'insertRow':
            return { ...step, result: insertRow(def, anchor, spec.draft), anchor, draft: spec.draft }
        case 'insertText':
            return { ...step, result: insertText(def, anchor, spec.fragment), anchor, fragment: spec.fragment }
        case 'removeRow':
            return target ? { ...step, result: removeRow(def, target.id) } : null
        case 'moveRow':
            return target ? { ...step, result: moveRow(def, target.id, anchor), anchor, exempt: realRole(target.raw) === 'leaf' ? { parentOf: target.id } : {} } : null
        case 'closeGroup': {
            const groups = def.outline.groups
            const chosen = groups.length > 0 ? groups[spec.a % groups.length].group : (target?.id ?? null)
            return chosen === null ? null : { ...step, result: closeGroup(def, chosen), target: lineById(def, chosen)?.line ?? null, exempt: { endOf: chosen } }
        }
    }
}

function drive(base: string, specs: readonly OpSpec[], visit: (before: Definition, step: Step) => void) {
    let def = parseDefinition(base)
    for (const spec of specs) {
        const step = runOp(def, spec)
        if (!step) {
            continue
        }
        visit(def, step)
        if (step.result.ok) {
            def = step.result.def
        }
    }
}

function expectFixedPoint(def: Definition) {
    const again = parseDefinition(textOf(def))
    expect(rawsOfDef(again)).toEqual(rawsOfDef(def))
    expect(again.trailingNewline).toBe(def.trailingNewline)
}

/** The role refusals the engine reading predicts, and the raw refusals of setRaw. */
function expectRoleOutcome(step: Step) {
    if (step.name === 'setRow' && step.target && step.draft) {
        const from = realRole(step.target.raw)
        const to: Role = step.draft.kind === 'group' ? 'group' : 'leaf'
        if (from !== to) {
            expect(step.result).toEqual({ ok: false, refusal: { code: 'changesRole', from, to } })
        } else {
            expect(step.result.ok).toBe(true)
        }
    }
    if (step.name === 'setRaw' && step.target && step.raw !== null) {
        const from = realRole(step.target.raw)
        if (step.raw.includes('\n')) {
            expect(step.result).toEqual({ ok: false, refusal: { code: 'rawHasNewline' } })
        } else if (step.raw.includes('\r')) {
            expect(step.result).toEqual({ ok: false, refusal: { code: 'rawHasCr' } })
        } else if (realRole(step.raw) !== from) {
            expect(step.result).toEqual({ ok: false, refusal: { code: 'changesRole', from, to: realRole(step.raw) } })
        } else {
            expect(step.result.ok).toBe(true)
        }
    }
}

function expectFragmentShape(def: Definition, next: Definition, fragment: string) {
    const segments = fragment.split('\n')
    if (segments[segments.length - 1] === '') {
        segments.pop()
    }
    const fragmentIds = segments.map((_, index) => id(def.nextId + index))
    const fold = oracleStructure(parseToggleSyntax, segments, fragmentIds)
    const endId = id(def.nextId + segments.length)
    const fresh = next.lines.filter((line) => line.id >= def.nextId)
    const written = fresh.map((line) => line.raw)
    const open = fold.openAtEnd
    if (open !== null) {
        expect(written).toEqual([...segments, canonicalEndLine(lineOf(open, segments[open - def.nextId]))])
    } else if (written.length !== segments.length || written.some((raw, index) => raw !== segments[index])) {
        expect(segments[segments.length - 1]).toBe('')
        expect(written).toEqual(segments.slice(0, -1))
        expect(next.trailingNewline).toBe(next.lines.length > 0)
        if (fresh.length > 0) {
            expect(next.lines[next.lines.length - 1]).toBe(fresh[fresh.length - 1])
        }
    }
    const firstAt = fresh.length > 0 ? next.lines.indexOf(fresh[0]) : 0
    fresh.forEach((line, index) => expect(next.lines[firstAt + index]).toBe(line))
    const foldFresh = oracleStructure(parseToggleSyntax, written, fresh.map((line) => line.id))
    for (const line of fresh) {
        if (line.id === endId) {
            continue
        }
        expect(foldFresh.parentOf.get(line.id)).toBe(fold.parentOf.get(line.id))
        expect(foldFresh.stray.has(line.id)).toBe(fold.stray.has(line.id))
        expect(foldFresh.endOf.get(line.id)).toBe(line.id === open ? endId : fold.endOf.get(line.id))
    }
    const after = oracleOf(next)
    if (open !== null) {
        expect(after.endOf.get(open)).toBe(endId)
    }
    expect(after.openAtEnd === null || after.openAtEnd < def.nextId).toBe(true)
}

describe('O-S no silent re-parenting', () => {
    test('every successful operation keeps the structure of the lines present before, apart from its exemption', () => {
        fc.assert(fc.property(sequenceArb, ([base, specs]) => {
            drive(base, specs.filter((spec) => spec.op % 9 !== 7 && spec.op % 9 !== 8), (def, step) => {
                expectRoleOutcome(step)
                if (!step.result.ok) {
                    return
                }
                const next = step.result.def
                expect(oracleSameStructure(oracleOf(def), oracleOf(next), step.exempt)).toBe(true)
                expect(structureOf(next)).toEqual(oracleOf(next))
                expectFixedPoint(next)
                if (step.name === 'insertRow' && step.draft?.kind === 'group') {
                    expect(oracleOf(next).endOf.get(id(def.nextId))).toBe(id(def.nextId + 1))
                }
                if (step.name === 'insertText' && step.fragment !== null) {
                    expectFragmentShape(def, next, step.fragment)
                }
                if (step.name === 'closeGroup' && step.target) {
                    expect(oracleOf(next).endOf.get(step.target.id)).toBe(id(def.nextId))
                }
            })
        }), { numRuns: 400 })
    })

    test('W-SI5 literals', () => {
        const group = parseDefinition('g=G=group')
        expect(setRow(group, id(0), { kind: 'check', key: 'g', label: 'G' })).toEqual({ ok: false, refusal: { code: 'changesRole', from: 'group', to: 'leaf' } })
        expect(setRaw(parseDefinition('x'), id(0), 'x=y=group')).toEqual({ ok: false, refusal: { code: 'changesRole', from: 'leaf', to: 'group' } })
    })
})

/** The structure after an edit, in the model's canonical form: a last line that is exactly '' is the trailing newline, not a row, unless the definition already had a trailing newline. */
function oracleAfterEdit(def: Definition, lines: readonly DefLine[]) {
    const kept = !def.trailingNewline && lines.length > 0 && lines[lines.length - 1].raw === '' ? lines.slice(0, -1) : lines
    return oracleStructure(parseToggleSyntax, kept.map((line) => line.raw), kept.map((line) => line.id))
}

/** A setRaw to '' followed by a group move that leaves that blank line last: the model drops it into the trailing newline. */
const blankLastExample: [string, OpSpec[]] = ['g=G=group\r\na=a=group', [
    { op: 1, a: 0, b: 0, draft: { kind: 'select', key: 'a', label: 'a', options: [] }, raw: '', fragment: '\n\n' },
    { op: 5, a: 3, b: 0, draft: { kind: 'divider', label: '' }, raw: 'x=y=group', fragment: '\n' },
]]

function legalSplice(def: Definition, index: number, removeCount: number, inserted: readonly DefLine[], exempt: StructureExemption): boolean {
    const lines = [...def.lines.slice(0, index), ...inserted, ...def.lines.slice(index + removeCount)]
    return oracleSameStructure(oracleOf(def), oracleAfterEdit(def, lines), exempt)
}

/** The first position after `index` where the unchecked splice keeps the structure, or null. */
function firstLegalAfter(def: Definition, index: number, inserted: readonly DefLine[]): Position | null {
    for (let candidate = index + 1; candidate <= def.lines.length; candidate++) {
        if (legalSplice(def, candidate, 0, inserted, {})) {
            return candidate < def.lines.length ? { before: def.lines[candidate].id } : 'end'
        }
    }
    return null
}

function fragmentLines(def: Definition, fragment: string): DefLine[] {
    const segments = fragment.split('\n')
    if (segments[segments.length - 1] === '') {
        segments.pop()
    }
    const lines = segments.map((raw, index) => lineOf(id(def.nextId + index), raw))
    const open = oracleStructure(parseToggleSyntax, segments, lines.map((line) => line.id)).openAtEnd
    const group = lines.find((line) => line.id === open)
    if (group) {
        lines.push(lineOf(id(def.nextId + lines.length), canonicalEndLine(group)))
    }
    return lines
}

describe('O-R exact refusals', () => {
    test('a structure refusal is never over-cautious, and the offered position is the first legal one', () => {
        fc.assert(fc.property(sequenceArb, ([base, specs]) => {
            drive(base, specs.filter((spec) => spec.op % 9 !== 7 && spec.op % 9 !== 8), (def, step) => {
                const result = step.result
                const refusal = result.ok === false ? result.refusal : null
                if (refusal?.code === 'changesStructure') {
                    expect(step.name).not.toBe('closeGroup')
                    expect(step.name).not.toBe('setRow')
                }
                if (step.name === 'insertRow' && step.draft?.kind === 'group' && step.anchor) {
                    const raw = canonicalLine(step.draft)
                    if (typeof raw !== 'string') {
                        return
                    }
                    const head = lineOf(id(def.nextId), raw)
                    const pair = [head, lineOf(id(def.nextId + 1), canonicalEndLine(head))]
                    const index = indexOfPosition(def, step.anchor)
                    expect(result.ok).toBe(legalSplice(def, index, 0, pair, {}))
                    if (refusal?.code === 'changesStructure') {
                        expect(refusal.firstLegal).toEqual(firstLegalAfter(def, index, pair))
                    }
                }
                if (step.name === 'insertText' && step.fragment !== null && step.anchor) {
                    if (refusal?.code === 'emptyFragment' || refusal?.code === 'unknownLine') {
                        return
                    }
                    const lines = fragmentLines(def, step.fragment)
                    const index = indexOfPosition(def, step.anchor)
                    const legalHere = legalSplice(def, index, 0, lines, {})
                    const later = firstLegalAfter(def, index, lines)
                    if (result.ok) {
                        expect(result.relocatedTo === undefined).toBe(legalHere)
                        if (!legalHere) {
                            expect(result.relocatedTo).toEqual(later)
                        }
                    } else {
                        expect(legalHere).toBe(false)
                        expect(later).toBeNull()
                        expect(refusal).toMatchObject({ code: 'changesStructure', firstLegal: null })
                    }
                }
                if (step.name === 'removeRow' && step.target && realRole(step.target.raw) === 'group') {
                    const start = def.lines.indexOf(step.target)
                    let stop = start + 1
                    while (stop < def.lines.length && realRole(def.lines[stop].raw) === 'leaf') {
                        stop++
                    }
                    if (stop < def.lines.length && realRole(def.lines[stop].raw) === 'groupEnd') {
                        stop++
                    }
                    expect(result.ok).toBe(legalSplice(def, start, stop - start, [], {}))
                    if (refusal) {
                        expect(refusal).toMatchObject({ code: 'changesStructure', firstLegal: null })
                    }
                }
                if (step.name === 'moveRow' && step.target && step.anchor && (result.ok || refusal?.code === 'changesStructure')) {
                    const start = def.lines.indexOf(step.target)
                    let stop = start
                    if (realRole(step.target.raw) === 'group') {
                        stop = start + 1
                        while (stop < def.lines.length && realRole(def.lines[stop].raw) === 'leaf') {
                            stop++
                        }
                        if (stop < def.lines.length && realRole(def.lines[stop].raw) === 'groupEnd') {
                            stop++
                        }
                        stop--
                    }
                    const target = indexOfPosition(def, step.anchor)
                    const moved = def.lines.slice(start, stop + 1)
                    const rest = [...def.lines.slice(0, start), ...def.lines.slice(stop + 1)]
                    rest.splice(target > stop ? target - moved.length : target, 0, ...moved)
                    const legal = oracleSameStructure(oracleOf(def), oracleAfterEdit(def, rest), step.exempt)
                    expect(result.ok).toBe(legal)
                }
            })
        }), { numRuns: 400, examples: [[blankLastExample]] })
    })

    test('W-SI4 and W-MV literals', () => {
        const refusal = insertRow(parseDefinition('g=G=group\na=A\ng_end=G=groupEnd'), { before: id(1) }, { kind: 'group', key: 'h', label: 'H' })
        expect(refusal).toMatchObject({ ok: false, refusal: { code: 'changesStructure', firstLegal: 'end' } })
        const stray = parseDefinition('a=A\nx_end=X=groupEnd\nb=B\ng=G=group\nc=C\ng_end=G=groupEnd')
        expect(moveRow(stray, id(1), { before: id(4) })).toMatchObject({ ok: false, refusal: { code: 'changesStructure', firstLegal: null } })
        expect(moveRow(stray, id(1), { before: id(3) }).ok).toBe(true)
    })

    test('W-MV blank-last literal: a moved group that leaves a blank line last drops it into the trailing newline', () => {
        const lf = parseDefinition('\na=a=group')
        const moved = moveRow(lf, id(1), { before: id(0) })
        expect(moved.ok).toBe(true)
        expect(oracleSameStructure(oracleOf(lf), oracleAfterEdit(lf, [lf.lines[1], lf.lines[0]]), {})).toBe(true)
        const crlfBase = parseDefinition('g=G=group\r\na=a=group')
        const emptied = setRaw(crlfBase, id(0), '')
        expect(emptied.ok).toBe(true)
        if (emptied.ok) {
            const again = moveRow(emptied.def, id(1), { before: id(0) })
            expect(again.ok).toBe(true)
            expect(oracleSameStructure(oracleOf(emptied.def), oracleAfterEdit(emptied.def, [emptied.def.lines[1], emptied.def.lines[0]]), {})).toBe(true)
        }
    })

    test('W-MV flag literal: with a trailing newline already present a last blank line stays a row, so the move is refused', () => {
        const first = setRaw(parseDefinition('g=G=group\na=a\nh=H=group\nb=b'), id(1), '')
        expect(first.ok).toBe(true)
        if (!first.ok) {
            return
        }
        const second = setRaw(first.def, id(3), '')
        expect(second.ok).toBe(true)
        if (!second.ok) {
            return
        }
        const def = second.def
        expect(def.trailingNewline).toBe(true)
        expect(moveRow(def, id(2), { before: id(1) })).toMatchObject({ ok: false, refusal: { code: 'changesStructure' } })
        const moved = [def.lines[0], def.lines[2], def.lines[1]]
        expect(oracleSameStructure(oracleOf(def), oracleAfterEdit(def, moved), {})).toBe(false)
    })

    test('W-MV exact-empty literal: a whitespace-only last line is a row, not the trailing newline', () => {
        const first = setRaw(parseDefinition('g=G=group\na=a\nh=H=group'), id(1), '  ')
        expect(first.ok).toBe(true)
        if (!first.ok) {
            return
        }
        const def = first.def
        expect(def.trailingNewline).toBe(false)
        const result = moveRow(def, id(2), { before: id(1) })
        const moved = [def.lines[0], def.lines[2], def.lines[1]]
        const legal = oracleSameStructure(oracleOf(def), oracleAfterEdit(def, moved), {})
        expect(result.ok).toBe(legal)
        expect(legal).toBe(false)
    })

    test('W-OAE literal: removing the last group leaves an earlier group open at the end', () => {
        const refusal = removeRow(parseDefinition('g=G=group\na=A\nh=H=group\nb=B'), id(2))
        expect(refusal).toMatchObject({ ok: false, refusal: { code: 'changesStructure' } })
        expect(refusal).toMatchObject({ ok: false, refusal: { affected: expect.arrayContaining([id(0)]) } })
    })
})

// ---- ids ---------------------------------------------------------------------------------------------------------

describe('O-ID ids over random sequences', () => {
    test('fresh ids come from nextId, input ids stay on their own line, and a removed id never returns', () => {
        fc.assert(fc.property(sequenceArb, ([base, specs]) => {
            let def = parseDefinition(base)
            const lineage = new Set<number>(def.lines.map((line) => line.id))
            for (const spec of specs) {
                let next: Definition
                let edited: LineId | null = null
                if (spec.op % 9 === 7 || spec.op % 9 === 8) {
                    const count = def.lines.length
                    const from = spec.a % (count + 1)
                    const to = from + (spec.b % (count - from + 1))
                    const text = [...rawsOfDef(def).slice(0, from), ...spec.fragment.split('\n'), ...rawsOfDef(def).slice(to)].join('\n') + (spec.a % 2 === 0 ? '\n' : '')
                    next = replaceText(def, text)
                    expect(textOf(next)).toBe(text)
                    expectReplaceIds(def, next)
                } else {
                    const step = runOp(def, spec)
                    if (!step || !step.result.ok) {
                        continue
                    }
                    next = step.result.def
                    edited = step.name === 'setRow' || step.name === 'setRaw' ? (step.target?.id ?? null) : null
                    for (const line of next.lines) {
                        const previous = def.lines.find((candidate) => candidate.id === line.id)
                        if (previous && line.id !== edited) {
                            expect(line).toBe(previous)
                        }
                    }
                }
                expect(next.nextId).toBeGreaterThanOrEqual(def.nextId)
                const seen = new Set<number>()
                const fresh: number[] = []
                for (const line of next.lines) {
                    expect(seen.has(line.id)).toBe(false)
                    seen.add(line.id)
                    if (!def.lines.some((candidate) => candidate.id === line.id)) {
                        expect(line.id).toBeGreaterThanOrEqual(def.nextId)
                        expect(line.id).toBeLessThan(next.nextId)
                        expect(lineage.has(line.id)).toBe(false)
                        fresh.push(line.id)
                    }
                }
                expect(next.nextId).toBeGreaterThanOrEqual(def.nextId + fresh.length)
                for (const line of next.lines) {
                    lineage.add(line.id)
                }
                def = next
            }
        }), { numRuns: 400 })
    })
})

/** replaceText keeps the ids of the common prefix and suffix, and of a same-length middle by position; else the middle is fresh. */
function expectReplaceIds(before: Definition, after: Definition) {
    const old = rawsOfDef(before)
    const next = rawsOfDef(after)
    let prefix = 0
    while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) {
        prefix++
    }
    let suffix = 0
    const cap = Math.min(old.length, next.length) - prefix
    while (suffix < cap && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) {
        suffix++
    }
    const sameLength = old.length - prefix - suffix === next.length - prefix - suffix
    next.forEach((_, position) => {
        const got = after.lines[position].id
        if (position < prefix) {
            expect(got).toBe(before.lines[position].id)
        } else if (position >= next.length - suffix) {
            expect(got).toBe(before.lines[old.length - (next.length - position)].id)
        } else if (sameLength) {
            expect(got).toBe(before.lines[position].id)
        } else {
            expect(got).toBeGreaterThanOrEqual(before.nextId)
        }
    })
}

describe('O-3 role lemma', () => {
    const sameRole: Record<Role, string[]> = {
        leaf: ['q=Q', '==divider', 'junk', '=n=caption', 'z=Z=text'],
        group: ['y=Y=group', '==group'],
        groupEnd: ['y_end=Y=groupEnd', '==groupEnd'],
    }

    test('W-SI2 literal', () => {
        const base = 'g=G=group\na=A\ng_end=G=groupEnd\nb=B'
        const before = structureOf(parseDefinition(base))
        const withLines = (entries: [number, string][]) =>
            structureOf(buildDefinition(entries.map(([lineId, raw]) => lineOf(id(lineId), raw)), false, 10))
        const leafBeforeB = withLines([[0, 'g=G=group'], [1, 'a=A'], [2, 'g_end=G=groupEnd'], [7, 'n=N'], [3, 'b=B']])
        expect(oracleSameStructure(before, leafBeforeB, {})).toBe(true)
        expect(sameStructure(before, leafBeforeB, {})).toBe(true)
        const endBeforeB = withLines([[0, 'g=G=group'], [1, 'a=A'], [2, 'g_end=G=groupEnd'], [7, 'x_end=X=groupEnd'], [3, 'b=B']])
        expect(sameStructure(before, endBeforeB, {})).toBe(true)
        const endBeforeA = withLines([[0, 'g=G=group'], [7, 'x_end=X=groupEnd'], [1, 'a=A'], [2, 'g_end=G=groupEnd'], [3, 'b=B']])
        expect(oracleSameStructure(before, endBeforeA, {})).toBe(false)
        expect(sameStructure(before, endBeforeA, {})).toBe(false)
    })

    test('same-role substitutions, leaf and stray-end deletions, leaf insertions and stray-end insertions keep the other lines', () => {
        fc.assert(fc.property(structureTextArb, fc.nat(30), fc.nat(30), fc.nat(3), (text, pos, pick, which) => {
            const def = parseDefinition(text)
            const before = structureOf(def)
            const lines = [...def.lines]
            let nextId = def.nextId
            const n = lines.length
            if (which === 0 && n > 0) {
                const index = pos % n
                const options = sameRole[roleOf(lines[index])]
                lines[index] = lineOf(lines[index].id, options[pick % options.length])
            } else if (which === 1 && n > 0) {
                const index = pos % n
                if (roleOf(lines[index]) === 'leaf' || before.stray.has(lines[index].id)) {
                    lines.splice(index, 1)
                }
            } else if (which === 2) {
                lines.splice(pos % (n + 1), 0, lineOf(id(nextId++), sameRole.leaf[pick % sameRole.leaf.length]))
            } else if (which === 3) {
                const index = pos % (n + 1)
                const prefix = lines.slice(0, index)
                const open = oracleStructure(parseToggleSyntax, prefix.map((line) => line.raw), prefix.map((line) => line.id)).openAtEnd
                if (open === null) {
                    lines.splice(index, 0, lineOf(id(nextId++), sameRole.groupEnd[pick % sameRole.groupEnd.length]))
                }
            }
            const after = buildDefinition(lines, def.trailingNewline, nextId)
            expect(oracleSameStructure(before, structureOf(after), {})).toBe(true)
            expect(sameStructure(before, structureOf(after), {})).toBe(true)
            expect(structureOf(after)).toEqual(oracleOf(after))
        }), { numRuns: 500 })
    })
})
