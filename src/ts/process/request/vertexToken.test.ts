/**
 * The Vertex token service in isolation: one token request per credential, a generation guard that
 * keeps a stale mint out of both caches, redaction of the assertion and the token, and the exact
 * absence of any persisted write on the plain-key branch (the token is memory-only).
 *
 * Mocked: the transport (`fetchNative`), the database module (`getDatabase`, `setDatabase`), the
 * platform, and the resolver (`resolveSecret`) of the secret module. The RS256 signer, the redaction
 * registry and the keys are real; the keys are generated here. These are contract and mutant tests of
 * a new module, not reproducers; the reproducers drive `requestChatData` in secretRefProviders.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import '../../polyfill'
import { language } from '../../../lang'
import { fillLang } from '../../../lang/fill'
import { redactionToken } from '../../requestLogRedact'
import { redactResolved, registerSensitive, resetSecretRefState } from '../../secretRef'
import { invalidateVertexToken, resetVertexTokenStateForTest, vertexAccessToken, vertexTokenTicket } from './vertexToken'

type Sent = { url: string, init: { method?: string, body?: string, headers?: Record<string, string>, logFetch?: boolean, signal?: unknown, nativeReply?: unknown } }

const h = vi.hoisted(() => ({
    calls: [] as Sent[],
    answer: null as null | (() => unknown),
    gate: null as null | Promise<void>,
    refs: {} as Record<string, string>,
    store: { vertexAccessToken: '', vertexAccessTokenExpires: 0 },
    setDatabase: vi.fn(),
    getDatabase: vi.fn(),
}))

vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false }))

// Only `fetchNative` matters here. Any other export a lazily loaded module reads at its load time gets
// an inert stub, so the real network layer is never loaded.
vi.mock('src/ts/globalApi.svelte', () => {
    const stub: Record<string, unknown> = {
        fetchNative: vi.fn(async (url: string, init: Sent['init']) => {
            h.calls.push({ url, init })
            const n = h.calls.length
            if (h.gate) {
                await h.gate
            }
            if (h.answer) {
                return h.answer()
            }
            return { ok: true, status: 200, json: async () => ({ access_token: `minted-token-${n}-0123456789` }) }
        }),
    }
    return new Proxy(stub, {
        get: (target, key) => (key in target ? target[key as string] : key === 'then' ? undefined : vi.fn()),
        has: () => true,
    })
})

vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: h.getDatabase, setDatabase: h.setDatabase }))

vi.mock('src/ts/secretRef', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/secretRef')>()),
    resolveSecret: vi.fn(async (value: string) => h.refs[value] ?? value),
}))

const EMAIL = 'sa@proj.iam.gserviceaccount.com'
const OTHER_EMAIL = 'other@proj.iam.gserviceaccount.com'
const REF_A = '${PEM_A}'
const REF_B = '${PEM_B}'

let pemA = ''
let pemB = ''

async function generatePem(): Promise<string> {
    const pair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
    let binary = ''
    for (const byte of der) { binary += String.fromCharCode(byte) }
    return `-----BEGIN PRIVATE KEY-----\n${btoa(binary).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`
}

beforeAll(async () => {
    // The mocked modules are loaded once up front: two first-time dynamic imports of one mocked
    // module that overlap can bypass the mock and load the real module graph.
    pemA = await generatePem()
    pemB = await generatePem()
    h.refs[REF_A] = pemA
    h.refs[REF_B] = pemB
    h.getDatabase.mockImplementation(() => h.store)
    await mint(fields(), pemA)
    h.store.vertexAccessToken = ''
    h.store.vertexAccessTokenExpires = 0
    h.setDatabase.mockClear()
    h.calls.length = 0
})

const fields = (email = EMAIL, token = '', expires = 0) => ({ vertexClientEmail: email, vertexAccessToken: token, vertexAccessTokenExpires: expires })
// The ticket is taken at the call, as the caller does before it reads the key.
const mint = (db: Parameters<typeof vertexAccessToken>[0], key: string) => vertexAccessToken(db, key, vertexTokenTicket())
const pause = (ms = 25) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const hold = () => {
    let release: () => void = () => {}
    h.gate = new Promise<void>((resolve) => { release = resolve })
    return release
}
const waitForCalls = async (count: number) => {
    for (let i = 0; i < 200 && h.calls.length < count; i++) { await pause(5) }
    expect(h.calls.length).toBeGreaterThanOrEqual(count)
}
const tokenOf = (result: Awaited<ReturnType<typeof vertexAccessToken>>) => result.kind === 'token' ? result.token : 'INCOMPLETE'
const rejectionOf = (pending: Promise<unknown>) => pending.then(
    () => { throw new Error('the call resolved') },
    (error: unknown) => error as Error,
)
const assertionOf =(call: Sent) => new URLSearchParams(call.init.body ?? '').get('assertion') ?? ''

beforeEach(() => {
    resetVertexTokenStateForTest()
    resetSecretRefState()
    h.calls.length = 0
    h.answer = null
    h.gate = null
    h.store.vertexAccessToken = ''
    h.store.vertexAccessTokenExpires = 0
    h.setDatabase.mockClear()
    h.getDatabase.mockClear()
    h.getDatabase.mockImplementation(() => h.store)
})

afterEach(() => {
    vi.useRealTimers()
})

describe('de-duplication of the token request', () => {
    test('U1 concurrent calls with one credential make one transport call and share its token', async () => {
        const db = fields()
        const release = hold()

        const all = Promise.all([mint(db, pemA), mint(db, pemA), mint(db, pemA)])
        await waitForCalls(1)
        await pause()
        release()
        const results = await all

        expect(h.calls).toHaveLength(1)
        expect(new Set(results.map(tokenOf)).size).toBe(1)
        expect(tokenOf(results[0])).toBe('minted-token-1-0123456789')
    })

    test('U2 different emails do not share an attempt', async () => {
        const release = hold()

        const all = Promise.all([mint(fields(EMAIL), pemA), mint(fields(OTHER_EMAIL), pemA)])
        await waitForCalls(2)
        release()
        await all

        expect(h.calls).toHaveLength(2)
    })

    test('U3 different keys do not share an attempt', async () => {
        const db = fields()
        const release = hold()

        const all = Promise.all([mint(db, pemA), mint(db, pemB)])
        await waitForCalls(2)
        release()
        await all

        expect(h.calls).toHaveLength(2)
    })

    test('U4 different references do not share an attempt', async () => {
        const db = fields()
        const release = hold()

        const all = Promise.all([mint(db, REF_A), mint(db, REF_B)])
        await waitForCalls(2)
        release()
        await all

        expect(h.calls).toHaveLength(2)
    })

    test('U5 after a failure the next call starts a new attempt and nothing is cached', async () => {
        const db = fields()
        h.answer = () => ({ ok: false, status: 500, json: async () => ({ e: 'srv' }) })
        const release = hold()

        const both = Promise.allSettled([mint(db, pemA), mint(db, pemA)])
        await waitForCalls(1)
        await pause()
        release()
        const settled = await both

        expect(h.calls).toHaveLength(1)
        expect(settled.map((item) => item.status)).toEqual(['rejected', 'rejected'])
        expect(h.setDatabase).not.toHaveBeenCalled()
        expect(h.store.vertexAccessToken).toBe('')

        h.answer = null
        h.gate = null
        const next = await mint(db, pemA)

        expect(h.calls).toHaveLength(2)
        expect(tokenOf(next)).toBe('minted-token-2-0123456789')
    })

    test('a failed referenced mint is not cached either', async () => {
        const db = fields()
        h.answer = () => ({ ok: false, status: 500, json: async () => ({ e: 'srv' }) })
        await expect(mint(db, REF_A)).rejects.toThrow()
        h.answer = null

        await mint(db, REF_A)

        expect(h.calls).toHaveLength(2)
    })
})

describe('the invalidation generation', () => {
    test('U6a an invalidation while a plain mint runs leaves nothing persisted, and the next call mints again', async () => {
        const db = fields()
        const release = hold()

        const first = mint(db, pemA)
        await waitForCalls(1)
        invalidateVertexToken(h.store)
        release()
        const stale = await first

        expect(tokenOf(stale)).toBe('minted-token-1-0123456789')
        expect(h.setDatabase).not.toHaveBeenCalled()
        expect(h.store.vertexAccessToken).toBe('')
        expect(h.store.vertexAccessTokenExpires).toBe(0)

        await mint(db, pemA)
        expect(h.calls).toHaveLength(2)
    })

    test('U6b an invalidation while a referenced mint runs fills no memory token', async () => {
        const db = fields()
        const release = hold()

        const first = mint(db, REF_A)
        await waitForCalls(1)
        invalidateVertexToken(h.store)
        release()
        expect(tokenOf(await first)).toBe('minted-token-1-0123456789')

        h.gate = null
        await mint(db, REF_A)

        expect(h.calls).toHaveLength(2)
    })

    test('U6c a call after the invalidation does not join the stale attempt', async () => {
        const db = fields()
        const release = hold()

        const stale = mint(db, pemA)
        await waitForCalls(1)
        invalidateVertexToken(h.store)
        const fresh = mint(db, pemA)
        await waitForCalls(2)
        release()
        const [staleResult, freshResult] = await Promise.all([stale, fresh])

        expect(h.calls).toHaveLength(2)
        expect(tokenOf(staleResult)).not.toBe(tokenOf(freshResult))
        expect(h.store.vertexAccessToken).toBe('')
        expect(h.setDatabase).not.toHaveBeenCalled()
        // The fresh attempt filled the memory cache; the stale one did not.
        expect(tokenOf(await mint(db, pemA))).toBe(tokenOf(freshResult))
        expect(h.calls).toHaveLength(2)
    })

    test('U6d an invalidation right after the call starts, before anything is awaited, still makes the mint stale', async () => {
        const db = fields()

        const pending = mint(db, pemA)
        invalidateVertexToken(h.store)
        await pending

        expect(h.setDatabase).not.toHaveBeenCalled()
        expect(h.store.vertexAccessToken).toBe('')
    })

    test('U6e the invalidation clears a cached referenced token and the database fields', async () => {
        const db = fields()
        await mint(db, REF_A)
        expect(h.calls).toHaveLength(1)
        await mint(db, REF_A)
        expect(h.calls).toHaveLength(1)
        h.store.vertexAccessToken = 'x'
        h.store.vertexAccessTokenExpires = 5

        invalidateVertexToken(h.store)

        expect(h.store.vertexAccessToken).toBe('')
        expect(h.store.vertexAccessTokenExpires).toBe(0)
        await mint(db, REF_A)
        expect(h.calls).toHaveLength(2)
    })
})

describe('the ticket taken before the key read', () => {
    test('U6f an invalidation between the ticket and the call makes a plain mint stale', async () => {
        const db = fields()
        const ticket = vertexTokenTicket()

        invalidateVertexToken(h.store)
        await vertexAccessToken(db, pemA, ticket)

        expect(h.setDatabase).not.toHaveBeenCalled()
        expect(h.store.vertexAccessToken).toBe('')
        expect(h.store.vertexAccessTokenExpires).toBe(0)
    })

    test('U6g an invalidation between the ticket and the call makes a referenced mint fill no memory token', async () => {
        const db = fields()
        const ticket = vertexTokenTicket()

        invalidateVertexToken(h.store)
        await vertexAccessToken(db, REF_A, ticket)
        await mint(db, REF_A)

        expect(h.calls).toHaveLength(2)
    })

    test('U6h a referenced call after the invalidation does not join a stale referenced attempt', async () => {
        const db = fields()
        const release = hold()

        const stale = mint(db, REF_A)
        await waitForCalls(1)
        invalidateVertexToken(h.store)
        const fresh = mint(db, REF_A)
        await waitForCalls(2)
        release()
        const [staleResult, freshResult] = await Promise.all([stale, fresh])

        expect(h.calls).toHaveLength(2)
        expect(tokenOf(staleResult)).not.toBe(tokenOf(freshResult))
    })

    test('U6i a cached referenced token is not served for another email', async () => {
        await mint(fields(EMAIL), REF_A)
        await mint(fields(OTHER_EMAIL), REF_A)

        expect(h.calls).toHaveLength(2)
    })
})

describe('redaction', () => {
    test('U7 the token of a stale mint is still registered for redaction', async () => {
        const db = fields()
        const release = hold()

        const first = mint(db, pemA)
        await waitForCalls(1)
        invalidateVertexToken(h.store)
        release()
        await first

        expect(redactResolved('Bearer minted-token-1-0123456789')).not.toContain('minted-token-1-0123456789')
    })

    test('U8 the assertion and the plain token carry redaction tokens, the referenced token keeps its reference label', async () => {
        await mint(fields(), pemA)
        const jwt = assertionOf(h.calls[0])
        expect(jwt.split('.')).toHaveLength(3)

        expect(redactResolved(`x ${jwt} y`)).toBe(`x ${redactionToken(jwt)} y`)
        expect(redactResolved('Bearer minted-token-1-0123456789')).toBe(`Bearer ${redactionToken('minted-token-1-0123456789')}`)

        await mint(fields(), REF_A)
        expect(redactResolved('Bearer minted-token-2-0123456789')).toBe('Bearer ${PEM_A}:token')
        expect(redactResolved(`x ${assertionOf(h.calls[1])} y`)).toContain('[redacted')
    })

    test('U9 the text of a rejected token request is redacted before it is thrown', async () => {
        registerSensitive('SECRET-VALUE-0123456789', '[lbl]')
        h.answer = () => ({ ok: false, status: 400, json: async () => ({ error: 'SECRET-VALUE-0123456789' }) })

        const error = await rejectionOf(mint(fields(), pemA))

        expect(error.message).toBe(fillLang(language.errors.googleTokenRefreshFailed, { error: '{"error":"[lbl]"}' }))
    })

    test('an assertion echoed by the token endpoint is not thrown', async () => {
        h.answer = () => ({ ok: false, status: 400, json: async () => ({ error: assertionOf(h.calls[0]) }) })

        const error = await rejectionOf(mint(fields(), pemA))

        expect(error.message).not.toContain(assertionOf(h.calls[0]))
    })
})

describe('the plain branch and the transport', () => {
    test('U10 a token an older build stored in the database is never returned or read', async () => {
        const db = fields(EMAIL, 'persisted-token-0123456789', Date.now() + 60_000)

        const result = await mint(db, pemA)

        expect(tokenOf(result)).toBe('minted-token-1-0123456789')
        expect(h.calls).toHaveLength(1)
        expect(h.store.vertexAccessToken).toBe('')
    })

    test('U11 a plain mint writes nothing to the database and the next call reuses the memory token', async () => {
        const db = fields()

        const first = await mint(db, pemA)
        const second = await mint(db, pemA)

        expect(tokenOf(first)).toBe('minted-token-1-0123456789')
        expect(tokenOf(second)).toBe(tokenOf(first))
        expect(h.calls).toHaveLength(1)
        expect(h.store.vertexAccessToken).toBe('')
        expect(h.store.vertexAccessTokenExpires).toBe(0)
        expect(h.setDatabase).not.toHaveBeenCalled()
        expect(h.getDatabase).not.toHaveBeenCalled()
    })

    test('U11b the memory token expires 3500 seconds after the mint', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))

        await mint(fields(), pemA)
        vi.setSystemTime(new Date('2030-01-01T00:58:00Z'))
        await mint(fields(), pemA)
        expect(h.calls).toHaveLength(1)

        vi.setSystemTime(new Date('2030-01-01T00:59:00Z'))
        await mint(fields(), pemA)
        expect(h.calls).toHaveLength(2)
    })

    test('U11c a replaced plain key never receives the token of the old key, even without an invalidation', async () => {
        const first = await mint(fields(), pemA)
        const second = await mint(fields(), pemB)

        expect(h.calls).toHaveLength(2)
        expect(tokenOf(second)).not.toBe(tokenOf(first))
    })

    test('U11d an invalidation drops the plain memory token, and another email never gets it', async () => {
        await mint(fields(), pemA)
        await mint(fields(OTHER_EMAIL), pemA)
        expect(h.calls).toHaveLength(2)

        invalidateVertexToken(h.store)
        await mint(fields(OTHER_EMAIL), pemA)

        expect(h.calls).toHaveLength(3)
    })

    test('a referenced mint never touches the database', async () => {
        await mint(fields(), REF_A)

        expect(h.getDatabase).not.toHaveBeenCalled()
        expect(h.setDatabase).not.toHaveBeenCalled()
    })

    test('U12 the token request is a form post through the transport that is not logged and carries no chat handle', async () => {
        await mint(fields(), pemA)

        const { url, init } = h.calls[0]
        expect(url).toBe('https://oauth2.googleapis.com/token')
        expect(init.method).toBe('POST')
        expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
        expect(init.logFetch).toBe(false)
        expect(init.signal).toBeUndefined()
        expect(init.nativeReply).toBeUndefined()
        expect(init.body).toMatch(/^grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=[\w-]+\.[\w-]+\.[\w-]+$/)
    })

    test('a missing email or key is incomplete, and no transport call is made', async () => {
        expect((await mint(fields(''), pemA)).kind).toBe('incomplete')
        expect((await mint(fields(EMAIL), '')).kind).toBe('incomplete')
        expect((await mint(fields(''), REF_A)).kind).toBe('incomplete')
        expect(h.calls).toHaveLength(0)
    })

    test('a response without an access token and an invalid email keep their own messages', async () => {
        h.answer = () => ({ ok: true, status: 200, json: async () => ({}) })
        await expect(mint(fields(), pemA)).rejects.toThrow(language.errors.googleNoAccessToken)

        await expect(mint(fields('nobody@example.com'), pemA)).rejects.toThrow(language.errors.vertexInvalidClientEmail)
        await expect(mint(fields(), 'not a pem')).rejects.toThrow(language.errors.vertexInvalidPrivateKey)
    })
})
