/**
 * The lore-entry content field's decorator support, free of the DOM: the probability line a form control reads and
 * writes, the decorator warnings, the colour notes and the `@@` autocomplete.
 *
 * Invariants:
 * - Every read and write is built on the scan's own model (`loreDecoratorTable`), so what the control shows is what the
 *   scan uses.
 * - A write changes the content in exactly one place and leaves every other byte alone, and it never changes the body,
 *   whether the scan throws, or the executed decorator sequence apart from probability lines.
 */
import { LORE_SCAN_DECORATORS, type LoreScanDecoratorName } from '../../process/loreScanDecorators'
import {
    decoratorResult,
    decoratorRow,
    parseDecoratorBlock,
    runBlock,
    staticRun,
    LORE_DECORATORS,
    type BlockLine,
    type StaticRun,
} from '../../process/loreDecoratorTable'
import type { Note } from './highlightSpans'
import type { MacroTrigger, PickItem, PickSource } from './macroPick'
import type { ExtraProblem, ExtraProblemKind } from './problemsModel'

export type ProbabilityRead =
    | { kind: 'none' }
    /** `value` is `parseInt(args[0])` as the scan reads it and may lie outside 0..100. */
    | { kind: 'one'; value: number; line: number }
    /** `parseInt` gives NaN (a missing argument included): the line never blocks. */
    | { kind: 'unreadable'; line: number }
    | { kind: 'many'; reason: 'several' | 'fallback' }

export function probabilityEditable(read: ProbabilityRead): boolean {
    return read.kind === 'none' || read.kind === 'one'
}

export function readProbabilityLine(content: string): ProbabilityRead {
    const { lines } = parseDecoratorBlock(content)
    if (lines.some((l) => l.fallback && l.name === 'probability')) return { kind: 'many', reason: 'fallback' }
    const found = lines.filter((l) => !l.fallback && l.name === 'probability')
    if (found.length === 0) return { kind: 'none' }
    if (found.length > 1) return { kind: 'many', reason: 'several' }
    const value = parseInt(found[0].args[0] ?? '')
    return Number.isNaN(value) ? { kind: 'unreadable', line: found[0].line } : { kind: 'one', value, line: found[0].line }
}

export function clampProbability(value: number): number | null {
    return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null
}

/** The line break the content already uses: CRLF when its first `\n` follows a `\r`. */
function eolOf(content: string): '\n' | '\r\n' {
    const nl = content.indexOf('\n')
    return nl > 0 && content[nl - 1] === '\r' ? '\r\n' : '\n'
}

/** The content without one block line: the raw line and its own `\n`, or for the last line the break before it. */
function removeLine(content: string, target: BlockLine): string {
    if (target.end < content.length) return content.slice(0, target.start) + content.slice(target.end + 1)
    if (target.start === 0) return ''
    const cut = content[target.start - 2] === '\r' ? target.start - 2 : target.start - 1
    return content.slice(0, cut)
}

/** The scan sees the same body, the same throw and the same executed decorators (name, args, result) apart from probability lines. */
function sameViewWithoutProbability(a: StaticRun, b: StaticRun): boolean {
    if (a.threw !== b.threw || a.body !== b.body) return false
    const ea = a.executed.filter((e) => e.name !== 'probability')
    const eb = b.executed.filter((e) => e.name !== 'probability')
    return ea.length === eb.length && ea.every((e, i) => e.name === eb[i].name && e.result === eb[i].result
        && e.args.length === eb[i].args.length && e.args.every((x, j) => x === eb[i].args[j]))
}

type ClearPlan = { kind: 'none' } | { kind: 'remove'; result: string } | { kind: 'keep'; result: string }

const KEPT_LINE = '@@probability 100'

/**
 * Clear keeps `@@probability 100` (a value that never blocks) where the next block line is a fallback, so the layout the
 * author wrote stays, or where removing the line would change the body, the throw or the executed non-probability
 * decorators. Everywhere else it removes the line.
 */
function clearPlan(content: string): ClearPlan {
    const read = readProbabilityLine(content)
    if (read.kind !== 'one') return { kind: 'none' }
    const block = parseDecoratorBlock(content)
    const at = block.lines.findIndex((l) => l.line === read.line)
    if (at === -1) return { kind: 'none' }
    const target = block.lines[at]
    const removed = removeLine(content, target)
    const fallbackFollows = block.lines[at + 1]?.fallback === true
    if (!fallbackFollows && sameViewWithoutProbability(staticRun(content), staticRun(removed))) return { kind: 'remove', result: removed }
    return {
        kind: 'keep',
        result: target.text === KEPT_LINE ? content : content.slice(0, target.textStart) + KEPT_LINE + content.slice(target.textEnd),
    }
}

