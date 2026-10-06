/**
 * Synthetic `.risum` bytes and a `File` that counts every byte handed out, for the module import tests.
 * The RPack layer is the identity in these tests, so a record body is its asset bytes.
 */

const enc = new TextEncoder()

export function u32le(value: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, value, true)
    return out
}

export function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

/** An asset body of `length` bytes whose bytes depend on `seed`, so a record read from the wrong place is noticed. */
export function patterned(length: number, seed: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        out[i] = (seed * 37 + i * 11 + (i >> 8)) & 0xff
    }
    return out
}

export type RisumOptions = {
    /** the record bodies, in file order */
    records?: Uint8Array[]
    /** how many assets the module's asset list names; defaults to the number of records */
    listed?: number
    magic?: number
    version?: number
    type?: string
    /** lengths written in the record headers instead of the bodies' own lengths, by index */
    declaredLengths?: Record<number, number>
    /** leave out the terminating 0 byte */
    noTerminator?: boolean
    /** bytes written after the terminator */
    trailing?: Uint8Array
    /** extra fields of the module */
    module?: Record<string, unknown>
}

/** The asset names a fixture module lists, by index. */
export const assetName = (i: number) => `asset${i}`

export function risumBytes(opts: RisumOptions = {}): Uint8Array<ArrayBuffer> {
    const records = opts.records ?? []
    const listed = opts.listed ?? records.length
    const main = enc.encode(JSON.stringify({
        type: opts.type ?? 'risuModule',
        module: {
            name: 'Synthetic',
            description: 'd',
            id: 'x',
            ...opts.module,
            assets: Array.from({ length: listed }, (_, i) => [assetName(i), '', 'png']),
        },
    }))
    const parts: Uint8Array[] = [
        new Uint8Array([opts.magic ?? 111, opts.version ?? 0]),
        u32le(main.length),
        main,
    ]
    records.forEach((body, i) => {
        parts.push(new Uint8Array([1]), u32le(opts.declaredLengths?.[i] ?? body.length), body)
    })
    if (!opts.noTerminator) {
        parts.push(new Uint8Array([0]))
    }
    if (opts.trailing) {
        parts.push(opts.trailing)
    }
    return concatBytes(parts)
}

/**
 * A `File` that counts the bytes every read path hands out: `arrayBuffer`, `bytes`, `text`, `stream` and `slice` (whose
 * blob counts the same paths). `reads` lists each access as `kind:length`, in order. A `FileReader` over the file is
 * counted by `countFileReaderReads`.
 */
export class CountingFile extends File {
    bytesRead = 0
    reads: string[] = []

    record(kind: string, length: number) {
        this.bytesRead += length
        this.reads.push(`${kind}:${length}`)
    }

    override async arrayBuffer() {
        this.record('arrayBuffer', this.size)
        return await super.arrayBuffer()
    }

    override async bytes() {
        this.record('bytes', this.size)
        return await super.bytes()
    }

    override async text() {
        this.record('text', this.size)
        return await super.text()
    }

    override stream() {
        const reader = super.stream().getReader()
        return new ReadableStream<Uint8Array<ArrayBuffer>>({
            pull: async (controller) => {
                const next = await reader.read()
                if (next.done) {
                    controller.close()
                    return
                }
                this.record('stream', next.value.length)
                controller.enqueue(next.value)
            },
            cancel: () => reader.cancel(),
        })
    }

    override slice(start?: number, end?: number, contentType?: string): Blob {
        const blob = super.slice(start, end, contentType)
        const length = blob.size
        // Each read path the blob has is wrapped; a runtime without `bytes()` has nothing to count there.
        const reads = blob as Blob & Partial<Record<'arrayBuffer' | 'bytes' | 'text', () => Promise<unknown>>>
        for (const kind of ['arrayBuffer', 'bytes', 'text'] as const) {
            const original = reads[kind]?.bind(blob)
            if (original) {
                reads[kind] = async () => {
                    this.record(`slice.${kind}`, length)
                    return await original()
                }
            }
        }
        const stream = blob.stream.bind(blob)
        blob.stream = () => {
            this.record('slice.stream', length)
            return stream()
        }
        return blob
    }
}

/** Makes a `FileReader` over a counting file count the whole file, and returns the function that undoes it. */
export function countFileReaderReads(): () => void {
    const original = FileReader.prototype.readAsArrayBuffer
    FileReader.prototype.readAsArrayBuffer = function (this: FileReader, blob: Blob) {
        if (blob instanceof CountingFile) {
            blob.record('FileReader', blob.size)
        }
        return original.call(this, blob)
    }
    return () => {
        FileReader.prototype.readAsArrayBuffer = original
    }
}

/** What the real `selectSingleFile` does with a picked file: the whole file through a `FileReader`. */
export function readWholeThroughFileReader(file: File): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsArrayBuffer(file)
    })
}
