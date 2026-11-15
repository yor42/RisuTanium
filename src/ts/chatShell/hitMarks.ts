// In-text marks for the shown search hit. This part reads a rendered, already sanitized message body and finds where the
// normalised query sits in its Text nodes. DOM only: no Svelte, no DB, and nothing here writes to the DOM.
import { BLOCK_TAG_NAMES } from './inChatSearch'

// A body whose mapped text is longer than this is not searched; the hit then falls back to the outline.
export const MARK_TEXT_CAP = 200_000
// At most this many occurrences are marked per message, in reading order.
export const MARK_CAP = 200

// Elements whose text is never marked: a mark inside SVG or MathML would hide the text, and inside a form control it would
// corrupt the control. Each counts as one boundary.
const SKIP_TAG_NAMES: ReadonlySet<string> = new Set(['style', 'script', 'template', 'noscript', 'iframe', 'textarea', 'select', 'option', 'optgroup', 'svg', 'math'])

export interface WalkOptions {
    // Whether the text of Thoughts blocks is walked.
    thinking: boolean
    // The label the parser writes into a Thoughts block's summary; it is not stored text and is never walked.
    thoughtsLabel: string
}

// Where one mapped unit came from: the code point at [start, end) of `node`.
export interface SourceSpan {
    node: Text
    start: number
    end: number
}

// `text` is the body's text the way the engine normalises stored text: block edges and whitespace runs are one space and
// letters are lower case. `spans[i]` is the source of `text[i]`, or null for a space that is not in any Text node.
export interface MappedText {
    text: string
    spans: (SourceSpan | null)[]
}

// The part of one occurrence that lies in one Text node, as a range of that node's data.
export interface MarkSegment {
    node: Text
    start: number
    end: number
}

export interface Occurrence {
    segments: MarkSegment[]
}

export type LocateResult =
    | { status: 'unlocated' }
    | { status: 'located', occurrences: Occurrence[] }

const WHITESPACE_RE = /\s/

function isThoughtsBlock(element: Element, label: string): boolean {
    if (label === '' || element.localName.toLowerCase() !== 'details') return false
    const first = element.firstElementChild
    return first !== null && first.localName.toLowerCase() === 'summary' && first.textContent === label
}

// Walks `body` in document order without recursion. Returns null when the mapped text passes MARK_TEXT_CAP.
export function buildMappedText(body: Element, options: WalkOptions): MappedText | null {
    const units: string[] = []
    const spans: (SourceSpan | null)[] = []
    let lastSpace = false

    function boundary(): void {
        if (lastSpace) return
        units.push(' ')
        spans.push(null)
        lastSpace = true
    }

    function emitText(node: Text): void {
        const data = node.data
        let index = 0
        while (index < data.length) {
            const codePoint = data.codePointAt(index) as number
            const length = codePoint > 0xFFFF ? 2 : 1
            const character = String.fromCodePoint(codePoint)
            if (WHITESPACE_RE.test(character)) {
                if (!lastSpace) {
                    units.push(' ')
                    spans.push({ node, start: index, end: index + length })
                    lastSpace = true
                }
            }
            else {
                const lower = character.toLowerCase()
                for (let unit = 0; unit < lower.length; unit++) {
                    units.push(lower[unit])
                    spans.push({ node, start: index, end: index + length })
                }
                lastSpace = false
            }
            index += length
        }
    }

    // True when the element's whole subtree is skipped (and counted as one boundary).
    function skips(element: Element): boolean {
        if (SKIP_TAG_NAMES.has(element.localName.toLowerCase())) return true
        return isThoughtsBlock(element, options.thoughtsLabel) && !options.thinking
    }

    function isThoughtsSummary(element: Element): boolean {
        if (options.thoughtsLabel === '' || element.localName.toLowerCase() !== 'summary') return false
        const parent = element.parentElement
        return parent !== null && parent.firstElementChild === element && isThoughtsBlock(parent, options.thoughtsLabel)
    }

    function enters(element: Element): boolean {
        if (skips(element) || isThoughtsSummary(element)) {
            boundary()
            return false
        }
        if (BLOCK_TAG_NAMES.has(element.localName.toLowerCase())) boundary()
        return true
    }

    let node: Node | null = body.firstChild
    while (node !== null) {
        let descend = false
        if (node.nodeType === 3) emitText(node as Text)
        else if (node.nodeType === 1) descend = enters(node as Element)
        if (units.length > MARK_TEXT_CAP) return null

        if (descend && node.firstChild !== null) {
            node = node.firstChild
            continue
        }
        // An entered element with no children is also left here, which is its closing edge.
        if (descend && BLOCK_TAG_NAMES.has((node as Element).localName.toLowerCase())) boundary()
        while (node !== null && node !== body && node.nextSibling === null) {
            node = node.parentNode
            if (node !== null && node !== body && node.nodeType === 1 && BLOCK_TAG_NAMES.has((node as Element).localName.toLowerCase())) boundary()
        }
        if (node === null || node === body) break
        node = node.nextSibling
    }
    return { text: units.join(''), spans }
}

