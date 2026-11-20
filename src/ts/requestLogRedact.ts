/**
 * Credential redaction of the in-app request log, as pure text rules (no I/O,
 * no database): configured values, secret-named headers, JSON fields, form and
 * URL query parameters and URL userinfo.
 *
 * A redacted value becomes `[redacted …abcd]` (the last four code points)
 * when it is 16 code points or longer, else `[redacted]`: a short value must not
 * be recoverable from its tail. Every rule skips a value that is already a
 * `${NAME}` label or a redaction token, so the pipeline is idempotent. Text outside
 * a redacted value is never rewritten, and a value that cannot be decoded is redacted
 * from its raw text without touching the rest of the field.
 */
import { isSecretRef } from './secretRefPattern'

export type FetchLogField = 'url' | 'header' | 'body' | 'response'

/** A value shorter than this shows no tail, and is not matched by value. */
export const REVEAL_MIN_LENGTH = 16

const TAIL_LENGTH = 4
const BARE_TOKEN = '[redacted]'
const NAMED_TOKEN_LABEL = /^\$\{[A-Z_][A-Z0-9_]*\}:token$/
const REVEALED_TOKEN = /^\[redacted …[\s\S]{4}\]$/u

/** The replacement for `secret`. Lengths and the tail count code points, so a surrogate pair is never split. */
export function redactionToken(secret: string): string {
    const points = Array.from(secret)
    if (points.length < REVEAL_MIN_LENGTH) {
        return BARE_TOKEN
    }
    return `[redacted …${points.slice(-TAIL_LENGTH).join('')}]`
}

/**
 * True when the DECODED value (percent-decoded in a URL or form, JSON-string-decoded in JSON, the
 * header value after its scheme) is already a `${NAME}` label, a `${NAME}:token` label or a redaction
 * token with any four tail code points.
 */
export function isRedactedValue(decoded: string): boolean {
    return isSecretRef(decoded)
        || NAMED_TOKEN_LABEL.test(decoded)
        || decoded === BARE_TOKEN
        || REVEALED_TOKEN.test(decoded)
}

function escapeJson(text: string): string {
    return JSON.stringify(text).slice(1, -1)
}

function decodeJsonString(raw: string): string | null {
    try {
        return JSON.parse(`"${raw}"`) as string
    } catch {
        return null
    }
}

function decodeUri(raw: string): string | null {
    try {
        return decodeURIComponent(raw)
    } catch {
        return null
    }
}

const URL_SAFE_CHAR = /[A-Za-z0-9\-._~[\]]/

function encodeUrlChar(char: string): string {
    try {
        return encodeURIComponent(char).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    } catch {
        return '%EF%BF%BD'
    }
}

