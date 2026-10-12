/**
 * CHORE-200: a cold-storage unit whose compressed bytes are over the Node
 * server's body limit is refused before any upload, and the typed result tells
 * a size refusal from every other failure. The real `writeColdStorageUnit` and
 * `setColdStorageItem` run over a spy store; the platform and the limit (4 KiB)
 * are stand-ins. A passing test here says nothing about a real Node server.
 *
 * Labels: "regression reproducer" fails on the base for the defect it names
 * (an upload is attempted for a unit that cannot be accepted); "new behaviour"
 * tests the typed result, which does not exist on the base; "guard" pins a
 * property of the new check and names the mutation it catches, and fails on the
 * base only because the function it calls is absent there.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { StoreVersionConflictError } from 'src/ts/storage/store/errors'
import { NodeHttpError } from 'src/ts/storage/store/nodeHttpStore'

const LIMIT = 4096

const p = vi.hoisted(() => ({ node: true }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return p.node },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/nodeBodyLimit'), () => ({
    NODE_BODY_LIMIT_BYTES: 4096,
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { state: -1, selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

import { setColdStorageItem, writeColdStorageUnit, getColdUnitStamp } from 'src/ts/process/coldstorage.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { anyChokePointInFlight } from 'src/ts/process/memory/busyActions'

const KEY = '00000000-0000-4000-8000-0000000000bb'

/** Bytes that do not compress: the compressed length stays close to the text length. */
function incompressible(length: number): string {
    let state = 12345
    let out = ''
    while (out.length < length) {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        out += state.toString(36)
    }
    return out.slice(0, length)
}

const writes: Array<{ key: string, length: number }> = []
let writeError: Error | null = null

function spyStore(): ByteStore {
    return {
        capabilities: { conditionalWrites: false },
        read: async () => ({ bytes: null, version: null }),
        write: async (key, bytes) => {
            if (writeError) {
                throw writeError
            }
            writes.push({ key, length: bytes.length })
            return { version: null }
        },
        delete: async () => {},
        deleteMany: async () => {},
        list: async () => [],
        has: async () => false,
    } as unknown as ByteStore
}

/** A value whose compressed length is exactly `target`, found by bisecting the payload length. */
async function valueCompressingTo(target: number): Promise<{ value: { blob: string }, compressedLength: number }> {
    const { compress } = await import('fflate')
    const lengthOf = (size: number) => new Promise<number>((resolve, reject) => {
        const json = JSON.stringify({ blob: incompressible(size) })
        compress(new TextEncoder().encode(json), (err, out) => err ? reject(err) : resolve(out.length))
    })
    let low = Math.floor(target * 0.5)
    let high = target * 2
    while (low < high) {
        const mid = Math.floor((low + high) / 2)
        if (await lengthOf(mid) < target) {
            low = mid + 1
        } else {
            high = mid
        }
    }
    return { value: { blob: incompressible(low) }, compressedLength: await lengthOf(low) }
}

beforeEach(() => {
    p.node = true
    writes.length = 0
    writeError = null
    injectAppStore(spyStore())
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    injectAppStore(null)
})

describe('a unit over the Node body limit', () => {
    test('regression reproducer (CHORE-200): on Node an oversize unit is refused with no store write, and setColdStorageItem answers false', async () => {
        const written = await setColdStorageItem(KEY, { blob: incompressible(LIMIT * 3) })

        expect(written).toBe(false)
        expect(writes).toHaveLength(0)
    })

    test('guard: a unit whose compressed length equals the limit is written; catches > turned into >=', async () => {
        const { value, compressedLength } = await valueCompressingTo(LIMIT)
        expect(compressedLength).toBe(LIMIT)

        expect(await writeColdStorageUnit(KEY, value)).toBe('written')
        expect(writes).toEqual([{ key: expect.stringContaining(KEY), length: LIMIT }])
    })

    test('guard: one byte over the limit is refused; catches a limit raised by one', async () => {
        const { value, compressedLength } = await valueCompressingTo(LIMIT + 1)
        expect(compressedLength).toBe(LIMIT + 1)

        expect(await writeColdStorageUnit(KEY, value)).toBe('too-large')
        expect(writes).toHaveLength(0)
    })

    test('guard: the same payload on another platform is written; catches dropping isNodeServer from the check', async () => {
        p.node = false

        expect(await writeColdStorageUnit(KEY, { blob: incompressible(LIMIT * 3) })).toBe('written')
        expect(writes).toHaveLength(1)
    })

    test('new behaviour: writeColdStorageUnit answers too-large for an oversize unit and for a 413 to the write, and failed for any other failure', async () => {
        expect(await writeColdStorageUnit(KEY, { blob: incompressible(LIMIT * 3) })).toBe('too-large')

        writeError = new NodeHttpError(413, 'write')
        expect(await writeColdStorageUnit(KEY, { small: 1 })).toBe('too-large')

        writeError = new NodeHttpError(500, 'write')
        expect(await writeColdStorageUnit(KEY, { small: 1 })).toBe('failed')

        writeError = new NodeHttpError(413, 'read')
        expect(await writeColdStorageUnit(KEY, { small: 1 })).toBe('failed')

        writeError = new StoreVersionConflictError(KEY, 3)
        expect(await writeColdStorageUnit(KEY, { small: 1 })).toBe('failed')

        writeError = null
        expect(await writeColdStorageUnit('not a safe key/..', { small: 1 })).toBe('failed')
    })

    test('guard: after a too-large refusal no choke point is held and the unit stamp is settled; catches an early return outside the try/finally', async () => {
        expect(await writeColdStorageUnit(KEY, { blob: incompressible(LIMIT * 3) })).toBe('too-large')

        expect(anyChokePointInFlight()).toBe(false)
        expect(getColdUnitStamp(KEY)).not.toBeNull()
    })
})
