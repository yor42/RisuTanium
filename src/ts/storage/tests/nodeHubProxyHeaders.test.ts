// @vitest-environment node
/**
 * The header and body rules of the Node server's `/hub-proxy/*` route
 * (`server/node/hubProxy.cjs`). The route is open to any peer that can reach
 * the server, so only the headers the Realm calls need may reach the hub, and a
 * hub response may not set cookies on the server's own origin.
 */
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'

interface HubProxy {
    hubRequestHeaders(headers: Record<string, string | string[] | undefined>, hubOrigin: string): Record<string, string>
    hubResponseHeaders(headers: Iterable<[string, string]>): [string, string][]
    hubForwardBody(method: string, body: unknown): Buffer | undefined
}

const { hubRequestHeaders, hubResponseHeaders, hubForwardBody } = createRequire(import.meta.url)('../../../../server/node/hubProxy.cjs') as HubProxy

const HUB_ORIGIN = 'https://hub.example'

describe('hubRequestHeaders', () => {
    test('keeps only the headers the Realm calls need and sets the origin', () => {
        const out = hubRequestHeaders({
            accept: '*/*',
            'accept-language': 'en',
            'content-type': 'text/plain;charset=UTF-8',
            'user-agent': 'ua',
            'x-risuai-info': '1.0;node',
        }, HUB_ORIGIN)
        expect(out).toEqual({
            accept: '*/*',
            'accept-language': 'en',
            'content-type': 'text/plain;charset=UTF-8',
            'user-agent': 'ua',
            'x-risuai-info': '1.0;node',
            origin: HUB_ORIGIN,
        })
    })

    test('drops credentials and every other header', () => {
        const out = hubRequestHeaders({
            'risu-auth': 'token',
            cookie: 'a=b',
            authorization: 'Bearer x',
            'x-forwarded-for': '10.0.0.1',
            referer: 'http://lan/',
            range: 'bytes=0-9',
            'if-none-match': '"e"',
            host: 'lan',
            origin: 'http://evil.example',
            'content-length': '4',
        }, HUB_ORIGIN)
        expect(out).toEqual({ origin: HUB_ORIGIN })
    })

    test('matches names case-insensitively and writes them lowercase', () => {
        const out = hubRequestHeaders({ 'Risu-Auth': 'token', 'X-RisuAI-Info': 'v', Cookie: 'a=b' }, HUB_ORIGIN)
        expect(out).toEqual({ 'x-risuai-info': 'v', origin: HUB_ORIGIN })
    })

    test('skips undefined values and joins repeated values', () => {
        const out = hubRequestHeaders({ accept: undefined, 'accept-language': ['en', 'ko'] }, HUB_ORIGIN)
        expect(out).toEqual({ 'accept-language': 'en, ko', origin: HUB_ORIGIN })
    })
})

describe('hubResponseHeaders', () => {
    test('drops encoding, length and cookie headers and keeps the rest', () => {
        const out = hubResponseHeaders([
            ['Content-Encoding', 'gzip'],
            ['content-length', '3'],
            ['transfer-encoding', 'chunked'],
            ['Set-Cookie', 'sid=1'],
            ['content-type', 'text/plain'],
            ['cache-control', 'max-age=30'],
        ])
        expect(out).toEqual([['content-type', 'text/plain'], ['cache-control', 'max-age=30']])
    })
})

describe('hubForwardBody', () => {
    test('forwards a non-empty buffer byte-identically', () => {
        const body = Buffer.from('{"a":"가"}', 'utf-8')
        expect(hubForwardBody('POST', body)).toBe(body)
    })

    test('forwards nothing for a bodyless request', () => {
        expect(hubForwardBody('POST', {})).toBeUndefined()
        expect(hubForwardBody('POST', undefined)).toBeUndefined()
        expect(hubForwardBody('POST', Buffer.alloc(0))).toBeUndefined()
    })

    test('forwards nothing for GET and HEAD', () => {
        expect(hubForwardBody('GET', Buffer.from('x'))).toBeUndefined()
        expect(hubForwardBody('HEAD', Buffer.from('x'))).toBeUndefined()
    })
})
