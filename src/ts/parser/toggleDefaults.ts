import { parseToggleSyntax, type sidebarToggleValue } from '../util'

/** Author defaults by variable name (`toggle_<key>`), in the stored encoding: '1' for a checkbox, the decimal option index for a select. */
export type ToggleDefaults = ReadonlyMap<string, string>

export const NO_TOGGLE_DEFAULTS: ToggleDefaults = Object.freeze(new Map<string, string>()) as ToggleDefaults

/**
 * The stored encoding of a row's author default, or undefined when the row has none.
 *
 * Accepted: a checkbox row whose 5th field is exactly '1', and a select row whose 5th field is the exact, case-sensitive,
 * untrimmed text of one of its options (the first matching index). Everything else is ignored: '0', '', 'yes', 'on',
 * a padded or case-changed value, an option index, and any 5th field on text, textarea, group, divider or caption rows.
 * Fields after the 5th are reserved too. Loosening the accepted set needs a maintainer decision; tightening it is not
 * possible once cards carry defaults.
 */
export function defaultValueOf(row: sidebarToggleValue): string | undefined {
    if (row.type === undefined) {
        return row.default === '1' ? '1' : undefined
    }
    if (row.type === 'select') {
        const index = row.default === undefined ? -1 : row.options.indexOf(row.default)
        return index < 0 ? undefined : String(index)
    }
    return undefined
}

const MEMO_SIZE = 4
const memo: { texts: readonly (string | undefined)[], defaults: ToggleDefaults }[] = []

function sameTexts(a: readonly (string | undefined)[], b: readonly (string | undefined)[]): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

function computeDefaults(texts: readonly (string | undefined)[]): ToggleDefaults {
    const decided = new Set<string>()
    const found = new Map<string, string>()
    for (const row of parseToggleSyntax(texts.map((text) => text ?? '').join('\n'))) {
        if (row.type === 'group' || row.type === 'groupEnd' || row.type === 'caption' || row.type === 'divider') {
            continue
        }
        // The first definition of a key decides, even when it carries no default.
        if (decided.has(row.key)) {
            continue
        }
        decided.add(row.key)
        const value = defaultValueOf(row)
        if (value !== undefined) {
            found.set(`toggle_${row.key}`, value)
        }
    }
    return found.size === 0 ? NO_TOGGLE_DEFAULTS : found
}

/**
 * Author defaults of the given definition texts, in source order. The result is memoised on the texts (4 entries, least
 * recently used evicted), so alternating callers share one parse and equal inputs return the same map.
 */
export function toggleDefaultsOf(texts: readonly (string | undefined)[]): ToggleDefaults {
    if (texts.every((text) => text === undefined || text === '')) {
        return NO_TOGGLE_DEFAULTS
    }
    for (let i = 0; i < memo.length; i++) {
        if (sameTexts(memo[i].texts, texts)) {
            const [hit] = memo.splice(i, 1)
            memo.push(hit)
            return hit.defaults
        }
    }
    const entry = { texts: texts.slice(), defaults: computeDefaults(texts) }
    memo.push(entry)
    if (memo.length > MEMO_SIZE) {
        memo.shift()
    }
    return entry.defaults
}

export function sameDefaults(a: ToggleDefaults, b: ToggleDefaults): boolean {
    if (a === b) {
        return true
    }
    if (a.size !== b.size) {
        return false
    }
    for (const [key, value] of a) {
        if (b.get(key) !== value) {
            return false
        }
    }
    return true
}

/** A stored toggle value counts as set unless it is absent, '' or 'null'. */
export function isSetValue(value: string | undefined): value is string {
    return value !== undefined && value !== '' && value !== 'null'
}

/**
 * The value a reader sees for a toggle variable: a set local value, else a set shared value, else the author default,
 * else the shared value or 'null'. `fallback` runs only on the unset path.
 */
export function effectiveGlobalValue(local: string | undefined, shared: string | undefined, fallback: () => string | undefined): string {
    if (isSetValue(local)) {
        return local
    }
    if (isSetValue(shared)) {
        return shared
    }
    return fallback() ?? shared ?? 'null'
}
