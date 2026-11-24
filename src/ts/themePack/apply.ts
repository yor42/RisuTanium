// The apply core of an installed theme pack: reads the stored archive, checks its hash, runs the merged intake over the
// stored bytes with the worker judge, mints one blob URL per bundled file, and puts each judged screen sheet into its own
// gated style element before `#customcss`. Nothing here writes a persisted value or decides when to run; the driver does.
//
// Judged is applied: the text that reaches an element is the judged canonical text, except that each resource span is
// replaced by a blob URL. The shape variant (the allowlisted subset, judged again) is applied the same way, so it too is the
// judge's own canonical text; when that judgement fails, shape mode applies no sheet. A colour-ready area (COLOUR_READY_AREAS)
// has a colour variant with its base and a shape variant; every other area has only its shape variant, with no base, in both
// modes. Each element is created `media="not all"` before insertion and registered with the surface gate, which alone
// switches it on; this module never writes `all` and never touches `disabled`.
import { sha256Hex } from '../assetHash'
import { rangeSourceFrom, type RangeSource } from '../drive/rtb/rangeSource'
import { getAppStore } from '../storage/store/appStore'
import type { ColorScheme } from '../gui/colorscheme'
import type { SchemeTone } from '../gui/surfaceTone'
import type { BuiltinPack } from './builtins'
import type { ResourceSpan } from './canonical'
import { COLOUR_READY_AREAS } from './colourReady'
import { decls } from './csslit'
import type { AreaSheetJudgement } from './index'
import { intakePack, readVerifiedFile, type IntakeRefusal, type ScreenArea, type VerifiedPack } from './intake'
import { readJudgement, type JudgeJob, type JudgeResults, type JudgeSession } from './judgeClient'
import { LIGHT_BASE_JUDGE_PREFIX, wantsLightBase } from './lightBase'
import { triggersOwnColours } from './ownColours.svelte'
import { packDefaultScheme } from './packColours'
import { PACK_ARCHIVE_KEY } from './packRefs'
import { hasNoDeclarations, shapeOnlySheet, shapeTokenNames } from './shapeMode'
import { registerThemePackElement, registerThemePackOverlay, setThemePackElementBase, syncThemePackMedia } from './surfaceGate.svelte'

/** What a minted object URL must look like before it is written into a sheet: no quote, backslash, paren or space. */
export const BLOB_URL_PATTERN = /^blob:[A-Za-z0-9:/._\-\[\]]+$/

export type BrokenReason = 'files' | 'refused' | 'unreadable' | 'couldNotCheck'
export type ApplySource = { kind: 'builtin'; pack: BuiltinPack } | { kind: 'archive'; key: string }
/**
 * One screen's applied sheet. `text` is the colour variant (a colour-ready area) or the shape text (any other area, whose
 * `base` is null); `shapeText` is the shape variant. A null `text` and `shapeText` is an element that is never created.
 */
export interface PreparedElement {
    readonly area: ScreenArea
    readonly text: string | null
    readonly shapeText: string | null
    readonly base: SchemeTone | null
}
/**
 * The popups sheet's two applied texts. `colourText` exists only when the chat element has text (the one colour-ready screen);
 * `shapeText` is the judged shape variant. Each is on only over a screen that applies something in the matching variant.
 */
export interface PreparedPopups {
    readonly colourText: string | null
    readonly shapeText: string | null
}
/**
 * `elements` holds every screen's applied text; `defaultScheme` comes from the chat sheet alone. `ownColourTrigger` is
 * present, and true, only when a judged sheet carries a contrast or readability warning; absent means no trigger. `popups`
 * never sets it and never makes a pack show anything on its own.
 */
export type Prepared =
    | { ok: true; blobs: readonly string[]; skippedAreas: readonly string[]; defaultScheme: ColorScheme | null; elements: readonly PreparedElement[]; popups: PreparedPopups | null; ownColourTrigger?: true }
    | { ok: false; reason: BrokenReason; refusals?: readonly IntakeRefusal[] }
type Stale = { ok: false; stale: true }

const STALE: Stale = { ok: false, stale: true }

