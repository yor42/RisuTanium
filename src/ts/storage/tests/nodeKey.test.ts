// @vitest-environment node
/**
 * The Node page's signing key: the software P-256 key used when `crypto.subtle`
 * is absent, its persistence in IndexedDB, and the choice between the software
 * and the WebCrypto signer.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { p256 } from '@noble/curves/nist.js'
import {
    base64UrlOf,
    loadSoftwareNodeKey,
    openKeypairStoreDB,
    softwareNodeKey,
    webCryptoAvailable,
} from 'src/ts/storage/nodeKey'

const realCrypto = globalThis.crypto
const NodeBuffer = globalThis.Buffer
const ES256 = { name: 'ECDSA', hash: 'SHA-256' } as const

function stubNoSubtle(): void {
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
}

async function stubPolyfillBuffer(): Promise<void> {
    const { Buffer: PolyfillBuffer } = await import('buffer/index.js')
    expect(() => PolyfillBuffer.from([1]).toString('base64url' as BufferEncoding)).toThrow(/Unknown encoding/)
    vi.stubGlobal('Buffer', PolyfillBuffer)
}

async function verifies(jwk: JsonWebKey, signature: Uint8Array, message: Uint8Array, subtle: SubtleCrypto): Promise<boolean> {
    const key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return await subtle.verify(ES256, key, signature as BufferSource, message as BufferSource)
}

async function readRecord(key: string): Promise<unknown> {
    const db = await openKeypairStoreDB('node')
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction('node', 'readonly').objectStore('node').get(key)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
    } finally {
        db.close()
    }
}

async function writeRecord(key: string, value: unknown): Promise<void> {
    const db = await openKeypairStoreDB('node')
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('node', 'readwrite')
            tx.objectStore('node').put(value, key)
            tx.oncomplete = () => resolve()
            tx.onabort = () => reject(tx.error)
        })
    } finally {
        db.close()
    }
}

beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('webCryptoAvailable', () => {
    test('is false without crypto.subtle and true with it', () => {
        expect(webCryptoAvailable()).toBe(true)
        stubNoSubtle()
        expect(webCryptoAvailable()).toBe(false)
    })
})

describe('the software key', () => {
    test('signs a 64-byte r||s signature that WebCrypto verifies, and not for another message', async () => {
        stubNoSubtle()
        const secret = p256.utils.randomSecretKey()
        const key = softwareNodeKey(secret)
        const message = new TextEncoder().encode('head.payload')

        const signature = await key.sign(message)

        expect(signature.length).toBe(64)
        const jwk = await key.publicJwk()
        expect(await verifies(jwk, signature, message, realCrypto.subtle)).toBe(true)
        expect(await verifies(jwk, signature, new TextEncoder().encode('head.payloae'), realCrypto.subtle)).toBe(false)
    })

    test('has a stable JWK of fixed shape, also when Buffer is the browser polyfill', async () => {
        stubNoSubtle()
        await stubPolyfillBuffer()
        const secret = p256.utils.randomSecretKey()
        const key = softwareNodeKey(secret)

        const jwk = await key.publicJwk()

        expect(Object.keys(jwk)).toEqual(['kty', 'crv', 'x', 'y'])
        expect(NodeBuffer.from(jwk.x ?? '', 'base64url').length).toBe(32)
        expect(NodeBuffer.from(jwk.y ?? '', 'base64url').length).toBe(32)
        expect(JSON.stringify(await key.publicJwk())).toBe(JSON.stringify(jwk))
        expect(JSON.stringify(await softwareNodeKey(secret).publicJwk())).toBe(JSON.stringify(jwk))
        const point = p256.getPublicKey(secret, false).subarray(1)
        expect(new Uint8Array([...NodeBuffer.from(jwk.x ?? '', 'base64url'), ...NodeBuffer.from(jwk.y ?? '', 'base64url')])).toEqual(new Uint8Array(point))
        const input = (await import('buffer/index.js')).Buffer.from('a.b')
        expect(await verifies(jwk, await key.sign(input), new TextEncoder().encode('a.b'), realCrypto.subtle)).toBe(true)
    })

    test('base64UrlOf is unpadded base64url and ignores Buffer', async () => {
        await stubPolyfillBuffer()
        expect(base64UrlOf(new Uint8Array([251, 255, 254, 1]))).toBe('-__-AQ')
        expect(base64UrlOf(new Uint8Array([]))).toBe('')
    })
})

describe('loadSoftwareNodeKey', () => {
    test('persists the key, returns the same key again and never touches the CryptoKey record', async () => {
        stubNoSubtle()
        await writeRecord('dpop', { privateKey: 'sentinel-a', publicKey: 'sentinel-b' })

        const first = await (await loadSoftwareNodeKey()).publicJwk()
        const second = await (await loadSoftwareNodeKey()).publicJwk()

        expect(JSON.stringify(second)).toBe(JSON.stringify(first))
        const record = await readRecord('software-p256') as { kind: string, version: number, secretKey: Uint8Array }
        expect(record.kind).toBe('software-p256')
        expect(record.version).toBe(1)
        expect(record.secretKey.length).toBe(32)
        expect(await readRecord('dpop')).toEqual({ privateKey: 'sentinel-a', publicKey: 'sentinel-b' })
        // No connection stays open after a successful load.
        const blocked = vi.fn()
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase('DPoPDB')
            request.onblocked = blocked
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
        })
        expect(blocked).not.toHaveBeenCalled()
    })

    test.each([
        ['a 31-byte secret', (record: { secretKey: Uint8Array }) => ({ ...record, secretKey: record.secretKey.slice(0, 31) })],
        ['an all-zero secret', (record: { secretKey: Uint8Array }) => ({ ...record, secretKey: new Uint8Array(32) })],
        ['an unknown version', (record: object) => ({ ...record, version: 2 })],
        ['another kind', (record: object) => ({ ...record, kind: 'other' })],
        ['a string value', () => 'not a record'],
    ])('replaces a record that holds %s and leaves the CryptoKey record alone', async (_label, corrupt) => {
        stubNoSubtle()
        await writeRecord('dpop', { privateKey: 'sentinel-a', publicKey: 'sentinel-b' })
        await loadSoftwareNodeKey()
        const original = await readRecord('software-p256') as { secretKey: Uint8Array }
        await writeRecord('software-p256', corrupt(original))

        const key = await loadSoftwareNodeKey()

        const message = new TextEncoder().encode('m')
        expect(await verifies(await key.publicJwk(), await key.sign(message), message, realCrypto.subtle)).toBe(true)
        const record = await readRecord('software-p256') as { kind: string, version: number, secretKey: Uint8Array }
        expect(record.kind).toBe('software-p256')
        expect(record.version).toBe(1)
        expect(record.secretKey.length).toBe(32)
        expect(NodeBuffer.from(record.secretKey).equals(NodeBuffer.from(original.secretKey))).toBe(false)
        expect(await readRecord('dpop')).toEqual({ privateKey: 'sentinel-a', publicKey: 'sentinel-b' })
    })

    test('concurrent first loads end with one key', async () => {
        stubNoSubtle()

        const keys = await Promise.all(Array.from({ length: 5 }, () => loadSoftwareNodeKey()))

        const jwks = await Promise.all(keys.map((key) => key.publicJwk()))
        expect(new Set(jwks.map((jwk) => JSON.stringify(jwk))).size).toBe(1)
        const record = await readRecord('software-p256') as { secretKey: Uint8Array }
        expect(JSON.stringify(await softwareNodeKey(record.secretKey).publicJwk())).toBe(JSON.stringify(jwks[0]))
    })

    test('a failure inside the load rejects with the original error, writes nothing and closes the connection', async () => {
        vi.stubGlobal('crypto', {})

        const error = await loadSoftwareNodeKey().then(() => null, (reason: unknown) => reason)

        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/getRandomValues/)
        expect(await readRecord('software-p256')).toBeUndefined()
        const blocked = vi.fn()
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase('DPoPDB')
            request.onblocked = blocked
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
        })
        expect(blocked).not.toHaveBeenCalled()
    })
})

describe('getPageSoftwareNodeKey', () => {
    test('drops a failed load so a later call succeeds, then returns one promise', async () => {
        vi.resetModules()
        const fresh = await import('src/ts/storage/nodeKey')
        vi.stubGlobal('crypto', {})
        await expect(fresh.getPageSoftwareNodeKey()).rejects.toThrow(/getRandomValues/)

        stubNoSubtle()
        const key = await fresh.getPageSoftwareNodeKey()

        expect(key).toBeDefined()
        expect(fresh.getPageSoftwareNodeKey()).toBe(fresh.getPageSoftwareNodeKey())
    })
})
