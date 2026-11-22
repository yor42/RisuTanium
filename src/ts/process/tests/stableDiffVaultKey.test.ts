/**
 * An image provider whose key is a Keystore-wrapped connection key that is temporarily unreadable:
 * the real `generateAIImage` shows the vault's message through `alertError`, returns the clean failure
 * value of its mode ('' for an inlay, false otherwise), sends nothing and lets no rejection escape.
 * Regression reproducer: `resolveImageKey` must await the key read inside its own guard, so a call site
 * that awaits `currentKey(...)` before the guard lets the `VaultKeyUnavailableError` escape. The vault
 * adapter is a fake and the keys are synthetic; this is not evidence of native Keystore behaviour.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: vi.fn(), readImage: vi.fn(), fetchNative: vi.fn() }))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: vi.fn() }))
vi.mock('src/ts/stores.svelte', () => ({ CharEmotion: { set: vi.fn() } }))
vi.mock('src/ts/process/processzip', () => ({ processZip: vi.fn() }))
vi.mock('src/ts/process/request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('src/ts/android/keyVault', () => ({
    unwrapKey: vi.fn(async () => ({ ok: false, code: 'timeout' })),
    wrapKey: vi.fn(async () => ({ ok: false, code: 'other' })),
    watchdogFired: () => false,
}))

import { language } from 'src/lang'
import { alertError } from 'src/ts/alert'
import { globalFetch } from 'src/ts/globalApi.svelte'
import { getDatabase, type character } from 'src/ts/storage/database.svelte'
import type { Connection } from 'src/ts/connections/connections'
import { installVaultHost, resetVaultStoreForTest } from 'src/ts/connections/keyVaultStore.svelte'
import { absorbLegacyForTest } from 'src/ts/connections/tests/legacyFixture'
import { generateAIImage } from '../stableDiff'

/** A database whose only connection holds a wrapped key, as after a boot that has not read it yet. */
function wrappedDb(legacy: Record<string, unknown>): { connections: Connection[] } {
    const db = absorbLegacyForTest(legacy) as unknown as { connections: Connection[] }
    for (const conn of db.connections) {
        if (conn.key !== '') {
            conn.key = ''
            conn.keyWrapped = 'SYNTH-ENVELOPE'
        }
    }
    return db
}

function installHost(db: { connections: Connection[] }): void {
    installVaultHost({
        platform: 'vault',
        findConnection: (id) => db.connections.find((conn) => conn.id === id),
        listConnections: () => db.connections,
        requestSaveNow: () => {},
        markBootWrite: () => {},
        isReadOnlyPage: () => false,
        notify: { keepPlain: () => {}, wrapped: () => {}, reentry: () => {} },
        messages: { keyUnavailable: () => language.vaultKeyTemporarilyUnavailable },
    })
}

beforeEach(() => {
    resetVaultStoreForTest()
    vi.mocked(alertError).mockClear()
    vi.mocked(globalFetch).mockReset()
})

describe.each([
    { name: 'dalle', legacy: { sdProvider: 'dalle', openAIKey: 'SYNTH-KEY', dallEQuality: '' } },
    { name: 'Imagen', legacy: { sdProvider: 'Imagen', google: { accessToken: 'SYNTH-KEY' }, ImagenModel: 'imagen-4.0-generate-001', ImagenImageSize: '1K', ImagenAspectRatio: '1:1', ImagenPersonGeneration: 'allow_adult' } },
])('$name with a temporarily unreadable wrapped key', ({ legacy }) => {
    test.each([
        { mode: 'inlay', expected: '' },
        { mode: '', expected: false },
    ])('mode "$mode": shows the vault message, returns $expected, sends nothing, no rejection escapes', async ({ mode, expected }) => {
        const db = wrappedDb({ ...legacy })
        vi.mocked(getDatabase).mockReturnValue(db as unknown as ReturnType<typeof getDatabase>)
        installHost(db)

        const outcome = await generateAIImage('a prompt', { chaId: 'cha-a' } as character, '', mode)

        expect(outcome).toBe(expected)
        expect(alertError).toHaveBeenCalledWith(language.vaultKeyTemporarilyUnavailable)
        expect(globalFetch).not.toHaveBeenCalled()
    })
})
