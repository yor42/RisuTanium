// @vitest-environment happy-dom

/**
 * `encryptBuffer` / `decryptBuffer` of `src/ts/util.ts` are the byte format of .risup, rcc and
 * translator preset files. They must give the bytes upstream's WebCrypto call gives, on a page
 * with `crypto.subtle` and on a plain-HTTP page without it, and a wrong key must reject with an
 * error named `OperationError`. The reference producer is upstream's exact `subtle` call.
 * The no-subtle halves are regression reproducers; the realCrypto halves are compatibility
 * guards that pass before and after and pin the WebCrypto call shape of aead.ts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { decryptBuffer, encryptBuffer } from './util'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(), appDataDir: vi.fn(), join: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 14 },
    readFile: vi.fn(async () => new Uint8Array()),
    open: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(),
    rename: vi.fn(),
    writeFile: vi.fn(),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], allowAllExtentionFiles: false })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({})),
}))

const realCrypto = globalThis.crypto

const utf8 = (text: string) => new TextEncoder().encode(text)
const hex = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('hex')

/** Upstream's exact call, run on the real WebCrypto. */
async function referenceEncrypt(data: Uint8Array, keys: string): Promise<Uint8Array> {
    const keyArray = await realCrypto.subtle.digest('SHA-256', utf8(keys))
    const key = await realCrypto.subtle.importKey('raw', keyArray, 'AES-GCM', false, ['encrypt', 'decrypt'])
    return new Uint8Array(await realCrypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(data)))
}

async function referenceDecrypt(data: Uint8Array, keys: string): Promise<Uint8Array> {
    const keyArray = await realCrypto.subtle.digest('SHA-256', utf8(keys))
    const key = await realCrypto.subtle.importKey('raw', keyArray, 'AES-GCM', false, ['encrypt', 'decrypt'])
    return new Uint8Array(await realCrypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(data)))
}

function stubNoSubtle() {
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
    expect((globalThis.crypto as { subtle?: unknown }).subtle).toBeUndefined()
}

const VECTORS: { keys: string, plain: string, sealed: string }[] = [
    { keys: 'risupreset', plain: 'risu', sealed: '0656022bb14981042a767da007f0e3729bb04e42' },
    { keys: 'risupreset', plain: '', sealed: 'c22f245fab9e69b1db6f7c76bd9fd16f' },
    { keys: 'RISU_NONE', plain: '{"spec":"chara_card_v2"}', sealed: '17d40793502cd68c0ce2f843cbed0f2dd16f35a86595086ba825f329db136f44355313dbca610c33' },
    { keys: 'pw', plain: '{"spec":"chara_card_v2"}', sealed: '969a1e299402d05ad90976bfe72e3f1770184da595a19686242c767c0ed11064b891175de4c9e303' },
    { keys: 'risutl', plain: 'translator', sealed: '1297cb9111816a5c3f9570f68235384340dd8d61be6b6a072672' },
]

const BACKENDS: { name: string, install: () => void }[] = [
    { name: 'no crypto.subtle', install: stubNoSubtle },
    { name: 'realCrypto', install: () => { expect(globalThis.crypto.subtle).toBeDefined() } },
]

afterEach(() => {
    vi.unstubAllGlobals()
})

describe.each(BACKENDS)('legacy cipher on $name', ({ install }) => {
    beforeEach(() => {
        install()
    })

    test('T1 fixed WebCrypto vectors encrypt and decrypt byte-identically', async () => {
        for (const v of VECTORS) {
            expect(hex(await encryptBuffer(utf8(v.plain), v.keys))).toBe(v.sealed)
            const opened = await decryptBuffer(new Uint8Array(Buffer.from(v.sealed, 'hex')), v.keys)
            expect(new TextDecoder().decode(opened)).toBe(v.plain)
        }
    })

    test('T4 authentication failure rejects with OperationError, malformed input rejects', async () => {
        const sealed = new Uint8Array(Buffer.from(VECTORS[2].sealed, 'hex'))
        const wrongKey = await decryptBuffer(sealed, 'not-the-key').then(() => null, (e: unknown) => e)
        expect((wrongKey as { name?: string } | null)?.name).toBe('OperationError')

        const flipped = sealed.slice()
        flipped[flipped.length - 1] ^= 1
        const damaged = await decryptBuffer(flipped, 'RISU_NONE').then(() => null, (e: unknown) => e)
        expect((damaged as { name?: string } | null)?.name).toBe('OperationError')

        const short = await decryptBuffer(new Uint8Array(5), 'RISU_NONE').then(() => null, (e: unknown) => e)
        expect(short).not.toBeNull()
    })

    test('T5 both functions resolve an exact ArrayBuffer', async () => {
        const sealed = await encryptBuffer(utf8('exact'), 'k')
        expect(Object.prototype.toString.call(sealed)).toBe('[object ArrayBuffer]')
        expect(sealed.byteLength).toBe(5 + 16)
        const opened = await decryptBuffer(new Uint8Array(sealed), 'k')
        expect(Object.prototype.toString.call(opened)).toBe('[object ArrayBuffer]')
        expect(opened.byteLength).toBe(5)
    })
})

describe('a backend that returns a view into a larger buffer', () => {
    test('T5 both functions still resolve an ArrayBuffer of exactly the result length', async () => {
        const backing = new Uint8Array(64).fill(7)
        const view = backing.subarray(8, 13)
        vi.resetModules()
        vi.doMock('./drive/rtb/sealed/aead', () => ({
            selectAead: () => ({
                name: 'noble',
                importKey: async (raw: Uint8Array) => raw,
                seal: async () => view,
                open: async () => view,
            }),
        }))
        try {
            const util = await import('./util')
            const sealed = await util.encryptBuffer(utf8('x'), 'k')
            const opened = await util.decryptBuffer(utf8('x'), 'k')
            for (const result of [sealed, opened]) {
                expect(Object.prototype.toString.call(result)).toBe('[object ArrayBuffer]')
                expect(result.byteLength).toBe(5)
                expect(hex(result)).toBe('0707070707')
            }
        } finally {
            vi.doUnmock('./drive/rtb/sealed/aead')
            vi.resetModules()
        }
    })
})

const LENGTHS =[0, 1, 15, 16, 17, 1024 * 1024]

function offsetInput(length: number): Uint8Array {
    const backing = Buffer.alloc(length + 2)
    for (let i = 0; i < length; i++) backing[i + 1] = (i * 31 + 7) & 0xff
    return backing.subarray(1, 1 + length)
}

describe('cross-backend byte compatibility', () => {
    test.each(LENGTHS)('T2 WebCrypto-made bytes decrypt without subtle, length %i', async (length) => {
        const plain = offsetInput(length)
        const sealed = await referenceEncrypt(plain, 'cross')
        stubNoSubtle()
        const opened = await decryptBuffer(Buffer.from(sealed).subarray(0), 'cross')
        expect(hex(opened)).toBe(hex(plain))
    })

    test.each(LENGTHS)('T3 bytes made without subtle decrypt under WebCrypto, length %i', async (length) => {
        const plain = offsetInput(length)
        const reference = await referenceEncrypt(plain, 'cross')
        stubNoSubtle()
        const sealed = await encryptBuffer(plain, 'cross')
        expect(hex(sealed)).toBe(hex(reference))
        vi.unstubAllGlobals()
        expect(hex(await referenceDecrypt(new Uint8Array(sealed), 'cross'))).toBe(hex(plain))
    })
})
