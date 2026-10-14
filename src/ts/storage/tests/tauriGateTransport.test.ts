/**
 * The page's side of the generation gate (`src/ts/storage/tauriGateTransport.ts`)
 * against the in-memory stand-ins for its commands (`tauriDesktopFake.ts` over
 * `tauriChunkFake.ts`): registration, which command a whole-key write uses on each
 * platform, the generation on every call, the `not-raw:` switch, the typed errors
 * of a refusal and the per-key report of a removal. The Rust commands are tested
 * in `src-tauri`; a pass here is not evidence about them.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 30_000 })

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const desktop = (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fs)
    const state: { os: string, override: ((command: string, args?: unknown, options?: unknown) => Promise<unknown>) | undefined } = {
        os: 'windows',
        override: undefined,
    }
    return { fs, desktop, state }
})

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.state.os }))
vi.mock('@tauri-apps/api/core', () => ({
    invoke: (command: string, args?: unknown, options?: unknown) =>
        (h.state.override ? h.state.override(command, args, options) : h.desktop.invoke(command, args, options as { headers?: Record<string, string> })),
}))

import { StoreDeleteManyError, StoreInvalidKeyError, StoreRegistrationTimeoutError, StoreStaleGenerationError } from 'src/ts/storage/store/errors'
import { resetByteTransportForTests, CHUNK_MAX, WRITE_CHUNK_BYTES } from 'src/ts/storage/tauriByteTransport'
import { registerPageGeneration, removeTopKeys, resetGateTransportForTests, writeTopKey } from 'src/ts/storage/tauriGateTransport'

const COMMIT = 'store2-commit'
const FENCE = 'store2-fence'
const UNIT_A = 'store2/aaaa'
const UNIT_B = 'store2/bbbb'

function patterned(length: number, salt = 0): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (i * 7 + 3 + salt) % 251)
}

function stored(key: string): number[] | undefined {
    const bytes = h.fs.files.get(key)
    return bytes === undefined ? undefined : Array.from(bytes)
}

function leftoverTemps(): string[] {
    return Array.from(h.fs.files.keys()).filter((key) => /risu-write-[0-9a-f]{16}\.tmp$/.test(key))
}

function gatedCommands(): string[] {
    return h.desktop.commands.filter((command) => command.startsWith('store2_'))
}

/** Empties the call logs without touching the gate, which a reset would take back to generation 0. */
function clearLogs(): void {
    h.desktop.commands.length = 0
    h.desktop.topCalls.length = 0
    h.desktop.chunk.calls.length = 0
    h.desktop.chunk.topChunkSizes.length = 0
}

beforeEach(() => {
    h.fs.reset()
    h.desktop.reset()
    h.state.os = 'windows'
    h.state.override = undefined
    resetByteTransportForTests()
    resetGateTransportForTests()
})

describe('registration', () => {
    test('each registration issues the next generation, starting above zero', async () => {
        expect(await registerPageGeneration()).toBe(1)
        expect(await registerPageGeneration()).toBe(2)
    })

    test('a registration timeout is a typed error and any other rejection is passed on as it came', async () => {
        h.desktop.chunk.failRegistration('registration-timeout: a write that holds the gate did not finish within 30000 ms')
        await expect(registerPageGeneration()).rejects.toBeInstanceOf(StoreRegistrationTimeoutError)

        h.desktop.chunk.failRegistration('the registration task failed: boom')
        await expect(registerPageGeneration()).rejects.toBe('the registration task failed: boom')
        expect(h.desktop.chunk.currentGeneration()).toBe(0)
    })

    test('an unreadable generation is an error, never a number', async () => {
        h.state.override = async () => 0
        await expect(registerPageGeneration()).rejects.toThrow('unreadable generation')
        h.state.override = async () => undefined
        await expect(registerPageGeneration()).rejects.toThrow('unreadable generation')
    })
})

