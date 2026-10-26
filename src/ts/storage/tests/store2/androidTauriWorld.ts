/**
 * Test-only: the Android stand-ins that the store2 Tauri backend suites share. The file system, the chunk and
 * app-fs commands and the path module are the fakes of `tauriFsFake`, `tauriChunkFake` and `tauriPathFake`, and `invoke`
 * is the command router a suite mocks `@tauri-apps/api/core` with. Build it inside `vi.hoisted` (the module mocks read it),
 * and mock `@tauri-apps/plugin-os` to answer `android`:
 *
 *   const h = await vi.hoisted(async () => (await import('src/ts/storage/tests/store2/androidTauriWorld')).createAndroidTauriWorld())
 *
 * A pass is not evidence about the Rust commands or the native bridge.
 */
import { createFakeTauriFs } from '../tauriFsFake'
import { createChunkedInvoke } from '../tauriChunkFake'
import { createFakeTauriPaths } from '../tauriPathFake'

/** A raw reply of this many bytes or more goes through a fetch that a frozen page never answers (`channel.rs`). */
export const FROZEN_RAW_REPLY_BYTES = 1024
/** A JSON reply starting with `{` or `[` of this many UTF-8 bytes or more takes the same fetch. */
export const FROZEN_JSON_REPLY_BYTES = 8192

export function createAndroidTauriWorld() {
    const fs = createFakeTauriFs({ strict: true })
    const chunk = createChunkedInvoke(fs)
    const paths = createFakeTauriPaths()
    /** Every `write_chunk` as it starts and settles, with the most in flight at once; `before` can hold a write by key. */
    const writes: { events: string[], inflight: number, peak: number, before: ((key: string) => Promise<void> | undefined) | undefined } = { events: [], inflight: 0, peak: 0, before: undefined }
    /** While `on`, a reply the frozen page cannot receive never settles; `hung` names those commands. */
    const frozen = { on: false, hung: [] as string[] }

    function neverSettles(reply: unknown): boolean {
        if (reply instanceof ArrayBuffer || ArrayBuffer.isView(reply)) {
            return reply.byteLength >= FROZEN_RAW_REPLY_BYTES
        }
        if (typeof reply === 'object' && reply !== null) {
            // An object or array reply is JSON starting with `{` or `[`.
            // Tauri compares the UTF-8 byte length of the serialized reply.
            return new TextEncoder().encode(JSON.stringify(reply)).length >= FROZEN_JSON_REPLY_BYTES
        }
        return false
    }

    /**
     * The request side: the HTTP plugin's `fetch` / `fetch_send` / `fetch_read_body` sequence and the `streamed_fetch`
     * command. `streamed_fetch` only records its arguments; the events reach the page through `deliver`, which calls the
     * callback the suite registered for the `listen` mock. `fetch_read_body` copies the plugin's wire format: each reply
     * is an ArrayBuffer of the data plus a trailing 0 byte, and the last reply is the single byte 1.
     */
    const http = {
        status: 200,
        headers: [['content-type', 'application/json']] as [string, string][],
        body: new Uint8Array() as Uint8Array,
        readPos: 0,
        /** The arguments of every `streamed_fetch` call. */
        streamedCalls: [] as Record<string, unknown>[],
        cancelledIds: [] as string[],
        commands: [] as string[],
        /** What the `streamed_fetch` command answers with once the request finished. */
        streamedReply: '{"success":true}',
        listener: undefined as ((event: { payload: string }) => void) | undefined,
        setBody(body: string | Uint8Array): void {
            http.body = typeof body === 'string' ? new TextEncoder().encode(body) : body
            http.readPos = 0
        },
        /** Pushes the response head, the chunks and the end event of one `streamed_fetch` request into the page. */
        deliver(id: string, chunks: Uint8Array[], options: { status?: number, headers?: Record<string, string>, end?: boolean } = {}): void {
            if (!http.listener) {
                throw new Error('setup: no streamed_fetch listener registered')
            }
            const send = (event: Record<string, unknown>) => http.listener!({ payload: JSON.stringify({ ...event, id }) })
            send({ type: 'headers', body: options.headers ?? { 'content-type': 'application/json' }, status: options.status ?? 200 })
            for (const chunkBytes of chunks) {
                let binary = ''
                for (const byte of chunkBytes) {
                    binary += String.fromCharCode(byte)
                }
                send({ type: 'chunk', body: btoa(binary) })
            }
            if (options.end ?? true) {
                send({ type: 'end' })
            }
        },
    }

    function requestCommand(command: string, args?: unknown): { handled: boolean, reply?: unknown } {
        if (command === 'plugin:http|fetch') {
            http.commands.push(command)
            return { handled: true, reply: 7 }
        }
        if (command === 'plugin:http|fetch_send') {
            http.commands.push(command)
            return { handled: true, reply: { status: http.status, statusText: 'OK', url: 'https://api.example.invalid/v1/chat', headers: http.headers, rid: 8 } }
        }
        if (command === 'plugin:http|fetch_read_body') {
            http.commands.push(command)
            if (http.readPos >= http.body.length) {
                return { handled: true, reply: new Uint8Array([1]).buffer }
            }
            const out = new Uint8Array(http.body.length - http.readPos + 1)
            out.set(http.body.subarray(http.readPos))
            out[out.length - 1] = 0
            http.readPos = http.body.length
            return { handled: true, reply: out.buffer }
        }
        if (command === 'plugin:http|fetch_cancel' || command === 'plugin:http|fetch_cancel_body') {
            return { handled: true, reply: null }
        }
        if (command === 'streamed_fetch') {
            http.streamedCalls.push(args as Record<string, unknown>)
            return { handled: true, reply: http.streamedReply }
        }
        if (command === 'cancel_streamed_fetch') {
            http.cancelledIds.push(String((args as { id: string }).id))
            return { handled: true, reply: null }
        }
        return { handled: false }
    }

    async function routed(command: string, args?: unknown): Promise<unknown> {
        const request = requestCommand(command, args)
        if (request.handled) {
            return request.reply
        }
        // The store2 top-level keys go through the gated chunk command; it is held and ordered like `write_chunk`.
        if (command !== 'write_chunk' && command !== 'store2_write_top_chunk') {
            return chunk.invoke(command, args)
        }
        const key = String((args as { key: string }).key)
        writes.events.push(`start ${key}`)
        writes.inflight++
        writes.peak = Math.max(writes.peak, writes.inflight)
        try {
            await writes.before?.(key)
            return await chunk.invoke(command, args)
        } finally {
            writes.inflight--
            writes.events.push(`end ${key}`)
        }
    }

    async function invoke(command: string, args?: unknown): Promise<unknown> {
        const reply = await routed(command, args)
        if (frozen.on && neverSettles(reply)) {
            frozen.hung.push(command)
            return await new Promise<never>(() => {})
        }
        return reply
    }

    return {
        fs,
        chunk,
        paths,
        writes,
        frozen,
        http,
        invoke,
        reset(): void {
            http.status = 200
            http.headers = [['content-type', 'application/json']]
            http.body = new Uint8Array()
            http.readPos = 0
            http.streamedCalls.length = 0
            http.cancelledIds.length = 0
            http.commands.length = 0
            http.streamedReply = '{"success":true}'
            fs.reset()
            chunk.reset()
            paths.reset()
            chunk.reportFlushes()
            writes.events.length = 0
            writes.inflight = 0
            writes.peak = 0
            writes.before = undefined
            frozen.on = false
            frozen.hung.length = 0
        },
    }
}

export type AndroidTauriWorld = ReturnType<typeof createAndroidTauriWorld>
