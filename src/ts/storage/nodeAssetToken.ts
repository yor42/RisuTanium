/**
 * The token a Node-hosted page puts in asset URLs (`/api/asset/<hex>?risu-auth=`).
 * It is signed by the page's own key pair like a storage token, but carries the
 * `asset-read` audience and no expiry, so the server accepts it only on the asset
 * route and a URL stays valid across reloads and long sessions.
 *
 * One token is minted per key pair and kept in `localStorage` next to the public
 * key it was minted for, so a reload yields the same URLs and a new key pair gets
 * a new token. A token never contains `___`, the separator of a bgm control
 * string that carries the URL.
 */

/** The `localStorage` key that holds the asset-read token and the public key it was minted for. */
export const ASSET_READ_TOKEN_STORAGE_KEY = 'risu-asset-read-token'

/** The `aud` claim the server's asset route requires; `server/node/assetRoute.cjs` holds the same string. */
export const ASSET_READ_AUDIENCE = 'asset-read'

/** Mints tried before giving up on a token that keeps containing the bgm separator. */
const MAX_MINT_ATTEMPTS = 16

/** The part of `localStorage` the token source uses. */
export interface AssetTokenFlags {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
}

export interface AssetTokenSourceOptions {
    getKeyPair(): Promise<CryptoKeyPair>
    /** Where the token is kept between page loads; `null` keeps it for the life of the page only. */
    storage: AssetTokenFlags | null
    /** Makes a fresh token over `keyPair`; defaults to the real signer. */
    mintToken?: (keyPair: CryptoKeyPair) => Promise<string>
}

interface StoredToken {
    pub: string
    token: string
}

const textEncoder = new TextEncoder()

function base64UrlOf(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function encodedJson(value: object): string {
    return base64UrlOf(textEncoder.encode(JSON.stringify(value)))
}

/** Signs a fresh asset-read token with the key pair's private key. */
export async function mintAssetReadToken(keyPair: CryptoKeyPair): Promise<string> {
    const header = { alg: 'ES256', typ: 'JWT' }
    const payload = {
        iat: Math.floor(Date.now() / 1000),
        aud: ASSET_READ_AUDIENCE,
        pub: await crypto.subtle.exportKey('jwk', keyPair.publicKey),
    }
    const signed = `${encodedJson(header)}.${encodedJson(payload)}`
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, textEncoder.encode(signed))
    return `${signed}.${base64UrlOf(new Uint8Array(signature))}`
}

/** Names the public key of `keyPair`; two key pairs never share the answer. */
async function fingerprintOf(keyPair: CryptoKeyPair): Promise<string> {
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
    return `${jwk.x ?? ''}.${jwk.y ?? ''}`
}

function readStored(storage: AssetTokenFlags | null): StoredToken | null {
    if (storage === null) {
        return null
    }
    try {
        const raw = storage.getItem(ASSET_READ_TOKEN_STORAGE_KEY)
        if (raw === null) {
            return null
        }
        const parsed: Partial<StoredToken> | null = JSON.parse(raw)
        return typeof parsed?.pub === 'string' && typeof parsed.token === 'string' ? { pub: parsed.pub, token: parsed.token } : null
    } catch {
        return null
    }
}

/**
 * The page's asset-read token source. Concurrent first calls share one mint; a
 * later call returns the same token. A call that fails (no key pair, no signer)
 * rejects every caller waiting on it and the next call starts again.
 */
export function createAssetTokenSource(options: AssetTokenSourceOptions): () => Promise<string> {
    const mint = options.mintToken ?? mintAssetReadToken
    let current: string | null = null
    let pending: Promise<string> | null = null

    async function resolveToken(): Promise<string> {
        const keyPair = await options.getKeyPair()
        const pub = await fingerprintOf(keyPair)
        const stored = readStored(options.storage)
        if (stored !== null && stored.pub === pub && stored.token !== '' && !stored.token.includes('___')) {
            return stored.token
        }
        for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
            const token = await mint(keyPair)
            if (token === '' || token.includes('___')) {
                continue
            }
            try {
                options.storage?.setItem(ASSET_READ_TOKEN_STORAGE_KEY, JSON.stringify({ pub, token } satisfies StoredToken))
            } catch {
                // A page that cannot persist the token keeps it in memory for its life.
            }
            return token
        }
        throw new Error('No asset-read token without the bgm separator could be minted.')
    }

    return () => {
        if (current !== null) {
            return Promise.resolve(current)
        }
        pending ??= resolveToken().then(
            (token) => {
                current = token
                pending = null
                return token
            },
            (error: unknown) => {
                pending = null
                throw error
            },
        )
        return pending
    }
}
