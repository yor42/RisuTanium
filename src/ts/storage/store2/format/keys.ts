import { BLOCKS_PREFIX, PRE_BLOCKS_PREFIX } from '../../blockKeys'
import { isStore2Key, isWellFormedUtf16, STORE2_PREFIX } from '../../store/keyRules'

/**
 * Key grammar of the store2 key space. The alphabet `0-9a-v` is in ordinal
 * order equal to numeric order and lower case only, so a plain string sort of
 * the time digits is a sort by creation time and no two names differ only by
 * case on a case-folding file system.
 *
 *   store2/m-<t7><r19>                  manifest, 35 bytes
 *   store2/s-<r26>, store2/u-<r26>      shard, other unit, 35 bytes
 *   store2/g-<stg16>-<s|u><r16>         staged shard or unit, 43 bytes
 *   store2/g-<stg16>-m<t7><r9>          staged manifest, 43 bytes
 *
 * The three top-level keys are outside the prefix on purpose: a rewritten key
 * must never be retired, and the garbage collector reaches only the prefix.
 */

export const COMMIT_KEY = 'store2-commit'
export const SWEEP_KEY = 'store2-sweep'
export const FENCE_KEY = 'store2-fence'
export const TOP_LEVEL_KEYS: readonly string[] = [COMMIT_KEY, SWEEP_KEY, FENCE_KEY]

export const KEY_ALPHABET = '0123456789abcdefghijklmnopqrstuv'
/** No generated key is longer than this many UTF-8 bytes (the check-only batch budget depends on it). */
export const MAX_KEY_BYTES = 48

const TIME_DIGITS = 7
const ALPHABET_BASE = 32
/** Exclusive upper bound of the 7-digit creation time in seconds. */
const TIME_LIMIT = ALPHABET_BASE ** TIME_DIGITS

/** The randomness and the clock a key generator uses; injected so tests are deterministic. */
export interface KeyEnv {
    /** `length` random bytes, from a CSPRNG in production. */
    random: (length: number) => Uint8Array
    /** Milliseconds since the epoch. */
    now: () => number
}

export const defaultKeyEnv: KeyEnv = {
    random: (length) => crypto.getRandomValues(new Uint8Array(length)),
    now: () => Date.now(),
}

/** `count` digits taken five bits at a time from the front of `bytes`. */
export function digitsFromBytes(bytes: Uint8Array, count: number): string {
    if (bytes.length * 8 < count * 5) {
        throw new RangeError(`${count} digits need ${Math.ceil(count * 5 / 8)} random bytes.`)
    }
    let out = ''
    let accumulator = 0
    let bits = 0
    for (let i = 0; i < bytes.length && out.length < count; i++) {
        accumulator = (accumulator << 8) | bytes[i]
        bits += 8
        while (bits >= 5 && out.length < count) {
            bits -= 5
            out += KEY_ALPHABET[(accumulator >> bits) & 31]
        }
        accumulator &= (1 << bits) - 1
    }
    return out
}

/** The 26-digit epoch or id of 16 bytes: their 128 bits as one big-endian number in base 32. */
export function digits26(bytes: Uint8Array): string {
    if (bytes.length !== 16) {
        throw new RangeError('A 26-digit id is made from exactly 16 bytes.')
    }
    let value = 0n
    for (const byte of bytes) {
        value = (value << 8n) | BigInt(byte)
    }
    let out = ''
    for (let i = 0; i < 26; i++) {
        out = KEY_ALPHABET[Number(value & 31n)] + out
        value >>= 5n
    }
    return out
}

export function randomId26(env: KeyEnv = defaultKeyEnv): string {
    return digits26(env.random(16))
}

function randomDigits(env: KeyEnv, count: number): string {
    return digitsFromBytes(env.random(Math.ceil(count * 5 / 8)), count)
}

