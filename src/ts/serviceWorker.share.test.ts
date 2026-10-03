// @vitest-environment node

/**
 * The share receiver and share store in `public/sw.js`, and the asset-cache routes beside them.
 *
 * `public/sw.js` is run as text in a `vm` context whose globals are the Node `Request`, `Response`, `FormData`, `File`
 * and `URL`, a `caches` stub that follows the Cache API on the points the worker uses (one cache per name, keys
 * normalised to absolute URLs with the fragment stripped, `match` returning a clone, `delete` resolving true only
 * when it removed an entry, `put` failing on demand) and a controllable clock. A fake `FetchEvent` throws if
 * `respondWith` is called after the listener returned, as a browser does.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { beforeEach, describe, expect, test } from 'vitest'

const ORIGIN = 'https://app.test'
const HOUR = 60 * 60 * 1000
const U8 = Uint8Array

class FakeCache {
    entries = new Map<string, Response>()
    putFails = false

    private keyOf(request: string | URL | Request): string {
        const raw = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
        const url = new URL(raw, ORIGIN)
        url.hash = ''
        return url.href
    }

    async put(request: string | URL | Request, response: Response): Promise<void> {
        if (this.putFails) throw new Error('quota exceeded (simulated)')
        this.entries.set(this.keyOf(request), response)
    }

    async match(request: string | URL | Request): Promise<Response | undefined> {
        return this.entries.get(this.keyOf(request))?.clone()
    }

    async delete(request: string | URL | Request): Promise<boolean> {
        return this.entries.delete(this.keyOf(request))
    }

    async keys(): Promise<Request[]> {
        return [...this.entries.keys()].map((k) => new Request(k))
    }
}

type Listener = (event: { request: unknown, respondWith: (p: Response | Promise<Response | undefined> | undefined) => void }) => void

const swSource = readFileSync(resolve(process.cwd(), 'public', 'sw.js'), 'utf8')

let clock = 0
let uuids = 0
let caches: Map<string, FakeCache>
let listener: Listener

function load() {
    caches = new Map()
    uuids = 0
    let captured: Listener | null = null
    const sandbox = {
        self: {
            location: { origin: ORIGIN },
            addEventListener: (type: string, fn: Listener) => { if (type === 'fetch') captured = fn },
        },
        caches: {
            open: async (name: string) => {
                if (!caches.has(name)) caches.set(name, new FakeCache())
                return caches.get(name)!
            },
        },
        crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuids).padStart(12, '0')}` },
        Date: { now: () => clock },
        Request, Response, URL, FormData, File, Blob, Uint8Array, ArrayBuffer, console,
    }
    vm.runInNewContext(swSource, sandbox)
    if (!captured) throw new Error('sw.js registered no fetch listener')
    listener = captured
}

/** Dispatches a request; `promise` is undefined when the worker did not call `respondWith`. */
function fire(request: unknown): { promise: Promise<Response | undefined> | undefined } {
    let returned = false
    let promise: Promise<Response | undefined> | undefined
    const event = {
        request,
        respondWith: (p: Response | Promise<Response | undefined> | undefined) => {
            if (returned) throw new Error('respondWith called after the listener returned')
            promise = Promise.resolve(p)
        },
    }
    listener(event)
    returned = true
    return { promise }
}

async function send(request: unknown): Promise<Response> {
    const { promise } = fire(request)
    expect(promise, 'the worker answered the request').toBeDefined()
    const res = await promise
    expect(res).toBeDefined()
    return res as Response
}

const post = (files: Array<[string, File | string]>) => {
    const form = new FormData()
    for (const [field, value] of files) form.append(field, value)
    return new Request(`${ORIGIN}/receive-files/`, { method: 'POST', body: form })
}

const file = (bytes: number[] | string, name: string, type = '') => new File([typeof bytes === 'string' ? bytes : new U8(bytes)], name, { type })