const ARCHIVE_PREFIX_LENGTH = 'assets/tp-'.length
const ARCHIVE_SUFFIX_LENGTH = '.risutheme'.length

interface CurrentElement {
    readonly el: HTMLStyleElement
    readonly area: ScreenArea
    readonly unregister: () => void
    readonly text: string
    readonly shapeText: string | null
    readonly base: SchemeTone | null
}

interface CurrentOverlay {
    readonly el: HTMLStyleElement
    readonly unregister: () => void
}

let current: readonly CurrentElement[] = []
// The popups overlay elements of the current commit; removed with `current` by the next commit.
let currentOverlays: readonly CurrentOverlay[] = []
// The blob URLs the current elements hold; revoked once, when the next commit replaces them.
let currentBlobs: readonly string[] = []

function revokeAll(urls: readonly string[]): void {
    for (const url of urls) {
        URL.revokeObjectURL(url)
    }
}

/** Maps an intake refusal list to one reason: could-not-check first, then damaged files, then a plain refusal. */
export function brokenReasonOf(refusals: readonly IntakeRefusal[]): BrokenReason {
    if (refusals.some((refusal) => refusal.code === 'couldNotCheck')) {
        return 'couldNotCheck'
    }
    if (refusals.some((refusal) => refusal.code === 'damaged' || refusal.code === 'wrongContent' || refusal.code === 'notUtf8' || refusal.code === 'manifestUnreadable')) {
        return 'files'
    }
    return 'refused'
}

/** The judged canonical text with each resource span replaced by its blob URL; every other character is kept. */
export function buildAppliedText(chat: AreaSheetJudgement, urlOfTarget: (raw: string) => string): string {
    const checked = readJudgement({ ok: true, areas: { chat } })?.areas.chat
    if (checked === undefined) {
        throw new Error('the judged sheet failed the span check')
    }
    let text = checked.canonical
    for (let i = checked.resources.length - 1; i >= 0; i--) {
        const span = checked.resources[i]
        const url = urlOfTarget(span.raw)
        text = text.slice(0, span.start) + (span.form === 'url-token' ? `url("${url}")` : `"${url}"`) + text.slice(span.end)
    }
    return text
}

function failure(reason: BrokenReason, refusals?: readonly IntakeRefusal[]): Prepared {
    return refusals === undefined ? { ok: false, reason } : { ok: false, reason, refusals }
}

/** An empty or comment-only sheet applies nothing. */
function textOrNull(text: string): string | null {
    return /^\s*$/.test(text) ? null : text
}

const LIGHT_LABEL = 'chat#light'
const SHAPE_LABEL = 'chat#shape'

/** The applied areas whose element carries only the judged shape variant, with no base, in both modes (not colour-ready). */
type ShapeOnlyArea = Exclude<ScreenArea, 'chat'>
const SHAPE_ONLY_AREAS: readonly ShapeOnlyArea[] = ['studio', 'settings']
const shapeOnlyLabel = (area: ShapeOnlyArea): string => `${area}#shape`

/**
 * The text shape mode would judge, or null when it is not judged: a sheet the allowlist leaves whole applies as it is, and
 * one it leaves empty applies nothing.
 */
function shapeJobText(chat: AreaSheetJudgement): string | null {
    const shapeSource = shapeOnlySheet(chat.canonical)
    return shapeSource === chat.canonical || /^\s*$/.test(shapeSource) ? null : shapeSource
}

/** The same for a shape-only area's sheet, over that area's own shape token list. */
function shapeOnlyJobText(area: ShapeOnlyArea, sheet: AreaSheetJudgement): string | null {
    const shapeSource = shapeOnlySheet(sheet.canonical, shapeTokenNames(area))
    return shapeSource === sheet.canonical || /^\s*$/.test(shapeSource) ? null : shapeSource
}

type ShapeOnlySheets = Readonly<Record<ShapeOnlyArea, AreaSheetJudgement | null>>
const NO_SHAPE_ONLY_SHEETS: ShapeOnlySheets = { studio: null, settings: null }

