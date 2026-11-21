// The apply core of an installed theme pack: reads the stored archive, checks its hash, runs the merged intake over the
// stored bytes with the worker judge, mints one blob URL per bundled file, and puts the judged chat sheet into one gated
// style element before `#customcss`. Nothing here writes a persisted value or decides when to run; the driver does.
//
// Judged is applied: the text that reaches the element is the judged canonical text, except that each resource span is
// replaced by a blob URL. The shape variant (the allowlisted subset, judged again) is applied the same way, so it too is the
// judge's own canonical text; when that judgement fails, shape mode applies no sheet. The element is created `media="not all"`
// before insertion and registered with the surface gate, which alone switches it on; this module never writes `all` and
// never touches `disabled`.
import { sha256Hex } from '../assetHash'
import { rangeSourceFrom } from '../drive/rtb/rangeSource'
import { getAppStore } from '../storage/store/appStore'
import type { ColorScheme } from '../gui/colorscheme'
import type { SchemeTone } from '../gui/surfaceTone'
import type { BuiltinPack } from './builtins'
import type { AreaSheetJudgement } from './index'
import { intakePack, readVerifiedFile, type IntakeRefusal } from './intake'
import { readJudgement, type JudgeJob, type JudgeResults, type JudgeSession } from './judgeClient'
import { LIGHT_BASE_JUDGE_PREFIX, wantsLightBase } from './lightBase'
import { packDefaultScheme } from './packColours'
import { PACK_ARCHIVE_KEY } from './packRefs'
import { shapeOnlySheet } from './shapeMode'
import { registerThemePackElement, setThemePackElementBase, syncThemePackMedia } from './surfaceGate.svelte'

/** What a minted object URL must look like before it is written into a sheet: no quote, backslash, paren or space. */
export const BLOB_URL_PATTERN = /^blob:[A-Za-z0-9:/._\-\[\]]+$/

export type BrokenReason = 'files' | 'refused' | 'unreadable' | 'couldNotCheck'
export type ApplySource = { kind: 'builtin'; pack: BuiltinPack } | { kind: 'archive'; key: string }
export type Prepared =
    | { ok: true; text: string | null; blobs: readonly string[]; skippedAreas: readonly string[]; base: SchemeTone; shapeText: string | null; defaultScheme: ColorScheme | null }
    | { ok: false; reason: BrokenReason; refusals?: readonly IntakeRefusal[] }
type Stale = { ok: false; stale: true }

const STALE: Stale = { ok: false, stale: true }

const ARCHIVE_PREFIX_LENGTH = 'assets/tp-'.length
const ARCHIVE_SUFFIX_LENGTH = '.risutheme'.length

interface CurrentElement {
    readonly el: HTMLStyleElement
    readonly unregister: () => void
    readonly blobs: readonly string[]
    readonly text: string
    readonly shapeText: string | null
    readonly base: SchemeTone
}

let current: CurrentElement | null = null

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

/**
 * The text shape mode would judge, or null when it is not judged: a sheet the allowlist leaves whole applies as it is, and
 * one it leaves empty applies nothing.
 */
function shapeJobText(chat: AreaSheetJudgement): string | null {
    const shapeSource = shapeOnlySheet(chat.canonical)
    return shapeSource === chat.canonical || /^\s*$/.test(shapeSource) ? null : shapeSource
}

/**
 * Judges the variants of the chat sheet in one request: the light base proof, when the pack is labelled light, and the shape
 * subset, when shape mode has one to judge. A rejected request, like a missing or refused verdict, is fail-closed: the dark
 * base and no shape text. `null` verdicts are what the callers read as that.
 */
