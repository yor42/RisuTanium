// @vitest-environment node
/**
 * The Node server's unauthenticated password routes and its refusal to start on
 * an unusable revision snapshot, against the real `server/node/server.cjs` run
 * as a child process. A request body must never take the process down, and a
 * snapshot the server cannot trust must stop startup with its files untouched.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture | undefined

afterEach(async () => {
    await fixture?.stop()
    fixture = undefined
}, 30_000)

const LOST = 'connection lost'

/** The status of a POST, or `LOST` when the server dropped the connection (a crashed process). */
async function post(fx: NodeServerFixture, route: string, body: BodyInit | undefined, contentType?: string): Promise<number | typeof LOST> {
    const headers: Record<string, string> = contentType === undefined ? {} : { 'content-type': contentType }
    return fetch(`${fx.baseUrl}${route}`, { method: 'POST', headers, body }).then(async (response) => {
        await response.arrayBuffer()
        return response.status
    }, () => LOST)
}

const postJson = (fx: NodeServerFixture, route: string, body: unknown) => post(fx, route, JSON.stringify(body), 'application/json')

async function authStatus(fx: NodeServerFixture, withHeader: boolean): Promise<string | typeof LOST> {
    const headers: Record<string, string> = withHeader ? { 'risu-auth': await fx.authHeader() } : {}
    return fetch(`${fx.baseUrl}/api/test_auth`, { headers }).then(
        async (response) => ((await response.json()) as { status: string }).status,
        () => LOST,
    )
}

async function passwordDigest(fx: NodeServerFixture): Promise<string> {
    const response = await fetch(`${fx.baseUrl}/api/crypto`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: 'fixture-password' }),
    })
    return response.text()
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf-8').digest('hex')
const EMPTY_DIGEST = sha256('')

const passwordFilePath = (fx: NodeServerFixture) => join(fx.saveDir, '__password')
const knownKeysPath = (fx: NodeServerFixture) => join(fx.saveDir, '__known_public_key_hashes.json')

describe('set_password body validation', () => {
    const badBodies: Array<{ name: string, body: BodyInit | undefined, contentType?: string }> = [
        { name: 'an empty object', body: '{}', contentType: 'application/json' },
        { name: 'an empty password', body: '{"password":""}', contentType: 'application/json' },
        { name: 'a whitespace-only password', body: '{"password":"   "}', contentType: 'application/json' },
        { name: 'a numeric password', body: '{"password":5}', contentType: 'application/json' },
        { name: 'a text/plain body', body: 'abc', contentType: 'text/plain' },
        { name: 'no body', body: undefined },
        { name: 'the digest of an empty password', body: JSON.stringify({ password: EMPTY_DIGEST }), contentType: 'application/json' },
        { name: 'the digest of an empty password in upper case', body: JSON.stringify({ password: EMPTY_DIGEST.toUpperCase() }), contentType: 'application/json' },
        { name: 'the digest of an empty password with surrounding whitespace', body: JSON.stringify({ password: `  ${EMPTY_DIGEST}\n` }), contentType: 'application/json' },
    ]

    test.each(badBodies)('refuses $name, stays up and sets no password', async ({ body, contentType }) => {
        const fx = await startNodeServer({ provisioned: false })
        fixture = fx

        expect(await post(fx, '/api/set_password', body, contentType)).toBe(400)
        expect(await authStatus(fx, false)).toBe('unset')
        expect(existsSync(passwordFilePath(fx))).toBe(false)
    }, 60_000)

    test('guard: a string password is accepted once and then reads as already set', async () => {
        const fx = await startNodeServer({ provisioned: false })
        fixture = fx

        expect(await postJson(fx, '/api/set_password', { password: 'first' })).toBe(200)
        expect(await readFile(passwordFilePath(fx), 'utf-8')).toBe('first')
        expect(await postJson(fx, '/api/set_password', { password: 'second' })).toBe(400)
        expect(await readFile(passwordFilePath(fx), 'utf-8')).toBe('first')
    }, 60_000)
})

