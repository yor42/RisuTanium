/**
 * Pure rules for editing an example-dialogue text one card at a time. A card
 * edit changes only the bytes of the lines it touched: every other byte, marker
 * spelling and line ending stays as stored.
 */
import {
    detectEol,
    isExampleMarkerLine,
    joinExampleText,
    newExampleBlock,
    splitExampleText,
} from './exampleBlocks'
import { lf } from './fieldWrite'
import { editBetween } from './highlightSpans'

export type Eol = '\n' | '\r\n'

/** `start` and `end` are raw offsets: the span is the text after the marker line, up to the next marker line. */
export type CardSpan = { kind: 'opening' | 'block'; markerStart: number | null; start: number; end: number }

/** A raw range [start,end); a marker line starting inside it is body text. */
export type Hold = { start: number; end: number }

/** The cards of `text`: a non-empty opening, then one per marker line. A held marker line merges into the previous card. */
export function cardSpans(text: string, hold: Hold | null): CardSpan[] {
    const lines = text.split('\n')
    const spans: CardSpan[] = []
    let offset = 0
    let current: CardSpan = { kind: 'opening', markerStart: null, start: 0, end: 0 }
    for (let i = 0; i < lines.length; i++) {
        const length = lines[i].length + (i < lines.length - 1 ? 1 : 0)
        const held = hold !== null && offset >= hold.start && offset < hold.end
        if (isExampleMarkerLine(lines[i]) && !held) {
            current.end = offset
            spans.push(current)
            current = { kind: 'block', markerStart: offset, start: offset + length, end: 0 }
        }
        offset += length
    }
    current.end = text.length
    spans.push(current)
    return spans.filter((span) => !(span.kind === 'opening' && span.end === span.start))
}

/** A followed card drops exactly one final terminator; the last card is its raw slice. */
export function cardText(text: string, spans: readonly CardSpan[], i: number): string {
    const raw = text.slice(spans[i].start, spans[i].end)
    if (i === spans.length - 1) {
        return raw
    }
    if (raw.endsWith('\r\n')) {
        return raw.slice(0, -2)
    }
    return raw.endsWith('\n') ? raw.slice(0, -1) : raw
}

/** The raw index of the LF offset `lfOffset`: `\r\n` and a lone `\r` each count as one. */
export function rawIndexOf(raw: string, lfOffset: number): number {
    let index = 0
    let counted = 0
    while (counted < lfOffset && index < raw.length) {
        index += raw[index] === '\r' && raw[index + 1] === '\n' ? 2 : 1
        counted++
    }
    return index
}

/**
 * Replaces only the raw range the LF edit touches; the inserted LFs take `eol`.
 * A lone CR left next to an inserted LF would read as one CRLF, so it is
 * absorbed into the replacement. `lf(result) === nextLf`.
 */
export function spliceLf(raw: string, nextLf: string, eol: Eol): string {
    const edit = editBetween(lf(raw), nextLf)
    let from = rawIndexOf(raw, edit.start)
    const to = rawIndexOf(raw, edit.start + edit.removed)
    let replacement = nextLf.slice(edit.start, edit.start + edit.inserted).replace(/\n/g, eol)
    while (from > 0 && raw[from - 1] === '\r' && (replacement + raw.slice(to)).startsWith('\n')) {
        from--
        replacement = eol + replacement
    }
    return raw.slice(0, from) + replacement + raw.slice(to)
}

/**
 * The whole text with card `i` showing `nextLf`. Marker lines and other cards
 * are never rewritten, except that text after an unterminated marker line
 * first gets one eol so it cannot fuse with the marker.
 */
export function writeCardText(text: string, spans: readonly CardSpan[], i: number, nextLf: string): string {
    const eol = detectEol(text)
    const span = spans[i]
    const raw = text.slice(span.start, span.end)
    const followed = i < spans.length - 1
    let terminator = ''
    if (followed) {
        terminator = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : ''
    }
    let display = spliceLf(raw.slice(0, raw.length - terminator.length), nextLf, eol)
    // Lone CRs left at the end of the body would fuse with an LF terminator into one CRLF, so each becomes one eol.
    if (terminator === '\n') {
        let crs = 0
        while (crs < display.length && display[display.length - 1 - crs] === '\r') crs++
        display = display.slice(0, display.length - crs) + eol.repeat(crs)
    }
    if (followed && terminator === '' && display !== '') {
        terminator = eol
    }
    const openMarker = span.kind === 'block'
        && span.markerStart !== null
        && !text.slice(span.markerStart, span.start).endsWith('\n')
        && display !== ''
    return text.slice(0, span.start) + (openMarker ? eol : '') + display + terminator + text.slice(span.end)
}

