import type { CbsProblem } from './cbsCheck'

/**
 * The lexical colouring of one long-text field, free of the DOM.
 *
 * Invariants:
 * - Spans are cosmetic: sorted, disjoint, non-empty and inside the text they were made for. Nothing here decides
 *   what a macro means; underlines come only from marks that a checker supplies.
 * - `segmentsOf` always cuts the text it is given into pieces whose concatenation is that text (Invariant S), so an
 *   overlay built from the pieces shows exactly the field's text however stale or odd the spans and marks are.
 * - A span or mark that an edit touches is dropped, never stretched: a stale mark must not point at replaced text.
 */

export type SpanKind = 'brace' | 'name' | 'sep' | 'arg' | 'block' | 'comment' | 'deprecated'
export type Span = { start: number; end: number; kind: SpanKind }
export type Mark = { start: number; end: number; severity: CbsProblem['severity'] }
// A display-only note: the speaker prefix of an example turn, or the part of it the engine ignores.
export type Note = { start: number; end: number; note: 'speaker' | 'notUsed' | 'decorator' }
export type Segment = { text: string; kind: SpanKind | null; severity: Mark['severity'] | null; note?: Note['note'] | null }
export type Edit = { start: number; removed: number; inserted: number }

// Above this many characters the field is coloured only inside a window, and not while typing.
export const WINDOW_LIMIT = 20_000

const ROLE_TAGS = ['<char>', '<user>', '<bot>']

function roleTagAt(text: string, at: number, limit: number): string | null {
    for (const tag of ROLE_TAGS) {
        if (at + tag.length <= limit && text.slice(at, at + tag.length).toLowerCase() === tag) return tag
    }
    return null
}

type Frame = { segStart: number; head: boolean }

function flushSegment(text: string, frame: Frame, end: number, spans: Span[]): void {
    const start = frame.segStart
    if (end <= start) return
    if (!frame.head) {
        spans.push({ start, end, kind: 'arg' })
        return
    }
    const first = text[start]
    if (first !== '#' && first !== '/' && first !== ':') {
        spans.push({ start, end, kind: 'name' })
        return
    }
    // A block head is the keyword; whatever follows the first space is its argument.
    let space = start
    while (space < end && !/\s/.test(text[space])) space++
    spans.push({ start, end: space, kind: 'block' })
    if (end > space) spans.push({ start: space, end, kind: 'arg' })
}

/** Lexical spans of `text` inside `[from, to)`: macros, separators, arguments, block heads, comments and role tags. */
export function tokenSpans(text: string, from: number, to: number): Span[] {
    const lo = Math.max(0, Math.min(from, text.length))
    const hi = Math.max(lo, Math.min(to, text.length))
    const spans: Span[] = []
    const stack: Frame[] = []
    let i = lo
    while (i < hi) {
        const ch = text[i]
        if (ch === '<') {
            const tag = roleTagAt(text, i, hi)
            if (tag !== null) {
                const top = stack[stack.length - 1]
                if (top) flushSegment(text, top, i, spans)
                spans.push({ start: i, end: i + tag.length, kind: 'name' })
                if (top) top.segStart = i + tag.length
                i += tag.length
                continue
            }
        } else if (ch === '{' && text[i + 1] === '{' && i + 2 <= hi) {
            if (text[i + 2] === '/' && text[i + 3] === '/') {
                const close = text.indexOf('}}', i + 4)
                if (close >= 0 && close + 2 <= hi) {
                    const top = stack[stack.length - 1]
                    if (top) flushSegment(text, top, i, spans)
                    spans.push({ start: i, end: close + 2, kind: 'comment' })
                    if (top) top.segStart = close + 2
                    i = close + 2
                    continue
                }
            }
            const top = stack[stack.length - 1]
            if (top) flushSegment(text, top, i, spans)
            spans.push({ start: i, end: i + 2, kind: 'brace' })
            stack.push({ segStart: i + 2, head: true })
            i += 2
            continue
        } else if (stack.length > 0 && ch === '}' && text[i + 1] === '}' && i + 2 <= hi) {
            const top = stack.pop() as Frame
            flushSegment(text, top, i, spans)
            spans.push({ start: i, end: i + 2, kind: 'brace' })
            const parent = stack[stack.length - 1]
            if (parent) parent.segStart = i + 2
            i += 2
            continue
        } else if (stack.length > 0 && ch === ':' && text[i + 1] === ':' && i + 2 <= hi) {
            const top = stack[stack.length - 1]
            flushSegment(text, top, i, spans)
            spans.push({ start: i, end: i + 2, kind: 'sep' })
            top.head = false
            top.segStart = i + 2
            i += 2
            continue
        }
        i++
    }
    return spans
}

