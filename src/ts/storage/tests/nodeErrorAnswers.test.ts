// @vitest-environment node
/**
 * Error containment and response headers of the real `server/node/server.cjs`:
 * no request handler can end the process, a malformed client input answers 400
 * as JSON without a stack, and every answer carries the content-type, framing
 * and referrer headers.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { request, type OutgoingHttpHeaders } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture

beforeAll(async () => {
    fixture = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
}, 30_000)

interface Answer {
    status: number
    headers: Record<string, string | string[] | undefined>
    text: string
}

/** A request with exactly these headers, so a value that fetch would refuse can be sent. */
function send(method: string, path: string, headers: OutgoingHttpHeaders, body?: string): Promise<Answer> {
    const url = new URL(fixture.baseUrl)
    return new Promise((resolve, reject) => {
        const outgoing = request({ host: '127.0.0.1', port: Number(url.port), method, path, headers }, (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk: Buffer) => chunks.push(chunk))
            response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString('utf-8') }))
        })
        outgoing.on('error', reject)
        outgoing.end(body)
    })
}

function expectJsonWithoutStack(answer: Answer): void {
    expect(String(answer.headers['content-type'])).toContain('application/json')
    expect(JSON.parse(answer.text)).toHaveProperty('error')
    expect(answer.text).not.toContain('node_modules')
    expect(answer.text).not.toMatch(/\n\s+at /)
    expect(answer.text).not.toContain('SyntaxError')
}

async function expectServerAlive(): Promise<void> {
    const answer = await send('GET', '/api/test_auth', { 'risu-auth': await fixture.authHeader() })
    expect(JSON.parse(answer.text)).toEqual({ status: 'success' })
}

describe('a malformed proxy input answers 400 and the server stays up', { timeout: 30_000 }, () => {
    const cases: Array<[string, (target: string) => Record<string, string>]> = [
        ['risu-header with a broken escape', (target) => ({ 'risu-url': encodeURIComponent(target), 'risu-header': '%E0%A4%A' })],
        ['risu-header that is not JSON', (target) => ({ 'risu-url': encodeURIComponent(target), 'risu-header': 'not-json' })],
        ['risu-url with a broken escape', () => ({ 'risu-url': '%E0%A4%A' })],
    ]
    for (const [name, headersFor] of cases) {
        test(`S4a-T2 ${name}`, async () => {
            const expected = name.startsWith('risu-url') ? 'Invalid risu-url' : 'Invalid risu-header'
            for (const [method, path] of [['POST', '/proxy'], ['GET', '/proxy2']] as const) {
                const answer = await send(method, path, { 'risu-auth': await fixture.authHeader(), ...headersFor('http://127.0.0.1:9/') }, method === 'POST' ? '{}' : undefined)
                expect(answer.status).toBe(400)
                expect(JSON.parse(answer.text)).toEqual({ error: expected })
            }
            await expectServerAlive()
        })
    }
})

describe('other parse failures', { timeout: 30_000 }, () => {
    test('S4a-T3 a login body that is not JSON gets a 400 as JSON with no stack', async () => {
        const answer = await send('POST', '/api/login', { 'content-type': 'application/json' }, '{bad')
        expect(answer.status).toBe(400)
        expectJsonWithoutStack(answer)
    })

    test('S4a-T4 an unparseable token gets a 400 and no stack in the log', async () => {
        const logged = fixture.output().length
        const answer = await send('GET', '/api/list', { 'risu-auth': 'abc' })
        expect(answer.status).toBe(400)
        expect(JSON.parse(answer.text)).toEqual({ error: 'Invalid Token' })
        // The server's output reaches the test through a pipe, a moment after the answer.
        for (let wait = 0; wait < 100 && !fixture.output().slice(logged).includes('Invalid token'); wait++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 20))
        }
        const added = fixture.output().slice(logged)
        expect(added).toContain('Invalid token')
        expect(added).not.toMatch(/\n\s+at /)
        expect(added).not.toContain('Error')
    })
})

describe('a handler that fails after an await', { timeout: 30_000 }, () => {
    test('S4a-T6 answers 500 as JSON and the process survives', async () => {
        // The known-key list is written on a login; a directory in its place makes that write fail after the awaited hash.
        const keysPath = join(fixture.saveDir, '__known_public_key_hashes.json')
        await rm(keysPath, { force: true })
        await mkdir(keysPath)
        try {
            const digest = (await (await fetch(`${fixture.baseUrl}/api/crypto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'fixture-password' }) })).text())
            const answer = await send('POST', '/api/login', { 'content-type': 'application/json' }, JSON.stringify({ password: digest, publicKey: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' } }))
            expect(answer.status).toBe(500)
            expect(JSON.parse(answer.text)).toEqual({ error: 'Internal Server Error' })
            expectJsonWithoutStack(answer)
            await expectServerAlive()
        } finally {
            await rm(keysPath, { recursive: true, force: true })
            await writeFile(keysPath, '[]')
        }
    })
})

describe('response headers', { timeout: 30_000 }, () => {
    test('S4a-T5 every kind of answer carries nosniff, SAMEORIGIN framing and the referrer policy', async () => {
        const staticDir = join(fixture.saveDir, '..', 'dist', 'streamsaver')
        await mkdir(staticDir, { recursive: true })
        await writeFile(join(staticDir, 'mitm.html'), '<html></html>')
        const answers = [
            await send('GET', '/api/test_auth', {}),
            await send('GET', '/no/such/path', {}),
            await send('GET', '/api/list', {}),
            await send('GET', '/streamsaver/mitm.html', {}),
        ]
        expect(answers.map((answer) => answer.status)).toEqual([200, 404, 400, 200])
        for (const answer of answers) {
            expect(answer.headers['x-content-type-options']).toBe('nosniff')
            expect(answer.headers['x-frame-options']).toBe('SAMEORIGIN')
            expect(answer.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
        }
    })
})
