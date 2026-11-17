/**
 * A bounded line splitter for the body of a side section, fed chunk by chunk by the
 * entry reader. It splits on the byte 0x0A, decodes each line with the fatal UTF-8
 * decoder, drops a trailing CR, skips blank lines and decodes the rest with
 * `decodeSideLine`.
 *
 * Line numbers count every physical line, blank ones included, starting at 1. The
 * lines it returns are the non-blank ones; that count is what the two restore passes
 * compare, so a trailing blank line never reads as an extra line.
 *
 * A line longer than the cap is returned damaged under its number and the splitter
 * stops: it buffers nothing more and returns nothing more, so it never holds more than
 * the cap plus one chunk. `stopped` tells the caller to abort the entry read.
 */
import { decodeSideLine, SIDE_LINE_MAX_BYTES, type SideLine, type SideTagRegistry } from './sideLines'

export interface NumberedSideLine {
    line: number
    decoded: SideLine
}

const strictDecoder = new TextDecoder('utf-8', { fatal: true })
const NEWLINE = 0x0a
const CARRIAGE_RETURN = 0x0d

export class SideLineSplitter {
    private readonly registry: SideTagRegistry
    private readonly maxLineBytes: number
    private pending: Uint8Array[] = []
    private pendingBytes = 0
    private lineNumber = 1
    private halted = false

    constructor(registry: SideTagRegistry, options?: { maxLineBytes?: number }) {
        this.registry = registry
        this.maxLineBytes = options?.maxLineBytes ?? SIDE_LINE_MAX_BYTES
    }

    /** True once a line went over the cap; nothing more is buffered or returned. */
    get stopped(): boolean {
        return this.halted
    }

    /** Bytes held for the line in progress. */
    get bufferedBytes(): number {
        return this.pendingBytes
    }

    push(chunk: Uint8Array): NumberedSideLine[] {
        const out: NumberedSideLine[] = []
        let from = 0
        while (!this.halted && from < chunk.length) {
            const newline = chunk.indexOf(NEWLINE, from)
            const end = newline < 0 ? chunk.length : newline
            const room = this.maxLineBytes - this.pendingBytes
            if (end - from > room) {
                this.overflow(out)
                break
            }
            if (newline < 0) {
                // Copied: the caller may reuse its chunk once the sink returns.
                this.pending.push(chunk.slice(from, end))
                this.pendingBytes += end - from
                break
            }
            this.finishLine(chunk.subarray(from, end), out)
            from = newline + 1
        }
        return out
    }

    /** The last line, when the body does not end with a newline. */
    end(): NumberedSideLine[] {
        const out: NumberedSideLine[] = []
        if (!this.halted && this.pendingBytes > 0) {
            this.finishLine(new Uint8Array(0), out)
        }
        return out
    }

    private overflow(out: NumberedSideLine[]): void {
        out.push({
            line: this.lineNumber,
            decoded: { kind: 'damaged', reason: `the line is longer than ${this.maxLineBytes} bytes` },
        })
        this.halted = true
        this.pending = []
        this.pendingBytes = 0
    }

    private finishLine(tail: Uint8Array, out: NumberedSideLine[]): void {
        let bytes: Uint8Array
        if (this.pending.length === 0) {
            bytes = tail
        } else {
            bytes = new Uint8Array(this.pendingBytes + tail.length)
            let at = 0
            for (const part of this.pending) {
                bytes.set(part, at)
                at += part.length
            }
            bytes.set(tail, at)
        }
        this.pending = []
        this.pendingBytes = 0
        const line = this.lineNumber
        this.lineNumber++
        if (bytes.length > 0 && bytes[bytes.length - 1] === CARRIAGE_RETURN) {
            bytes = bytes.subarray(0, bytes.length - 1)
        }
        if (bytes.length === 0) {
            return
        }
        let text: string
        try {
            text = strictDecoder.decode(bytes)
        } catch {
            out.push({ line, decoded: { kind: 'damaged', reason: 'the line is not UTF-8 text' } })
            return
        }
        out.push({ line, decoded: decodeSideLine(text, this.registry) })
    }
}