const idOf = (res: Response) => {
    const location = res.headers.get('location') ?? ''
    const match = /^https:\/\/app\.test\/#share=(.+)$/.exec(location)
    expect(match, `Location ${location}`).not.toBeNull()
    return match![1]
}

const claim = (id: string) => send(new Request(`${ORIGIN}/sw/share/${id}/index`, { method: 'DELETE' }))
const get = (path: string) => send(new Request(`${ORIGIN}${path}`))
const dropShare = (id: string) => send(new Request(`${ORIGIN}/sw/share/${id}`, { method: 'DELETE' }))

type Index = { files: Array<{ key: string, name: string, type: string }> }
const indexOf = async (id: string) => (await (await claim(id)).json()) as Index

const shareKeys = () => [...(caches.get('risuShare')?.entries.keys() ?? [])]

beforeEach(() => {
    clock = Date.UTC(2026, 9, 4, 12)
    load()
})

describe('share receive', () => {
    test('a multipart POST to the share action is answered with a 303 to the app origin and the file is stored with its name and type', async () => {
        const bytes = [1, 2, 3, 250, 251, 0, 9]
        const res = await send(post([['character', file(bytes, 'a.charx', 'application/octet-stream')]]))
        expect(res.status).toBe(303)
        const id = idOf(res)
        const index = await indexOf(id)
        expect(index.files).toHaveLength(1)
        expect(index.files[0].name).toBe('a.charx')
        expect(index.files[0].type).toBe('application/octet-stream')
        const stored = await get(index.files[0].key)
        expect(stored.status).toBe(200)
        expect(new U8(await stored.arrayBuffer())).toEqual(new U8(bytes))
        expect(decodeURIComponent(stored.headers.get('x-file-name') ?? '')).toBe('a.charx')
        expect(stored.headers.get('content-type')).toBe('application/octet-stream')
    })

    test('png, json, octet-stream and Hangul-named files are all stored with their original name and type', async () => {
        const res = await send(post([
            ['character', file([1], 'card.png', 'image/png')],
            ['character', file('{}', 'card.json', 'application/json')],
            ['character', file([2], 'x.charx', 'application/octet-stream')],
            ['preset', file([3], '캐릭터 카드.risup', 'application/octet-stream')],
        ]))
        const index = await indexOf(idOf(res))
        expect(index.files.map((f) => [f.name, f.type])).toEqual([
            ['card.png', 'image/png'],
            ['card.json', 'application/json'],
            ['x.charx', 'application/octet-stream'],
            ['캐릭터 카드.risup', 'application/octet-stream'],
        ])
        for (const entry of index.files) {
            const stored = await get(entry.key)
            expect(decodeURIComponent(stored.headers.get('x-file-name') ?? '')).toBe(entry.name)
        }
    })

    test('two shares get distinct ids and deleting one leaves the other intact', async () => {
        const a = idOf(await send(post([['character', file([1], 'a.charx')]])))
        const b = idOf(await send(post([['character', file([2], 'b.charx')]])))
        expect(a).not.toBe(b)
        const indexA = await indexOf(a)
        await dropShare(a)
        expect((await get(indexA.files[0].key)).status).toBe(404)
        const indexB = await indexOf(b)
        expect(indexB.files[0].name).toBe('b.charx')
        expect(new U8(await (await get(indexB.files[0].key)).arrayBuffer())).toEqual(new U8([2]))
    })

    test('files in different form fields keep the order the form listed them', async () => {
        const res = await send(post([
            ['character', file([1], 'one.charx')],
            ['preset', file([2], 'two.risup')],
            ['module', file([3], 'three.risum')],
            ['character', file([4], 'four.png')],
        ]))
        expect((await indexOf(idOf(res))).files.map((f) => f.name)).toEqual(['one.charx', 'two.risup', 'three.risum', 'four.png'])
    })

    test('a form that cannot be parsed is answered with a 303 to the failure hash', async () => {
        const request = {
            url: `${ORIGIN}/receive-files/`,
            method: 'POST',
            headers: new Headers(),
            formData: async () => { throw new TypeError('malformed body (simulated)') },
        }
        const res = await send(request)
        expect(res.status).toBe(303)
        expect(res.headers.get('location')).toBe(`${ORIGIN}/#share-failed`)
    })

    test('a storage failure is answered with a 303 to the failure hash and leaves nothing claimable', async () => {
        const shareCache = new FakeCache()
        shareCache.putFails = true
        caches.set('risuShare', shareCache)
        const res = await send(post([['character', file([1], 'a.charx')]]))
        expect(res.status).toBe(303)
        expect(res.headers.get('location')).toBe(`${ORIGIN}/#share-failed`)
        expect(shareCache.entries.size).toBe(0)
    })

    test('a failure after some files were stored removes them', async () => {
        const first = await send(post([['character', file([1], 'keep.charx')]]))
        const keepId = idOf(first)
        const shareCache = caches.get('risuShare')!
        const before = shareKeys().length
        let puts = 0
        const realPut = shareCache.put.bind(shareCache)
        shareCache.put = async (r, res) => {
            if (++puts === 2) throw new Error('quota exceeded (simulated)')
            return realPut(r, res)
        }
        const res = await send(post([['character', file([2], 'a.charx')], ['character', file([3], 'b.charx')]]))
        expect(res.headers.get('location')).toBe(`${ORIGIN}/#share-failed`)
        expect(shareKeys()).toHaveLength(before)
        expect((await indexOf(keepId)).files[0].name).toBe('keep.charx')
    })

    test('a POST with no files is answered with a 303 to the empty hash', async () => {
        const res = await send(post([['title', 'just text']]))
        expect(res.status).toBe(303)
        expect(res.headers.get('location')).toBe(`${ORIGIN}/#share-empty`)
        expect(shareKeys()).toEqual([])
    })
})

