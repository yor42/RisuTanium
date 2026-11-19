// The places where text reads a toggle by key: a reduced copy of the token loop of the engine's `risuChatParser`
// (parser.svelte.ts), kept to the facts the toggle readers depend on. Pure: strings in, hits out.
//
// Invariants:
// - A hit's span (`offset`, `length`) covers the key part only and indexes the text as stored. The engine rewrites
//   `<user|char|bot>` to `{{user|char|bot}}` before it tokenizes, which adds exactly 2 characters per tag; the walk
//   runs on that text and every offset is mapped back to the stored text.
// - Tokens are non-overlapping pairs read left to right, as the engine's pointer does: `{{` or `{#` opens a macro,
//   `}}` or `#}` closes it while a macro is on top, and a block level on top keeps `}}` and `#}` as text.
// - A reader is static when no macro closed inside it. Only static readers closed by `}}` yield a hit; a reader that
//   holds a nested macro may build its key at run time and is reported as a dynamic-name hit.
// - A hit with a `flag` is listed for the user and is never rewritten.

import { classifyBlockStart, purity } from './longText/cbsBlocks'
import { cbsNameKey } from './longText/macroIndex'
import type { TargetClass } from './assets/referenceTargets'

export type UseSyntax = 'getglobalvar' | 'when' | 'calc' | 'code'
export type UseFlag = 'dynamicName' | 'literalBlock' | 'code' | 'regexPattern' | 'calcKey'

export interface UseHit {
    readonly path: string
    /** Index of the key part in the stored text. */
    readonly offset: number
    readonly length: number
    readonly key: string
    readonly syntax: UseSyntax
    readonly flag?: UseFlag
}

const ROLE_TAG = /<(user|char|bot)>/gi
// Stands in for a nested macro while a reader is judged as text.
const NESTED = '\u0000'
const TOGGLE_PREFIX = 'toggle_'
const WORD = /[A-Za-z0-9_]/
const CALC_READ = /@([A-Za-z0-9_]+)/g
const CALC_READ_DYNAMIC = /@((?:[A-Za-z0-9_]|\u0000)+)/g

interface RawHit {
    offset: number
    length: number
    key: string
    syntax: UseSyntax
    flag?: UseFlag
}

