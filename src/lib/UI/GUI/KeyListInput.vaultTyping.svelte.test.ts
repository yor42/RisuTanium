// @vitest-environment jsdom

/**
 * Typing into the real `KeyListInput` bound the way BotSettings binds it (getter `slotEditorValue`,
 * setter the un-awaited slot write) while the Keystore wrap is still held. The typed rows are kept
 * and the getter equals the typed value; releasing the wrap (swap to an envelope) or failing it
 * (keep-plain fallback) does not rebuild the rows. The vault is a fake and the keys are synthetic;
 * a mocked vault says nothing about native behaviour.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { Connection } from 'src/ts/connections/connections'
import { setSlotKey, slotEditorValue } from 'src/ts/connections/slotEditor'
import { installVaultHost, resetVaultStoreForTest, type VaultHost } from 'src/ts/connections/keyVaultStore.svelte'
import KeyListInput from './KeyListInput.svelte'

type Wrap = { ok: true, value: string } | { ok: false, code: 'other' }

const vault = vi.hoisted(() => ({
    held: [] as Array<(result: unknown) => void>,
    plains: new Map<string, string>(),
}))

vi.mock('src/ts/android/keyVault', () => ({
    wrapKey: vi.fn((plain: string) => new Promise((resolve) => {
        vault.held.push((result) => {
            const outcome = result as Wrap
            if (outcome.ok) {
                vault.plains.set(outcome.value, plain)
            }
            resolve(outcome)
        })
    })),
    unwrapKey: vi.fn(async (envelope: string) => {
        const plain = vault.plains.get(envelope)
        return plain === undefined ? { ok: false, code: 'unreadable' } : { ok: true, value: plain }
    }),
    watchdogFired: () => false,
}))

let app: Record<string, unknown> | undefined

beforeEach(() => {
    resetVaultStoreForTest()
    vault.held.length = 0
    vault.plains.clear()
    document.body.innerHTML = ''
})

afterEach(() => {
    if (app) {
        unmount(app)
        app = undefined
    }
    resetVaultStoreForTest()
})

function setup() {
    const conns: Connection[] = $state([{ id: 'conn-1', name: 'o', provider: 'openai', key: '' }])
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
            get value() { return slotEditorValue(db, 'openAIKey') },
            set value(next: string) { void setSlotKey(db, 'openAIKey', next) },
        },
    })
    flushSync()
    const inputs = () => [...target.querySelectorAll('input')] as HTMLInputElement[]
    const type = (index: number, text: string) => {
        const input = inputs()[index]
        input.value = text
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
    }
    return { conns, db, inputs, type }
}

async function drain() {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve()
    }
    flushSync()
}

describe('typing while the wrap is held', () => {
    test('rows are kept while held and after the wrap swaps in', async () => {
        const { conns, db, inputs, type } = setup()
        type(0, 'a')
        type(1, 'b')
        await drain()
        expect(inputs().map((input) => input.value)).toEqual(['a', 'b', ''])
        expect(slotEditorValue(db, 'openAIKey')).toBe('a\nb')
        expect(conns[0].key).toBe('')

        // The latest typed value is the one whose wrap matters; the first post is superseded.
        vault.held[0]({ ok: true, value: 'ENV-A' })
        await drain()
        vault.held[1]?.({ ok: true, value: 'ENV-AB' })
        await drain()
        expect(conns[0].keyWrapped).toBeDefined()
        expect(conns[0].key).toBe('')
        expect(slotEditorValue(db, 'openAIKey')).toBe('a\nb')
        expect(inputs().map((input) => input.value)).toEqual(['a', 'b', ''])
    })

    test('rows are unchanged when the wrap fails and the plain key is kept', async () => {
        const { conns, db, inputs, type } = setup()
        type(0, 'a')
        type(1, 'b')
        await drain()
        for (const release of vault.held) {
            release({ ok: false, code: 'other' })
            await drain()
        }
        expect(conns[0].key).toBe('a\nb')
        expect(conns[0].keyWrapped).toBeUndefined()
        expect(slotEditorValue(db, 'openAIKey')).toBe('a\nb')
        expect(inputs().map((input) => input.value)).toEqual(['a', 'b', ''])
    })
})
