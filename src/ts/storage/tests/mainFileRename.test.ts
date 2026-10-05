// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { BLOCK_TYPE_CHARACTER_WITH_CHAT, FILE_HEADER_V1, bytesEqual, frameBlock } from 'src/ts/storage/blockFrame'
import { finishMainFileRename } from 'src/ts/storage/mainFileRename'
import { fingerprintMainFile, preBlocksKey } from 'src/ts/storage/mainFileFingerprint'
import { createFakeStore } from './blockStoreHarness'

const MAIN = 'database/database.bin'

function blockFile(contents: string[]): Uint8Array {
    const blocks = contents.map((text, i) => frameBlock(BLOCK_TYPE_CHARACTER_WITH_CHAT, `c${i}`, new TextEncoder().encode(text)))
    const out = new Uint8Array(FILE_HEADER_V1.length + blocks.reduce((sum, block) => sum + block.length, 0))
    out.set(FILE_HEADER_V1, 0)
    let offset = FILE_HEADER_V1.length
    for (const block of blocks) {
        out.set(block, offset)
        offset += block.length
    }
    return out
}

const OLD_FILE = blockFile(['one', 'two'])
const FROM = fingerprintMainFile(OLD_FILE)

describe.each([{ versioned: false }, { versioned: true }])('the rename finish of a conversion, versioned=$versioned', ({ versioned }) => {
    test('a main file that matches the conversion is copied to the first pre-blocks name and then deleted', async () => {
        const store = createFakeStore({ versioned })
        store.plant(MAIN, OLD_FILE)
        const result = await finishMainFileRename(store, FROM)
        expect(result).toEqual({ kind: 'renamed', target: preBlocksKey(0) })
        expect(store.peek(MAIN)).toBeNull()
        expect(Array.from(store.peek(preBlocksKey(0)) ?? [])).toEqual(Array.from(OLD_FILE))
        const mutations = store.mutating()
        expect(mutations.map((op) => op.kind + ':' + op.key)).toEqual([`write:${preBlocksKey(0)}`, `delete:${MAIN}`])
    })

    test('with no main file there is nothing to do and nothing is read', async () => {
        const store = createFakeStore({ versioned })
        expect(await finishMainFileRename(store, FROM)).toEqual({ kind: 'no-main-file' })
        expect(store.ops.filter((op) => op.kind === 'read')).toEqual([])
        expect(store.mutating()).toEqual([])
    })

    test('a crash between the copy and the delete is finished by the next run: the main file equals the pre-blocks copy and is deleted', async () => {
        const store = createFakeStore({ versioned })
        store.plant(MAIN, OLD_FILE)
        store.plant(preBlocksKey(0), OLD_FILE)
        expect(await finishMainFileRename(store, FROM)).toEqual({ kind: 'deleted-main' })
        expect(store.peek(MAIN)).toBeNull()
        expect(bytesEqual(store.peek(preBlocksKey(0)) as Uint8Array, OLD_FILE)).toBe(true)
    })

    test('a pre-blocks file with other bytes is never overwritten: the copy goes to a numbered name', async () => {
        const store = createFakeStore({ versioned })
        const other = blockFile(['other'])
        store.plant(MAIN, OLD_FILE)
        store.plant(preBlocksKey(0), other)
        expect(await finishMainFileRename(store, FROM)).toEqual({ kind: 'renamed', target: preBlocksKey(1) })
        expect(Array.from(store.peek(preBlocksKey(0)) ?? [])).toEqual(Array.from(other))
        expect(Array.from(store.peek(preBlocksKey(1)) ?? [])).toEqual(Array.from(OLD_FILE))
        expect(store.peek(MAIN)).toBeNull()
    })

    test('a file written after the conversion is left alone, wherever it came from', async () => {
        const store = createFakeStore({ versioned })
        const newer = blockFile(['upstream wrote this later'])
        store.plant(MAIN, newer)
        expect(await finishMainFileRename(store, FROM)).toEqual({ kind: 'left' })
        expect(Array.from(store.peek(MAIN) ?? [])).toEqual(Array.from(newer))
        expect(store.mutating()).toEqual([])
    })

    test('after a completed rename, a new main file is untouched at the next run', async () => {
        const store = createFakeStore({ versioned })
        store.plant(MAIN, OLD_FILE)
        await finishMainFileRename(store, FROM)
        const newer = blockFile(['written after the rename'])
        store.plant(MAIN, newer)
        expect(await finishMainFileRename(store, FROM)).toEqual({ kind: 'left' })
        expect(Array.from(store.peek(MAIN) ?? [])).toEqual(Array.from(newer))
        expect(Array.from(store.peek(preBlocksKey(0)) ?? [])).toEqual(Array.from(OLD_FILE))
    })

    test('a head with no fingerprint and no pre-blocks copy leaves the file without reading it', async () => {
        const store = createFakeStore({ versioned })
        store.plant(MAIN, OLD_FILE)
        const start = store.ops.length
        expect(await finishMainFileRename(store, null)).toEqual({ kind: 'left' })
        expect(store.ops.slice(start).filter((op) => op.kind === 'read')).toEqual([])
        expect(store.peek(MAIN)).not.toBeNull()
    })

    test('a head with no fingerprint still deletes a main file that equals a pre-blocks copy', async () => {
        const store = createFakeStore({ versioned })
        store.plant(MAIN, OLD_FILE)
        store.plant(preBlocksKey(0), OLD_FILE)
        expect(await finishMainFileRename(store, null)).toEqual({ kind: 'deleted-main' })
        expect(store.peek(MAIN)).toBeNull()
    })

    test('a failed copy leaves the main file in place and reports the failure', async () => {
        const store = createFakeStore({ versioned })
        store.plant(MAIN, OLD_FILE)
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === preBlocksKey(0), mode: 'before' })
        const result = await finishMainFileRename(store, FROM)
        expect(result.kind).toBe('failed')
        expect(Array.from(store.peek(MAIN) ?? [])).toEqual(Array.from(OLD_FILE))
        expect(store.peek(preBlocksKey(0))).toBeNull()
    })

    test('a failed delete after the copy leaves both, and the next run deletes the main file', async () => {
        const store = createFakeStore({ versioned })
        store.plant(MAIN, OLD_FILE)
        store.faults.push({ match: (op) => op.kind === 'delete' && op.key === MAIN, mode: 'before' })
        expect((await finishMainFileRename(store, FROM)).kind).toBe('failed')
        expect(store.peek(MAIN)).not.toBeNull()
        expect(store.peek(preBlocksKey(0))).not.toBeNull()
        expect(await finishMainFileRename(store, FROM)).toEqual({ kind: 'deleted-main' })
        expect(store.peek(MAIN)).toBeNull()
    })
})