/** Whole seconds as 7 big-endian digits. */
export function timeDigits(seconds: number): string {
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds >= TIME_LIMIT) {
        throw new RangeError('The creation time must be a whole number of seconds below 32^7.')
    }
    let out = ''
    let rest = seconds
    for (let i = 0; i < TIME_DIGITS; i++) {
        out = KEY_ALPHABET[rest % ALPHABET_BASE] + out
        rest = Math.floor(rest / ALPHABET_BASE)
    }
    return out
}

function secondsOf(digits: string): number {
    let value = 0
    for (const digit of digits) {
        value = value * ALPHABET_BASE + KEY_ALPHABET.indexOf(digit)
    }
    return value
}

function nowSeconds(env: KeyEnv): number {
    return Math.floor(env.now() / 1000)
}

export function newManifestKey(env: KeyEnv = defaultKeyEnv): string {
    return `${STORE2_PREFIX}m-${timeDigits(nowSeconds(env))}${randomDigits(env, 19)}`
}

export function newShardKey(env: KeyEnv = defaultKeyEnv): string {
    return `${STORE2_PREFIX}s-${randomId26(env)}`
}

export function newUnitKey(env: KeyEnv = defaultKeyEnv): string {
    return `${STORE2_PREFIX}u-${randomId26(env)}`
}

/** A fresh 16-digit staging id. */
export function newStagingId(env: KeyEnv = defaultKeyEnv): string {
    return randomDigits(env, 16)
}

/** `staging.prefix` of a commit key: every key staged under it starts with this. */
export function stagingPrefix(stagingId: string): string {
    if (!/^[0-9a-v]{16}$/.test(stagingId)) {
        throw new RangeError('A staging id is 16 digits of 0-9a-v.')
    }
    return `${STORE2_PREFIX}g-${stagingId}-`
}

const STAGING_PREFIX_TAIL = /^g-[0-9a-v]{16}-$/

/** Whether `prefix` is exactly a `stagingPrefix` (`store2/g-<stg16>-`), the only form a commit key's `staging.prefix` may hold. */
export function isStagingPrefix(prefix: string): boolean {
    return prefix.startsWith(STORE2_PREFIX) && STAGING_PREFIX_TAIL.test(prefix.slice(STORE2_PREFIX.length))
}

export function newStagedKey(stagingId: string, kind: 's' | 'u', env: KeyEnv = defaultKeyEnv): string {
    return `${stagingPrefix(stagingId)}${kind}${randomDigits(env, 16)}`
}

export function newStagedManifestKey(stagingId: string, env: KeyEnv = defaultKeyEnv): string {
    return `${stagingPrefix(stagingId)}m${timeDigits(nowSeconds(env))}${randomDigits(env, 9)}`
}

/** The key without `store2/`, the form a Ref carries. */
export function tailOfKey(key: string): string {
    if (!isStore2Key(key)) {
        throw new RangeError('Not a store2 key.')
    }
    return key.slice(STORE2_PREFIX.length)
}

export function keyOfTail(tail: string): string {
    return STORE2_PREFIX + tail
}

export type Store2KeyShape =
    | { shape: 'manifest', key: string, seconds: number }
    | { shape: 'shard', key: string }
    | { shape: 'unit', key: string }
    | { shape: 'staged-unit', key: string, stagingId: string, kind: 's' | 'u' }
    | { shape: 'staged-manifest', key: string, stagingId: string, seconds: number }

const MANIFEST_TAIL = /^m-([0-9a-v]{7})[0-9a-v]{19}$/
const SHARD_TAIL = /^s-[0-9a-v]{26}$/
const UNIT_TAIL = /^u-[0-9a-v]{26}$/
const STAGED_UNIT_TAIL = /^g-([0-9a-v]{16})-([su])[0-9a-v]{16}$/
const STAGED_MANIFEST_TAIL = /^g-([0-9a-v]{16})-m([0-9a-v]{7})[0-9a-v]{9}$/

