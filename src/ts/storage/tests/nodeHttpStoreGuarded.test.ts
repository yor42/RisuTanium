// @vitest-environment node
/**
 * The guarded operations of the Node adapter (`guarded` on the store from
 * `createNodeHttpStore`) against the real `server/node/server.cjs`, usually
 * through a proxy that answers the guarded paths the way an older server or a
 * careless intermediary would. A guarded call must accept only a server answer
 * that proves its checks were applied, and must never fall back to the
 * original routes.
 *
 * Labels: new-behaviour tests need the guarded routes of the server. The
 * refusal tests are compatibility guards: any correct client passes them and
 * only a broken one (a client that falls back, trusts a bare 200, ignores the
 * echo or the counts) fails them, which is shown by mutants outside the tree.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { GuardedOperations } from 'src/ts/storage/store/contract'
import {
    ServerLacksCapabilityError,
    StoreCheckListTooLongError,
    StoreInvalidConditionError,
    StoreInvalidKeyError,
    StoreOutcomeUnknownError,
    StoreVersionConflictError,
} from 'src/ts/storage/store/errors'
import { createNodeHttpStore, NodeHttpError, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { STORE2_PREFIX } from 'src/ts/storage/store/keyRules'
import { startGuardedProxy, type GuardedProxy, type ProxyMode } from './nodeGuardedProxy'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture
let proxy: GuardedProxy

interface Sent {
    path: string
    method: string
    headers: Record<string, string>
    cache: RequestCache | undefined
    redirect: RequestRedirect | undefined
}
const sent: Sent[] = []

const recordingFetch: FetchLike = (url, init) => {
    sent.push({
        path: new URL(url).pathname,
        method: init?.method ?? 'GET',
        headers: { ...(init?.headers as Record<string, string>) },
        cache: init?.cache,
        redirect: init?.redirect,
    })
    return fetch(url, init)
}

beforeAll(async () => {
    fixture = await startNodeServer()
    proxy = await startGuardedProxy(fixture.baseUrl)
}, 60_000)

afterAll(async () => {
    await proxy?.stop()
    await fixture?.stop()
}, 30_000)

beforeEach(() => {
    proxy.setMode('pass')
    proxy.forwarded.length = 0
    sent.length = 0
})

function guardedOf(extra: { baseUrl?: string, maxCheckOnlyKeys?: number, guardedHeaderBytes?: number, fetch?: FetchLike, authHeader?: () => Promise<string> } = {}): GuardedOperations {
    const store = createNodeHttpStore({
        baseUrl: extra.baseUrl ?? proxy.baseUrl,
        authHeader: extra.authHeader ?? (() => fixture.authHeader()),
        fetch: extra.fetch ?? recordingFetch,
        maxCheckOnlyKeys: extra.maxCheckOnlyKeys,
        guardedHeaderBytes: extra.guardedHeaderBytes,
    })
    if (store.guarded === undefined) {
        throw new Error('The Node store offers no guarded operations.')
    }
    return store.guarded
}

function bytes(...values: number[]): Uint8Array {
    return Uint8Array.from(values)
}

let counter = 0
function fresh(label: string): string {
    counter++
    return `${label}/${counter}`
}

interface RawState {
    exists: boolean
    revision: number
}

async function rawState(key: string): Promise<RawState> {
    const response = await fetch(`${fixture.baseUrl}/api/read`, { headers: { 'file-path': hexOfKey(key), 'risu-auth': await fixture.authHeader() } })
    await response.arrayBuffer()
    return { exists: response.headers.get('x-risu-exists') === '1', revision: Number(response.headers.get('x-risu-revision')) }
}

async function rawWrite(key: string): Promise<number> {
    const response = await fetch(`${fixture.baseUrl}/api/write`, {
        method: 'POST',
        headers: { 'file-path': hexOfKey(key), 'risu-auth': await fixture.authHeader(), 'content-type': 'application/octet-stream' },
        body: new Uint8Array([9]),
    })
    return ((await response.json()) as { revision: number }).revision
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
    return await promise.then(() => undefined, (error: unknown) => error)
}

describe('guarded operations against the real server', () => {
    test('probe answers the three capabilities', async () => {
        expect(await guardedOf().probe()).toEqual({ checkOnly: true, retire: true, pieces: true })
    })

    test('writeChecked, removeChecked and retireChecked work, and every request is uncached, unredirected, authenticated and counted', async () => {
        const guarded = guardedOf()
        const commit = fresh('commit')
        const unit = `${STORE2_PREFIX}${fresh('unit')}`
        const garbage = `${STORE2_PREFIX}${fresh('garbage')}`
        const unitRevision = await rawWrite(unit)
        const garbageRevision = await rawWrite(garbage)
        const written = await guarded.writeChecked(commit, bytes(1), { ifVersion: 0 }, [{ key: unit, version: unitRevision }])
        expect(written.version).toBe(1)
        await guarded.retireChecked([{ key: garbage, condition: { ifVersion: garbageRevision } }], [{ key: commit, version: 1 }])
        expect(await rawState(garbage)).toEqual({ exists: false, revision: 0 })
        await guarded.removeChecked([{ key: unit, condition: 'unconditional' }], [{ key: commit, version: 1 }])
        expect((await rawState(unit)).exists).toBe(false)
        expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
            'POST /api/write-checked',
            'GET /api/remove-checked',
            'GET /api/remove-checked',
        ])
        for (const request of sent) {
            expect(request.cache).toBe('no-store')
            expect(request.redirect).toBe('manual')
            expect(request.headers['risu-auth']).toBeTruthy()
            expect(request.headers['check-only-count']).toBeDefined()
        }
        expect(sent[0].headers['check-only-count']).toBe('1')
        expect(sent[1].headers).toMatchObject({ retire: '1', 'retire-count': '1', 'check-only-count': '1' })
        expect(sent[2].headers['retire-count']).toBe('0')
        expect(sent[2].headers.retire).toBeUndefined()
        expect(sent.map((request) => request.headers['own-condition-count'])).toEqual(['1', '1', '0'])
    })

    test('a remove batch with mixed conditioned and unconditioned keys states and gets back the count of the conditioned ones', async () => {
        const guarded = guardedOf()
        const conditioned = fresh('conditioned')
        const unconditioned = fresh('unconditioned')
        const revision = await rawWrite(conditioned)
        await rawWrite(unconditioned)
        await guarded.removeChecked([{ key: conditioned, condition: { ifVersion: revision } }, { key: unconditioned, condition: 'unconditional' }], [])
        expect(sent[sent.length - 1].headers['own-condition-count']).toBe('1')
        expect((await rawState(conditioned)).exists).toBe(false)
        expect((await rawState(unconditioned)).exists).toBe(false)
    })

    test('a mismatch is a version conflict naming the key that did not match', async () => {
        const guarded = guardedOf()
        const commit = fresh('commit')
        const unit = fresh('unit')
        const unitRevision = await rawWrite(unit)
        await guarded.writeChecked(commit, bytes(1), 'unconditional', [])
        const checkOnlyMismatch = await caught(guarded.writeChecked(commit, bytes(2), { ifVersion: 1 }, [{ key: unit, version: unitRevision + 1 }]))
        expect(checkOnlyMismatch).toBeInstanceOf(StoreVersionConflictError)
        expect((checkOnlyMismatch as StoreVersionConflictError).key).toBe(unit)
        expect((checkOnlyMismatch as StoreVersionConflictError).currentVersion).toBe(unitRevision)
        const ownMismatch = await caught(guarded.writeChecked(commit, bytes(2), { ifVersion: 0 }, [{ key: unit, version: unitRevision }]))
        expect((ownMismatch as StoreVersionConflictError).key).toBe(commit)
        const removeMismatch = await caught(guarded.removeChecked([{ key: unit, condition: 'unconditional' }], [{ key: commit, version: 9 }]))
        expect((removeMismatch as StoreVersionConflictError).key).toBe(commit)
        expect((await rawState(unit)).exists).toBe(true)
    })

    test('an absent check-only key passes at 0 and a retired one conflicts at its old version', async () => {
        const guarded = guardedOf()
        const victim = `${STORE2_PREFIX}${fresh('victim')}`
        const commit = fresh('commit')
        await guarded.writeChecked(commit, bytes(1), 'unconditional', [])
        const revision = await rawWrite(victim)
        await guarded.retireChecked([{ key: victim, condition: 'unconditional' }], [{ key: commit, version: 1 }])
        await guarded.writeChecked(fresh('other'), bytes(1), 'unconditional', [{ key: victim, version: 0 }])
        const error = await caught(guarded.writeChecked(fresh('other'), bytes(1), 'unconditional', [{ key: victim, version: revision }]))
        expect(error).toBeInstanceOf(StoreVersionConflictError)
    })
})

describe('guard: a server that cannot answer the guarded paths is refused and nothing is applied', () => {
    const NEVER_REACHES_HANDLER: ProxyMode[] = ['old-404', 'html-200', 'method-405', 'redirect-307']

    test.each(NEVER_REACHES_HANDLER)('%s: every guarded call rejects with ServerLacksCapabilityError (mayHaveApplied false), the original routes are never requested, and the server is unchanged', async (mode) => {
        const guarded = guardedOf()
        const commit = fresh('commit')
        const unit = `${STORE2_PREFIX}${fresh('unit')}`
        const garbage = `${STORE2_PREFIX}${fresh('garbage')}`
        await rawWrite(unit)
        await rawWrite(garbage)
        proxy.setMode(mode)
        const target = fresh('target')
        const errors = [
            await caught(guarded.probe()),
            await caught(guarded.writeChecked(target, bytes(1), 'unconditional', [{ key: unit, version: 1 }])),
            await caught(guarded.removeChecked([{ key: garbage, condition: 'unconditional' }], [{ key: commit, version: 0 }])),
            await caught(guarded.retireChecked([{ key: garbage, condition: 'unconditional' }], [{ key: commit, version: 0 }])),
        ]
        for (const error of errors) {
            expect(error).toBeInstanceOf(ServerLacksCapabilityError)
            expect((error as ServerLacksCapabilityError).mayHaveApplied).toBe(false)
        }
        expect(proxy.forwarded).toEqual([])
        expect(sent.every((request) => request.path.endsWith('-checked') || request.path === '/api/caps')).toBe(true)
        expect((await rawState(target)).exists).toBe(false)
        expect(await rawState(garbage)).toEqual({ exists: true, revision: 1 })
    })

    test('a 2xx answer that cannot be accepted is refused with mayHaveApplied true, and the request did apply', async () => {
        const guarded = guardedOf()
        const modes: ProxyMode[] = ['strip-marker', 'strip-revision', 'echo-wrong-check-only']
        for (const mode of modes) {
            const commit = fresh('commit')
            const target = fresh('target')
            proxy.setMode(mode)
            const error = await caught(guarded.writeChecked(target, bytes(1), 'unconditional', [{ key: commit, version: 0 }]))
            expect(error, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((error as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(true)
            expect((await rawState(target)).exists, `${mode} applied`).toBe(true)
        }
        for (const mode of ['strip-marker', 'strip-revision', 'marker-no-map', 'echo-wrong-check-only'] as const) {
            const commit = fresh('commit')
            const victim = fresh('victim')
            await rawWrite(victim)
            proxy.setMode(mode)
            const error = await caught(guarded.removeChecked([{ key: victim, condition: 'unconditional' }], [{ key: commit, version: 0 }]))
            expect(error, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((error as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(true)
            expect((await rawState(victim)).exists, `${mode} applied`).toBe(false)
        }
        for (const mode of ['strip-marker', 'echo-wrong-retired', 'echo-wrong-check-only'] as const) {
            const commit = fresh('commit')
            const victim = `${STORE2_PREFIX}${fresh('victim')}`
            await rawWrite(victim)
            proxy.setMode(mode)
            const error = await caught(guarded.retireChecked([{ key: victim, condition: 'unconditional' }], [{ key: commit, version: 0 }]))
            expect(error, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((error as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(true)
            expect(await rawState(victim), `${mode} applied`).toEqual({ exists: false, revision: 0 })
        }
    })

    test('a conflict whose marker was lost on the way is refused, not read as a version conflict, and nothing was applied', async () => {
        const guarded = guardedOf()
        const unit = fresh('unit')
        const unitRevision = await rawWrite(unit)
        const target = fresh('target')
        proxy.setMode('strip-marker')
        const error = await caught(guarded.writeChecked(target, bytes(1), 'unconditional', [{ key: unit, version: unitRevision + 1 }]))
        expect(error).toBeInstanceOf(ServerLacksCapabilityError)
        expect((error as ServerLacksCapabilityError).mayHaveApplied).toBe(false)
        expect((await rawState(target)).exists).toBe(false)
    })

    test('a check-only list or count lost on the way gets the server\'s 400: refused with mayHaveApplied false and nothing changed on disk', async () => {
        const guarded = guardedOf()
        for (const mode of ['strip-check-only', 'strip-check-only-and-count'] as const) {
            const commit = fresh('commit')
            const unit = fresh('unit')
            const target = fresh('target')
            const victim = fresh('victim')
            await rawWrite(unit)
            const victimRevision = await rawWrite(victim)
            proxy.setMode(mode)
            const writeError = await caught(guarded.writeChecked(target, bytes(1), 'unconditional', [{ key: unit, version: 1 }]))
            expect(writeError, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((writeError as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(false)
            expect((await rawState(target)).exists).toBe(false)
            const removeError = await caught(guarded.removeChecked([{ key: victim, condition: 'unconditional' }], [{ key: commit, version: 0 }]))
            expect(removeError, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((removeError as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(false)
            expect(await rawState(victim)).toEqual({ exists: true, revision: victimRevision })
        }
        for (const mode of ['strip-retire', 'strip-retire-and-count'] as const) {
            const commit = fresh('commit')
            const victim = `${STORE2_PREFIX}${fresh('victim')}`
            const victimRevision = await rawWrite(victim)
            proxy.setMode(mode)
            const error = await caught(guarded.retireChecked([{ key: victim, condition: 'unconditional' }], [{ key: commit, version: 0 }]))
            expect(error, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((error as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(false)
            expect(await rawState(victim)).toEqual({ exists: true, revision: victimRevision })
        }
    })

    test('an own condition lost on the way gets the server\'s 400, with or without the count: refused with mayHaveApplied false and nothing changed on disk', async () => {
        const guarded = guardedOf()
        for (const mode of ['strip-if-match', 'strip-if-match-and-count'] as const) {
            const commit = fresh('commit')
            const target = fresh('target')
            const victim = fresh('victim')
            const retired = `${STORE2_PREFIX}${fresh('victim')}`
            const targetRevision = await rawWrite(target)
            const victimRevision = await rawWrite(victim)
            const retiredRevision = await rawWrite(retired)
            proxy.setMode(mode)
            const staleWrite = await caught(guarded.writeChecked(target, bytes(1), { ifVersion: targetRevision + 7 }, []))
            expect(staleWrite, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((staleWrite as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(false)
            const createOnly = await caught(guarded.writeChecked(target, bytes(1), { ifVersion: 0 }, []))
            expect(createOnly, mode).toBeInstanceOf(ServerLacksCapabilityError)
            const staleRemove = await caught(guarded.removeChecked([{ key: victim, condition: { ifVersion: victimRevision + 7 } }], []))
            expect(staleRemove, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((staleRemove as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(false)
            const staleRetire = await caught(guarded.retireChecked([{ key: retired, condition: { ifVersion: retiredRevision + 7 } }], [{ key: commit, version: 0 }]))
            expect(staleRetire, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((staleRetire as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(false)
            expect(await rawState(target)).toEqual({ exists: true, revision: targetRevision })
            expect(await rawState(victim)).toEqual({ exists: true, revision: victimRevision })
            expect(await rawState(retired)).toEqual({ exists: true, revision: retiredRevision })
        }
    })

    test('an own-condition echo that is wrong or missing is refused with mayHaveApplied true, and the request did apply', async () => {
        const guarded = guardedOf()
        for (const mode of ['echo-wrong-own-condition', 'strip-own-condition-echo'] as const) {
            const target = fresh('target')
            proxy.setMode(mode)
            const writeError = await caught(guarded.writeChecked(target, bytes(1), { ifVersion: 0 }, []))
            expect(writeError, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((writeError as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(true)
            expect((await rawState(target)).exists, `${mode} write applied`).toBe(true)
            const victim = fresh('victim')
            const victimRevision = await rawWrite(victim)
            const removeError = await caught(guarded.removeChecked([{ key: victim, condition: { ifVersion: victimRevision } }], []))
            expect(removeError, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((removeError as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(true)
            expect((await rawState(victim)).exists, `${mode} remove applied`).toBe(false)
            const retired = `${STORE2_PREFIX}${fresh('victim')}`
            const retiredRevision = await rawWrite(retired)
            const retireError = await caught(guarded.retireChecked([{ key: retired, condition: { ifVersion: retiredRevision } }], [{ key: fresh('commit'), version: 0 }]))
            expect(retireError, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((retireError as ServerLacksCapabilityError).mayHaveApplied, mode).toBe(true)
        }
    })

    test('an unconditional request has no condition to strip and still works when only if-match-revision is stripped', async () => {
        const guarded = guardedOf()
        proxy.setMode('strip-if-match')
        const written = await guarded.writeChecked(fresh('target'), bytes(1), 'unconditional', [])
        expect(written.version).toBe(1)
    })

    test('a request that has nothing to strip still works under the strip modes (zero check-only entries, count 0)', async () => {
        const guarded = guardedOf()
        proxy.setMode('strip-check-only')
        const written = await guarded.writeChecked(fresh('target'), bytes(1), 'unconditional', [])
        expect(written.version).toBe(1)
    })

    test('the capability answer must carry the marker and the three boolean flags', async () => {
        const guarded = guardedOf()
        for (const mode of ['bad-caps', 'strip-marker'] as const) {
            proxy.setMode(mode)
            const error = await caught(guarded.probe())
            expect(error, mode).toBeInstanceOf(ServerLacksCapabilityError)
            expect((error as ServerLacksCapabilityError).capability).toBe('caps')
            expect((error as ServerLacksCapabilityError).mayHaveApplied).toBe(false)
        }
    })

    test('the capability answer accepts an extra flag and ignores it, and refuses a missing or non-boolean flag', async () => {
        const answering = (body: Record<string, unknown>): FetchLike => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'risu-storage-guarded': '1' } })
        const extra = createNodeHttpStore({ baseUrl: 'http://stub', authHeader: async () => 'a', fetch: answering({ checkOnly: true, retire: false, pieces: true, listPrefix: true }) })
        expect(await extra.guarded!.probe()).toEqual({ checkOnly: true, retire: false, pieces: true })
        const refusedAnswers: Array<Record<string, unknown>> = [
            { checkOnly: true, retire: true },
            { checkOnly: true, pieces: false, listPrefix: true },
            { retire: true, pieces: false, listPrefix: true },
            { checkOnly: true, retire: 'false', pieces: true },
            { checkOnly: 1, retire: true, pieces: true },
            { checkOnly: true, retire: true, pieces: null },
        ]
        for (const answer of refusedAnswers) {
            const store = createNodeHttpStore({ baseUrl: 'http://stub', authHeader: async () => 'a', fetch: answering(answer) })
            const error = await caught(store.guarded!.probe())
            expect(error, JSON.stringify(answer)).toBeInstanceOf(ServerLacksCapabilityError)
            expect((error as ServerLacksCapabilityError).capability).toBe('caps')
            expect((error as ServerLacksCapabilityError).mayHaveApplied).toBe(false)
        }
    })

    test('a 429 ends as the HTTP error after the existing retries and a marked 401 is an HTTP error, neither a missing capability', async () => {
        const limited: FetchLike = async () => new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
        const store = createNodeHttpStore({ baseUrl: 'http://stub', authHeader: async () => 'a', fetch: limited, sleep: async () => undefined })
        const rateLimited = await caught(store.guarded!.removeChecked([{ key: 'k/1', condition: 'unconditional' }], []))
        expect(rateLimited).toBeInstanceOf(NodeHttpError)
        expect((rateLimited as NodeHttpError).status).toBe(429)
        const unauthorised: FetchLike = async () => new Response('{}', { status: 401, headers: { 'risu-storage-guarded': '1' } })
        const second = createNodeHttpStore({ baseUrl: 'http://stub', authHeader: async () => 'a', fetch: unauthorised })
        const refused = await caught(second.guarded!.probe())
        expect(refused).toBeInstanceOf(NodeHttpError)
        expect((refused as NodeHttpError).status).toBe(401)
    })

    test('an opaque redirect (status 0) and a plain 307 from a stubbed fetch are refused with mayHaveApplied false', async () => {
        const opaque: FetchLike = async () => ({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() }) as unknown as Response
        const plain: FetchLike = async () => new Response(null, { status: 307, headers: { location: '/api/write' } })
        for (const stub of [opaque, plain]) {
            const store = createNodeHttpStore({ baseUrl: 'http://stub', authHeader: async () => 'a', fetch: stub })
            const error = await caught(store.guarded!.writeChecked('k/1', bytes(1), 'unconditional', []))
            expect(error).toBeInstanceOf(ServerLacksCapabilityError)
            expect((error as ServerLacksCapabilityError).mayHaveApplied).toBe(false)
        }
    })

    test('a 2xx answer with a wrong echo from a stubbed fetch is refused with mayHaveApplied true', async () => {
        const stub = (body: unknown): FetchLike => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'risu-storage-guarded': '1', 'content-type': 'application/json' } })
        const wrongCount = createNodeHttpStore({ baseUrl: 'http://stub', authHeader: async () => 'a', fetch: stub({ success: true, revision: 1, checkOnly: 0 }) })
        const error = await caught(wrongCount.guarded!.writeChecked('k/1', bytes(1), 'unconditional', [{ key: 'k/2', version: 0 }]))
        expect(error).toBeInstanceOf(ServerLacksCapabilityError)
        expect((error as ServerLacksCapabilityError).mayHaveApplied).toBe(true)
        const rightCount = createNodeHttpStore({ baseUrl: 'http://stub', authHeader: async () => 'a', fetch: stub({ success: true, revision: 4, checkOnly: 1, ownCondition: 0 }) })
        expect((await rightCount.guarded!.writeChecked('k/1', bytes(1), 'unconditional', [{ key: 'k/2', version: 0 }])).version).toBe(4)
        const noOwnEcho = createNodeHttpStore({ baseUrl: 'http://stub', authHeader: async () => 'a', fetch: stub({ success: true, revision: 4, checkOnly: 1 }) })
        const missing = await caught(noOwnEcho.guarded!.writeChecked('k/1', bytes(1), 'unconditional', [{ key: 'k/2', version: 0 }]))
        expect(missing).toBeInstanceOf(ServerLacksCapabilityError)
        expect((missing as ServerLacksCapabilityError).mayHaveApplied).toBe(true)
    })
})

describe('failures of the transport and of the list size', () => {
    const lengthKey = (index: number) => `k/${String(index).padStart(4, '0')}${'x'.repeat(100)}`

    test('more check-only keys than a request carries, or too many header bytes, is refused before anything is sent', async () => {
        const guarded = guardedOf()
        const sixtyOne = Array.from({ length: 61 }, (_, index) => ({ key: `k/${index}`, version: 0 }))
        const tooLong = await caught(guarded.writeChecked('k/own', bytes(1), 'unconditional', sixtyOne))
        expect(tooLong).toBeInstanceOf(StoreCheckListTooLongError)
        expect(tooLong).toMatchObject({ sent: false, mayHaveApplied: false })
        const heavy = Array.from({ length: 45 }, (_, index) => ({ key: lengthKey(index), version: 0 }))
        const heavyError = await caught(guarded.writeChecked('k/own', bytes(1), 'unconditional', heavy))
        expect(heavyError).toBeInstanceOf(StoreCheckListTooLongError)
        expect(sent).toEqual([])
        expect(proxy.forwarded).toEqual([])
    })

    test('with the limits lifted, a 400-key request meets the real server once and the outcome is typed, never retried', async () => {
        const guarded = guardedOf({ baseUrl: fixture.baseUrl, maxCheckOnlyKeys: 10_000, guardedHeaderBytes: 10_000_000 })
        const keys = Array.from({ length: 400 }, (_, index) => ({ key: lengthKey(index), version: 0 }))
        const error = await caught(guarded.writeChecked('k/own', bytes(1), 'unconditional', keys))
        const observed = error instanceof StoreCheckListTooLongError ? '431 -> StoreCheckListTooLongError' : error instanceof StoreOutcomeUnknownError ? 'reset -> StoreOutcomeUnknownError' : String(error)
        console.info(`400 check-only keys against the real server: ${observed}`)
        expect(error instanceof StoreCheckListTooLongError || error instanceof StoreOutcomeUnknownError).toBe(true)
        expect(sent.filter((request) => request.path === '/api/write-checked')).toHaveLength(1)
    })

    test('a 431 from the path is a list-too-long error that was sent and cannot have applied', async () => {
        proxy.setMode('status-431')
        const error = await caught(guardedOf().writeChecked(fresh('target'), bytes(1), 'unconditional', [{ key: 'k/1', version: 0 }]))
        expect(error).toBeInstanceOf(StoreCheckListTooLongError)
        expect(error).toMatchObject({ sent: true, mayHaveApplied: false })
        expect(sent).toHaveLength(1)
    })

    test('a connection cut after the server applied the request is an unknown outcome, not a long list, and is not resent', async () => {
        proxy.setMode('reset-after-apply')
        const target = fresh('target')
        const error = await caught(guardedOf().writeChecked(target, bytes(1), 'unconditional', [{ key: 'k/1', version: 0 }]))
        expect(error).toBeInstanceOf(StoreOutcomeUnknownError)
        expect(error).not.toBeInstanceOf(StoreCheckListTooLongError)
        expect(sent.filter((request) => request.path === '/api/write-checked')).toHaveLength(1)
        expect((await rawState(target)).exists).toBe(true)
    })

    test('a failure to produce the auth header keeps its own error and sends nothing', async () => {
        const guarded = guardedOf({ authHeader: async () => { throw new Error('no auth') } })
        const error = await caught(guarded.writeChecked(fresh('target'), bytes(1), 'unconditional', [{ key: 'k/1', version: 0 }]))
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('no auth')
        expect(error).not.toBeInstanceOf(StoreOutcomeUnknownError)
        expect(error).not.toBeInstanceOf(StoreCheckListTooLongError)
        expect(proxy.forwarded).toEqual([])
    })
})

describe('a failed guarded write', () => {
    const SERVER_ERROR = { error: 'Failed to write storage item', code: 'ENOSPC', message: 'ENOSPC: no space left on device, write ./save/ab' }
    const answerOf = (status: number, marked: boolean, body: string, contentType: string): FetchLike => async () => new Response(body, {
        status,
        headers: { 'content-type': contentType, ...(marked ? { 'risu-storage-guarded': '1' } : {}) },
    })
    const cases = [413, 500, 507].flatMap((status) => [true, false].map((marked) => ({ status, marked })))

    test.each(cases)('G: a $status answer (marker: $marked) is NodeHttpError(status, write-checked), never a missing capability', async ({ status, marked }) => {
        const guarded = guardedOf({ fetch: answerOf(status, marked, JSON.stringify(SERVER_ERROR), 'application/json') })
        const error = await caught(guarded.writeChecked(fresh('target'), bytes(1), 'unconditional', []))
        expect(error).toBeInstanceOf(NodeHttpError)
        expect(error).not.toBeInstanceOf(ServerLacksCapabilityError)
        expect(error).toMatchObject({ status, operation: 'write-checked' })
    })

    test.each(cases)('a $status answer (marker: $marked) carries the server\'s code and message', async ({ status, marked }) => {
        const guarded = guardedOf({ fetch: answerOf(status, marked, JSON.stringify(SERVER_ERROR), 'application/json') })
        const error = await caught(guarded.writeChecked(fresh('target'), bytes(1), 'unconditional', []))
        expect(error).toBeInstanceOf(NodeHttpError)
        expect((error as NodeHttpError).detail).toEqual({ code: 'ENOSPC', message: SERVER_ERROR.message })
        expect((error as NodeHttpError).message).toContain('ENOSPC')
    })

    test('an unmarked page keeps the plain error and has no detail', async () => {
        const guarded = guardedOf({ fetch: answerOf(500, false, '<html>Internal Server Error</html>', 'text/html') })
        const error = await caught(guarded.writeChecked(fresh('target'), bytes(1), 'unconditional', []))
        expect(error).toBeInstanceOf(NodeHttpError)
        expect((error as NodeHttpError).detail).toBeNull()
        expect((error as NodeHttpError).message).toBe('The Node server answered 500 to write-checked.')
    })

    test('a body over the real server\'s limit is NodeHttpError(413, write-checked) with code PAYLOAD_TOO_LARGE', async () => {
        const guarded = guardedOf({ baseUrl: fixture.baseUrl })
        const error = await caught(guarded.writeChecked(fresh('target'), new Uint8Array(105 * 1024 * 1024), 'unconditional', []))
        expect(error).toBeInstanceOf(NodeHttpError)
        expect(error).toMatchObject({ status: 413, operation: 'write-checked', detail: { code: 'PAYLOAD_TOO_LARGE' } })
    }, 60_000)
})

describe('key rules of the guarded calls', () => {
    test('retire refuses keys outside the A-lite prefix, an empty list and a missing check-only entry before any request', async () => {
        const guarded = guardedOf()
        const guard = [{ key: 'commit/head', version: 0 }]
        const outside = [
            [{ key: 'database/database.bin', condition: 'unconditional' as const }],
            [{ key: 'blocks/head', condition: 'unconditional' as const }],
            [{ key: 'assets/x.png', condition: 'unconditional' as const }],
            [{ key: `${STORE2_PREFIX}ok`, condition: 'unconditional' as const }, { key: 'assets/x.png', condition: 'unconditional' as const }],
            [{ key: STORE2_PREFIX, condition: 'unconditional' as const }],
            [],
        ]
        for (const entries of outside) {
            await expect(guarded.retireChecked(entries, guard)).rejects.toBeInstanceOf(StoreInvalidKeyError)
        }
        await expect(guarded.retireChecked([{ key: `${STORE2_PREFIX}ok`, condition: 'unconditional' }], [])).rejects.toBeInstanceOf(StoreInvalidConditionError)
        expect(sent).toEqual([])
    })

    test('an over-long own key and a check-only key equal to the own key are refused before any request', async () => {
        const guarded = guardedOf()
        await expect(guarded.writeChecked(`k/${'x'.repeat(116)}`, bytes(1), 'unconditional', [])).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(guarded.writeChecked('k/1', bytes(1), 'unconditional', [{ key: 'k/1', version: 0 }])).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(guarded.writeChecked('k/1', bytes(1), 'unconditional', [{ key: 'k/2', version: 0 }, { key: 'k/2', version: 0 }])).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(guarded.writeChecked('k/1', bytes(1), 'unconditional', [{ key: 'k/2', version: -1 }])).rejects.toBeInstanceOf(StoreInvalidConditionError)
        await expect(guarded.removeChecked([{ key: 'k/1', condition: 'unconditional' }], [{ key: 'k/1', version: 0 }])).rejects.toBeInstanceOf(StoreInvalidKeyError)
        expect(sent).toEqual([])
    })
})
