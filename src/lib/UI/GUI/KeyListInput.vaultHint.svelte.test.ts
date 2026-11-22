// @vitest-environment jsdom

/**
 * A saved key that is wrapped and not decrypted yet shows an empty field and a hint under it; once the
 * key is readable the hint is gone and the field holds the plain. Mounts the REAL `KeyListInput`
 * bound to a slot of a `$state` database exactly as the settings pages bind it. The vault is a fake
 * and the key is synthetic; a mocked vault says nothing about native behaviour.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { Database } from 'src/ts/storage/database.svelte'
import type { Connection } from 'src/ts/connections/connections'
import { slotEditorValue, slotKeyTemporarilyUnavailable } from 'src/ts/connections/slotEditor'
import {
    installVaultHost, resetVaultStoreForTest, unwrapAllForBoot, type VaultHost,
} from 'src/ts/connections/keyVaultStore.svelte'
import KeyListInput from './KeyListInput.svelte'

const vault = vi.hoisted(() => ({ release: null as null | (() => void) }))

vi.mock('src/ts/android/keyVault', () => ({
    unwrapKey: vi.fn(() => new Promise((resolve) => {
        vault.release = () => resolve({ ok: true, value: 'SYNTH-KEY-1234' })
    })),
    wrapKey: vi.fn(() => new Promise(() => {})),
    watchdogFired: () => false,
}))

let app: Record<string, unknown> | undefined

beforeEach(() => {
    resetVaultStoreForTest()
    document.body.innerHTML = ''
})

afterEach(() => {
    if (app) {
        unmount(app)
        app = undefined
    }
    resetVaultStoreForTest()
})

describe('transient key hint', () => {
    test('shows for a wrapped key that is not decrypted yet and disappears once it is readable, with the plain in the field', async () => {
        const conns: Connection[] = $state([{ id: 'conn-1', name: 'o', provider: 'openai', key: '', keyWrapped: 'ENVELOPE' }])
        const db = { connections: conns } as unknown as Database
        const host: VaultHost = {
            platform: 'vault',
            findConnection: (id) => conns.find((conn) => conn.id === id),
            listConnections: () => conns,
            requestSaveNow: () => {},
            markBootWrite: () => {},
            isReadOnlyPage: () => false,
            notify: { keepPlain: () => {}, wrapped: () => {}, reentry: () => {} },
            messages: { keyUnavailable: () => 'unavailable' },
        }
        installVaultHost(host)
        const target = document.body.appendChild(document.createElement('div'))
        app = mount(KeyListInput, {
            target,
            props: {
                get unavailable() { return slotKeyTemporarilyUnavailable(db, 'openAIKey') },
                get value() { return slotEditorValue(db, 'openAIKey') },
                set value(_next: string) {},
            },
        })
        flushSync()
        const hintText = language.vaultKeyTemporarilyUnavailableHint
        expect(target.textContent).toContain(hintText)
        const input = () => target.querySelector('input') as HTMLInputElement
        expect(input().value).toBe('')

        const boot = unwrapAllForBoot()
        vault.release?.()
        await boot
        flushSync()
        expect(target.textContent).not.toContain(hintText)
        expect(input().value).toBe('SYNTH-KEY-1234')
    })
})