describe('a stored digest of an empty password', () => {
    const WARNING = '[Server] WARNING: save/__password holds the digest of an empty password'

    async function waitForOutput(fx: NodeServerFixture, needle: string, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs
        while (!fx.output().includes(needle)) {
            if (Date.now() >= deadline) {
                return false
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 50))
        }
        return true
    }

    /** Stores the empty-password digest the way a hand edit or an older server would, then starts the server on it. */
    async function startOnEmptyDigest(suffix: string): Promise<{ fx: NodeServerFixture, planted: Buffer }> {
        const fx = await startNodeServer({ provisioned: false })
        fixture = fx
        const produced = await (await fetch(`${fx.baseUrl}/api/crypto`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: '' }),
        })).text()
        await fx.halt()
        await writeFile(passwordFilePath(fx), produced + suffix)
        const planted = await readFile(passwordFilePath(fx))
        await fx.restart()
        return { fx, planted }
    }

    test('guard: the crypto route returns the SHA-256 hex digest the server refuses', async () => {
        const fx = await startNodeServer({ provisioned: false })
        fixture = fx
        const produced = await (await fetch(`${fx.baseUrl}/api/crypto`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: '' }),
        })).text()

        expect(produced).toBe(EMPTY_DIGEST)
    }, 60_000)

    test.each([
        { name: 'exactly as set_password stores it', suffix: '' },
        { name: 'with the trailing newline an echo leaves', suffix: '\n' },
    ])('startup warns about it, $name', async ({ suffix }) => {
        const { fx } = await startOnEmptyDigest(suffix)

        expect(await waitForOutput(fx, WARNING, 5_000)).toBe(true)
    }, 60_000)

    test.each([
        { name: 'exactly as set_password stores it', suffix: '' },
        { name: 'with the trailing newline an echo leaves', suffix: '\n' },
    ])('guard: it is only warned about, the file stays and login still works, $name', async ({ suffix }) => {
        const { fx, planted } = await startOnEmptyDigest(suffix)

        expect((await readFile(passwordFilePath(fx))).equals(planted)).toBe(true)
        expect(await authStatus(fx, false)).not.toBe('unset')
        expect(await postJson(fx, '/api/login', { password: EMPTY_DIGEST, publicKey: { kty: 'EC', x: 'empty-digest' } })).toBe(200)
        expect((await readFile(passwordFilePath(fx))).equals(planted)).toBe(true)
    }, 60_000)

    test('guard: a server with a normal password prints no such warning', async () => {
        const fx = await startNodeServer()
        fixture = fx
        await fx.restart()
        expect(await authStatus(fx, true)).toBe('success')
        await new Promise<void>((resolve) => setTimeout(resolve, 500))

        expect(fx.output()).not.toContain('save/__password holds')
    }, 60_000)
})

describe('set_password rate limit', () => {
    test('answers 429 after a burst, and the login budget is separate', async () => {
        const fx = await startNodeServer()
        fixture = fx

        const statuses: Array<number | typeof LOST> = []
        for (let i = 0; i < 12; i++) {
            statuses.push(await postJson(fx, '/api/set_password', { password: 'again' }))
        }
        const firstLimited = statuses.indexOf(429)
        expect(firstLimited, `statuses: ${statuses.join(',')}`).toBeGreaterThanOrEqual(0)
        expect(statuses.slice(0, firstLimited).every((status) => status === 400)).toBe(true)
        expect(statuses.slice(firstLimited).every((status) => status === 429)).toBe(true)

        const digest = await passwordDigest(fx)
        expect(await postJson(fx, '/api/login', { password: digest, publicKey: { kty: 'EC', x: 'budget' } })).toBe(200)
    }, 60_000)
})

describe('login body validation', () => {
    const badLogins: Array<{ name: string, body: (digest: string) => unknown }> = [
        { name: 'a numeric password', body: () => ({ password: 5, publicKey: { kty: 'EC' } }) },
        { name: 'an array password', body: () => ({ password: ['a'], publicKey: { kty: 'EC' } }) },
        { name: 'an object password', body: () => ({ password: {}, publicKey: { kty: 'EC' } }) },
        { name: 'a correct password without a public key', body: (digest) => ({ password: digest }) },
        { name: 'a correct password with a null public key', body: (digest) => ({ password: digest, publicKey: null }) },
        { name: 'a correct password with a string public key', body: (digest) => ({ password: digest, publicKey: 'key' }) },
    ]

    test.each(badLogins)('refuses $name, stays up and registers no key', async ({ body }) => {
        const fx = await startNodeServer()
        fixture = fx
        const digest = await passwordDigest(fx)
        const keysBefore = await readFile(knownKeysPath(fx))

        expect(await postJson(fx, '/api/login', body(digest))).toBe(400)
        expect(await authStatus(fx, true)).toBe('success')
        expect((await readFile(knownKeysPath(fx))).equals(keysBefore)).toBe(true)
    }, 60_000)

    test('guard: a correct login registers its key', async () => {
        const fx = await startNodeServer()
        fixture = fx
        const digest = await passwordDigest(fx)
        const keysBefore = JSON.parse(await readFile(knownKeysPath(fx), 'utf-8')) as string[]

        expect(await postJson(fx, '/api/login', { password: digest, publicKey: { kty: 'EC', x: 'second' } })).toBe(200)
        const keysAfter = JSON.parse(await readFile(knownKeysPath(fx), 'utf-8')) as string[]
        expect(keysAfter).toHaveLength(keysBefore.length + 1)
    }, 60_000)
})

