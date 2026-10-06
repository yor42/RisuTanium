/**
 * "Copy as card": a message as a themed HTML card on the clipboard, with the
 * plain text beside it.
 *
 * The card is built from captured values only, in an inert document, so nothing
 * the message contains can load, run or style the app:
 *  - the message body is rebuilt node by node from a parsed copy; only a fixed
 *    set of elements and attributes is written, never the message's own styles,
 *    classes or ids, and content that is hidden or collapsed is left out;
 *  - an image from an outside host keeps its address and is never fetched; the
 *    avatar, a local image, is embedded as a small JPEG;
 *  - the whole result settles within a deadline, falling back to a simpler card.
 */

import { copyPlainText, type CopyOutcome } from './chatCopy'
import { encodeAvatar as liveEncodeAvatar } from './chatCardImage'
import { isTauri } from './platform'

//#region types and limits

export type EncodeAvatar = (
    src: string,
    opts: { maxSide: number, background: string, signal: AbortSignal },
) => Promise<string | null>

/** Theme colours captured at the click. Every value is a plain CSS colour string. */
export interface CardTheme {
    text: string
    background: string
    border: string
    darkBackground: string
    text2: string
    standard: string
    italic: string
    bold: string
    italicBold: string
    quote1: string
    quote2: string
}

/** Everything the card needs, captured at the click. The builder reads no store. */
export interface CardInput {
    copyText: string
    displayName: string
    /** The model badge; null for a user message, which has none. */
    badge: string | null
    /** The stored avatar path; empty when there is no avatar. */
    avatarPath: string
    theme: CardTheme
    /** The message rendered to HTML. */
    parseBody: () => Promise<string>
    /** Turns a stored image path into an address the avatar encoder can fetch. */
    resolveAvatarSrc: (path: string) => Promise<string>
}

export interface CardEnv {
    encodeAvatar: EncodeAvatar
    origin: string
    isTauri: boolean
    deadlineMs: number
    avatarBudgetMs: number
    marginMs: number
    limitBytes: number
}

export const CARD_DEADLINE_MS = 3000
export const CARD_AVATAR_BUDGET_MS = 2000
export const CARD_PENDING_MARGIN_MS = 2000
export const CARD_LIMIT_BYTES = 900 * 1024
export const CARD_AVATAR_MAX_SIDE = 160

export function liveCardEnv(): CardEnv {
    return {
        encodeAvatar: liveEncodeAvatar,
        origin: typeof location === 'undefined' ? '' : location.origin,
        isTauri,
        deadlineMs: CARD_DEADLINE_MS,
        avatarBudgetMs: CARD_AVATAR_BUDGET_MS,
        marginMs: CARD_PENDING_MARGIN_MS,
        limitBytes: CARD_LIMIT_BYTES,
    }
}

//#endregion

//#region theme

const THEME_FALLBACK: CardTheme = {
    text: '#1f2937',
    background: '#ffffff',
    border: '#d1d5db',
    darkBackground: '#f3f4f6',
    text2: '#6b7280',
    standard: '#1f2937',
    italic: '#4b5563',
    bold: '#111827',
    italicBold: '#111827',
    quote1: '#b45309',
    quote2: '#1d4ed8',
}

