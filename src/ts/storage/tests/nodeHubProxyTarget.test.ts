// @vitest-environment node
/**
 * The target rules of the Node server's `/hub-proxy/*` route
 * (`server/node/hubProxy.cjs`). The route has no password gate, so the server
 * may only ever request the configured hub origin, whatever the request or the
 * hub's answer says.
 */
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'

interface HubProxy {
    hubTargetURL(hubURL: string, req: { originalUrl: string; headers: Record<string, string> }): string
    hubRedirectTarget(hubURL: string, requestedURL: string, location: string | null): string | null
}

const { hubTargetURL, hubRedirectTarget } = createRequire(import.meta.url)('../../../../server/node/hubProxy.cjs') as HubProxy

const HUB = 'https://hub.example'

describe('hubTargetURL', () => {
    test('joins the hub URL with the request path and query', () => {
        expect(hubTargetURL(HUB, { originalUrl: '/hub-proxy/hub/info/abc?cache=30', headers: {} }))
            .toBe('https://hub.example/hub/info/abc?cache=30')
    })

    test('ignores an x-risu-node-path header', () => {
        const target = hubTargetURL(HUB, {
            originalUrl: '/hub-proxy/resource/1',
            headers: { 'x-risu-node-path': encodeURIComponent('http://127.0.0.1:1/x') },
        })
        expect(target).toBe('https://hub.example/resource/1')
    })

    test('refuses a path that would change the host', () => {
        expect(() => hubTargetURL(HUB, { originalUrl: '/hub-proxy@evil.example/x', headers: {} })).toThrow()
        expect(() => hubTargetURL('https://hub.example', { originalUrl: '/hub-proxy:81/x', headers: {} })).toThrow()
    })

    test('keeps a protocol-relative looking path on the hub origin', () => {
        const target = hubTargetURL(HUB, { originalUrl: '/hub-proxy//evil.example/x', headers: {} })
        expect(new URL(target).origin).toBe(HUB)
    })
})

describe('hubRedirectTarget', () => {
    const requested = 'https://hub.example/realm/a'

    test('follows a relative redirect on the hub origin', () => {
        expect(hubRedirectTarget(HUB, requested, '/resource/b')).toBe('https://hub.example/resource/b')
    })

    test('follows an absolute redirect on the hub origin', () => {
        expect(hubRedirectTarget(HUB, requested, 'https://hub.example/x')).toBe('https://hub.example/x')
    })

    test('does not follow a redirect to another origin', () => {
        expect(hubRedirectTarget(HUB, requested, 'http://127.0.0.1:1/x')).toBeNull()
        expect(hubRedirectTarget(HUB, requested, '//evil.example/x')).toBeNull()
        expect(hubRedirectTarget(HUB, requested, 'https://hub.example.evil.example/x')).toBeNull()
    })

    test('does not follow a missing or malformed location', () => {
        expect(hubRedirectTarget(HUB, requested, null)).toBeNull()
        expect(hubRedirectTarget(HUB, requested, '')).toBeNull()
        expect(hubRedirectTarget(HUB, requested, 'http://')).toBeNull()
    })
})
