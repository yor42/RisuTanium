// @vitest-environment node
/**
 * The Node server's password flow in `NodeStorage` against the real
 * `server/node/server.cjs`, run as a child process: how many password prompts a
 * page shows, and whether the first operation after setting a password is
 * served. A page has one auth state shared by every entry point (`NodeStorage`,
 * the Node store through `authHeader`, and `getNodeServerProxyAuth`): at most one
 * prompt per outcome however many calls start before the check settles, and a
 * refused login is not remembered.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const h = vi.hoisted(() => ({
    keyPair: null as CryptoKeyPair | null,
    answers: [] as string[],
    prompts: 0,
}))

vi.mock('src/lang', () => ({
    language: { setNodePassword: 'set password', inputNodePassword: 'input password' },
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
    alertError: vi.fn(),
    waitAlert: vi.fn(async () => { }),
    alertInput: vi.fn(async () => {
        h.prompts++
        // Yield so that concurrent first calls overlap while a prompt is open.
        await new Promise((resolve) => setTimeout(resolve, 20))
        return h.answers.shift() ?? 'fixture-password'
    }),
}))

type NodeStorageModule = typeof import('src/ts/storage/nodeStorage')

const realFetch = globalThis.fetch
let fixture: NodeServerFixture | null = null
let nodeStorage: NodeStorageModule

async function startServer(provisioned: boolean): Promise<void> {
    fixture = await startNodeServer({ provisioned })
    const baseUrl = fixture.baseUrl
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => realFetch(`${baseUrl}${input}`, init))
    vi.resetModules()
    nodeStorage = await import('src/ts/storage/nodeStorage')
}

beforeEach(() => {
    h.keyPair = null
    h.answers = []
    h.prompts = 0
})

afterEach(async () => {
    vi.unstubAllGlobals()
    await fixture?.stop()
    fixture = null
})

describe('Node server password prompts', () => {
    test('a fresh server with no password asks once, and the first operation after setting it is served', async () => {
        await startServer(false)
        h.answers = ['new password']
        const storage = new nodeStorage.NodeStorage()

        const outcomes = await Promise.allSettled([storage.keys(), storage.keys()])

        expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
        expect(h.prompts).toBe(1)
    }, 60_000)

    test('a fresh server asks once for operations made one after the other', async () => {
        await startServer(false)
        h.answers = ['new password']
        const storage = new nodeStorage.NodeStorage()

        const first = (await Promise.allSettled([storage.keys()]))[0]
        const promptsAfterFirst = h.prompts
        const second = (await Promise.allSettled([storage.keys()]))[0]

        const describeOutcome = (outcome: PromiseSettledResult<unknown>, prompts: number) =>
            `${outcome.status}${outcome.status === 'rejected' ? ` (${String(outcome.reason)})` : ''}, ${prompts} prompt(s) so far`
        expect([describeOutcome(first, promptsAfterFirst), describeOutcome(second, h.prompts)]).toEqual([
            'fulfilled, 1 prompt(s) so far',
            'fulfilled, 1 prompt(s) so far',
        ])
    }, 60_000)

    test('a protected server asks once however many calls start before the login is done, through every entry point', async () => {
        await startServer(true)
        const storage = new nodeStorage.NodeStorage()
        const other = new nodeStorage.NodeStorage()

        const outcomes = await Promise.allSettled([
            storage.keys(),
            storage.getItem('database/database.bin'),
            nodeStorage.getNodeServerProxyAuth(),
            other.keys(),
        ])

        expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
        expect(h.prompts).toBe(1)
    }, 60_000)

    test('the Node store and the proxy-auth path share one auth state: one prompt for calls from both, and the store\'s requests are served', async () => {
        await startServer(false)
        h.answers = ['new password']
        const storage = new nodeStorage.NodeStorage()
        const { createNodeHttpStore } = await import('src/ts/storage/store/nodeHttpStore')
        const store = createNodeHttpStore({ authHeader: () => storage.authHeader() })

        const outcomes = await Promise.allSettled([
            store.read('database/database.bin'),
            store.list('database/'),
            nodeStorage.getNodeServerProxyAuth(),
            store.write('database/database.bin', Uint8Array.from([1]), { ifVersion: 0 }),
        ])

        expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
        expect(h.prompts).toBe(1)
    }, 60_000)

    test('a request made for the store writes no localStorage key; the proxy-auth path keeps its side effect', async () => {
        await startServer(true)
        const written: string[] = []
        vi.stubGlobal('localStorage', { setItem: (key: string) => { written.push(key) } })
        const storage = new nodeStorage.NodeStorage()

        await storage.authHeader()
        expect(written).toEqual([])

        await nodeStorage.getNodeServerProxyAuth()
        expect(written).toEqual(['risuauth'])
    }, 60_000)

    test('a refused login is not remembered: the next call asks again and succeeds with the right password', async () => {
        await startServer(true)
        h.answers = ['wrong password', 'fixture-password']
        const storage = new nodeStorage.NodeStorage()

        await expect(storage.keys()).rejects.toBeDefined()
        expect(h.prompts).toBe(1)

        await expect(storage.keys()).resolves.toEqual([])
        expect(h.prompts).toBe(2)
    }, 60_000)
})
