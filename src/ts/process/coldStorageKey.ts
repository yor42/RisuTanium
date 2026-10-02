/**
 * The longest unit key, in UTF-8 bytes. The Node server stores a unit under a
 * file name that is the hex encoding of `coldstorage/<key>`, and the file
 * system refuses a name longer than 255 bytes; the server then answers the read
 * with an empty 200 that looks exactly like an absent unit. 100 bytes keeps the
 * encoded name far from that limit.
 */
export const MAX_COLD_STORAGE_KEY_BYTES = 100

/** Characters no unit key may contain: path separators and the characters a file name may not hold on Windows. */
const FORBIDDEN_KEY_CHARACTERS: ReadonlySet<number> = new Set(
    ['/', '\\', ':', '<', '>', '"', '|', '?', '*'].map((character) => character.charCodeAt(0)),
)

/**
 * True when `key` may become the name a unit is stored under: a non-empty
 * string of at most `MAX_COLD_STORAGE_KEY_BYTES` UTF-8 bytes, well-formed
 * UTF-16, holding no path separator, no Windows-reserved file-name character and
 * no control character (U+0000 to U+001F).
 *
 * Every key this app or upstream has written passes: UUIDs (`uuid` v4 here,
 * `crypto.randomUUID()` upstream) and upstream's `<uuid>_accessMeta`. Every function that turns a key into a storage location
 * applies this before it touches a backend, because the backends disagree about
 * a key they cannot hold: a `/` is a missing file on a POSIX desktop, and an
 * over-long name is an empty 200 on the Node server, both of which read as an
 * absent unit.
 *
 * Pure and total: it never throws, whatever it is given. The well-formedness
 * check is a loop over code units on purpose (`String.prototype.isWellFormed`
 * and regex lookbehind are missing from the older Safari releases the app still
 * runs on).
 */
export function isSafeColdStorageKey(key: unknown): key is string {
    if (typeof key !== 'string' || key.length === 0) {
        return false
    }
    let bytes = 0
    for (let i = 0; i < key.length; i++) {
        const unit = key.charCodeAt(i)
        if (unit < 0x20 || FORBIDDEN_KEY_CHARACTERS.has(unit)) {
            return false
        }
        if (unit < 0x80) {
            bytes += 1
        } else if (unit < 0x800) {
            bytes += 2
        } else if (unit >= 0xD800 && unit <= 0xDBFF) {
            const next = i + 1 < key.length ? key.charCodeAt(i + 1) : 0
            if (next < 0xDC00 || next > 0xDFFF) {
                return false
            }
            bytes += 4
            i++
        } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
            return false
        } else {
            bytes += 3
        }
        if (bytes > MAX_COLD_STORAGE_KEY_BYTES) {
            return false
        }
    }
    return true
}