describe('which command a whole-key write uses', () => {
    test('desktop, at CHUNK_MAX or below: one raw call with the key and the generation in headers', async () => {
        const gen = await registerPageGeneration()
        clearLogs()

        const flushed = await writeTopKey(gen, COMMIT, patterned(CHUNK_MAX))

        expect(flushed).toBe(true)
        expect(gatedCommands()).toEqual(['store2_write_top_raw'])
        expect(h.desktop.topCalls).toEqual([{ command: 'store2_write_top_raw', gen, key: COMMIT, size: CHUNK_MAX }])
        expect(stored(COMMIT)).toEqual(Array.from(patterned(CHUNK_MAX)))
    })

    test('desktop above CHUNK_MAX: raw gated chunks, the generation on every call, no whole-key call', async () => {
        await registerPageGeneration()
        const gen = await registerPageGeneration()
        clearLogs()
        const bytes = patterned(CHUNK_MAX + 5)

        expect(await writeTopKey(gen, FENCE, bytes)).toBe(true)

        expect(gatedCommands()).toEqual(['store2_write_top_chunk_raw', 'store2_write_top_chunk_raw'])
        expect(h.desktop.topCalls.map((call) => call.gen)).toEqual([gen, gen])
        expect(h.desktop.topCalls.map((call) => [call.offset, call.last, call.size])).toEqual([[0, false, CHUNK_MAX], [CHUNK_MAX, true, 5]])
        expect(h.desktop.commands).not.toContain('store2_write_top_raw')
        expect(stored(FENCE)).toEqual(Array.from(bytes))
        expect(leftoverTemps()).toEqual([])
    })

    test('Android always uses the gated base64 chunks, even for a few bytes, with the generation in every call', async () => {
        h.state.os = 'android'
        const gen = await registerPageGeneration()
        clearLogs()

        expect(await writeTopKey(gen, COMMIT, patterned(10))).toBe(true)
        expect(await writeTopKey(gen, FENCE, patterned(WRITE_CHUNK_BYTES * 2 + 7))).toBe(true)

        expect(gatedCommands()).toEqual(['store2_write_top_chunk', 'store2_write_top_chunk', 'store2_write_top_chunk', 'store2_write_top_chunk'])
        expect(h.desktop.chunk.callsOf('store2_write_top_chunk').map((call) => call.args.gen)).toEqual([gen, gen, gen, gen])
        expect(h.desktop.topCalls).toEqual([])
        expect(h.desktop.chunk.topChunkSizes).toEqual([10, WRITE_CHUNK_BYTES, WRITE_CHUNK_BYTES, 7])
        expect(stored(COMMIT)).toEqual(Array.from(patterned(10)))
        expect(stored(FENCE)).toEqual(Array.from(patterned(WRITE_CHUNK_BYTES * 2 + 7)))
    })

    test('an empty value is one empty final chunk on Android and one raw call on desktop', async () => {
        const gen = await registerPageGeneration()
        clearLogs()
        await writeTopKey(gen, COMMIT, new Uint8Array(0))
        expect(gatedCommands()).toEqual(['store2_write_top_raw'])
        expect(stored(COMMIT)).toEqual([])

        h.state.os = 'android'
        clearLogs()
        await writeTopKey(gen, FENCE, new Uint8Array(0))
        expect(h.desktop.chunk.callsOf('store2_write_top_chunk')).toHaveLength(1)
        expect(stored(FENCE)).toEqual([])
    })

    test('a body the raw command refuses as not raw falls back to the gated chunks, and later writes of the page skip the raw call', async () => {
        const gen = await registerPageGeneration()
        clearLogs()
        h.desktop.refuseRawBodies()

        expect(await writeTopKey(gen, COMMIT, patterned(100))).toBe(true)
        expect(await writeTopKey(gen, FENCE, patterned(50))).toBe(true)

        expect(gatedCommands()).toEqual(['store2_write_top_raw', 'store2_write_top_chunk', 'store2_write_top_chunk'])
        expect(h.desktop.chunk.callsOf('store2_write_top_chunk').map((call) => call.args.gen)).toEqual([gen, gen])
        expect(stored(COMMIT)).toEqual(Array.from(patterned(100)))
        expect(stored(FENCE)).toEqual(Array.from(patterned(50)))
    })

    test('a raw chunk refused as not raw is sent again as base64 with the same generation', async () => {
        const gen = await registerPageGeneration()
        clearLogs()
        h.desktop.refuseRawBodies()
        const bytes = patterned(CHUNK_MAX + 3)

        expect(await writeTopKey(gen, COMMIT, bytes)).toBe(true)

        expect(gatedCommands()).toEqual(['store2_write_top_chunk_raw', 'store2_write_top_chunk', 'store2_write_top_chunk'])
        expect(h.desktop.chunk.callsOf('store2_write_top_chunk').map((call) => call.args.gen)).toEqual([gen, gen])
        expect(stored(COMMIT)).toEqual(Array.from(bytes))
    })
})

