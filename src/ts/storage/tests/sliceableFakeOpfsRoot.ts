/**
 * Test-only: an in-memory OPFS root whose files are lazy Blobs, as a real OPFS
 * `File` is. `getFile()` returns a Blob that
 * - reports the stored length as `size`, or a declared size (`declareSize`) so
 *   an over-limit file never has to be materialised;
 * - slices for real, and a slice reads only its own bytes;
 * - counts whole `arrayBuffer()` reads (`wholeReads`);
 * - rejects every read with `NotReadableError` once the stored value was
 *   removed or replaced after `getFile()`, as a real stale `File` does.
 * Everything else is the base fake. A pass here is no evidence about a real
 * browser's OPFS.
 */
import { FakeOpfsRoot, hexName } from './fakeOpfsRoot'

class OpfsFileBlob extends Blob {
    readonly lastModified: number

    constructor(
        private readonly root: SliceableFakeOpfsRoot,
        private readonly name: string,
        private readonly source: Uint8Array,
        private readonly content: Uint8Array,
        private readonly declared: number | null,
        private readonly whole: boolean,
    ) {
        super([content as BlobPart])
        this.lastModified = root.modified.get(name) ?? 0
    }

    get size(): number {
        return this.declared ?? this.content.byteLength
    }

    slice(start?: number, end?: number): Blob {
        return new OpfsFileBlob(this.root, this.name, this.source, this.content.slice(start ?? 0, end ?? this.content.byteLength), null, false)
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
        if (this.root.files.get(this.name) !== this.source) {
            throw new DOMException('the file changed after it was read', 'NotReadableError')
        }
        if (this.whole) {
            this.root.wholeReads++
        }
        return this.content.slice().buffer as ArrayBuffer
    }
}

export class SliceableFakeOpfsRoot extends FakeOpfsRoot {
    /** Whole `arrayBuffer()` reads of a file; a slice read is not counted. */
    wholeReads = 0
    /** When set, a read-only lookup of a file handle throws it, as a real root does for a refusal other than a missing name. */
    lookupError: DOMException | null = null
    private declaredSizes = new Map<string, number>()

    /** Makes the file of `key` report `size` bytes while holding its real, shorter content. */
    declareSize(key: string, size: number): void {
        this.declaredSizes.set(hexName(key), size)
    }

    async getFileHandle(name: string, options?: { create?: boolean }) {
        if (this.lookupError !== null && !options?.create) {
            throw this.lookupError
        }
        const handle = await super.getFileHandle(name, options)
        if (options?.create) {
            return handle
        }
        return {
            getFile: async () => {
                const source = this.files.get(name) as Uint8Array
                return new OpfsFileBlob(this, name, source, source, this.declaredSizes.get(name) ?? null, true)
            },
        }
    }
}
