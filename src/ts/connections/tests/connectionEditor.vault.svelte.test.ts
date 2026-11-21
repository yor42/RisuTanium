/**
 * The Connections page writers over the real key-vault store and a fake vault. `setConnectionKey`
 * never rejects for a vault failure: a failed wrap resolves after storing the typed key plain and
 * raising the keep-plain notice once typing pauses, so a key write is "stored" either way and only an unexpected throw
 * reaches the `keyWrite` path. Compatibility guards: they pass with or without the vault-state page
 * changes, since those changed no writer. Keys and envelopes are synthetic. A mocked vault is not
 * evidence of native Keystore behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const fake = vi.hoisted(() => {
    const s = { wrapCode: null as string | null }
    const enc = (plain: string): string => 'ENV:' + plain
    return {
        s, enc,
        wrapKey: vi.fn(async (plain: string) => s.wrapCode
            ? { ok: false as const, code: s.wrapCode }
            : { ok: true as const, value: enc(plain) }),
        unwrapKey: vi.fn(async (envelope: string) => envelope.startsWith('ENV:')
            ? { ok: true as const, value: envelope.slice(4) }
            : { ok: false as const, code: 'invalidated' }),
        watchdogFired: () => false,
    }
})

vi.mock('src/ts/android/keyVault', () => ({
    wrapKey: fake.wrapKey,
    unwrapKey: fake.unwrapKey,
    watchdogFired: fake.watchdogFired,
}))

import { storedConnections } from '../connections'
import { addConnection, clearKey, needsKey, replaceKey } from '../connectionEditor'
import { connectionKeyHint } from '../connectionHint'
import { connectionKeyForUi, connectionNeedsReentry } from '../keyAccess'
import { installVaultHost, KEEP_PLAIN_DEFER_MS, resetVaultStoreForTest, unwrapEnvelope } from '../keyVaultStore.svelte'

let db: Database
let keepPlain = 0

function useDb(connections: Database['connections']): void {
    const state = $state({ connections, customModels: [] })
    db = state as unknown as Database
    installVaultHost({
        platform: 'vault',
        findConnection: (id) => storedConnections(db).find((conn) => conn.id === id),
        listConnections: () => storedConnections(db),
        requestSaveNow: () => {},
        markBootWrite: () => {},
        isReadOnlyPage: () => false,
        notify: { keepPlain: () => { keepPlain++ }, wrapped: () => {}, reentry: () => {} },
        messages: { keyUnavailable: () => 'unavailable' },
    })
}

beforeEach(() => {
    resetVaultStoreForTest()
    fake.s.wrapCode = null
    fake.wrapKey.mockClear()
    keepPlain = 0
    needsKey.clear()
})

afterEach(resetVaultStoreForTest)

describe('key writes over the vault', () => {
    it('a wrapped add stores the envelope and no plain key', async () => {
        useDb([])
        const result = await addConnection(db, { provider: 'openai', name: 'OpenAI', key: 'sk-test-AAAA1234' })
        expect(result).toEqual({ ok: true, id: 'conn-1' })
        expect(storedConnections(db)[0]).toStrictEqual({
            id: 'conn-1', name: 'OpenAI', provider: 'openai', key: '', keyWrapped: fake.enc('sk-test-AAAA1234'),
        })
    })

    it('a failed wrap resolves, so the add succeeds with the key stored plain and no rollback', async () => {
        useDb([])
        fake.s.wrapCode = 'unavailable'
        const result = await addConnection(db, { provider: 'openai', name: 'OpenAI', key: 'sk-test-AAAA1234' })
        expect(result).toEqual({ ok: true, id: 'conn-1' })
        expect(storedConnections(db)[0]).toStrictEqual({ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-test-AAAA1234' })
        expect(keepPlain).toBe(0)
        await vi.waitFor(() => expect(keepPlain).toBe(1), { timeout: KEEP_PLAIN_DEFER_MS + 1000 })
    })

    it('a failed wrap on replace resolves ok, stores the key plain, drops the old envelope and the needsKey flag', async () => {
        useDb([{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: '', keyWrapped: 'SYNTH-OLD-ENVELOPE' }])
        needsKey.add('conn-1')
        fake.s.wrapCode = 'timeout'
        const result = await replaceKey(db, 'conn-1', 'sk-test-BBBB5678')
        expect(result).toEqual({ ok: true })
        expect(storedConnections(db)[0]).toStrictEqual({ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-test-BBBB5678' })
        expect(needsKey.has('conn-1')).toBe(false)
        expect(keepPlain).toBe(0)
        await vi.waitFor(() => expect(keepPlain).toBe(1), { timeout: KEEP_PLAIN_DEFER_MS + 1000 })
    })

    it('replacing a key that can never be read here makes the connection readable again', async () => {
        useDb([{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: '', keyWrapped: 'SYNTH-DEAD-ENVELOPE' }])
        // The store learns an envelope is dead only from a failed unwrap.
        await unwrapEnvelope('SYNTH-DEAD-ENVELOPE')
        expect(connectionNeedsReentry(storedConnections(db)[0])).toBe(true)
        expect(connectionKeyHint(storedConnections(db)[0])).toEqual({ kind: 'reentry' })
        expect(await replaceKey(db, 'conn-1', 'sk-test-CCCC9012')).toEqual({ ok: true })
        expect(connectionNeedsReentry(storedConnections(db)[0])).toBe(false)
        expect(connectionKeyForUi(storedConnections(db)[0])).toBe('sk-test-CCCC9012')
    })

    it('clearing a wrapped key removes the envelope and resolves ok', async () => {
        useDb([{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: '', keyWrapped: fake.enc('sk-test-AAAA1234') }])
        expect(await clearKey(db, 'conn-1')).toEqual({ ok: true })
        expect(storedConnections(db)[0]).toStrictEqual({ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: '' })
    })
})
