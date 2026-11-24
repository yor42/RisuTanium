// What the lorebook scan does with each leading `@@` decorator line, as a static model: the argument rule of every handler,
// whether its callback returns false (which makes the following `@@@` lines run), and a parser for the leading decorator
// block that follows ccardlib's own `decorator.parse` exactly while keeping raw offsets. A leaf module: it imports only the
// scan's name list, so the Studio editor and the lore recall can share it without touching the scan.
import { LORE_SCAN_DECORATORS, type LoreScanDecoratorName } from './loreScanDecorators'

export type DecoratorArg =
    | { kind: 'none' }
    | { kind: 'int'; min: number | null }
    | { kind: 'choice'; values: readonly string[]; prefix: string | null; missing: 'ignored' | 'throws' }
    | { kind: 'number' }
    | { kind: 'list' }
    | { kind: 'text' }

export interface DecoratorRow {
    /** The argument rule: `int` is `parseInt(args[0])` with NaN or a value below `min` refused; `number` reads the integer and never refuses. */
    readonly arg: DecoratorArg
    /** True exactly for the `int` and `choice` rows: a missing or refused argument is a mistake worth a warning. */
    readonly required: boolean
    /** Syntax hint for autocomplete, for example `N` or `user|assistant|system`. */
    readonly hint: string | null
    /** An argument the handler accepts; empty for a row without arguments. */
    readonly example: string
    /** An argument the handler refuses (`int` and `choice` rows), else null. */
    readonly badExample: string | null
    /** The handler always returns false, so a following `@@@` line runs. */
    readonly returnsIgnored: boolean
    /** Whether the decorator changes the scan's result at all. */
    readonly effect: 'some' | 'none'
    readonly deprecated: boolean
}

const PLAIN: DecoratorRow = {
    arg: { kind: 'none' },
    required: false,
    hint: null,
    example: '',
    badExample: null,
    returnsIgnored: false,
    effect: 'some',
    deprecated: false,
}

function intRow(example: string, min: number | null = null): DecoratorRow {
    return { ...PLAIN, arg: { kind: 'int', min }, required: true, hint: 'N', example, badExample: 'x' }
}

function choiceRow(values: readonly string[], prefix: string | null, missing: 'ignored' | 'throws', example: string, bad: string): DecoratorRow {
    const hint = [...values, ...(prefix === null ? [] : [`${prefix}*`])].join('|')
    return { ...PLAIN, arg: { kind: 'choice', values, prefix, missing }, required: true, hint, example, badExample: bad }
}

const IGNORED: DecoratorRow = { ...PLAIN, returnsIgnored: true }
const INERT: DecoratorRow = { ...PLAIN, returnsIgnored: true, effect: 'none' }

export const LORE_DECORATORS: Readonly<Record<LoreScanDecoratorName, DecoratorRow>> = {
    end: { ...PLAIN, deprecated: true },
    activate_only_after: intRow('1'),
    activate_only_every: intRow('1'),
    keep_activate_after_match: IGNORED,
    dont_activate_after_match: IGNORED,
    depth: intRow('1'),
    reverse_depth: intRow('1'),
    instruct_depth: INERT,
    reverse_instruct_depth: INERT,
    instruct_scan_depth: INERT,
    role: choiceRow(['user', 'assistant', 'system'], null, 'ignored', 'user', 'bot'),
    scan_depth: intRow('1', 0),
    is_greeting: intRow('0'),
    position: choiceRow(['after_desc', 'before_desc', 'personality', 'scenario'], 'pt_', 'throws', 'after_desc', 'nowhere'),
    inject_lore: { ...PLAIN, arg: { kind: 'text' }, hint: 'text', example: 'x' },
    inject_at: { ...PLAIN, arg: { kind: 'text' }, hint: 'text', example: 'x' },
    inject_replace: { ...PLAIN, arg: { kind: 'text' }, hint: 'text', example: 'x' },
    inject_prepend: { ...PLAIN, arg: { kind: 'text' }, hint: 'text', example: 'x' },
    ignore_on_max_context: PLAIN,
    additional_keys: { ...PLAIN, arg: { kind: 'list' }, hint: 'a, b', example: 'a, b' },
    exclude_keys: { ...PLAIN, arg: { kind: 'list' }, hint: 'a, b', example: 'a, b' },
    exclude_keys_all: { ...PLAIN, arg: { kind: 'list' }, hint: 'a, b', example: 'a, b' },
    match_full_word: PLAIN,
    match_partial_word: PLAIN,
    is_user_icon: INERT,
    activate: PLAIN,
    dont_activate: PLAIN,
    disable_ui_prompt: choiceRow(['post_history_instructions', 'system_prompt'], null, 'ignored', 'system_prompt', 'foo'),
    probability: { ...PLAIN, arg: { kind: 'number' }, hint: 'N', example: '50' },
    priority: { ...PLAIN, arg: { kind: 'number' }, hint: 'N', example: '5' },
    unrecursive: PLAIN,
    recursive: PLAIN,
    no_recursive_search: PLAIN,
}

const KNOWN: ReadonlySet<string> = new Set<string>(LORE_SCAN_DECORATORS)

/** The row for a decorator name the scan handles, else null. Own names only: `__proto__` and `constructor` are not decorators. */
export function decoratorRow(name: string): DecoratorRow | null {
    return KNOWN.has(name) ? LORE_DECORATORS[name as LoreScanDecoratorName] : null
}