const POPUPS_SHAPE_LABEL = 'popups#shape'

/** The text the popups shape variant would judge, or null when it is not judged: left whole, or left empty, by the allowlist. */
function popupsShapeJobText(sheet: AreaSheetJudgement): string | null {
    const shapeSource = shapeOnlySheet(sheet.canonical, shapeTokenNames('popups'))
    return shapeSource === sheet.canonical || /^\s*$/.test(shapeSource) ? null : shapeSource
}

/** True when the written text carries a declaration other than an `@font-face` descriptor, so it visibly themes its screen. */
function isThemedText(text: string): boolean {
    try {
        return decls(text).some((decl) => !decl.ctx.at.some((prelude) => /^@font-face\b/i.test(prelude)))
    } catch {
        return false
    }
}

interface Variants {
    light: AreaSheetJudgement | null
    shape: AreaSheetJudgement | null
    /** The shape judgement of each shape-only area whose allowlisted subset differs from its canonical text. */
    shapeOnly: ShapeOnlySheets
    /** The shape judgement of the popups sheet, when its allowlisted subset differs from its canonical text. */
    popupsShape: AreaSheetJudgement | null
}

/**
 * Judges the variants in one request: the chat light base proof, when the pack is labelled light and has a chat sheet, the
 * chat shape subset, and the shape subset of each shape-only area, each when there is one to judge. A rejected request, like a missing or
 * refused verdict, is fail-closed: the dark base and no shape text. `null` verdicts are what the callers read as that.
 */
async function judgeVariants(modes: readonly string[], chat: AreaSheetJudgement | null, sheets: ShapeOnlySheets, popups: AreaSheetJudgement | null, session: JudgeSession, isCurrent: () => boolean): Promise<Variants | Stale> {
    const jobs: JudgeJob[] = []
    if (chat !== null) {
        if (wantsLightBase(modes)) {
            jobs.push({ label: LIGHT_LABEL, area: 'chat', text: `${LIGHT_BASE_JUDGE_PREFIX}\n${chat.canonical}` })
        }
        const shapeSource = shapeJobText(chat)
        if (shapeSource !== null) {
            jobs.push({ label: SHAPE_LABEL, area: 'chat', text: shapeSource })
        }
    }
    for (const area of SHAPE_ONLY_AREAS) {
        const sheet = sheets[area]
        const source = sheet === null ? null : shapeOnlyJobText(area, sheet)
        if (source !== null) {
            jobs.push({ label: shapeOnlyLabel(area), area, text: source })
        }
    }
    const popupsSource = popups === null ? null : popupsShapeJobText(popups)
    if (popupsSource !== null) {
        jobs.push({ label: POPUPS_SHAPE_LABEL, area: 'popups', text: popupsSource })
    }
    if (jobs.length === 0) {
        return { light: null, shape: null, shapeOnly: NO_SHAPE_ONLY_SHEETS, popupsShape: null }
    }
    let results: JudgeResults | null = null
    try {
        results = await session.jobs(jobs)
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('theme pack variant judge failed', error)
        }
    }
    if (!isCurrent()) {
        return STALE
    }
    const verdictOf = (label: string): AreaSheetJudgement | null => results !== null && Object.hasOwn(results, label) ? results[label] : null
    return { light: verdictOf(LIGHT_LABEL), shape: verdictOf(SHAPE_LABEL), shapeOnly: { studio: verdictOf(shapeOnlyLabel('studio')), settings: verdictOf(shapeOnlyLabel('settings')) }, popupsShape: verdictOf(POPUPS_SHAPE_LABEL) }
}

/**
 * The base the pack sits on. A light-only pack gets the light base only when the light base placed before the pack's
 * canonical sheet passes the same judgement: the tokens the judge never reads then take light values only for a pack whose
 * judged colours are compatible with them. Any other label, a refusal, a contrast note or an unanswered judgement keeps the
 * dark base: contrast findings are notes, so the proof reads them besides `ok`. The prefix goes first so the pack's own values
 * are the later ones, as in the applied cascade.
 */
