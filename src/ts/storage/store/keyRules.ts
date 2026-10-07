import { ATOMIC_TEMP_NAME_PATTERN } from '../tauriAtomicWrite'

/**
 * Two rule sets decide whether a key is usable. Each function returns the
 * reason a key is refused, or `null` when it passes.
 *
 * Creatable keys are what `write` accepts. The set keeps a new name from
 * aliasing another name or failing on any backend: well-formed UTF-16, no
 * leading or trailing `/`, no empty segment, no segment starting with `.` (the
 * desktop file system scope refuses such a name on macOS and Linux), no `\` and
 * no control character below U+0020, and a last segment that is not a name the
 * atomic file write uses for its temp files. Each backend adds its own limit.
 *
 * Addressable keys are what `read`, `has`, `delete` and a `list` prefix accept.
 * The set is only what a backend needs to stay safe, so a key that upstream
 * already stored, and that is not creatable, stays readable, listed and
 * deletable.
 *
 * On Windows a trailing dot or space in a segment is stripped by path
 * normalization, and names that differ only by case are the same file, so such
 * keys address the same file as their stripped or case-folded form. They stay
 * addressable on purpose: upstream Windows data relies on it (an empty asset
 * extension gives `assets/<hash>.`), and asset names are content hashes or
 * UUIDs, so names that alias hold the same bytes.
 */

export type FilePlatform = 'windows' | 'posix'

/** The longest key `write` accepts on the Node server, in UTF-8 bytes: the hex file name plus the server's temp suffix must fit a 255-byte file name. */
export const NODE_MAX_WRITE_KEY_BYTES = 117

/** The longest path segment `write` accepts on the desktop file system, in UTF-8 bytes. */
export const TAURI_MAX_SEGMENT_BYTES = 255

const WINDOWS_RESERVED_CHARACTERS = /[<>:"|?*]/
const DRIVE_PREFIX = /^[A-Za-z]:/

/** A loop over code units on purpose: `String.prototype.isWellFormed` is missing from the older Safari releases the app still runs on. */
export function isWellFormedUtf16(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i)
        if (unit >= 0xD800 && unit <= 0xDBFF) {
            const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0
            if (next < 0xDC00 || next > 0xDFFF) {
                return false
            }
            i++
        } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
            return false
        }
    }
    return true
}

export function utf8ByteLength(text: string): number {
    return new TextEncoder().encode(text).length
}

function hasControlCharacter(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) < 0x20) {
            return true
        }
    }
    return false
}

function creatableViolation(key: string): string | null {
    if (typeof key !== 'string' || key.length === 0) {
        return 'a key is a non-empty string'
    }
    if (!isWellFormedUtf16(key)) {
        return 'a key is well-formed UTF-16'
    }
    if (key.includes('\\') || hasControlCharacter(key)) {
        return 'a key holds no backslash and no control character'
    }
    if (key.startsWith('/') || key.endsWith('/')) {
        return 'a key does not start or end with /'
    }
    const segments = key.split('/')
    for (const segment of segments) {
        if (segment === '') {
            return 'a key has no empty segment'
        }
        if (segment.startsWith('.')) {
            return 'no segment of a key starts with .'
        }
    }
    if (ATOMIC_TEMP_NAME_PATTERN.test(segments[segments.length - 1])) {
        return 'the last segment is reserved for temporary files'
    }
    return null
}

/** Keys `write` accepts on the Node server. */
export function nodeCreatableViolation(key: string): string | null {
    const common = creatableViolation(key)
    if (common !== null) {
        return common
    }
    if (utf8ByteLength(key) > NODE_MAX_WRITE_KEY_BYTES) {
        return `a key written to the Node server is at most ${NODE_MAX_WRITE_KEY_BYTES} UTF-8 bytes`
    }
    return null
}

/** Keys `write` accepts on the desktop file system. */
export function tauriCreatableViolation(key: string): string | null {
    const common = creatableViolation(key)
    if (common !== null) {
        return common
    }
    if (WINDOWS_RESERVED_CHARACTERS.test(key)) {
        return 'a key holds none of < > : " | ? *'
    }
    for (const segment of key.split('/')) {
        if (segment.endsWith('.') || segment.endsWith(' ')) {
            return 'no segment of a key ends with a dot or a space'
        }
        if (utf8ByteLength(segment) > TAURI_MAX_SEGMENT_BYTES) {
            return `a segment is at most ${TAURI_MAX_SEGMENT_BYTES} UTF-8 bytes`
        }
    }
    return null
}

