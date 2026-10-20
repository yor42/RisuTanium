/**
 * msgpackr keeps a view over the source of its last read, and the packr keeps the buffer its last encode grew to.
 * After `decodeRisuSave` or an encode has returned and its result is dropped, neither the decompressed source of a
 * legacy save nor the encoded bytes of an export may stay reachable from the codec.
 *
 * Measured as the change in `process.memoryUsage().arrayBuffers` across a forced collection, with a baseline taken
 * after a one-byte read has released any earlier source. Regression reproducers: red on the base that does not release,
 * green with the release. Fixture strings are shorter than 64 characters (msgpackr's encoder fails on longer ones
 * under this Node) except in the long-string regression, which uses longer strings under a scoped `utf8Write`
 * length clamp. Platform boundaries are mocked as in the other risuSave tests.
 */
import { describe, expect, test, vi } from 'vitest'
import v8 from 'node:v8'
import vm from 'node:vm'
import * as fflate from 'fflate'
import { decode, Packr } from 'msgpackr/index-no-eval'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import { decodeRisuSave, encodeRisuSaveCompressionStream, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

const COUNT = 40000
const MIB = 1048576

async function settle() {
    for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        gc()
    }
}

function bigTree(): { characters: { name: string, desc: string[] }[] } {
    const characters: { name: string, desc: string[] }[] = []
    for (let i = 0; i < COUNT; i++) {
        characters.push({ name: 'c' + i, desc: Array.from({ length: 40 }, (_, k) => 'seg' + k + '-' + i) })
    }
    return { characters }
}

const msgpackOf = (tree: object): Uint8Array => new Uint8Array(new Packr({ useRecords: false }).encode(tree))
const header = (last: number) => Uint8Array.of(0, 82, 73, 83, 85, 83, 65, 86, 69, 0, last)
const withHeader = (head: Uint8Array, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(head.length + body.length)
    out.set(head, 0)
    out.set(body, head.length)
    return out
}

/** Array-buffer memory still held after `run`'s result is dropped, relative to a baseline taken just before it. */
async function retainedAfter(prepare: () => Uint8Array, run: (bytes: Uint8Array) => Promise<unknown>): Promise<{ retained: number, outcome: PromiseSettledResult<unknown>, inputLength: number }> {
    const bytes: Uint8Array = prepare()
    // The codecs' module state is shared by every Packr and decode in this file: reset it so the baseline holds
    // nothing an earlier test left behind.
    decode(Uint8Array.of(0xc0))
    new Packr().useBuffer(Buffer.allocUnsafeSlow(8192))
    await settle()
    const before = process.memoryUsage().arrayBuffers
    let outcome: PromiseSettledResult<unknown> | null = await run(bytes).then(
        (value) => ({ status: 'fulfilled', value }) as const,
        (reason) => ({ status: 'rejected', reason }) as const,
    )
    const summary = outcome
    outcome = null
    await settle()
    // The input stays alive through the measurement, so only what the codec itself holds counts as retained.
    const after = process.memoryUsage().arrayBuffers
    return { retained: after - before, outcome: summary, inputLength: bytes.length }
}

describe('decodeRisuSave releases msgpackr\'s source', () => {
    const decodedCount = (outcome: PromiseSettledResult<unknown>): number => {
        expect(outcome.status).toBe('fulfilled')
        return ((outcome as PromiseFulfilledResult<{ characters: unknown[] }>).value).characters.length
    }

    test('a compressed legacy save leaves no decompressed buffer behind', async () => {
        const { retained, outcome } = await retainedAfter(
            () => encodeRisuSaveLegacy(bigTree(), 'compression'),
            (bytes) => decodeRisuSave(bytes),
        )
        expect(decodedCount(outcome)).toBe(COUNT)
        expect(retained).toBeLessThan(8 * MIB)
    })

    test('a raw legacy save whose first read fails and whose fallback read succeeds leaves no buffer behind', async () => {
        // The first read meets an unassigned token; the fallback read skips the six bytes the older writer prefixed.
        const body = withHeader(Uint8Array.of(0xc1, 0, 0, 0, 0, 0), msgpackOf(bigTree()))
        const { retained, outcome } = await retainedAfter(
            () => withHeader(header(7), body),
            (bytes) => decodeRisuSave(bytes),
        )
        expect(decodedCount(outcome)).toBe(COUNT)
        expect(retained).toBeLessThan(8 * MIB)
    })

    test('a strict read that fails after decoding a large source leaves no buffer behind and still rejects', async () => {
        // Bytes after the root value make the read fail once the whole tree has been decoded.
        const { retained, outcome } = await retainedAfter(
            () => withHeader(header(8), fflate.compressSync(withHeader(msgpackOf(bigTree()), Uint8Array.of(0xc0, 0xc0)), { mtime: 0 })),
            (bytes) => decodeRisuSave(bytes, { strict: true }),
        )
        expect(outcome.status).toBe('rejected')
        expect(retained).toBeLessThan(8 * MIB)
    })

    // Compatibility guard: passes before and after; the release must neither swallow nor change an error.
    test('guard: a strict read of unrecognized bytes still rejects with the original error', async () => {
        await expect(decodeRisuSave(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), { strict: true }))
            .rejects.toThrow('Unrecognized save data format')
    })

    // Compatibility guard: passes before and after; a read after the release is correct.
    test('guard: a read after a release decodes the same tree', async () => {
        const tree = { name: 'card', chats: [{ message: 'hello' }], n: 7 }
        const bytes = encodeRisuSaveLegacy(tree, 'compression')
        expect(await decodeRisuSave(bytes)).toEqual(tree)
        expect(await decodeRisuSave(bytes)).toEqual(tree)
    })
})