function baseOf(light: AreaSheetJudgement | null): SchemeTone {
    return light?.result?.ok === true && !(light.result.notes ?? []).some((note) => note.rule === 'contrast') ? 'light' : 'dark'
}

/** True when the judgement that will be painted carries a warning that triggers the own colours. */
function judgementTriggers(judged: AreaSheetJudgement | null): boolean {
    return judged !== null && triggersOwnColours(judged.warnings)
}

/**
 * The text shape mode applies. The allowlisted subset of the judged sheet is itself judged, and its own canonical text
 * (with the same blob substitution) is what applies, so judged is applied for this variant too. A refused or unanswered
 * judgement, or a span naming a target with no minted URL, gives null: shape mode then applies no sheet.
 */
function prepareShapeText(chat: AreaSheetJudgement, text: string, urlOfTarget: (raw: string) => string | undefined, shape: AreaSheetJudgement | null): string | null {
    const shapeSource = shapeOnlySheet(chat.canonical)
    if (shapeSource === chat.canonical) {
        return textOrNull(text)
    }
    if (/^\s*$/.test(shapeSource)) {
        return null
    }
    if (shape?.result?.ok !== true) {
        return null
    }
    try {
        let missing = false
        const built = buildAppliedText(shape, (raw) => {
            const url = urlOfTarget(raw)
            if (url === undefined) {
                missing = true
                return ''
            }
            return url
        })
        return missing ? null : textOrNull(built)
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('theme pack shape text failed', error)
        }
        return null
    }
}

/**
 * The text of a non-colour-ready area's element: the judgement the shape variant stands for (the whole sheet when the allowlist
 * leaves it whole, else the shape judgement), with each resource span replaced by its blob URL. A refused or unanswered
 * judgement, a span with no minted URL, or a text with no declaration left (only emptied blocks) gives null: no element.
 */
function prepareShapeOnlyText(judged: AreaSheetJudgement | null, urlOfTarget: (raw: string) => string | undefined): string | null {
    if (judged?.result?.ok !== true) {
        return null
    }
    try {
        let missing = false
        const built = buildAppliedText(judged, (raw) => {
            const url = urlOfTarget(raw)
            if (url === undefined) {
                missing = true
                return ''
            }
            return url
        })
        const text = textOrNull(built)
        return missing || text === null || hasNoDeclarations(text) ? null : text
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('theme pack screen text failed', error)
        }
        return null
    }
}

async function prepareBuiltin(pack: BuiltinPack, session: JudgeSession, isCurrent: () => boolean): Promise<Prepared | Stale> {
    let judged: Awaited<ReturnType<JudgeSession['judge']>> | null = null
    try {
        judged = await session.judge({ chat: pack.chatCss })
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('theme pack judge failed', error)
        }
    }
    if (!isCurrent()) {
        return STALE
    }
    const chat = judged?.areas?.chat
    if (!chat || typeof chat.result?.ok !== 'boolean') {
        return failure('couldNotCheck')
    }
    if (!chat.result.ok) {
        return failure('refused', [{ code: 'sheetRefused', sheet: 'chat.css', errors: chat.result.errors }])
    }
    if (chat.resources.length > 0) {
        return failure('refused')
    }
    const text = buildAppliedText(chat, () => '')
    const variants = await judgeVariants(pack.modes, chat, NO_SHAPE_ONLY_SHEETS, null, session, isCurrent)
    if ('stale' in variants) {
        return variants
    }
    const base = baseOf(variants.light)
    const shapeText = prepareShapeText(chat, text, () => '', variants.shape)
    const chatText = textOrNull(text)
    return {
        ok: true, blobs: [], skippedAreas: [], defaultScheme: packDefaultScheme(chat.canonical, base),
        elements: [{ area: 'chat', text: chatText, shapeText, base }], popups: null,
        ...(judgementTriggers(chat) ? { ownColourTrigger: true as const } : {}),
    }
}

/**
 * Mints one blob URL for each target of `spans` that has none yet, in text order. Answers a failure or stale outcome to return,
 * or null when every span has a URL. The URLs are pushed to `minted` as they are made, so a later failure revokes them.
 */
