// @vitest-environment jsdom

/**
 * The Connections page over the real key-vault store and a fake vault: the key states of a wrapped
 * key (temporarily unavailable, needs re-entry) never read as "No key", and Back during a pending add
 * leaves one stored connection and closes nothing later. Synthetic keys and envelopes only.
 * MOCKED: the vault, the stores module (real `$state` DBState) and the toast host; a fake vault is
 * not evidence of native Keystore behaviour.
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        additionalSettingsMenu: [],
        easyPanelStore: { open: false },
        MobileGUI: writable(false),
        SettingsMenuIndex: writable(-1),
        settingsOpen: writable(false),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: vi.fn(), postUndoToast: vi.fn() }))

const fake = vi.hoisted(() => {
    const s = { hold: false, held: [] as Array<() => void> }
    return {
        s,
        wrapKey: vi.fn(async (plain: string) => {
            const result = { ok: true as const, value: 'ENV:' + plain }
            return s.hold ? new Promise<typeof result>((resolve) => { s.held.push(() => resolve(result)) }) : result
        }),
        unwrapKey: vi.fn(async (envelope: string) => ({ ok: true as const, value: envelope.slice(4) })),
        watchdogFired: () => false,
    }
})
vi.mock('src/ts/android/keyVault', () => ({
    wrapKey: fake.wrapKey,
    unwrapKey: fake.unwrapKey,
    watchdogFired: fake.watchdogFired,
}))

import { language } from '../../lang'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { storedConnections } from '../../ts/connections/connections'
import { needsKey } from '../../ts/connections/connectionEditor'
import { installVaultHost, resetVaultStoreForTest, type VaultPlatform } from '../../ts/connections/keyVaultStore.svelte'
import { setSettingsSubLevel } from '../../ts/settingsShell/settingsNavigation'
import { DBState } from '../../ts/stores.svelte'
import Page from './ConnectionsShellPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function part(name: string): HTMLElement {
    return document.querySelector<HTMLElement>(`[data-part="${name}"]`)!
}

function install(platform: VaultPlatform): void {
    installVaultHost({
        platform,
        findConnection: (id) => storedConnections(DBState.db).find((conn) => conn.id === id),
        listConnections: () => storedConnections(DBState.db),
        requestSaveNow: () => {},
        markBootWrite: () => {},
        isReadOnlyPage: () => false,
        notify: { keepPlain: () => {}, wrapped: () => {}, reentry: () => {} },
        messages: { keyUnavailable: () => 'unavailable' },
    })
}

function mountPage(): void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Page, { target }))
    flushSync()
}

beforeEach(() => {
    resetVaultStoreForTest()
    needsKey.clear()
    resetBackHandlersForTests()
    fake.s.hold = false
    fake.s.held.length = 0
    DBState.db = {
        connections: [{ id: 'conn-1', name: 'Sealed', provider: 'openai', key: '', keyWrapped: 'SYNTH-ENVELOPE' }],
        proxyConnectionId: '',
        botPresets: [],
        customModels: [],
    } as unknown as Database
})

afterEach(async () => {
    for (const app of mounted.splice(0)) {
        await unmount(app)
    }
    document.body.innerHTML = ''
    setSettingsSubLevel(null)
    resetBackHandlersForTests()
    resetVaultStoreForTest()
})

async function openDetail(): Promise<void> {
    document.querySelector<HTMLElement>('[data-connection-open="conn-1"]')!.click()
    await settle()
}

describe('wrapped key states on the page', () => {
    test('a temporarily unavailable key shows the unavailable hint on the card, not "No key"', () => {
        install('vault')
        mountPage()
        const card = part('connection-card').textContent ?? ''
        expect(card).toContain(language.vaultKeyTemporarilyUnavailableHint)
        expect(card).not.toContain(language.connectionsKeyMissingReason)
        expect(document.querySelector('[data-part="connection-chip"]')).toBeNull()
    })

    test('a key that needs re-entry shows the re-entry label on the card, not "No key"', () => {
        install('none')
        mountPage()
        const card = part('connection-card').textContent ?? ''
        expect(card).toContain(language.vaultNeedsReentryLabel)
        expect(card).not.toContain(language.connectionsKeyMissingReason)
    })

    test('the detail of an unavailable key offers Change key but no Clear, and opens no empty form', async () => {
        install('vault')
        mountPage()
        await openDetail()
        const detail = part('connection-key').textContent ?? ''
        expect(detail).toContain(language.vaultKeyTemporarilyUnavailableHint)
        expect(detail).not.toContain(language.connectionsKeyMissing)
        expect(document.querySelector('[data-part="connection-key-clear"]')).toBeNull()
        expect(document.querySelector('[data-part="connection-key-input"]')).toBeNull()
        expect(part('connection-key-replace')).not.toBeNull()
    })

    test('the detail of a re-entry key opens straight into Change key with the label, not "No key"', async () => {
        install('none')
        mountPage()
        await openDetail()
        const detail = part('connection-key').textContent ?? ''
        expect(detail).toContain(language.vaultNeedsReentryLabel)
        expect(detail).not.toContain(language.connectionsKeyMissing)
        expect(part('connection-key-input').querySelector('input')).not.toBeNull()
        expect(part('connection-key-save')).not.toBeNull()
    })
})

describe('Back during a pending add', () => {
    test('the stored add survives, Save is not stuck and the finished write closes nothing', async () => {
        DBState.db = { connections: [], proxyConnectionId: '', botPresets: [], customModels: [] } as unknown as Database
        install('vault')
        mountPage()
        part('connection-add-open').click()
        await settle()
        document.querySelector<HTMLElement>('[data-connection-provider="anthropic"]')!.click()
        await settle()
        const field = part('connection-key-input').querySelector('input')!
        field.value = 'sk-SYNTH-claude-4321'
        field.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        fake.s.hold = true
        part('connection-save').click()
        await settle()
        expect(storedConnections(DBState.db).map((conn) => conn.provider)).toEqual(['anthropic'])
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(document.querySelector('[data-part="connection-add"]')).toBeNull()
        // The user is somewhere else when the wrap finishes.
        document.querySelector<HTMLElement>('[data-connection-open="conn-1"]')!.click()
        await settle()
        fake.s.hold = false
        for (const release of fake.s.held.splice(0)) release()
        await settle()
        expect(document.querySelector('[data-part="connection-detail"]')).not.toBeNull()
        const [stored] = storedConnections(DBState.db)
        expect(stored.key).toBe('')
        expect(stored.keyWrapped).toBe('ENV:sk-SYNTH-claude-4321')
    })
})
