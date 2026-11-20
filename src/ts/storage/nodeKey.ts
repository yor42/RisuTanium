/**
 * The page's signing key for the self-hosted Node server (ES256 tokens and the
 * public key the server trusts after `/api/login`).
 *
 * With `crypto.subtle` the key is a non-extractable WebCrypto pair. A page on an
 * insecure origin (plain HTTP over a LAN address) has no `crypto.subtle`, so it
 * signs with a software P-256 key whose 32-byte private scalar is kept in
 * IndexedDB as readable bytes: any script on that origin can read it, which is the
 * trade-off accepted for this origin class. The software record lives under its
 * own key and shape, so it is never confused with the CryptoKey record; an
 * invalid or unknown-version record is replaced by a new key at the cost of one
 * password login, as a missing record is.
 */
import { p256 } from '@noble/curves/nist.js'

/**
 * Unpadded base64url built on `btoa`. It works on every page whatever
 * `Buffer` is, because the browser `buffer` polyfill has no `base64url` encoding.
 */
export function base64UrlOf(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export interface NodeKey {
    /**
     * The public key as a JWK. `JSON.stringify` of the result is the same for one
     * key on every call and every load: the server trusts the SHA-256 of that string.
     */
    publicJwk(): Promise<JsonWebKey>
    /** The 64-byte IEEE P1363 `r||s` ECDSA P-256/SHA-256 signature over `data`. */
    sign(data: Uint8Array): Promise<Uint8Array>
}

/** Whether this page has WebCrypto. Evaluated on every call, never cached. */
export function webCryptoAvailable(): boolean {
    return typeof globalThis.crypto?.subtle !== 'undefined'
}

export function webCryptoNodeKey(pair: CryptoKeyPair): NodeKey {
    return {
        publicJwk: () => crypto.subtle.exportKey('jwk', pair.publicKey),
        sign: async (data) => new Uint8Array(await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            pair.privateKey,
            data as BufferSource,
        )),
    }
}

export function softwareNodeKey(secretKey: Uint8Array): NodeKey {
    // The uncompressed point is 0x04 || X || Y; the default would be compressed.
    const point = p256.getPublicKey(secretKey, false)
    const x = point.subarray(1, 33)
    const y = point.subarray(33, 65)
    return {
        publicJwk: async () => ({ kty: 'EC', crv: 'P-256', x: base64UrlOf(x), y: base64UrlOf(y) }),
        sign: async (data) => p256.sign(data, secretKey, { prehash: true, lowS: true, format: 'compact' }),
    }
}

/** Opens (creating on first use) the `DPoPDB` database and its named object store. */
export function openKeypairStoreDB(name:string):Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("DPoPDB", 1);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(name || "DPoPStore")) {
                db.createObjectStore(name || "DPoPStore");
            }
        };

        request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
        request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
    });
}

const SOFTWARE_RECORD_KEY = 'software-p256'

interface SoftwareKeyRecord {
    kind: 'software-p256'
    version: 1
    secretKey: Uint8Array
}

function validSoftwareSecret(record: unknown): Uint8Array | null {
    if (typeof record !== 'object' || record === null) {
        return null
    }
    const { kind, version, secretKey } = record as Partial<SoftwareKeyRecord>
    if (kind !== SOFTWARE_RECORD_KEY || version !== 1) {
        return null
    }
    if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32 || !p256.utils.isValidSecretKey(secretKey)) {
        return null
    }
    return secretKey
}

/**
 * Reads the software key record, or creates and stores one, in a single
 * readwrite transaction: concurrent callers, other tabs included, end with one
 * secret. A key is returned only after its record has committed. Never touches
 * the CryptoKey record.
 */
export async function loadSoftwareNodeKey(): Promise<NodeKey> {
    const db = await openKeypairStoreDB('node')
    return await new Promise<NodeKey>((resolve, reject) => {
        let secret: Uint8Array | null = null
        let failure: unknown = null
        const tx = db.transaction('node', 'readwrite')
        const store = tx.objectStore('node')
        const request = store.get(SOFTWARE_RECORD_KEY)
        request.onsuccess = () => {
            try {
                secret = validSoftwareSecret(request.result)
                if (secret === null) {
                    secret = p256.utils.randomSecretKey()
                    const record: SoftwareKeyRecord = { kind: 'software-p256', version: 1, secretKey: secret }
                    store.put(record, SOFTWARE_RECORD_KEY)
                }
            } catch (error) {
                failure = error
                tx.abort()
            }
        }
        tx.oncomplete = () => {
            db.close()
            if (secret === null) {
                reject(new Error('The software node key could not be loaded.'))
                return
            }
            resolve(softwareNodeKey(secret))
        }
        tx.onabort = () => {
            db.close()
            reject(failure ?? tx.error)
        }
    })
}

let pageSoftwareKey: Promise<NodeKey> | null = null

/**
 * The page's software key, loaded once. Once loaded, a page signs with one
 * software key: it cannot diverge from the stored record, because no tab
 * replaces a valid record. A failed load is dropped so the next call retries.
 */
export function getPageSoftwareNodeKey(): Promise<NodeKey> {
    if (pageSoftwareKey === null) {
        const loading = loadSoftwareNodeKey().catch((error: unknown) => {
            if (pageSoftwareKey === loading) {
                pageSoftwareKey = null
            }
            throw error
        })
        pageSoftwareKey = loading
    }
    return pageSoftwareKey
}
