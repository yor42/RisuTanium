/**
 * In-memory stand-ins for the desktop transport, working on the files of a
 * `createFakeTauriFs` instance:
 *
 * - `createDesktopInvoke` answers every command the desktop page may call:
 *   `write_chunk_raw` (raw body, headers, structured outcome), the three
 *   chunk commands of `tauriChunkFake.ts`, and `write_durable`. With a `cap`
 *   it rejects any call whose file payload (request body, base64 `data`, or
 *   response bytes before the trailer) is above the cap, the way a per-call
 *   bound would fail it.
 * - `createBoundedFs` is the plugin-fs module with `readFile`, `writeFile` and
 *   `open` (a handle that reads in pieces, optionally short) and the same cap.
 *
 * They prove a per-call size bound only. The memory behaviour of the real web
 * view and the Rust commands is not modelled.
 */
import { createChunkedInvoke, TRAILER_BYTES } from './tauriChunkFake'
import type { DurableInvokeOptions, FakeTauriFs } from './tauriFsFake'

export interface DesktopInvokeOptions {
    /** Largest file payload one call may carry, in either direction. */
    cap?: number
    /**
     * Each `read_range` first reads its key through the plugin `readFile`
     * stand-in (`./<key>`) and drops the result, so a suite that injects read
     * faults on the fake file system, or inspects the plugin's call log, sees a
     * read the way it saw one before reads went through the command.
     */
    probeReads?: boolean
}

export interface RawChunkCall {
    key: string
    id: string
    offset: number
    last: boolean
    durable: boolean
    size: number
    /** The `x-risu-final-key` header, decoded; absent when the call carried none. */
    finalKey?: string
}

function decodedLength(text: string): number {
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
    return (text.length * 3) / 4 - padding
}

function requestPayload(args: unknown): number {
    if (args instanceof Uint8Array) {
        return args.length
    }
    if (typeof args === 'object' && args !== null) {
        const data = (args as { data?: unknown }).data
        if (typeof data === 'string') {
            return decodedLength(data)
        }
    }
    return 0
}

export function createDesktopInvoke(fs: FakeTauriFs, options: DesktopInvokeOptions = {}) {
    const chunk = createChunkedInvoke(fs)
    const rawCalls: RawChunkCall[] = []
    const commands: string[] = []
    /** The file payload of every call, request or response, in order. */
    const payloads: number[] = []
    let cap = options.cap
    let rawRefused = false

    function check(kind: 'request' | 'response', size: number): void {
        payloads.push(size)
        if (cap !== undefined && size > cap) {
            throw new Error(`the ${kind} carries ${size} bytes, above the per-call bound of ${cap}`)
        }
    }

    function header(headers: Record<string, string> | undefined, name: string): string {
        const value = headers?.[name]
        if (typeof value !== 'string') {
            throw `malformed: missing header ${name}`
        }
        return value
    }

    async function writeChunkRaw(args: unknown, invokeOptions: DurableInvokeOptions | undefined): Promise<unknown> {
        if (rawRefused || !(args instanceof Uint8Array)) {
            throw 'not-raw: the body did not arrive as raw bytes'
        }
        const headers = invokeOptions?.headers
        const finalKeyHeader = headers?.['x-risu-final-key']
        const call: RawChunkCall = {
            key: decodeURIComponent(header(headers, 'x-risu-key')),
            id: header(headers, 'x-risu-id'),
            offset: Number(header(headers, 'x-risu-offset')),
            last: header(headers, 'x-risu-last') === '1',
            durable: header(headers, 'x-risu-durable') === '1',
            size: args.length,
            finalKey: typeof finalKeyHeader === 'string' ? decodeURIComponent(finalKeyHeader) : undefined,
        }
        rawCalls.push(call)
        try {
            await chunk.invoke('write_chunk', {
                key: call.key,
                id: call.id,
                offset: call.offset,
                data: Buffer.from(args).toString('base64'),
                last: call.last,
                durable: call.durable,
                ...(call.finalKey !== undefined ? { finalKey: call.finalKey } : {}),
            })
            return { k: 'ok' }
        } catch (error) {
            const text = String(error)
            return text.startsWith('refused key') ? { k: 'invalid', reason: text } : { k: 'error', message: text }
        }
    }

    async function invoke(command: string, args?: unknown, invokeOptions?: DurableInvokeOptions): Promise<unknown> {
        commands.push(command)
        check('request', requestPayload(args))
        switch (command) {
            case 'write_chunk_raw':
                return await writeChunkRaw(args, invokeOptions)
            case 'write_durable':
                return await fs.invoke(command, args, invokeOptions)
            default: {
                if (command === 'read_range' && options.probeReads === true) {
                    await (fs.module.readFile as (path: string) => Promise<Uint8Array>)(`./${(args as { key: string }).key}`)
                }
                const result = await chunk.invoke(command, args)
                if (result instanceof ArrayBuffer) {
                    check('response', Math.max(0, result.byteLength - TRAILER_BYTES))
                }
                return result
            }
        }
    }

    return {
        invoke,
        chunk,
        rawCalls,
        commands,
        payloads,
        /** The calls of one command, in order. */
        count(command: string): number {
            return commands.filter((name) => name === command).length
        },
        /** `write_chunk_raw` rejects with the `not-raw:` refusal from now on. */
        refuseRawBodies(refused = true): void {
            rawRefused = refused
        },
        setCap(next: number | undefined): void {
            cap = next
        },
        reset(): void {
            chunk.reset()
            rawCalls.length = 0
            commands.length = 0
            payloads.length = 0
            rawRefused = false
            cap = options.cap
        },
    }
}

