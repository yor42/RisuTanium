// The reference scanner: where an asset or emotion name is used in an owner's text, matched the way the engine
// reads each syntax. Pure.
//
// Invariants that the rewrite planner and the merge preview rely on:
// - A hit is compared with a name by its own syntax: the CBS media macros, `<img src>` and `{{emotion::}}` ignore
//   case in the name (their type word is exact); `{{asset_prompt::}}` and `@@emo` compare the name exactly.
// - A scan of an asset name never reports an emotion syntax, and the reverse: the kinds never cross.
// - A flagged hit is listed and never rewritten: a name that is itself dynamic (`{{`), that a regex replacement
//   would read (`$1`, `$<`, and in a regex `out` also `$&`, `$$`, `` $` `` and `$'`), an unquoted `src`, a bare value, a default-variable value, and every flag-only target
//   (Lua, trigger code, `cjs`, patterns) that holds the name. A name list (`{{ele::`) is reported apart.
// - The scanner reads texts and writes nothing.

import { assetPoolKey } from './folderCodec'
import type { ClassifiedTarget } from './referenceTargets'

export type AssetKind = 'asset' | 'emotion'

export type ReferenceSyntax = 'macro' | 'imgSrc' | 'assetPrompt' | 'emotionMacro' | 'emoScript'

export type FlagReason =
    /** The name holds `{{`: it is computed at run time. */
    | 'dynamicName'
    /** The name holds `$` and a digit or `<`, or in a regex `out` another `$` special: a replacement would read it. */
    | 'replacementPattern'
    | 'unquotedSrc'
    /** The whole value of a trigger field is the name. */
    | 'wholeValue'
    /** A default-variable line whose value is the name. */
    | 'defaultVariable'
    /** A flag-only target (code, pattern, `cjs`) holds the name. */
    | 'flagOnlyTarget'
    /** The kept name would be read as syntax where it is written (braces, a replacement pattern, a quote). */
    | 'unsafeKeptName'
    /** Another edit already holds part of the same span. */
    | 'overlap'

/** One reference as written: a name span inside one text. */
export interface RawReference {
    syntax: ReferenceSyntax
    /** Start of the name span in the text. */
    offset: number
    length: number
    /** The name as written. */
    name: string
    flag?: FlagReason
}

const MACRO = /\{\{(raw|path|img|image|video|audio|bgm|bg|asset|video-img)::(.+?)\}\}/gs
const EMOTION_MACRO = /\{\{emotion::(.+?)\}\}/gs
const ASSET_PROMPT = /\{\{asset_?prompt::(.+?)\}\}/gis
const IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi
const NAME_LIST = /\{\{ele::(.+?)\}\}/gs
const REGEX_OUT_PATH = /^regex\/\d+\/out$/

/** The longest `src` the image lookup treats as a name. */
const MAX_SRC_LENGTH = 200

const EMO_PREFIX = '@@emo '

