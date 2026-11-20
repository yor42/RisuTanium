/**
 * Opens a sealed `.rtb` and exposes its plaintext as a `RangeSource`.
 *
 * `openSealedRtb` classifies every malformed header (rows H1 to H20) before any prompt or key
 * derivation, then asks for passwords until one unwraps the master key or the prompt is
 * cancelled, checks the key commitment, and authenticates the last chunk with the last flag
 * before it reports the plaintext size. `DecryptingRangeSource` then serves authenticated
 * plaintext only: every returned byte passed GCM, and an authentication failure is remembered
 * per chunk. A chunk that failed once fails every later read that touches it, without being
 * decrypted again and even if the bytes underneath change back, while reads of other chunks keep
 * working, so one damaged chunk costs only the sections whose bytes lie in it.
 */
import { RtbCouldNotReadError, type RangeSource } from '../rangeSource'
import { selectAead, type AeadBackend, type AeadKey } from './aead'
import { RtbSealedAuthError } from './errors'
import { chunkNonce, FIXED_LEN, layoutOf, MAGIC, parseFixedPart, parseSlotTable, TAG_LEN, type FixedHeader, type Layout, type PasswordSlot, type Refusal } from './format'
import { deriveKek, type Kdf } from './kdf'
import { commitEquals, keyCommit, payloadKey } from './keys'
import { passwordBytes } from './password'
import { DEFAULT_CAPS, type SealedCaps } from './policy'

const NO_AAD = new Uint8Array(0)
/** Decrypted chunks kept: one serves a forward pass, the second a read that steps back into the chunk the last read crossed out of. */
const CACHE_CHUNKS = 2

export type AskReason = 'first' | 'wrong' | 'unusable'

export type SealedEndClass = 'damaged' | 'newer' | 'could-not-read' | 'canceled' | 'unlock-failed'

export interface OpenDeps {
    /** The password text, or `null` when the person cancelled. */
    askPassword(reason: AskReason): Promise<string | null>
    /** Runs before each key derivation, which is one synchronous call, so a wait message can paint first. */
    beforeDerive?(): Promise<void>
    kdf?: Kdf
    aead?: AeadBackend
    caps?: SealedCaps
}

export type SealedOpenResult =
    | { readonly kind: 'open', readonly source: DecryptingRangeSource }
    | { readonly kind: 'ended', readonly class: SealedEndClass, readonly detail: string }

function ended(cls: SealedEndClass, detail: string): SealedOpenResult {
    return { kind: 'ended', class: cls, detail }
}

