import type { RisuPlugin } from '../plugins/plugins.svelte'

/**
 * Commits one typed plugin argument. The value is written to the entry only while that entry is still
 * in the list, and a number is written only when it parses to a finite number, so a late blur or a
 * teardown never resurrects a removed plugin's value or stores NaN.
 */

export type ArgCommitKind = 'string' | 'int'
export type ArgCommitResult = 'saved' | 'unchanged' | 'invalid' | 'gone'

const numberPattern = /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i

export function commitPluginArg(
    list: readonly RisuPlugin[] | undefined,
    entry: RisuPlugin,
    key: string,
    kind: ArgCommitKind,
    raw: string,
): ArgCommitResult {
    if (!list || !list.includes(entry)) {
        return 'gone'
    }
    let next: string | number = raw
    if (kind === 'int') {
        const parsed = numberPattern.test(raw) ? Number(raw) : NaN
        if (!Number.isFinite(parsed)) {
            return 'invalid'
        }
        next = parsed
    }
    if (entry.realArg[key] === next) {
        return 'unchanged'
    }
    entry.realArg[key] = next
    return 'saved'
}
