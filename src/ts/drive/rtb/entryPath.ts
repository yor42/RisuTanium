/**
 * Path rules for `.rtb` entry names (A1.4), applied to the raw name bytes of every
 * entry in every section and outside every prefix.
 *
 * A name is refused when it is empty, longer than the read limit, not ASCII, holds a
 * control byte (`0x00-0x1F` and `0x7F`), a backslash, a leading `/`, or an empty,
 * `.` or `..` segment. A trailing `/` leaves an empty last segment, so it is refused.
 */

/** Readers accept names up to this many bytes; writer v1 emits at most 1,024. */
export const MAX_NAME_BYTES = 65535

export type EntryPathProblem =
    | 'empty'
    | 'too-long'
    | 'non-ascii'
    | 'control-byte'
    | 'backslash'
    | 'leading-slash'
    | 'empty-segment'
    | 'dot-segment'
    | 'dot-dot-segment'

const SLASH = 0x2F
const BACKSLASH = 0x5C
const DOT = 0x2E

/** The first rule the name breaks, or null when it is acceptable. */
export function checkEntryPath(name: Uint8Array): EntryPathProblem | null {
    if (name.length === 0) {
        return 'empty'
    }
    if (name.length > MAX_NAME_BYTES) {
        return 'too-long'
    }
    for (let i = 0; i < name.length; i++) {
        const byte = name[i]
        if (byte >= 0x80) {
            return 'non-ascii'
        }
        if (byte < 0x20 || byte === 0x7F) {
            return 'control-byte'
        }
        if (byte === BACKSLASH) {
            return 'backslash'
        }
    }
    let segmentStart = 0
    for (let i = 0; i <= name.length; i++) {
        if (i < name.length && name[i] !== SLASH) {
            continue
        }
        const length = i - segmentStart
        if (length === 0) {
            return i === 0 ? 'leading-slash' : 'empty-segment'
        }
        if (length === 1 && name[segmentStart] === DOT) {
            return 'dot-segment'
        }
        if (length === 2 && name[segmentStart] === DOT && name[segmentStart + 1] === DOT) {
            return 'dot-dot-segment'
        }
        segmentStart = i + 1
    }
    return null
}
