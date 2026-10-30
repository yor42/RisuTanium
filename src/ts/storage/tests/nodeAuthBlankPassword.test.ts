// @vitest-environment node
/**
 * The password prompts of `NodeStorage` against the real `server/node/server.cjs`,
 * run as a child process: a blank answer (empty, whitespace only or not a string)
 * never reaches the server's crypto, set_password or login routes, the user is
 * told and asked again, and a non-blank answer is hashed exactly as typed.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const h = vi.hoisted(() => ({
    keyPair: null as CryptoKeyPair | null,
    answers: [] as Array<string | undefined>,
    prompts: [] as string[],
    errors: [] as string[],
    requests: [] as Array<{ path: string, body: unknown }>,
}))

vi.mock('src/lang', () => ({
    language: {
        setNodePassword: 'set password',
        inputNodePassword: 'input password',
        nodePasswordEmpty: 'Password cannot be empty',
    },
}))

vi.mock('src/ts/util', () => ({
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn((message: string) => { h.errors.push(message) }),
    waitAlert: vi.fn(async () => { }),
    alertInput: vi.fn(async (message: string) => {
        h.prompts.push(message)
        if (h.answers.length === 0) {
            // A script that runs dry ends the test instead of looping on blank answers.
            throw new Error('the prompt script ran out of answers')
        }
        return h.answers.shift()
    }),
}))

type NodeStorageModule = typeof import('src/ts/storage/nodeStorage')

const sha256 = (text: string) => createHash('sha256').update(text, 'utf-8').digest('hex')
const realFetch = globalThis.fetch
let fixture: NodeServerFixture | null = null
let nodeStorage: NodeStorageModule

async function startServer(provisioned: boolean): Promise<void> {
    fixture = await startNodeServer({ provisioned })
    const baseUrl = fixture.baseUrl
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
        h.requests.push({ path: input, body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined })
        return realFetch(`${baseUrl}${input}`, init)
    })
    vi.resetModules()
    nodeStorage = await import('src/ts/storage/nodeStorage')
}

function bodiesOf(path: string): unknown[] {
    return h.requests.filter((request) => request.path === path).map((request) => request.body)
}

beforeEach(() => {
    h.keyPair = null
    h.answers = []
    h.prompts = []
    h.errors = []
    h.requests = []
})

afterEach(async () => {
    vi.unstubAllGlobals()
    await fixture?.stop()
    fixture = null
})

describe('the set-password prompt', () => {
    test('a blank answer is refused before hashing and asked again until a real one comes', async () => {
        await startServer(false)
        h.answers = ['', '   ', undefined, 'pw']
        const storage = new nodeStorage.NodeStorage()

        const outcome = (await Promise.allSettled([storage.keys()]))[0]

        expect({ status: outcome.status, prompts: h.prompts.length, errors: h.errors }).toEqual({
            status: 'fulfilled',
            prompts: 4,
            errors: ['Password cannot be empty', 'Password cannot be empty', 'Password cannot be empty'],
        })
        expect(bodiesOf('/api/crypto')).toEqual([{ data: 'pw' }])
        expect(bodiesOf('/api/set_password')).toEqual([{ password: sha256('pw') }])
    }, 60_000)

    test('guard: a non-blank answer is hashed exactly as typed, spaces included', async () => {
        await startServer(false)
        h.answers = ['  pw  ']
        const storage = new nodeStorage.NodeStorage()

        await expect(storage.keys()).resolves.toEqual([])

        expect(bodiesOf('/api/crypto')).toEqual([{ data: '  pw  ' }])
        expect(bodiesOf('/api/set_password')).toEqual([{ password: sha256('  pw  ') }])
    }, 60_000)
})

describe('the login prompt', () => {
    test('a blank answer is refused before hashing and asked again until a real one comes', async () => {
        await startServer(true)
        h.answers = ['', ' ', 'fixture-password']
        const storage = new nodeStorage.NodeStorage()

        const outcome = (await Promise.allSettled([storage.keys()]))[0]

        expect({ status: outcome.status, prompts: h.prompts.length, errors: h.errors }).toEqual({
            status: 'fulfilled',
            prompts: 3,
            errors: ['Password cannot be empty', 'Password cannot be empty'],
        })
        expect(bodiesOf('/api/crypto')).toEqual([{ data: 'fixture-password' }])
        expect((bodiesOf('/api/login') as Array<{ password: string }>).map((body) => body.password)).toEqual([sha256('fixture-password')])
    }, 60_000)

    test('guard: a non-blank answer is hashed exactly as typed, so a padded password is refused by the server', async () => {
        await startServer(true)
        h.answers = [' fixture-password']
        const storage = new nodeStorage.NodeStorage()

        await expect(storage.keys()).rejects.toBeDefined()

        expect(bodiesOf('/api/crypto')).toEqual([{ data: ' fixture-password' }])
        expect((bodiesOf('/api/login') as Array<{ password: string }>).map((body) => body.password)).toEqual([sha256(' fixture-password')])
    }, 60_000)
})
