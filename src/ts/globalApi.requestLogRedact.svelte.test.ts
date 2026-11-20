/**
 * The in-app request log never stores a configured or recognisable credential:
 * secret-named headers, URL query and userinfo values, JSON and form fields, and
 * every form of a configured database key are replaced at capture time, and
 * `getRequestLog` re-applies the redaction on the way out.
 *
 * Drives the REAL `globalFetch`, `fetchNative`, `addFetchLog`, `getRequestLog` and
 * the REAL secret module. The other modules `globalApi.svelte.ts` imports are
 * mocked, following `globalApi.secretRef.svelte.test.ts` (copied, not shared: each
 * suite mocks its own graph). The Tauri HTTP plugin, the Tauri command,
 * `window.userScriptFetch` and the global `fetch` are mocks, so a passing test says
 * nothing about native behaviour.
 *
 * `getDatabase` returns a credential-free object by default, so a structural rule
 * is never masked by a configured-value match; only the value tests set credentials.
 * Tests whose title starts with `guard:` pass with or without the change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const platform = vi.hoisted(() => ({ isTauri: true }))
const dbState = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platform.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbState.db),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: [],
    savingStoppedReason: writable(null),
    frozenSaveKeysStore: writable([]),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 1))),
    sleepForever: vi.fn(() => new Promise<void>(() => {})),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

const streamEvents = vi.hoisted(() => ({ emit: (_payload: string) => {} }))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (_name: string, callback: (event: { payload: string }) => void) => {
        streamEvents.emit = (payload: string) => callback({ payload })
        return vi.fn()
    }),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        async getItem(_key: string) { return null }
        async setItem(_key: string, _value: Uint8Array) {}
        async keys() { return [] as string[] }
        async removeItem(_key: string) {}
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

import { invoke } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { addFetchLog, fetchNative, getFetchLogs, getRequestLog, globalFetch } from 'src/ts/globalApi.svelte'
import { resetSecretRefState } from 'src/ts/secretRef'

const K1 = 'sk-test-SYNTHETIC0000abcd'
const K2 = 'AIzaSYNTHETIC00000000wxyz'
const KQ = 'sk-test-SYN"TH\\ETIC/0+0=0:abcd'
const tauriFetchMock = vi.mocked(tauriFetch)
const invokeMock = vi.mocked(invoke)
const userScriptFetch = vi.fn(async () => new Response('plain', { status: 200 }))

type LogEntry = ReturnType<typeof getFetchLogs>[number]

beforeEach(() => {
    resetSecretRefState()
    dbState.db = {}
    getFetchLogs().length = 0
    tauriFetchMock.mockReset()
    tauriFetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    invokeMock.mockReset()
    userScriptFetch.mockClear()
    window.userScriptFetch = userScriptFetch as unknown as typeof window.userScriptFetch
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    platform.isTauri = true
    vi.unstubAllGlobals()
    delete (window as { userScriptFetch?: unknown }).userScriptFetch
    vi.restoreAllMocks()
})

function viaTauri() {
    delete (window as { userScriptFetch?: unknown }).userScriptFetch
}

/** Starts a streamed Tauri fetch and returns a sender for its native frames. */
async function startStreamed() {
    viaTauri()
    invokeMock.mockImplementation(async (command: string) => (
        command === 'streamed_fetch' ? JSON.stringify({ success: true }) : ''
    ))
    const pending = fetchNative('https://api.example.invalid/v1/stream', { body: '{}' })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('streamed_fetch', expect.anything()))
    const id = (invokeMock.mock.calls[0][1] as { id: string }).id
    const send = (frame: Record<string, unknown>) => streamEvents.emit(JSON.stringify({ id, ...frame }))
    return { pending, send }
}

