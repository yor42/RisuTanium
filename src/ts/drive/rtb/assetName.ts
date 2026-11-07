/**
 * Names of asset entries in an `.rtb` file (A3.2): `a/` plus `esc(K)`, where K is the
 * asset key without its `assets/` folder.
 *
 * `esc` works on the UTF-8 bytes of K. A byte in `[a-z0-9_-]` is kept, a `.` is kept
 * unless it is the first or the last byte, and every other byte becomes `%` and two
 * upper-case hex digits. `unesc` accepts a name only when re-escaping its result gives
 * the same name, so every key has exactly one name and two different names can never
 * decode to one key.
 */

export const ASSET_PREFIX = 'a/'

const HEX = '0123456789ABCDEF'
const encoder = new TextEncoder()
// ignoreBOM keeps a leading U+FEFF in the decoded key; the default would drop it, so two names would decode to one key.
const strictDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function isKeptByte(byte: number): boolean {
    return (byte >= 0x61 && byte <= 0x7A) || (byte >= 0x30 && byte <= 0x39) || byte === 0x5F || byte === 0x2D
}

function escapeBytes(bytes: Uint8Array): string {
    let out = ''
    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i]
        if (isKeptByte(byte) || (byte === 0x2E && i > 0 && i < bytes.length - 1)) {
            out += String.fromCharCode(byte)
        } else {
            out += '%' + HEX[byte >> 4] + HEX[byte & 15]
        }
    }
    return out
}

/** The escaped form of an asset key. A key that is not well-formed UTF-16 has no name. */
export function escAssetKey(key: string): string {
    const bytes = encoder.encode(key)
    if (strictDecoder.decode(bytes) !== key) {
        throw new RangeError('The asset key is not well-formed UTF-16.')
    }
    return escapeBytes(bytes)
}

function hexValue(char: string | undefined): number {
    return char === undefined || char.length !== 1 ? -1 : HEX.indexOf(char)
}

/** The asset key an escaped name stands for, or null when the name is not the canonical form of any key. */
export function unescAssetName(name: string): string | null {
    const bytes: number[] = []
    for (let i = 0; i < name.length; i++) {
        const code = name.charCodeAt(i)
        if (name[i] === '%') {
            const high = hexValue(name[i + 1])
            const low = hexValue(name[i + 2])
            if (high < 0 || low < 0) {
                return null
            }
            bytes.push(high * 16 + low)
            i += 2
        } else if (code < 0x80 && (isKeptByte(code) || code === 0x2E)) {
            bytes.push(code)
        } else {
            return null
        }
    }
    const raw = Uint8Array.from(bytes)
    let key: string
    try {
        key = strictDecoder.decode(raw)
    } catch {
        return null
    }
    return escapeBytes(raw) === name ? key : null
}

/** The entry name of an asset key. */
export function assetEntryName(key: string): string {
    return ASSET_PREFIX + escAssetKey(key)
}

export type AssetNamesResult =
    | { ok: true, keys: string[] }
    | { ok: false, name: string, reason: string }

/**
 * Decodes the names of the asset entries to their keys, in order. A name outside `a/`, a
 * name that is not canonical, or two names that decode to one key make the file damaged.
 */
export function decodeAssetEntryNames(names: readonly string[]): AssetNamesResult {
    const seen = new Set<string>()
    const keys: string[] = []
    for (const name of names) {
        if (!name.startsWith(ASSET_PREFIX)) {
            return { ok: false, name, reason: 'the entry is not under a/' }
        }
        const key = unescAssetName(name.slice(ASSET_PREFIX.length))
        if (key === null) {
            return { ok: false, name, reason: 'the asset name is not the canonical escaped form of any key' }
        }
        if (seen.has(key)) {
            return { ok: false, name, reason: 'two asset names decode to the same key' }
        }
        seen.add(key)
        keys.push(key)
    }
    return { ok: true, keys }
}