describe('refusals', () => {
    test.each([
        ['desktop single raw call', 'windows', 100],
        ['desktop gated chunks', 'windows', CHUNK_MAX + 1],
        ['android gated chunks', 'android', 100],
    ] as const)('a stale generation on a %s is a StoreStaleGenerationError and the file is untouched', async (_name, os, length) => {
        const stale = await registerPageGeneration()
        await registerPageGeneration()
        h.fs.plant(COMMIT, Uint8Array.of(7, 7))
        h.state.os = os

        await expect(writeTopKey(stale, COMMIT, patterned(length))).rejects.toBeInstanceOf(StoreStaleGenerationError)

        expect(stored(COMMIT)).toEqual([7, 7])
        expect(leftoverTemps()).toEqual([])
    })

    test('generation zero is refused as stale', async () => {
        await registerPageGeneration()
        await expect(writeTopKey(0, COMMIT, patterned(4))).rejects.toBeInstanceOf(StoreStaleGenerationError)
        expect(stored(COMMIT)).toBeUndefined()
    })

    test('a page that goes stale between chunks has its final chunk refused, its temp removed and the target kept', async () => {
        const gen = await registerPageGeneration()
        h.fs.plant(COMMIT, Uint8Array.of(7, 7))
        let chunks = 0
        h.state.override = async (command, args, options) => {
            if (command === 'store2_write_top_chunk_raw' && ++chunks === 2) {
                await h.desktop.invoke('store2_register_page')
            }
            return await h.desktop.invoke(command, args, options as { headers?: Record<string, string> })
        }

        await expect(writeTopKey(gen, COMMIT, patterned(CHUNK_MAX + 1))).rejects.toBeInstanceOf(StoreStaleGenerationError)

        expect(chunks).toBe(2)
        expect(stored(COMMIT)).toEqual([7, 7])
        expect(leftoverTemps()).toEqual([])
    })

    test('a failure that is not a refusal keeps the original rejection and asks the command to drop the temp file', async () => {
        const gen = await registerPageGeneration()
        h.desktop.chunk.failWrites((call) => call.offset > 0 ? 'disk full' : undefined)

        await expect(writeTopKey(gen, COMMIT, patterned(CHUNK_MAX + 1))).rejects.toBe('disk full')

        expect(h.desktop.commands).toContain('abort_chunked')
        expect(stored(COMMIT)).toBeUndefined()
        expect(leftoverTemps()).toEqual([])
    })

    test('a key the gate does not write is a StoreInvalidKeyError', async () => {
        const gen = await registerPageGeneration()
        await expect(writeTopKey(gen, UNIT_A, patterned(4))).rejects.toBeInstanceOf(StoreInvalidKeyError)
        expect(stored(UNIT_A)).toBeUndefined()
    })

    test('a write that fails for another reason may have been applied: the rejection is the command\'s own', async () => {
        const gen = await registerPageGeneration()
        h.fs.failDurableWrites('transport lost', (key) => key === COMMIT)

        await expect(writeTopKey(gen, COMMIT, patterned(4))).rejects.toBe('transport lost')
    })

    test('an answer without a flush status is reported as not flushed, never as flushed', async () => {
        const gen = await registerPageGeneration()
        h.state.override = async () => undefined

        expect(await writeTopKey(gen, COMMIT, patterned(4))).toBe(false)
    })

    test('a flush failure on any chunk makes the whole write not flushed', async () => {
        const gen = await registerPageGeneration()
        h.desktop.chunk.failFlushes((call) => call.last)

        expect(await writeTopKey(gen, COMMIT, patterned(CHUNK_MAX + 1))).toBe(false)
        expect(stored(COMMIT)).toEqual(Array.from(patterned(CHUNK_MAX + 1)))
    })
})