async function mintMissing(source: RangeSource, pack: VerifiedPack, spans: readonly ResourceSpan[], urlOfRaw: Map<string, string>, minted: string[], isCurrent: () => boolean): Promise<Prepared | Stale | null> {
    for (const span of spans) {
        if (urlOfRaw.has(span.raw)) {
            continue
        }
        const read = await readVerifiedFile(source, pack, span.raw)
        if (!isCurrent()) {
            return STALE
        }
        if (read.ok === false) {
            return failure(brokenReasonOf([read.refusal]))
        }
        const url = URL.createObjectURL(new Blob([read.bytes as BlobPart], { type: read.mime }))
        minted.push(url)
        if (!BLOB_URL_PATTERN.test(url)) {
            return failure('couldNotCheck')
        }
        urlOfRaw.set(span.raw, url)
    }
    return null
}

async function prepareArchive(key: string, session: JudgeSession, isCurrent: () => boolean, minted: string[]): Promise<Prepared | Stale> {
    if (!PACK_ARCHIVE_KEY.test(key)) {
        return failure('unreadable')
    }
    let bytes: Uint8Array | null = null
    let readFailed = false
    try {
        bytes = (await (await getAppStore()).read(key)).bytes
    } catch (error) {
        readFailed = true
        if (import.meta.env.DEV) {
            console.error('theme pack archive read failed', error)
        }
    }
    if (!isCurrent()) {
        return STALE
    }
    if (readFailed) {
        return failure('couldNotCheck')
    }
    if (bytes === null) {
        return failure('files')
    }
    const hash = await sha256Hex(bytes)
    if (!isCurrent()) {
        return STALE
    }
    if (hash !== key.slice(ARCHIVE_PREFIX_LENGTH, -ARCHIVE_SUFFIX_LENGTH)) {
        return failure('files')
    }

    const stored = bytes
    const source = rangeSourceFrom({ size: stored.length, read: async (start, end) => stored.subarray(start, end) })
    const intake = await intakePack(source, session.judge)
    if (!isCurrent()) {
        return STALE
    }
    if (intake.ok === false) {
        const reason = brokenReasonOf(intake.refusals)
        return reason === 'refused' ? failure(reason, intake.refusals) : failure(reason)
    }

    const pack = intake.pack
    const chat = pack.sheets.chat ?? null
    const sheets: ShapeOnlySheets = { studio: pack.sheets.studio ?? null, settings: pack.sheets.settings ?? null }
    const urlOfRaw = new Map<string, string>()
    // Order: the chat resources, then one request for every variant, then the resources only a shape-only area's shape variant names.
    // Minting for such an area follows its judgement, so an image only its colour declarations name is never minted.
    if (chat !== null) {
        const outcome = await mintMissing(source, pack, chat.resources, urlOfRaw, minted, isCurrent)
        if (outcome !== null) {
            return outcome
        }
    }
    const chatText = chat === null ? null : buildAppliedText(chat, (raw) => urlOfRaw.get(raw) ?? '')
    const popupsSheet = pack.sheets.popups ?? null
    const variants = await judgeVariants(pack.manifest.modes, chat, sheets, popupsSheet, session, isCurrent)
    if ('stale' in variants) {
        return variants
    }
    const shapeJudged: Record<ShapeOnlyArea, AreaSheetJudgement | null> = { studio: null, settings: null }
    for (const area of SHAPE_ONLY_AREAS) {
        const sheet = sheets[area]
        if (sheet === null) {
            continue
        }
        // A sheet the area's allowlist leaves whole is its own shape variant; one it leaves empty applies nothing.
        const judged = shapeOnlyJobText(area, sheet) === null
            ? (/^\s*$/.test(shapeOnlySheet(sheet.canonical, shapeTokenNames(area))) ? null : sheet)
            : variants.shapeOnly[area]
        shapeJudged[area] = judged
        if (judged?.result?.ok === true) {
            const outcome = await mintMissing(source, pack, judged.resources, urlOfRaw, minted, isCurrent)
            if (outcome !== null) {
                return outcome
            }
        }
    }
    // Popups colours can paint only over a chat element that has text; its shape variant follows its own judgement. Minting
    // follows the texts that will exist, so an image only a withheld variant names is never minted.
    let popupsShapeJudged: AreaSheetJudgement | null = null
    let popupsColourJudged: AreaSheetJudgement | null = null
    if (popupsSheet !== null) {
        popupsShapeJudged = popupsShapeJobText(popupsSheet) === null
            ? (/^\s*$/.test(shapeOnlySheet(popupsSheet.canonical, shapeTokenNames('popups'))) ? null : popupsSheet)
            : variants.popupsShape
        popupsColourJudged = chatText !== null && textOrNull(chatText) !== null ? popupsSheet : null
        for (const judged of [popupsColourJudged, popupsShapeJudged]) {
            if (judged?.result?.ok === true) {
                const outcome = await mintMissing(source, pack, judged.resources, urlOfRaw, minted, isCurrent)
                if (outcome !== null) {
                    return outcome
                }
            }
        }
    }
    const elements: PreparedElement[] = []
    let defaultScheme: ColorScheme | null = null
    // A shape-only sheet paints no colour, but its own judgement still counts, as Studio's always has.
    let ownColourTrigger = SHAPE_ONLY_AREAS.some((area) => judgementTriggers(sheets[area]))
    if (chat !== null && chatText !== null) {
        const base = baseOf(variants.light)
        // The colours painted come from the light variant when the pack's light base applies, else from the chat sheet.
        ownColourTrigger = judgementTriggers(base === 'light' ? variants.light : chat) || ownColourTrigger
        defaultScheme = packDefaultScheme(chat.canonical, base)
        elements.push({ area: 'chat', text: textOrNull(chatText), shapeText: prepareShapeText(chat, chatText, (raw) => urlOfRaw.get(raw), variants.shape), base })
    }
    // Studio and Settings are not colour-ready: each element carries only its shape text and no base, in both modes.
    for (const area of SHAPE_ONLY_AREAS) {
        const areaText = prepareShapeOnlyText(shapeJudged[area], (raw) => urlOfRaw.get(raw))
        if (areaText !== null) {
            elements.push({ area, text: areaText, shapeText: areaText, base: null })
        }
    }
    const colourText = prepareShapeOnlyText(popupsColourJudged, (raw) => urlOfRaw.get(raw))
    const popupsShapeText = prepareShapeOnlyText(popupsShapeJudged, (raw) => urlOfRaw.get(raw))
    const popups: PreparedPopups | null = colourText === null && popupsShapeText === null ? null : { colourText, shapeText: popupsShapeText }
    return { ok: true, blobs: [...minted], skippedAreas: pack.skippedAreas, defaultScheme, elements, popups, ...(ownColourTrigger ? { ownColourTrigger: true as const } : {}) }
}

