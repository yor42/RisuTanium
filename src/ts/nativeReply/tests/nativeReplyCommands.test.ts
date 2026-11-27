import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createReplyStore, type ReplyInvoke } from '../store'

/**
 * The native reply commands the page sends. P7 pins the cancel command's name and arguments. H1 reads the Rust handler list
 * as text: the commands take an `AppHandle`, so the app's handler list cannot be built in a Rust test, and CI runs vitest
 * only. A command the page sends that the list does not carry would fail at runtime on the device, never in a unit test.
 */

const KEY = '0b9c1a7e-0000-4000-8000-000000000001'

function recordingInvoke(): { invoke: ReplyInvoke, calls: Array<{ command: string, args?: Record<string, unknown> }> } {
    const calls: Array<{ command: string, args?: Record<string, unknown> }> = []
    const invoke: ReplyInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args })
        return undefined as T
    }
    return { invoke, calls }
}

describe('the native reply commands', () => {
    // P7, new-contract guard.
    test('P7: cancel sends native_reply_cancel with the key', async () => {
        const { invoke, calls } = recordingInvoke()

        await createReplyStore(invoke).cancel(KEY)

        expect(calls).toEqual([{ command: 'native_reply_cancel', args: { key: KEY } }])
    })

    // H1, new-contract guard; it passes on a base for the commands that base already sends.
    test('H1: every command the reply store sends is registered in the Rust handler list', async () => {
        const { invoke, calls } = recordingInvoke()
        const store = createReplyStore(invoke)
        for (const call of [
            () => store.list(), () => store.readBody(KEY), () => store.readBodyBytes(KEY), () => store.readPartialBytes(KEY),
            () => store.consume(KEY), () => store.discard(KEY), () => store.park(KEY), () => store.cancel(KEY),
        ]) {
            // A body read of an empty answer throws after the command was recorded.
            await call().catch(() => undefined)
        }
        const source = readFileSync(resolve(process.cwd(), 'src-tauri', 'src', 'lib.rs'), 'utf8')
        const block = /generate_handler!\[([\s\S]*?)\]/.exec(source)
        expect(block).not.toBeNull()
        const registered = block![1]
            .split(',')
            .map((entry) => entry.replace(/\/\/.*$/gm, '').trim().split('::').pop()!)
            .filter((entry) => entry !== '')

        const sent = [...new Set(calls.map((call) => call.command))]

        expect(sent).toContain('native_reply_cancel')
        expect(sent.length).toBeGreaterThanOrEqual(6)
        expect(sent.filter((command) => !registered.includes(command))).toEqual([])
    })
})
