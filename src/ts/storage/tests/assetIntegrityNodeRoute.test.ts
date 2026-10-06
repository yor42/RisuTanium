// @vitest-environment node
/**
 * On a Node-hosted page the asset route serves `assets/` keys, so the
 * service-worker cache copy the integrity tools check is not the copy a page
 * shows: the boot sample and the verify scan (both call `verifyAssetCacheEntry`)
 * must not read the cache for such a key. The Cache API is an in-memory
 * stand-in; every byte is synthetic.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const platform = vi.hoisted(() => ({ isNodeServer: false }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return platform.isNodeServer },
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn(async (bytes: Uint8Array) => Buffer.from(bytes).toString('hex').padEnd(64, '0').slice(0, 64)),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getBasename: (loc: string) => loc.split('/').pop() ?? '',
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { verifyAssetCacheEntry } from 'src/ts/storage/assetIntegrity'

const hexOf = (key: string) => Buffer.from(key, 'utf-8').toString('hex')
const HASH = 'ab'.repeat(32)

let open: ReturnType<typeof vi.fn>

beforeEach(() => {
    platform.isNodeServer = true
    const entries = new Map<string, Response>()
    const cache = {
        match: async (url: string) => entries.get(new URL(url, 'http://localhost').pathname),
    }
    entries.set(`/sw/img/${hexOf(`assets/${HASH}.png`)}`, new Response(Uint8Array.from([1, 2, 3])))
    entries.set(`/sw/img/${hexOf(`avatars/${HASH}.png`)}`, new Response(Uint8Array.from([1, 2, 3])))
    open = vi.fn(async () => cache)
    vi.stubGlobal('caches', { open })
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('verifying a cached asset on a Node-hosted page', () => {
    test('a key the route serves is not looked up in the cache', async () => {
        expect(await verifyAssetCacheEntry(`assets/${HASH}.png`)).toEqual({ status: 'not-cached' })
        expect(open).not.toHaveBeenCalled()
    })

    test('guard: a page with no Node server still checks the cached copy against its name', async () => {
        platform.isNodeServer = false
        const result = await verifyAssetCacheEntry(`assets/${HASH}.png`)
        expect(result.status).toBe('mismatch')
        expect(open).toHaveBeenCalledWith('risuCache')
    })

    test('guard: a key outside assets is still checked in the cache', async () => {
        const result = await verifyAssetCacheEntry(`avatars/${HASH}.png`)
        expect(result.status).toBe('mismatch')
        expect(open).toHaveBeenCalled()
    })

    test('guard: a key the route refuses is still checked in the cache', async () => {
        await verifyAssetCacheEntry(`assets/../${HASH}.png`)
        expect(open).toHaveBeenCalledWith('risuCache')
    })
})
