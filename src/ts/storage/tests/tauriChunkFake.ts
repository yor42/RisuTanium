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
 *   By default `write_chunk` answers nothing, the shape of a command that
 *   reports no flush status. After `reportFlushes()` it answers
 *   `{ flushed: boolean }` as the Rust command does: `true`, `false` where
 *   `failFlushes` says a directory flush failed, and `false` on the last chunk
 *   that kept an existing `finalKey`.
 * - `abort_chunked` removes the temp and accepts a missing one.
 * - The page-generation gate (`store2_gate.rs`): `store2_register_page` issues the
 *   next generation, starting at 1. `store2_write_top_chunk` is `write_chunk`
 *   without a final key, for `store2-commit` and `store2-fence` only (any other key
 *   is refused with `gate-key-refused:`), plus `gen`: chunk 0 and a non-final chunk
 *   refuse a generation that is not the current one (0 never is) with
 *   `stale-generation:`, and only the last chunk decides, removing its temp when
 *   refused. `store2_remove` checks the kinds, refuses a stale generation before any
 *   removal and answers one `{ key, outcome, error? }` entry per key. These always
 *   answer, whatever `reportFlushes` says.
 * - `read_range` answers the piece followed by the 56-byte trailer (size, then
 *   six identity words, little-endian u64) as an `ArrayBuffer`, and rejects a
 *   missing file with a message that ends in `(os error 2)`.
 *
 * `app_fs_exists`, `app_fs_mkdir_all`, `app_fs_remove` and `app_data_dir_path`
 * mirror `src-tauri/src/app_fs.rs`: the key rule of `appFsKey`, a missing path
 * rejects with a message that ends in `(os error 2)`, an empty directory is
 * removable and a full one is not, and a refusal starts with `refused key:`.
 * They act on the fake's files, so its fault injection (`failRemoves`) and call
 * logs apply to them.
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

export interface FlushCall {
    key: string
    offset: number
    last: boolean
    durable: boolean
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
    let reporting = false
    let flushFault: ((call: FlushCall) => boolean) | undefined
    /** The gate's current generation; 0 until a page registers, and each registration issues the next one. */
    let generation = 0
    let registrationFault: string | undefined
    /** The decoded size of every `store2_write_top_chunk` payload, in order. */
    const topChunkSizes: number[] = []
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

    /** Whether every flush of the call succeeded, as the Rust command computes it: `false` for a kept existing `finalKey`. */
    function writeChunk(args: Record<string, unknown>): boolean {
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
        const flushed = flushFault?.({ key, offset, last, durable: args.durable === true }) !== true
        if (last) {
            const destination = finalKey ?? key
            if (finalKey !== undefined && fs.files.has(finalKey)) {
                fs.files.delete(temp)
                return false
            }
            if (finalKey !== undefined && fs.directories.has(destination)) {
                fs.files.delete(temp)
                throw `failed to rename ${temp} to ${destination}: Is a directory (os error 21)`
            }
            fs.files.set(destination, next)
            fs.files.delete(temp)
        }
        return flushed
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

    /**
     * The key rule of `app_fs.rs` (`resolve_addressable`): non-empty unless the
     * root is allowed, no NUL, not absolute, no drive prefix, no empty, `.` or
     * `..` segment. It leaves out the extra refusal of `:` and `\` that the Rust
     * rule has on Windows, as `read_range` here does; the store's own key rule
     * refuses those first. A refusal is a string that starts with
     * `refused key:` and happens before any file is touched.
     */
    function appFsKey(args: Record<string, unknown>, allowRoot: boolean): string {
        const key = stringArg(args, 'key')
        if (key === '' && allowRoot) {
            return key
        }
        const refused = key === ''
            || key.includes('\0')
            || key.startsWith('/')
            || key.startsWith('\\')
            || /^[A-Za-z]:/.test(key)
            || key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
        if (refused) {
            throw `refused key: ${JSON.stringify(key)} is not an addressable key`
        }
        return key
    }

    /** `app_fs_exists`, `app_fs_mkdir_all`, `app_fs_remove` and `app_data_dir_path`, over the same files; see `app_fs.rs` for the rules they mirror. */
    async function appFsCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
        const fsModule = fs.module as {
            exists(path: string): Promise<boolean>
            mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
            remove(path: string): Promise<void>
        }
        switch (command) {
            case 'app_fs_exists': {
                const key = appFsKey(args, true)
                return await fsModule.exists(key)
            }
            case 'app_fs_mkdir_all': {
                const key = appFsKey(args, true)
                await fsModule.mkdir(key, { recursive: true })
                return undefined
            }
            case 'app_fs_remove':
                await fsModule.remove(appFsKey(args, false))
                return undefined
            default:
                return fs.getAppDataRoot() ?? '/appdata'
        }
    }

    const STALE_REFUSAL = 'stale-generation: this page\'s generation is not the current one; nothing was applied'