interface Level {
    // 1 macro, 5 block, 6 level a block-start macro opens while the engine is in pure mode.
    type: 1 | 5 | 6
    open: number
    start: number
    children: [number, number][]
    hadChild: boolean
    pure: boolean
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Whether `pattern`, with every nested macro read as any text, can equal `target`.
function couldEqual(pattern: string, target: string): boolean {
    return new RegExp('^' + pattern.split(NESTED).map(escapeRegExp).join('[\\s\\S]*') + '$').test(target)
}

interface SplitDat {
    name: string
    args0: string | undefined
    args0Start: number
}

// The engine's split of a macro's text: on `::` when the first `:` is followed by `:`, on `:` otherwise.
function splitDat(dat: string): SplitDat {
    const colon = dat.indexOf(':')
    const sep = colon !== -1 && dat[colon + 1] === ':' ? '::' : ':'
    const first = dat.indexOf(sep)
    if (first === -1) {
        return { name: dat, args0: undefined, args0Start: dat.length }
    }
    const args0Start = first + sep.length
    const next = dat.indexOf(sep, args0Start)
    return { name: dat.slice(0, first), args0: dat.slice(args0Start, next === -1 ? undefined : next), args0Start }
}

function calcHits(text: string, base: number, keys: ReadonlySet<string>, out: RawHit[]): void {
    for (const match of text.matchAll(CALC_READ)) {
        const captured = match[1]
        if (captured.startsWith(TOGGLE_PREFIX) && keys.has(captured.slice(TOGGLE_PREFIX.length))) {
            const key = captured.slice(TOGGLE_PREFIX.length)
            // The engine splices a parenthesis result in right after the name, and replaces `$var` before it reads the
            // name, so a name followed by `(` or `$` reads a longer key: the hit is listed, never rewritten.
            const follower = text[match.index + match[0].length]
            const flag = follower === '(' || follower === '$' ? { flag: 'calcKey' as const } : {}
            out.push({ offset: base + match.index + 1 + TOGGLE_PREFIX.length, length: key.length, key, syntax: 'calc', ...flag })
        }
    }
}

function whenHits(dat: string, base: number, keys: ReadonlySet<string>, out: RawHit[]): void {
    const segments = dat.split('::').slice(1)
    if (segments.length <= 1) {
        return
    }
    const offsets: number[] = []
    let at = base + '#when'.length
    for (const segment of segments) {
        at += 2
        offsets.push(at)
        at += segment.length
    }
    // Items are segment indexes; -1 is a computed result. Pop order and arity are the engine's fold.
    const items = segments.map((_, index) => index)
    const record = (index: number | undefined) => {
        if (index !== undefined && index >= 0 && keys.has(segments[index])) {
            out.push({ offset: offsets[index], length: segments[index].length, key: segments[index], syntax: 'when' })
        }
    }
    while (items.length > 1) {
        const condition = items.pop() as number
        const operatorItem = items.pop() as number
        const operator = operatorItem >= 0 ? segments[operatorItem] : undefined
        switch (operator) {
            case 'keep':
            case 'legacy':
                items.push(condition)
                break
            case 'and':
            case 'or':
            case 'is':
            case 'isnot':
            case '>':
            case '<':
            case '>=':
            case '<=':
            case 'vis':
            case 'visnot':
                items.pop()
                items.push(-1)
                break
            case 'toggle':
                record(condition)
                items.push(-1)
                break
            case 'tis':
            case 'tisnot':
                record(items.pop())
                items.push(-1)
                break
            default:
                items.push(-1)
                break
        }
    }
}

function staticHits(dat: string, base: number, keys: ReadonlySet<string>, out: RawHit[]): void {
    if (dat.startsWith('? ')) {
        calcHits(dat.slice(2), base + 2, keys, out)
        return
    }
    if (dat.startsWith('#when::')) {
        whenHits(dat, base, keys, out)
        return
    }
    const split = splitDat(dat)
    if (split.args0 === undefined) {
        return
    }
    const name = cbsNameKey(dat)
    if (name === 'getglobalvar') {
        if (split.args0.startsWith(TOGGLE_PREFIX) && keys.has(split.args0.slice(TOGGLE_PREFIX.length))) {
            const key = split.args0.slice(TOGGLE_PREFIX.length)
            out.push({ offset: base + split.args0Start + TOGGLE_PREFIX.length, length: key.length, key, syntax: 'getglobalvar' })
        }
    } else if (name === 'calc') {
        calcHits(split.args0, base + split.args0Start, keys, out)
    }
}

// Reader macros that hold a nested macro: listed, never rewritten, when they can read an old key.
function dynamicHits(text: string, level: Level, end: number, keys: ReadonlySet<string>, out: RawHit[]): void {
    let dat = ''
    let from = level.start
    for (const [childFrom, childTo] of level.children) {
        dat += text.slice(from, childFrom) + NESTED
        from = childTo
    }
    dat += text.slice(from, end)
    const found = new Set<string>()
    const calcDynamic = (calcText: string) => {
        for (const match of calcText.matchAll(CALC_READ_DYNAMIC)) {
            for (const key of keys) {
                if (couldEqual(match[1], TOGGLE_PREFIX + key)) {
                    found.add(key)
                }
            }
        }
    }
    if (dat.startsWith('? ')) {
        calcDynamic(dat.slice(2))
    } else if (dat.startsWith('#when::')) {
        const segments = dat.split('::').slice(1)
        if (segments.some((segment) => segment === 'toggle' || segment === 'tis' || segment === 'tisnot')) {
            for (const key of keys) {
                if (segments.some((segment) => couldEqual(segment, key))) {
                    found.add(key)
                }
            }
        }
    } else {
        const split = splitDat(dat)
        const nameUnknown = split.name.includes(NESTED)
        const name = cbsNameKey(split.name)
        if (split.args0 !== undefined && (nameUnknown || name === 'getglobalvar')) {
            for (const key of keys) {
                if (couldEqual(split.args0, TOGGLE_PREFIX + key)) {
                    found.add(key)
                }
            }
        }
        if (split.args0 !== undefined && (nameUnknown || name === 'calc')) {
            calcDynamic(split.args0)
        }
    }
    for (const key of found) {
        out.push({ offset: level.start, length: end - level.start, key, syntax: 'getglobalvar', flag: 'dynamicName' })
    }
}

interface Walked {
    hits: RawHit[]
    literal: boolean
    /** Role-tag replacement ends in the engine's text, ascending. */
    tagEnds: number[]
}

function walk(text: string, keys: ReadonlySet<string>): Walked {
    const tagEnds: number[] = []
    let tagCount = 0
    for (const match of text.matchAll(ROLE_TAG)) {
        tagEnds.push(match.index + 2 * tagCount + match[0].length + 2)
        tagCount++
    }
    const w = text.replace(ROLE_TAG, '{{$1}}')
    const hits: RawHit[] = []
    const stack: Level[] = []
    let pureBlocks = 0
    let literal = false

    const noteChild = (open: number, after: number) => {
        for (let depth = stack.length - 1; depth >= 0; depth--) {
            if (stack[depth].type === 1) {
                stack[depth].hadChild = true
                if (depth === stack.length - 1) {
                    stack[depth].children.push([open, after])
                }
                return
            }
        }
    }

    const closeMacro = (level: Level, end: number, after: number, byDoubleBrace: boolean) => {
        noteChild(level.open, after)
        if (!byDoubleBrace) {
            return
        }
        const dat = w.slice(level.start, end)
        if (level.hadChild) {
            dynamicHits(w, level, end, keys, hits)
        } else {
            staticHits(dat, level.start, keys, hits)
        }
        if (dat.startsWith('#') || dat.startsWith(':')) {
            if (pureBlocks > 0) {
                if (dat !== ':else') {
                    stack.push({ type: 6, open: -1, start: -1, children: [], hadChild: false, pure: false })
                }
                return
            }
            const start = classifyBlockStart(dat, true)
            if (start.kind === 'nothing') {
                return
            }
            if (start.kind === 'undecidable') {
                literal = true
                return
            }
            const kind = purity(start.types)
            if (start.types.has('pure') || start.types.has('pure-display') || start.types.has('escape')) {
                literal = true
            }
            const pure = kind === 'yes'
            if (pure) {
                pureBlocks++
            }
            stack.push({ type: 5, open: -1, start: -1, children: [], hadChild: false, pure })
            return
        }
        if (dat.startsWith('/') && !dat.startsWith('//')) {
            const top = stack[stack.length - 1]
            if (top?.type === 5) {
                stack.pop()
                if (top.pure) {
                    pureBlocks--
                }
            } else if (top?.type === 6) {
                stack.pop()
            }
        }
    }

    let i = 0
    while (i < w.length) {
        const here = w[i]
        const next = w[i + 1]
        const top = stack[stack.length - 1]
        if (here === '{' && (next === '{' || next === '#')) {
            stack.push({ type: 1, open: i, start: i + 2, children: [], hadChild: false, pure: false })
            i += 2
        } else if (here === '#' && next === '}' && top?.type === 1) {
            stack.pop()
            closeMacro(top, i, i + 2, false)
            i += 2
        } else if (here === '}' && next === '}' && top?.type === 1) {
            stack.pop()
            closeMacro(top, i, i + 2, true)
            i += 2
        } else {
            i++
        }
    }

    return { hits, literal, tagEnds }
}

// Maps an offset in the engine's text back to the stored text: a tag whose replacement ends at or before the
// offset added 2 characters in front of it.
function storedOffset(offset: number, tagEnds: readonly number[]): number {
    let shift = 0
    for (const end of tagEnds) {
        if (end <= offset) {
            shift += 2
        }
    }
    return offset - shift
}

const REGEX_IN_PATH = /^regex\/\d+\/in$/

/**
 * Every place where `text` reads one of `oldKeys` as a toggle, in offset order. A rewritable text yields hits that
 * are static readers (no flag), dynamic readers and, when a block makes the text's structure unknowable, every hit
 * as a literal block. A flag-only text (script code, patterns) yields every hit flagged, and a `regex/<i>/in`
 * pattern flags its hits as a pattern that runs macros.
 */
export function scanTextUses(text: string, path: string, cls: TargetClass, oldKeys: ReadonlySet<string>): UseHit[] {
    const walked = walk(text, oldKeys)
    // A dynamic-name span runs over engine text; its end is mapped back like its start.
    const mapped: UseHit[] = walked.hits.map((hit) => ({
        path,
        offset: storedOffset(hit.offset, walked.tagEnds),
        length: hit.flag === 'dynamicName'
            ? storedOffset(hit.offset + hit.length, walked.tagEnds) - storedOffset(hit.offset, walked.tagEnds)
            : hit.length,
        key: hit.key,
        syntax: hit.syntax,
        ...(hit.flag ? { flag: hit.flag } : {}),
    }))
    let out: UseHit[]
    if (cls === 'flagOnly' && REGEX_IN_PATH.test(path)) {
        out = mapped.map((hit) => ({ ...hit, flag: 'regexPattern' }))
    } else if (cls === 'flagOnly') {
        out = mapped.map((hit) => ({ ...hit, flag: 'code' }))
        for (const key of oldKeys) {
            const needle = TOGGLE_PREFIX + key
            for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
                if (!WORD.test(text[at - 1] ?? '') && !WORD.test(text[at + needle.length] ?? '')) {
                    out.push({ path, offset: at + TOGGLE_PREFIX.length, length: key.length, key, syntax: 'code', flag: 'code' })
                }
            }
        }
    } else if (walked.literal) {
        out = mapped.map((hit) => (hit.flag ? hit : { ...hit, flag: 'literalBlock' }))
    } else {
        out = mapped
    }
    const seen = new Set<string>()
    return out
        .filter((hit) => {
            const id = `${hit.offset}\u0000${hit.key}\u0000${hit.flag === 'dynamicName' ? 'd' : ''}`
            if (seen.has(id)) {
                return false
            }
            seen.add(id)
            return true
        })
        .sort((a, b) => a.offset - b.offset)
}

