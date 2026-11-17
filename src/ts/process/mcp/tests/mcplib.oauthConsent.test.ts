// @vitest-environment node
/**
 * The sign-in helper at account.sionyw.com is contacted only after the user accepted a confirmation that
 * names it, in the same login attempt. A decline cancels the login: nothing is sent to the helper, the
 * handshake does not retry, and the client stays quiet (sends nothing, asks nothing, throws nothing) until
 * `clearOAuthDecline`. Concurrent callers on one client share one handshake and so one prompt.
 *
 * Drives the REAL `MCPClient`, the REAL `untrustedFetch` wrappers and the REAL English strings. MOCKED:
 * `fetchNative` (a router over the server's JSON-RPC methods and the OAuth URLs), `openURL`, the alert
 * helpers and the toggle store. Nothing here says anything about the native command or the real prompt UI.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be
 * preserved; every other test is a regression reproducer for the behaviour it names.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    fetchNative: vi.fn(),
    openURL: vi.fn(),
    alertConfirm: vi.fn(),
    alertInput: vi.fn(),
    /** Everything observable in order: `confirm`, `open` and the URL of every native request. */
    events: [] as string[],
    /** The answer of every confirmation. */
    consent: false,
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    fetchNative: h.fetchNative,
    globalFetch: vi.fn(),
    openURL: h.openURL,
}))
vi.mock('src/ts/alert', () => ({
    alertInput: h.alertInput,
    alertConfirm: h.alertConfirm,
}))
vi.mock('src/ts/network/privateNetworkConsent', () => ({
    getAllowPrivate: vi.fn(async () => false),
}))

import { MCPClient } from '../mcplib'

const SERVER = 'https://mcp.example.invalid/mcp'
const HELPER_API = 'https://account.sionyw.com/oauthhelper/api'
const DISCOVERY = 'https://mcp.example.invalid/.well-known/oauth-authorization-server'
const REGISTER = 'https://mcp.example.invalid/register'
const TOKEN = 'https://mcp.example.invalid/token'

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
})

const initResult = (capabilities: Record<string, unknown> = {}) => ({
    jsonrpc: '2.0', id: 'x',
    result: { protocolVersion: '2025-03-26', capabilities, serverInfo: { name: 's', version: '1' } },
})

type World = {
    /** The reply to the n-th initialize POST (1-based). */
    initialize: (n: number) => Response
    /** Replies to the other JSON-RPC methods of the server. */
    rpc: Record<string, () => Response>
    /** Replies by URL for everything that is not the server itself. */
    urls: Record<string, () => Response>
    initializes: number
    /** A further initialize throws, which ends a login loop the base would otherwise run. */
    initializeBound: number
}

const world: World = { initialize: () => json({}, 401), rpc: {}, urls: {}, initializes: 0, initializeBound: Infinity }

/** The OAuth replies of a server that completes the whole login. */
function fullOAuth() {
    world.urls = {
        [DISCOVERY]: () => json({}, 404),
        [REGISTER]: () => json({ client_id: 'id', client_secret: 'secret' }, 201),
        [HELPER_API]: () => json({ success: true, payload: { code: 'c' } }),
        [TOKEN]: () => json({ access_token: 'tok' }),
    }
}

type Call = { url: string, arg: { method?: string, body?: string, headers?: Record<string, string> } }
const calls = (): Call[] => h.fetchNative.mock.calls.map(([url, arg]) => ({ url, arg }))
const helperCalls = () => calls().filter((call) => new URL(call.url).hostname.replace(/\.$/, '') === 'account.sionyw.com')
const initializeCalls = () => calls().filter((call) => call.url === SERVER && JSON.parse(call.arg.body!).method === 'initialize')

beforeEach(() => {
    h.fetchNative.mockReset()
    h.openURL.mockReset()
    h.alertConfirm.mockReset()
    h.alertInput.mockReset()
    h.events.length = 0
    h.consent = false
    world.initialize = () => json({}, 401)
    world.rpc = {}
    world.urls = {}
    world.initializes = 0
    world.initializeBound = Infinity
    h.fetchNative.mockImplementation(async (url: string, arg: { body?: string }) => {
        h.events.push(url)
        if (url === SERVER) {
            const method = JSON.parse(arg.body!).method as string
            if (method === 'initialize') {
                world.initializes++
                if (world.initializes > world.initializeBound) {
                    throw new Error('initialize bound')
                }
                return world.initialize(world.initializes)
            }
            const reply = world.rpc[method]
            if (!reply) {
                throw new Error('no reply for ' + method)
            }
            return reply()
        }
        const reply = world.urls[url]
        if (!reply) {
            throw new Error('stop')
        }
        return reply()
    })
    h.openURL.mockImplementation(() => { h.events.push('open') })
    h.alertConfirm.mockImplementation(async () => {
        h.events.push('confirm')
        return h.consent
    })
    h.alertInput.mockImplementation(async () => 'auth-code')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

/** The settled state of a call, so a rejection does not hide the assertion that names the defect. */
const settle = <T>(promise: Promise<T>) => promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))

