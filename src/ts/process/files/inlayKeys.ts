import { NODE_MAX_WRITE_KEY_BYTES, isWellFormedUtf16 } from 'src/ts/storage/store/keyRules'

/**
 * Where an inlay lives in the app store: a metadata key per id and one body key
 * per write, all in the single folder `inlays/`.
 *
 * - `inlays/m-<encoded id>`: the metadata record, the commit point of a write.
 * - `inlays/b-<encoded id>.<token>`: a body; the metadata names the current one.
 *
 * The encoded id keeps `a-z`, `0-9` and `-` and writes every other UTF-8 byte
 * as `%` and two UPPERCASE hex digits. Uppercase letters, `.` and `%` are
 * therefore always escapes, so two ids never share a key, not even on a case
 * insensitive file system, and an encoded id never holds `/`. An id that is not
 * well-formed UTF-16, is empty, or encodes longer than the longest key the Node
 * server accepts is unmappable: it has no key.
 */

export const INLAY_PREFIX = 'inlays/'
export const INLAY_META_PREFIX = 'inlays/m-'
export const INLAY_BODY_PREFIX = 'inlays/b-'

const BODY_TOKEN_LENGTH = 16
/** The longest key derived from an id is its body key. */
const MAX_ENCODED_ID_LENGTH = NODE_MAX_WRITE_KEY_BYTES - INLAY_BODY_PREFIX.length - 1 - BODY_TOKEN_LENGTH

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const HEX = '0123456789ABCDEF'

/** The key-safe form of `id`, or `null` when `id` has none. */
export function encodeInlayId(id: string): string | null {
    if (typeof id !== 'string' || id.length === 0 || !isWellFormedUtf16(id)) {
        return null
    }
    let encoded = ''
    for (const byte of encoder.encode(id)) {
        const char = String.fromCharCode(byte)
        if (/[a-z0-9-]/.test(char)) {
            encoded += char
        } else {
            encoded += '%' + HEX[byte >> 4] + HEX[byte & 15]
        }
        if (encoded.length > MAX_ENCODED_ID_LENGTH) {
            return null
        }
    }
    return encoded
}

/** The id an encoded form stands for, or `null` when `encoded` is not the canonical form of any id. */
export function decodeInlayId(encoded: string): string | null {
    const bytes: number[] = []
    for (let i = 0; i < encoded.length; i++) {
        const char = encoded[i]
        if (char === '%') {
            const hex = encoded.slice(i + 1, i + 3)
            if (!/^[0-9A-F]{2}$/.test(hex)) {
                return null
            }
            bytes.push(parseInt(hex, 16))
            i += 2
        } else {
            bytes.push(char.charCodeAt(0))
        }
    }
    let id: string
    try {
        id = decoder.decode(new Uint8Array(bytes))
    } catch {
        return null
    }
    return encodeInlayId(id) === encoded ? id : null
}

export function inlayMetaKey(id: string): string | null {
    const encoded = encodeInlayId(id)
    return encoded === null ? null : INLAY_META_PREFIX + encoded
}

/** The body key of one write of `id`; `token` is `BODY_TOKEN_LENGTH` lowercase hex digits. */
export function inlayBodyKey(id: string, token: string): string | null {
    const encoded = encodeInlayId(id)
    return encoded === null ? null : `${INLAY_BODY_PREFIX}${encoded}.${token}`
}

/** The id a metadata key belongs to, or `null` for any other key. */
export function inlayIdFromMetaKey(key: string): string | null {
    return key.startsWith(INLAY_META_PREFIX) ? decodeInlayId(key.slice(INLAY_META_PREFIX.length)) : null
}

/** A fresh token for a body key. */
export function newBodyToken(): string {
    const bytes = new Uint8Array(BODY_TOKEN_LENGTH / 2)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