// Non-overlapping occurrences of the already normalised `query`, at most MARK_CAP, in reading order.
export function locateOccurrences(mapped: MappedText, query: string): Occurrence[] {
    const occurrences: Occurrence[] = []
    if (query === '') return occurrences
    let from = 0
    while (occurrences.length < MARK_CAP) {
        const at = mapped.text.indexOf(query, from)
        if (at === -1) break
        from = at + query.length
        const byNode = new Map<Text, MarkSegment>()
        for (let unit = at; unit < from; unit++) {
            const span = mapped.spans[unit]
            if (span === null) continue
            const segment = byNode.get(span.node)
            if (segment === undefined) byNode.set(span.node, { node: span.node, start: span.start, end: span.end })
            else {
                segment.start = Math.min(segment.start, span.start)
                segment.end = Math.max(segment.end, span.end)
            }
        }
        if (byNode.size > 0) occurrences.push({ segments: [...byNode.values()] })
    }
    return occurrences
}

export function locateInBody(body: Element, query: string, options: WalkOptions): LocateResult {
    const mapped = buildMappedText(body, options)
    if (mapped === null) return { status: 'unlocated' }
    const occurrences = locateOccurrences(mapped, query)
    return occurrences.length === 0 ? { status: 'unlocated' } : { status: 'located', occurrences }
}

// The pending body is empty or one of ChatBody's loading indicators (the parse placeholder with role="status", the translation spinner with its animated element); anything else is the rendered message.
export function bodyRendered(body: HTMLElement): boolean {
    if (body.querySelector('[role="status"], [style*="animation: spin"]') !== null) return false
    return (body.textContent ?? '').trim() !== '' || body.querySelector('*') !== null
}

// Resolves true as soon as the body holds rendered content, false when `ms` pass first.
export function waitForRendered(body: HTMLElement, ms: number): Promise<boolean> {
    if (bodyRendered(body)) return Promise.resolve(true)
    if (typeof MutationObserver === 'undefined') return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const observer = new MutationObserver(() => {
            if (!bodyRendered(body)) return
            observer.disconnect()
            clearTimeout(timer)
            resolve(true)
        })
        observer.observe(body, { childList: true, subtree: true, characterData: true })
        timer = setTimeout(() => {
            observer.disconnect()
            resolve(false)
        }, ms)
    })
}

export interface MarkOptions {
    // The normalised query.
    query: string
    thinking: boolean
    thoughtsLabel: string
    // Called once when the marks were removed because the hit's own body changed or its row left the list.
    onLost: () => void
}

export interface HitMarks {
    // Identifies the hit being shown; `clear` replaces it, so a late `mark` for an older hit does nothing.
    token(): number
    // Marks every located occurrence in `body` and returns the first visible mark, or null when nothing was marked.
    mark(token: number, body: HTMLElement, options: MarkOptions): HTMLElement | null
    // Removes the marks. `jumping` is true when another hit follows: every details the marks opened is closed then; otherwise one whose top is above the visible top stays open.
    clear(options: { jumping: boolean }): void
}

interface TextEdit {
    node: Text
    saved: string
    // What the shortened node holds right after marking; a different value means another writer owns the text.
    written: string
    created: Node[]
}

interface Layer {
    observer: MutationObserver
    edits: TextEdit[]
    opened: HTMLDetailsElement[]
    body: HTMLElement
}

interface Piece {
    start: number
    end: number
    occurrence: number
    lead: boolean
}

// Style only, never layout, so it is safe under content-visibility.
function hiddenByStyle(node: Node, body: Element): boolean {
    const view = body.ownerDocument.defaultView
    if (view === null) return false
    for (let element = node.parentElement; element !== null; element = element.parentElement) {
        const style = view.getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') return true
        if (element === body) break
    }
    return false
}

function unwrapMarks(body: Element): void {
    for (const orphan of Array.from(body.querySelectorAll('mark.search-mark'))) orphan.replaceWith(...Array.from(orphan.childNodes))
}