describe('removal', () => {
    test('every key removed resolves, and an absent key counts as removed', async () => {
        const gen = await registerPageGeneration()
        h.fs.plant(UNIT_A, Uint8Array.of(1))
        h.fs.plant(FENCE, Uint8Array.of(2))

        await removeTopKeys(gen, [UNIT_A, UNIT_B, FENCE])

        expect(stored(UNIT_A)).toBeUndefined()
        expect(stored(FENCE)).toBeUndefined()
    })

    test('a failed removal rejects with a per-key report in input order, and the other keys still went', async () => {
        const gen = await registerPageGeneration()
        h.fs.plant(UNIT_A, Uint8Array.of(1))
        h.fs.plant(UNIT_B, Uint8Array.of(2))
        h.fs.plant(FENCE, Uint8Array.of(3))
        h.fs.failRemoves('access denied', (path) => path.endsWith(UNIT_B))

        const error = await removeTopKeys(gen, [UNIT_A, UNIT_B, FENCE]).catch((e: unknown) => e)

        expect(error).toBeInstanceOf(StoreDeleteManyError)
        const report = (error as StoreDeleteManyError).report
        expect(report.map((entry) => [entry.key, entry.outcome])).toEqual([[UNIT_A, 'removed'], [UNIT_B, 'failed'], [FENCE, 'removed']])
        expect(String((report[1].error as Error).message)).toContain('access denied')
        expect(stored(UNIT_B)).toEqual([2])
        expect(stored(UNIT_A)).toBeUndefined()
    })

    test('a stale generation removes nothing and is a StoreStaleGenerationError', async () => {
        const stale = await registerPageGeneration()
        await registerPageGeneration()
        h.fs.plant(UNIT_A, Uint8Array.of(1))

        await expect(removeTopKeys(stale, [UNIT_A])).rejects.toBeInstanceOf(StoreStaleGenerationError)
        await expect(removeTopKeys(0, [UNIT_A])).rejects.toBeInstanceOf(StoreStaleGenerationError)

        expect(stored(UNIT_A)).toEqual([1])
    })

    test('the commit key is refused as a key the gate does not remove, and nothing else in the call is removed', async () => {
        const gen = await registerPageGeneration()
        h.fs.plant(UNIT_A, Uint8Array.of(1))
        h.fs.plant(COMMIT, Uint8Array.of(9))

        await expect(removeTopKeys(gen, [UNIT_A, COMMIT])).rejects.toBeInstanceOf(StoreInvalidKeyError)

        expect(stored(UNIT_A)).toEqual([1])
        expect(stored(COMMIT)).toEqual([9])
    })

    test.each([
        ['not an array', async () => ({})],
        ['a short array', async () => []],
        ['an entry for another key', async () => [{ key: 'store2/other', outcome: 'removed' }]],
        ['an unknown outcome', async () => [{ key: UNIT_A, outcome: 'gone' }]],
    ] as const)('an unreadable answer (%s) is an error, never a success', async (_name, answer) => {
        const gen = await registerPageGeneration()
        h.state.override = answer

        await expect(removeTopKeys(gen, [UNIT_A])).rejects.toThrow('unreadable result')
    })
})
