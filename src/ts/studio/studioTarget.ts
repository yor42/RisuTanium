// Target grammar of a Studio visit: `owner=<type>:<id>[&kind=<kind>][&item=<id>][&from=<origin>]`.
// Pure: no store, no DOM. Whether the owner, kind and item exist is decided against the owner model.

export type StudioOwnerType = 'character' | 'chat' | 'preset' | 'module' | 'plugin'
export type StudioFrom = 'chat' | 'library' | 'settings' | 'home'

export interface StudioOwnerRef {
    type: StudioOwnerType
    id: string
}

export interface StudioTarget {
    owner?: StudioOwnerRef
    /** Alias-normalised kind name. A name no owner supports stays as written; resolving it is the owner model's job. */
    kind?: string
    item?: string
    from?: StudioFrom
}

export interface StudioTargetError {
    error: 'malformed'
}

const OWNER_TYPES: readonly StudioOwnerType[] = ['character', 'chat', 'preset', 'module', 'plugin']
const ORIGINS: readonly StudioFrom[] = ['chat', 'library', 'settings', 'home']
const KIND_ALIASES: Readonly<Record<string, string>> = {
    lua: 'scripts',
    trigger: 'scripts',
    plugincode: 'plugin',
}

export function isStudioOwnerType(value: string): value is StudioOwnerType {
    return (OWNER_TYPES as readonly string[]).includes(value)
}

export function isStudioError(result: StudioTarget | StudioTargetError): result is StudioTargetError {
    return 'error' in result
}

/** Applies the spec aliases; any other name is returned unchanged. */
export function normalizeStudioKind(kind: string): string {
    return KIND_ALIASES[kind] ?? kind
}

function decode(value: string): string | null {
    try {
        return decodeURIComponent(value)
    } catch {
        return null
    }
}

/**
 * Parses a target query (a leading `?` is allowed). Unknown keys and an unknown `from` are ignored, the
 * first occurrence of a key wins, and `kind` or `item` without an `owner` are dropped. A broken escape, an
 * `owner` that is not `<known type>:<non-empty id>` (the id keeps any further colons) or an empty `kind`
 * or `item` value is malformed.
 */
export function parseStudioTarget(input: string): StudioTarget | StudioTargetError {
    const query = input.startsWith('?') ? input.slice(1) : input
    const params = new Map<string, string>()
    for (const part of query.split('&')) {
        if (part === '') continue
        const at = part.indexOf('=')
        const rawKey = at === -1 ? part : part.slice(0, at)
        const rawValue = at === -1 ? '' : part.slice(at + 1)
        const key = decode(rawKey)
        const value = decode(rawValue)
        if (key === null || value === null) return { error: 'malformed' }
        if (!params.has(key)) params.set(key, value)
    }

    const target: StudioTarget = {}
    const from = params.get('from')
    if (from !== undefined && (ORIGINS as readonly string[]).includes(from)) target.from = from as StudioFrom

    const ownerText = params.get('owner')
    if (ownerText === undefined) return target
    const colon = ownerText.indexOf(':')
    const type = colon === -1 ? '' : ownerText.slice(0, colon)
    const id = colon === -1 ? '' : ownerText.slice(colon + 1)
    if (!isStudioOwnerType(type) || id === '') return { error: 'malformed' }
    target.owner = { type, id }

    const kind = params.get('kind')
    if (kind !== undefined) {
        if (kind === '') return { error: 'malformed' }
        target.kind = normalizeStudioKind(kind)
    }
    const item = params.get('item')
    if (item !== undefined) {
        if (item === '') return { error: 'malformed' }
        target.item = item
    }
    return target
}
