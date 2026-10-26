/**
 * A non-streamed chat reply on a frozen Android page (CHORE-166 stage 2C).
 *
 * The world is a model of measured primitives, not the native bridge: while `frozen.on`, a plugin reply of 1 KB or more never
 * settles and every Body-mixin read (`text`, `json`, ...) on a Response never settles. The real HTTP plugin runs against the
 * world through `window.__TAURI_INTERNALS__`, because vitest does not route the plugin's own import of the core module
 * through `vi.mock`. A pass proves the page-side route; only a device run proves the native bridge.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { createAndroidTauriWorld } from 'src/ts/storage/tests/store2/androidTauriWorld'

// Read only when a mock factory or a test runs, which is after this module body.
const h = {
    world: createAndroidTauriWorld(),
    os: { value: 'android' },
    interceptors: [] as { callback: (body: unknown, type: string) => Promise<unknown> }[],
}

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))
vi.mock('src/ts/platform', () => ({ isTauri: true, isNodeServer: false, isIOS: () => false }) as never)
vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: vi.fn(() => ({})), setDatabase: vi.fn(), presetTemplate: { name: 'test-preset' }, defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test', appSubVer: 'test', getCurrentCharacter: vi.fn(),
}) as never)
vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: {} }, selectedCharID: writable(-1), selIdState: { selId: -1 }, alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false), botMakerMode: writable(false), loadedStore: writable(false), LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0), bodyIntercepterStore: h.interceptors, savingStoppedReason: writable(null), frozenSaveKeysStore: writable([]),
}) as never)
vi.mock('src/ts/alert', () => ({
    alertClear: vi.fn(), alertConfirm: vi.fn(async () => true), alertError: vi.fn(), alertWait: vi.fn(), alertMd: vi.fn(), alertNormal: vi.fn(),
    alertSelect: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(), alertNormalWait: vi.fn(), alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }), waitAlert: vi.fn(async () => {}),
}) as never)
// A listener that is not ready yet would sleep on a timer; this throws a named setup error instead of hanging.
vi.mock('src/ts/util', () => ({
    changeFullscreen: vi.fn(), checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { throw new Error('setup: streamed_fetch listener not ready') }),
    sleepForever: vi.fn(() => new Promise<void>(() => {})),
}) as never)
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p), invoke: (cmd: string, args?: unknown) => h.world.invoke(cmd, args) }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os.value }))
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: vi.fn(async () => '/appdata'), join: vi.fn(async (...p: string[]) => p.join('/')), basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => {}) }))
vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, createWriteStream: () => ({ ready: Promise.resolve(), writable: { getWriter: () => ({ write: async () => {}, close: async () => {} }) } }) } }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (_name: string, callback: (event: { payload: string }) => void) => { h.world.http.listener = callback; return vi.fn() }),
}))
vi.mock('src/ts/update', () => ({ checkRisuUpdate: vi.fn(async () => {}) }) as never)
vi.mock('src/ts/plugins/plugins.svelte', () => ({ loadPlugins: vi.fn(async () => {}) }) as never)
vi.mock('src/ts/parser/parser.svelte', () => ({ hasher: vi.fn((s: string) => s) }) as never)
vi.mock('src/ts/characterCards', () => ({ characterURLImport: vi.fn(), hubURL: 'https://example.invalid' }) as never)
vi.mock('src/ts/storage/dbChangeEffects.svelte', () => ({ registerDbChangeEffects: vi.fn() }) as never)
vi.mock('src/ts/storage/autoStorage', () => ({ AutoStorage: class { async getItem() { return null } async setItem() {} async keys() { return [] } async removeItem() {} } }) as never)
vi.mock('src/ts/gui/animation', () => ({ updateAnimationSpeed: vi.fn() }) as never)
vi.mock('src/ts/gui/colorscheme', () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }) as never)
vi.mock('src/ts/observer.svelte', () => ({ startObserveDom: vi.fn() }) as never)
vi.mock('src/ts/gui/guisize', () => ({ updateGuisize: vi.fn() }) as never)
vi.mock('src/ts/characters', () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as never)
vi.mock('src/ts/hotkey', () => ({ initMobileGesture: vi.fn() }) as never)
vi.mock('src/ts/process/modules', () => ({ moduleUpdate: vi.fn(async () => {}) }) as never)
vi.mock('src/ts/process/coldstorage.svelte', () => ({ getColdStorageItem: vi.fn() }) as never)

const world = h.world
const URL_CHAT = 'https://api.example.invalid/v1/chat'
const encoder = new TextEncoder()
const BODY_MIXIN = ['text', 'json', 'arrayBuffer', 'blob', 'bytes', 'formData'] as const

let api: typeof import('src/ts/globalApi.svelte')
let pluginFetch: typeof import('@tauri-apps/plugin-http').fetch
let language: typeof import('src/lang').language

/** Lets every pending promise continuation run; no timer is used to wait. */
async function flush(rounds = 300): Promise<void> {
    for (let i = 0; i < rounds; i++) {
        await Promise.resolve()
    }
}

