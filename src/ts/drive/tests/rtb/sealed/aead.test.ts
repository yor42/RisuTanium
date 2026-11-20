// @vitest-environment node
import { gcm } from '@noble/ciphers/aes.js'
import { describe, expect, test } from 'vitest'
import { NOBLE_TAG_ERROR_MESSAGE, nobleAead, selectAead, webCryptoAead, type AeadBackend } from 'src/ts/drive/rtb/sealed/aead'

const BACKENDS: Array<[string, () => AeadBackend]> = [
    ['webcrypto', () => webCryptoAead()],
    ['noble', () => nobleAead()],
]

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex')
}

const ZERO_KEY = new Uint8Array(32)
const ZERO_NONCE = new Uint8Array(12)
const NO_AAD = new Uint8Array(0)

describe.each(BACKENDS)('%s backend', (_name, make) => {
    test('KG1: McGrew-Viega test case 13 (empty plaintext)', async () => {
        const aead = make()
        const sealed = await aead.seal(await aead.importKey(ZERO_KEY), ZERO_NONCE, new Uint8Array(0), NO_AAD)
        expect(hex(sealed)).toBe('530f8afbc74536b9a963b4f1c4cb738b')
    })

    test('KG2: test case 14 (one zero block)', async () => {
        const aead = make()
        const sealed = await aead.seal(await aead.importKey(ZERO_KEY), ZERO_NONCE, new Uint8Array(16), NO_AAD)
        expect(hex(sealed)).toBe('cea7403d4d606b6e074ec5d3baf39d18' + 'd0d1c8a799996bf0265b98b5d48ab919')
    })

    const key16 = Buffer.from('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308', 'hex')
    const iv16 = Buffer.from('cafebabefacedbaddecaf888', 'hex')
    const pt16 = Buffer.from('d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39', 'hex')
    const aad16 = Buffer.from('feedfacedeadbeeffeedfacedeadbeefabaddad2', 'hex')
    const sealed16 = '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662' + '76fc6ece0f4e1768cddf8853bb2d551b'

    test('KG3: test case 16 seals to the published bytes and opens back', async () => {
        const aead = make()
        const key = await aead.importKey(new Uint8Array(key16))
        const sealed = await aead.seal(key, new Uint8Array(iv16), new Uint8Array(pt16), new Uint8Array(aad16))
        expect(hex(sealed)).toBe(sealed16)
        const opened = await aead.open(key, new Uint8Array(iv16), sealed, new Uint8Array(aad16))
        expect(opened === null ? null : hex(opened)).toBe(pt16.toString('hex'))
    })

    test('a flipped tag, a flipped ciphertext byte, other AAD and another nonce all open to null', async () => {
        const aead = make()
        const key = await aead.importKey(new Uint8Array(key16))
        const sealed = await aead.seal(key, new Uint8Array(iv16), new Uint8Array(pt16), new Uint8Array(aad16))
        const tag = new Uint8Array(sealed)
        tag[tag.length - 1] ^= 1
        expect(await aead.open(key, new Uint8Array(iv16), tag, new Uint8Array(aad16))).toBeNull()
        const body = new Uint8Array(sealed)
        body[0] ^= 1
        expect(await aead.open(key, new Uint8Array(iv16), body, new Uint8Array(aad16))).toBeNull()
        expect(await aead.open(key, new Uint8Array(iv16), sealed, NO_AAD)).toBeNull()
        const nonce = new Uint8Array(iv16)
        nonce[0] ^= 1
        expect(await aead.open(key, nonce, sealed, new Uint8Array(aad16))).toBeNull()
    })

    test('a key made by the other backend is a loud error, not an authentication failure', async () => {
        const other = make().name === 'webcrypto' ? nobleAead() : webCryptoAead()
        const foreign = await other.importKey(new Uint8Array(key16))
        const aead = make()
        const sealed = await aead.seal(await aead.importKey(new Uint8Array(key16)), new Uint8Array(iv16), new Uint8Array(pt16), NO_AAD)
        await expect(aead.open(foreign, new Uint8Array(iv16), sealed, NO_AAD)).rejects.toBeInstanceOf(TypeError)
    })
})

