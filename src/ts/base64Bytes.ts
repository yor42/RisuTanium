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

/**
 * `decodeBase64Bytes` for text that arrives in pieces: the bytes of all `push` results followed by those of `finish`
 * are exactly what `decodeBase64Bytes` gives for the pieces joined, wherever the text is split. A group of characters
 * cut by a piece boundary, the number of characters in it and the point where an `=` stopped the reading are carried
 * from one piece to the next.
 *
 * Every result is a new array that nothing else refers to, and the text is only read, so a piece of the text may be a
 * view into memory the caller does not own.
 */
export class Base64StreamDecoder {
    #group = 0
    #inGroup = 0
    #stopped = false

    /** The bytes the text adds, as far as whole groups of four characters go; the rest waits for the next piece. */
    push(text: Uint8Array): Uint8Array {
        if (this.#stopped) {
            return new Uint8Array(0)
        }
        let count = 0
        let end = text.length
        for (let i = 0; i < text.length; i++) {
            const byte = text[i]
            if (byte === EQUALS) {
                end = i
                break
            }
            if (SEXTET[byte] !== NOT_BASE64) {
                count++
            }
        }
        const out = new Uint8Array(Math.floor((this.#inGroup + count) / 4) * 3)
        let group = this.#group
        let inGroup = this.#inGroup
        let at = 0
        for (let i = 0; i < end; i++) {
            const value = SEXTET[text[i]]
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
        this.#group = group
        this.#inGroup = inGroup
        this.#stopped = end < text.length
        return out
    }

    /** The bytes of a last group of two or three characters; nothing for no group or a single character. */
    finish(): Uint8Array {
        const group = this.#group
        const inGroup = this.#inGroup
        this.#group = 0
        this.#inGroup = 0
        this.#stopped = true
        if (inGroup === 2) {
            return new Uint8Array([(group >> 4) & 0xff])
        }
        if (inGroup === 3) {
            return new Uint8Array([(group >> 10) & 0xff, (group >> 2) & 0xff])
        }
        return new Uint8Array(0)
    }
}