/**
 * Freezes the page: replies of 1 KB or more never settle, a Body-mixin read never settles (a labelled model of the
 * measured stall; happy-dom cannot tell a stream body from a string body, so every Response is patched) and the
 * task sources a frozen page does not run are recorded. The mixin methods are own properties on happy-dom's
 * Response.prototype and are removed again by `delete`.
 */
function freeze(): void {
    world.frozen.on = true
    for (const name of BODY_MIXIN) {
        Object.defineProperty(Response.prototype, name, {
            configurable: true,
            writable: true,
            value: function () {
                world.frozen.hung.push('body-mixin:' + name)
                return new Promise(() => {})
            },
        })
    }
    vi.stubGlobal('MessageChannel', class {
        constructor() {
            world.frozen.hung.push('timer:MessageChannel')
        }
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
}

function thaw(): void {
    for (const name of BODY_MIXIN) {
        delete (Response.prototype as unknown as Record<string, unknown>)[name]
    }
    delete (document as unknown as Record<string, unknown>).visibilityState
    vi.unstubAllGlobals()
}

type Settled = { state: 'pending' } | { state: 'settled', value: Awaited<ReturnType<typeof api.globalFetch>> }

function track(promise: Promise<Awaited<ReturnType<typeof api.globalFetch>>>): { get: () => Settled } {
    let current: Settled = { state: 'pending' }
    promise.then((value) => { current = { state: 'settled', value } })
    return { get: () => current }
}

function jsonReply(contentLength: number): string {
    return JSON.stringify({ choices: [{ message: { content: 'x'.repeat(contentLength) } }] })
}

function lastCall(): Record<string, unknown> {
    const call = world.http.streamedCalls[0]
    if (!call) {
        throw new Error('no streamed_fetch call')
    }
    return call
}

beforeAll(async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: (cmd: string, args?: unknown) => world.invoke(cmd, args) }
    api = await import('src/ts/globalApi.svelte')
    pluginFetch = (await import('@tauri-apps/plugin-http')).fetch
    language = (await import('src/lang')).language
    await flush()
})

afterAll(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

beforeEach(() => {
    world.reset()
    h.os.value = 'android'
    h.interceptors.length = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'setImmediate'] })
})

