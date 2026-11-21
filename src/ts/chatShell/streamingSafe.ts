import type { CbsConditions } from '../parser/parser.svelte'
import type { DisplayParseOptions } from '../process/displayParseOptions'
import { recordCaughtError } from '../caughtErrors'
import { NO_SPANS, buildProbes, isHeld, openSpanStart, spanIntervals, type SpanInterval, type SpanRules } from './streamSpans'

export interface StreamingSplit {
    finished: string[]
    open: string
}

const blockStart = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~)/
const cssProperty = /\{\s*(?:--[\w-]+|color|background(?:-color|-image)?|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|font(?:-[\w-]+)?|border(?:-[\w-]+)?|display|width|height|opacity)\s*:/i

// The fence lines of markdown-it's fence rule: at most 3 spaces of indent, three or more marker characters, and for a
// backtick opener an info string without a backtick. A closer carries only trailing whitespace after its marker.
const backtickOpener = /^ {0,3}(`{3,})[^`]*$/
const tildeOpener = /^ {0,3}(~{3,})([\s\S]*)$/
const fenceCloser = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/
const spaceOnly = /^[ \t\r]*$/

// What follows a line: 'text' when the next line has a non-whitespace character even if it is incomplete, 'blank' when the
// next line is complete and whitespace-only, 'unknown' when the text has not yet shown which of the two it is.
type NextLine = 'blank' | 'text' | 'unknown'

function nextLineKind(text: string, from: number): NextLine {
    if (from >= text.length) return 'unknown'
    const end = text.indexOf('\n', from)
    const line = text.slice(from, end < 0 ? text.length : end)
    if (!spaceOnly.test(line)) return 'text'
    return end < 0 ? 'unknown' : 'blank'
}

// A lone tilde line: a scene break unless the next line has text, in which case it opens a fence.
function isLoneTildeLine(line: string): boolean {
    const tilde = tildeOpener.exec(line)
    return tilde !== null && spaceOnly.test(tilde[2])
}

// The fence state after one more line: '' when no fence is open, else the opening marker. `nextStart` is where the line
// after this one begins. A lone tilde line whose next line is not yet known leaves the state unchanged, so it cannot end a block.
function foldFenceLine(fence: string, line: string, text: string, nextStart: number): string {
    if (fence) {
        const closer = fenceCloser.exec(line)?.[1]
        return closer && closer[0] === fence[0] && closer.length >= fence.length ? '' : fence
    }
    const backticks = backtickOpener.exec(line)?.[1]
    if (backticks) return backticks
    const tilde = tildeOpener.exec(line)
    if (!tilde) return ''
    if (!spaceOnly.test(tilde[2])) return tilde[1]
    return nextLineKind(text, nextStart) === 'text' ? tilde[1] : ''
}

// Whether a `<Thoughts>` is open after one more line: the last `<Thoughts>` seen has no `</Thoughts>` after it.
// Neither token contains a newline, so folding line by line equals searching the whole block.
function foldThoughtsLine(open: boolean, line: string): boolean {
    const opened = line.lastIndexOf('<Thoughts>')
    if (opened >= 0) return line.indexOf('</Thoughts>', opened + '<Thoughts>'.length) < 0
    return open && !line.includes('</Thoughts>')
}

// An image form keeps its block held and its tail hidden until it closes, however long its name grows; every other macro
// fragment is released once it is longer than 64 characters.
function isImageMacro(text: string, at: number): boolean {
    return /^\{\{(?:img::|inlay)/i.test(text.slice(at, at + 9))
}

// The checks that need the whole block; the caller has already ruled out an open fence and an open Thoughts.
function openAfterFold(text: string): boolean {
    const styleOpen = text.search(/<style\b[^>]*>(?![\s\S]*<\/style\s*>)/i)
    if (styleOpen >= 0) return true
    if (/(?:^|[\s>])<(?:[A-Za-z!/][^>]*|)$/.test(text.trimEnd())) return true
    const macro = text.lastIndexOf('{{')
    if (macro >= 0 && text.indexOf('}}', macro) < 0 && (isImageMacro(text, macro) || text.length - macro <= 64)) return true
    if (cssProperty.test(text) && text.lastIndexOf('{') > text.lastIndexOf('}')) return true
    return false
}

// `fromIndex` must be the end of a finished block of the full split (the length of an already finished prefix);
// the result then lists only the blocks after it, identical to the tail of the full split. A value outside the
// text is treated as a full split; the caller owns the check that the text still starts with its finished prefix.
// A boundary inside a span (an unbalanced CBS block or a probed display regex that has opened and not closed) is never
// a block end, so the whole span converts in one call once it closes. The spans are computed once per call from the start index.
export function splitStreamingText(text: string, fromIndex = 0, spans: SpanRules = NO_SPANS): StreamingSplit {
    const finished: string[] = []
    let start = Number.isInteger(fromIndex) && fromIndex > 0 && fromIndex <= text.length ? fromIndex : 0
    const base = start
    const intervals: SpanInterval[] = spanIntervals(text.slice(base), spans).map((interval) => ({ q: interval.q + base, e: interval.e + base }))
    // Fence and Thoughts state of the current block, folded one line at a time so an open construct is never re-scanned.
    // Both are closed whenever a block is emitted, so they carry no stale state into the next block.
    let fence = ''
    let thoughtsOpen = false
    for (let i = start; i < text.length; i++) {
        if (text[i] !== '\n') continue
        const lineStart = text.lastIndexOf('\n', i - 1) + 1
        const currentLine = text.slice(lineStart, i)
        const blockLine = lineStart >= start ? currentLine : text.slice(start, i)
        fence = foldFenceLine(fence, blockLine, text, i + 1)
        thoughtsOpen = foldThoughtsLine(thoughtsOpen, blockLine)
        const blank = text[i + 1] === '\n'
        const nextLine = text.slice(i + (blank ? 2 : 1))
        const boundary = blank || blockStart.test(nextLine)
        if (!boundary) continue
        const end = i + (blank ? 2 : 1)
        const block = text.slice(start, end)
        if (fence || thoughtsOpen || isHeld(intervals, end) || openAfterFold(block)) continue
        // Finished blocks are emitted only after a complete boundary and never change as text grows.
        finished.push(block)
        start = end
        if (blank) i++
    }
    return { finished, open: text.slice(start) }
}

export interface OpenFence {
    // Index of the opener line in the scanned text.
    start: number
    // The opening marker, or '' for a lone tilde line whose next line is not yet known.
    marker: string
    // The content lines after the opener line, not counting an empty trailing partial line.
    contentLines: number
    // The text after the opener line.
    raw: string
    // True for a lone tilde line that is neither a fence nor a scene break until more text arrives.
    pending: boolean
}

// The fence still open at the end of `open`, or a trailing lone tilde line that is still undecided, else null.
export function openFence(open: string): OpenFence | null {
    let fence = ''
    let start = -1
    let after = 0
    let pending = -1
    let lineStart = 0
    while (lineStart <= open.length) {
        const newline = open.indexOf('\n', lineStart)
        const lineEnd = newline < 0 ? open.length : newline
        const line = open.slice(lineStart, lineEnd)
        const nextStart = newline < 0 ? open.length : newline + 1
        const before = fence
        fence = foldFenceLine(fence, line, open, nextStart)
        if (!before && fence) {
            start = lineStart
            after = Math.min(nextStart, open.length)
        }
        if (!before && !fence && isLoneTildeLine(line) && nextLineKind(open, nextStart) === 'unknown') pending = lineStart
        if (newline < 0) break
        lineStart = newline + 1
    }
    if (fence) {
        const raw = open.slice(after)
        const lines = raw.split('\n')
        if (lines[lines.length - 1] === '') lines.pop()
        return { start, marker: fence, contentLines: raw === '' ? 0 : lines.length, raw, pending: false }
    }
    if (pending >= 0) return { start: pending, marker: '', contentLines: 0, raw: '', pending: true }
    return null
}

// The index where a Thoughts block opens and has not closed in `open`, or -1.
function openThoughtsStart(open: string): number {
    const thoughts = open.lastIndexOf('<Thoughts>')
    return thoughts >= 0 && open.indexOf('</Thoughts>', thoughts) < 0 ? thoughts : -1
}

// The open tail is cut at the earliest open Thoughts block or open span, so nothing of either shows while it is unresolved.
// A span that has closed stays whole.
export function renderOpenParagraphSource(open: string, spans: SpanRules = NO_SPANS): string {
    return cutOpenTail(open, spans).source
}

// One cut of the open tail: where it cuts and the chip it shows, if it has one. Every cut keeps a prefix of `open`, so
// positions are comparable across steps.
interface TailCut { at: number, chip: OpenTailChip | null }

function cutOpenTail(open: string, spans: SpanRules): { source: string, cuts: TailCut[] } {
    const cuts: TailCut[] = []
    let result = open
    const thoughts = openThoughtsStart(result)
    if (thoughts >= 0) {
        cuts.push({ at: thoughts, chip: { kind: 'thinking', words: openThoughtsWordCount(open) ?? 0 } })
        result = result.slice(0, thoughts)
    }
    const spanCut = openSpanStart(open, spans)
    if (spanCut >= 0 && spanCut < result.length) {
        cuts.push({ at: spanCut, chip: { kind: 'formatting' } })
        result = result.slice(0, spanCut)
    }
    const style = /<style\b[^>]*>/gi
    let match: RegExpExecArray | null
    let lastOpen = -1
    while ((match = style.exec(result))) lastOpen = match.index
    if (lastOpen >= 0 && !/<\/style\s*>/i.test(result.slice(lastOpen))) {
        cuts.push({ at: lastOpen, chip: { kind: 'styles' } })
        result = result.slice(0, lastOpen)
    }
    const fence = openFence(result)
    if (fence) {
        const at = Math.max(0, fence.start - 1)
        // A pending lone tilde line is cut but shows no chip: it may still turn out to be a scene break.
        cuts.push({ at, chip: fence.pending ? null : { kind: 'code', lines: fence.contentLines, raw: fence.raw } })
        result = result.slice(0, at)
    }
    if (cssProperty.test(result) && result.lastIndexOf('{') > result.lastIndexOf('}')) {
        const brace = result.lastIndexOf('{')
        const cssLines = result.slice(brace).split('\n')
        if (cssLines.length <= 40) {
            const at = result.lastIndexOf('\n', brace) + 1
            cuts.push({ at, chip: { kind: 'styles' } })
            result = result.slice(0, at)
        }
    }
    const macro = result.lastIndexOf('{{')
    if (macro >= 0 && result.indexOf('}}', macro) < 0) {
        const image = isImageMacro(result, macro)
        if (image || result.length - macro <= 64) {
            if (image) cuts.push({ at: macro, chip: { kind: 'image' } })
            result = result.slice(0, macro)
        }
    }
    const tag = /(?:^|[\s>])<(?:[A-Za-z!/][^>]*|)$/.exec(result)
    if (tag) {
        const at = tag.index + tag[0].indexOf('<')
        if (/^<img(?:\s|$)/i.test(result.slice(at))) cuts.push({ at, chip: { kind: 'image' } })
        result = result.slice(0, at)
    }
    const emphasis = /(^|\s)(\*{1,2})([^*\n]+)$/.exec(result)
    if (emphasis) result = result.slice(0, emphasis.index + emphasis[1].length) + emphasis[3]
    return { source: result, cuts }
}

export interface SafeHtmlDependencies {
    display: (source: string) => string
    sanitize: (html: string) => string
    watermark: (html: string) => string
}

export function toSafeHtml(source: string, deps: SafeHtmlDependencies): string {
    const displayed = deps.display(source)
    const sanitized = deps.sanitize(displayed)
    // The chain is the completed-message chain (watermark of the sanitized markup). The watermark only appends
    // zero-width text, and a second sanitize here would re-parse decoded <risu-style> CSS as HTML and drop it.
    return deps.watermark(sanitized)
}

// The word count of a Thoughts block that has opened and not yet closed in the open source, or null when none is open.
export function openThoughtsWordCount(open: string): number | null {
    const thoughts = open.lastIndexOf('<Thoughts>')
    if (thoughts < 0 || open.indexOf('</Thoughts>', thoughts) >= 0) return null
    const words = open.slice(thoughts + '<Thoughts>'.length).trim()
    return words === '' ? 0 : words.split(/\s+/).length
}

export type OpenTailChip =
    | { kind: 'thinking', words: number }
    | { kind: 'formatting' }
    | { kind: 'code', lines: number, raw: string }
    | { kind: 'styles' }
    | { kind: 'image' }

const chipRank: Record<OpenTailChip['kind'], number> = { thinking: 0, formatting: 1, code: 2, styles: 3, image: 4 }

// The open source to convert and the one chip to show after it. The earliest cut decides the chip (MC-3356); on a tie
// the order is thinking, formatting, code, styles, image.
export function describeOpenTail(open: string, spans: SpanRules = NO_SPANS): { source: string, chip: OpenTailChip | null } {
    const { source, cuts } = cutOpenTail(open, spans)
    let chip: OpenTailChip | null = null
    let at = Infinity
    for (const cut of cuts) {
        if (!cut.chip) continue
        if (cut.at < at || (cut.at === at && chip !== null && chipRank[cut.chip.kind] < chipRank[chip.kind])) {
            at = cut.at
            chip = cut.chip
        }
    }
    return { source, chip }
}

export interface StreamingParseContext {
    chatID?: number
    cbsConditions?: CbsConditions
    displayOptions?: DisplayParseOptions
}

// The probes of the display scripts that ParseMarkdown would run for this reply, in runScriptPass order: preset scripts,
// the character's own, then the shown chat's module scripts (getModuleRegexScripts with no subject reads the shown chat).
// A group character has no scripts of its own; no character runs no display pass.
export async function createSpanRules(charArg: Parameters<typeof import('../parser/parser.svelte').ParseMarkdown>[1] = null): Promise<SpanRules> {
    if (!charArg) return NO_SPANS
    const { DBState } = await import('../stores.svelte')
    const modules = await import('../process/modules')
    const util = await import('../util')
    const char = typeof charArg === 'string' ? util.findCharacterbyId(charArg) : charArg
    if (!char) return NO_SPANS
    const own = char.type === 'group' ? [] : char.customscript ?? []
    const scripts = (DBState.db.presetRegex ?? []).concat(own).concat(modules.getModuleRegexScripts())
    return { probes: buildProbes(scripts) }
}

export async function createToSafeHtml(modelShortName: string, charArg: Parameters<typeof import('../parser/parser.svelte').ParseMarkdown>[1] = null, context: StreamingParseContext = {}): Promise<(source: string) => Promise<string>> {
    const parser = await import('../parser/parser.svelte')
    const scripts = await import('../process/scripts')
    const { chatID = -1, cbsConditions, displayOptions } = context
    return async (source: string) => {
        let parsed = source
        if (displayOptions) {
            try { parsed = scripts.risuChatParser(source, displayOptions) } catch (error) { recordCaughtError('chat.parse', error); parsed = source }
        }
        // Every text this factory converts is part of a streamed partial reply, so it bypasses the script cache.
        const displayed = await parser.ParseMarkdown(parsed, charArg, 'notrim', chatID, cbsConditions, 'bypass')
        return toSafeHtml(source, {
            display: () => displayed,
            sanitize: parser.trimMarkdown,
            watermark: (html) => parser.addMetadataToElement(html, modelShortName),
        })
    }
}