/**
 * Async: reads, checks, judges and mints. Never rejects: any throw revokes what this call minted and answers
 * `couldNotCheck`, or stale when the call is no longer current at that point. `isCurrent` is asked after every await; a
 * stale call revokes what it minted and answers stale. Every failure after minting revokes what was minted.
 */
export async function preparePackSheet(source: ApplySource, session: JudgeSession, isCurrent: () => boolean): Promise<Prepared | Stale> {
    const minted: string[] = []
    try {
        const outcome = source.kind === 'builtin'
            ? await prepareBuiltin(source.pack, session, isCurrent)
            : await prepareArchive(source.key, session, isCurrent, minted)
        if (outcome.ok === false) {
            revokeAll(minted)
        }
        return outcome
    } catch (error) {
        revokeAll(minted)
        if (import.meta.env.DEV) {
            console.error('theme pack apply failed', error)
        }
        return isCurrent() ? failure('couldNotCheck') : STALE
    }
}

/** What `commitPackSheet` takes: every prepared screen element, the blobs they hold, and whether the pack is in colour mode (default on). */
export interface CommitInput {
    elements: readonly PreparedElement[]
    popups?: PreparedPopups | null
    blobs: readonly string[]
    colours?: boolean
}

/**
 * The synchronous DOM step, in the gate's order: insert each new element (off) before `#customcss`, in the order given, and
 * register it with its area and, for a colour-ready area in colour mode only, its base; remove and unregister every previous
 * element and revoke its blobs once; then sync the gate. An element with no text and no shape text is never created. A missing
 * `#customcss` inserts nothing and leaves the previous elements for the caller to remove. The popups overlays are created off,
 * after the screen elements and only when at least one screen element is created; they are unregistered and removed with the
 * previous elements.
 */