export function createHitMarks(options: { viewportTop: () => number | null }): HitMarks {
    let current = 0
    let layer: Layer | null = null

    // Removes everything the layer wrote and closes what it opened. It does not replace the token.
    function teardown(jumping: boolean): void {
        const active = layer
        if (active === null) return
        layer = null
        active.observer.disconnect()
        for (let index = active.edits.length - 1; index >= 0; index--) {
            const edit = active.edits[index]
            for (const created of edit.created) created.parentNode?.removeChild(created)
            if (edit.node.parentNode !== null && edit.node.data === edit.written) edit.node.data = edit.saved
        }
        unwrapMarks(active.body)
        for (const details of active.opened) {
            if (!details.open) continue
            if (!jumping) {
                const top = options.viewportTop()
                if (top !== null && details.getBoundingClientRect().top < top) continue
            }
            details.open = false
        }
    }

    return {
        token: () => current,
        clear({ jumping }) {
            current++
            teardown(jumping)
        },
        mark(token, body, markOptions) {
            if (token !== current) return null
            teardown(true)
            const located = locateInBody(body, markOptions.query, { thinking: markOptions.thinking, thoughtsLabel: markOptions.thoughtsLabel })
            if (located.status !== 'located') return null
            const anchorOccurrence = located.occurrences.findIndex((occurrence) => !hiddenByStyle(occurrence.segments[0].node, body))
            if (anchorOccurrence === -1) return null

            const byNode = new Map<Text, Piece[]>()
            located.occurrences.forEach((occurrence, index) => {
                occurrence.segments.forEach((segment, position) => {
                    const pieces = byNode.get(segment.node)
                    const piece: Piece = { start: segment.start, end: segment.end, occurrence: index, lead: position === 0 }
                    if (pieces === undefined) byNode.set(segment.node, [piece])
                    else pieces.push(piece)
                })
            })

            const document = body.ownerDocument
            const edits: TextEdit[] = []
            let anchor: HTMLElement | null = null
            for (const [node, pieces] of byNode) {
                pieces.sort((a, b) => a.start - b.start)
                const saved = node.data
                const edit: TextEdit = { node, saved, written: saved.slice(0, pieces[0].start), created: [] }
                node.data = edit.written
                let after: Node = node
                let at = pieces[0].start
                const insert = (created: Node) => {
                    ;(after as ChildNode).after(created)
                    after = created
                    edit.created.push(created)
                }
                for (const piece of pieces) {
                    const start = Math.max(piece.start, at)
                    if (piece.end <= start) continue
                    if (start > at) insert(document.createTextNode(saved.slice(at, start)))
                    const mark = document.createElement('mark')
                    mark.className = 'search-mark'
                    mark.textContent = saved.slice(start, piece.end)
                    insert(mark)
                    if (piece.occurrence === anchorOccurrence && piece.lead) anchor = mark
                    at = piece.end
                }
                if (at < saved.length) insert(document.createTextNode(saved.slice(at)))
                edits.push(edit)
            }

            const opened: HTMLDetailsElement[] = []
            if (anchor !== null) {
                for (let element = anchor.parentElement; element !== null && element !== body; element = element.parentElement) {
                    if (element.localName.toLowerCase() !== 'details') continue
                    const details = element as HTMLDetailsElement
                    if (details.open) continue
                    const summary = details.firstElementChild
                    if (summary !== null && summary.localName.toLowerCase() === 'summary' && summary.contains(anchor)) continue
                    details.open = true
                    opened.push(details)
                }
            }

            const row = body.closest('[data-part="chat-message-container"], [data-part="chat-first-message"]')
            const rowParent = row === null ? null : row.parentElement
            const observer = new MutationObserver((records) => {
                let lost = false
                for (const record of records) {
                    // Sibling rows coming, going or moving never concern the marks; only this body leaving the list does.
                    if (record.target === rowParent) {
                        if (!rowParent.contains(body)) lost = true
                    }
                    else lost = true
                }
                if (!lost || layer === null || layer.observer !== observer) return
                teardown(true)
                markOptions.onLost()
            })
            observer.observe(body, { childList: true, characterData: true, subtree: true })
            if (rowParent !== null) observer.observe(rowParent, { childList: true })
            layer = { observer, edits, opened, body }
            if (anchor === null) {
                teardown(true)
                return null
            }
            return anchor
        },
    }
}

export interface HitAimOptions {
    marks: HitMarks
    // The token of the hit this aim belongs to.
    token: number
    query: string
    thinking: boolean
    thoughtsLabel: string
    waitMs?: number
    // The hit could not be marked: show the outline.
    onOutline: () => void
    onLost: () => void
    // A failure inside the aim; the hit falls back to the outline as well.
    onError?: (error: unknown) => void
}

// The aim hook of a hit jump: marks the mounted row and resolves the element the jump aligns, or null for the outline.
export function createHitAim(options: HitAimOptions): (article: HTMLElement) => Promise<HTMLElement | null> {
    const { marks, token, waitMs = 1000 } = options
    return async (article) => {
        try {
            if (marks.token() !== token) return null
            if (article.hasAttribute('data-streaming')) {
                options.onOutline()
                return null
            }
            const body = article.querySelector<HTMLElement>('[data-part="chat-message-body"]')
            if (body === null || !(await waitForRendered(body, waitMs))) {
                if (marks.token() === token) options.onOutline()
                return null
            }
            if (marks.token() !== token) return null
            const anchor = marks.mark(token, body, { query: options.query, thinking: options.thinking, thoughtsLabel: options.thoughtsLabel, onLost: options.onLost })
            if (anchor === null) options.onOutline()
            return anchor
        }
        catch (error) {
            options.onError?.(error)
            if (marks.token() === token) options.onOutline()
            return null
        }
    }
}
