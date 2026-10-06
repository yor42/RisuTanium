// @vitest-environment node
/**
 * The one-time removal, on a Node-hosted page, of the service-worker cache
 * entries the asset route serves. The Cache API is an in-memory stand-in;
 * every byte is synthetic.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const platform = vi.hoisted(() => ({ isNodeServer: false }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return platform.isNodeServer },
}) as unknown as typeof import('src/ts/platform'))

import {
    cleanRouteServedCacheOnce,
    removeRouteServedCacheEntries,
    ROUTE_CACHE_CLEANUP_FLAG,
} from 'src/ts/storage/routeCacheCleanup'

const hexOf = (key: string) => Buffer.from(key, 'utf-8').toString('hex')
const HASH = 'ab'.repeat(32)

class MemoryCache {
    readonly entries = new Map<string, Response>()

    async keys() {
        return Array.from(this.entries.keys()).map((path) => new Request(`http://localhost${path}`))
    }

    async delete(request: Request | string) {
        const path = new URL(typeof request === 'string' ? request : request.url, 'http://localhost').pathname
        return this.entries.delete(path)
    }

    put(path: string) {
        this.entries.set(path, new Response(Uint8Array.from([1, 2, 3])))
    }
}

let cache: MemoryCache
let open: ReturnType<typeof vi.fn>

function memoryFlags() {
    const values = new Map<string, string>()
    return {
        values,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value) },
    }
}

function seed() {
    cache.put(`/sw/img/${hexOf(`assets/${HASH}.png`)}`)
    cache.put(`/sw/img/${hexOf('assets/nested/custom.mp4')}`)
    cache.put(`/sw/img/${hexOf('avatars/me.png')}`)
    cache.put(`/sw/img/${hexOf('assets/../database/database.bin')}`)
    cache.put(`/sw/img/${hexOf('assets/a\\b.png')}`)
    cache.put('/sw/share/abc123')
    cache.put('/tf/model.onnx')
}

beforeEach(() => {
    platform.isNodeServer = true
    cache = new MemoryCache()
    open = vi.fn(async () => cache)
    vi.stubGlobal('caches', { open })
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('removing the cache entries the route serves', () => {
    test('deletes only /sw/img/ entries whose key the route serves', async () => {
        seed()
        expect(await removeRouteServedCacheEntries()).toBe(2)
        expect(Array.from(cache.entries.keys()).sort()).toEqual([
            '/sw/share/abc123',
            '/tf/model.onnx',
            `/sw/img/${hexOf('assets/../database/database.bin')}`,
            `/sw/img/${hexOf('assets/a\\b.png')}`,
            `/sw/img/${hexOf('avatars/me.png')}`,
        ].sort())
    })

    test('keeps an entry whose name is not hex', async () => {
        cache.put('/sw/img/not-hex')
        cache.put('/sw/img/')
        expect(await removeRouteServedCacheEntries()).toBe(0)
        expect(cache.entries.size).toBe(2)
    })

    test('guard: a page with no Node server deletes nothing', async () => {
        platform.isNodeServer = false
        seed()
        const before = cache.entries.size
        expect(await removeRouteServedCacheEntries()).toBe(0)
        expect(cache.entries.size).toBe(before)
        expect(open).not.toHaveBeenCalled()
    })

    test('a page with no Cache API removes nothing and does not throw', async () => {
        vi.unstubAllGlobals()
        vi.stubGlobal('caches', undefined)
        expect(await removeRouteServedCacheEntries()).toBe(0)
    })
})

describe('the one-time clean-up', () => {
    test('runs once and records that it did', async () => {
        const flags = memoryFlags()
        cache.put(`/sw/img/${hexOf(`assets/${HASH}.png`)}`)
        expect(await cleanRouteServedCacheOnce(flags)).toBe(1)
        expect(flags.values.get(ROUTE_CACHE_CLEANUP_FLAG)).toBe('1')

        cache.put(`/sw/img/${hexOf(`assets/${HASH}b.png`)}`)
        open.mockClear()
        expect(await cleanRouteServedCacheOnce(flags)).toBe(0)
        expect(open).not.toHaveBeenCalled()
        expect(cache.entries.size).toBe(1)
    })

    test('does not record success when the cache could not be cleaned, so the next start tries again', async () => {
        const flags = memoryFlags()
        open.mockRejectedValueOnce(new Error('storage error'))
        await expect(cleanRouteServedCacheOnce(flags)).resolves.toBe(0)
        expect(flags.values.size).toBe(0)

        cache.put(`/sw/img/${hexOf(`assets/${HASH}.png`)}`)
        expect(await cleanRouteServedCacheOnce(flags)).toBe(1)
        expect(flags.values.size).toBe(1)
    })

    test('guard: a page with no Node server neither cleans nor records anything', async () => {
        platform.isNodeServer = false
        const flags = memoryFlags()
        cache.put(`/sw/img/${hexOf(`assets/${HASH}.png`)}`)
        expect(await cleanRouteServedCacheOnce(flags)).toBe(0)
        expect(flags.values.size).toBe(0)
        expect(cache.entries.size).toBe(1)
    })
})
