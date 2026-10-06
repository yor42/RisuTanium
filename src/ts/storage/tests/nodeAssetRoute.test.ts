// @vitest-environment node
/**
 * The Node server's asset route, `GET /api/asset/<hex>?risu-auth=<token>`, and
 * the token rules every route shares, against the real `server/node/server.cjs`
 * run as a child process. Files are planted straight into the server's `save/`
 * directory; every byte is synthetic.
 */
import { readdir, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture

beforeAll(async () => {
    fixture = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
}, 30_000)

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const HASH = '0123456789abcdef'.repeat(4)

function pngBytes(extra = 24): Uint8Array {
    return Uint8Array.from([...PNG_SIGNATURE, ...Array.from({ length: extra }, (_, i) => i)])
}

function mp4Bytes(length = 64): Uint8Array {
    const bytes = new Uint8Array(length)
    bytes.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70], 0)
    for (let i = 8; i < length; i++) {
        bytes[i] = i & 0xff
    }
    return bytes
}

async function plant(key: string, bytes: Uint8Array): Promise<void> {
    await writeFile(join(fixture.saveDir, hexOfKey(key)), bytes)
}

async function assetToken(extra: Record<string, unknown> = {}): Promise<string> {
    const iat = Math.floor(Date.now() / 1000)
    return await fixture.signToken({ iat, aud: 'asset-read', ...extra })
}

async function getAsset(hex: string, token: string | null, headers: Record<string, string> = {}): Promise<Response> {
    const query = token === null ? '' : `?risu-auth=${encodeURIComponent(token)}`
    return await fetch(`${fixture.baseUrl}/api/asset/${hex}${query}`, { headers })
}

async function getKey(key: string, headers: Record<string, string> = {}): Promise<Response> {
    return await getAsset(hexOfKey(key), await assetToken(), headers)
}