/** A regex `out` is a JS replacement string, so `$&`, `$$`, `` $` `` and `$'` are substituted there too. */
const REPLACEMENT_SPECIALS = /\$[&$`']/

/** Whether a path is a regex script's `out`, the one text a replacement pattern and `@@emo` are read in. */
export function isRegexOutPath(path: string): boolean {
    return REGEX_OUT_PATH.test(path)
}

/** Whether `name` would be read as a replacement pattern where it is written: always for `$digit` and `$<`, and for the other specials in a regex `out`. */
export function readsAsReplacementPattern(name: string, path: string): boolean {
    return /\$[\d<]/.test(name) || (isRegexOutPath(path) && REPLACEMENT_SPECIALS.test(name))
}

function nameFlag(name: string, path: string): FlagReason | undefined {
    if (name.includes('{{')) {
        return 'dynamicName'
    }
    return readsAsReplacementPattern(name, path) ? 'replacementPattern' : undefined
}

/** Whether the image lookup treats `src` as a name: not empty, no `:`, at most 200 characters once folded. */
export function imgSrcNameIsReadable(name: string): boolean {
    const folded = assetPoolKey(name)
    return name !== '' && folded.length <= MAX_SRC_LENGTH && !folded.includes(':')
}

function withFlag(reference: RawReference, flag: FlagReason | undefined): RawReference {
    if (flag) {
        reference.flag = flag
    }
    return reference
}

/**
 * The lazy name pattern stops at the first `}}`, which inside a name that holds a nested macro is the nested
 * macro's own. When the name holds `{{`, the span is widened to the `}}` that closes the reference, counting
 * nested braces, so a flagged name is judged whole. With no closing brace pair the lazy span stays.
 */
function widenDynamicName(text: string, start: number, lazyName: string): string {
    if (!lazyName.includes('{{')) {
        return lazyName
    }
    let depth = 1
    let at = start
    while (at < text.length - 1) {
        if (text.startsWith('{{', at)) {
            depth += 1
            at += 2
        } else if (text.startsWith('}}', at)) {
            depth -= 1
            if (depth === 0) {
                return text.substring(start, at)
            }
            at += 2
        } else {
            at += 1
        }
    }
    return lazyName
}

/**
 * Every reference of the kind in one text, in order of position, flagged where the name cannot be rewritten
 * safely. `path` tells the scanner whether the text is a regex `out`, the only place `@@emo` is read.
 */
export function scanReferences(text: string, kind: AssetKind, path: string): RawReference[] {
    const found: RawReference[] = []
    if (kind === 'asset') {
        for (const match of text.matchAll(MACRO)) {
            const offset = match.index + 2 + match[1].length + 2
            const name = widenDynamicName(text, offset, match[2])
            found.push(withFlag({ syntax: 'macro', offset, length: name.length, name }, nameFlag(name, path)))
        }
        for (const match of text.matchAll(ASSET_PROMPT)) {
            const offset = match.index + match[0].length - match[1].length - 2
            const name = widenDynamicName(text, offset, match[1])
            found.push(withFlag({ syntax: 'assetPrompt', offset, length: name.length, name }, nameFlag(name, path)))
        }
        for (const match of text.matchAll(IMG_SRC)) {
            const quoted = match[1] ?? match[2]
            const name = quoted ?? match[3]
            if (!imgSrcNameIsReadable(name)) {
                continue
            }
            const end = match.index + match[0].length - (quoted === undefined ? 0 : 1)
            const reference: RawReference = { syntax: 'imgSrc', offset: end - name.length, length: name.length, name }
            found.push(withFlag(reference, quoted === undefined ? 'unquotedSrc' : nameFlag(name, path)))
        }
    } else {
        for (const match of text.matchAll(EMOTION_MACRO)) {
            const offset = match.index + '{{emotion::'.length
            const name = widenDynamicName(text, offset, match[1])
            found.push(withFlag({ syntax: 'emotionMacro', offset, length: name.length, name }, nameFlag(name, path)))
        }
        if (REGEX_OUT_PATH.test(path) && text.startsWith(EMO_PREFIX)) {
            const rest = text.substring(EMO_PREFIX.length)
            const name = rest.trim()
            if (name !== '') {
                const lead = rest.length - rest.trimStart().length
                found.push(withFlag({ syntax: 'emoScript', offset: EMO_PREFIX.length + lead, length: name.length, name }, nameFlag(name, path)))
            }
        }
    }
    return found.sort((a, b) => a.offset - b.offset)
}

/** Whether the syntax compares a name exactly: `asset_prompt` and `@@emo`. The others ignore case. */
export function syntaxIsExact(syntax: ReferenceSyntax): boolean {
    return syntax === 'assetPrompt' || syntax === 'emoScript'
}

/** Whether a reference names `name`, under its own syntax's comparison. */
export function referenceMatchesName(reference: RawReference, name: string): boolean {
    return syntaxIsExact(reference.syntax) ? reference.name === name : assetPoolKey(reference.name) === assetPoolKey(name)
}

export type PlaceSyntax = ReferenceSyntax | 'wholeValue' | 'defaultVariable' | 'flagOnlyTarget' | 'nameList'

/** One place a name is used, for the lists and for the rewrite. */
export interface PlaceHit {
    /** The target path. */
    path: string
    offset: number
    length: number
    /** The text of the span as written. */
    name: string
    syntax: PlaceSyntax
    reason?: FlagReason
    /** Set on a `creatorNotes` hit: the language section holding it, `xx` outside every section. */
    lang?: string
}

export interface NameScan {
    /** Rewritable places that name it by their syntax's comparison and are not flagged. */
    matches: PlaceHit[]
    /** Places listed and never rewritten. */
    flagged: PlaceHit[]
    /** `{{ele::` lists that hold the name. Listed apart: the list is edited by hand. */
    nameLists: PlaceHit[]
}

const MULTILANG_SECTION = /# `(.+?)`\n([\s\S]+?)(?=\n# `|$)/g

/**
 * The language of an offset in a stored creator-comment string: the code of the section that holds it, `xx` for text
 * outside every section. A section's body starts after its header line, as `parseMultilangString` reads it.
 */
export function creatorNotesLang(text: string, offset: number): string {
    for (const match of text.matchAll(MULTILANG_SECTION)) {
        const start = match.index + match[0].length - match[2].length
        if (offset >= start && offset < start + match[2].length) {
            return match[1]
        }
    }
    return 'xx'
}

function containsFolded(haystack: string, name: string): boolean {
    return assetPoolKey(haystack).includes(assetPoolKey(name))
}

/**
 * Scans the targets for one name. A reference to the name is a match when its target is rewritable and nothing
 * flags it; every other sighting of the name goes to `flagged` or `nameLists`. Hits come in target order, then
 * position.
 */
export function scanForName(targets: readonly ClassifiedTarget[], kind: AssetKind, name: string): NameScan {
    const scan: NameScan = { matches: [], flagged: [], nameLists: [] }
    const key = assetPoolKey(name)
    for (const target of targets) {
        const { path, text } = target
        const add = (list: PlaceHit[], hit: PlaceHit) => {
            if (path === 'creatorNotes') {
                hit.lang = creatorNotesLang(text, hit.offset)
            }
            list.push(hit)
        }
        const references = scanReferences(text, kind, path)
        if (target.cls === 'flagOnly') {
            if (references.some((ref) => referenceMatchesName(ref, name)) || containsFolded(text, name)) {
                add(scan.flagged, { path, offset: 0, length: text.length, name: text, syntax: 'flagOnlyTarget', reason: 'flagOnlyTarget' })
            }
            continue
        }
        const hits: PlaceHit[] = []
        for (const ref of references) {
            const place: PlaceHit = { path, offset: ref.offset, length: ref.length, name: ref.name, syntax: ref.syntax }
            if (ref.flag === 'dynamicName' || ref.flag === 'replacementPattern') {
                if (containsFolded(ref.name, name)) {
                    place.reason = ref.flag
                    add(hits, place)
                }
            } else if (referenceMatchesName(ref, name)) {
                if (ref.flag) {
                    place.reason = ref.flag
                }
                add(hits, place)
            }
        }
        for (const hit of hits) {
            if (hit.reason) {
                scan.flagged.push(hit)
            } else {
                scan.matches.push(hit)
            }
        }
        if (path.startsWith('trigger/')) {
            const trimmed = text.trim()
            if (trimmed !== '' && assetPoolKey(trimmed) === key) {
                add(scan.flagged, { path, offset: text.indexOf(trimmed), length: trimmed.length, name: trimmed, syntax: 'wholeValue', reason: 'wholeValue' })
            }
        }
        if (path === 'defaultVariables') {
            let lineStart = 0
            for (const line of text.split('\n')) {
                const eq = line.indexOf('=')
                if (eq >= 0) {
                    const rest = line.substring(eq + 1)
                    const value = rest.trim()
                    if (value !== '' && assetPoolKey(value) === key) {
                        const offset = lineStart + eq + 1 + (rest.length - rest.trimStart().length)
                        add(scan.flagged, { path, offset, length: value.length, name: value, syntax: 'defaultVariable', reason: 'defaultVariable' })
                    }
                }
                lineStart += line.length + 1
            }
        }
        for (const match of text.matchAll(NAME_LIST)) {
            if (containsFolded(match[1], name)) {
                add(scan.nameLists, { path, offset: match.index, length: match[0].length, name: match[0], syntax: 'nameList' })
            }
        }
    }
    return scan
}

/** An asset or emotion row as far as the lookups read it: the name comes first. */
export type NameRow = readonly [name: string, ...rest: string[]]

export interface CloseMatchSettings {
    assetMaxDifference: number
    legacyMediaFindings: boolean
    newImageHandlingBeta: boolean
}

export type CloseMatchPath = 'macro' | 'imgSrc'

/** Levenshtein distance, as the engine's `getDistance`. */
function distance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        const row = [i]
        for (let j = 1; j <= b.length; j++) {
            row.push(Math.min(
                previous[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1),
                previous[j] + 1,
                row[j - 1] + 1,
            ))
        }
        previous = row
    }
    return previous[b.length]
}