async function judgeVariants(modes: readonly string[], chat: AreaSheetJudgement, session: JudgeSession, isCurrent: () => boolean): Promise<{ light: AreaSheetJudgement | null; shape: AreaSheetJudgement | null } | Stale> {
    const jobs: JudgeJob[] = []
    if (wantsLightBase(modes)) {
        jobs.push({ label: LIGHT_LABEL, area: 'chat', text: `${LIGHT_BASE_JUDGE_PREFIX}\n${chat.canonical}` })
    }
    const shapeSource = shapeJobText(chat)
    if (shapeSource !== null) {
        jobs.push({ label: SHAPE_LABEL, area: 'chat', text: shapeSource })
    }
    if (jobs.length === 0) {
        return { light: null, shape: null }
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
    return { light: verdictOf(LIGHT_LABEL), shape: verdictOf(SHAPE_LABEL) }
}

/**
 * The base the pack sits on. A light-only pack gets the light base only when the light base placed before the pack's
 * canonical sheet passes the same judgement: the tokens the judge never reads then take light values only for a pack whose
 * judged colours are compatible with them. Any other label, a refusal or an unanswered judgement keeps the dark base. The
 * prefix goes first so the pack's own values are the later ones, as in the applied cascade.
 */
function baseOf(light: AreaSheetJudgement | null): SchemeTone {
    return light?.result?.ok === true ? 'light' : 'dark'
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
    const variants = await judgeVariants(pack.modes, chat, session, isCurrent)
    if ('stale' in variants) {
        return variants
    }
    const base = baseOf(variants.light)
    const shapeText = prepareShapeText(chat, text, () => '', variants.shape)
    return { ok: true, text: textOrNull(text), blobs: [], skippedAreas: [], base, shapeText, defaultScheme: packDefaultScheme(chat.canonical, base) }
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
    const chat = pack.sheets.chat
    const urlOfRaw = new Map<string, string>()
    for (const span of chat.resources) {
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
    const text = buildAppliedText(chat, (raw) => urlOfRaw.get(raw) ?? '')
    const variants = await judgeVariants(pack.manifest.modes, chat, session, isCurrent)
    if ('stale' in variants) {
        return variants
    }
    const base = baseOf(variants.light)
    const shapeText = prepareShapeText(chat, text, (raw) => urlOfRaw.get(raw), variants.shape)
    return { ok: true, text: textOrNull(text), blobs: [...minted], skippedAreas: pack.skippedAreas, base, shapeText, defaultScheme: packDefaultScheme(chat.canonical, base) }
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

/**
 * The synchronous DOM step, in the gate's order: insert the new element (off) before `#customcss` and register it, remove
 * and unregister the previous one and revoke its blobs, then sync the gate. A missing `#customcss` inserts nothing and
 * leaves the previous element for the caller to remove.
 */
export function commitPackSheet(next: { text: string; blobs: readonly string[]; base?: SchemeTone; shapeText?: string | null; colours?: boolean } | null):{ ok: true } | { ok: false; reason: 'couldNotCheck' } {
    const previous = current
    let created: CurrentElement | null = null
    if (next !== null) {
        const anchor = document.querySelector('body > #customcss')
        if (anchor === null) {
            revokeAll(next.blobs)
            return { ok: false, reason: 'couldNotCheck' }
        }
        const colours = next.colours ?? true
        const base = next.base ?? 'dark'
        const shapeText = next.shapeText ?? null
        const el = document.createElement('style')
        el.setAttribute('media', 'not all')
        el.setAttribute('data-theme-pack', 'chat')
        el.textContent = colours ? next.text : (shapeText ?? '')
        anchor.before(el)
        created = { el, unregister: registerThemePackElement(el, 'chat', colours ? base : null), blobs: next.blobs, text: next.text, shapeText, base }
    }
    if (previous !== null) {
        previous.unregister()
        previous.el.remove()
        revokeAll(previous.blobs)
    }
    current = created
    syncThemePackMedia()
    return { ok: true }
}

/**
 * Switches the current element between its colour variant (the judged sheet, with the fixed base) and its shape variant
 * (the judged allowlisted subset, no base) in place. It never creates or removes an element and never revokes a blob:
 * both variants share the minted URLs. With no current element it does nothing.
 */
export function setPackSheetColours(on: boolean): void {
    if (current === null) {
        return
    }
    const text = on ? current.text : (current.shapeText ?? '')
    if (current.el.textContent !== text) {
        current.el.textContent = text
    }
    setThemePackElementBase(current.el, on ? current.base : null)
    syncThemePackMedia()
}

/** Test seam: detaches and forgets the current element without touching the gate registry's other entries. */
export function resetPackSheetForTests(): void {
    current?.unregister()
    current?.el.remove()
    current = null
}
