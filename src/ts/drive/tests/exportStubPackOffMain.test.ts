/**
 * With a worker available and the page visible, a stub collection runs no deflate on the main thread.
 *
 * (R) regression reproducer: against the collection before the packing worker, `deflateSync` is called from the collection
 * once for each stub. The file imports only exports that exist before the change, and the fake `Worker` is never
 * constructed there, so the failure is behavioural, not a setup failure.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ColdCopyOutcome } from 'src/ts/process/coldCharacterRestore'
import { readStubsForExport } from 'src/ts/drive/exportInline'
import type { character } from 'src/ts/storage/database.svelte'
import { installFakePackWorker, type FakePackController } from './fakePackWorker'

const deflateBox = vi.hoisted(() => ({ outsideWorker: 0, inWorker: false }))

vi.mock('fflate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fflate')>()
    return {
        ...actual,
        deflateSync: (data: Uint8Array, options?: import('fflate').DeflateOptions) => {
            if (!deflateBox.inWorker) {
                deflateBox.outsideWorker += 1
            }
            return actual.deflateSync(data, options)
        },
    }
})

vi.mock('src/ts/process/coldCharacterRestore', () => ({
    readColdCharacterCopy: async (slot: { coldstorage: string, chaId: string }): Promise<ColdCopyOutcome> => ({
        status: 'ok',
        character: { chaId: slot.chaId, name: `whole-${slot.coldstorage}`, desc: slot.chaId.repeat(100) },
    }) as unknown as ColdCopyOutcome,
}))
vi.mock('src/ts/process/coldstorage.svelte', () => ({ collectColdStorageBackupPayloads: vi.fn() }))
vi.mock('src/ts/process/coldstorageData', () => ({
    getColdStorageBackupName: (key: string) => `coldstorage_${key}.json`,
    listColdBackupRoots: () => [],
    listColdPluginStorageKeys: () => [],
}))
vi.mock('src/ts/process/coldCharacter', () => ({
    applyStubStateOnRestore: (_stub: unknown, whole: unknown) => whole,
    coldUnitCharacter: (source: unknown) => source,
}))

function unit(n: number): string {
    return n.toString(32).padStart(26, '0')
}

let controller: FakePackController | null = null

beforeEach(() => {
    deflateBox.outsideWorker = 0
    deflateBox.inWorker = false
})

afterEach(() => {
    controller?.uninstall()
    controller = null
})

describe('the packing deflate', () => {
    test('(R) with a worker available no deflate runs outside it, and every stub still gets its entry', async () => {
        const actual = await vi.importActual<typeof import('fflate')>('fflate')
        controller = installFakePackWorker({
            pack: (data) => {
                const message = data as { id: number, bytes: Uint8Array }
                deflateBox.inWorker = true
                try {
                    return { id: message.id, packed: actual.deflateSync(message.bytes, { level: 1 }) }
                } finally {
                    deflateBox.inWorker = false
                }
            },
        })
        const slots = Array.from({ length: 8 }, (_, i) => ({ chaId: `cha${i + 1}`, name: `stub-${i + 1}`, coldstorage: unit(i + 1) }) as unknown as character)

        const result = await readStubsForExport({ characters: slots } as never, { mode: 'stub' })

        expect(result.stubEntries.size).toBe(8)
        expect(deflateBox.outsideWorker).toBe(0)
    })
})
