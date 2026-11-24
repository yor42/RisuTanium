// Which segment of the Display form a character last showed, kept per character on this device only (DD-099): never part
// of the database or a backup, and a storage that is missing, full or throwing just means the first segment (photo).

export type DisplaySegment = 'photo' | 'screen' | 'assets'

export const DISPLAY_SEGMENTS: readonly DisplaySegment[] = ['photo', 'screen', 'assets']

const KEY_PREFIX = 'risuStudio.displaySegment.'

export function readDisplaySegment(chaId: string): DisplaySegment {
    try {
        const raw = globalThis.localStorage.getItem(KEY_PREFIX + chaId)
        return DISPLAY_SEGMENTS.find((segment) => segment === raw) ?? 'photo'
    } catch {
        return 'photo'
    }
}

export function writeDisplaySegment(chaId: string, segment: DisplaySegment): void {
    try {
        if (segment === 'photo') {
            globalThis.localStorage.removeItem(KEY_PREFIX + chaId)
        } else {
            globalThis.localStorage.setItem(KEY_PREFIX + chaId, segment)
        }
    } catch {
        // The segment is a convenience; a storage that refuses it changes nothing else.
    }
}