const TRIMMED_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'gif', 'mp4', 'webm', 'avi', 'm4p', 'm4v', 'mp3', 'wav', 'ogg']

/** The engine's `trimmer`: known extensions off the end, then spaces and every character from space to `.` out. */
function trimmedName(value: string): string {
    let str = value
    for (const extension of TRIMMED_EXTENSIONS) {
        if (str.endsWith('.' + extension)) {
            str = str.substring(0, str.length - extension.length - 1)
        }
    }
    return str.trim().replace(/[_ -.]/g, '')
}

/**
 * What a literal name resolves to, as the engine resolves it: the matched row's name, or null.
 *
 * `'macro'` (the CBS media macros): the folded name is looked up exactly over the character's rows, then the
 * modules' (the character wins a collision). On a miss, and unless `legacyMediaFindings` is on, the character's rows
 * alone are searched for the nearest by trimmed distance within `assetMaxDifference`; the first minimum wins.
 * Module rows never fuzzy-match here.
 *
 * `'imgSrc'` (a raw `<img src>`, only with `newImageHandlingBeta`): a src with `:` or longer than 200 is no
 * name; the exact lookup follows (character first); a src shorter than 3 then ends; otherwise the rows whose
 * folded name starts with the src's extension-less prefix are compared by raw distance, module rows first, the
 * first minimum within `assetMaxDifference` winning. This path does not read `legacyMediaFindings`.
 *
 * The engine's own functions are private to the parser and the chat component, so this reproduces them; the
 * tests keep a hand-derived table of their choices.
 */