afterEach(() => {
    thaw()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('a non-streamed reply that arrives while the Android page is frozen', () => {
    test.each([
        ['an 88 character reply', 40],
        ['a 12 KB reply', 12000],
    ])('%s is delivered and parsed (regression: the plugin body read never settled)', async (_name, contentLength) => {
        const reply = jsonReply(contentLength)
        const request = track(api.globalFetch(URL_CHAT, { body: { a: 1 }, deliverWhileFrozen: true }))
        freeze()
        await flush()
        const call = world.http.streamedCalls[0]
        if (call) {
            world.http.deliver(String(call.id), [encoder.encode(reply)])
        }
        await flush()
        expect({
            settled: request.get(),
            hung: [...world.frozen.hung],
            streamedCalls: world.http.streamedCalls.length,
        }).toEqual({
            settled: { state: 'settled', value: { ok: true, data: JSON.parse(reply), headers: { 'content-type': 'application/json' }, status: 200 } },
            hung: [],
            streamedCalls: 1,
        })
    })

    test('diagnostic: the plugin read of a 12 KB body never settles on a frozen page', async () => {
        world.http.setBody(jsonReply(12000))
        const settled = { value: false }
        // The body stream pulls once as soon as the plugin builds it, so the page is frozen before the fetch.
        freeze()
        const res = await pluginFetch(URL_CHAT, { method: 'POST', body: '{}' })
        const reader = res.body!.getReader()
        reader.read().then(() => { settled.value = true })
        await flush()
        expect(settled.value).toBe(false)
        expect(world.frozen.hung).toContain('plugin:http|fetch_read_body')
    })
})

describe('the route is Android only and opt-in', () => {
    test('desktop keeps the plugin route even with the flag set', async () => {
        h.os.value = 'windows'
        world.http.setBody(jsonReply(10))
        const result = await api.globalFetch(URL_CHAT, { body: { a: 1 }, deliverWhileFrozen: true })
        expect(result.ok).toBe(true)
        expect(world.http.streamedCalls).toHaveLength(0)
        expect(world.http.commands).toContain('plugin:http|fetch_send')
    })

    test('Android without the flag keeps the plugin route', async () => {
        world.http.setBody(jsonReply(10))
        const result = await api.globalFetch(URL_CHAT, { body: { a: 1 } })
        expect(result.ok).toBe(true)
        expect(world.http.streamedCalls).toHaveLength(0)
    })

    test('Android with rawResponse keeps the plugin route', async () => {
        world.http.setBody(jsonReply(10))
        const result = await api.globalFetch(URL_CHAT, { body: { a: 1 }, deliverWhileFrozen: true, rawResponse: true })
        expect(result.ok).toBe(true)
        expect(result.data).toBeInstanceOf(Uint8Array)
        expect(world.http.streamedCalls).toHaveLength(0)
    })
})

describe('the native event route returns what the plugin route returned', () => {
    async function run(options: Parameters<typeof api.globalFetch>[1], deliver: (id: string) => void) {
        const request = api.globalFetch(URL_CHAT, { body: { a: 1 }, deliverWhileFrozen: true, ...options })
        await flush()
        deliver(String(lastCall().id))
        return await request
    }

    test('a 200 JSON reply is ok with its data and headers', async () => {
        const result = await run({}, (id) => world.http.deliver(id, [encoder.encode('{"v":1}')]))
        expect(result).toEqual({ ok: true, data: { v: 1 }, headers: { 'content-type': 'application/json' }, status: 200 })
    })

    test('a 400 JSON reply is not ok and keeps its status and data', async () => {
        const result = await run({}, (id) => world.http.deliver(id, [encoder.encode('{"error":"bad"}')], { status: 400 }))
        expect(result.ok).toBe(false)
        expect(result.status).toBe(400)
        expect(result.data).toEqual({ error: 'bad' })
    })

    test('a 500 non-JSON reply is not ok with status 400 and a SyntaxError text', async () => {
        const result = await run({}, (id) => world.http.deliver(id, [encoder.encode('upstream exploded')], { status: 500 }))
        expect(result.ok).toBe(false)
        expect(result.status).toBe(400)
        expect(String(result.data)).toContain('SyntaxError')
    })

    test('a 2xx non-JSON reply is not ok with status 400 and a SyntaxError text', async () => {
        const result = await run({}, (id) => world.http.deliver(id, [encoder.encode('<html>ok</html>')], { status: 200 }))
        expect(result.ok).toBe(false)
        expect(result.status).toBe(400)
        expect(String(result.data)).toContain('SyntaxError')
    })

    test('a failure before the response head is not ok with the native message', async () => {
        world.http.streamedReply = JSON.stringify({ success: false, body: 'connection refused' })
        const request = api.globalFetch(URL_CHAT, { body: { a: 1 }, deliverWhileFrozen: true })
        await flush()
        const result = await request
        expect(result.ok).toBe(false)
        expect(result.status).toBe(400)
        expect(String(result.data)).toContain('connection refused')
    })

    test('a GET request sends no body and the GET method', async () => {
        await run({ method: 'GET', body: undefined }, (id) => world.http.deliver(id, [encoder.encode('{}')]))
        expect(lastCall().method).toBe('GET')
        expect(lastCall().body).toBe('')
    })

    test('a multibyte character split across two chunks is returned intact', async () => {
        const bytes = encoder.encode('{"a":"한국어"}')
        const result = await run({}, (id) => world.http.deliver(id, [bytes.subarray(0, 7), bytes.subarray(7)]))
        expect(result.data).toEqual({ a: '한국어' })
    })

    test('the body interceptor runs once, in globalFetch, and not again in fetchNative', async () => {
        const callback = vi.fn(async (body: unknown) => body)
        h.interceptors.push({ callback })
        await run({ interceptor: 'test' }, (id) => world.http.deliver(id, [encoder.encode('{}')]))
        expect(callback).toHaveBeenCalledTimes(1)
        expect(lastCall().id).toBeDefined()
    })

    test('the native request has no limit and uses the camelCase timeout key', async () => {
        await run({}, (id) => world.http.deliver(id, [encoder.encode('{}')]))
        expect(lastCall().timeoutSecs).toBe(0)
        expect('timeout_secs' in lastCall()).toBe(false)
    })

    test('the plugin default User-Agent is sent when the caller names none', async () => {
        await run({}, (id) => world.http.deliver(id, [encoder.encode('{}')]))
        const headers = JSON.parse(String(lastCall().headers)) as Record<string, string>
        expect(headers['User-Agent']).toBe('tauri-plugin-http/2.8.0')
        expect(headers['Content-Type']).toBe('application/json')
    })

    test('a caller Content-Type is kept over the JSON default', async () => {
        await run({ headers: { 'Content-Type': 'text/plain' } }, (id) => world.http.deliver(id, [encoder.encode('{}')]))
        const headers = JSON.parse(String(lastCall().headers)) as Record<string, string>
        expect(headers['Content-Type']).toBe('text/plain')
    })

    test('a caller User-Agent in any letter case is kept and not duplicated', async () => {
        await run({ headers: { 'user-agent': 'mine/1' } }, (id) => world.http.deliver(id, [encoder.encode('{}')]))
        const headers = JSON.parse(String(lastCall().headers)) as Record<string, string>
        expect(Object.keys(headers).filter((key) => key.toLowerCase() === 'user-agent')).toEqual(['user-agent'])
        expect(headers['user-agent']).toBe('mine/1')
    })

    test('the request id carries a per-page prefix and the five digit counter', async () => {
        await run({}, (id) => world.http.deliver(id, [encoder.encode('{}')]))
        expect(String(lastCall().id)).toMatch(/^[0-9a-f]{8}-\d{5}$/)
    })
})

describe('stopping a request', () => {
    test('a stop before the response head fails the request and cancels the native one', async () => {
        const controller = new AbortController()
        const request = api.globalFetch(URL_CHAT, { body: { a: 1 }, deliverWhileFrozen: true, abortSignal: controller.signal })
        await flush()
        const id = String(lastCall().id)
        controller.abort()
        const result = await request
        expect(result.ok).toBe(false)
        expect(String(result.data)).toContain('aborted')
        expect(world.http.cancelledIds).toEqual([id])
    })

    test('a stop after a complete-looking body but before the end is a failure, not a truncated reply', async () => {
        const controller = new AbortController()
        const request = api.globalFetch(URL_CHAT, { body: { a: 1 }, deliverWhileFrozen: true, abortSignal: controller.signal })
        await flush()
        const id = String(lastCall().id)
        world.http.deliver(id, [encoder.encode('{"v":1}')], { end: false })
        await flush()
        controller.abort()
        const result = await request
        expect(result).toEqual({ ok: false, data: 'aborted', headers: {}, status: 400 })
        expect(world.http.cancelledIds).toEqual([id])
    })
})

describe('the native timeout key', () => {
    async function nativeCall(timeoutMs: number | undefined, noNativeTimeout?: boolean): Promise<Record<string, unknown>> {
        const request = api.fetchNative(URL_CHAT, { body: '{}', logFetch: false, requestTimeoutMs: timeoutMs, noNativeTimeout })
        await flush()
        const call = lastCall()
        world.http.deliver(String(call.id), [encoder.encode('{}')])
        await request
        return call
    }

    test('fetchNative with requestTimeoutMs 600000 sends timeoutSecs 600 and not timeout_secs (the cap covers the whole native request)', async () => {
        const call = await nativeCall(600000)
        expect(call.timeoutSecs).toBe(600)
        expect('timeout_secs' in call).toBe(false)
    })

    test('a setting below 240 s now cuts the native request sooner than the 240 s default did', async () => {
        const call = await nativeCall(90000)
        expect(call.timeoutSecs).toBe(90)
    })

    test('fetchNative with no timeout sends an undefined timeoutSecs (the Rust 240 s default applies)', async () => {
        const call = await nativeCall(undefined)
        expect(call.timeoutSecs).toBeUndefined()
    })

    test('a given requestTimeoutMs wins over noNativeTimeout', async () => {
        const call = await nativeCall(30000, true)
        expect(call.timeoutSecs).toBe(30)
    })

    test('a timeout before the response head shows the localized timed-out message', async () => {
        const request = api.fetchNative(URL_CHAT, { body: '{}', logFetch: false, requestTimeoutMs: 1000 })
        const outcome = request.then(() => 'resolved', (error: Error) => error.message)
        await flush()
        vi.advanceTimersByTime(1000)
        await flush()
        expect(await outcome).toBe(language.errors.requestTimedOut)
    })
})

// Last: it reloads the module, and the reloaded module owns the native event listener from then on.
describe('the request id prefix', () => {
    test('the id prefix does not need crypto.randomUUID (a plain-HTTP origin lacks it) and differs across a reload', async () => {
        const original = crypto.randomUUID
        try {
            const firstRequest = api.fetchNative(URL_CHAT, { body: '{}', logFetch: false })
            await flush()
            const firstPrefix = String(lastCall().id).split('-')[0]
            world.http.deliver(String(lastCall().id), [encoder.encode('{}')])
            await firstRequest

            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
            vi.resetModules()
            const fresh = await import('src/ts/globalApi.svelte')
            await flush()
            const request = fresh.fetchNative(URL_CHAT, { body: '{}', logFetch: false })
            await flush()
            const freshId = String(world.http.streamedCalls[world.http.streamedCalls.length - 1].id)
            expect(freshId).toMatch(/^[0-9a-f]{8}-\d{5}$/)
            expect(freshId.split('-')[0]).not.toBe(firstPrefix)
            world.http.deliver(freshId, [encoder.encode('{}')])
            await request
        } finally {
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: original })
        }
    })
})
