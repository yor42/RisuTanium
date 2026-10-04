// @vitest-environment node
/**
 * `/api/env-secret` against the real `server/node/server.cjs`, run as a child
 * process. Only an authenticated caller may read, and only `RISU_*_KEY` /
 * `RISU_*_TOKEN` names or names the operator lists in `RISU_ALLOWED_ENV`
 * resolve. Every refusal answers identically so names cannot be probed.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture | undefined

afterEach(async () => {
    await fixture?.stop()
    fixture = undefined
}, 30_000)

const SERVER_ENV = {
    RISU_TEST_KEY: '  padded-secret  ',
    RISU_TEST_TOKEN: 'token-secret',
    RISU_MULTILINE_KEY: 'line1\nline2',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    OPENAI_API_KEY: 'openai-secret',
    RISU_ALLOWED_ENV: '',
}

async function start(env: Record<string, string> = {}): Promise<NodeServerFixture> {
    fixture = await startNodeServer({ env: { ...SERVER_ENV, ...env } })
    return fixture
}

interface Answer { status: number, body: string, cacheControl: string | null }

async function ask(fx: NodeServerFixture, payload: unknown, authenticated = true): Promise<Answer> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (authenticated) {
        headers['risu-auth'] = await fx.authHeader()
    }
    const response = await fetch(`${fx.baseUrl}/api/env-secret`, {
        method: 'POST',
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    return { status: response.status, body: await response.text(), cacheControl: response.headers.get('cache-control') }
}

describe('/api/env-secret', () => {
    test('refuses an unauthenticated request without revealing the value', async () => {
        const fx = await start()
        const answer = await ask(fx, { name: 'RISU_TEST_KEY' }, false)
        expect(answer.status).not.toBe(200)
        expect(answer.body).not.toContain('padded-secret')
    })

    test('resolves a RISU_*_KEY name and trims the value', async () => {
        const fx = await start()
        const answer = await ask(fx, { name: 'RISU_TEST_KEY' })
        expect(answer.status).toBe(200)
        expect(JSON.parse(answer.body)).toEqual({ value: 'padded-secret' })
    })

    test('resolves a RISU_*_TOKEN name', async () => {
        const fx = await start()
        const answer = await ask(fx, { name: 'RISU_TEST_TOKEN' })
        expect(answer.status).toBe(200)
        expect(JSON.parse(answer.body)).toEqual({ value: 'token-secret' })
    })

    test('answers every unavailable name with the same 404 body', async () => {
        const fx = await start()
        const names = ['RISU_MISSING_KEY', 'PATH', 'AWS_SECRET_ACCESS_KEY', 'risu_test_key', 'RISU-TEST-KEY', 'OPENAI_API_KEY']
        const answers = await Promise.all(names.map((name) => ask(fx, { name })))
        for (const answer of answers) {
            expect(answer.status).toBe(404)
            expect(answer.body).toBe(answers[0].body)
            expect(answer.body).not.toContain('secret')
        }
    })

    test('resolves a name the operator lists in RISU_ALLOWED_ENV', async () => {
        const fx = await start({ RISU_ALLOWED_ENV: 'OTHER_NAME, OPENAI_API_KEY' })
        const answer = await ask(fx, { name: 'OPENAI_API_KEY' })
        expect(answer.status).toBe(200)
        expect(JSON.parse(answer.body)).toEqual({ value: 'openai-secret' })
        expect((await ask(fx, { name: 'AWS_SECRET_ACCESS_KEY' })).status).toBe(404)
    })

    test('refuses a value containing a line break', async () => {
        const fx = await start()
        const answer = await ask(fx, { name: 'RISU_MULTILINE_KEY' })
        expect(answer.status).toBe(404)
        expect(answer.body).not.toContain('line1')
    })

    test('marks the response no-store', async () => {
        const fx = await start()
        expect((await ask(fx, { name: 'RISU_TEST_KEY' })).cacheControl).toBe('no-store')
        expect((await ask(fx, { name: 'PATH' })).cacheControl).toBe('no-store')
    })

    test('answers 404 for a non-string name or a missing body', async () => {
        const fx = await start()
        for (const payload of [{ name: 5 }, { name: ['RISU_TEST_KEY'] }, { name: null }, {}, undefined]) {
            expect((await ask(fx, payload)).status).toBe(404)
        }
    })
})
