// @vitest-environment jsdom

/**
 * The "connection used" row under a service key editor: the connection name with its masked hint, the
 * no-connection line, the unavailable and re-entry lines, and the always-present link to Connections.
 *
 * MOCKED: `stores.svelte` (DBState is a real `$state` object, navigation stores are writables). The
 * row, the hint, the key access and the vault store are real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'

vi.mock(import('../../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        SettingsMenuIndex: writable(-1),
    } as unknown as typeof import('../../../ts/stores.svelte')
})

import { language } from '../../../lang'
import type { ServiceSlot } from '../../../ts/connections/connections'
import { installVaultHost, resetVaultStoreForTest, type VaultPlatform } from '../../../ts/connections/keyVaultStore.svelte'
import { DBState } from '../../../ts/stores.svelte'
import Row from './ServiceConnectionRow.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function mountRow(service: ServiceSlot, connections: unknown[]): HTMLElement {
    DBState.db = { connections } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Row, { target, props: { service } }))
    flushSync()
    return target
}

function installPlatform(platform: VaultPlatform): void {
    installVaultHost({
        platform,
        findConnection: () => undefined,
        listConnections: () => [],
        requestSaveNow: () => {},
        markBootWrite: () => {},
        isReadOnlyPage: () => false,
        notify: { keepPlain: () => {}, wrapped: () => {}, reentry: () => {} },
        messages: { keyUnavailable: () => 'unavailable' },
    })
}

afterEach(async () => {
    for (const app of mounted.splice(0)) await unmount(app)
    document.body.innerHTML = ''
    resetVaultStoreForTest()
})

describe('ServiceConnectionRow', () => {
    test('E-ROW: names the connection, shows a masked hint and ends with the link', () => {
        const target = mountRow('elevenLabKey', [{ id: 'conn-1', name: 'ElevenLabs', provider: 'elevenlabs', key: 'SYN-eleven-key-1234' }])
        expect(target.textContent).toContain(language.connectionsServiceUses.replace('{name}', 'ElevenLabs'))
        expect(target.querySelector('[data-part="settings-service-connection-chip"]')).not.toBeNull()
        expect(target.textContent).not.toContain('SYN-eleven')
        expect(target.textContent).not.toContain('1234')
        expect(target.querySelector('[data-part="settings-service-connection"]')?.lastElementChild?.getAttribute('data-part')).toBe('settings-connections-link')
    })

    test('E-ROW: with no connection it says so and still links', () => {
        const target = mountRow('deeplOptions.key', [])
        expect(target.textContent).toContain(language.connectionsServiceNone)
        expect(target.querySelector('[data-part="settings-service-connection-uses"]')).toBeNull()
        expect(target.querySelector('[data-part="settings-connections-link"]')).not.toBeNull()
    })

    test('E-ROW: a wrapped key not readable yet shows the unavailable line, not an empty state', () => {
        installPlatform('vault')
        const target = mountRow('falToken', [{ id: 'conn-1', name: 'fal.ai', provider: 'fal', key: '', keyWrapped: 'SYN-ENVELOPE' }])
        expect(target.querySelector('[data-part="settings-service-connection-alert"]')?.textContent).toContain(language.vaultKeyTemporarilyUnavailableHint)
        expect(target.textContent).not.toContain('SYN-ENVELOPE')
        expect(target.querySelector('[data-part="settings-connections-link"]')).not.toBeNull()
    })

    test('E-ROW: a wrapped key this page can never read shows the re-entry line', () => {
        installPlatform('none')
        const target = mountRow('falToken', [{ id: 'conn-1', name: 'fal.ai', provider: 'fal', key: '', keyWrapped: 'SYN-ENVELOPE' }])
        expect(target.querySelector('[data-part="settings-service-connection-alert"]')?.textContent).toContain(language.vaultNeedsReentryLabel)
    })

    test('E-ROW: a connection with a blank key shows the missing-key line', () => {
        const target = mountRow('falToken', [{ id: 'conn-1', name: 'fal.ai', provider: 'fal', key: '' }])
        expect(target.querySelector('[data-part="settings-service-connection-alert"]')?.textContent).toContain(language.connectionsKeyMissingReason)
    })
})