describe('share claim and read', () => {
    test('the first claim returns the index and a second claim finds nothing', async () => {
        const id = idOf(await send(post([['character', file([1], 'a.charx')]])))
        const first = await claim(id)
        expect(first.status).toBe(200)
        expect(((await first.json()) as Index).files).toHaveLength(1)
        expect((await claim(id)).status).toBe(404)
    })

    test('two simultaneous claims give the index to exactly one', async () => {
        const id = idOf(await send(post([['character', file([1], 'a.charx')]])))
        const results = await Promise.all([claim(id), claim(id)])
        expect(results.map((r) => r.status).sort()).toEqual([200, 404])
    })

    test('a GET of something not stored is a 404 and never reads a form', async () => {
        let formReads = 0
        const request = {
            url: `${ORIGIN}/sw/share/123-abc/0`,
            method: 'GET',
            headers: new Headers(),
            formData: async () => { formReads++; throw new TypeError('not a form') },
        }
        const res = await send(request)
        expect(res.status).toBe(404)
        expect(formReads).toBe(0)
    })

    test('a claim of an unknown id is a 404', async () => {
        expect((await claim('1-deadbeef')).status).toBe(404)
    })
})

describe('share age', () => {
    test('a share older than 24 hours is removed when a new share arrives, and a recent one is kept', async () => {
        const old = idOf(await send(post([['character', file([1], 'old.charx')]])))
        clock += 23 * HOUR
        const recent = idOf(await send(post([['character', file([2], 'recent.charx')]])))
        expect(shareKeys().some((k) => k.includes(`/${old}/`))).toBe(true)
        clock += 2 * HOUR
        idOf(await send(post([['character', file([3], 'new.charx')]])))
        expect(shareKeys().some((k) => k.includes(`/${old}/`))).toBe(false)
        expect(shareKeys().some((k) => k.includes(`/${recent}/`))).toBe(true)
        expect((await claim(old)).status).toBe(404)
        expect((await indexOf(recent)).files[0].name).toBe('recent.charx')
    })

    test('the files of an old share whose index was already claimed are removed when a new share arrives', async () => {
        const old = idOf(await send(post([['character', file([1], 'old.charx')]])))
        const index = await indexOf(old)
        expect((await get(index.files[0].key)).status).toBe(200)
        clock += 25 * HOUR
        idOf(await send(post([['character', file([2], 'new.charx')]])))
        expect(shareKeys().some((k) => k.includes(`/${old}/`))).toBe(false)
        expect((await get(index.files[0].key)).status).toBe(404)
    })
})

