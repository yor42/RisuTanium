// @vitest-environment node
/**
 * `NodeStorage.setItem` failures: every non-conflict failure is an Error that
 * names the key, size and status and carries the server's code and message when
 * its answer is JSON. `fetch` is stubbed, so this says nothing about the real
 * server. The revision-conflict test is a compatibility guard (G) that passes
 * before and after; the rest are reproducers of the string throw.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ keyPair: null as CryptoKeyPair | null }))

vi.mock('src/lang', () => ({ language: { setNodePassword: 'set password', inputNodePassword: 'input password' } }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertInput: vi.fn(), waitAlert: vi.fn(async () => { }) }))
vi.mock('src/ts/util', () => ({
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        world.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return world.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}))

async function storageAnswering(response: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const { NodeStorage } = await import('src/ts/storage/nodeStorage')
    return new NodeStorage({ checked: true, pending: null })
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
    return await promise.then(() => undefined, (error: unknown) => error)
}

beforeEach(() => {
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('NodeStorage.setItem failures', () => {
    test('a 507 JSON answer throws an Error with the key, size, status, code and message', async () => {
        const storage = await storageAnswering(() => new Response(JSON.stringify({ error: 'Failed to write storage item', code: 'ENOSPC', message: 'ENOSPC: no space left on device' }), { status: 507 }))

        const error = await caught(storage.setItem('database/database.bin', new Uint8Array(3)))

        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('database/database.bin')
        expect((error as Error).message).toContain('3 bytes')
        expect((error as Error).message).toContain('HTTP 507')
        expect((error as Error).message).toContain('ENOSPC | ENOSPC: no space left on device')
    })

    test('an HTML error page throws an Error that does not echo the page', async () => {
        const storage = await storageAnswering(() => new Response('<html>secret stack</html>', { status: 500, headers: { 'content-type': 'text/html' } }))

        const error = await caught(storage.setItem('k', new Uint8Array(1)))

        expect(error).toBeInstanceOf(Error)
        expect(typeof error).toBe('object')
        expect((error as Error).message).toContain('HTTP 500')
        expect((error as Error).message).not.toContain('secret stack')
    })

    test('G: a 409 is still a NodeStorageConflictError with the current revision', async () => {
        const storage = await storageAnswering(() => new Response(JSON.stringify({ error: 'Revision conflict', currentRevision: 7 }), { status: 409 }))
        const { NodeStorageConflictError } = await import('src/ts/storage/nodeStorage')

        const error = await caught(storage.setItem('k', new Uint8Array(1)))

        expect(error).toBeInstanceOf(NodeStorageConflictError)
        expect(error).toMatchObject({ currentRevision: 7 })
    })
})
