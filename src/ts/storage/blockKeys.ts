import { Sha256 } from '@aws-crypto/sha256-js'

/**
 * The key space of the block store. Every key lives under `blocks/`, a prefix
 * no other listing or sweep reaches:
 *
 * - `blocks/head`                     the head pointer
 * - `blocks/<gen>/kept`               marker: this generation is kept
 * - `blocks/<gen>/root`               the framed ROOT block
 * - `blocks/<gen>/f/<name>`           one fixed block
 * - `blocks/<gen>/c/<k(chaId)>`       one loaded character
 * - `blocks/<gen>/stubs`              the pack of every archived character's stub
 *
 * `k` is injective and valid on every adapter. A character name (chaId) is not
 * a usable key: it may hold any character, be up to 255 bytes, differ from
 * another only by case, and share a namespace with the fixed block names.
 */

export const BLOCKS_PREFIX = 'blocks/'
export const HEAD_KEY = 'blocks/head'

/** The names of the fixed blocks. A block with one of these names is never a character. */
export const FIXED_BLOCK_NAMES: readonly string[] = ['preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'config']
const FIXED_SET: ReadonlySet<string> = new Set(FIXED_BLOCK_NAMES)

export const ROOT_BLOCK_NAME = 'root'

/** Keys outside `blocks/` the block store has to know about. */
export const LEGACY_MAIN_FILE_KEY = 'database/database.bin'
export const PRE_BLOCKS_PREFIX = 'database/database.pre-blocks'
export const NUMBERED_BACKUP_PREFIX = 'database/dbbackup-'

export function isFixedBlockName(name: string): boolean {
    return FIXED_SET.has(name)
}

/**
 * The longest lowercase-hex form of a name. With `blocks/` (7 bytes), a
 * generation id (21), `/c/` (3) and this, a key stays below the Node server's
 * 117-byte write limit.
 */
const MAX_HEX_CHARS = 80

const HASHED_PREFIX = 'h'

const textEncoder = new TextEncoder()

function hexOf(bytes: Uint8Array): string {
    let out = ''
    for (const byte of bytes) {
        out += byte.toString(16).padStart(2, '0')
    }
    return out
}

/**
 * The key segment of a character name. Lowercase hex of the UTF-8 bytes when it
 * fits; otherwise `h` plus the SHA-256 of the UTF-8 bytes in lowercase hex. The
 * two forms cannot collide (`h` is not a hex digit), the hex form is never
 * empty, and nothing here folds case, so the segment is distinct on a
 * case-insensitive file system as well. No `crypto.subtle` is used, so it works
 * on a plain-HTTP page.
 */
export function characterKeySegment(chaId: string): string {
    const bytes = textEncoder.encode(chaId)
    if (bytes.length > 0 && bytes.length * 2 <= MAX_HEX_CHARS) {
        return hexOf(bytes)
    }
    const hash = new Sha256()
    hash.update(bytes)
    return HASHED_PREFIX + hexOf(hash.digestSync())
}

/** A generation id: twelve hex digits of the creation time in milliseconds, then eight random hex digits. Ids sort by age. */
const GENERATION_PATTERN = /^[0-9a-f]{12}-[0-9a-f]{8}$/

export function isGenerationId(value: unknown): value is string {
    return typeof value === 'string' && GENERATION_PATTERN.test(value)
}

export interface GenerationIdSource {
    now(): number
    randomBytes(length: number): Uint8Array
}

export const defaultGenerationIdSource: GenerationIdSource = {
    now: () => Date.now(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
}

export function newGenerationId(source: GenerationIdSource = defaultGenerationIdSource): string {
    const time = Math.max(0, Math.floor(source.now())).toString(16).padStart(12, '0').slice(-12)
    return `${time}-${hexOf(source.randomBytes(4))}`
}

export function generationPrefix(generation: string): string {
    return `${BLOCKS_PREFIX}${generation}/`
}

export function rootKey(generation: string): string {
    return `${generationPrefix(generation)}root`
}

export function keptKey(generation: string): string {
    return `${generationPrefix(generation)}kept`
}

export function stubsKey(generation: string): string {
    return `${generationPrefix(generation)}stubs`
}

export function fixedBlockKey(generation: string, name: string): string {
    return `${generationPrefix(generation)}f/${name}`
}

export function characterBlockKey(generation: string, chaId: string): string {
    return `${generationPrefix(generation)}c/${characterKeySegment(chaId)}`
}

/** The key under which the named block lives as its own value (not in the stubs pack). */
export function ownBlockKey(generation: string, name: string): string {
    return isFixedBlockName(name) ? fixedBlockKey(generation, name) : characterBlockKey(generation, name)
}

/** The generation a `blocks/` key belongs to, or `null` for the head and for any key that is not a generation key. */
export function generationOfKey(key: string): string | null {
    if (!key.startsWith(BLOCKS_PREFIX)) {
        return null
    }
    const slash = key.indexOf('/', BLOCKS_PREFIX.length)
    if (slash < 0) {
        return null
    }
    const candidate = key.slice(BLOCKS_PREFIX.length, slash)
    return isGenerationId(candidate) ? candidate : null
}