/** The token of `secret` for a URL: every character outside the unreserved set and the brackets is percent-encoded. */
function urlToken(secret: string): string {
    let out = ''
    for (const char of redactionToken(secret)) {
        out += URL_SAFE_CHAR.test(char) ? char : encodeUrlChar(char)
    }
    return out
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

//#region configured values

export interface KnownSecrets {
    apply(text: string): string
}

const NO_KNOWN_SECRETS: KnownSecrets = { apply: (text) => text }

/**
 * A matcher for configured credential values. Each value of 16 code points or longer (and not a
 * `${NAME}` reference) is found raw, JSON-escaped once and twice, and percent-encoded, and replaced
 * with its own token escaped like the variant, so the surrounding JSON or URL stays valid.
 */
export function compileKnownSecrets(values: readonly string[]): KnownSecrets {
    const replacements = new Map<string, string>()
    for (const value of values) {
        if (typeof value !== 'string' || Array.from(value).length < REVEAL_MIN_LENGTH || isSecretRef(value)) {
            continue
        }
        const token = redactionToken(value)
        const once = escapeJson(value)
        const variants: [string, string][] = [
            [value, token],
            [once, escapeJson(token)],
            [escapeJson(once), escapeJson(escapeJson(token))],
            [encodeURIComponent(value), urlToken(value)],
        ]
        for (const [variant, replacement] of variants) {
            if (variant !== '' && !replacements.has(variant)) {
                replacements.set(variant, replacement)
            }
        }
    }
    if (replacements.size === 0) {
        return NO_KNOWN_SECRETS
    }
    const alternation = [...replacements.keys()]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|')
    const pattern = new RegExp(alternation, 'g')
    return {
        apply: (text) => text.replace(pattern, (match) => replacements.get(match) ?? match),
    }
}

//#endregion

//#region name rules

/** JSON and form field names, matched exactly (case-insensitive) with an optional `-` or `_` between word parts. */
const JSON_NAMES = [
    'api_key', 'x_api_key', 'x_goog_api_key', 'access_token', 'refresh_token', 'id_token', 'auth_token',
    'session_token', 'bearer_token', 'client_secret', 'client_assertion', 'private_key', 'secret',
    'secret_key', 'api_secret', 'secret_access_key', 'aws_secret_access_key', 'password', 'authorization',
    'proxy_authorization', 'cookie', 'set_cookie', 'risu_auth', 'code_verifier', 'registration_access_token',
]

/** Bare names too generic for a JSON field (`key`, `signature`, `code`) but credentials in a URL query or form. */
const QUERY_ONLY_NAMES = [
    'key', 'token', 'auth', 'code', 'sig', 'signature', 'assertion', 'x_amz_signature',
    'x_amz_security_token', 'x_goog_signature',
]

function namePattern(names: readonly string[]): string {
    return names.map((name) => name.split('_').join('[-_]?')).join('|')
}

/** A JSON string body: every quote inside is escaped, and the unrolled loop stays linear on unterminated input. */
const JSON_STRING_SOURCE = String.raw`[^"\\]*(?:\\[\s\S][^"\\]*)*`

const JSON_FIELD = new RegExp(`("(?:${namePattern(JSON_NAMES)})"\\s*:\\s*")(${JSON_STRING_SOURCE})(")`, 'gi')

function redactJsonFields(text: string): string {
    return text.replace(JSON_FIELD, (match: string, prefix: string, raw: string, close: string) => {
        if (raw === '') {
            return match
        }
        const decoded = decodeJsonString(raw)
        if (decoded !== null && isRedactedValue(decoded)) {
            return match
        }
        return prefix + escapeJson(redactionToken(decoded ?? raw)) + close
    })
}

const QUERY_PARAMETER = new RegExp(`(^|[&#])((?:${namePattern([...JSON_NAMES, ...QUERY_ONLY_NAMES])})=)([^&#]*)`, 'gi')

function redactQueryText(text: string): string {
    return text.replace(QUERY_PARAMETER, (match: string, separator: string, nameAndEquals: string, value: string) => {
        if (value === '') {
            return match
        }
        const decoded = decodeUri(value)
        if (decoded !== null && isRedactedValue(decoded)) {
            return match
        }
        return separator + nameAndEquals + urlToken(decoded ?? value)
    })
}

function redactUrlQuery(url: string): string {
    const start = url.indexOf('?')
    if (start < 0) {
        return url
    }
    return url.slice(0, start + 1) + redactQueryText(url.slice(start + 1))
}

/** Scheme (any case, leading control characters and spaces, any run of slashes) and authority, as WHATWG parses them. */
const URL_AUTHORITY = /^([\u0000- ]*[A-Za-z][A-Za-z0-9+.-]*:[/\\]*)([^/\\?#]*)/

function redactUserinfoPart(raw: string, isUser: boolean): string {
    if (raw === '') {
        return raw
    }
    const decoded = decodeUri(raw)
    if (decoded !== null && isRedactedValue(decoded)) {
        return raw
    }
    const value = decoded ?? raw
    if (isUser && Array.from(value).length < REVEAL_MIN_LENGTH) {
        return raw
    }
    return urlToken(value)
}

/** The password is always redacted; the username only when 16 code points or longer, so `admin` stays readable. */
function redactUserinfo(url: string): string {
    const parsed = URL_AUTHORITY.exec(url)
    if (!parsed) {
        return url
    }
    const [whole, head, authority] = parsed
    const at = authority.lastIndexOf('@')
    if (at < 0) {
        return url
    }
    const userinfo = authority.slice(0, at)
    const colon = userinfo.indexOf(':')
    const user = colon < 0 ? userinfo : userinfo.slice(0, colon)
    const password = colon < 0 ? null : userinfo.slice(colon + 1)
    const nextUser = redactUserinfoPart(user, true)
    const nextPassword = password === null ? null : redactUserinfoPart(password, false)
    return head + nextUser + (nextPassword === null ? '' : `:${nextPassword}`) + authority.slice(at) + url.slice(whole.length)
}

//#endregion

//#region headers

const SECRET_HEADER_PARTS = ['auth', 'token', 'key', 'secret', 'cookie', 'password', 'session', 'signature', 'credential']
const AUTH_SCHEME = /^(Bearer|Basic|Digest|Token|Key|DeepL-Auth-Key|AWS4-HMAC-SHA256)(\s+)([\s\S]*)$/i
const HEADER_PAIR = new RegExp(`("([^"\\\\]*)"\\s*:\\s*")(${JSON_STRING_SOURCE})(")`, 'g')

/** Header names are matched by substring: there are few of them, and a miss leaks a key while a false hit only hides a value. */
function redactHeaders(text: string): string {
    return text.replace(HEADER_PAIR, (match: string, prefix: string, name: string, raw: string, close: string) => {
        const normalized = name.toLowerCase().replace(/[-_]/g, '')
        if (raw === '' || !SECRET_HEADER_PARTS.some((part) => normalized.includes(part))) {
            return match
        }
        const decoded = decodeJsonString(raw)
        if (decoded !== null && isRedactedValue(decoded)) {
            return match
        }
        const value = decoded ?? raw
        const scheme = AUTH_SCHEME.exec(value)
        if (scheme) {
            const [, word, space, rest] = scheme
            if (rest === '' || isRedactedValue(rest)) {
                return match
            }
            return prefix + escapeJson(word + space + redactionToken(rest)) + close
        }
        return prefix + escapeJson(redactionToken(value)) + close
    })
}

//#endregion

/** A body that is a bare `name=value&...` form (no whitespace, not JSON). */
function looksLikeForm(text: string): boolean {
    return /^[^=&\s{["]+=/.test(text) && !/\s/.test(text)
}

/**
 * Redacts credentials in the text of one log field. `known` is the matcher of configured
 * values; it runs first, then the name rules of the field.
 */
export function redactLogField(field: FetchLogField, text: string, known?: KnownSecrets): string {
    if (typeof text !== 'string' || text === '') {
        return text
    }
    // Form-ness is decided on the text as captured: a configured value replaced by a token adds
    // whitespace, which must not switch the name rules off for the rest of the body.
    const form = field !== 'url' && field !== 'header' && looksLikeForm(text)
    const valueRedacted = known ? known.apply(text) : text
    if (field === 'url') {
        return redactUrlQuery(redactUserinfo(valueRedacted))
    }
    if (field === 'header') {
        return redactHeaders(valueRedacted)
    }
    const jsonRedacted = redactJsonFields(valueRedacted)
    return form ? redactQueryText(jsonRedacted) : jsonRedacted
}