function endedBy(refusal: Refusal): SealedOpenResult {
    return ended(refusal.kind, `${refusal.row}: ${refusal.reason}`)
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function startsWithMagic(bytes: Uint8Array): boolean {
    return bytes.length >= MAGIC.length && MAGIC.every((byte, i) => bytes[i] === byte)
}

interface SourceParts {
    readonly outer: RangeSource
    readonly headerLen: number
    readonly chunkSize: number
    readonly layout: Layout
    readonly aead: AeadBackend
    readonly key: AeadKey
}

export class DecryptingRangeSource implements RangeSource {
    readonly size: number
    /** Chunk decrypts done by reads; the open's check of the last chunk is not counted. */
    chunksDecrypted = 0
    /** Plaintext bytes of those chunks. */
    bytesDecrypted = 0
    /** The first authentication failure of any read, for a caller that maps it to "damaged". */
    authFailure: RtbSealedAuthError | null = null
    private readonly failed = new Set<number>()
    private readonly cache = new Map<number, Uint8Array>()
    private queue: Promise<unknown> = Promise.resolve()

    constructor(private readonly parts: SourceParts) {
        this.size = (parts.layout.n - 1) * parts.chunkSize + parts.layout.lastLen
    }

    read(offset: number, length: number): Promise<Uint8Array> {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
            return Promise.reject(new RtbCouldNotReadError(`invalid read of ${length} bytes at ${offset}`, offset, length))
        }
        if (offset + length > this.size) {
            return Promise.reject(new RtbCouldNotReadError(`read of ${length} bytes at ${offset} is outside the ${this.size} byte plaintext`, offset, length))
        }
        if (length === 0) {
            return Promise.resolve(new Uint8Array(0))
        }
        // One read at a time: the cache and the failure memory are shared state.
        const run = this.queue.then(() => this.readLocked(offset, length))
        this.queue = run.catch(() => undefined)
        return run
    }

    /**
     * Part of the open: authenticates one chunk and returns its plaintext, or `null` for an
     * authentication failure. The result fills the cache and is not counted and not remembered;
     * a later read that touches a bad chunk decides and remembers.
     */
    async probeChunk(index: number): Promise<Uint8Array | null> {
        const plain = await this.decryptChunk(index, false, 0, this.chunkLen(index))
        if (plain !== null) {
            this.remember(index, plain)
        }
        return plain
    }

    /** Part of the open: like `probeChunk`, but the plaintext is dropped instead of cached. */
    async peekChunk(index: number): Promise<Uint8Array | null> {
        return await this.decryptChunk(index, false, 0, this.chunkLen(index))
    }

    private chunkLen(index: number): number {
        return index === this.parts.layout.n - 1 ? this.parts.layout.lastLen : this.parts.chunkSize
    }

    private remember(index: number, plain: Uint8Array): void {
        this.cache.delete(index)
        this.cache.set(index, plain)
        while (this.cache.size > CACHE_CHUNKS) {
            const oldest = this.cache.keys().next().value
            this.cache.delete(oldest)
        }
    }

    /** Reads and opens one chunk; `null` for an authentication failure, a could-not-read error for anything else. */
    private async decryptChunk(index: number, counted: boolean, offset: number, length: number): Promise<Uint8Array | null> {
        const { outer, headerLen, chunkSize, aead, key, layout } = this.parts
        const len = this.chunkLen(index)
        const sealed = await outer.read(headerLen + index * (chunkSize + TAG_LEN), len + TAG_LEN)
        if (counted) {
            this.chunksDecrypted++
            this.bytesDecrypted += len
        }
        let plain: Uint8Array | null
        try {
            plain = await aead.open(key, chunkNonceOf(index, layout.n), sealed, NO_AAD)
        } catch (error) {
            throw new RtbCouldNotReadError(`decrypting chunk ${index} failed`, offset, length, error)
        }
        if (plain !== null && plain.length !== len) {
            throw new RtbCouldNotReadError(`chunk ${index} decrypted to ${plain.length} bytes, expected ${len}`, offset, length)
        }
        return plain
    }

    private fail(index: number, offset: number, length: number): RtbSealedAuthError {
        this.failed.add(index)
        this.cache.delete(index)
        const error = new RtbSealedAuthError(index, offset, length)
        this.authFailure ??= error
        return error
    }

    private async readLocked(offset: number, length: number): Promise<Uint8Array> {
        const { chunkSize } = this.parts
        const first = Math.floor(offset / chunkSize)
        const last = Math.floor((offset + length - 1) / chunkSize)
        let lowestFailed = -1
        for (const index of this.failed) {
            if (index >= first && index <= last && (lowestFailed < 0 || index < lowestFailed)) {
                lowestFailed = index
            }
        }
        if (lowestFailed >= 0) {
            throw new RtbSealedAuthError(lowestFailed, offset, length)
        }
        const out = new Uint8Array(length)
        for (let index = first; index <= last; index++) {
            let plain = this.cache.get(index)
            if (plain === undefined) {
                const opened = await this.decryptChunk(index, true, offset, length)
                if (opened === null) {
                    throw this.fail(index, offset, length)
                }
                plain = opened
            }
            this.remember(index, plain)
            const start = index * chunkSize
            const from = Math.max(offset, start)
            const to = Math.min(offset + length, start + this.chunkLen(index))
            out.set(plain.subarray(from - start, to - start), from - offset)
        }
        return out
    }
}

function chunkNonceOf(index: number, n: number): Uint8Array {
    return chunkNonce(index, index === n - 1)
}

type Unwrapped = { readonly kind: 'master', readonly master: Uint8Array } | { readonly kind: 'wrong' } | { readonly kind: 'failed', readonly detail: string }