describe('asset cache routes (compatibility guard)', () => {
    const assetKeys = () => [...(caches.get('risuCache')?.entries.keys() ?? [])]
    const register = (headers: Record<string, string>, body: number[]) =>
        send(new Request(`${ORIGIN}/sw/register`, { method: 'POST', headers, body: new U8(body) }))

    test('init answers v2', async () => {
        expect(await (await send(new Request(`${ORIGIN}/sw/init`))).text()).toBe('v2')
    })

    test('register stores under /sw/img with an image content type, check sees it and img returns it', async () => {
        const res = await register({ 'x-register-url': '/sw/register/abc' }, [5, 6, 7])
        expect(await res.json()).toEqual({ done: true })
        expect(assetKeys()).toEqual([`${ORIGIN}/sw/img/abc`])
        const img = await send(new Request(`${ORIGIN}/sw/img/abc`))
        expect(img.headers.get('content-type')).toBe('image/png')
        expect(new U8(await img.arrayBuffer())).toEqual(new U8([5, 6, 7]))
        expect(await (await send(new Request(`${ORIGIN}/sw/check/abc`))).json()).toEqual({ able: true })
        expect(await (await send(new Request(`${ORIGIN}/sw/check/zzz`))).json()).toEqual({ able: false })
    })

    test('register with x-no-content-type stores under the registered path without a content type', async () => {
        await register({ 'x-register-url': '/sw/register/raw', 'x-no-content-type': 'true' }, [1])
        expect(assetKeys()).toEqual([`${ORIGIN}/sw/register/raw`])
        const stored = await caches.get('risuCache')!.match(`${ORIGIN}/sw/register/raw`)
        expect(stored?.headers.get('content-type')).toBeNull()
    })

    test('register with an empty body answers the empty body error and stores nothing', async () => {
        const res = await register({ 'x-register-url': '/sw/register/none' }, [])
        expect(await res.json()).toEqual({ done: false, error: 'empty body' })
        expect(assetKeys()).toEqual([])
    })

    test('img of something not stored resolves to nothing', async () => {
        const { promise } = fire(new Request(`${ORIGIN}/sw/img/missing`))
        expect(promise).toBeDefined()
        expect(await promise).toBeUndefined()
    })

    test('a /tf path answers 404 with its message and an unknown /sw path echoes its name', async () => {
        const tf = await send(new Request(`${ORIGIN}/tf/x`))
        expect(tf.status).toBe(404)
        expect(await tf.text()).toBe('Cannot find resource from cache')
        expect(await (await send(new Request(`${ORIGIN}/sw/other`))).text()).toBe('other')
    })
})

describe('share storage apart from the asset cache', () => {
    const assetKeys = () => [...(caches.get('risuCache')?.entries.keys() ?? [])]

    test('share traffic never touches the asset cache keys', async () => {
        await send(new Request(`${ORIGIN}/sw/register`, { method: 'POST', headers: { 'x-register-url': '/sw/register/abc' }, body: new U8([5]) }))
        const before = assetKeys()
        expect(before).toHaveLength(1)
        const id = idOf(await send(post([['character', file([1], 'a.charx')]])))
        const index = await indexOf(id)
        await get(index.files[0].key)
        await dropShare(id)
        clock += 30 * HOUR
        await send(post([['character', file([2], 'b.charx')]]))
        expect(assetKeys()).toEqual(before)
    })
})
