/**
 * A `ZipSink` that gathers the writer's many small chunks (headers, descriptors, central
 * records, small deflated bodies) into blocks of up to one MiB before they reach the target,
 * so a file of hundreds of thousands of entries does not mean hundreds of thousands of
 * stream writes.
 *
 * A chunk below the block size is copied into the sink's own buffer when it is accepted and
 * is never held by reference, because the writer may reuse its buffers after `write`
 * resolves. A chunk of the block size or more passes through after the held bytes. Nothing
 * reaches the target after the last `write` until `flush()`; the caller flushes once, after
 * the writer finished and before it closes the target, and never after a cancel or a failure.
 */
import type { ZipSink } from './zip64Writer'

export const COALESCE_BYTES = 1024 * 1024

export class CoalescingSink implements ZipSink {
    private readonly buffer: Uint8Array
    private held = 0

    constructor(
        private readonly target: (chunk: Uint8Array) => Promise<void> | void,
        private readonly limit: number = COALESCE_BYTES,
    ) {
        this.buffer = new Uint8Array(limit)
    }

    /** Bytes accepted and not yet passed on; never more than the block size. */
    get heldBytes(): number {
        return this.held
    }

    async write(chunk: Uint8Array): Promise<void> {
        if (chunk.length >= this.limit) {
            await this.flush()
            await this.target(chunk)
            return
        }
        if (this.held + chunk.length > this.limit) {
            await this.flush()
        }
        this.buffer.set(chunk, this.held)
        this.held += chunk.length
    }

    async flush(): Promise<void> {
        if (this.held === 0) {
            return
        }
        const block = this.buffer.slice(0, this.held)
        this.held = 0
        await this.target(block)
    }
}