async function unwrapMaster(bytes: Uint8Array, slot: PasswordSlot, kdf: Kdf, aead: AeadBackend): Promise<Unwrapped> {
    try {
        const kek = await kdf(bytes, slot.salt, { m: slot.m, t: slot.t, p: slot.p })
        try {
            const master = await aead.open(await aead.importKey(kek), slot.wrapNonce, slot.wrappedKey, slot.aad)
            return master === null ? { kind: 'wrong' } : { kind: 'master', master }
        } finally {
            kek.fill(0)
        }
    } catch (error) {
        return { kind: 'failed', detail: describe(error) }
    } finally {
        bytes.fill(0)
    }
}

async function readOuter(outer: RangeSource, offset: number, length: number): Promise<Uint8Array | SealedOpenResult> {
    try {
        return await outer.read(offset, length)
    } catch (error) {
        if (error instanceof RtbCouldNotReadError) {
            return ended('could-not-read', error.message)
        }
        throw error
    }
}

function isEnded(value: Uint8Array | SealedOpenResult): value is SealedOpenResult {
    return !(value instanceof Uint8Array)
}

/** The whole open: header rows, password loop, key commitment, last-chunk authentication. */
export async function openSealedRtb(outer: RangeSource, deps: OpenDeps): Promise<SealedOpenResult> {
    const caps = deps.caps ?? DEFAULT_CAPS
    const size = outer.size
    const prefix = await readOuter(outer, 0, Math.min(FIXED_LEN, size))
    if (isEnded(prefix)) {
        return prefix
    }
    const fixedResult = parseFixedPart(prefix, size)
    if (fixedResult.kind !== 'ok') {
        return endedBy(fixedResult)
    }
    const fixed: FixedHeader = fixedResult.value
    const rest = await readOuter(outer, FIXED_LEN, fixed.headerLen - FIXED_LEN)
    if (isEnded(rest)) {
        return rest
    }
    const slotResult = parseSlotTable(fixed, rest, caps)
    if (slotResult.kind !== 'ok') {
        return endedBy(slotResult)
    }
    const slot = slotResult.value
    const layoutResult = layoutOf(fixed, size)
    if (layoutResult.kind !== 'ok') {
        return endedBy(layoutResult)
    }
    const layout = layoutResult.value

    const aead = deps.aead ?? selectAead()
    const kdf = deps.kdf ?? deriveKek
    let reason: AskReason = 'first'
    let master: Uint8Array
    for (;;) {
        const text = await deps.askPassword(reason)
        if (text === null) {
            return ended('canceled', 'the password prompt was cancelled')
        }
        const bytes = passwordBytes(text)
        if (typeof bytes === 'string') {
            reason = 'unusable'
            continue
        }
        await deps.beforeDerive?.()
        const unwrapped = await unwrapMaster(bytes, slot, kdf, aead)
        if (unwrapped.kind === 'failed') {
            return ended('unlock-failed', unwrapped.detail)
        }
        if (unwrapped.kind === 'wrong') {
            reason = 'wrong'
            continue
        }
        master = unwrapped.master
        break
    }

    let key: AeadKey
    try {
        if (!commitEquals(keyCommit(master, fixed), fixed.keyCommit)) {
            return ended('damaged', 'K4: the key commitment does not match')
        }
        key = await aead.importKey(payloadKey(master, fixed))
    } catch (error) {
        return ended('unlock-failed', describe(error))
    } finally {
        master.fill(0)
    }

    const source = new DecryptingRangeSource({ outer, headerLen: fixed.headerLen, chunkSize: fixed.chunkSize, layout, aead, key })
    try {
        const lastPlain = await source.probeChunk(layout.n - 1)
        if (lastPlain === null) {
            return ended('damaged', 'K5: the last chunk does not authenticate')
        }
        // A sealed file inside a sealed file is never decrypted again. A chunk 0 that fails here is left for the reads to find and remember.
        const firstPlain = layout.n === 1 ? lastPlain : await source.peekChunk(0)
        if (firstPlain !== null && startsWithMagic(firstPlain)) {
            return ended('damaged', 'R4: the plaintext is itself a sealed file')
        }
    } catch (error) {
        if (error instanceof RtbCouldNotReadError) {
            return ended('could-not-read', error.message)
        }
        throw error
    }
    return { kind: 'open', source }
}
