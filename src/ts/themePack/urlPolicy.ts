// MC-1351: a pack may carry its own fonts and images, but it may not reach outside itself. The tokeniser (canonical.ts)
// finds every resource a stylesheet names; this module decides which targets are files of the pack.

export const URL_POLICY_REASON = 'a remote or non-bundled url() is not allowed: a pack may only point at its own bundled fonts and images (MC-1351)'
export const ELEMENT_REASON = 'element() is not allowed: a pack may only point at its own bundled fonts and images (MC-1351)'

/**
 * Whether a target names a file inside the pack: a relative path with no scheme (nor anything scheme-looking, a Windows
 * drive form `c|` included), not absolute or protocol-relative, without backslashes, whitespace or control characters,
 * not fragment-only, with no `..` segment even when percent-encoded, and naming a file: the path before any query or
 * fragment is not empty and does not end in a directory (`.`, `./`, `images/`) (MC-1549).
 */
export function isBundledTarget(target: string): boolean {
    if (target === '' || /[\s\u0000-\u001f\u007f\\:|]/.test(target)) return false
    if (target.startsWith('/') || target.startsWith('#')) return false
    let decoded: string
    try {
        decoded = decodeURIComponent(target)
    } catch {
        return false
    }
    if (/[\s\u0000-\u001f\u007f\\:|]/.test(decoded) || decoded.startsWith('/')) return false
    // The last segment of the path before any query or fragment: empty for `?x`, `a/` and `images/`, `.` for `./` and `a/.`.
    const segments = decoded.split(/[?#]/)[0].split('/')
    const last = segments[segments.length - 1]
    if (last === '' || last === '.') return false
    return !decoded.split(/[/?#]/).some((segment) => segment === '..')
}