export type DesktopInvokeFake = ReturnType<typeof createDesktopInvoke>

export interface BoundedFsOptions {
    cap?: number
}

/** A handle as the plugin gives it: `read` fills the buffer from the current position, or answers `null` at the end. */
export interface FakeFileHandle {
    read(buffer: Uint8Array): Promise<number | null>
    close(): Promise<void>
}

export function createBoundedFs(fs: FakeTauriFs, options: BoundedFsOptions = {}) {
    const cap = options.cap
    /** Paths given to `open`, in order. */
    const opened: string[] = []
    /** The buffer size of every `read` on a handle, in order. */
    const readSizes: number[] = []
    /** The body size of every `writeFile` call, in order. */
    const writeSizes: number[] = []
    let openHandles = 0
    let readLimit: number | undefined
    let readFault: ((index: number) => string | undefined) | undefined
    let closeFault: string | undefined
    let reads = 0

    function check(kind: string, size: number): void {
        if (cap !== undefined && size > cap) {
            throw new Error(`the ${kind} carries ${size} bytes, above the per-call bound of ${cap}`)
        }
    }

    async function readFile(path: string, ...rest: unknown[]): Promise<Uint8Array> {
        const bytes = await (fs.module.readFile as (path: string, ...rest: unknown[]) => Promise<Uint8Array>)(path, ...rest)
        check('readFile response', bytes.length)
        return bytes
    }

    async function writeFile(path: string, data: Uint8Array, writeOptions?: { append?: boolean, baseDir?: number, createNew?: boolean }): Promise<void> {
        writeSizes.push(data.length)
        check('writeFile body', data.length)
        if (writeOptions?.append === true) {
            const held = fs.files.get(path) ?? new Uint8Array(0)
            const next = new Uint8Array(held.length + data.length)
            next.set(held, 0)
            next.set(data, held.length)
            fs.files.set(path, next)
            fs.calls.push({ op: 'writeFile', path })
            return
        }
        await (fs.module.writeFile as (path: string, data: Uint8Array, options?: unknown) => Promise<void>)(path, data, writeOptions)
    }

    async function open(path: string): Promise<FakeFileHandle> {
        opened.push(path)
        const data = fs.files.get(path)
        if (data === undefined) {
            throw `failed to open file at path: ${path} with error: No such file or directory (os error 2)`
        }
        openHandles++
        let position = 0
        let closed = false
        return {
            async read(buffer: Uint8Array): Promise<number | null> {
                if (closed) {
                    throw 'the handle is closed'
                }
                readSizes.push(buffer.byteLength)
                check('read request', buffer.byteLength)
                const fault = readFault?.(reads++)
                if (fault !== undefined) {
                    throw fault
                }
                if (position >= data.length) {
                    return null
                }
                const count = Math.min(buffer.byteLength, data.length - position, readLimit ?? Infinity)
                buffer.set(data.subarray(position, position + count), 0)
                position += count
                return count
            },
            async close(): Promise<void> {
                if (!closed) {
                    closed = true
                    openHandles--
                }
                if (closeFault !== undefined) {
                    throw closeFault
                }
            },
        }
    }

    return {
        module: { ...fs.module, readFile, writeFile, open },
        opened,
        readSizes,
        writeSizes,
        /** Handles opened and not yet closed. */
        openHandles: () => openHandles,
        /** Caps the bytes any one `read` returns, whatever the buffer holds. */
        limitReads(limit: number | undefined): void {
            readLimit = limit
        },
        /** The `read` whose 0-based index (since the last reset) the function accepts rejects with the message. */
        failReads(fault: ((index: number) => string | undefined) | undefined): void {
            readFault = fault
        },
        failCloses(message: string | undefined): void {
            closeFault = message
        },
        reset(): void {
            opened.length = 0
            readSizes.length = 0
            writeSizes.length = 0
            openHandles = 0
            readLimit = undefined
            readFault = undefined
            closeFault = undefined
            reads = 0
        },
    }
}

export type BoundedFsFake = ReturnType<typeof createBoundedFs>
