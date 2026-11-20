/**
 * Password text to the bytes that feed Argon2id. The writer and the reader apply this one
 * function, so the same typed text always gives the same bytes: lone surrogates are refused
 * (UTF-8 encoding would silently replace them and let different inputs collide), the empty
 * string is refused, then the text is normalised to NFC and encoded as UTF-8. No trimming and no
 * case mapping.
 */

export type PasswordRefusal = 'empty' | 'ill-formed'

function hasLoneSurrogate(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i)
        if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0
            if (next < 0xdc00 || next > 0xdfff) {
                return true
            }
            i++
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            return true
        }
    }
    return false
}

export function passwordBytes(text: string): Uint8Array | PasswordRefusal {
    if (hasLoneSurrogate(text)) {
        return 'ill-formed'
    }
    if (text.length === 0) {
        return 'empty'
    }
    return new TextEncoder().encode(text.normalize('NFC'))
}
