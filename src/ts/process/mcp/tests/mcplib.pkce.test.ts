// @vitest-environment node
/**
 * The OAuth login of `MCPClient` sends a PKCE S256 challenge: base64url without padding of the
 * SHA-256 of the verifier it later posts to the token endpoint. This holds on a plain-HTTP page
 * where `crypto.subtle` does not exist. The no-subtle case is a regression reproducer; the
 * realCrypto case is a compatibility guard. MOCKED: `fetchNative`, `openURL`, the alert helpers.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    fetchNative: vi.fn(),
    openURL: vi.fn(),
    alertConfirm: vi.fn(),
    alertInput: vi.fn(),
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

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
})

const realCrypto = globalThis.crypto

beforeEach(() => {
    h.fetchNative.mockReset()
    h.openURL.mockReset()
    h.alertConfirm.mockReset()
    h.alertInput.mockReset()
    const urls: Record<string, () => Response> = {
        [DISCOVERY]: () => json({}, 404),
        [REGISTER]: () => json({ client_id: 'id', client_secret: 'secret' }, 201),
        [HELPER_API]: () => json({ success: true, payload: { code: 'c' } }),
        [TOKEN]: () => json({ access_token: 'tok' }),
    }
    h.fetchNative.mockImplementation(async (url: string) => {
        const reply = urls[url]
        if (!reply) {
            throw new Error('stop')
        }
        return reply()
    })
    h.alertConfirm.mockImplementation(async () => true)
    h.alertInput.mockImplementation(async () => 'auth-code')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.unstubAllGlobals()
})

const BACKENDS: { name: string, install: () => void }[] = [
    {
        name: 'no crypto.subtle',
        install: () => {
            vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
            expect((globalThis.crypto as { subtle?: unknown }).subtle).toBeUndefined()
        },
    },
    { name: 'realCrypto', install: () => { expect(globalThis.crypto.subtle).toBeDefined() } },
]

describe.each(BACKENDS)('PKCE challenge on $name', ({ install }) => {
    test('T9 code_challenge is base64url(SHA-256(verifier)) with method S256', async () => {
        install()
        const client = new MCPClient(SERVER)
        client.registerRefreshToken = vi.fn()

        await client.oauthLogin()

        expect(h.openURL).toHaveBeenCalledTimes(1)
        const authUrl = new URL(h.openURL.mock.calls[0][0] as string)
        const tokenCall = h.fetchNative.mock.calls.find(([url]) => url === TOKEN)
        expect(tokenCall).toBeDefined()
        const verifier = new URLSearchParams(tokenCall![1].body as string).get('code_verifier')
        expect(verifier).toBeTruthy()
        expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
        expect(authUrl.searchParams.get('code_challenge'))
            .toBe(createHash('sha256').update(verifier!).digest('base64url'))
    })
})