/** A live client: handshaken with a session, then its server loses the session and answers 401 to initialize. */
async function liveClientThenSessionLoss(): Promise<MCPClient> {
    fullOAuth()
    world.initialize = () => json(initResult({ tools: {}, prompts: {} }), 200, { 'Mcp-Session-Id': 's1' })
    world.rpc = {
        'notifications/initialized': () => json({}),
        'tools/list': () => json({ jsonrpc: '2.0', id: 'x', result: { tools: [] } }),
    }
    const client = new MCPClient(SERVER)
    await client.handshake()
    world.initialize = () => json({}, 401)
    world.rpc = {
        'tools/list': () => json({}, 404),
        'prompts/list': () => json({}, 404),
        'prompts/get': () => json({}, 404),
        'tools/call': () => json({}, 404),
    }
    return client
}

describe('the confirmation before the sign-in helper', () => {
    test('a decline sends nothing to the helper and ends the login', async () => {
        fullOAuth()
        const client = new MCPClient(SERVER)

        await client.oauthLogin()

        expect(h.openURL).not.toHaveBeenCalled()
        expect(h.alertInput).not.toHaveBeenCalled()
        expect(calls()).toEqual([])
        expect(client.oauthDeclined).toBe(true)
        expect(client.accessToken).toBeNull()
    })

    test('a decline during the handshake does not retry and leaves the client not initialized', async () => {
        fullOAuth()
        world.initialize = (n) => n === 1
            ? json({}, 401)
            : json(initResult(), 200)
        world.initializeBound = 3
        world.rpc = { 'notifications/initialized': () => json({}) }
        const client = new MCPClient(SERVER)

        await client.handshake()

        expect(h.openURL).not.toHaveBeenCalled()
        expect(helperCalls()).toEqual([])
        expect(initializeCalls()).toHaveLength(1)
        expect(h.alertConfirm).toHaveBeenCalledTimes(1)
        expect(client.initialized).toBe(false)
        expect(client.oauthDeclined).toBe(true)
    })

    test('the confirmation comes before registration, the browser redirect and the helper request', async () => {
        fullOAuth()
        h.consent = true
        const client = new MCPClient(SERVER)

        await client.oauthLogin()

        expect(h.events[0]).toBe('confirm')
        expect(h.events.indexOf('confirm')).toBeLessThan(h.events.indexOf(REGISTER))
        expect(h.events.indexOf(REGISTER)).toBeLessThan(h.events.indexOf('open'))
        expect(h.events.indexOf('open')).toBeLessThan(h.events.indexOf(HELPER_API))
        expect(h.alertConfirm).toHaveBeenCalledTimes(1)
    })

    test('guard: an accepted login completes as before', async () => {
        fullOAuth()
        h.consent = true
        const client = new MCPClient(SERVER)
        const registered = vi.fn()
        client.registerRefreshToken = registered

        await client.oauthLogin()

        expect(client.accessToken).toBe('tok')
        const helper = calls().find((call) => call.url === HELPER_API)!
        expect(helper.arg.body).toBe('{"code":"auth-code"}')
        expect(registered).toHaveBeenCalledWith(expect.objectContaining({ tokenUrl: TOKEN }))
        const tokenPost = calls().find((call) => call.url === TOKEN)!
        expect(new URLSearchParams(tokenPost.arg.body).get('redirect_uri')).toBe('https://account.sionyw.com/oauthhelper')
        expect(client.oauthDeclined).toBeFalsy()
    })

    test('a refresh that falls through still asks, and a decline sends nothing to the helper', async () => {
        fullOAuth()
        world.urls['https://auth.example.invalid/token'] = () => json({}, 200)
        const client = new MCPClient(SERVER)
        client.getRefreshToken = async () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r', tokenUrl: 'https://auth.example.invalid/token' })

        await client.oauthLogin()

        expect(h.openURL).not.toHaveBeenCalled()
        expect(helperCalls()).toEqual([])
        expect(calls().map((call) => call.url)).toEqual(['https://auth.example.invalid/token'])
        expect(client.oauthDeclined).toBe(true)
    })

    test('every login attempt asks: an acceptance is not remembered', async () => {
        fullOAuth()
        h.consent = true

        await new MCPClient(SERVER).oauthLogin()
        await new MCPClient(SERVER).oauthLogin()

        expect(h.alertConfirm).toHaveBeenCalledTimes(2)
    })

    test('the confirmation names the helper host and the server host', async () => {
        fullOAuth()

        await new MCPClient(SERVER).oauthLogin()

        const message = h.alertConfirm.mock.calls[0]?.[0] as string
        expect(message).toContain('account.sionyw.com')
        expect(message).toContain('mcp.example.invalid')
        expect(message).not.toContain('{host}')
        expect(message).not.toContain('{server}')
    })

    test.each([
        'https://account.sionyw.com/token',
        'https://account.sionyw.com:8443/token',
        'https://account.sionyw.com./token',
    ])('a stored refresh target on the helper host (%s) is not contacted before consent', async (tokenUrl) => {
        fullOAuth()
        world.urls[tokenUrl] = () => json({}, 200)
        const client = new MCPClient(SERVER)
        client.getRefreshToken = async () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r', tokenUrl })

        const outcome = await settle(client.oauthLogin())

        expect(helperCalls()).toEqual([])
        expect(calls()).toEqual([])
        expect(h.openURL).not.toHaveBeenCalled()
        expect(h.alertConfirm).toHaveBeenCalledTimes(1)
        expect(outcome.ok).toBe(true)
        expect(client.oauthDeclined).toBe(true)
    })
})