/** Whether Clear would write `@@probability 100` instead of removing the line. */
export function probabilityClearKeeps(content: string): boolean {
    return clearPlan(content).kind === 'keep'
}

/**
 * The content with its `@@probability` line set (a number), or cleared (`null`). The same string comes back when nothing
 * is to be written: several lines, a fallback line, an unreadable value, an unchanged value or a non-finite number.
 */
export function writeProbabilityLine(content: string, value: number | null): string {
    if (value === null) {
        const plan = clearPlan(content)
        return plan.kind === 'none' ? content : plan.result
    }
    const read = readProbabilityLine(content)
    if (!probabilityEditable(read)) return content
    const n = clampProbability(value)
    if (n === null) return content
    const block = parseDecoratorBlock(content)
    const line = `@@probability ${n}`
    if (read.kind === 'one') {
        if (read.value === n) return content
        const target = block.lines.find((l) => l.line === read.line)
        if (target === undefined) return content
        return content.slice(0, target.textStart) + line + content.slice(target.textEnd)
    }
    const eol = eolOf(content)
    if (block.lines.length === 0) return line + eol + content
    const last = block.lines[block.lines.length - 1]
    if (last.end < content.length) return content.slice(0, last.end + 1) + line + eol + content.slice(last.end + 1)
    return content + eol + line
}

export type LoreDecoratorKind =
    | 'unknown' | 'afterText' | 'badArg' | 'argMissing' | 'probabilityNaN' | 'priorityNaN'
    | 'ignored' | 'fallback' | 'probabilityMany' | 'deprecated'

export interface LoreDecoratorWarning {
    /** W1 to W6 as in the Studio lore spec; `D` is the deprecated-form info. */
    code: 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W6' | 'D'
    kind: LoreDecoratorKind
    severity: 'error' | 'warning' | 'info'
    /** 1-based, as problem rows count lines. */
    line: number
    /** The line's trimmed span. */
    start: number
    end: number
    /** The decorator name; empty for a reset line and for a line after the block. */
    name: string
}

function warningAt(l: BlockLine, code: LoreDecoratorWarning['code'], kind: LoreDecoratorKind, severity: LoreDecoratorWarning['severity']): LoreDecoratorWarning {
    return { code, kind, severity, line: l.line + 1, start: l.textStart, end: l.textEnd, name: l.name }
}

export function loreDecoratorWarnings(text: string): LoreDecoratorWarning[] {
    const block = parseDecoratorBlock(text)
    const { runs } = runBlock(block)
    const probabilityRuns = block.lines.filter((l, k) => runs[k] && l.name === 'probability').length
    const out: LoreDecoratorWarning[] = []
    block.lines.forEach((l, k) => {
        if (l.name === '') {
            if (l.fallback) out.push(warningAt(l, 'W5', 'fallback', 'info'))
            return
        }
        const row = decoratorRow(l.name)
        if (row === null) {
            out.push(warningAt(l, 'W1', 'unknown', 'warning'))
            if (l.fallback) out.push(warningAt(l, 'W5', 'fallback', 'info'))
            return
        }
        if (row.deprecated) out.push(warningAt(l, 'D', 'deprecated', 'info'))
        if (row.effect === 'none') out.push(warningAt(l, 'W4', 'ignored', 'warning'))
        if (row.arg.kind === 'int') {
            if (decoratorResult(l.name, l.args) === 'ignored') out.push(warningAt(l, 'W3', 'badArg', 'warning'))
        } else if (row.arg.kind === 'choice') {
            if (l.args[0] === undefined && row.arg.missing === 'throws') out.push(warningAt(l, 'W3', 'argMissing', 'error'))
            else if (decoratorResult(l.name, l.args) === 'ignored') out.push(warningAt(l, 'W3', 'badArg', 'warning'))
        } else if (row.arg.kind === 'number' && Number.isNaN(parseInt(l.args[0] ?? ''))) {
            if (l.name === 'probability') out.push(warningAt(l, 'W3', 'probabilityNaN', 'warning'))
            else if (l.name === 'priority') out.push(warningAt(l, 'W3', 'priorityNaN', 'warning'))
        }
        if (l.fallback) out.push(warningAt(l, 'W5', 'fallback', 'info'))
        if (runs[k] && l.name === 'probability' && probabilityRuns >= 2) out.push(warningAt(l, 'W6', 'probabilityMany', 'info'))
    })
    if (block.bodyLine !== null && block.bodyStart !== null) {
        let pos = block.bodyStart
        let line = block.bodyLine
        while (pos <= text.length) {
            const nl = text.indexOf('\n', pos)
            const end = nl === -1 ? text.length : nl
            const raw = text.slice(pos, end)
            const trimmed = raw.trim()
            if (trimmed.startsWith('@@')) {
                const start = pos + (raw.length - raw.trimStart().length)
                out.push({ code: 'W2', kind: 'afterText', severity: 'warning', line: line + 1, start, end: start + trimmed.length, name: '' })
            }
            if (nl === -1) break
            pos = nl + 1
            line++
        }
    }
    return out
}