interface PatternEntry {
    readonly in?: unknown
    readonly flag?: unknown
}

export type PatternOwner =
    | { readonly kind: 'character', readonly source: { readonly customscript?: readonly PatternEntry[] } }
    | { readonly kind: 'module', readonly source: { readonly regex?: readonly PatternEntry[] } }

// A flag group `<a, b>` whose items include `cbs` makes the script parse its `in` as a CBS text. `ableFlag` is not
// required: a disabled flag set is listed too, which only over-lists.
function flagRunsCbs(flag: unknown): boolean {
    if (typeof flag !== 'string') {
        return false
    }
    for (const group of flag.matchAll(/<(.+?)>/g)) {
        if (group[1].split(',').some((item) => item.trim() === 'cbs')) {
            return true
        }
    }
    return false
}

/** The `in` patterns of an owner's regex scripts that run macros, as flag-only targets (never written). */
export function cbsPatternTargets(owner: PatternOwner): { path: string, text: string, cls: 'flagOnly' }[] {
    const scripts = owner.kind === 'character' ? owner.source.customscript : owner.source.regex
    const out: { path: string, text: string, cls: 'flagOnly' }[] = []
    scripts?.forEach((script, index) => {
        if (typeof script?.in === 'string' && flagRunsCbs(script.flag)) {
            out.push({ path: `regex/${index}/in`, text: script.in, cls: 'flagOnly' })
        }
    })
    return out
}