describe('the two backends agree', () => {
    test('what one seals the other opens, in both directions', async () => {
        const web = webCryptoAead()
        const noble = nobleAead()
        const raw = new Uint8Array(32).map((_, i) => i * 3)
        const nonce = new Uint8Array(12).map((_, i) => i + 9)
        const plain = new Uint8Array(1000).map((_, i) => (i * 11) & 255)
        const fromWeb = await web.seal(await web.importKey(raw), nonce, plain, new Uint8Array([1, 2, 3]))
        const fromNoble = await noble.seal(await noble.importKey(raw), nonce, plain, new Uint8Array([1, 2, 3]))
        expect(hex(fromWeb)).toBe(hex(fromNoble))
        expect(hex((await noble.open(await noble.importKey(raw), nonce, fromWeb, new Uint8Array([1, 2, 3])))!)).toBe(hex(plain))
        expect(hex((await web.open(await web.importKey(raw), nonce, fromNoble, new Uint8Array([1, 2, 3])))!)).toBe(hex(plain))
    })
})

describe('authentication failure is recognised exactly', () => {
    test('noble throws the message the engine matches (a package rename fails here)', () => {
        const sealed = gcm(ZERO_KEY, ZERO_NONCE, NO_AAD).encrypt(new Uint8Array(4))
        sealed[sealed.length - 1] ^= 1
        let thrown: unknown
        try {
            gcm(ZERO_KEY, ZERO_NONCE, NO_AAD).decrypt(sealed)
        } catch (error) {
            thrown = error
        }
        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toBe(NOBLE_TAG_ERROR_MESSAGE)
        expect(NOBLE_TAG_ERROR_MESSAGE).toBe('aes-gcm: invalid tag')
    })

    test('noble: any other error is rethrown, not mapped to null', async () => {
        const aead = nobleAead()
        const shortKey = new Uint8Array(5)
        await expect(aead.open(shortKey, ZERO_NONCE, new Uint8Array(32), NO_AAD)).rejects.toThrow()
        await expect(aead.open(shortKey, ZERO_NONCE, new Uint8Array(32), NO_AAD)).rejects.not.toThrow(NOBLE_TAG_ERROR_MESSAGE)
    })

    test('webcrypto: a non-OperationError rejection is rethrown, an OperationError is null', async () => {
        const failing = (error: unknown) => webCryptoAead({ decrypt: async () => { throw error } } as unknown as SubtleCrypto)
        // The key type is checked before the subtle call, so a real CryptoKey goes with the stubbed subtle.
        const real = await globalThis.crypto.subtle.importKey('raw', ZERO_KEY, 'AES-GCM', false, ['decrypt'])
        const type = new TypeError('not a tag problem')
        await expect(failing(type).open(real, ZERO_NONCE, new Uint8Array(32), NO_AAD)).rejects.toBe(type)
        const other = new DOMException('quota', 'QuotaExceededError')
        await expect(failing(other).open(real, ZERO_NONCE, new Uint8Array(32), NO_AAD)).rejects.toBe(other)
        const auth = new DOMException('bad tag', 'OperationError')
        expect(await failing(auth).open(real, ZERO_NONCE, new Uint8Array(32), NO_AAD)).toBeNull()
    })
})

describe('selectAead', () => {
    test('uses WebCrypto when subtle exists and noble when it does not', () => {
        expect(selectAead().name).toBe('webcrypto')
        expect(selectAead({ crypto: { subtle: globalThis.crypto.subtle } }).name).toBe('webcrypto')
        expect(selectAead({}).name).toBe('noble')
        expect(selectAead({ crypto: {} }).name).toBe('noble')
    })

    test('a WebCrypto backend keeps the subtle it was made with', async () => {
        const subtle = globalThis.crypto.subtle
        const aead = selectAead({ crypto: { subtle } })
        const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle')
        Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: undefined })
        try {
            const key = await aead.importKey(ZERO_KEY)
            const sealed = await aead.seal(key, ZERO_NONCE, new Uint8Array(1), NO_AAD)
            expect(sealed.length).toBe(17)
        } finally {
            if (original) {
                Object.defineProperty(globalThis.crypto, 'subtle', original)
            } else {
                delete (globalThis.crypto as { subtle?: SubtleCrypto }).subtle
            }
        }
    })
})