/** Classifies a key by its form alone, or null when it matches no generated shape. */
export function parseStore2Key(key: string): Store2KeyShape | null {
    if (!key.startsWith(STORE2_PREFIX)) {
        return null
    }
    const tail = key.slice(STORE2_PREFIX.length)
    let match = MANIFEST_TAIL.exec(tail)
    if (match) {
        return { shape: 'manifest', key, seconds: secondsOf(match[1]) }
    }
    if (SHARD_TAIL.test(tail)) {
        return { shape: 'shard', key }
    }
    if (UNIT_TAIL.test(tail)) {
        return { shape: 'unit', key }
    }
    match = STAGED_UNIT_TAIL.exec(tail)
    if (match) {
        return { shape: 'staged-unit', key, stagingId: match[1], kind: match[2] as 's' | 'u' }
    }
    match = STAGED_MANIFEST_TAIL.exec(tail)
    if (match) {
        return { shape: 'staged-manifest', key, stagingId: match[1], seconds: secondsOf(match[2]) }
    }
    return null
}

/**
 * Where the page keeps old cold-storage units. `process/coldUnitLocation.ts` names the same prefix; it is not imported
 * here because that module reads the platform.
 */
const OLD_COLD_PREFIX = 'coldstorage/'

function hasControlCharacter(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) < 0x20) {
            return true
        }
    }
    return false
}

/**
 * Whether `key` may be listed in a deletion snapshot and deleted from one: a fork-format key under `blocks/` or
 * `coldstorage/`, or a `database/database.pre-blocks*` file, spelled as a plain relative path. Everything else is out:
 * the store2 key space and its top-level keys, `assets/`, `inlays/`, `remotes/`, the upstream main file and the numbered
 * backups. A path with an empty, `.` or `..` segment, a backslash or a control character is out, so no spelling can
 * reach another key. The Node and IndexedDB stores refuse no such delete themselves, so this is the one defence.
 */
export function isOldDataKey(key: string): boolean {
    if (typeof key !== 'string' || key.length === 0 || key.includes('\\') || hasControlCharacter(key) || !isWellFormedUtf16(key)) {
        return false
    }
    for (const segment of key.split('/')) {
        if (segment === '' || segment === '.' || segment === '..') {
            return false
        }
    }
    return key.startsWith(BLOCKS_PREFIX) || key.startsWith(OLD_COLD_PREFIX) || key.startsWith(PRE_BLOCKS_PREFIX)
}

/**
 * Whether `key` may be the unit a snapshot pointer names: an ordinary unit key or a staged unit key, never a manifest,
 * a shard or a key outside the generated shapes.
 */
export function isSnapshotUnitKey(key: string): boolean {
    const shape = parseStore2Key(key)
    return shape !== null && (shape.shape === 'unit' || shape.shape === 'staged-unit')
}

/**
 * Whether the recovery screen may offer `key`: an ordinary manifest or a staged
 * manifest, recognised by form without reading a body, and not under the standing
 * `staging.prefix` of the parsed commit key (an unfinished stage is not a
 * candidate). With no parsed commit key pass `null`: every staged manifest is a
 * candidate and the tree read validates the pick.
 */
export function isRecoveryCandidateKey(key: string, standingPrefix: string | null): boolean {
    const shape = parseStore2Key(key)
    if (shape === null || (shape.shape !== 'manifest' && shape.shape !== 'staged-manifest')) {
        return false
    }
    return standingPrefix === null || !key.startsWith(standingPrefix)
}

/** The recovery candidates among `keys`, newest first by the time digits of either shape (ties by key, descending). */
export function orderRecoveryCandidates(keys: readonly string[], standingPrefix: string | null): string[] {
    const candidates: { key: string, seconds: number }[] = []
    for (const key of keys) {
        if (!isRecoveryCandidateKey(key, standingPrefix)) {
            continue
        }
        const shape = parseStore2Key(key)
        if (shape !== null && (shape.shape === 'manifest' || shape.shape === 'staged-manifest')) {
            candidates.push({ key, seconds: shape.seconds })
        }
    }
    candidates.sort((a, b) => b.seconds - a.seconds || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
    return candidates.map(candidate => candidate.key)
}
