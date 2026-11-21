import { SECRET_FIELDS, type SecretFieldEntry } from 'src/ts/secretFields'
import type { botPreset } from 'src/ts/storage/database.svelte'

/**
 * Preset destination URLs left out of a shared preset. `blank` keeps the key
 * as `''`, the shape upstream writes. `delete` omits it: upstream's
 * `changeToPreset` reads `koboldURL` with `??`, so an absent key keeps the
 * importer's own value while `''` would wipe it. Every preset this fork
 * exports omits it whatever its origin; only upstream's own exports carry it.
 */
export const SHARE_ENDPOINT_FIELDS: readonly {
    field: keyof botPreset
    mode: 'blank' | 'delete'
}[] = [
    { field: 'forceReplaceUrl', mode: 'blank' },
    { field: 'forceReplaceUrl2', mode: 'blank' },
    { field: 'textgenWebUIStreamURL', mode: 'blank' },
    { field: 'textgenWebUIBlockingURL', mode: 'blank' },
    { field: 'koboldURL', mode: 'delete' },
    { field: 'proxyConnectionId', mode: 'delete' },
]

type Node = string | number | boolean | null | undefined | Node[] | { [key: string]: Node }

type Container = Node[] | { [key: string]: Node }

function isContainer(value: Node): value is Container {
    return typeof value === 'object' && value !== null
}

/**
 * Tokens of a registry `sub`: `.name` is a key, `[]` any array index, `[*]`
 * any own key and `[1]` a literal index.
 */
function tokensOf(sub: string): string[] {
    return sub.match(/\.[^.[\]]+|\[[^\]]*\]/g) ?? []
}

function keysFor(node: Container, token: string): string[] {
    if (token.startsWith('.')) {
        return [token.slice(1)]
    }
    if (token === '[]') {
        return Array.isArray(node) ? Object.keys(node).filter((key) => /^\d+$/.test(key)) : []
    }
    if (token === '[*]') {
        return Object.keys(node)
    }
    return [token.slice(1, -1)]
}

function blankAt(node: Container, tokens: readonly string[]): void {
    const [token, ...rest] = tokens
    const record = node as { [key: string]: Node }
    for (const key of keysFor(node, token)) {
        if (!Object.hasOwn(record, key) || record[key] === undefined) {
            continue
        }
        if (rest.length === 0) {
            record[key] = ''
        } else if (isContainer(record[key])) {
            blankAt(record[key], rest)
        }
    }
}

/**
 * Blanks every credential leaf of `scope` that is present in `target`.
 * Missing keys and containers are never created and only `target` is mutated.
 * Entries flagged `notCredential` are kept.
 */
export function stripShareSecrets(target: object, scope: SecretFieldEntry['scope']): void {
    const root = target as { [key: string]: Node }
    for (const entry of SECRET_FIELDS as readonly SecretFieldEntry[]) {
        if (entry.scope !== scope || ('notCredential' in entry && entry.notCredential === true)) {
            continue
        }
        if (!Object.hasOwn(root, entry.field) || root[entry.field] === undefined) {
            continue
        }
        const tokens = tokensOf(entry.sub ?? '')
        if (tokens.length === 0) {
            root[entry.field] = ''
        } else if (isContainer(root[entry.field])) {
            blankAt(root[entry.field] as Container, tokens)
        }
    }
}

function collectAt(node: Container, tokens: readonly string[], out: string[]): void {
    const [token, ...rest] = tokens
    const record = node as { [key: string]: Node }
    for (const key of keysFor(node, token)) {
        if (!Object.hasOwn(record, key)) {
            continue
        }
        const child = record[key]
        if (rest.length === 0) {
            if (typeof child === 'string') {
                out.push(child)
            }
        } else if (isContainer(child)) {
            collectAt(child, rest, out)
        }
    }
}

/**
 * The string value of every credential leaf of `scope` present in `target`, walking the same
 * registry paths as `stripShareSecrets` without mutating anything. Entries flagged `notCredential`
 * are skipped, and `accept`, when given, narrows the walk to the entries it approves.
 */
export function secretFieldValues(
    target: object,
    scope: SecretFieldEntry['scope'],
    accept?: (entry: SecretFieldEntry) => boolean,
): string[] {
    const root = target as { [key: string]: Node }
    const out: string[] = []
    for (const entry of SECRET_FIELDS as readonly SecretFieldEntry[]) {
        if (entry.scope !== scope || ('notCredential' in entry && entry.notCredential === true)) {
            continue
        }
        if (accept && !accept(entry)) {
            continue
        }
        if (!Object.hasOwn(root, entry.field)) {
            continue
        }
        const tokens = tokensOf(entry.sub ?? '')
        const value = root[entry.field]
        if (tokens.length === 0) {
            if (typeof value === 'string') {
                out.push(value)
            }
        } else if (isContainer(value)) {
            collectAt(value, tokens, out)
        }
    }
    return out
}

/** Strips credentials and destination URLs from a preset clone, in place. */
export function shareSafePreset(preset: botPreset): botPreset {
    stripShareSecrets(preset, 'botPreset')
    const record = preset as unknown as { [key: string]: string | undefined }
    for (const { field, mode } of SHARE_ENDPOINT_FIELDS) {
        if (mode === 'delete') {
            delete record[field]
        } else {
            record[field] = ''
        }
    }
    return preset
}
