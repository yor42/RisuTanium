// @vitest-environment node
/**
 * The asset-read token a Node page puts in asset URLs: minted once per key
 * pair, shared by concurrent first callers, kept in `localStorage` so a reload
 * reuses it, and never holding `___` (the separator of a bgm control string).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
    ASSET_READ_TOKEN_STORAGE_KEY,
    createAssetTokenSource,
    type AssetTokenFlags,
} from 'src/ts/storage/nodeAssetToken'

async function newKeyPair(): Promise<CryptoKeyPair> {
    return await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
}

function memoryStorage(initial: Record<string, string> = {}): AssetTokenFlags & { values: Map<string, string>, writes: number } {
    const values = new Map(Object.entries(initial))
    const storage = {
        values,
        writes: 0,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            storage.writes++
            values.set(key, value)
        },
    }
    return storage
}

function decode(token: string): { header: Record<string, unknown>, payload: Record<string, unknown>, signed: string, signature: Buffer } {
    const [head, payload, signature] = token.split('.')
    return {
        header: JSON.parse(Buffer.from(head, 'base64url').toString('utf-8')),
        payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')),
        signed: `${head}.${payload}`,
        signature: Buffer.from(signature, 'base64url'),
    }
}

let keyPair: CryptoKeyPair

beforeEach(async () => {
    keyPair = await newKeyPair()
})

describe('the asset-read token', () => {
    test('is an ES256 token with the asset-read audience, the public key, no expiry and a valid signature', async () => {
        const token = await createAssetTokenSource({ getKeyPair: async () => keyPair, storage: memoryStorage() })()
        const { header, payload, signed, signature } = decode(token)
        expect(header).toEqual({ alg: 'ES256', typ: 'JWT' })
        expect(payload.aud).toBe('asset-read')
        expect(typeof payload.iat).toBe('number')
        expect('exp' in payload).toBe(false)
        expect(payload.pub).toEqual(await crypto.subtle.exportKey('jwk', keyPair.publicKey))
        expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.publicKey, new Uint8Array(signature), new TextEncoder().encode(signed))).toBe(true)
    })

    test('concurrent first calls share one mint', async () => {
        const storage = memoryStorage()
        const getKeyPair = vi.fn(async () => keyPair)
        const mintToken = vi.fn(async () => 'minted.once.token')
        const source = createAssetTokenSource({ getKeyPair, storage, mintToken })
        const tokens = await Promise.all([source(), source(), source(), source(), source()])
        expect(new Set(tokens)).toEqual(new Set(['minted.once.token']))
        expect(mintToken).toHaveBeenCalledTimes(1)
        expect(storage.writes).toBe(1)
    })

    test('a later call in the same page returns the same token without minting again', async () => {
        const mintToken = vi.fn(async () => 'minted.once.token')
        const source = createAssetTokenSource({ getKeyPair: async () => keyPair, storage: memoryStorage(), mintToken })
        const first = await source()
        expect(await source()).toBe(first)
        expect(mintToken).toHaveBeenCalledTimes(1)
    })

    test('a page load after a reload reuses the persisted token for the same key pair', async () => {
        const storage = memoryStorage()
        const first = await createAssetTokenSource({ getKeyPair: async () => keyPair, storage })()
        const writesAfterFirst = storage.writes
        const mintToken = vi.fn(async () => 'must.not.be.used')
        const second = await createAssetTokenSource({ getKeyPair: async () => keyPair, storage, mintToken })()
        expect(second).toBe(first)
        expect(mintToken).not.toHaveBeenCalled()
        expect(storage.writes).toBe(writesAfterFirst)
    })

    test('a different key pair mints a new token and persists it', async () => {
        const storage = memoryStorage()
        const first = await createAssetTokenSource({ getKeyPair: async () => keyPair, storage })()
        const otherPair = await newKeyPair()
        const second = await createAssetTokenSource({ getKeyPair: async () => otherPair, storage })()
        expect(second).not.toBe(first)
        expect(decode(second).payload.pub).toEqual(await crypto.subtle.exportKey('jwk', otherPair.publicKey))
        const third = await createAssetTokenSource({ getKeyPair: async () => otherPair, storage })()
        expect(third).toBe(second)
    })

    test('a stored token that contains the bgm separator is replaced', async () => {
        const storage = memoryStorage()
        const source = createAssetTokenSource({ getKeyPair: async () => keyPair, storage })
        const good = await source()
        const stored = JSON.parse(storage.values.get(ASSET_READ_TOKEN_STORAGE_KEY) ?? '{}')
        storage.values.set(ASSET_READ_TOKEN_STORAGE_KEY, JSON.stringify({ ...stored, token: 'head.pay___load.sig' }))
        const reloaded = await createAssetTokenSource({ getKeyPair: async () => keyPair, storage })()
        expect(reloaded).not.toContain('___')
        expect(reloaded).not.toBe('head.pay___load.sig')
        expect(decode(reloaded).payload.aud).toBe('asset-read')
        expect(good).not.toContain('___')
    })

    test('a minted token that contains the bgm separator is minted again', async () => {
        const mintToken = vi.fn()
            .mockResolvedValueOnce('a.b___c.d')
            .mockResolvedValueOnce('e.f___g.h')
            .mockResolvedValue('clean.token.value')
        const token = await createAssetTokenSource({ getKeyPair: async () => keyPair, storage: memoryStorage(), mintToken })()
        expect(token).toBe('clean.token.value')
        expect(mintToken).toHaveBeenCalledTimes(3)
    })

    test('a stored value that is not the expected record is replaced', async () => {
        const storage = memoryStorage({ [ASSET_READ_TOKEN_STORAGE_KEY]: '{not json' })
        const token = await createAssetTokenSource({ getKeyPair: async () => keyPair, storage })()
        expect(decode(token).payload.aud).toBe('asset-read')
        expect(JSON.parse(storage.values.get(ASSET_READ_TOKEN_STORAGE_KEY) ?? '{}').token).toBe(token)
    })

    test('a failing storage write still yields the token, which the page then keeps', async () => {
        const storage: AssetTokenFlags = {
            getItem: () => null,
            setItem: () => { throw new Error('quota') },
        }
        const mintToken = vi.fn(async () => 'in.memory.token')
        const source = createAssetTokenSource({ getKeyPair: async () => keyPair, storage, mintToken })
        expect(await source()).toBe('in.memory.token')
        expect(await source()).toBe('in.memory.token')
        expect(mintToken).toHaveBeenCalledTimes(1)
    })

    test('a page with no storage still yields a token', async () => {
        const token = await createAssetTokenSource({ getKeyPair: async () => keyPair, storage: null })()
        expect(decode(token).payload.aud).toBe('asset-read')
    })

    test('a failed mint rejects every waiting caller and the next call tries again', async () => {
        const mintToken = vi.fn()
            .mockRejectedValueOnce(new Error('no key'))
            .mockResolvedValue('second.try.token')
        const source = createAssetTokenSource({ getKeyPair: async () => keyPair, storage: memoryStorage(), mintToken })
        const waiting = await Promise.allSettled([source(), source()])
        expect(waiting.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected'])
        expect(await source()).toBe('second.try.token')
    })
})