describe('the encoders release the packr\'s output buffer', () => {
    test('a legacy encode leaves no encoding behind once its result is dropped', async () => {
        const { retained, outcome } = await retainedAfter(
            () => new Uint8Array(0),
            async () => encodeRisuSaveLegacy(bigTree(), 'noCompression').length,
        )
        expect(outcome.status).toBe('fulfilled')
        expect((outcome as PromiseFulfilledResult<number>).value).toBeGreaterThan(10 * MIB)
        expect(retained).toBeLessThan(8 * MIB)
    })

    test('a compressed legacy encode leaves no encoding behind once its result is dropped', async () => {
        const { retained, outcome } = await retainedAfter(
            () => new Uint8Array(0),
            async () => encodeRisuSaveLegacy(bigTree(), 'compression').length,
        )
        expect(outcome.status).toBe('fulfilled')
        expect(retained).toBeLessThan(8 * MIB)
    })

    test('a stream-compressed encode leaves no encoding behind once its result is dropped', async () => {
        const { retained, outcome } = await retainedAfter(
            () => new Uint8Array(0),
            async () => (await encodeRisuSaveCompressionStream(bigTree())).length,
        )
        expect(outcome.status).toBe('fulfilled')
        expect(retained).toBeLessThan(8 * MIB)
    })

    // Regression: the buffer a release installs must be of the kind msgpackr allocates, because its long-string
    // path calls `utf8Write` on the target where a Buffer exists. This is the one fixture string of 64+ characters.
    test('regression: a string of 64 or more characters encodes after a release and decodes back', async () => {
        // msgpackr 1.10.1 passes a length past the buffer's end to `utf8Write` for such a string, which the Node running
        // the tests rejects (the browser build has no Buffer). Clamping to the room left changes no byte written.
        const proto = Buffer.prototype as unknown as { utf8Write(this: Uint8Array, text: string, position: number, length: number): number }
        const native = proto.utf8Write
        proto.utf8Write = function (text, position, length) {
            return native.call(this, text, position, Math.min(length, this.length - position))
        }
        try {
            const tree = { name: 'x'.repeat(300), note: 'y'.repeat(64) }
            encodeRisuSaveLegacy({ small: 1 }, 'noCompression')
            const bytes = encodeRisuSaveLegacy(tree, 'noCompression')
            expect(await decodeRisuSave(bytes)).toEqual(tree)
            await encodeRisuSaveCompressionStream({ small: 1 })
            const streamed = await encodeRisuSaveCompressionStream(tree)
            expect(await decodeRisuSave(streamed)).toEqual(tree)
        } finally {
            proto.utf8Write = native
        }
    })

    // Compatibility guard: passes before and after; releasing the buffer changes no byte of an export.
    test('guard: exports around a release are byte-identical', async () => {
        const tree = { name: 'card', chats: Array.from({ length: 200 }, (_, i) => ({ message: 'hello', index: i })), n: 7 }
        for (const mode of ['noCompression', 'compression'] as const) {
            const first = encodeRisuSaveLegacy(tree, mode)
            encodeRisuSaveLegacy(bigTree(), mode)
            const second = encodeRisuSaveLegacy(tree, mode)
            expect(Array.from(second)).toEqual(Array.from(first))
        }
        const streamFirst = await encodeRisuSaveCompressionStream(tree)
        await encodeRisuSaveCompressionStream({ other: 'value' })
        const streamSecond = await encodeRisuSaveCompressionStream(tree)
        expect(Array.from(streamSecond)).toEqual(Array.from(streamFirst))
        expect(await decodeRisuSave(streamSecond)).toEqual(tree)
    })
})