describe.each([{ versioned: false }, { versioned: true }])('a main file written while the finish runs, versioned=$versioned', ({ versioned }) => {
    /** A store that lands `newer` under the main key right after the finish first reads it. */
    function storeWithWriterAfterMainRead(newer: Uint8Array) {
        const inner = createFakeStore({ versioned })
        let armed = true
        const store = Object.create(inner) as typeof inner
        store.read = async (key: string) => {
            const result = await inner.read(key)
            if (armed && key === MAIN) {
                armed = false
                inner.plant(MAIN, newer)
            }
            return result
        }
        return { store, inner }
    }

    test('the copy-then-delete branch leaves the newer file and reports it as left', async () => {
        const newer = blockFile(['an upstream save that landed during the copy'])
        const { store, inner } = storeWithWriterAfterMainRead(newer)
        inner.plant(MAIN, OLD_FILE)

        const result = await finishMainFileRename(store, FROM)

        expect(result.kind).toBe('left')
        expect(Array.from(inner.peek(MAIN) ?? [])).toEqual(Array.from(newer))
    })

    test('the delete-only branch (a pre-blocks copy already equals the file) leaves the newer file and reports it as left', async () => {
        const newer = blockFile(['an upstream save that landed before the delete'])
        const { store, inner } = storeWithWriterAfterMainRead(newer)
        inner.plant(MAIN, OLD_FILE)
        inner.plant(preBlocksKey(0), OLD_FILE)

        const result = await finishMainFileRename(store, FROM)

        expect(result.kind).toBe('left')
        expect(Array.from(inner.peek(MAIN) ?? [])).toEqual(Array.from(newer))
    })
})

describe('the Node body limit', () => {
    test('a main file over the limit cannot be copied through the store: it stays and the result says so', async () => {
        const store = createFakeStore({ versioned: true })
        store.plant(MAIN, OLD_FILE)
        const result = await finishMainFileRename(store, FROM, { nodeBodyLimit: OLD_FILE.length - 1 })
        expect(result).toEqual({ kind: 'left-over-limit' })
        expect(store.peek(MAIN)).not.toBeNull()
        expect(store.mutating()).toEqual([])
    })

    test('a main file over the limit that equals a pre-blocks copy is deleted: no copy is needed', async () => {
        const store = createFakeStore({ versioned: true })
        store.plant(MAIN, OLD_FILE)
        store.plant(preBlocksKey(0), OLD_FILE)
        expect(await finishMainFileRename(store, FROM, { nodeBodyLimit: OLD_FILE.length - 1 })).toEqual({ kind: 'deleted-main' })
    })

    test('a store without conditional writes has no limit', async () => {
        const store = createFakeStore({ versioned: false })
        store.plant(MAIN, OLD_FILE)
        expect(await finishMainFileRename(store, FROM, { nodeBodyLimit: 1 })).toMatchObject({ kind: 'renamed' })
    })
})
