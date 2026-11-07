/**
 * Test sink for the `.rtb` container writer that never holds a fill run in memory.
 *
 * A `write` becomes a data run (the bytes are copied, so the writer may reuse its
 * buffers) and a `writeFill` becomes a fill run, so a file past 4 GiB is a few
 * runs. The sink also reads byte ranges back, which lets the independent parser
 * walk such a file.
 */

export type SegmentRun =
    | { kind: 'data', bytes: Uint8Array }
    | { kind: 'fill', length: number, byte: number }

export interface SegmentSinkOptions {
    /** When false the sink has no `writeFill`, so the writer must expand a fill piece itself. */
    fills?: boolean
}

export class SegmentSink {
    readonly runs: SegmentRun[] = []
    private readonly starts: number[] = []
    length = 0
    writeFill?: (length: number, byte: number) => void

    constructor(options: SegmentSinkOptions = {}) {
        if (options.fills !== false) {
            this.writeFill = (length: number, byte: number) => {
                this.push({ kind: 'fill', length, byte }, length)
            }
        }
    }

    write(chunk: Uint8Array): void {
        this.push({ kind: 'data', bytes: chunk.slice() }, chunk.length)
    }

    private push(run: SegmentRun, length: number): void {
        if (length === 0) {
            return
        }
        this.starts.push(this.length)
        this.runs.push(run)
        this.length += length
    }

    /** Run index holding `offset`, by binary search over the run start offsets. */
    private runAt(offset: number): number {
        let low = 0
        let high = this.starts.length - 1
        while (low < high) {
            const mid = (low + high + 1) >> 1
            if (this.starts[mid] <= offset) {
                low = mid
            } else {
                high = mid - 1
            }
        }
        return low
    }

    read(offset: number, length: number): Uint8Array {
        if (offset < 0 || length < 0 || offset + length > this.length) {
            throw new RangeError('read outside the sink')
        }
        const out = new Uint8Array(length)
        let done = 0
        let index = length === 0 ? 0 : this.runAt(offset)
        while (done < length) {
            const run = this.runs[index]
            const runStart = this.starts[index]
            const within = offset + done - runStart
            const runLength = run.kind === 'data' ? run.bytes.length : run.length
            const take = Math.min(length - done, runLength - within)
            if (run.kind === 'data') {
                out.set(run.bytes.subarray(within, within + take), done)
            } else {
                out.fill(run.byte, done, done + take)
            }
            done += take
            index++
        }
        return out
    }

    /** Whole file; only for sinks known to be small. */
    toBytes(): Uint8Array {
        return this.read(0, this.length)
    }

    /** Adjacent data runs merged into one; fill runs kept. */
    canonicalRuns(): SegmentRun[] {
        const merged: SegmentRun[] = []
        let pending: Uint8Array[] = []
        const flush = () => {
            if (pending.length === 0) {
                return
            }
            const total = pending.reduce((sum, part) => sum + part.length, 0)
            const bytes = new Uint8Array(total)
            let at = 0
            for (const part of pending) {
                bytes.set(part, at)
                at += part.length
            }
            merged.push({ kind: 'data', bytes })
            pending = []
        }
        for (const run of this.runs) {
            if (run.kind === 'data') {
                pending.push(run.bytes)
            } else {
                flush()
                merged.push(run)
            }
        }
        flush()
        return merged
    }
}
