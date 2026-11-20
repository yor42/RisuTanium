import { SECRET_FIELDS, secretFieldPath, type SecretFieldEntry } from 'src/ts/secretFields'

/**
 * Registry-driven sentinel builder for the share-export tests: writes a unique
 * `SENTINEL:<scope>:<path>` at every credential entry of `SECRET_FIELDS`, in
 * the shape the entry's `sub` names, so a new registry entry is covered by
 * every share-path test without editing them.
 */

export type SentinelNode = string | SentinelNode[] | { [key: string]: SentinelNode }

export interface SentinelLeaf {
    scope: SecretFieldEntry['scope']
    path: string
    sentinel: string
}

/** What a registry entry marks as not a credential (kept by share exports). */
export function isNotCredential(entry: SecretFieldEntry): boolean {
    return 'notCredential' in entry && entry.notCredential === true
}

// A literal-index container is padded with a header-name-shaped value, the
// shape `additionalParams` rows have in a real database.
const PAD = 'header::Authorization'

function tokensOf(sub: string): string[] {
    return sub.match(/\.[^.[\]]+|\[[^\]]*\]/g) ?? []
}

function place(existing: SentinelNode | undefined, tokens: string[], value: string): SentinelNode {
    if (tokens.length === 0) {
        return value
    }
    const [token, ...rest] = tokens
    if (token === '[]' || /^\[\d+\]$/.test(token)) {
        const index = token === '[]' ? 0 : Number(token.slice(1, -1))
        const list: SentinelNode[] = Array.isArray(existing) ? existing : []
        for (let i = 0; i < index; i++) {
            list[i] ??= PAD
        }
        list[index] = place(list[index], rest, value)
        return list
    }
    const record: { [key: string]: SentinelNode } =
        typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
    const key = token === '[*]' ? 'm' : token.slice(1)
    record[key] = place(record[key], rest, value)
    return record
}

/** One object holding a sentinel at every credential entry of `scope`. */
export function sentinelObject(scope: SecretFieldEntry['scope']): {
    object: { [key: string]: SentinelNode }
    leaves: SentinelLeaf[]
} {
    const object: { [key: string]: SentinelNode } = {}
    const leaves: SentinelLeaf[] = []
    for (const entry of SECRET_FIELDS as readonly SecretFieldEntry[]) {
        if (entry.scope !== scope || isNotCredential(entry)) {
            continue
        }
        const path = secretFieldPath(entry)
        const sentinel = `SENTINEL:${scope}:${path}`
        object[entry.field] = place(object[entry.field], tokensOf(entry.sub ?? ''), sentinel)
        leaves.push({ scope, path, sentinel })
    }
    return { object, leaves }
}

/** The paths of `leaves` whose sentinel appears anywhere in `value`. */
export function sentinelsIn(value: object | string, leaves: readonly SentinelLeaf[]): string[] {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return leaves.filter((leaf) => text.includes(leaf.sentinel)).map((leaf) => leaf.path)
}

/** Non-vacuity: the paths whose sentinel is not reachable in the fixture. */
export function missingSentinels(value: object, leaves: readonly SentinelLeaf[]): string[] {
    const present = new Set(sentinelsIn(value, leaves))
    return leaves.filter((leaf) => !present.has(leaf.path)).map((leaf) => leaf.path)
}
