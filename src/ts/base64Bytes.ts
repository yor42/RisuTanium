const NOT_BASE64 = -1
const EQUALS = 0x3d

// Both the standard alphabet and the url-safe one (- and _) are accepted, as the `buffer` package does.
const SEXTET = (() => {
    const table = new Int8Array(256).fill(NOT_BASE64)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    for (let i = 0; i < alphabet.length; i++) {
        table[alphabet.charCodeAt(i)] = i
    }
    table['-'.charCodeAt(0)] = 62
    table['_'.charCodeAt(0)] = 63
    return table
})()

/**
 * Decodes base64 text held as bytes into bytes, with no string in between. For ASCII text it gives exactly what
 * `Buffer.from(text, 'base64')` of the `buffer` package gives, and for any other bytes what that call gives for the
 * UTF-8 decoding of them:
 * - reading stops at the first `=`, wherever it stands;
 * - every byte that is not in the alphabet is skipped (whitespace, line breaks, anything outside ASCII);
 * - missing padding is fine, and a trailing group of two characters gives one byte and of three characters two bytes;
 * - a single trailing character, or fewer than two characters in all, adds nothing.
 */
export function decodeBase64Bytes(text: Uint8Array): Uint8Array {
    let count = 0
    for (let i = 0; i < text.length; i++) {
        const byte = text[i]
        if (byte === EQUALS) {
            break
        }
        if (SEXTET[byte] !== NOT_BASE64) {
            count++
        }
    }
    const rest = count % 4
    const out = new Uint8Array((count - rest) / 4 * 3 + (rest === 3 ? 2 : rest === 2 ? 1 : 0))

    let group = 0
    let inGroup = 0
    let at = 0
    for (let i = 0; i < text.length; i++) {
        const byte = text[i]
        if (byte === EQUALS) {
            break
        }
        const value = SEXTET[byte]
        if (value === NOT_BASE64) {
            continue
        }
        group = (group << 6) | value
        inGroup++
        if (inGroup === 4) {
            out[at++] = (group >> 16) & 0xff
            out[at++] = (group >> 8) & 0xff
            out[at++] = group & 0xff
            group = 0
            inGroup = 0
        }
    }
    if (inGroup === 2) {
        out[at++] = (group >> 4) & 0xff
    }
    else if (inGroup === 3) {
        out[at++] = (group >> 10) & 0xff
        out[at++] = (group >> 2) & 0xff
    }
    return out
}