/** Keys `write` accepts in the browser's IndexedDB. */
export function indexedDbCreatableViolation(key: string): string | null {
    return creatableViolation(key)
}

/**
 * Keys the Node server can address. A lone surrogate would hex-encode as
 * U+FFFD and alias another key.
 */
export function nodeAddressableViolation(key: string): string | null {
    if (typeof key !== 'string' || key.length === 0) {
        return 'a key is a non-empty string'
    }
    if (!isWellFormedUtf16(key)) {
        return 'a key is well-formed UTF-16'
    }
    return null
}

/**
 * The shape of an inlay body key: `inlays/b-<encoded id>.<16 lowercase hex
 * digits>`, the encoded id being `a-z`, `0-9`, `-` and `%` plus two UPPERCASE hex
 * digits (`inlayKeys.ts`). It is the only key class that may hold a Blob, and
 * the only one under `inlays/` the Node asset route serves. The server twin in
 * `server/node/assetRoute.cjs` holds the same pattern.
 */
const INLAY_BODY_KEY_PATTERN = /^inlays\/b-(?:[a-z0-9-]|%[0-9A-F]{2})+\.[0-9a-f]{16}$/

/** The reason `key` is not an inlay body key, or `null` when it is one. */
export function inlayBodyKeyViolation(key: string): string | null {
    if (typeof key !== 'string' || !INLAY_BODY_KEY_PATTERN.test(key)) {
        return 'only an inlay body key (inlays/b-<encoded id>.<16 hex digits>) holds a Blob'
    }
    return null
}

/**
 * The reason the Node server's asset route (`GET /api/asset/<hex>`) refuses
 * `key`, or `null` when it serves it: a key under `assets/`, or an inlay body
 * key (`inlayBodyKeyViolation`) within the longest key the server accepts.
 * The server holds the same rule in `server/node/assetRoute.cjs`
 * (`isRouteServedKey`); the route and `urlFor` must agree on every key, and one
 * table test runs both.
 */
export function nodeAssetRouteViolation(key: string): string | null {
    if (typeof key === 'string' && key.startsWith('inlays/')) {
        if (inlayBodyKeyViolation(key) !== null || key.length > NODE_MAX_WRITE_KEY_BYTES) {
            return `under inlays/ the asset route serves only an inlay body key of at most ${NODE_MAX_WRITE_KEY_BYTES} bytes`
        }
        return null
    }
    if (typeof key !== 'string' || !key.startsWith('assets/')) {
        return 'the asset route serves only keys under assets/ and inlay body keys'
    }
    if (!isWellFormedUtf16(key)) {
        return 'a key is well-formed UTF-16'
    }
    if (key.includes('\\')) {
        return 'a key holds no backslash'
    }
    for (const segment of key.split('/')) {
        if (segment === '' || segment === '.' || segment === '..') {
            return 'a key has no empty, . or .. segment'
        }
    }
    return null
}

/** Keys IndexedDB can address: any non-empty string. */
export function indexedDbAddressableViolation(key: string): string | null {
    if (typeof key !== 'string' || key.length === 0) {
        return 'a key is a non-empty string'
    }
    return null
}

/**
 * Keys the desktop file system can address without leaving the AppData
 * directory or reaching an alternate data stream: not absolute, no drive
 * prefix, no NUL, no empty, `.` or `..` segment (segments split on `\` too on
 * Windows), and on Windows no `:`.
 *
 * With `prefix` the last piece may be empty or partial, since it names the
 * start of a name, and only the complete segments before it are checked.
 */
export function tauriAddressableViolation(key: string, platform: FilePlatform, prefix = false): string | null {
    if (typeof key !== 'string' || key.length === 0) {
        return 'a key is a non-empty string'
    }
    if (key.includes('\0')) {
        return 'a key holds no NUL'
    }
    if (key.startsWith('/') || key.startsWith('\\') || DRIVE_PREFIX.test(key)) {
        return 'a key is relative to the app data directory'
    }
    if (platform === 'windows' && key.includes(':')) {
        return 'a key holds no : on Windows'
    }
    const pieces = key.split(platform === 'windows' ? /[\\/]/ : '/')
    const complete = prefix ? pieces.slice(0, -1) : pieces
    for (const segment of complete) {
        if (segment === '' || segment === '.' || segment === '..') {
            return 'a key has no empty, . or .. segment'
        }
    }
    return null
}
