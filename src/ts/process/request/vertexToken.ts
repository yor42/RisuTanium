import { sha256 } from '@noble/hashes/sha2.js'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { redactionToken } from 'src/ts/requestLogRedact'
import { isSecretRef, redactResolved, registerSensitive, resolveSecret } from 'src/ts/secretRef'
import type { Database } from 'src/ts/storage/database.svelte'
import { pkcs8FromPem, RsaKeyError, signRs256 } from './rs256Signer'

/*
 * The Vertex access token: its mint, the memory cache, the in-flight de-duplication and the invalidation.
 *
 * - A minted token lives in memory only, for a plain service-account key and for a referenced one
 *   (`${NAME}`) alike. The database is never written for it: `vertexAccessToken` and
 *   `vertexAccessTokenExpires` stay in the type for upstream's `.bin` and are always empty, and a value an
 *   older build stored is never read (`legacyVertexToken.ts` clears it at load). A restart mints once.
 * - The cache holds one token, tagged with the credential it was minted for (the reference, or a digest of
 *   the plain key) and the email, so a replaced key never receives the old key's token.
 * - One token request runs per credential: concurrent callers with the same email and key join the
 *   same attempt, and the attempt leaves the table when it settles, success or failure.
 * - `invalidateVertexToken` bumps a generation. An attempt that started before the bump still
 *   returns its token to its own callers, but fills no cache, and a caller after the bump never
 *   joins it because the generation is part of the attempt key.
 *
 * Invariant: the caller takes a ticket (`vertexTokenTicket`) synchronously BEFORE it begins reading the
 * key, and passes it to `vertexAccessToken`. The key read may await (the Android vault unwrap does), so
 * the ticket, not the generation at service entry, is what an attempt compares against: any
 * invalidation after the ticket was taken, including one during the key read, makes the attempt stale.
 *
 * The transport is loaded on demand, so that importing this module (the connection editor does) does
 * not pull in the network layer.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** A minted token is cached for slightly less than its one hour lifetime. */
const CACHE_MS = 3500 * 1000

export type VertexTokenResult = { kind: 'token', token: string } | { kind: 'incomplete' }

type VertexTokenFields = Pick<Database, 'vertexClientEmail'>

let generation = 0
let memoryToken: { credential: string, email: string, token: string, expires: number } | null = null
const inFlight = new Map<string, Promise<string>>()

type TransportModule = typeof import('src/ts/globalApi.svelte')
let transportModule: Promise<TransportModule> | null = null

/** One import per module however many attempts run at once; a failed import is retried by the next call. */
function loadTransport(): Promise<TransportModule> {
    transportModule ??= import('src/ts/globalApi.svelte').catch((error: unknown) => {
        transportModule = null
        throw error
    })
    return transportModule
}

/** Same encoding as `base64url` in util.ts, kept here because util.ts pulls in a large import graph. */
function base64url(source: Uint8Array): string {
    return btoa(String.fromCharCode.apply(null, [...source]))
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
}

