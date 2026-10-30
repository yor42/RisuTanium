// @vitest-environment node
/**
 * Every native request the MCP client makes carries the untrusted destination policy: the JSON-RPC
 * POST, the SSE connect fallback, and the five OAuth requests (refresh, discovery, registration,
 * authorization helper, token exchange). One test per call site.
 *
 * Drives the REAL `MCPClient` and the REAL `untrustedFetch` wrappers. MOCKED: `fetchNative` (its third
 * argument is what is asserted), the toggle store, the alert and URL-opening helpers. Nothing here says
 * anything about the native command.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    fetchNative: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    fetchNative: h.fetchNative,
    globalFetch: vi.fn(),
    openURL: vi.fn(),
}))
vi.mock('src/ts/alert', () => ({
    alertInput: vi.fn(async () => 'auth-code'),
}))
vi.mock('src/ts/network/privateNetworkConsent', () => ({
    getAllowPrivate: vi.fn(async () => false),
}))

import { MCPClient } from '../mcplib'

const POLICY_OFF = { nativePolicy: { allowPrivate: false } }
const SERVER = 'https://mcp.example.invalid/mcp'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
})

type Call = { url: string, arg: { method?: string }, internal: unknown }
const calls = (): Call[] => h.fetchNative.mock.calls.map(([url, arg, internal]) => ({ url, arg, internal }))
const callTo = (url: string): Call => {
    const found = calls().find((call) => call.url === url)
    if (!found) {
        throw new Error(`no native request to ${url}; saw ${calls().map((call) => call.url).join(', ')}`)
    }
    return found
}

/** Answers by URL; a URL with no answer fails, which ends the flow under test. */
function answer(replies: Record<string, () => Response>) {
    h.fetchNative.mockImplementation(async (url: string) => {
        const reply = replies[url]
        if (!reply) {
            throw new Error('stop')
        }
        return reply()
    })
}

beforeEach(() => {
    h.fetchNative.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('MCPClient native requests carry the policy', () => {
    test('T3a the JSON-RPC POST', async () => {
        answer({ [SERVER]: () => json({ jsonrpc: '2.0', id: 'x', result: {} }) })
        await new MCPClient(SERVER).request('tools/list')
        expect(callTo(SERVER).arg.method).toBe('POST')
        expect(callTo(SERVER).internal).toEqual(POLICY_OFF)
    })

    test('T3b the SSE connect fallback', async () => {
        let posts = 0
        h.fetchNative.mockImplementation(async (_url: string, arg: { method?: string }) => {
            if (arg.method === 'POST') {
                posts++
                return json({}, 404)
            }
            return json({}, 500)
        })
        await expect(new MCPClient(SERVER).handshake()).rejects.toThrow('Failed to connect to MCP server')
        const get = calls().find((call) => call.arg.method === 'GET')!
        expect(posts).toBe(1)
        expect(get.url).toBe(SERVER)
        expect(get.internal).toEqual(POLICY_OFF)
    })

    test('T3c the token refresh', async () => {
        const client = new MCPClient(SERVER)
        client.getRefreshToken = async () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r', tokenUrl: 'https://auth.example.invalid/token' })
        answer({ 'https://auth.example.invalid/token': () => json({}, 200) })
        await expect(client.oauthLogin()).rejects.toThrow('stop')
        expect(callTo('https://auth.example.invalid/token').internal).toEqual(POLICY_OFF)
    })

    test('T3d the OAuth discovery', async () => {
        answer({})
        await expect(new MCPClient(SERVER).oauthLogin()).rejects.toThrow('stop')
        expect(callTo('https://mcp.example.invalid/.well-known/oauth-authorization-server').internal).toEqual(POLICY_OFF)
    })

    test('T3e the client registration', async () => {
        answer({ 'https://mcp.example.invalid/.well-known/oauth-authorization-server': () => json({}, 404) })
        await expect(new MCPClient(SERVER).oauthLogin()).rejects.toThrow('stop')
        expect(callTo('https://mcp.example.invalid/register').internal).toEqual(POLICY_OFF)
    })

    test('T3f the authorization helper', async () => {
        answer({
            'https://mcp.example.invalid/.well-known/oauth-authorization-server': () => json({}, 404),
            'https://mcp.example.invalid/register': () => json({ client_id: 'id', client_secret: 'secret' }, 201),
        })
        await expect(new MCPClient(SERVER).oauthLogin()).rejects.toThrow('stop')
        expect(callTo('https://account.sionyw.com/oauthhelper/api').internal).toEqual(POLICY_OFF)
    })

    test('T3g the token exchange', async () => {
        answer({
            'https://mcp.example.invalid/.well-known/oauth-authorization-server': () => json({}, 404),
            'https://mcp.example.invalid/register': () => json({ client_id: 'id', client_secret: 'secret' }, 201),
            'https://account.sionyw.com/oauthhelper/api': () => json({ success: true, payload: { code: 'c' } }),
        })
        await expect(new MCPClient(SERVER).oauthLogin()).rejects.toThrow('stop')
        expect(callTo('https://mcp.example.invalid/token').internal).toEqual(POLICY_OFF)
    })

    test('guard: no request of any flow went out without the policy', async () => {
        answer({
            'https://mcp.example.invalid/.well-known/oauth-authorization-server': () => json({}, 404),
            'https://mcp.example.invalid/register': () => json({ client_id: 'id', client_secret: 'secret' }, 201),
            'https://account.sionyw.com/oauthhelper/api': () => json({ success: true, payload: { code: 'c' } }),
        })
        await expect(new MCPClient(SERVER).oauthLogin()).rejects.toThrow('stop')
        expect(calls().length).toBeGreaterThanOrEqual(4)
        expect(calls().every((call) => JSON.stringify(call.internal) === JSON.stringify(POLICY_OFF))).toBe(true)
    })
})
