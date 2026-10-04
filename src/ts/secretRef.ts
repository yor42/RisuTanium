import { invoke } from '@tauri-apps/api/core'
import { language } from 'src/lang'
import { isNodeServer, isTauri } from 'src/ts/platform'
import { isSecretRef, secretRefName } from 'src/ts/secretRefPattern'

export { isSecretRef, secretRefName }

/**
 * Environment-variable references in secret fields.
 *
 * A secret field whose whole trimmed value is `${NAME}` (uppercase only) names
 * an environment variable of the machine that runs the server or the desktop
 * app. The reference is resolved at use time, in memory only: the resolved
 * value is never stored in the database, a save, a backup, a preset or an
 * export. The fetch log stores the reference in its place, except that a
 * resolved value shorter than `MIN_REDACTED_LENGTH` is not redacted, because
 * replacing it would shred unrelated text. Every other value is used exactly
 * as typed.
 */

/** Auth-scheme prefixes a header value may carry in front of a reference. */
const SCHEME_PREFIX_PATTERN = /^(?:Bearer|DeepL-Auth-Key|Key|Token)\s+/i

const RESOLVE_TTL_MS = 5 * 60 * 1000

/** Shortest resolved value the log redaction replaces; shorter values would shred unrelated text. */
const MIN_REDACTED_LENGTH = 8

export type SecretRefErrorKind = 'unavailable' | 'unsupported' | 'inRequest' | 'foreign'

/** A reference that could not be used. Carries the variable name, never a value. */
export class SecretRefError extends Error {
    readonly variable: string
    readonly kind: SecretRefErrorKind

    constructor(variable: string, kind: SecretRefErrorKind) {
        super(secretRefMessage(variable, kind))
        this.name = 'SecretRefError'
        this.variable = variable
        this.kind = kind
    }
}

function secretRefMessage(variable: string, kind: SecretRefErrorKind): string {
    const name = '${' + variable + '}'
    switch (kind) {
        case 'unsupported': return language.errors.secretRefUnsupported(name)
        case 'inRequest': return language.errors.secretRefInRequest(name)
        case 'foreign': return language.errors.secretRefNotForeign(name)
        default: return language.errors.secretRefUnavailable(name)
    }
}

/** '' when the value is a whole reference, else the value unchanged. */
export function blankSecretRef<T>(value: T): T | '' {
    return isSecretRef(value) ? '' : value
}

//#region resolution

const cache = new Map<string, { value: string, expires: number }>()
const inFlight = new Map<string, Promise<string>>()
/** Every sensitive value seen this page session, with the label that replaces it. Feeds `redactResolved`. */
const resolvedValues = new Map<string, string>()

async function readEnv(name: string): Promise<string> {
    if (isTauri) {
        return await invoke<string>('read_env_secret', { name })
    }
    if (isNodeServer) {
        // Loaded on demand: importing the Node storage client at module load would tie every importer of
        // this module (the database module included) to it.
        const { getNodeServerProxyAuth } = await import('src/ts/storage/nodeStorage')
        const auth = await getNodeServerProxyAuth()
        const response = await fetch('/api/env-secret', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'risu-auth': auth,
            },
            body: JSON.stringify({ name }),
        })
        if (!response.ok) {
            throw new SecretRefError(name, 'unavailable')
        }
        const data = await response.json() as { value?: unknown }
        return data?.value as string
    }
    throw new SecretRefError(name, 'unsupported')
}

async function fetchSecret(name: string): Promise<string> {
    let raw: unknown
    try {
        raw = await readEnv(name)
    }
    catch (error) {
        if (error instanceof SecretRefError) {
            throw error
        }
        throw new SecretRefError(name, 'unavailable')
    }
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value === '' || /[\r\n]/.test(value)) {
        throw new SecretRefError(name, 'unavailable')
    }
    return value
}

/**
 * The value to send for a secret field. A value that is not a reference is
 * returned unchanged. A reference is read from the server or desktop
 * environment; any failure throws a `SecretRefError` and is never cached.
 */