const SEVERITY_RANK: Record<Mark['severity'], number> = { info: 1, warning: 2, error: 3 }

/** Cuts `text` at every span and mark boundary. The pieces concatenate to `text`; out-of-range items are clamped. */
export function segmentsOf(text: string, spans: readonly Span[], marks: readonly Mark[], notes: readonly Note[] = []): Segment[] {
    const len = text.length
    if (len === 0) return []
    const cuts = new Set<number>([0, len])
    const clamp = (n: number): number => Math.max(0, Math.min(len, n))
    for (const s of spans) { cuts.add(clamp(s.start)); cuts.add(clamp(s.end)) }
    for (const m of marks) { cuts.add(clamp(m.start)); cuts.add(clamp(m.end)) }
    for (const n of notes) { cuts.add(clamp(n.start)); cuts.add(clamp(n.end)) }
    const points = [...cuts].sort((a, b) => a - b)
    const segments: Segment[] = []
    let spanAt = 0
    for (let k = 0; k + 1 < points.length; k++) {
        const start = points[k]
        const end = points[k + 1]
        while (spanAt < spans.length && clamp(spans[spanAt].end) <= start) spanAt++
        const span = spanAt < spans.length ? spans[spanAt] : null
        const kind = span !== null && clamp(span.start) <= start && clamp(span.end) >= end ? span.kind : null
        let severity: Mark['severity'] | null = null
        for (const m of marks) {
            if (clamp(m.start) <= start && clamp(m.end) >= end && (severity === null || SEVERITY_RANK[m.severity] > SEVERITY_RANK[severity])) severity = m.severity
        }
        let note: Note['note'] | null = null
        for (const n of notes) {
            if (clamp(n.start) <= start && clamp(n.end) >= end) { note = n.note; break }
        }
        segments.push({ text: text.slice(start, end), kind, severity, note })
    }
    return segments
}

/** The one replaced range that turns `prev` into `next`: common prefix and suffix are kept. */
export function editBetween(prev: string, next: string): Edit {
    const shortest = Math.min(prev.length, next.length)
    let start = 0
    while (start < shortest && prev.charCodeAt(start) === next.charCodeAt(start)) start++
    let tail = 0
    while (tail < shortest - start && prev.charCodeAt(prev.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)) tail++
    return { start, removed: prev.length - start - tail, inserted: next.length - start - tail }
}

/** Items before the edit stay, items after it move by the length change, items the edit touches are dropped. */
export function shiftSpans<T extends { start: number; end: number }>(items: readonly T[], edit: Edit): T[] {
    const oldEnd = edit.start + edit.removed
    const delta = edit.inserted - edit.removed
    const out: T[] = []
    for (const item of items) {
        if (item.end <= edit.start) out.push(item)
        else if (item.start >= oldEnd) out.push({ ...item, start: item.start + delta, end: item.end + delta })
    }
    return out
}

/** The part of a long text to colour: all of it up to `WINDOW_LIMIT`, else the visible part plus one viewport each side. */
export function colourWindow(len: number, view: { scrollTop: number; scrollHeight: number; clientHeight: number }): { from: number; to: number } {
    if (len <= WINDOW_LIMIT) return { from: 0, to: len }
    if (!(view.scrollHeight > 0)) return { from: 0, to: WINDOW_LIMIT }
    const perPixel = len / view.scrollHeight
    const from = Math.floor((view.scrollTop - view.clientHeight) * perPixel)
    const to = Math.ceil((view.scrollTop + 2 * view.clientHeight) * perPixel)
    const lo = Math.max(0, Math.min(len, from))
    return { from: lo, to: Math.max(lo, Math.min(len, to)) }
}

// Update durations are read only through this clock, so a test can drive the budget without real time.
let updateClock: () => number = () => performance.now()

export function setUpdateClockForTests(now: (() => number) | null): void {
    updateClock = now ?? (() => performance.now())
}

/** Runs `update` and returns how long it took by the update clock. */
export function measureUpdate(update: () => void): number {
    const begin = updateClock()
    update()
    return updateClock() - begin
}

export const UPDATE_BUDGET_MS = 32
export const UPDATE_BUDGET_STREAK = 2

/** Trips after `streak` consecutive updates over `limitMs`; a quick update resets the streak. A tripped budget stays tripped. */
export function createUpdateBudget(limitMs: number = UPDATE_BUDGET_MS, streak: number = UPDATE_BUDGET_STREAK): { record(ms: number): boolean; readonly tripped: boolean } {
    let slow = 0
    let tripped = false
    return {
        record(ms) {
            slow = ms > limitMs ? slow + 1 : 0
            if (slow >= streak) tripped = true
            return tripped
        },
        get tripped() {
            return tripped
        },
    }
}