    /** The gate's rule: generation 0 (never registered) is always refused, and anything but the current one. */
    function isCurrent(gen: number): boolean {
        return gen !== 0 && gen === generation
    }

    function requireTopKey(key: string): void {
        if (key !== 'store2-commit' && key !== 'store2-fence') {
            throw 'gate-key-refused: only store2-commit and store2-fence are written through the gate'
        }
    }

    function requireRemoveKey(key: string): void {
        if (key !== 'store2-fence' && !(key.startsWith('store2/') && key.length > 'store2/'.length)) {
            throw 'gate-key-refused: only store2/ keys and store2-fence are removed through the gate'
        }
    }

    /**
     * `store2_write_top_chunk`: the chunk protocol of `write_chunk` without a final key, plus the generation.
     * Chunk 0 and a non-final chunk check it early (chunk 0 before it creates the temp, a later chunk removing its
     * own temp); only the last chunk decides, and a refused one removes its temp and leaves the key as it was.
     * Always answers whether every flush succeeded.
     */
    function writeTopChunk(args: Record<string, unknown>): boolean {
        const key = stringArg(args, 'key')
        const gen = numberArg(args, 'gen')
        const id = stringArg(args, 'id')
        const offset = numberArg(args, 'offset')
        const data = stringArg(args, 'data')
        const last = args.last === true
        requireTopKey(key)
        checkKey(key)
        const temp = tempPath(key, id)
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
        topChunkSizes.push(bytes.length)
        if ((offset === 0 || !last) && !isCurrent(gen)) {
            if (offset > 0) {
                fs.files.delete(temp)
            }
            throw STALE_REFUSAL
        }
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
        if (!last) {
            return true
        }
        if (!isCurrent(gen)) {
            fs.files.delete(temp)
            throw STALE_REFUSAL
        }
        const flushed = flushFault?.({ key, offset, last, durable: true }) !== true
        fs.files.set(key, next)
        fs.files.delete(temp)
        return flushed
    }

    /** `store2_remove`: kinds are checked first, a stale generation is refused before any removal, an absent key counts as removed. */
    async function removeTop(args: Record<string, unknown>): Promise<unknown> {
        const gen = numberArg(args, 'gen')
        const keys = args.keys
        if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
            throw new Error('keys must be an array of strings')
        }
        for (const key of keys as string[]) {
            requireRemoveKey(key)
        }
        if (!isCurrent(gen)) {
            throw STALE_REFUSAL
        }
        const fsModule = fs.module as { remove(path: string): Promise<void> }
        const report: { key: string, outcome: 'removed' | 'failed', error?: string }[] = []
        for (const key of keys as string[]) {
            try {
                await fsModule.remove(appFsKey({ key }, false))
                report.push({ key, outcome: 'removed' })
            } catch (error) {
                if (!fs.files.has(key) && !fs.directories.has(key)) {
                    report.push({ key, outcome: 'removed' })
                } else {
                    report.push({ key, outcome: 'failed', error: String(error) })
                }
            }
        }
        return report
    }

    async function invoke(command: string, args?: unknown): Promise<unknown> {
        const named = (args ?? {}) as Record<string, unknown>
        calls.push({ command, args: named })
        switch (command) {
            case 'store2_register_page':
                if (registrationFault !== undefined) {
                    throw registrationFault
                }
                return ++generation
            case 'store2_write_top_chunk':
                return { flushed: writeTopChunk(named) }
            case 'store2_remove':
                return await removeTop(named)
            case 'app_fs_exists':
            case 'app_fs_mkdir_all':
            case 'app_fs_remove':
            case 'app_data_dir_path':
                return await appFsCommand(command, named)
            case 'write_chunk': {
                const flushed = writeChunk(named)
                return reporting ? { flushed } : undefined
            }
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
        /** `write_chunk` answers `{ flushed }` from now on, until the next reset. */
        reportFlushes(on = true): void {
            reporting = on
        },
        /** With `reportFlushes`, a call for which `fault` returns true answers `flushed: false`; the write still succeeds. */
        failFlushes(fault: ((call: FlushCall) => boolean) | undefined): void {
            flushFault = fault
        },
        failAborts(error: string | undefined): void {
            abortFault = error
        },
        topChunkSizes,
        /** Whether a call carrying `gen` would pass the gate's generation check now. */
        isCurrent,
        /** The generation the gate holds now. */
        currentGeneration: (): number => generation,
        /** `store2_register_page` rejects with `error` (a typed `registration-timeout:` text, or any other failure) until cleared with `undefined`. */
        failRegistration(error: string | undefined): void {
            registrationFault = error
        },
        reset(): void {
            calls.length = 0
            chunkSizes.length = 0
            topChunkSizes.length = 0
            generation = 0
            registrationFault = undefined
            rangeCalls = 0
            writeFault = undefined
            abortFault = undefined
            reporting = false
            flushFault = undefined
            hooks.before = undefined
            hooks.limit = undefined
        },
    }
}

export type ChunkedInvokeFake = ReturnType<typeof createChunkedInvoke>
