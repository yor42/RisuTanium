/**
 * With the operating system reported as Android, no single payload that
 * `writeFileDurable` or `writeFileAtomic` hands to the bridge carries more than
 * one megabyte: every `invoke` argument and every body given to the plugin's
 * `writeFile` is measured, and a base64 string counts as its decoded length.
 * The Android bridge turns a whole-file body into a JSON number array of about
 * 3.6 characters per byte, which exhausts memory for a large file. This test
 * imports no transport symbol: it observes only the public write functions and
 * what they hand to the bridge, so it holds for any transport.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs()
    return { fs, invoke: vi.fn() }
})

vi.mock('@tauri-apps/plugin-fs', () => h.fs.module)
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }))

import { writeFileAtomic } from 'src/ts/storage/tauriAtomicWrite'
import { writeFileDurable } from 'src/ts/storage/tauriDurableWrite'

const ONE_MEGABYTE = 1024 * 1024
const INPUT_BYTES = 3 * ONE_MEGABYTE + 12345

function input(): Uint8Array {
    return Uint8Array.from({ length: INPUT_BYTES }, (_, i) => (i * 11 + 5) % 251)
}

/** The decoded size of a base64 string. */
function decodedLength(text: string): number {
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
    return (text.length * 3) / 4 - padding
}

/** Sizes of every payload of one invoke argument: raw bodies, number arrays, strings and the strings inside an argument object. */
function payloadSizes(value: unknown): number[] {
    if (value instanceof Uint8Array) {
        return [value.length]
    }
    if (Array.isArray(value)) {
        return [value.length]
    }
    if (typeof value === 'string') {
        return [decodedLength(value)]
    }
    if (typeof value === 'object' && value !== null) {
        return Object.entries(value).filter(([name]) => name === 'data').flatMap(([, entry]) => payloadSizes(entry))
    }
    return []
}

function transportedPayloads(): number[] {
    return [
        ...h.invoke.mock.calls.flatMap((call) => payloadSizes(call[1])),
        ...h.fs.writeLog.map((write) => write.data.length),
    ]
}

beforeEach(() => {
    h.fs.reset()
    h.invoke.mockReset()
    h.invoke.mockResolvedValue(undefined)
})

describe('Android payload size', () => {
    test('writeFileDurable carries the file in payloads of at most one chunk', async () => {
        await writeFileDurable('blocks/gen/c/6162', input())

        const payloads = transportedPayloads()
        expect(payloads.reduce((sum, size) => sum + size, 0)).toBe(INPUT_BYTES)
        expect(Math.max(...payloads)).toBeLessThanOrEqual(ONE_MEGABYTE)
    })

    test('writeFileAtomic carries the file in payloads of at most one chunk', async () => {
        await writeFileAtomic('./database/database.bin', input())

        const payloads = transportedPayloads()
        expect(payloads.reduce((sum, size) => sum + size, 0)).toBe(INPUT_BYTES)
        expect(Math.max(...payloads)).toBeLessThanOrEqual(ONE_MEGABYTE)
    })
})