/** A short digest that tells two keys apart without the key text ever being a table key. */
function fingerprint(text: string): string {
    return Array.from(sha256(new TextEncoder().encode(text)).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function mintToken(email: string, key: string): Promise<string> {
    if (!email.includes('gserviceaccount.com')) {
        throw new Error(language.errors.vertexInvalidClientEmail)
    }
    if (!key.includes('-----BEGIN PRIVATE KEY-----') ||
        !key.includes('-----END PRIVATE KEY-----')) {
        throw new Error(language.errors.vertexInvalidPrivateKey)
    }

    const time = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', typ: 'JWT' }
    const claimSet = {
        iss: email,
        iat: time,
        exp: time + 3600,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: TOKEN_URL,
    }
    const encodedHeader = base64url(new TextEncoder().encode(JSON.stringify(header)))
    const encodedClaimSet = base64url(new TextEncoder().encode(JSON.stringify(claimSet)))

    // Only a malformed key is relabelled; network and token failures keep their own messages.
    let signature: Uint8Array
    try {
        signature = await signRs256(pkcs8FromPem(key), new TextEncoder().encode(`${encodedHeader}.${encodedClaimSet}`))
    } catch (error) {
        if (error instanceof RsaKeyError) {
            throw new Error(language.errors.vertexInvalidPrivateKey)
        }
        throw error
    }

    const jwt = `${encodedHeader}.${encodedClaimSet}.${base64url(signature)}`
    // The assertion is a credential: from here on it is masked in every log line and error text.
    registerSensitive(jwt, redactionToken(jwt))

    const { fetchNative } = await loadTransport()
    const response = await fetchNative(TOKEN_URL, {
        method: 'POST',
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        logFetch: false,
    })

    if (!response.ok) {
        let errorText: string
        try {
            errorText = JSON.stringify(await response.json())
        } catch {
            errorText = response.status.toString()
        }
        throw new Error(fillLang(language.errors.googleTokenRefreshFailed, { error: redactResolved(errorText) }))
    }

    const data: { access_token?: unknown } = await response.json()
    const token = data.access_token
    if (!token || typeof token !== 'string') {
        throw new Error(language.errors.googleNoAccessToken)
    }
    return token
}

/** Runs `attempt` once per key at a time; the entry leaves the table when the attempt settles. */
function shared(key: string, attempt: () => Promise<string>): Promise<string> {
    const existing = inFlight.get(key)
    if (existing) {
        return existing
    }
    const pending = attempt().finally(() => {
        if (inFlight.get(key) === pending) {
            inFlight.delete(key)
        }
    })
    inFlight.set(key, pending)
    return pending
}

/** The cached token when it was minted for exactly this credential and email and has not expired. */
function cachedToken(credential: string, email: string): string | null {
    if (memoryToken && memoryToken.credential === credential && memoryToken.email === email && memoryToken.expires > Date.now()) {
        return memoryToken.token
    }
    return null
}

/** The current invalidation generation. Taken synchronously before the private key read begins. */
export function vertexTokenTicket(): number {
    return generation
}

/**
 * The token for a Vertex request. `incomplete` means the email or the key is missing. A thrown error
 * is the mint's own error. Never called for a request preview.
 */
export async function vertexAccessToken(db: VertexTokenFields, privateKey: string, ticket: number): Promise<VertexTokenResult> {
    // The ticket was taken before the key read began; the email is read here, before the first await.
    const started = ticket
    const email = db.vertexClientEmail

    if (isSecretRef(privateKey)) {
        if (!email) {
            return { kind: 'incomplete' }
        }
        const reference = privateKey.trim()
        const credential = 'ref:' + reference
        const cached = cachedToken(credential, email)
        if (cached) {
            return { kind: 'token', token: cached }
        }
        const token = await shared(['ref', started, email, reference].join('\u0000'), async () => {
            const minted = await mintToken(email, await resolveSecret(privateKey))
            registerSensitive(minted, reference + ':token')
            if (started === generation) {
                memoryToken = { credential, email, token: minted, expires: Date.now() + CACHE_MS }
            }
            return minted
        })
        return { kind: 'token', token }
    }

    if (!email || !privateKey) {
        return { kind: 'incomplete' }
    }
    const credential = 'plain:' + fingerprint(privateKey)
    const cached = cachedToken(credential, email)
    if (cached) {
        return { kind: 'token', token: cached }
    }
    const token = await shared(['plain', started, email, credential].join('\u0000'), async () => {
        const minted = await mintToken(email, privateKey)
        registerSensitive(minted, redactionToken(minted))
        if (started === generation) {
            memoryToken = { credential, email, token: minted, expires: Date.now() + CACHE_MS }
        }
        return minted
    })
    return { kind: 'token', token }
}

/**
 * Drops every cached token and makes any mint that is still running fill no cache. Synchronous.
 * Called whenever the project, the email, the key or the region changes.
 */
export function invalidateVertexToken(db: Pick<Database, 'vertexAccessToken' | 'vertexAccessTokenExpires'>): void {
    generation++
    memoryToken = null
    db.vertexAccessToken = ''
    db.vertexAccessTokenExpires = 0
}

/** Test seam: forgets every cache, attempt and generation. */
export function resetVertexTokenStateForTest(): void {
    generation = 0
    memoryToken = null
    inFlight.clear()
}
