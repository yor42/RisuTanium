// @vitest-environment node
/**
 * A stored refresh token is exchanged at its token URL before any interactive login. A 200 reply carrying
 * a string `access_token` is stored and ends the login without a prompt; any other reply (non-200, no token,
 * non-string token) stores nothing and falls through to the consented interactive flow.
 *
 * Drives the REAL `MCPClient` and the REAL `untrustedFetch` wrappers. MOCKED: `fetchNative`, the alert
 * helpers and the private-network toggle. Nothing here says anything about the native command or the prompt UI.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    fetchNative: vi.fn(),
    alertConfirm: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    fetchNative: h.fetchNative,
    globalFetch: vi.fn(),
    openURL: vi.fn(),
}))
vi.mock('src/ts/alert', () => ({
    alertInput: vi.fn(),
    alertConfirm: h.alertConfirm,
}))
vi.mock('src/ts/network/privateNetworkConsent', () => ({
    getAllowPrivate: vi.fn(async () => false),
}))

import { MCPClient } from '../mcplib'

const SERVER = 'https://mcp.example.invalid/mcp'
const REFRESH_URL = 'https://auth.example.invalid/token'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
})

function clientWithRefresh(reply: () => Response): MCPClient {
    h.fetchNative.mockImplementation(async () => reply())
    const client = new MCPClient(SERVER)
    client.getRefreshToken = async () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r', tokenUrl: REFRESH_URL })
    return client
}

beforeEach(() => {
    h.fetchNative.mockReset()
    h.alertConfirm.mockReset()
    h.alertConfirm.mockImplementation(async () => false)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('oauthLogin refresh-token exchange', () => {
    test('a 200 refresh with an access_token is stored with no prompt and no further request', async () => {
        const client = clientWithRefresh(() => json({ access_token: 'fresh' }))

        await client.oauthLogin()

        expect(client.accessToken).toBe('fresh')
        expect(h.alertConfirm).not.toHaveBeenCalled()
        expect(h.fetchNative).toHaveBeenCalledTimes(1)
        expect(h.fetchNative.mock.calls[0][0]).toBe(REFRESH_URL)
        expect(client.oauthDeclined).toBeFalsy()
    })

    test.each([
        ['a 400 reply', () => json({ error: 'invalid_grant' }, 400)],
        ['a 200 reply without access_token', () => json({})],
        ['a 200 reply with a non-string access_token', () => json({ access_token: 7 })],
    ])('%s stores nothing and falls through to the consent prompt', async (_name, reply) => {
        const client = clientWithRefresh(reply)

        await client.oauthLogin()

        expect(client.accessToken).toBeNull()
        expect(h.alertConfirm).toHaveBeenCalledTimes(1)
        expect(client.oauthDeclined).toBe(true)
    })
})

describe('handshake refresh-token exchange bound', () => {
    test('a refresh token that never satisfies the server is exchanged once, then the consent prompt ends the chain', async () => {
        let refreshPosts = 0
        h.fetchNative.mockImplementation(async (url: string) => {
            if (url === REFRESH_URL) {
                refreshPosts++
                // A regression loops; after a few turns the mock stops granting tokens so the test fails
                // on the count assertion below instead of hanging the runner.
                return refreshPosts <= 5 ? json({ access_token: 'fresh' }) : json({ error: 'invalid_grant' }, 400)
            }
            return json({}, 401)
        })
        const client = new MCPClient(SERVER)
        client.getRefreshToken = async () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r', tokenUrl: REFRESH_URL })

        await client.checkHandshake()

        expect(refreshPosts).toBe(1)
        expect(h.alertConfirm).toHaveBeenCalledTimes(1)
        expect(client.oauthDeclined).toBe(true)
        expect(client.initialized).toBeFalsy()
    })
})
