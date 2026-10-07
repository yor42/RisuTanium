/**
 * Every write to the inlay stores (`inlays.ts`) counts as an in-flight write for
 * the busy registry's choke-point counter until the store call settles, whether
 * it resolves or rejects.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    hold: null as null | Promise<void>,
    failNext: false,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
            removeItem: vi.fn(async () => {
                if (h.hold) {
                    await h.hold
                }
            }),
        }),
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = { forageStorage: {} }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const stub: Record<string, unknown> = { DBState: { db: {} }, selIdState: { selId: -1 } }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ flags: [] })),
    LLMFlags: {},
    LLMFormat: {},
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/util'), () => ({
    asBuffer: vi.fn((data: unknown) => data),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

import { removeInlayAsset, saveInlayedSignature } from './inlays'
import { chokePointInFlight, resetBusyActionsForTest } from '../memory/busyActions'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createMemoryByteStore } from './tests/memoryByteStore'

beforeEach(() => {
    resetBusyActionsForTest()
    h.hold = null
    h.failNext = false
    const store = createMemoryByteStore()
    const write = store.write.bind(store)
    store.write = async (key, bytes, condition) => {
        if (h.hold) {
            await h.hold
        }
        if (h.failNext) {
            h.failNext = false
            throw new Error('simulated inlay write failure')
        }
        return write(key, bytes, condition)
    }
    injectAppStore(store)
})

const signature = { signatures: [], sourceFormat: 0, source: 'test' } as unknown as Parameters<typeof saveInlayedSignature>[1]

describe('the inlay store writes', () => {
    test('a write counts as in flight until the store call settles', async () => {
        let release: () => void = () => {}
        h.hold = new Promise<void>((resolve) => { release = resolve })

        const pending = saveInlayedSignature('sig-1', signature)
        await vi.waitFor(() => {
            expect(chokePointInFlight('inlay')).toBe(1)
        }, { timeout: 2000, interval: 5 })

        h.hold = null
        release()
        await pending
        expect(chokePointInFlight('inlay')).toBe(0)
    })

    test('a write that rejects still ends its count', async () => {
        h.failNext = true

        await expect(saveInlayedSignature('sig-2', signature)).rejects.toThrow('simulated inlay write failure')

        expect(chokePointInFlight('inlay')).toBe(0)
    })

    test('a removal counts as in flight until it settles', async () => {
        let release: () => void = () => {}
        h.hold = new Promise<void>((resolve) => { release = resolve })

        const pending = removeInlayAsset('sig-3')
        await vi.waitFor(() => {
            expect(chokePointInFlight('inlay')).toBe(1)
        }, { timeout: 2000, interval: 5 })

        h.hold = null
        release()
        await pending
        expect(chokePointInFlight('inlay')).toBe(0)
    })
})