describe('unusable revision snapshot', () => {
    const snapshotPath = (fx: NodeServerFixture) => join(fx.saveDir, '__revisions.json')
    const logPath = (fx: NodeServerFixture) => join(fx.saveDir, '__revisions.log')

    async function writeKey(fx: NodeServerFixture, key: string, ifMatch?: number): Promise<number> {
        const headers: Record<string, string> = {
            'file-path': hexOfKey(key),
            'risu-auth': await fx.authHeader(),
            'content-type': 'application/octet-stream',
        }
        if (ifMatch !== undefined) {
            headers['if-match-revision'] = String(ifMatch)
        }
        const response = await fetch(`${fx.baseUrl}/api/write`, { method: 'POST', headers, body: Buffer.from(`body of ${key}`) })
        const body = await response.json() as { revision: number }
        return body.revision
    }

    async function readRevision(fx: NodeServerFixture, key: string): Promise<number> {
        const response = await fetch(`${fx.baseUrl}/api/read`, { headers: { 'file-path': hexOfKey(key), 'risu-auth': await fx.authHeader() } })
        await response.arrayBuffer()
        return Number(response.headers.get('x-risu-revision'))
    }

    const badSnapshots: Array<{ name: string, plant: (path: string) => Promise<void> }> = [
        { name: 'unparseable text', plant: (path) => writeFile(path, '{garbage') },
        { name: 'an array', plant: (path) => writeFile(path, '[1,2]') },
        { name: 'a directory in place of the file', plant: (path) => mkdir(path) },
    ]
    const cases = badSnapshots.flatMap((snapshot) => [true, false].map((withLog) => ({ ...snapshot, withLog })))

    test.each(cases)('refuses to start on $name (log present: $withLog), leaves both files alone, and a restored snapshot recovers', async ({ plant, withLog }) => {
        const fx = await startNodeServer()
        fixture = fx
        await writeKey(fx, 'doc')
        await writeKey(fx, 'doc', 1)
        await fx.restart()
        expect(await writeKey(fx, 'doc', 2)).toBe(3)
        await fx.halt('hard')
        const goodSnapshot = await readFile(snapshotPath(fx))
        if (!withLog) {
            await rm(logPath(fx))
        }
        const logBefore = withLog ? await readFile(logPath(fx)) : undefined

        await rm(snapshotPath(fx))
        await plant(snapshotPath(fx))
        const snapshotIsDirectory = (await stat(snapshotPath(fx))).isDirectory()
        const snapshotBefore = snapshotIsDirectory ? undefined : await readFile(snapshotPath(fx))

        await expect(fx.restart()).rejects.toThrow(/exited with code 1 before it was ready[\s\S]*__revisions\.json[\s\S]*restor/i)

        expect((await stat(snapshotPath(fx))).isDirectory()).toBe(snapshotIsDirectory)
        if (snapshotBefore !== undefined) {
            expect((await readFile(snapshotPath(fx))).equals(snapshotBefore)).toBe(true)
        }
        expect(existsSync(logPath(fx))).toBe(withLog)
        if (logBefore !== undefined) {
            expect((await readFile(logPath(fx))).equals(logBefore)).toBe(true)
        }

        await rm(snapshotPath(fx), { recursive: true, force: true })
        await writeFile(snapshotPath(fx), goodSnapshot)
        await fx.restart()
        expect(await readRevision(fx, 'doc')).toBe(withLog ? 3 : 2)
    }, 60_000)

    test('guard: a snapshot object with an invalid value still starts and keeps its valid keys', async () => {
        const fx = await startNodeServer()
        fixture = fx
        await fx.halt()
        await writeFile(snapshotPath(fx), JSON.stringify({ [hexOfKey('good')]: 4, [hexOfKey('bad')]: 'x' }))

        await fx.restart()

        expect(await readRevision(fx, 'good')).toBe(4)
        expect(await readRevision(fx, 'bad')).toBe(0)
    }, 60_000)
})
