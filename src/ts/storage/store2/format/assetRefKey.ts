const HASH_NAME = /^([0-9a-f]{64})\..*$/i

const HEX_STEM = /^[0-9a-f]{64}$/i
/**
 * Whole stems of 43 base64url characters. The last character of a stem carries
 * only 4 payload bits, so it is one of `AEIMQUYcgkosw048`: any other value is a
 * non-canonical encoding of 32 bytes and is refused.
 */
const STEM_RUN = /^(?:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])*$/

/** The width of one hash stem in an `h` string: 32 bytes as unpadded base64url. */
export const HASH_STEM_CHARS = 43

/** Whether `h` is a (possibly empty) concatenation of 43-character base64url stems. */
export function isHashStemRun(h: string): boolean {
    return STEM_RUN.test(h)
}

/** Splits an `h` string into its 43-character stems; refuses a run `isHashStemRun` refuses. */
export function splitHashStems(h: string): string[] {
    if (!isHashStemRun(h)) {
        throw new RangeError('h is not a run of 43-character base64url stems.')
    }
    const stems: string[] = []
    for (let i = 0; i < h.length; i += HASH_STEM_CHARS) {
        stems.push(h.slice(i, i + HASH_STEM_CHARS))
    }
    return stems
}

/** The 43-character unpadded base64url form of a 64-hex hash stem (the form `h` stores), in either hex case. */
export function hexStemToBase64url(hex: string): string {
    if (!HEX_STEM.test(hex)) {
        throw new RangeError('A hash stem is 64 hex digits.')
    }
    let binary = ''
    for (let i = 0; i < 64; i += 2) {
        binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The comparison key of an asset name, used by list derivation and every sweep:
 * the lower-cased basename, except that `<64 hex digits>.<extension>` in any case
 * (an empty extension included) reduces to its lower-cased hash stem, so
 * `ABC….PNG` and `abc….png` are the same asset on a case-sensitive store and on
 * one that folds case.
 */
export function assetRefKey(name: string): string {
    const base = name.slice(name.lastIndexOf('/') + 1)
    const hashed = HASH_NAME.exec(base)
    return hashed ? hashed[1].toLowerCase() : base.toLowerCase()
}
