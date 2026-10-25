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

    async function routed(command: string, args?: unknown): Promise<unknown> {
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
        invoke,
        reset(): void {
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
