// @vitest-environment node
/**
 * The pure parts of `server/node/proxyPolicy.cjs`: the address classification,
 * the checked lookup and the outbound header rules.
 */
import dns from 'node:dns'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Kind = 'loopback' | 'private' | 'public'
interface Policy {
    allowPrivate: boolean
    allowPublic: boolean
}
interface Entry {
    address: string
    family: number
}
interface PolicyModule {
    classifyAddress(text: string): Kind
    literalHostKind(hostname: string): Kind | null
    isKindAllowed(kind: Kind, policy: Policy): boolean
    createCheckedLookup(policy: Policy): (host: string, options: object | number | ((...args: never[]) => void), callback?: (error: (Error & { code?: string }) | null, first?: unknown, second?: unknown) => void) => void
    sanitizeOutboundHeaders(input: unknown, options?: { fromBrowser?: boolean, fetchDefaults?: boolean, hasBody?: boolean }): Record<string, string>
    InvalidHeaderError: new (message: string) => Error
}

const policyModule = createRequire(import.meta.url)('../../../../server/node/proxyPolicy.cjs') as PolicyModule
const { classifyAddress, literalHostKind, isKindAllowed, createCheckedLookup, sanitizeOutboundHeaders, InvalidHeaderError } = policyModule

afterEach(() => {
    vi.restoreAllMocks()
})

describe('classifyAddress', () => {
    const table: Array<[string, Kind]> = [
        ['127.0.0.1', 'loopback'],
        ['127.9.9.9', 'loopback'],
        ['::1', 'loopback'],
        ['0.0.0.0', 'loopback'],
        ['::', 'loopback'],
        ['0.1.2.3', 'private'],
        ['10.0.0.1', 'private'],
        ['172.16.0.1', 'private'],
        ['172.31.255.255', 'private'],
        ['172.32.0.1', 'public'],
        ['192.168.1.1', 'private'],
        ['169.254.169.254', 'private'],
        ['100.64.0.1', 'private'],
        ['100.127.255.255', 'private'],
        ['100.128.0.1', 'public'],
        ['224.0.0.1', 'private'],
        ['255.255.255.255', 'private'],
        ['93.184.216.34', 'public'],
        ['8.8.8.8', 'public'],
        ['fd00::1', 'private'],
        ['fc00::1', 'private'],
        ['fe80::1', 'private'],
        ['fe80::1%eth0', 'private'],
        ['ff02::1', 'private'],
        ['[fd00::1]', 'private'],
        ['::ffff:10.0.0.1', 'private'],
        ['::ffff:a00:1', 'private'],
        ['::ffff:127.0.0.1', 'loopback'],
        ['::ffff:8.8.8.8', 'public'],
        ['64:ff9b::a00:1', 'private'],
        ['64:ff9b::808:808', 'public'],
        ['64:ff9b:1::1', 'private'],
        ['2002:a00:1::', 'private'],
        ['2002:808:808::1', 'public'],
        ['::a00:1', 'private'],
        ['2001::1', 'private'],
        ['2606:4700:4700::1111', 'public'],
        ['not an address', 'private'],
        ['', 'private'],
    ]
    test.each(table)('%s is %s', (address, kind) => {
        expect(classifyAddress(address)).toBe(kind)
    })
})

describe('literalHostKind', () => {
    test('a name is not a literal and is judged on what it resolves to', () => {
        expect(literalHostKind('example.com')).toBeNull()
        expect(literalHostKind('localhost')).toBeNull()
    })

    test('a literal in the forms a URL hostname takes is classified', () => {
        expect(literalHostKind(new URL('http://167772161/').hostname)).toBe('private')
        expect(literalHostKind(new URL('http://0x7f000001/').hostname)).toBe('loopback')
        expect(literalHostKind(new URL('http://[::ffff:10.0.0.1]/').hostname)).toBe('private')
        expect(literalHostKind(new URL('http://[fd00::1]/').hostname)).toBe('private')
    })
})

describe('isKindAllowed', () => {
    test('loopback is always allowed; private and public follow the policy', () => {
        const neither = { allowPrivate: false, allowPublic: false }
        expect(isKindAllowed('loopback', neither)).toBe(true)
        expect(isKindAllowed('private', neither)).toBe(false)
        expect(isKindAllowed('public', neither)).toBe(false)
        expect(isKindAllowed('private', { allowPrivate: true, allowPublic: false })).toBe(true)
        expect(isKindAllowed('public', { allowPrivate: false, allowPublic: true })).toBe(true)
    })
})