export async function resolveSecret(value: string): Promise<string> {
    const name = secretRefName(value)
    if (name === null) {
        return value
    }
    const hit = cache.get(name)
    if (hit && hit.expires > Date.now()) {
        return hit.value
    }
    const pending = inFlight.get(name)
    if (pending) {
        return await pending
    }
    const attempt = (async () => {
        try {
            const resolved = await fetchSecret(name)
            cache.set(name, { value: resolved, expires: Date.now() + RESOLVE_TTL_MS })
            registerSensitive(resolved, '${' + name + '}')
            return resolved
        }
        finally {
            inFlight.delete(name)
        }
    })()
    inFlight.set(name, attempt)
    return await attempt
}

/**
 * Registers a value derived from a resolved secret (for example a token minted from a referenced
 * key) so `redactResolved` replaces it with `label`. Values shorter than `MIN_REDACTED_LENGTH`
 * are ignored.
 */
export function registerSensitive(value: string, label: string) {
    if (typeof value === 'string' && value.length >= MIN_REDACTED_LENGTH) {
        resolvedValues.set(value, label)
    }
}

/** Drops cached resolutions and the redaction registry. Test seam. */
export function resetSecretRefState() {
    cache.clear()
    inFlight.clear()
    resolvedValues.clear()
}

//#endregion

//#region redaction

function escapeJsonString(text: string): string {
    return JSON.stringify(text).slice(1, -1)
}

/**
 * Replaces every value resolved this page session with its `${NAME}` (a value
 * registered through registerSensitive gets the label it was registered with), also
 * where the value sits inside a JSON string (quote and backslash escapes) or
 * a URL (percent-encoding).
 */
export function redactResolved(text: string): string {
    if (typeof text !== 'string' || resolvedValues.size === 0) {
        return text
    }
    const targets: [string, string][] = []
    for (const [value, label] of resolvedValues) {
        const jsonOnce = escapeJsonString(value)
        const variants = new Set([
            value,
            jsonOnce,
            escapeJsonString(jsonOnce),
            encodeURIComponent(value),
        ])
        for (const variant of variants) {
            targets.push([variant, label])
        }
    }
    targets.sort((a, b) => b[0].length - a[0].length)
    let out = text
    for (const [variant, label] of targets) {
        if (variant.length > 0 && out.includes(variant)) {
            out = out.split(variant).join(label)
        }
    }
    return out
}

//#endregion

//#region tripwire

export type TripwireHeaders =
    | Record<string, string>
    | Headers
    | readonly (readonly [string, string])[]
    | undefined
    | null

function headerValues(headers: TripwireHeaders): string[] {
    if (!headers) {
        return []
    }
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        const values: string[] = []
        headers.forEach((value) => values.push(value))
        return values
    }
    if (Array.isArray(headers)) {
        return (headers as readonly (readonly [string, string])[])
            .map((pair) => pair?.[1])
            .filter((value): value is string => typeof value === 'string')
    }
    return Object.values(headers as Record<string, string>)
        .filter((value): value is string => typeof value === 'string')
}

function referenceInValue(value: string): string | null {
    const trimmed = value.trim()
    return secretRefName(trimmed.replace(SCHEME_PREFIX_PATTERN, ''))
}

/**
 * Throws before any network call when a header value, or a URL query value,
 * is a whole reference (optionally after an auth-scheme prefix). Plugin-
 * reachable fetch functions call this and never substitute, so a plugin
 * cannot make the app send a server-held secret. Reads no environment.
 */
export function assertNoSecretRef(headers: TripwireHeaders, url?: string) {
    for (const value of headerValues(headers)) {
        const name = referenceInValue(value)
        if (name !== null) {
            throw new SecretRefError(name, 'inRequest')
        }
    }
    if (typeof url === 'string') {
        let parsed: URL
        try {
            parsed = new URL(url)
        }
        catch {
            return
        }
        for (const value of parsed.searchParams.values()) {
            const name = referenceInValue(value)
            if (name !== null) {
                throw new SecretRefError(name, 'inRequest')
            }
        }
    }
}

//#endregion
