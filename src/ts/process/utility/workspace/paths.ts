import { isWellFormedUtf16 } from '../../../storage/store/keyRules'

/** Why a workspace path was refused; every reason is stable so callers and tests can branch on it. */
export type WorkspacePathRefusal =
    | 'empty'
    | 'not-text'
    | 'trailing-slash'
    | 'empty-segment'
    | 'dot-segment'
    | 'forbidden-character'
    | 'segment-ends-with-dot-or-space'
    | 'reserved-name'
    | 'segment-too-long'
    | 'path-too-long'
    | 'too-deep'
    | 'malformed-text'

export type WorkspacePathResult = { ok: true, path: string } | { ok: false, reason: WorkspacePathRefusal }

export const MAX_SEGMENT_BYTES = 255
export const MAX_PATH_BYTES = 1024
export const MAX_PATH_DEPTH = 32

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const FORBIDDEN = /[\u0000-\u001f\u007f\\<>:"|?*]/
const encoder = new TextEncoder()

function utf8Length(text: string): number {
    return encoder.encode(text).length
}

/**
 * The one spelling of a workspace path: NFC, one leading `/` or `./` removed, `/`-separated. A path the file system of any
 * platform would treat specially, or that could escape a root when exported, is refused. There is no file system behind the
 * paths; the rules keep names portable across a zip export and unambiguous across systems.
 */
export function normalizeWorkspacePath(raw: string): WorkspacePathResult {
    if (typeof raw !== 'string') {
        return { ok: false, reason: 'not-text' }
    }
    if (!isWellFormedUtf16(raw)) {
        return { ok: false, reason: 'malformed-text' }
    }
    let path = raw.normalize('NFC')
    if (path.startsWith('./')) {
        path = path.slice(2)
    } else if (path.startsWith('/')) {
        path = path.slice(1)
    }
    if (path === '') {
        return { ok: false, reason: 'empty' }
    }
    if (path.endsWith('/')) {
        return { ok: false, reason: 'trailing-slash' }
    }
    if (FORBIDDEN.test(path)) {
        return { ok: false, reason: 'forbidden-character' }
    }
    if (utf8Length(path) > MAX_PATH_BYTES) {
        return { ok: false, reason: 'path-too-long' }
    }
    const segments = path.split('/')
    if (segments.length > MAX_PATH_DEPTH) {
        return { ok: false, reason: 'too-deep' }
    }
    for (const segment of segments) {
        if (segment === '') {
            return { ok: false, reason: 'empty-segment' }
        }
        if (segment === '.' || segment === '..') {
            return { ok: false, reason: 'dot-segment' }
        }
        if (segment.endsWith('.') || segment.endsWith(' ')) {
            return { ok: false, reason: 'segment-ends-with-dot-or-space' }
        }
        const dot = segment.indexOf('.')
        const stem = dot === -1 ? segment : segment.slice(0, dot)
        if (RESERVED_NAME.test(stem)) {
            return { ok: false, reason: 'reserved-name' }
        }
        if (utf8Length(segment) > MAX_SEGMENT_BYTES) {
            return { ok: false, reason: 'segment-too-long' }
        }
    }
    return { ok: true, path }
}

/** Two paths that share this key collide: a zip extracted on a case-insensitive system would merge them. */
export function workspacePathKey(path: string): string {
    return path.normalize('NFC').toLowerCase()
}
