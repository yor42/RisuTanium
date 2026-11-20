/**
 * A `ZipSink` that seals the plaintext `.rtb` into the chunks of the sealed envelope and passes
 * header and chunks to a target.
 *
 * The sink holds one buffer of exactly one chunk and copies every input into it, never keeping a
 * caller's buffer by reference (the writer may reuse its buffers once `write` resolves). A full
 * buffer is sealed only when at least one more byte arrives or at `finish()`, so the last chunk is
 * never empty unless the whole plaintext is empty. A file is complete only after `finish()` has
 * written the chunk with the last flag; a cancelled or failed export never calls it, and every
 * reader refuses the truncated result. After any failure the sink poisons itself.
 */
import type { ZipSink } from '../zip64Writer'
import type { AeadBackend, AeadKey } from './aead'
import { chunkNonce } from './format'

const NO_AAD = new Uint8Array(0)

/** Everything the sink needs from `prepareSeal`. */
export interface SealContext {
    readonly header: Uint8Array
    readonly chunkSize: number
    readonly aead: AeadBackend
    readonly payloadKey: AeadKey
}

export class EncryptingSink implements ZipSink {
    private readonly buffer: Uint8Array
    private held = 0
    private index = 0
    private headerSent = false
    private busy = false
    private finished = false
    private poisoned = false
    private written = 0

    constructor(
        private readonly context: SealContext,
        private readonly target: (chunk: Uint8Array) => Promise<void> | void,
    ) {
        this.buffer = new Uint8Array(context.chunkSize)
    }

    /** Bytes passed to the target so far: the header and every sealed chunk. */
    get bytesWritten(): number {
        return this.written
    }

    async write(chunk: Uint8Array): Promise<void> {
        this.enter()
        try {
            if (chunk.length > 0) {
                await this.sendHeader()
            }
            let at = 0
            while (at < chunk.length) {
                if (this.held === this.context.chunkSize) {
                    await this.sealHeld(false)
                }
                const take = Math.min(this.context.chunkSize - this.held, chunk.length - at)
                this.buffer.set(chunk.subarray(at, at + take), this.held)
                this.held += take
                at += take
            }
        } catch (error) {
            this.poisoned = true
            this.wipe()
            throw error
        } finally {
            this.busy = false
        }
    }

    /** Seals what is held (empty only if nothing was written) with the last flag and writes it. Call once. */
    async finish(): Promise<void> {
        this.enter()
        this.finished = true
        try {
            await this.sendHeader()
            await this.sealHeld(true)
        } catch (error) {
            this.poisoned = true
            throw error
        } finally {
            this.wipe()
            this.busy = false
        }
    }

    /** Zeroes the held plaintext and, for a backend whose key is a plain byte array, the key; a WebCrypto key is non-extractable and has nothing to wipe. */
    private wipe(): void {
        this.buffer.fill(0)
        if (ArrayBuffer.isView(this.context.payloadKey)) {
            this.context.payloadKey.fill(0)
        }
    }

    private enter(): void {
        if (this.poisoned) {
            throw new Error('the encrypting sink failed earlier')
        }
        if (this.finished) {
            throw new Error('the encrypting sink is finished')
        }
        if (this.busy) {
            this.poisoned = true
            this.wipe()
            throw new Error('the encrypting sink does not accept overlapping calls')
        }
        this.busy = true
    }

    private async sendHeader(): Promise<void> {
        if (this.headerSent) {
            return
        }
        this.headerSent = true
        await this.emit(new Uint8Array(this.context.header))
    }

    private async sealHeld(last: boolean): Promise<void> {
        const sealed = await this.context.aead.seal(
            this.context.payloadKey,
            chunkNonce(this.index, last),
            this.buffer.subarray(0, this.held),
            NO_AAD,
        )
        this.index++
        this.held = 0
        await this.emit(sealed)
    }

    private async emit(bytes: Uint8Array): Promise<void> {
        this.written += bytes.length
        await this.target(bytes)
    }
}
