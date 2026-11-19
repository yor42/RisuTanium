// @vitest-environment node
/**
 * The stand-in for `read_store2_units` against the case table the Rust tests also run
 * (`store2UnitBatchCases.json`): its key statuses on both platform columns and its budget statuses, so a difference
 * between the stand-in and the command cannot hide behind a passing page-side suite. Then the desktop stand-in's mirror of
 * the per-key read probe and its size check. These are compatibility guards of the stand-ins: they pass before and after
 * the page change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fsModule = await import('src/ts/storage/tests/tauriFsFake')
    const desktopModule = await import('src/ts/storage/tests/tauriDesktopFake')
    const fs = fsModule.createFakeTauriFs({ strict: true })
    const desktop = desktopModule.createDesktopInvoke(fs, { probeReads: true })
    const capped = desktopModule.createDesktopInvoke(fs, { cap: 4 * 1024 * 1024, probeReads: true })
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    const knobs = new Map<string, string>()
    async function invoke(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<unknown> {
        const reply = await desktop.invoke(command, args, options)
        return command === 'write_durable' ? { flushed: true } : reply
    }
    return { fs, desktop, capped, paths, knobs, invoke }
})

vi.mock('@tauri-apps/plugin-fs', () => h.fs.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

import cases from './store2UnitBatchCases.json'
import { Store2BackendFailureError, createTauriBackend } from 'src/ts/storage/store2/backend'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { budgetStatuses, createChunkedInvoke } from './tauriChunkFake'
import { createFakeTauriFs } from './tauriFsFake'
import { absentCommit, bytesOf, unitKey } from './store2/backendConformance'

const STATUS_NAMES = ['ok', 'missing', 'invalid', 'error', 'large', 'deferred']

/** The status of each frame of a reply for `count` keys. */
function statusesOf(reply: ArrayBuffer, count: number): string[] {
    const bytes = new Uint8Array(reply)
    const view = new DataView(reply)
    const out: string[] = []
    let offset = 0
    for (let i = 0; i < count; i++) {
        out.push(STATUS_NAMES[bytes[offset]])
        offset += 5 + view.getUint32(offset + 1, true)
    }
    return out
}

describe('T4.14 the stand-in answers the shared key table as the Rust command does', () => {
    for (const column of ['windows', 'posix'] as const) {
        test(`the ${column} column`, async () => {
            const fs = createFakeTauriFs({ strict: true })
            const chunk = createChunkedInvoke(fs)
            chunk.windowsKeyRules(column === 'windows')
            const keys = cases.keys.map((row) => row.key)
            const planted = new Map<string, Uint8Array>()
            cases.keys.forEach((row, i) => {
                if (row[column] === 'ok') {
                    planted.set(row.key, Uint8Array.of(i, i + 1, 200 - i))
                    fs.plant(row.key, planted.get(row.key) as Uint8Array)
                }
            })
            // Files the keys must never reach: outside the prefix, or a different file than the key names.
            fs.plant('secret', Uint8Array.of(1))
            fs.plant('assets/a', Uint8Array.of(2))
            fs.plant('store2-commit', Uint8Array.of(3))
            fs.plant('store2-fence', Uint8Array.of(4))
            fs.plant('store2/a/b', Uint8Array.of(5))

            const reply = await chunk.invoke('read_store2_units', { keys }) as ArrayBuffer

            expect(statusesOf(reply, keys.length)).toEqual(cases.keys.map((row) => row[column]))
            // Every ok frame holds exactly the bytes planted at that key, and no other frame holds a body from a planted decoy.
            const bytes = new Uint8Array(reply)
            const view = new DataView(reply)
            let offset = 0
            for (const key of keys) {
                const length = view.getUint32(offset + 1, true)
                const body = bytes.subarray(offset + 5, offset + 5 + length)
                if (bytes[offset] === 0) {
                    expect([...body]).toEqual([...(planted.get(key) as Uint8Array)])
                }
                offset += 5 + length
            }
        })
    }

    test('the real unit bytes of the table are answered whole', async () => {
        const fs = createFakeTauriFs({ strict: true })
        const chunk = createChunkedInvoke(fs)
        const real = Uint8Array.from(Buffer.from(cases.realUnit.base64, 'base64'))
        fs.plant('store2/u-0123456789abcdefghijklmnop', real)

        const reply = new Uint8Array(await chunk.invoke('read_store2_units', { keys: ['store2/u-0123456789abcdefghijklmnop'] }) as ArrayBuffer)

        expect(real.length).toBe(cases.realUnit.length)
        expect([...reply.subarray(5)]).toEqual([...real])
    })

    test.each(cases.budget)('the budget case $name', (budget) => {
        expect(budgetStatuses(budget.sizes, budget.chunkMax, budget.responseMax)).toEqual(budget.statuses)
    })
})

describe('T4.23 the desktop stand-in mirrors the read probe and counts file bytes', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => h.knobs.get(key) ?? null,
        })
        h.fs.reset()
        h.desktop.reset()
        h.capped.reset()
        h.paths.reset()
        h.knobs.clear()
        h.desktop.chunk.reportFlushes()
        h.fs.setPlatform('windows')
        resetByteTransportForTests()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    async function committed() {
        const backend = await createTauriBackend(createTauriFilesStore({ platform: 'windows' }))
        const keys = [unitKey(1), unitKey(2), unitKey(3)]
        await backend.commitOrdinary((await absentCommit(backend)), keys.map((key, i) => ({ key, bytes: bytesOf(i + 1, 7, 8, 9) })), bytesOf(9))
        return { backend, keys }
    }

    test('a read fault on one unit rejects a multi-key read as the per-key read does, and its frame is error', async () => {
        const { backend, keys } = await committed()
        h.fs.failReadFiles('EIO', (path) => path.endsWith(keys[1]))
        const replies: ArrayBuffer[] = []
        h.desktop.chunk.rewriteBatchReply((reply) => {
            replies.push(reply.slice(0))
            return reply
        })

        const batched = await backend.readUnits(keys).catch((error: unknown) => error)
        h.knobs.set('risu-measure-store2-batch', 'off')
        const perKey = await backend.readUnits(keys).catch((error: unknown) => error)

        expect(perKey).toBeInstanceOf(Store2BackendFailureError)
        expect(batched).toBeInstanceOf(Store2BackendFailureError)
        expect(replies).toHaveLength(1)
        expect(statusesOf(replies[0], 3)).toEqual(['ok', 'error', 'ok'])
    })

    test('a batch whose file bytes total exactly the cap is not refused for its frame headers', async () => {
        const sizes = [1_398_101, 1_398_101, 1_398_102]
        const keys = sizes.map((_, i) => unitKey(i + 10))
        keys.forEach((key, i) => h.fs.plant(key, new Uint8Array(sizes[i])))

        const reply = await h.capped.invoke('read_store2_units', { keys }) as ArrayBuffer

        expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(4 * 1024 * 1024)
        expect(statusesOf(reply, 3)).toEqual(['ok', 'ok', 'ok'])
    })
})