/** A colour value is kept only when it cannot end a declaration or reference a resource. */
export function sanitizeColor(value: string | null | undefined, fallback: string): string {
    const trimmed = (value ?? '').trim()
    if(trimmed === '' || trimmed.length > 200){
        return fallback
    }
    if(/[;\\{}<>"']/.test(trimmed) || /url\(|expression\(|@import/i.test(trimmed)){
        return fallback
    }
    return trimmed
}

/** Reads the card's colours through `read` (a custom property name to its value). */
export function captureCardTheme(read: (property: string) => string): CardTheme {
    const pick = (property: string, fallback: string) => sanitizeColor(read(property), fallback)
    return {
        text: pick('--risu-theme-textcolor', THEME_FALLBACK.text),
        background: pick('--risu-theme-bgcolor', THEME_FALLBACK.background),
        border: pick('--risu-theme-darkborderc', THEME_FALLBACK.border),
        darkBackground: pick('--risu-theme-darkbg', THEME_FALLBACK.darkBackground),
        text2: pick('--risu-theme-textcolor2', THEME_FALLBACK.text2),
        standard: pick('--FontColorStandard', THEME_FALLBACK.standard),
        italic: pick('--FontColorItalic', THEME_FALLBACK.italic),
        bold: pick('--FontColorBold', THEME_FALLBACK.bold),
        italicBold: pick('--FontColorItalicBold', THEME_FALLBACK.italicBold),
        quote1: pick('--FontColorQuote1', THEME_FALLBACK.quote1),
        quote2: pick('--FontColorQuote2', THEME_FALLBACK.quote2),
    }
}

//#endregion

//#region image classification

export type ImageClass =
    | { kind: 'local', src: string }
    | { kind: 'outside', src: string }
    | { kind: 'drop' }

const CONTROL_OR_SPACE = /[\u0000- \u007f]/

function parseUrl(value: string, origin: string): URL | null {
    try {
        return new URL(value)
    } catch {
        // not absolute
    }
    try {
        return new URL(value, origin + '/')
    } catch {
        return null
    }
}

/**
 * Decides what the card does with an image address:
 *  - local: `data:`, `blob:`, an app image (`/sw/img/` or the Node server's
 *    `/api/asset/` on this origin) and, only in the desktop app, its asset
 *    addresses; these may be fetched and embedded;
 *  - outside: any other absolute http(s) address; it is kept as written and
 *    never fetched;
 *  - drop: everything else, including every other path on this origin.
 */
export function classifyImageSrc(src: string, env: Pick<CardEnv, 'origin' | 'isTauri'>): ImageClass {
    const trimmed = src.trim()
    if(trimmed === ''){
        return { kind: 'drop' }
    }
    const protocolRelative = trimmed.startsWith('//')
    const url = protocolRelative ? parseUrl('https:' + trimmed, env.origin) : parseUrl(trimmed, env.origin)
    if(url === null){
        return { kind: 'drop' }
    }
    switch(url.protocol){
        case 'data:':
        case 'blob:':
            return { kind: 'local', src: trimmed }
        case 'asset:':
            return env.isTauri && url.hostname === 'localhost' ? { kind: 'local', src: trimmed } : { kind: 'drop' }
        case 'http:':
        case 'https:': {
            if(url.hostname === 'asset.localhost'){
                return env.isTauri && url.port === '' ? { kind: 'local', src: trimmed } : { kind: 'drop' }
            }
            if(url.origin === env.origin){
                return url.pathname.startsWith('/sw/img/') || url.pathname.startsWith('/api/asset/')
                    ? { kind: 'local', src: trimmed }
                    : { kind: 'drop' }
            }
            const verbatim = !protocolRelative && /^https?:\/\//i.test(trimmed) && !CONTROL_OR_SPACE.test(trimmed)
            return { kind: 'outside', src: verbatim ? trimmed : url.href }
        }
        default:
            return { kind: 'drop' }
    }
}

//#endregion

//#region inert document and body rebuild

const textEncoder = new TextEncoder()

export function utf8Bytes(text: string): number {
    return textEncoder.encode(text).length
}

/** A document with no browsing context: elements created by it never load or run anything. */
export function createInertDocument(): Document {
    return new DOMParser().parseFromString('', 'text/html')
}

const KEEP_TAGS = new Set([
    'p', 'br', 'div', 'span', 'em', 'i', 'strong', 'b', 'u', 's', 'del', 'mark', 'blockquote',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'hr',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a', 'img', 'details', 'summary',
])

// Elements whose text is not message content. None of them is in KEEP_TAGS.
const DROP_TAGS = new Set([
    'script', 'style', 'risu-style', 'template', 'noscript', 'noembed', 'noframes', 'iframe',
    'object', 'embed', 'canvas', 'video', 'audio', 'svg', 'title', 'head', 'select', 'option',
    'optgroup', 'datalist', 'rp', 'meter', 'progress', 'xmp', 'plaintext',
])

const QUOTE_MARKS = new Set(['quote1', 'quote2', 'blockquote1', 'blockquote2'])
const TEX_ANNOTATION = 'annotation[encoding="application/x-tex"]'
const POSITIVE_INTEGER = /^[1-9]\d{0,8}$/

interface WalkContext {
    doc: Document
    theme: CardTheme
    env: Pick<CardEnv, 'origin' | 'isTauri'>
    inEm: boolean
    inStrong: boolean
}

/** Hidden or collapsed on the element itself; a stylesheet rule cannot be seen from here. */
function isHidden(element: Element): boolean {
    if(element.hasAttribute('hidden')){
        return true
    }
    const name = element.localName
    if((name === 'details' || name === 'dialog') && !element.hasAttribute('open')){
        return true
    }
    const style = (element as Partial<HTMLElement>).style
    if(style && typeof style === 'object'){
        return style.display === 'none' || style.visibility === 'hidden'
    }
    return false
}

function styleFor(element: HTMLElement, name: string, markKind: string | null, context: WalkContext): void {
    const { theme } = context
    const set = (property: string, value: string) => element.style.setProperty(property, value)
    switch(name){
        case 'p':
            set('color', theme.standard)
            break
        case 'em':
            set('font-style', 'italic')
            if(context.inStrong){
                set('font-weight', 'bold')
            }
            set('color', context.inStrong ? theme.italicBold : theme.italic)
            break
        case 'strong':
            set('font-weight', 'bold')
            if(context.inEm){
                set('font-style', 'italic')
            }
            set('color', context.inEm ? theme.italicBold : theme.bold)
            break
        case 'mark':
            set('background', 'transparent')
            if(markKind === 'quote1' || markKind === 'blockquote1'){
                set('color', theme.quote1)
            }
            else if(markKind === 'quote2' || markKind === 'blockquote2'){
                set('color', theme.quote2)
            }
            break
        case 'img':
            set('max-width', '100%')
            break
    }
}

/** Copies the allowed attributes of `source` onto `target`. Returns false when the element is to be omitted. */
function copyAttributes(source: Element, target: HTMLElement, name: string, context: WalkContext): boolean {
    switch(name){
        case 'a': {
            const href = (source.getAttribute('href') ?? '').trim()
            if(/^https?:\/\//i.test(href)){
                try {
                    const parsed = new URL(href)
                    if(parsed.protocol === 'http:' || parsed.protocol === 'https:'){
                        target.setAttribute('href', href)
                    }
                } catch {
                    // an unparsable address is left off
                }
            }
            return true
        }
        case 'img': {
            const classified = classifyImageSrc(source.getAttribute('src') ?? '', context.env)
            if(classified.kind !== 'outside'){
                return false
            }
            target.setAttribute('src', classified.src)
            const alt = source.getAttribute('alt')
            if(alt !== null){
                target.setAttribute('alt', alt)
            }
            return true
        }
        case 'td':
        case 'th':
            for(const attribute of ['colspan', 'rowspan']){
                const value = source.getAttribute(attribute)
                if(value !== null && POSITIVE_INTEGER.test(value.trim())){
                    target.setAttribute(attribute, value.trim())
                }
            }
            return true
        case 'ol': {
            const start = source.getAttribute('start')
            if(start !== null && POSITIVE_INTEGER.test(start.trim())){
                target.setAttribute('start', start.trim())
            }
            return true
        }
        case 'mark': {
            const kind = source.getAttribute('risu-mark')
            if(kind !== null && QUOTE_MARKS.has(kind)){
                target.setAttribute('risu-mark', kind)
            }
            return true
        }
        case 'details':
            if(source.hasAttribute('open')){
                target.setAttribute('open', '')
            }
            return true
        default:
            return true
    }
}

function rebuildElement(source: Element, target: Node, context: WalkContext): void {
    if(isHidden(source)){
        return
    }
    const name = source.localName
    if(name === 'math'){
        const tex = source.querySelector(TEX_ANNOTATION)
        target.appendChild(context.doc.createTextNode((tex ?? source).textContent ?? ''))
        return
    }
    if(DROP_TAGS.has(name)){
        return
    }
    if(!KEEP_TAGS.has(name)){
        rebuildChildren(source, target, context)
        return
    }
    const output = context.doc.createElement(name)
    if(!copyAttributes(source, output, name, context)){
        return
    }
    styleFor(output, name, name === 'mark' ? source.getAttribute('risu-mark') : null, context)
    const childContext: WalkContext = {
        ...context,
        inEm: context.inEm || name === 'em',
        inStrong: context.inStrong || name === 'strong',
    }
    rebuildChildren(source, output, childContext)
    target.appendChild(output)
}

function rebuildChildren(source: Node, target: Node, context: WalkContext): void {
    for(const child of Array.from(source.childNodes)){
        if(child.nodeType === 3){
            target.appendChild(context.doc.createTextNode(child.nodeValue ?? ''))
        }
        else if(child.nodeType === 1){
            rebuildElement(child as Element, target, context)
        }
    }
}

/**
 * Rebuilds the rendered message `html` as a new tree of `doc`'s own nodes. The
 * source is parsed in its own inert document and only read; nothing of it is
 * moved or serialised into the result.
 */
export function rebuildBody(
    html: string,
    theme: CardTheme,
    doc: Document,
    env: Pick<CardEnv, 'origin' | 'isTauri'>,
): HTMLElement {
    const source = new DOMParser().parseFromString(html, 'text/html')
    const container = doc.createElement('div')
    container.style.setProperty('border-top', `1px solid ${theme.border}`)
    container.style.setProperty('padding-top', '1rem')
    rebuildChildren(source.body ?? source.documentElement, container, { doc, theme, env, inEm: false, inStrong: false })
    return container
}

//#endregion

//#region card frame

type CardFrameInput = Pick<CardInput, 'displayName' | 'badge' | 'theme'>

function applyStyles(element: HTMLElement, styles: Record<string, string>): void {
    for(const [property, value] of Object.entries(styles)){
        element.style.setProperty(property, value)
    }
}

/** Header, `body` and footer inside the card's container, all created by `doc`. */
export function buildCardElement(
    doc: Document,
    input: CardFrameInput,
    body: HTMLElement,
    avatarSrc: string | null,
): HTMLElement {
    const { theme } = input
    const container = doc.createElement('div')
    applyStyles(container, {
        'font-family': "'Segoe UI', Roboto, Arial, sans-serif",
        'color': theme.text,
        'line-height': '1.6',
        'max-width': '600px',
        'margin': '1rem auto',
        'background': theme.background,
        'border-radius': '12px',
        'box-shadow': '0px 4px 12px rgba(0,0,0,0.15)',
        'overflow': 'hidden',
    })

    const padding = doc.createElement('div')
    padding.style.setProperty('padding', '20px')
    container.appendChild(padding)

    const header = doc.createElement('div')
    applyStyles(header, {
        'display': 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'margin-bottom': '1rem',
        'text-align': 'center',
    })
    padding.appendChild(header)

    if(avatarSrc !== null){
        const avatar = doc.createElement('img')
        avatar.setAttribute('src', avatarSrc)
        avatar.setAttribute('alt', 'profile')
        applyStyles(avatar, {
            'width': '80px',
            'height': '80px',
            'border-radius': '50%',
            'border': `3px solid ${theme.border}`,
            'margin-bottom': '0.75rem',
            'object-fit': 'cover',
        })
        header.appendChild(avatar)
    }

    const name = doc.createElement('h3')
    applyStyles(name, {
        'color': theme.text,
        'font-weight': '600',
        'font-size': '1.5rem',
        'margin': '0 0 0.5rem 0',
    })
    name.appendChild(doc.createTextNode(input.displayName))
    header.appendChild(name)

    if(input.badge !== null){
        const badge = doc.createElement('span')
        applyStyles(badge, {
            'display': 'inline-block',
            'border-radius': '16px',
            'font-size': '0.8rem',
            'padding': '0.25rem 0.75rem',
            'background': theme.darkBackground,
            'color': theme.text,
            'border': `1px solid ${theme.border}`,
        })
        badge.appendChild(doc.createTextNode(input.badge))
        header.appendChild(badge)
    }

    padding.appendChild(body)

    const footer = doc.createElement('div')
    applyStyles(footer, {
        'text-align': 'center',
        'margin-top': '1rem',
        'padding-top': '0.75rem',
        'border-top': `1px solid ${theme.border}`,
    })
    const footerText = doc.createElement('span')
    applyStyles(footerText, {
        'font-size': '0.75rem',
        'color': theme.text2,
        'opacity': '0.7',
    })
    footerText.appendChild(doc.createTextNode('From RisuTanium'))
    footer.appendChild(footerText)
    padding.appendChild(footer)

    return container
}

/** The same frame with the copy text as its body, one line per break, and no avatar. */
export function buildMinimalCardElement(input: CardInput, doc: Document = createInertDocument()): HTMLElement {
    const body = doc.createElement('div')
    applyStyles(body, {
        'border-top': `1px solid ${input.theme.border}`,
        'padding-top': '1rem',
        'color': input.theme.standard,
    })
    input.copyText.split(/\r\n|\r|\n/).forEach((line, index) => {
        if(index > 0){
            body.appendChild(doc.createElement('br'))
        }
        body.appendChild(doc.createTextNode(line))
    })
    return buildCardElement(doc, input, body, null)
}

export function buildMinimalCardHtml(input: CardInput): string {
    return buildMinimalCardElement(input).outerHTML
}

//#endregion

//#region builder

/** Rejects the card's html promise when a newer copy replaced the card. */
export class CardSupersededError extends Error {
    constructor(){
        super('The card was superseded by a newer copy')
        this.name = 'CardSupersededError'
    }
}

interface CardResult {
    kind: 'full' | 'minimal'
    /** An avatar was expected but is not in the card. */
    avatarMissing: boolean
}

type HtmlState = 'pending' | 'resolved' | 'rejected'

/** The part of a card the builder and the controller share. */
interface CardHandle {
    owner: object
    superseded: boolean
    htmlState: HtmlState
    result: CardResult | null
    /** Rejects the html promise when it is still unresolved. */
    abort: () => void
    reassert: { text: string, onFailure: (outcome: CopyOutcome) => void } | null
    reassertDone: boolean
}

interface Build {
    html: Promise<string>
    cancel: () => void
}

function errorNameOf(error: unknown): string {
    return error instanceof Error ? error.name : 'UnknownError'
}

/** An avatar result is usable only as a non-empty image data URL. */
function usableAvatar(value: string | null): string | null {
    if(typeof value !== 'string' || !value.startsWith('data:image/')){
        return null
    }
    const comma = value.indexOf(',')
    return comma > 0 && value.length > comma + 1 ? value : null
}

/**
 * Starts the card's html. Body and avatar run in parallel; the result settles
 * once, within `env.deadlineMs`:
 *  - body and avatar ready: the full card;
 *  - the avatar not ready at its own budget or at the deadline: the full card
 *    without it;
 *  - the body not ready at the deadline, or a failure: `minimalHtml`.
 * A full card over the size limit is replaced by `minimalHtml`. Before resolving
 * it waits for `earlier` (earlier card writes) but never past the deadline, and
 * a card that was superseded rejects instead of resolving.
 */
function startBuild(
    input: CardInput,
    env: CardEnv,
    minimalHtml: string,
    plainBytes: number,
    earlier: Promise<void>,
    card: CardHandle,
): Build {
    let settled = false
    let finishing = false
    let deadlineHit = false
    let bodyElement: HTMLElement | null = null
    let bodyFailed = false
    let avatarState: 'pending' | 'none' | 'failed' | 'ready' = input.avatarPath === '' ? 'none' : 'pending'
    let avatarSrc: string | null = null
    const timers: ReturnType<typeof setTimeout>[] = []
    const avatarAbort = new AbortController()
    const doc = createInertDocument()

    let resolveHtml!: (html: string) => void
    let rejectHtml!: (error: unknown) => void
    const html = new Promise<string>((resolve, reject) => {
        resolveHtml = resolve
        rejectHtml = reject
    })
    html.catch(() => {})
    let resolveDeadline!: () => void
    const deadlineReached = new Promise<void>((resolve) => {
        resolveDeadline = resolve
    })

    const settle = (action: () => void) => {
        if(settled){
            return
        }
        settled = true
        timers.forEach(clearTimeout)
        avatarAbort.abort()
        action()
    }
    const reject = (error: unknown) => settle(() => {
        card.htmlState = 'rejected'
        rejectHtml(error)
    })
    card.abort = () => reject(new CardSupersededError())

    const choose = (): { html: string, result: CardResult } => {
        if(bodyElement !== null && !bodyFailed){
            try {
                const avatar = avatarState === 'ready' ? avatarSrc : null
                const full = buildCardElement(doc, input, bodyElement, avatar).outerHTML
                if(plainBytes + utf8Bytes(full) <= env.limitBytes){
                    return { html: full, result: { kind: 'full', avatarMissing: input.avatarPath !== '' && avatar === null } }
                }
            } catch {
                // fall through to the minimal card
            }
        }
        return { html: minimalHtml, result: { kind: 'minimal', avatarMissing: false } }
    }

    const proceed = (chosen: { html: string, result: CardResult }) => settle(() => {
        if(card.superseded){
            card.htmlState = 'rejected'
            rejectHtml(new CardSupersededError())
            return
        }
        card.result = chosen.result
        card.htmlState = 'resolved'
        resolveHtml(chosen.html)
    })

    const tryFinish = () => {
        if(finishing || settled){
            return
        }
        const bodyReady = bodyElement !== null
        if(!bodyFailed && !(bodyReady && avatarState !== 'pending') && !deadlineHit){
            return
        }
        finishing = true
        const chosen = choose()
        if(deadlineHit){
            proceed(chosen)
        }
        else {
            void Promise.race([earlier, deadlineReached]).then(() => proceed(chosen))
        }
    }

    timers.push(setTimeout(() => {
        deadlineHit = true
        resolveDeadline()
        tryFinish()
    }, env.deadlineMs))

    if(avatarState === 'pending'){
        timers.push(setTimeout(() => {
            if(avatarState === 'pending'){
                avatarState = 'failed'
                avatarAbort.abort()
                tryFinish()
            }
        }, env.avatarBudgetMs))
        void (async () => {
            let result: string | null = null
            try {
                const resolved = await input.resolveAvatarSrc(input.avatarPath)
                if(avatarAbort.signal.aborted){
                    return
                }
                const classified = classifyImageSrc(resolved ?? '', env)
                if(classified.kind === 'local'){
                    result = usableAvatar(await env.encodeAvatar(classified.src, {
                        maxSide: CARD_AVATAR_MAX_SIDE,
                        background: input.theme.background,
                        signal: avatarAbort.signal,
                    }))
                }
            } catch {
                result = null
            }
            if(avatarState !== 'pending' || settled){
                return
            }
            avatarState = result === null ? 'failed' : 'ready'
            avatarSrc = result
            tryFinish()
        })()
    }

    void (async () => {
        try {
            const raw = await input.parseBody()
            if(settled){
                return
            }
            bodyElement = rebuildBody(raw, input.theme, doc, env)
        } catch {
            bodyFailed = true
        }
        tryFinish()
    })()

    return { html, cancel: () => reject(new Error('The card build was cancelled')) }
}

//#endregion

//#region concurrency

/** What the click handler reports for a card copy. */
export type CardReport =
    | { kind: 'loading' }
    | { kind: 'copied' }
    | { kind: 'simple' }
    | { kind: 'text' }
    | { kind: 'failed', errorName: string }
    | { kind: 'superseded' }

export interface CardCopyRequest {
    /** The message the tap belongs to: one object per message component instance. */
    owner: object
    captureText: () => string
    captureCard: (copyText: string) => CardInput
    report: (report: CardReport) => void
}

export interface CardCopyController {
    start: (request: CardCopyRequest) => void
    /** Tells the controller a plain copy of `text` was just issued. */
    noteNewerPlainCopy: (text: string, onFailure: (outcome: CopyOutcome) => void) => void
}

/**
 * At most one card is pending for the tap rules. A newer copy supersedes every
 * card still in flight: an unresolved card is rejected so its write fails and
 * the newer text stays; a resolved card cannot be stopped, so the newer plain
 * text is written again when its write settles. A newer card waits (up to its
 * own deadline) for the earlier writes to settle so it commits last.
 */
export function createCardCopyController(getEnv: () => CardEnv): CardCopyController {
    const live: CardHandle[] = []
    let tail: Promise<void> = Promise.resolve()

    const runReassert = (card: CardHandle) => {
        if(card.reassert === null || card.reassertDone){
            return
        }
        card.reassertDone = true
        const { text, onFailure } = card.reassert
        copyPlainText(text, (outcome) => {
            if(!outcome.ok){
                onFailure(outcome)
            }
        })
    }

    const noteNewerPlainCopy = (text: string, onFailure: (outcome: CopyOutcome) => void) => {
        for(const card of live){
            card.superseded = true
            if(card.htmlState === 'pending'){
                card.abort()
            }
            else if(card.htmlState === 'resolved'){
                card.reassert = { text, onFailure }
            }
        }
    }

    const plainFallback = (text: string, report: (report: CardReport) => void) => {
        const asFailure = (outcome: CopyOutcome): CardReport =>
            'errorName' in outcome ? { kind: 'failed', errorName: outcome.errorName } : { kind: 'text' }
        noteNewerPlainCopy(text, (outcome) => report(asFailure(outcome)))
        copyPlainText(text, (outcome) => report(asFailure(outcome)))
    }

    const start = (request: CardCopyRequest) => {
        const { report } = request
        const latest = live[live.length - 1]
        if(latest !== undefined && !latest.superseded && latest.owner === request.owner){
            report({ kind: 'loading' })
            return
        }
        for(const card of live){
            card.superseded = true
            if(card.htmlState === 'pending'){
                card.abort()
            }
        }

        let text: string
        try {
            text = request.captureText()
        } catch (error) {
            report({ kind: 'failed', errorName: errorNameOf(error) })
            return
        }

        const env = getEnv()
        const card: CardHandle = {
            owner: request.owner,
            superseded: false,
            htmlState: 'pending',
            result: null,
            abort: () => {},
            reassert: null,
            reassertDone: false,
        }
        let build: Build | null = null
        let written: Promise<void> | null = null
        const earlier = tail
        try {
            const input = request.captureCard(text)
            const minimalHtml = buildMinimalCardHtml(input)
            const plainBytes = utf8Bytes(text)
            if(plainBytes + utf8Bytes(minimalHtml) <= env.limitBytes){
                build = startBuild(input, env, minimalHtml, plainBytes, earlier, card)
                const blob = build.html.then((html) => new Blob([html], { type: 'text/html' }))
                blob.catch(() => {})
                const item = new ClipboardItem({
                    'text/plain': new Blob([text], { type: 'text/plain' }),
                    'text/html': blob,
                })
                written = Promise.resolve(navigator.clipboard.write([item]))
            }
        } catch {
            build?.cancel()
            written = null
        }

        if(written === null){
            build?.cancel()
            plainFallback(text, report)
            return
        }

        live.push(card)
        let writeDone!: () => void
        const writeSettled = new Promise<void>((resolve) => {
            writeDone = resolve
        })
        tail = Promise.all([earlier, writeSettled]).then(() => {})
        let marginTimer: ReturnType<typeof setTimeout> | undefined
        const release = () => {
            clearTimeout(marginTimer)
            const at = live.indexOf(card)
            if(at !== -1){
                live.splice(at, 1)
            }
            runReassert(card)
            writeDone()
        }
        marginTimer = setTimeout(release, env.deadlineMs + env.marginMs)

        written.then(
            () => {
                release()
                if(card.superseded){
                    report({ kind: 'superseded' })
                    return
                }
                const result = card.result
                report(result !== null && (result.kind === 'minimal' || result.avatarMissing) ? { kind: 'simple' } : { kind: 'copied' })
            },
            (error: unknown) => {
                release()
                report(card.superseded ? { kind: 'superseded' } : { kind: 'failed', errorName: errorNameOf(error) })
            },
        )
        report({ kind: 'loading' })
    }

    return { start, noteNewerPlainCopy }
}

const defaultController = createCardCopyController(liveCardEnv)

/** Starts a "Copy as card" for `request`. Synchronous up to the clipboard write. */
export function startCardCopy(request: CardCopyRequest): void {
    defaultController.start(request)
}

/**
 * Called by a click handler right after it issued a plain copy of `text`, so a
 * card still in flight cannot replace that text. A failure of the repeated
 * write is passed to `onFailure`.
 */
export function noteNewerPlainCopy(text: string, onFailure: (outcome: CopyOutcome) => void): void {
    defaultController.noteNewerPlainCopy(text, onFailure)
}

//#endregion
