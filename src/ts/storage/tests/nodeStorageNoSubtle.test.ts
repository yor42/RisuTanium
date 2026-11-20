// @vitest-environment node
/**
 * `NodeStorage` on a page without `crypto.subtle` (a plain-HTTP LAN origin),
 * against the real `server/node/server.cjs` run as a child process. Without
 * WebCrypto the page signs with a software P-256 key kept in IndexedDB; the
 * server must accept its login, storage tokens and asset tokens, refuse a
 * tampered one, and the pages that do have `crypto.subtle` must keep the
 * non-extractable key pair and the per-request key read they have today.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const realCrypto = globalThis.crypto
const NodeBuffer = globalThis.Buffer

const h = vi.hoisted(() => ({
    cryptoRecord: null as CryptoKeyPair | null,
    answers: [] as string[],
    prompts: 0,
}))

vi.mock('src/lang', () => ({
    language: { setNodePassword: 'set password', inputNodePassword: 'input password' },
}))

vi.mock('src/ts/util', () => ({
    // A copy of the real encoder (btoa based), so it runs under a polyfilled `Buffer` as well.
    base64url: (source: Uint8Array | ArrayBuffer) => {
        const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source
        return btoa(String.fromCharCode.apply(null, [...bytes])).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    },
    getKeypairStore: vi.fn(async () => h.cryptoRecord),
    saveKeypairStore: vi.fn(async () => { }),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    waitAlert: vi.fn(async () => { }),
    alertInput: vi.fn(async () => {
        h.prompts++
        await new Promise((resolve) => setTimeout(resolve, 20))
        return h.answers.shift() ?? 'fixture-password'
    }),
}))

type NodeStorageModule = typeof import('src/ts/storage/nodeStorage')
type UtilMock = typeof import('src/ts/util')

const realFetch = globalThis.fetch
let fixture: NodeServerFixture | null = null
let nodeStorage: NodeStorageModule

function stubNoSubtle(): void {
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
}

async function stubPolyfillBuffer(): Promise<void> {
    const { Buffer: PolyfillBuffer } = await import('buffer/index.js')
    expect(() => PolyfillBuffer.from([1]).toString('base64url' as BufferEncoding)).toThrow(/Unknown encoding/)
    vi.stubGlobal('Buffer', PolyfillBuffer)
}

async function startServer(provisioned: boolean): Promise<void> {
    fixture = await startNodeServer({ provisioned })
    const baseUrl = fixture.baseUrl
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => realFetch(`${baseUrl}${input}`, init))
    vi.resetModules()
    nodeStorage = await import('src/ts/storage/nodeStorage')
}

function decodeToken(token: string): {
    header: Record<string, unknown>
    payload: { iat: number, exp?: number, aud?: string, pub: JsonWebKey }
    signed: string
    signature: Uint8Array
} {
    const [head, payload, signature] = token.split('.')
    return {
        header: JSON.parse(NodeBuffer.from(head, 'base64url').toString('utf-8')),
        payload: JSON.parse(NodeBuffer.from(payload, 'base64url').toString('utf-8')),
        signed: `${head}.${payload}`,
        signature: new Uint8Array(NodeBuffer.from(signature, 'base64url')),
    }
}

async function verifies(token: string): Promise<boolean> {
    const { payload, signed, signature } = decodeToken(token)
    const key = await realCrypto.subtle.importKey('jwk', payload.pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return await realCrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature as BufferSource, new TextEncoder().encode(signed))
}

function reencode(value: object): string {
    return NodeBuffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
}

beforeEach(async () => {
    // The mocked module instance outlives `vi.resetModules()`, so a test's own
    // implementation must not reach the next test.
    const util = await import('src/ts/util') as UtilMock
    vi.mocked(util.getKeypairStore).mockImplementation(async () => h.cryptoRecord)
    vi.mocked(util.saveKeypairStore).mockImplementation(async () => { })
    vi.mocked(util.getKeypairStore).mockClear()
    vi.mocked(util.saveKeypairStore).mockClear()
    h.cryptoRecord = null
    h.answers = []
    h.prompts = 0
    vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(async () => {
    vi.unstubAllGlobals()
    await fixture?.stop()
    fixture = null
})

describe('NodeStorage without crypto.subtle', () => {
    test('a provisioned server is logged in with a software key and serves the operation', async () => {
        await startServer(true)
        stubNoSubtle()
        const util = await import('src/ts/util') as UtilMock
        const storage = new nodeStorage.NodeStorage()

        await expect(storage.keys()).resolves.toEqual([])

        expect(h.prompts).toBe(1)
        expect(util.getKeypairStore).not.toHaveBeenCalled()
        expect(util.saveKeypairStore).not.toHaveBeenCalled()
        const token = decodeToken(await storage.authHeader())
        expect(token.header).toEqual({ alg: 'ES256', typ: 'JWT' })
        expect(Object.keys(token.payload)).toEqual(['iat', 'exp', 'pub'])
        expect(Object.keys(token.payload.pub)).toEqual(['kty', 'crv', 'x', 'y'])
        expect(token.signature.length).toBe(64)
        expect(await verifies(await storage.authHeader())).toBe(true)
    }, 60_000)

    test('the same flow works when Buffer is the browser polyfill', async () => {
        await startServer(true)
        stubNoSubtle()
        await stubPolyfillBuffer()
        const storage = new nodeStorage.NodeStorage()

        await expect(storage.keys()).resolves.toEqual([])

        expect(await verifies(await storage.authHeader())).toBe(true)
        const asset = decodeToken(await storage.assetReadToken())
        expect(NodeBuffer.from(asset.payload.pub.x ?? '', 'base64url').length).toBe(32)
        expect(NodeBuffer.from(asset.payload.pub.y ?? '', 'base64url').length).toBe(32)
    }, 60_000)

    test('the server refuses a tampered signature and a tampered payload that is still in the token window', async () => {
        await startServer(true)
        stubNoSubtle()
        const storage = new nodeStorage.NodeStorage()
        await storage.keys()
        const baseUrl = fixture?.baseUrl ?? ''
        const call = (token: string) => realFetch(`${baseUrl}/api/list`, { headers: { 'risu-auth': token } })

        const token = await storage.authHeader()
        expect((await call(token)).status).toBe(200)

        const [head, payload, signature] = token.split('.')
        const flipped = NodeBuffer.from(signature, 'base64url')
        flipped[flipped.length - 1] ^= 1
        const badSignature = await call(`${head}.${payload}.${flipped.toString('base64url')}`)
        expect(badSignature.status).toBe(400)
        expect(await badSignature.text()).toContain('Invalid Signature')

        const claims = decodeToken(token).payload
        const badPayload = await call(`${head}.${reencode({ ...claims, exp: (claims.exp ?? 0) - 1 })}.${signature}`)
        expect(badPayload.status).toBe(400)
        expect(await badPayload.text()).toContain('Invalid Signature')
    }, 60_000)

    test('a fresh server with no password asks once for concurrent first calls', async () => {
        await startServer(false)
        stubNoSubtle()
        h.answers = ['new password']
        const storage = new nodeStorage.NodeStorage()

        const outcomes = await Promise.allSettled([storage.keys(), storage.keys()])

        expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
        expect(h.prompts).toBe(1)
    }, 60_000)

    test('a reload finds the stored key: same public key and no second prompt', async () => {
        await startServer(true)
        stubNoSubtle()
        const first = new nodeStorage.NodeStorage()
        await first.keys()
        expect(h.prompts).toBe(1)
        const before = decodeToken(await first.authHeader()).payload.pub

        vi.resetModules()
        nodeStorage = await import('src/ts/storage/nodeStorage')
        const reloaded = new nodeStorage.NodeStorage(nodeStorage.createNodeAuthState())

        await expect(reloaded.keys()).resolves.toEqual([])
        expect(h.prompts).toBe(1)
        expect(JSON.stringify(decodeToken(await reloaded.authHeader()).payload.pub)).toBe(JSON.stringify(before))
    }, 60_000)

    test('a stored CryptoKey record is neither read nor written; a software key logs in', async () => {
        await startServer(true)
        const record = await realCrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        h.cryptoRecord = record
        const recordJwk = await realCrypto.subtle.exportKey('jwk', record.publicKey)
        stubNoSubtle()
        const util = await import('src/ts/util') as UtilMock
        const storage = new nodeStorage.NodeStorage()

        await expect(storage.keys()).resolves.toEqual([])

        expect(h.prompts).toBe(1)
        expect(util.getKeypairStore).not.toHaveBeenCalled()
        expect(util.saveKeypairStore).not.toHaveBeenCalled()
        expect(decodeToken(await storage.authHeader()).payload.pub).not.toEqual(recordJwk)
    }, 60_000)

    test('the asset route accepts a software-signed asset token and refuses a tampered one', async () => {
        await startServer(true)
        stubNoSubtle()
        const storage = new nodeStorage.NodeStorage()
        const key = 'assets/probe.png'
        const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
        await storage.setItem(key, bytes)
        const baseUrl = fixture?.baseUrl ?? ''
        const token = await storage.assetReadToken()
        const url = (value: string) => `${baseUrl}/api/asset/${hexOfKey(key)}?risu-auth=${encodeURIComponent(value)}`

        const ok = await realFetch(url(token))
        expect(ok.status).toBe(200)
        expect(new Uint8Array(await ok.arrayBuffer())).toEqual(bytes)

        const [head, payload, signature] = token.split('.')
        const flipped = NodeBuffer.from(signature, 'base64url')
        flipped[flipped.length - 1] ^= 1
        expect((await realFetch(url(`${head}.${payload}.${flipped.toString('base64url')}`))).status).toBe(401)
    }, 60_000)
})

describe('NodeStorage with crypto.subtle', () => {
    test('the non-extractable key pair is saved once and read again on every request; no software record is made', async () => {
        await startServer(true)
        const util = await import('src/ts/util') as UtilMock
        let saved: CryptoKeyPair | null = null
        vi.mocked(util.getKeypairStore).mockImplementation(async () => saved)
        vi.mocked(util.saveKeypairStore).mockImplementation(async (_name: string, pair: CryptoKeyPair) => { saved = pair })
        const storage = new nodeStorage.NodeStorage()

        await expect(storage.keys()).resolves.toEqual([])

        expect(util.saveKeypairStore).toHaveBeenCalledTimes(1)
        const pair = saved as CryptoKeyPair | null
        expect(pair?.privateKey.extractable).toBe(false)
        expect(pair?.privateKey.algorithm).toEqual({ name: 'ECDSA', namedCurve: 'P-256' })
        expect(pair?.privateKey.usages).toEqual(['sign'])
        const token = decodeToken(await storage.authHeader())
        expect(Object.keys(token.payload)).toEqual(['iat', 'exp', 'pub'])
        expect(token.payload.pub).toEqual(await realCrypto.subtle.exportKey('jwk', (pair as CryptoKeyPair).publicKey))
        expect(await verifies(await storage.authHeader())).toBe(true)
        const databases = await indexedDB.databases()
        expect(databases.map((database) => database.name)).not.toContain('DPoPDB')

        const reads = vi.mocked(util.getKeypairStore).mock.calls.length
        await storage.keys()
        expect(vi.mocked(util.getKeypairStore).mock.calls.length).toBe(reads + 1)
    }, 60_000)

    test('a stored software record is ignored', async () => {
        await startServer(true)
        stubNoSubtle()
        const { loadSoftwareNodeKey } = await import('src/ts/storage/nodeKey')
        const seeded = JSON.stringify(await (await loadSoftwareNodeKey()).publicJwk())
        // Only the crypto stub goes: the per-test IndexedDB factory holds the seeded record.
        vi.stubGlobal('crypto', realCrypto)
        const record = await realCrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        h.cryptoRecord = record
        const storage = new nodeStorage.NodeStorage()

        await storage.keys()

        const pub = decodeToken(await storage.authHeader()).payload.pub
        expect(pub).toEqual(await realCrypto.subtle.exportKey('jwk', record.publicKey))
        expect(JSON.stringify(pub)).not.toBe(seeded)
        stubNoSubtle()
        expect(JSON.stringify(await (await loadSoftwareNodeKey()).publicJwk())).toBe(seeded)
    }, 60_000)

    test('a WebCrypto failure surfaces and never falls back to a software key', async () => {
        await startServer(true)
        vi.stubGlobal('crypto', {
            getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
            subtle: { generateKey: () => Promise.reject(new Error('gen failed')) },
        })
        const storage = new nodeStorage.NodeStorage()

        await expect(storage.authHeader()).rejects.toThrow('gen failed')

        const databases = await indexedDB.databases()
        expect(databases.map((database) => database.name)).not.toContain('DPoPDB')
    }, 60_000)
})