describe('createCheckedLookup', () => {
    function answerWith(addresses: Entry[]): void {
        vi.spyOn(dns, 'lookup').mockImplementation(((_host: string, _options: unknown, callback: (error: null, list: Entry[]) => void) => {
            callback(null, addresses)
        }) as unknown as typeof dns.lookup)
    }
    const routePolicy = { allowPrivate: false, allowPublic: true }

    function run(options: object | number): Promise<{ error: (Error & { code?: string }) | null, first: unknown, second: unknown }> {
        return new Promise((resolve) => {
            createCheckedLookup(routePolicy)('name.test', options, (error, first, second) => resolve({ error, first, second }))
        })
    }

    test('refuses the name when any address is not allowed', async () => {
        answerWith([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.9', family: 4 }])
        const result = await run({ all: true })
        expect(result.error?.code).toBe('PROXY_DESTINATION_BLOCKED')
    })

    test('hands back the checked list when the caller asks for all', async () => {
        const list = [{ address: '93.184.216.34', family: 4 }]
        answerWith(list)
        const result = await run({ all: true })
        expect(result.error).toBeNull()
        expect(result.first).toEqual(list)
    })

    test('hands back one address and its family otherwise', async () => {
        answerWith([{ address: '93.184.216.34', family: 4 }])
        const result = await run({})
        expect(result.error).toBeNull()
        expect(result.first).toBe('93.184.216.34')
        expect(result.second).toBe(4)
    })
})

describe('sanitizeOutboundHeaders', () => {
    test('lower-cases names, joins names that differ in case and turns numbers and booleans into strings', () => {
        expect(sanitizeOutboundHeaders({ 'X-A': '1', 'x-a': '2', 'X-N': 5, 'x-b': true })).toEqual({ 'x-a': '1, 2', 'x-n': '5', 'x-b': 'true' })
    })

    test('drops framing, hop-by-hop and risu-* names', () => {
        const out = sanitizeOutboundHeaders({
            host: 'evil', 'content-length': '1', 'transfer-encoding': 'chunked', connection: 'upgrade', 'keep-alive': '1', 'proxy-connection': 'x',
            te: 'trailers', trailer: 'x', upgrade: 'websocket', expect: '100-continue', 'proxy-authorization': 'P', 'risu-auth': 'a', 'Risu-X': 'b', 'x-keep': 'k',
        })
        expect(out).toEqual({ 'x-keep': 'k' })
    })

    test('drops the cookie only for the browser path', () => {
        expect(sanitizeOutboundHeaders({ cookie: 'a=b' }, { fromBrowser: true })).toEqual({})
        expect(sanitizeOutboundHeaders({ cookie: 'a=b' })).toEqual({ cookie: 'a=b' })
    })

    test.each([
        ['null', { x: null }],
        ['an object', { x: {} }],
        ['an array', { x: ['a'] }],
        ['a line break', { x: 'a\r\nb: c' }],
        ['a bad name', { 'bad name': 'v' }],
        ['a non-finite number', { x: Number.POSITIVE_INFINITY }],
        ['a non-object map', [1]],
        ['a string map', 's'],
    ])('refuses %s', (_name, input) => {
        expect(() => sanitizeOutboundHeaders(input)).toThrow(InvalidHeaderError)
    })

    test('adds the headers fetch adds only when asked and only when absent', () => {
        expect(sanitizeOutboundHeaders({ 'x-a': '1' })).toEqual({ 'x-a': '1' })
        expect(sanitizeOutboundHeaders({}, { fetchDefaults: true })).toEqual({
            'user-agent': 'node', accept: '*/*', 'accept-language': '*', 'sec-fetch-mode': 'cors', 'accept-encoding': 'gzip, deflate',
        })
        expect(sanitizeOutboundHeaders({ 'user-agent': 'X' }, { fetchDefaults: true, hasBody: true })).toMatchObject({
            'user-agent': 'X', 'content-type': 'text/plain;charset=UTF-8',
        })
    })

    test('a ranged request asks for the identity encoding', () => {
        expect(sanitizeOutboundHeaders({ range: 'bytes=0-3' }, { fetchDefaults: true })['accept-encoding']).toBe('identity')
        expect(sanitizeOutboundHeaders({ range: 'bytes=0-3', 'accept-encoding': 'gzip' }, { fetchDefaults: true })['accept-encoding']).toBe('gzip, identity')
        expect(sanitizeOutboundHeaders({ range: 'bytes=0-3' })['accept-encoding']).toBeUndefined()
    })
})
