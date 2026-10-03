/**
 * Test-only: an in-memory OPFS root with the file API shapes `OpfsStorage`
 * uses (`getFileHandle`, `removeEntry`, `values`). Files are held by name, and
 * `OpfsStorage` names a key's file by the hex of the key. Hand it to
 * `OpfsStorage` through its `opfs` field.
 */

export function hexName(key: string): string {
    return Buffer.from(key, 'utf-8').toString('hex')
}

export class FakeOpfsRoot {
    files = new Map<string, Uint8Array>()
    /** Every call the root received. */
    calls = 0
    /** Names whose removal fails. */
    failRemoval = new Set<string>()

    async getFileHandle(name: string, options?: { create?: boolean }) {
        this.calls++
        const files = this.files
        if (options?.create) {
            return {
                async createWritable() {
                    return {
                        async write(data: Uint8Array) { files.set(name, data.slice()) },
                        async close() { },
                        async abort() { },
                    }
                },
            }
        }
        if (!files.has(name)) {
            throw new DOMException(`not found: ${name}`, 'NotFoundError')
        }
        return {
            async getFile() {
                return { async arrayBuffer() { return (files.get(name) as Uint8Array).slice().buffer } }
            },
        }
    }

    async removeEntry(name: string) {
        this.calls++
        if (this.failRemoval.has(name)) {
            throw new Error(`removal refused: ${name}`)
        }
        if (!this.files.has(name)) {
            throw new DOMException(`not found: ${name}`, 'NotFoundError')
        }
        this.files.delete(name)
    }

    async *values() {
        this.calls++
        for (const name of this.files.keys()) {
            yield { name }
        }
    }
}
