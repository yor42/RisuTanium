/**
 * An in-memory stand-in for the three Android transport commands (`write_chunk`,
 * `abort_chunked`, `read_range` in `src-tauri/src/chunked_io.rs`), working on the
 * files of a `createFakeTauriFs` instance. It follows the Rust commands where
 * the page depends on them:
 *
 * - `write_chunk` refuses a key with an empty segment or a segment starting with
 *   `.` (so a `./` prefix fails loudly) and an id that is not 16 lowercase hex
 *   digits. Chunk 0 creates the directories and the temp file
 *   `<directory>/risu-write-<id>.tmp`, and rejects when that temp exists
 *   without removing it. Any other chunk must start at the temp's length. A
 *   failure after the temp was created removes it. The last chunk renames the
 *   temp over the key. A last chunk with `finalKey` (same folder as the key)
 *   renames the temp to `finalKey` instead, never creates the key, and removes
 *   the temp and succeeds when `finalKey` already holds a file; a `finalKey`
 *   on another chunk or in another folder fails and removes the temp.
 * - `abort_chunked` removes the temp and accepts a missing one.
 * - `read_range` answers the piece followed by the 56-byte trailer (size, then
 *   six identity words, little-endian u64) as an `ArrayBuffer`, and rejects a
 *   missing file with a message that ends in `(os error 2)`.
 *
 * A file's identity is the identity of the array that holds it in the fake, so
 * replacing a file (a `files.set`) changes it and reading it does not.
 */
import type { FakeTauriFs } from './tauriFsFake'

export interface ChunkCall {
    command: string
    args: Record<string, unknown>
}

export interface ChunkFault {
    /** Applies to the `write_chunk` call that this returns an error for. */
    (call: { key: string, offset: number, last: boolean, index: number }): string | undefined
}

export interface RangeHooks {
    /** Runs before each `read_range` is answered, with the 0-based index of the call since the last reset. */
    before?: (call: { key: string, offset: number, len: number, index: number }) => void
    /** Caps the bytes of a piece; `undefined` leaves it as asked. */
    limit?: (call: { key: string, offset: number, len: number, index: number }) => number | undefined
}

export const TRAILER_BYTES = 56
const WRITE_ID = /^[0-9a-f]{16}$/