describe('serving a stored asset', () => {
    test('answers the bytes with the type of the key extension and the safety headers', async () => {
        const bytes = pngBytes()
        await plant(`assets/${HASH}.png`, bytes)
        const response = await getKey(`assets/${HASH}.png`)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('image/png')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(response.headers.get('content-security-policy')).toBe('sandbox')
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    })

    test('answers a video key with video/mp4 and honours a byte range', async () => {
        const bytes = mp4Bytes()
        await plant(`assets/${HASH}.mp4`, bytes)
        const full = await getKey(`assets/${HASH}.mp4`)
        expect(full.status).toBe(200)
        expect(full.headers.get('content-type')).toBe('video/mp4')
        expect(full.headers.get('accept-ranges')).toBe('bytes')
        await full.arrayBuffer()

        const ranged = await getKey(`assets/${HASH}.mp4`, { Range: 'bytes=0-3' })
        expect(ranged.status).toBe(206)
        expect(ranged.headers.get('content-range')).toBe(`bytes 0-3/${bytes.length}`)
        expect(ranged.headers.get('content-type')).toBe('video/mp4')
        expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(bytes.slice(0, 4))
    })

    test('answers a range that starts mid-file with only those bytes', async () => {
        const bytes = mp4Bytes(200)
        await plant(`assets/${HASH}b.mp4`, bytes)
        const ranged = await getKey(`assets/${HASH}b.mp4`, { Range: 'bytes=150-' })
        expect(ranged.status).toBe(206)
        expect(ranged.headers.get('content-range')).toBe('bytes 150-199/200')
        expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(bytes.slice(150))
    })

    test('answers svg as image/svg+xml', async () => {
        await plant('assets/logo.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))
        const response = await getKey('assets/logo.svg')
        expect(response.headers.get('content-type')).toBe('image/svg+xml')
        await response.arrayBuffer()
    })

    test.each([
        ['an empty extension', `assets/${HASH}c.`],
        ['no extension', 'assets/noext'],
        ['an extension that is not allowlisted', 'assets/data.bin'],
    ])('sniffs a PNG stored under %s', async (_label, key) => {
        await plant(key, pngBytes())
        const response = await getKey(key)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('image/png')
        await response.arrayBuffer()
    })

    test('answers application/octet-stream for bytes that match no allowlisted signature', async () => {
        await plant('assets/notes.txt', new TextEncoder().encode('<html><script>alert(1)</script></html>'))
        const response = await getKey('assets/notes.txt')
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('application/octet-stream')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        await response.arrayBuffer()
    })

    test('does not sniff over an allowlisted extension', async () => {
        await plant(`assets/${HASH}d.mp3`, pngBytes())
        const response = await getKey(`assets/${HASH}d.mp3`)
        expect(response.headers.get('content-type')).toBe('audio/mpeg')
        await response.arrayBuffer()
    })

    test('marks a hash-named asset immutable and every other asset revalidating', async () => {
        await plant(`assets/${HASH}e.png`, pngBytes())
        await plant(`assets/${HASH}.png`, pngBytes())
        await plant('assets/custom-id.png', pngBytes())
        const hashed = await getKey(`assets/${HASH}.png`)
        expect(hashed.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
        await hashed.arrayBuffer()
        const longer = await getKey(`assets/${HASH}e.png`)
        expect(longer.headers.get('cache-control')).toBe('private, no-cache')
        await longer.arrayBuffer()
        const custom = await getKey('assets/custom-id.png')
        expect(custom.headers.get('cache-control')).toBe('private, no-cache')
        await custom.arrayBuffer()
    })

    test('treats an upper-case hex as the same key', async () => {
        await plant('assets/upper.png', pngBytes())
        const response = await getAsset(hexOfKey('assets/upper.png').toUpperCase(), await assetToken())
        expect(response.status).toBe(200)
        await response.arrayBuffer()
    })

    test('a missing file is 404 and creates nothing', async () => {
        const before = (await readdir(fixture.saveDir)).sort()
        const response = await getKey('assets/never-written.png')
        expect(response.status).toBe(404)
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        await response.arrayBuffer()
        expect((await readdir(fixture.saveDir)).sort()).toEqual(before)
    })

    test('a download that is never read does not block removing the same key', async () => {
        const key = 'assets/stalled.mp4'
        await plant(key, mp4Bytes(8 * 1024 * 1024))
        const stalled = await getKey(key)
        expect(stalled.status).toBe(200)
        const removed = await fetch(`${fixture.baseUrl}/api/remove`, {
            headers: { 'risu-auth': await fixture.authHeader(), 'file-path': hexOfKey(key) },
        })
        expect(removed.status).toBe(200)
        await stalled.body?.cancel()
    })
})

describe('keys the route refuses', () => {
    test('the server password file is not served', async () => {
        const response = await getAsset('__password', await assetToken())
        expect(response.status).toBe(400)
        expect(await response.text()).not.toMatch(/[0-9a-f]{32}/)
    })

    test.each([
        ['the main file', 'database/database.bin'],
        ['a dot-dot segment', 'assets/../database/database.bin'],
        ['a key with a backslash', 'assets/a\\b.png'],
        ['a key outside assets', 'coldstorage/unit'],
    ])('refuses %s', async (_label, key) => {
        await plant(key, pngBytes())
        const response = await getKey(key)
        expect(response.status).toBe(400)
        await response.arrayBuffer()
    })

    test.each([
        ['an odd-length hex', `${hexOfKey('assets/x.png')}a`],
        ['a hex with a non-hex character', `${hexOfKey('assets/x.png').slice(0, -1)}g`],
        ['hex bytes that are not UTF-8', `${hexOfKey('assets/x')}ff`],
    ])('refuses %s', async (_label, hex) => {
        const response = await getAsset(hex, await assetToken())
        expect(response.status).toBe(400)
        await response.arrayBuffer()
    })
})

describe('tokens the route accepts and refuses', () => {
    test('accepts an asset token that carries no expiry', async () => {
        await plant('assets/noexp.png', pngBytes())
        const response = await getAsset(hexOfKey('assets/noexp.png'), await assetToken())
        expect(response.status).toBe(200)
        await response.arrayBuffer()
    })

    test('accepts an asset token whose expiry is in the future', async () => {
        await plant('assets/futureexp.png', pngBytes())
        const iat = Math.floor(Date.now() / 1000)
        const response = await getAsset(hexOfKey('assets/futureexp.png'), await assetToken({ exp: iat + 600 }))
        expect(response.status).toBe(200)
        await response.arrayBuffer()
    })

    test('refuses a request with no token', async () => {
        await plant('assets/notoken.png', pngBytes())
        const response = await getAsset(hexOfKey('assets/notoken.png'), null)
        expect(response.status).toBe(401)
        await response.arrayBuffer()
    })

    test('refuses a normal storage token', async () => {
        await plant('assets/storagetoken.png', pngBytes())
        const response = await getAsset(hexOfKey('assets/storagetoken.png'), await fixture.authHeader())
        expect(response.status).toBe(401)
        await response.arrayBuffer()
    })

    test('refuses an asset token whose expiry has passed', async () => {
        await plant('assets/expired.png', pngBytes())
        const iat = Math.floor(Date.now() / 1000)
        const response = await getAsset(hexOfKey('assets/expired.png'), await assetToken({ iat: iat - 600, exp: iat - 60 }))
        expect(response.status).toBe(401)
        await response.arrayBuffer()
    })

    test('refuses an asset token with a non-numeric expiry', async () => {
        await plant('assets/badexp.png', pngBytes())
        const response = await getAsset(hexOfKey('assets/badexp.png'), await assetToken({ exp: 'never' }))
        expect(response.status).toBe(401)
        await response.arrayBuffer()
    })

    test('refuses a token with another audience', async () => {
        await plant('assets/otheraud.png', pngBytes())
        const iat = Math.floor(Date.now() / 1000)
        const response = await getAsset(hexOfKey('assets/otheraud.png'), await fixture.signToken({ iat, exp: iat + 300, aud: 'x' }))
        expect(response.status).toBe(401)
        await response.arrayBuffer()
    })

    test('refuses a token signed by a key pair the server does not know', async () => {
        await plant('assets/stranger.png', pngBytes())
        const stranger = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
        const pub = await crypto.subtle.exportKey('jwk', stranger.publicKey)
        const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
        const head = encode({ alg: 'ES256', typ: 'JWT' })
        const payload = encode({ iat: Math.floor(Date.now() / 1000), aud: 'asset-read', pub })
        const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, stranger.privateKey, Buffer.from(`${head}.${payload}`))
        const token = `${head}.${payload}.${Buffer.from(signature).toString('base64url')}`
        const response = await getAsset(hexOfKey('assets/stranger.png'), token)
        expect(response.status).toBe(401)
        await response.arrayBuffer()
    })

    test('refuses a token whose signature does not verify', async () => {
        await plant('assets/forged.png', pngBytes())
        const [head, payload, signature] = (await assetToken()).split('.')
        const tampered = `${head}.${payload}.${signature.slice(0, -4)}AAAA`
        const response = await getAsset(hexOfKey('assets/forged.png'), tampered)
        expect(response.status).toBe(401)
        await response.arrayBuffer()
    })
})

describe('the asset route has its own rate-limit bucket', () => {
    test('asset requests do not draw on the storage routes bucket', async () => {
        await plant('assets/limiter.png', pngBytes())
        const remaining = (response: Response) => Number(response.headers.get('ratelimit-remaining'))
        const storageRead = async () => await fetch(`${fixture.baseUrl}/api/read`, {
            headers: { 'risu-auth': await fixture.authHeader(), 'file-path': hexOfKey('limit/probe') },
        })
        const before = await storageRead()
        for (let i = 0; i < 3; i++) {
            const response = await getKey('assets/limiter.png')
            expect(Number.isFinite(remaining(response))).toBe(true)
            await response.arrayBuffer()
        }
        const after = await storageRead()
        expect(remaining(after)).toBe(remaining(before) - 1)
    })
})

describe('every route that takes a risu-auth token refuses an audience token and a token without an expiry', () => {
    const authRefusal = async (response: Response) => {
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid Token' })
    }

    async function tokens() {
        const iat = Math.floor(Date.now() / 1000)
        return {
            assetAudience: await fixture.signToken({ iat, aud: 'asset-read' }),
            assetAudienceWithExpiry: await fixture.signToken({ iat, exp: iat + 300, aud: 'asset-read' }),
            otherAudience: await fixture.signToken({ iat, exp: iat + 300, aud: 'x' }),
            noExpiry: await fixture.signToken({ iat }),
            plain: await fixture.authHeader(),
        }
    }

    const ROUTES: Array<[
        name: string,
        call: (token: string) => Promise<Response>,
        passes: (response: Response) => Promise<boolean>,
        refused: (response: Response) => Promise<void>,
    ]> = [
        [
            '/api/read',
            async (token) => await fetch(`${fixture.baseUrl}/api/read`, { headers: { 'risu-auth': token, 'file-path': hexOfKey('k/auth') } }),
            async (response) => response.status === 200,
            authRefusal,
        ],
        [
            '/api/write',
            async (token) => await fetch(`${fixture.baseUrl}/api/write`, {
                method: 'POST',
                headers: { 'risu-auth': token, 'file-path': hexOfKey('k/auth'), 'content-type': 'application/octet-stream' },
                body: Uint8Array.from([1]),
            }),
            async (response) => response.status === 200,
            authRefusal,
        ],
        [
            '/api/env-secret',
            async (token) => await fetch(`${fixture.baseUrl}/api/env-secret`, {
                method: 'POST',
                headers: { 'risu-auth': token, 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'RISU_NOT_SET_KEY' }),
            }),
            async (response) => response.status === 404,
            authRefusal,
        ],
        [
            '/proxy',
            async (token) => await fetch(`${fixture.baseUrl}/proxy`, { headers: { 'risu-auth': token } }),
            async (response) => response.status === 400 && (await response.json()).error === 'URL has no param',
            authRefusal,
        ],
        [
            '/api/test_auth',
            async (token) => await fetch(`${fixture.baseUrl}/api/test_auth`, { headers: { 'risu-auth': token } }),
            async (response) => response.status === 200 && (await response.json()).status === 'success',
            async (response) => {
                expect(response.status).toBe(200)
                expect(await response.json()).toEqual({ status: 'incorrect' })
            },
        ],
    ]

    describe.each(ROUTES)('%s', (_name, call, passes, refused) => {
        test.each(['assetAudience', 'assetAudienceWithExpiry', 'otherAudience', 'noExpiry'] as const)('refuses the %s token with the auth refusal', async (kind) => {
            await refused(await call((await tokens())[kind]))
        })

        test('still accepts a plain token with an expiry (guard)', async () => {
            const response = await call((await tokens()).plain)
            expect(await passes(response.clone())).toBe(true)
        })
    })

    async function upgradeStatusLine(token: string): Promise<string> {
        const { port } = new URL(fixture.baseUrl)
        return await new Promise<string>((resolve, reject) => {
            const socket = connect(Number(port), '127.0.0.1')
            let received = ''
            socket.once('error', reject)
            socket.on('data', (chunk) => {
                received += chunk.toString('latin1')
                const end = received.indexOf('\r\n')
                if (end !== -1) {
                    socket.destroy()
                    resolve(received.slice(0, end))
                }
            })
            socket.once('close', () => resolve(received.split('\r\n')[0]))
            socket.write([
                `GET /proxy-stream-jobs/no-such-job/ws?risu-auth=${encodeURIComponent(token)} HTTP/1.1`,
                `Host: 127.0.0.1:${port}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
                'Sec-WebSocket-Version: 13',
                '',
                '',
            ].join('\r\n'))
        })
    }

    test.each(['assetAudience', 'assetAudienceWithExpiry', 'otherAudience', 'noExpiry'] as const)('the websocket upgrade refuses the %s token with 401', async (kind) => {
        expect(await upgradeStatusLine((await tokens())[kind])).toBe('HTTP/1.1 401 Unauthorized')
    })

    test('the websocket upgrade passes a plain token on to the job lookup (guard)', async () => {
        expect(await upgradeStatusLine((await tokens()).plain)).toBe('HTTP/1.1 404 Not Found')
    })
})