function markerLineStarts(text: string): number[] {
    const starts: number[] = []
    let offset = 0
    for (const line of text.split('\n')) {
        if (isExampleMarkerLine(line)) {
            starts.push(offset)
        }
        offset += line.length + 1
    }
    return starts
}

/** True when the edit from `prev` to `next` adds, removes or moves a marker line. */
export function splitChanged(prev: string, next: string): boolean {
    const edit = editBetween(prev, next)
    const delta = edit.inserted - edit.removed
    const before = markerLineStarts(prev)
    if (before.some((start) => edit.start <= start && start < edit.start + edit.removed)) {
        return true
    }
    const mapped: number[] = []
    for (const start of before) {
        if (start < edit.start) {
            mapped.push(start)
        } else if (start >= edit.start + edit.removed) {
            mapped.push(start + delta)
        }
    }
    const after = markerLineStarts(next)
    return mapped.length !== after.length || mapped.some((start, k) => start !== after[k])
}

/** Moves a hold through an outside change: shifted when the change is before it, kept when after, dropped when it overlaps. */
export function rebaseHold(hold: Hold | null, prev: string, next: string): Hold | null {
    if (hold === null || prev === next) {
        return hold
    }
    const edit = editBetween(prev, next)
    const delta = edit.inserted - edit.removed
    if (edit.start + edit.removed <= hold.start) {
        return { start: hold.start + delta, end: hold.end + delta }
    }
    if (edit.start >= hold.end) {
        return hold
    }
    return null
}

/** The card holding raw offset `rawOffset`; a caret on a marker line goes to that block at 0. `card` is -1 when there are no cards. */
export function locateCaret(text: string, spans: readonly CardSpan[], rawOffset: number): { card: number; offsetLf: number } {
    for (let k = 0; k < spans.length; k++) {
        const span = spans[k]
        if (span.markerStart !== null && rawOffset >= span.markerStart && rawOffset < span.start) {
            return { card: k, offsetLf: 0 }
        }
        const last = k === spans.length - 1
        if (rawOffset >= span.start && (rawOffset < span.end || (last && rawOffset <= span.end))) {
            const shown = lf(cardText(text, spans, k)).length
            return { card: k, offsetLf: Math.min(lf(text.slice(span.start, rawOffset)).length, shown) }
        }
    }
    return { card: spans.length - 1, offsetLf: 0 }
}

/** Index of the first block card in `cardSpans(text, null)`. */
function blockOffset(text: string): number {
    return splitExampleText(text).opening === '' ? 0 : 1
}

export function addBlock(text: string): string {
    const eol = detectEol(text)
    const parts = splitExampleText(text)
    parts.blocks.push(newExampleBlock('', eol))
    return joinExampleText(parts, eol)
}

/** `i` indexes `cardSpans(text, null)`: the opening or a block. */
export function deleteCard(text: string, i: number): string {
    const parts = splitExampleText(text)
    const offset = blockOffset(text)
    if (i < 0 || i >= offset + parts.blocks.length) {
        return text
    }
    if (i < offset) {
        parts.opening = ''
    } else {
        parts.blocks.splice(i - offset, 1)
    }
    return joinExampleText(parts, detectEol(text))
}

/** Moves block card `i` to position `to`; the opening never moves and nothing moves onto it. */
export function moveBlock(text: string, i: number, to: number): string {
    const parts = splitExampleText(text)
    const offset = blockOffset(text)
    const from = i - offset
    const target = to - offset
    const count = parts.blocks.length
    if (from < 0 || target < 0 || from >= count || target >= count || from === target) {
        return text
    }
    const [block] = parts.blocks.splice(from, 1)
    parts.blocks.splice(target, 0, block)
    return joinExampleText(parts, detectEol(text))
}

/** Gives a marker-less opening a marker line, so it is a block. */
export function markOpening(text: string): string {
    return '<START>' + detectEol(text) + text
}