export function createChunkedInvoke(fs: FakeTauriFs) {
    const calls: ChunkCall[] = []
    /** The decoded size of every `write_chunk` payload, in order. */
    const chunkSizes: number[] = []
    let rangeCalls = 0
    let writeFault: ChunkFault | undefined
    let abortFault: string | undefined
    const hooks: RangeHooks = {}
    const ids = new WeakMap<Uint8Array, number>()
    let nextId = 1

    function identityOf(file: Uint8Array): number {
        let id = ids.get(file)
        if (id === undefined) {
            id = nextId++
            ids.set(file, id)
        }
        return id
    }

    function parentOf(key: string): string {
        const slash = key.lastIndexOf('/')
        return slash < 0 ? '' : key.slice(0, slash)
    }

    function stringArg(args: Record<string, unknown>, name: string): string {
        const value = args[name]
        if (typeof value !== 'string') {
            throw new Error(`${name} must be a string`)
        }
        return value
    }

    function numberArg(args: Record<string, unknown>, name: string): number {
        const value = args[name]
        if (typeof value !== 'number') {
            throw new Error(`${name} must be a number`)
        }
        return value
    }

    function checkKey(key: string): void {
        if (key.split('/').some((segment) => segment === '' || segment.startsWith('.'))) {
            throw `refused key: a key has no empty segment and no segment starting with .`
        }
    }

    function tempPath(key: string, id: string): string {
        if (!WRITE_ID.test(id)) {
            throw 'refused write id: 16 lowercase hex digits'
        }
        const directory = parentOf(key)
        const name = `risu-write-${id}.tmp`
        return directory === '' ? name : `${directory}/${name}`
    }

    function writeChunk(args: Record<string, unknown>): void {
        const key = stringArg(args, 'key')
        const id = stringArg(args, 'id')
        const offset = numberArg(args, 'offset')
        const data = stringArg(args, 'data')
        const last = args.last === true
        const finalKey = typeof args.finalKey === 'string' ? args.finalKey : undefined
        checkKey(key)
        const temp = tempPath(key, id)
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
        chunkSizes.push(bytes.length)
        const fault = writeFault?.({ key, offset, last, index: calls.length - 1 })
        if (offset === 0) {
            for (let directory = parentOf(key); directory !== ''; directory = parentOf(directory)) {
                fs.directories.add(directory)
            }
            if (fault !== undefined) {
                throw fault
            }
            if (fs.files.has(temp)) {
                throw `failed to create ${temp}: File exists (os error 17)`
            }
            fs.files.set(temp, new Uint8Array(0))
        }
        const held = fs.files.get(temp)
        if (held === undefined || held.length !== offset || fault !== undefined) {
            fs.files.delete(temp)
            throw fault ?? `failed to write ${temp}: the chunk starts at ${offset} but the temp file holds ${held?.length ?? 0} bytes`
        }
        const next = new Uint8Array(held.length + bytes.length)
        next.set(held, 0)
        next.set(bytes, held.length)
        fs.files.set(temp, next)
        if (finalKey !== undefined) {
            checkKey(finalKey)
            if (!last || parentOf(finalKey) !== parentOf(key)) {
                fs.files.delete(temp)
                throw `refused final key: ${finalKey} is not on the last chunk or not in the folder of ${key}`
            }
        }
        if (last) {
            const destination = finalKey ?? key
            if (finalKey !== undefined && fs.files.has(finalKey)) {
                fs.files.delete(temp)
                return
            }
            if (finalKey !== undefined && fs.directories.has(destination)) {
                fs.files.delete(temp)
                throw `failed to rename ${temp} to ${destination}: Is a directory (os error 21)`
            }
            fs.files.set(destination, next)
            fs.files.delete(temp)
        }
    }

    function abortChunked(args: Record<string, unknown>): void {
        const key = stringArg(args, 'key')
        checkKey(key)
        if (abortFault !== undefined) {
            throw abortFault
        }
        fs.files.delete(tempPath(key, stringArg(args, 'id')))
    }

    function readRange(args: Record<string, unknown>): ArrayBuffer {
        const key = stringArg(args, 'key')
        const offset = numberArg(args, 'offset')
        const len = numberArg(args, 'len')
        const index = rangeCalls++
        hooks.before?.({ key, offset, len, index })
        const link = fs.symlinks.get(key)
        const file = link?.kind === 'file' ? link.data : fs.files.get(key)
        if (file === undefined) {
            if (fs.directories.has(key)) {
                throw `failed to read ${key}: Is a directory (os error 21)`
            }
            throw `failed to open ${key}: No such file or directory (os error 2)`
        }
        const cap = hooks.limit?.({ key, offset, len, index })
        const want = Math.min(len, cap ?? len, Math.max(0, file.length - offset))
        const out = new Uint8Array(want + TRAILER_BYTES)
        out.set(file.subarray(offset, offset + want), 0)
        const words = new DataView(out.buffer, want, TRAILER_BYTES)
        words.setBigUint64(0, BigInt(file.length), true)
        words.setBigUint64(8, 1n, true)
        words.setBigUint64(16, BigInt(identityOf(file)), true)
        return out.buffer
    }

    async function invoke(command: string, args?: unknown): Promise<unknown> {
        const named = (args ?? {}) as Record<string, unknown>
        calls.push({ command, args: named })
        switch (command) {
            case 'write_chunk':
                return writeChunk(named)
            case 'abort_chunked':
                return abortChunked(named)
            case 'read_range':
                return readRange(named)
            default:
                return undefined
        }
    }

    return {
        invoke,
        calls,
        chunkSizes,
        hooks,
        /** The calls of one command, in order. */
        callsOf(command: string): ChunkCall[] {
            return calls.filter((call) => call.command === command)
        },
        /** Every `write_chunk` for which `fault` returns a message rejects with it, the way a failed step does. */
        failWrites(fault: ChunkFault | undefined): void {
            writeFault = fault
        },
        failAborts(error: string | undefined): void {
            abortFault = error
        },
        reset(): void {
            calls.length = 0
            chunkSizes.length = 0
            rangeCalls = 0
            writeFault = undefined
            abortFault = undefined
            hooks.before = undefined
            hooks.limit = undefined
        },
    }
}

export type ChunkedInvokeFake = ReturnType<typeof createChunkedInvoke>