export interface LoreDecoratorCopy {
    unknown(name: string): string
    afterText(): string
    badArg(name: string): string
    argMissing(name: string): string
    probabilityNaN(): string
    priorityNaN(): string
    probabilityMany(): string
    ignored(name: string): string
    fallback(): string
    deprecated(): string
    help(name: LoreScanDecoratorName): string
    /** The picker's live count. */
    matches(n: number): string
    /** The picker list's accessible name. */
    listLabel(): string
}

function messageOf(w: LoreDecoratorWarning, copy: LoreDecoratorCopy): string {
    switch (w.kind) {
        case 'unknown': return copy.unknown(w.name)
        case 'afterText': return copy.afterText()
        case 'badArg': return copy.badArg(w.name)
        case 'argMissing': return copy.argMissing(w.name)
        case 'probabilityNaN': return copy.probabilityNaN()
        case 'priorityNaN': return copy.priorityNaN()
        case 'ignored': return copy.ignored(w.name)
        case 'fallback': return copy.fallback()
        case 'probabilityMany': return copy.probabilityMany()
        case 'deprecated': return copy.deprecated()
    }
}

export function loreDecoratorProblems(text: string, copy: LoreDecoratorCopy): ExtraProblem[] {
    return loreDecoratorWarnings(text).map((w): ExtraProblem => {
        const kind: ExtraProblemKind = `x-deco-${w.kind}`
        return { kind, severity: w.severity, start: w.start, end: w.end, message: messageOf(w, copy) }
    })
}

/** One colour note per decorator line of the leading block; a line after the block gets none. */
export function loreDecoratorNotes(text: string): Note[] {
    return parseDecoratorBlock(text).lines.map((l): Note => ({ start: l.textStart, end: l.textEnd, note: 'decorator' }))
}

const NAME_AT_CARET = /^\s*@@@?([A-Za-z0-9_]*)$/

/** The `@@name` being typed on a line of the leading block, as a trigger whose start is the name's two `@`. */
export function decoratorTrigger(beforeCaret: string): MacroTrigger | null {
    const lineStart = beforeCaret.lastIndexOf('\n') + 1
    const found = NAME_AT_CARET.exec(beforeCaret.slice(lineStart))
    if (found === null) return null
    const prior = beforeCaret.slice(0, lineStart).split('\n')
    prior.pop()
    let k = 0
    while (k < prior.length && prior[k].trim() === '') k++
    for (; k < prior.length; k++) if (!prior[k].trim().startsWith('@@')) return null
    const nameStart = lineStart + found[0].length - found[1].length
    return { start: nameStart - 2, query: found[1] }
}

/** One item per decorator that has an effect and is not deprecated, in the scan's name order. */
export function decoratorPicks(copy: LoreDecoratorCopy): PickItem[] {
    const items: PickItem[] = []
    for (const name of LORE_SCAN_DECORATORS) {
        const row = LORE_DECORATORS[name]
        if (row.deprecated || row.effect === 'none') continue
        const text = `@@${name} `
        items.push({
            key: `deco:${name}`,
            name,
            aliases: [],
            label: copy.help(name),
            usage: row.hint === null ? `@@${name}` : `@@${name} ${row.hint}`,
            insertion: { text, caret: text.length },
            group: null,
        })
    }
    return items
}

export function loreDecoratorPickSource(copy: LoreDecoratorCopy): PickSource {
    return {
        trigger: decoratorTrigger,
        items: () => decoratorPicks(copy),
        matches: (n) => copy.matches(n),
        label: () => copy.listLabel(),
    }
}
