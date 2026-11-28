// The pure rules for reading a regex script list the Studio edits: which stage values classic offers, whether a list can
// be written through the history without losing a value, and how each row classifies. No Svelte, no store.

/** The stage values the classic editor offers, in its order. */
export const REGEX_STAGES = ['editinput', 'editoutput', 'editprocess', 'editdisplay', 'edittrans', 'disabled'] as const
export type RegexStage = typeof REGEX_STAGES[number]

function isPlainObject(value: object): boolean {
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

/** Real entries nest two or three levels; a deeper value is refused, which also ends a cycle whose identity changes on every read (a raw cycle inside a `$state` tree). */
const MAX_DEPTH = 1000

type Frame = { value: object, keys: string[] | null, length: number, at: number }

/**
 * Whether the value survives a JSON-shaped store unchanged: null, booleans, finite numbers, strings, arrays without
 * holes and plain objects whose own enumerable keys all hold such values. `undefined`, functions, symbols, bigints,
 * non-finite numbers, non-plain objects and cycles are not safe. The walk is iterative, so depth never overflows the
 * stack; its cost is the node count, and nothing is serialised. Nesting deeper than MAX_DEPTH is not safe. A Svelte `$state` proxy reports the target's prototype,
 * so it reads as plain.
 */
export function isJsonSafe(value: unknown): boolean {
    const stack: Frame[] = []
    const ancestors = new Set<object>()

    // Returns false when the value is unsafe; pushes a frame when it is a container still to be walked.
    const enter = (v: unknown): boolean => {
        if (v === null) {
            return true
        }
        switch (typeof v) {
            case 'boolean':
            case 'string':
                return true
            case 'number':
                return Number.isFinite(v)
            case 'object': {
                if (ancestors.has(v) || stack.length >= MAX_DEPTH) {
                    return false
                }
                if (Array.isArray(v)) {
                    stack.push({ value: v, keys: null, length: v.length, at: 0 })
                }
                else if (isPlainObject(v)) {
                    const keys = Object.keys(v)
                    stack.push({ value: v, keys, length: keys.length, at: 0 })
                }
                else {
                    return false
                }
                ancestors.add(v)
                return true
            }
            default:
                return false
        }
    }

    if (!enter(value)) {
        return false
    }
    while (stack.length > 0) {
        const frame = stack[stack.length - 1]
        if (frame.at >= frame.length) {
            ancestors.delete(frame.value)
            stack.pop()
            continue
        }
        const i = frame.at++
        let child: unknown
        if (frame.keys === null) {
            if (!(i in frame.value)) {
                return false
            }
            child = (frame.value as unknown[])[i]
        }
        else {
            child = (frame.value as Record<string, unknown>)[frame.keys[i]]
        }
        if (!enter(child)) {
            return false
        }
    }
    return true
}

/** Why a row is not editable; `key` is the en.ts message, `field` fills `studioRegexWhyField`. */
export type RegexReason =
    | { key: 'studioRegexWhyNotObject' }
    | { key: 'studioRegexWhyField', field: 'comment' | 'in' | 'out' | 'type' }
    | { key: 'studioRegexWhyFlag' }
    | { key: 'studioRegexWhyAbleFlag' }

export type RegexRowClass =
    | { kind: 'ok' }
    | { kind: 'unreadable', reasons: RegexReason[], name: string | null }
    | { kind: 'inert', reason: RegexReason }

const REQUIRED_TEXT_FIELDS = ['comment', 'in', 'out', 'type'] as const

/**
 * A row that is a plain object is `ok` when comment, in, out and type are text, `flag` (if present) is text and
 * `ableFlag` (if present) is a boolean; a plain object that is not is `unreadable`. Any other element is `inert`.
 */
export function classifyRegexRow(row: unknown): RegexRowClass {
    if (typeof row !== 'object' || row === null || Array.isArray(row) || !isPlainObject(row)) {
        return { kind: 'inert', reason: { key: 'studioRegexWhyNotObject' } }
    }
    const entry = row as Record<string, unknown>
    const reasons: RegexReason[] = []
    for (const field of REQUIRED_TEXT_FIELDS) {
        if (typeof entry[field] !== 'string') {
            reasons.push({ key: 'studioRegexWhyField', field })
        }
    }
    if (Object.hasOwn(entry, 'flag') && typeof entry.flag !== 'string') {
        reasons.push({ key: 'studioRegexWhyFlag' })
    }
    if (Object.hasOwn(entry, 'ableFlag') && typeof entry.ableFlag !== 'boolean') {
        reasons.push({ key: 'studioRegexWhyAbleFlag' })
    }
    if (reasons.length === 0) {
        return { kind: 'ok' }
    }
    return { kind: 'unreadable', reasons, name: typeof entry.comment === 'string' ? entry.comment : null }
}

export type RegexListClass =
    | { kind: 'notArray' }
    | { kind: 'notJsonSafe' }
    | { kind: 'rows', rows: RegexRowClass[] }

/** The list's classification; an absent list is the caller's concern (it passes `[]`). */
export function classifyRegexList(list: unknown): RegexListClass {
    if (!Array.isArray(list)) {
        return { kind: 'notArray' }
    }
    if (!isJsonSafe(list)) {
        return { kind: 'notJsonSafe' }
    }
    return { kind: 'rows', rows: list.map((row: unknown) => classifyRegexRow(row)) }
}
