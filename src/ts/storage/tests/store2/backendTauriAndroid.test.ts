// @vitest-environment node
/**
 * The store2 Tauri backend over the real `createTauriFilesStore` with the Android
 * transport selected (`write_chunk`), on the chunk command and file system
 * stand-ins: the concurrent unit writes of `commitOrdinary` and the flush gate in
 * front of the commit key as they reach the transport that a phone uses. A pass
 * is not evidence about the Rust commands or the native bridge. The stand-ins are shared through `androidTauriWorld`.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => (await import('src/ts/storage/tests/store2/androidTauriWorld')).createAndroidTauriWorld())

vi.mock('@tauri-apps/plugin-fs', () => h.fs.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }))

import { Store2BackendFailureError, createTauriBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { absentCommit, absentFence, bytesOf, unit, unitKey } from './backendConformance'

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const unitKeys = (count: number): string[] => Array.from({ length: count }, (_, i) => unitKey(i + 1))
const units = (count: number) => unitKeys(count).map((_, i) => unit(i + 1))

async function open(): Promise<Store2Backend> {
    return await createTauriBackend(createTauriFilesStore({ platform: 'posix' }))
}

describe('tauri backend, android transport', () => {
    beforeEach(() => {
        h.reset()
    })

    test('unit writes overlap, at most four are in flight, and the commit key is written last after every unit write has ended', async () => {
        const backend = await open()
        h.writes.before = () => tick(5)

        const result = await backend.commitOrdinary(await absentCommit(backend), units(7), bytesOf(5))

        expect(result).toEqual({ flushed: true })
        expect(h.writes.peak).toBe(4)
        const commitStart = h.writes.events.indexOf(`start ${COMMIT_KEY}`)
        for (const key of unitKeys(7)) {
            expect(h.writes.events.indexOf(`end ${key}`)).toBeLessThan(commitStart)
        }
    })

    test('a failing unit with a slower sibling in flight: the sibling settles before the mutex is released and the commit key is untouched', async () => {
        const backend = await open()
        const base = await absentCommit(backend)
        const absent = await absentFence(backend)
        h.chunk.failWrites((call) => call.key === unitKey(2) ? 'disk full' : undefined)
        let release!: () => void
        h.writes.before = (key) => key === unitKey(3) ? new Promise<void>((resolve) => { release = resolve }) : undefined
        const commit = backend.commitOrdinary(base, units(3), bytesOf(5)).catch((error: unknown) => error)
        await vi.waitFor(() => expect(h.writes.events).toContain(`start ${unitKey(3)}`))
        const queued = backend.casFence(absent, bytesOf(8))

        await tick()
        expect(h.writes.events).not.toContain(`start ${FENCE_KEY}`)

        release()
        expect(await commit).toBeInstanceOf(Store2BackendFailureError)
        await queued
        expect(h.writes.events.indexOf(`end ${unitKey(3)}`)).toBeLessThan(h.writes.events.indexOf(`start ${FENCE_KEY}`))
        expect(h.fs.files.has(COMMIT_KEY)).toBe(false)
    })

    test('a unit whose directory flush failed blocks the commit key', async () => {
        const backend = await open()
        h.chunk.failFlushes((call) => call.key === unitKey(2))

        const error = await backend.commitOrdinary(await absentCommit(backend), units(3), bytesOf(5)).catch((e: unknown) => e)

        expect(error).toBeInstanceOf(Store2BackendFailureError)
        expect((error as Error).message).toContain(unitKey(2))
        expect(h.writes.events).not.toContain(`start ${COMMIT_KEY}`)
        expect(h.fs.files.has(COMMIT_KEY)).toBe(false)
    })
})