describe('a declined client stays quiet', () => {
    test('after a session loss and a decline every public method returns its neutral value without a request or a prompt', async () => {
        const client = await liveClientThenSessionLoss()
        world.initializeBound = 4

        const first = await settle(client.getToolList())
        const second = await settle(client.getToolList())

        expect(h.alertConfirm).toHaveBeenCalledTimes(1)
        expect(helperCalls()).toEqual([])
        expect(client.oauthDeclined).toBe(true)
        expect(first.ok).toBe(true)
        expect(second.ok).toBe(true)

        const quiet = calls().length

        expect(await client.getToolList()).toEqual([])
        const called = await client.callTool('t', {})
        expect(called).toHaveLength(1)
        const cancelled = called[0]
        expect(cancelled.type).toBe('text')
        expect(cancelled.type === 'text' ? cancelled.text : '').toContain('cancelled')
        expect(await client.getPromptList()).toEqual([])
        expect(await client.getCapabilities()).toEqual({})
        const prompt = await client.loadPrompt({ name: 'p' })
        expect(prompt.rpc.error).toBeDefined()
        await client.checkHandshake()

        expect(calls().length).toBe(quiet)
        expect(h.alertConfirm).toHaveBeenCalledTimes(1)
    })

    test('concurrent callers on one client share one handshake and one prompt', async () => {
        const client = await liveClientThenSessionLoss()
        world.initializeBound = 6
        await client.getToolList()
        const initializesBefore = initializeCalls().length

        const both = await Promise.all([settle(client.getToolList()), settle(client.getToolList())])

        expect(h.alertConfirm).toHaveBeenCalledTimes(1)
        expect(initializeCalls().length - initializesBefore).toBe(1)
        expect(both.every((outcome) => outcome.ok)).toBe(true)
        expect(helperCalls()).toEqual([])
    })

    test('clearOAuthDecline lets the next handshake ask again', async () => {
        fullOAuth()
        world.initialize = (n) => n === 1 ? json({}, 401) : json(initResult(), 200)
        world.rpc = { 'notifications/initialized': () => json({}) }
        world.initializeBound = 6
        const client = new MCPClient(SERVER)
        await client.handshake()
        expect(client.oauthDeclined).toBe(true)

        client.clearOAuthDecline()
        h.consent = true
        world.initialize = (n) => n <= 2 ? json({}, 401) : json(initResult(), 200)
        await client.checkHandshake()

        expect(h.alertConfirm).toHaveBeenCalledTimes(2)
        expect(client.oauthDeclined).toBe(false)
        expect(client.initialized).toBe(true)
    })
})
