/**
 * The connection-key store is a leaf: importing the seam must not load the database module, the
 * save-on-hide wiring, globalApi, the stores, the boot window, alerts or the byte transport, which
 * would close an import cycle through database.svelte. Each of those modules is replaced with a
 * factory that throws on load, so any import of one fails the dynamic import below.
 */
import { describe, expect, it, vi } from 'vitest'

const refuse = vi.hoisted(() => (name: string) => () => {
    throw new Error(`the key store must not import ${name}`)
})

vi.mock('src/ts/storage/database.svelte', refuse('database.svelte'))
vi.mock('src/ts/process/saveOnHide', refuse('saveOnHide'))
vi.mock('src/ts/globalApi.svelte', refuse('globalApi.svelte'))
vi.mock('src/ts/stores.svelte', refuse('stores.svelte'))
vi.mock('src/ts/bootWindow', refuse('bootWindow'))
vi.mock('src/ts/alert', refuse('alert'))
vi.mock('src/ts/storage/tauriByteTransport', refuse('tauriByteTransport'))

describe('key access import boundary', () => {
    it('loads with every app module refusing, and works on an uninstalled store', async () => {
        const access = await import('src/ts/connections/keyAccess')
        const conn = { id: 'c', name: 'n', provider: 'openai' as const, key: '', keyWrapped: 'E' }
        expect(access.connectionHasKey(conn)).toBe(false)
        expect(access.connectionHasKey({ ...conn, key: 'SYNTH-KEY-1234', keyWrapped: undefined })).toBe(true)
        expect(access.connectionKeyTemporarilyUnavailable(conn)).toBe(false)
    })
})