export function commitPackSheet(next: CommitInput | null): { ok: true } | { ok: false; reason: 'couldNotCheck' } {
    const previous = current
    const previousBlobs = currentBlobs
    const previousOverlays = currentOverlays
    const created: CurrentElement[] = []
    const createdOverlays: CurrentOverlay[] = []
    if (next !== null) {
        const wanted = next.elements.filter((element) => element.text !== null || element.shapeText !== null)
        if (wanted.length > 0) {
            const anchor = document.querySelector('body > #customcss')
            if (anchor === null) {
                revokeAll(next.blobs)
                return { ok: false, reason: 'couldNotCheck' }
            }
            const colours = next.colours ?? true
            for (const element of wanted) {
                const ready = colours && COLOUR_READY_AREAS.has(element.area)
                const text = ready ? (element.text ?? '') : (element.shapeText ?? '')
                const el = document.createElement('style')
                el.setAttribute('media', 'not all')
                el.setAttribute('data-theme-pack', element.area)
                el.textContent = text
                anchor.before(el)
                created.push({ el, area: element.area, unregister: registerThemePackElement(el, element.area, ready ? element.base : null, isThemedText(text)), text: element.text ?? '', shapeText: element.shapeText, base: element.base })
            }
            // The popups sheets exist only beside a screen element, which alone can make them visible.
            const popups = next.popups ?? null
            for (const [variant, overlayText] of [['colour', popups?.colourText ?? null], ['shape', popups?.shapeText ?? null]] as const) {
                if (overlayText === null) {
                    continue
                }
                const el = document.createElement('style')
                el.setAttribute('media', 'not all')
                el.setAttribute('data-theme-pack', 'popups')
                el.setAttribute('data-theme-pack-variant', variant)
                el.textContent = overlayText
                anchor.before(el)
                createdOverlays.push({ el, unregister: registerThemePackOverlay(el, variant) })
            }
        } else {
            revokeAll(next.blobs)
        }
    }
    for (const element of previous) {
        element.unregister()
        element.el.remove()
    }
    for (const overlay of previousOverlays) {
        overlay.unregister()
        overlay.el.remove()
    }
    revokeAll(previousBlobs)
    current = created
    currentOverlays = createdOverlays
    currentBlobs = created.length > 0 && next !== null ? next.blobs : []
    syncThemePackMedia()
    return { ok: true }
}

/**
 * Switches every current element between its colour variant (the judged sheet, with its base) and its shape variant (the
 * judged allowlisted subset, no base) in place. Only a colour-ready area has a colour variant; any other element keeps its
 * shape text and a null base in both modes. It never creates or removes an element and never revokes a blob: both variants
 * share the minted URLs. With no current element it does nothing.
 */
export function setPackSheetColours(on: boolean): void {
    if (current.length === 0) {
        return
    }
    for (const element of current) {
        const ready = on && COLOUR_READY_AREAS.has(element.area)
        const text = ready ? element.text : (element.shapeText ?? '')
        if (element.el.textContent !== text) {
            element.el.textContent = text
        }
        setThemePackElementBase(element.el, ready ? element.base : null, isThemedText(text))
    }
    syncThemePackMedia()
}
/** Test seam: detaches and forgets the current element without touching the gate registry's other entries. */
export function resetPackSheetForTests(): void {
    for (const element of current) {
        element.unregister()
        element.el.remove()
    }
    for (const overlay of currentOverlays) {
        overlay.unregister()
        overlay.el.remove()
    }
    current = []
    currentOverlays = []
    currentBlobs = []
}