/** What a handler's return does to the rest of the block: `ignored` is `false` (a following `@@@` line runs), `throws` aborts the scan. */
export type DecoratorResult = 'continue' | 'ignored' | 'throws'

export function decoratorResult(name: string, args: readonly string[]): DecoratorResult {
    const row = decoratorRow(name)
    if (row === null || row.returnsIgnored) return 'ignored'
    const a0 = args[0]
    switch (row.arg.kind) {
        case 'int': {
            const v = parseInt(a0 ?? '')
            return Number.isNaN(v) || (row.arg.min !== null && v < row.arg.min) ? 'ignored' : 'continue'
        }
        case 'choice':
            if (a0 === undefined) return row.arg.missing === 'throws' ? 'throws' : 'ignored'
            return row.arg.values.includes(a0) || (row.arg.prefix !== null && a0.startsWith(row.arg.prefix)) ? 'continue' : 'ignored'
        default:
            return 'continue'
    }
}

export interface BlockLine {
    /** 0-based index in `content.split('\n')`. */
    readonly line: number
    /** Offset of the raw line's first character. */
    readonly start: number
    /** First non-whitespace character. */
    readonly textStart: number
    /** One past the last non-whitespace character; a trailing '\r' is outside it. */
    readonly textEnd: number
    /** Offset of the terminating '\n', or `content.length` for the last line. */
    readonly end: number
    /** The trimmed line as written (`@@@end` stays as written). */
    readonly text: string
    /** Starts with `@@@` and is not exactly `@@@end`, which always runs. */
    readonly fallback: boolean
    /** The name ccardlib reports; empty for a reset line (`@@` or `@@ x`). */
    readonly name: string
    readonly args: readonly string[]
}

export interface DecoratorBlock {
    /** The leading block, in order. */
    readonly lines: readonly BlockLine[]
    /** First raw line after the block that lies inside the trimmed content, else null. */
    readonly bodyLine: number | null
    readonly bodyStart: number | null
}

const LEADING_SPACE = /^\s*/

/** Mirrors ccardlib's `decorator.parse`: the content is trimmed first, so leading blank lines never end the block. */
export function parseDecoratorBlock(content: string): DecoratorBlock {
    const raw: { start: number; end: number; text: string }[] = []
    let pos = 0
    while (true) {
        const nl = content.indexOf('\n', pos)
        const end = nl === -1 ? content.length : nl
        raw.push({ start: pos, end, text: content.slice(pos, end) })
        if (nl === -1) break
        pos = nl + 1
    }
    let k = 0
    while (k < raw.length && raw[k].text.trim() === '') k++
    const lines: BlockLine[] = []
    for (; k < raw.length; k++) {
        const r = raw[k]
        const text = r.text.trim()
        if (!text.startsWith('@@')) break
        const norm = text === '@@@end' ? '@@end' : text
        const fallback = norm.startsWith('@@@')
        const found = norm.indexOf(' ')
        const sp = found === -1 ? norm.length : found
        const textStart = r.start + (LEADING_SPACE.exec(r.text)?.[0].length ?? 0)
        lines.push({
            line: k,
            start: r.start,
            textStart,
            textEnd: textStart + text.length,
            end: r.end,
            text,
            fallback,
            name: norm.slice(fallback ? 3 : 2, sp),
            args: norm.slice(sp).split(',').map((s) => s.trim()).filter((s) => s !== ''),
        })
    }
    if (k >= raw.length || raw.slice(k).every((r) => r.text.trim() === '')) return { lines, bodyLine: null, bodyStart: null }
    return { lines, bodyLine: k, bodyStart: raw[k].start }
}

/** What ccardlib's `decorator.parse` returns as the body. */
export function decoratorBody(content: string): string {
    const { bodyStart } = parseDecoratorBlock(content)
    return bodyStart === null ? '' : content.slice(bodyStart).trim()
}

/** Which block lines the scan runs (a skipped `@@@` line leaves the ignored state alone) and the index of the line that throws. */
export function runBlock(block: DecoratorBlock): { runs: readonly boolean[]; threw: number | null } {
    let ignored = false
    const runs: boolean[] = []
    let threw: number | null = null
    for (const [k, l] of block.lines.entries()) {
        if (threw !== null) {
            runs.push(false)
            continue
        }
        if (l.fallback && !ignored) {
            runs.push(false)
            continue
        }
        runs.push(true)
        if (l.name === '') {
            ignored = false
            continue
        }
        const r = decoratorResult(l.name, l.args)
        if (r === 'throws') {
            threw = k
            continue
        }
        ignored = r === 'ignored'
    }
    return { runs, threw }
}

export interface ExecutedDecorator {
    readonly line: number
    readonly name: string
    readonly args: readonly string[]
    readonly result: DecoratorResult
}

export interface StaticRun {
    /** The callbacks ccardlib makes, in order; a reset line makes none and the throwing callback is included. */
    readonly executed: readonly ExecutedDecorator[]
    readonly threw: boolean
    /** The body ccardlib returns; null after a throw, because the scan never reaches it. */
    readonly body: string | null
}

export function staticRun(content: string): StaticRun {
    const block = parseDecoratorBlock(content)
    const { runs, threw } = runBlock(block)
    const executed = block.lines.flatMap((l, k): ExecutedDecorator[] =>
        runs[k] && l.name !== '' ? [{ line: l.line, name: l.name, args: l.args, result: decoratorResult(l.name, l.args) }] : [])
    const body = block.bodyStart === null ? '' : content.slice(block.bodyStart).trim()
    return { executed, threw: threw !== null, body: threw !== null ? null : body }
}