describe('request log credential redaction', () => {
    test('R1 secret-named headers are stored redacted with the scheme kept; other headers stay', async () => {
        viaTauri()
        const secrets = {
            Authorization: `Bearer ${K1}`,
            'Proxy-Authorization': 'Basic SYNTHETICproxy0000000aaaa',
            'x-api-key': 'SYNTHETICxapikey0000bbbb',
            'x-goog-api-key': 'SYNTHETICgoogkey0000cccc',
            'api-key': 'SYNTHETICapikey000000dddd',
            Cookie: 'sid=SYNTHETICcookie0000000eeee',
            'risu-auth': 'SYNTHETICrisuauth0000ffff',
        }
        await globalFetch('https://api.example.invalid/v1/chat', {
            body: { prompt: 'hello' },
            headers: { ...secrets, 'Content-Type': 'application/json' },
        })
        const [log] = getFetchLogs()
        for (const [name, value] of Object.entries(secrets)) {
            const secret = value.replace(/^(Bearer|Basic) /, '')
            expect(log.header, name).not.toContain(secret)
        }
        expect(log.header).toContain('Bearer [redacted …abcd]')
        expect(log.header).toContain('Basic [redacted …aaaa]')
        expect(log.header).toContain('[redacted …bbbb]')
        expect(log.header).toContain('[redacted …cccc]')
        expect(log.header).toContain('[redacted …dddd]')
        expect(log.header).toContain('[redacted …eeee]')
        expect(log.header).toContain('[redacted …ffff]')
        expect(JSON.parse(log.header)['Content-Type']).toBe('application/json')
    })

    test('R2 URL query credentials are redacted; host, path and other parameters stay', () => {
        addFetchLog({
            body: '{}',
            headers: {},
            response: 'ok',
            success: true,
            url: `https://generativelanguage.example.invalid/v1beta/models/m:streamGenerateContent?key=${K2}&alt=sse&access_token=ya29.SYNTHETIC0000mnop&signature=SIGSYNTHETIC0000000qrst`,
        })
        const [log] = getFetchLogs()
        expect(log.url).not.toContain(K2)
        expect(log.url).not.toContain('ya29.SYNTHETIC0000mnop')
        expect(log.url).not.toContain('SIGSYNTHETIC0000000qrst')
        expect(log.url.startsWith('https://generativelanguage.example.invalid/v1beta/models/m:streamGenerateContent?')).toBe(true)
        expect(log.url).toContain('&alt=sse&')
        const parsed = new URL(log.url)
        expect(parsed.origin).toBe('https://generativelanguage.example.invalid')
        expect(parsed.searchParams.get('key')).toBe('[redacted …wxyz]')
    })

    test('R2b a userinfo password and a long username are redacted; a short username stays; the origin is unchanged', async () => {
        viaTauri()
        const base = new URL('https://comfyuser:SYNTHETICpass0000wxyz@comfy.example.invalid/')
        await globalFetch(new URL('/prompt', base).toString(), { body: {} })
        const [log] = getFetchLogs()
        expect(log.url).not.toContain('SYNTHETICpass0000wxyz')
        expect(log.url).toContain('comfyuser:')
        expect(new URL(log.url).origin).toBe('https://comfy.example.invalid')
        expect(new URL(log.url).username).toBe('comfyuser')

        getFetchLogs().length = 0
        tauriFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        const longUser = new URL('https://SYNTHETICuser000long:SYNTHETICpass0000wxyz@comfy.example.invalid/')
        await globalFetch(new URL('/prompt', longUser).toString(), { body: {} })
        const [second] = getFetchLogs()
        expect(second.url).not.toContain('SYNTHETICuser000long')
        expect(second.url).not.toContain('SYNTHETICpass0000wxyz')
        expect(new URL(second.url).origin).toBe('https://comfy.example.invalid')
    })

    test('R3 JSON credential fields are redacted in body, header and response; exact-name look-alikes stay', () => {
        addFetchLog({
            body: {
                model: 'm',
                max_tokens: 100,
                tokens: 5,
                token_count: 3,
                key: 'C-major',
                signature: 'EqSIGsynthetic',
                user_password_hint: 'pet name',
                secretary: 'Ms Kim',
                x_api_key_label: 'primary',
                cookie_consent: 'yes',
                api_key: K1,
                nested: { client_secret: K1 },
                messages: [{ content: 'my "password": "hunter2"' }],
            },
            headers: { Authorization: `Bearer ${K1}` },
            response: { access_token: K1, usage: { total_tokens: 9 } },
            success: true,
            url: 'https://api.example.invalid/v1/chat',
        })
        const [log] = getFetchLogs()
        expect(log.body).not.toContain(K1)
        expect(log.header).not.toContain(K1)
        expect(log.response).not.toContain(K1)
        const body = JSON.parse(log.body)
        expect(body.api_key).toBe('[redacted …abcd]')
        expect(body.nested.client_secret).toBe('[redacted …abcd]')
        expect(body.max_tokens).toBe(100)
        expect(body.tokens).toBe(5)
        expect(body.token_count).toBe(3)
        expect(body.key).toBe('C-major')
        expect(body.signature).toBe('EqSIGsynthetic')
        expect(body.user_password_hint).toBe('pet name')
        expect(body.secretary).toBe('Ms Kim')
        expect(body.x_api_key_label).toBe('primary')
        expect(body.cookie_consent).toBe('yes')
        expect(body.messages[0].content).toBe('my "password": "hunter2"')
        expect(JSON.parse(log.response)).toEqual({ access_token: '[redacted …abcd]', usage: { total_tokens: 9 } })
        expect(log.header).toContain('Bearer [redacted …abcd]')
    })

    test('R4 token fields of a streamed Tauri response are stored redacted; other fields stay', async () => {
        const { pending, send } = await startStreamed()
        const chunk = '{"access_token":"ya29.SYNTHETIC0000mnop","refresh_token":"1//SYNTHETIC00000qrst","id_token":"eyJSYNTHETIC0000uvwx","expires_in":3599,"token_type":"Bearer"}'
        send({ type: 'headers', body: {}, status: 200 })
        send({ type: 'chunk', body: Buffer.from(chunk).toString('base64') })
        send({ type: 'end' })
        const response = await pending
        expect(await response.text()).toBe(chunk)
        await vi.waitFor(() => expect(getFetchLogs()[0].response).toContain('expires_in'))
        const stored = getFetchLogs()[0].response
        expect(stored).not.toContain('ya29.SYNTHETIC0000mnop')
        expect(stored).not.toContain('1//SYNTHETIC00000qrst')
        expect(stored).not.toContain('eyJSYNTHETIC0000uvwx')
        expect(JSON.parse(stored)).toEqual({
            access_token: '[redacted …mnop]',
            refresh_token: '[redacted …qrst]',
            id_token: '[redacted …uvwx]',
            expires_in: 3599,
            token_type: 'Bearer',
        })
    })

    test('G5 guard: model text inside a streamed SSE line is stored byte-identical', async () => {
        const { pending, send } = await startStreamed()
        const line = 'data: {"choices":[{"delta":{"content":"the \\"api_key\\": \\"sk-test-SYNTHETIC9999zzzz\\" max_tokens"}}]}'
        send({ type: 'headers', body: {}, status: 200 })
        send({ type: 'chunk', body: Buffer.from(line).toString('base64') })
        send({ type: 'end' })
        const response = await pending
        await response.text()
        await vi.waitFor(() => expect(getFetchLogs()[0].response).not.toBe('Streamed Fetch'))
        expect(getFetchLogs()[0].response).toBe(line)
    })

    test('R6 form-encoded OAuth bodies are redacted by field name, including the authorization code', async () => {
        const refresh = 'grant_type=refresh_token&refresh_token=1//SYNTHETIC0000efgh&client_id=cid&client_secret=SYNTHETICsecret0ijkl'
        const exchange = new URLSearchParams({
            grant_type: 'authorization_code',
            code: 'SYNTHcode00000mnop',
            redirect_uri: 'https://app.example.invalid/callback',
            code_verifier: 'SYNTHverifier000qrst',
        }).toString()
        const refreshResponse = await fetchNative('https://auth.example.invalid/token', { body: refresh })
        await refreshResponse.text()
        const exchangeResponse = await fetchNative('https://auth.example.invalid/token', { body: exchange })
        await exchangeResponse.text()
        const [second, first] = getFetchLogs()
        expect(first.body).not.toContain('SYNTHETIC0000efgh')
        expect(first.body).not.toContain('SYNTHETICsecret0ijkl')
        expect(first.body).toContain('grant_type=refresh_token&')
        expect(first.body).toContain('client_id=cid&')
        expect(second.body).not.toContain('SYNTHcode00000mnop')
        expect(second.body).not.toContain('SYNTHverifier000qrst')
        expect(second.body).toContain('grant_type=authorization_code&')
        expect(second.body).toContain(`redirect_uri=${encodeURIComponent('https://app.example.invalid/callback')}`)
    })

    test('R6b a configured value inside a form body does not stop the name rules from redacting the other fields', async () => {
        const stored = 'SYNTHrefresh0000abcdEFGH'
        dbState.db = { authRefreshes: [{ refreshToken: stored, clientSecret: 'shortsecret' }] }
        const refresh = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: stored,
            client_id: 'cid',
            client_secret: 'shortsecret',
        }).toString()
        const response = await fetchNative('https://auth.example.invalid/token', { body: refresh })
        await response.text()
        const [log] = getFetchLogs()
        expect(log.body).not.toContain(stored)
        expect(log.body).not.toContain('shortsecret')
        expect(log.body).toContain('grant_type=refresh_token&')
        expect(log.body).toContain('client_id=cid&')
    })

    test('R7 every form of a configured key is redacted: raw, JSON once, JSON twice and URI', () => {
        dbState.db = { openAIKey: `${K1}\n${KQ}` }
        const once = JSON.stringify(KQ).slice(1, -1)
        const twice = JSON.stringify(once).slice(1, -1)
        addFetchLog({
            body: `note ${KQ} end`,
            headers: { 'X-Trace': `pre-${K1}`, 'X-Json': JSON.stringify({ k: KQ }) },
            response: `{"echo":"${once}"}`,
            success: true,
            url: `https://api.example.invalid/p/${encodeURIComponent(KQ)}`,
        })
        const [log] = getFetchLogs()
        expect(log.header).not.toContain(K1)
        expect(log.header).toContain('pre-[redacted …abcd]')
        expect(log.header).not.toContain(twice)
        expect(log.header).toContain('[redacted …abcd]')
        expect(log.url).not.toContain(encodeURIComponent(KQ))
        expect(log.url).toContain('[redacted%20%E2%80%A6abcd]')
        expect(log.body).not.toContain(KQ)
        expect(log.body).toBe('note [redacted …abcd] end')
        expect(log.response).not.toContain(once)
        expect(JSON.parse(log.response)).toEqual({ echo: '[redacted …abcd]' })
    })

    test('G7b guard: additionalParams values and the Vertex PEM are not matched by value', () => {
        dbState.db = {
            additionalParams: [['x', 'a-long-nonsecret-param-0001']],
            vertexPrivateKey: '-----BEGIN PRIVATE KEY-----\nSYNTHETICpemline000000000000\n-----END PRIVATE KEY-----',
        }
        const body = '{"x":"a-long-nonsecret-param-0001","note":"-----BEGIN PRIVATE KEY----- SYNTHETICpemline000000000000"}'
        addFetchLog({ body, headers: {}, response: 'ok', success: true, url: 'https://api.example.invalid/v1' })
        expect(getFetchLogs()[0].body).toBe(body)
    })

    test('a database that is not an object leaves the log working: the name rules still apply and nothing throws', () => {
        dbState.db = null as unknown as Record<string, unknown>
        expect(() => addFetchLog({ body: { api_key: K1 }, headers: {}, response: 'ok', success: true, url: 'https://api.example.invalid/v1' })).not.toThrow()
        expect(JSON.parse(getFetchLogs()[0].body)).toEqual({ api_key: '[redacted …abcd]' })
    })

    test('R8 getRequestLog holds no key, even for an entry injected raw', async () => {
        viaTauri()
        await globalFetch('https://api.example.invalid/v1/chat', { body: {}, headers: { Authorization: `Bearer ${K1}` } })
        expect(getRequestLog()).not.toContain(K1)

        const raw: LogEntry = {
            body: `{"api_key":"${K1}"}`,
            header: `{"x-api-key":"${K1}"}`,
            response: `{"access_token":"${K1}"}`,
            success: true,
            date: 'now',
            url: `https://api.example.invalid/v1?key=${K1}`,
        }
        getFetchLogs().unshift(raw)
        const exported = getRequestLog()
        expect(exported).not.toContain(K1)
        expect(exported).toContain('[redacted …abcd]')
    })

    test('R11 the fallback entry of the global fetch log, written when the response cannot be serialised, redacts the header', async () => {
        viaTauri()
        const circular: Record<string, unknown> = {}
        circular.self = circular
        circular.toString = () => 'unserialisable response'
        tauriFetchMock.mockResolvedValueOnce({
            status: 200,
            headers: new Headers(),
            json: async () => circular,
        } as unknown as Response)

        const result = await globalFetch('https://api.example.invalid/v1/chat', { body: {}, headers: { Authorization: `Bearer ${K1}` } })
        expect(result.ok).toBe(true)
        const [log] = getFetchLogs()
        expect(log.response).toContain('unserialisable')
        expect(log.header).not.toContain(K1)
        expect(log.header).toContain('Bearer [redacted …abcd]')
    })
})