export function closeMatch(
    rows: readonly NameRow[],
    moduleRows: readonly NameRow[],
    name: string,
    path: CloseMatchPath,
    settings: CloseMatchSettings,
): string | null {
    const key = assetPoolKey(name)
    if (path === 'imgSrc') {
        if (!settings.newImageHandlingBeta || key.length > MAX_SRC_LENGTH || key.includes(':')) {
            return null
        }
    }
    const exact = rows.find((row) => assetPoolKey(row[0]) === key) ?? moduleRows.find((row) => assetPoolKey(row[0]) === key)
    if (exact) {
        return exact[0]
    }
    if (path === 'macro') {
        if (settings.legacyMediaFindings) {
            return null
        }
        const target = trimmedName(key)
        let best: string | null = null
        let bestDistance = 999999
        for (const row of rows) {
            const d = distance(target, trimmedName(assetPoolKey(row[0])))
            if (d < bestDistance) {
                best = row[0]
                bestDistance = d
            }
        }
        return bestDistance > settings.assetMaxDifference ? null : best
    }
    if (key.length < 3) {
        return null
    }
    const dot = key.lastIndexOf('.')
    const prefix = dot > 0 ? key.substring(0, dot) : ''
    let best: string | null = null
    let bestDistance = 1000
    for (const row of [...moduleRows, ...rows]) {
        const folded = assetPoolKey(row[0])
        if (!folded.startsWith(prefix)) {
            continue
        }
        const d = distance(key, folded)
        if (d < bestDistance) {
            best = row[0]
            bestDistance = d
        }
    }
    return bestDistance > settings.assetMaxDifference ? null : best
}
