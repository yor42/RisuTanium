/**
 * The store primitives of the inlay deleting pass: `removeUnusedAppInlay` (veto, delete order, body ownership)
 * and the set of ids this page wrote.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { chokePointInFlight, resetBusyActionsForTest } from '../../memory/busyActions'
import { inlayBodyKey, inlayMetaKey } from '../inlayKeys'
import { cacheInlayRender, cachedInlayRender, dropInlayRender } from '../inlayRenderCache'
import {
    inlayWrittenThisPage,
    readAppInlayRecord,
    removeUnusedAppInlay,
    resetInlaysWrittenForTests,
    writeAppInlay,
    type InlayAsset,
    type InlayVeto,
} from '../inlayStore'
import { createMemoryByteStore, type MemoryByteStore } from './memoryByteStore'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => undefined),
            removeItem: vi.fn(async () => undefined),
            keys: vi.fn(async () => []),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const stub: Record<string, unknown> = { DBState: { db: {} }, selIdState: { selId: -1 } }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/stores.svelte')
})

const ID = 'inlay-o'
const OTHER = 'inlay-x'
const NEVER = (): InlayVeto | null => null

let store: MemoryByteStore

beforeEach(() => {
    resetBusyActionsForTest()
    resetInlaysWrittenForTests()
    store = createMemoryByteStore()
})

async function put(id: string, text = 'payload'): Promise<{ meta: string, body: string }> {
    const asset: InlayAsset = { name: id, ext: 'txt', type: 'image', data: text }
    await writeAppInlay(store, id, asset)
    const record = (await readAppInlayRecord(store, id))!
    return { meta: inlayMetaKey(id)!, body: record.body }
}

function listed(): string[] {
    return [...store.files.keys()].sort()
}

describe('removeUnusedAppInlay', () => {
    test.each(['stop', 'changed', 'written'] as const)('a %s veto leaves every key and is returned as given', async (veto) => {
        const { meta, body } = await put(ID)
        const extra = inlayBodyKey(ID, 'ffffffffffffffff')!
        store.files.set(extra, new Uint8Array([1]))
        const before = listed()
        store.deletes.length = 0

        const result = await removeUnusedAppInlay(store, ID, [body, extra], () => veto)

        expect(result).toEqual({ status: 'kept', reason: 'vetoed', veto })
        expect(listed()).toEqual(before)
        expect(store.deletes).toEqual([])
        expect(store.files.has(meta)).toBe(true)
    })

    test('the veto is asked after the record is read and before the first delete', async () => {
        await put(ID)
        const order: string[] = []
        store.failRead = (key) => { order.push(`read:${key}`); return null }
        store.failDelete = (key) => { order.push(`delete:${key}`); return null }

        await removeUnusedAppInlay(store, ID, [], () => { order.push('veto'); return null })

        expect(order[0]).toBe(`read:${inlayMetaKey(ID)}`)
        expect(order[1]).toBe('veto')
        expect(order[2]).toBe(`delete:${inlayMetaKey(ID)}`)
    })

    test('a metadata that is absent or does not parse is kept and the veto is not asked', async () => {
        const veto = vi.fn(() => null)
        expect(await removeUnusedAppInlay(store, ID, [], veto)).toEqual({ status: 'kept', reason: 'unreadable' })
        store.files.set(inlayMetaKey(ID)!, new TextEncoder().encode(JSON.stringify({ v: 2 })))
        expect(await removeUnusedAppInlay(store, ID, [], veto)).toEqual({ status: 'kept', reason: 'unreadable' })
        expect(veto).not.toHaveBeenCalled()
        expect(store.files.has(inlayMetaKey(ID)!)).toBe(true)
    })

    test('the metadata is deleted first, then the named body, then the other listed bodies', async () => {
        const { meta, body } = await put(ID)
        const extraA = inlayBodyKey(ID, 'aaaaaaaaaaaaaaaa')!
        const extraB = inlayBodyKey(ID, 'bbbbbbbbbbbbbbbb')!
        store.files.set(extraA, new Uint8Array([1]))
        store.files.set(extraB, new Uint8Array([2]))
        store.deletes.length = 0

        const result = await removeUnusedAppInlay(store, ID, [extraA, body, extraB], NEVER)

        expect(result).toEqual({ status: 'removed', bodies: 3, bodyFailures: 0, foreignBody: false })
        expect(store.deletes).toEqual([meta, body, extraA, extraB])
        expect(listed()).toEqual([])
    })

    test('a failed body delete is counted and the remaining bodies are still deleted', async () => {
        const { meta, body } = await put(ID)
        const extra = inlayBodyKey(ID, 'aaaaaaaaaaaaaaaa')!
        store.files.set(extra, new Uint8Array([1]))
        store.failDelete = (key) => (key === body ? new Error('disk') : null)

        const result = await removeUnusedAppInlay(store, ID, [body, extra], NEVER)

        expect(result).toEqual({ status: 'removed', bodies: 1, bodyFailures: 1, foreignBody: false })
        expect(store.files.has(meta)).toBe(false)
        expect(store.files.has(extra)).toBe(false)
        expect(store.files.has(body)).toBe(true)
    })

    test('a failed metadata delete throws and no body is touched', async () => {
        const { meta, body } = await put(ID)
        const extra = inlayBodyKey(ID, 'aaaaaaaaaaaaaaaa')!
        store.files.set(extra, new Uint8Array([1]))
        store.failDelete = (key) => (key === meta ? new Error('disk') : null)
        store.deletes.length = 0

        await expect(removeUnusedAppInlay(store, ID, [body, extra], NEVER)).rejects.toThrow('disk')

        expect(store.deletes).toEqual([])
        expect(store.files.has(meta)).toBe(true)
        expect(store.files.has(body)).toBe(true)
        expect(store.files.has(extra)).toBe(true)
    })

    test('a record naming another id\'s body deletes the metadata and the id\'s own listed bodies but not the foreign body', async () => {
        const mine = await put(ID)
        const theirs = await put(OTHER)
        const record = (await readAppInlayRecord(store, ID))!
        store.files.set(mine.meta, new TextEncoder().encode(JSON.stringify({ ...record, body: theirs.body })))
        store.deletes.length = 0

        const result = await removeUnusedAppInlay(store, ID, [mine.body], NEVER)

        expect(result).toEqual({ status: 'removed', bodies: 1, bodyFailures: 0, foreignBody: true })
        expect(store.deletes).toEqual([mine.meta, mine.body])
        expect(store.files.has(theirs.body)).toBe(true)
        expect(store.files.has(theirs.meta)).toBe(true)
    })

    test('the work counts as in flight and the busy count returns to zero', async () => {
        await put(ID)
        let during = -1
        await removeUnusedAppInlay(store, ID, [], () => { during = chokePointInFlight('inlay'); return null })
        expect(during).toBeGreaterThan(0)
        expect(chokePointInFlight('inlay')).toBe(0)
    })

    describe('the cached render', () => {
        const URL_OF_RENDER = 'blob:staged-preview'
        let revoke: MockInstance<typeof URL.revokeObjectURL>

        beforeEach(() => {
            revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
            cacheInlayRender(ID, { type: 'image', url: URL_OF_RENDER, source: 'memory-blob' }, URL_OF_RENDER)
        })

        afterEach(() => {
            revoke.mockRestore()
            dropInlayRender(ID, false)
        })

        test.each(['stop', 'changed', 'written'] as const)('a %s veto keeps the render and revokes no URL', async (veto) => {
            await put(ID)
            revoke.mockClear()
            cacheInlayRender(ID, { type: 'image', url: URL_OF_RENDER, source: 'memory-blob' }, URL_OF_RENDER)

            await removeUnusedAppInlay(store, ID, [], () => veto)

            expect(cachedInlayRender(ID)).not.toBeNull()
            expect(revoke).not.toHaveBeenCalled()
        })

        test('an unreadable metadata keeps the render and revokes no URL', async () => {
            await removeUnusedAppInlay(store, ID, [], NEVER)

            expect(cachedInlayRender(ID)).not.toBeNull()
            expect(revoke).not.toHaveBeenCalled()
        })

        test('a failed metadata delete keeps the render and revokes no URL', async () => {
            const { meta } = await put(ID)
            revoke.mockClear()
            cacheInlayRender(ID, { type: 'image', url: URL_OF_RENDER, source: 'memory-blob' }, URL_OF_RENDER)
            store.failDelete = (key) => (key === meta ? new Error('disk') : null)

            await expect(removeUnusedAppInlay(store, ID, [], NEVER)).rejects.toThrow('disk')

            expect(cachedInlayRender(ID)).not.toBeNull()
            expect(revoke).not.toHaveBeenCalled()
        })

        test('a removed inlay drops the render and revokes its URL once', async () => {
            await put(ID)
            revoke.mockClear()
            cacheInlayRender(ID, { type: 'image', url: URL_OF_RENDER, source: 'memory-blob' }, URL_OF_RENDER)

            const result = await removeUnusedAppInlay(store, ID, [], NEVER)

            expect(result.status).toBe('removed')
            expect(cachedInlayRender(ID)).toBeNull()
            expect(revoke).toHaveBeenCalledTimes(1)
            expect(revoke).toHaveBeenCalledWith(URL_OF_RENDER)
        })
    })
})

describe('the written set', () => {
    test('writeAppInlay notes the id on entry, even when the write fails', async () => {
        expect(inlayWrittenThisPage(ID)).toBe(false)
        store.failWrite = () => new Error('disk')
        const asset: InlayAsset = { name: ID, ext: 'txt', type: 'image', data: 'x' }
        await expect(writeAppInlay(store, ID, asset)).rejects.toThrow('disk')
        expect(inlayWrittenThisPage(ID)).toBe(true)
        expect(inlayWrittenThisPage(OTHER)).toBe(false)
    })

    test('an id without a key is not noted', async () => {
        await expect(writeAppInlay(store, '', { data: 'x' })).rejects.toThrow()
        expect(inlayWrittenThisPage('')).toBe(false)
    })

    test('the reset empties the set', async () => {
        await put(ID)
        expect(inlayWrittenThisPage(ID)).toBe(true)
        resetInlaysWrittenForTests()
        expect(inlayWrittenThisPage(ID)).toBe(false)
    })
})
