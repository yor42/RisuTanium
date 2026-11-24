// @vitest-environment happy-dom

/**
 * `SavePopupIcon.svelte` marks its four save-problem buttons as one critical part (W1-T7d): each state renders exactly one button named
 * `save-status-alert` with the critical marker and its accessible name; the peer-wait line and the saving icon carry their own safe names.
 * Mocks are those of `SavePopupIcon.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { FrozenSaveKeyInfo } from '../../ts/stores.svelte'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { heldSaveStore } from 'src/ts/storage/saveHold'

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const saving = $state({ state: false })
    return { saving, getSavingStoppedDetail: () => '' } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        savingStoppedReason: writable(''),
        peerWaitingStatus: writable(false),
        frozenSaveKeysStore: writable<FrozenSaveKeyInfo[]>([]),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({ alertMd: vi.fn(), alertNormal: vi.fn() }) as unknown as typeof import('src/ts/alert'))

import { DBState, savingStoppedReason as savingStoppedReasonStore, peerWaitingStatus as peerWaitingStatusStore, frozenSaveKeysStore as frozenSaveKeysStoreMock } from '../../ts/stores.svelte'
import { saving } from 'src/ts/globalApi.svelte'
import { language } from '../../lang'
import SavePopupIcon from './SavePopupIcon.svelte'

async function withIcon(check: (target: HTMLElement) => void): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(SavePopupIcon, { target, props: {} })
    flushSync()
    try {
        check(target)
    } finally {
        await unmount(app)
        target.remove()
    }
}

function expectOneAlertButton(target: HTMLElement): void {
    const buttons = target.querySelectorAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('data-part')).toBe('save-status-alert')
    expect(buttons[0].hasAttribute('data-part-critical')).toBe(true)
    expect(buttons[0].getAttribute('aria-label')).toBe(language.savingIssueDetails)
    expect(target.querySelectorAll('[data-part="save-status-alert"]')).toHaveLength(1)
}

beforeEach(() => {
    saving.state = false
    savingStoppedReasonStore.set('')
    peerWaitingStatusStore.set(false)
    frozenSaveKeysStoreMock.set([])
    heldSaveStore.set([])
    DBState.db = {} as unknown as Database
    resetPageStorageModeForTests()
})

describe('SavePopupIcon overlay parts', () => {
    test('a read-only page renders the critical alert button', async () => {
        setPageStorageMode({ kind: 'read-only', reason: 'server-capability' })
        await withIcon(expectOneAlertButton)
    })

    test('a stopped save renders the critical alert button', async () => {
        setPageStorageMode({ kind: 'unset' })
        savingStoppedReasonStore.set('replaced')
        await withIcon(expectOneAlertButton)
    })

    test('a frozen save key renders the critical alert button', async () => {
        frozenSaveKeysStoreMock.set([{ chaId: 'dup-1', names: ['A', 'B'] }])
        await withIcon(expectOneAlertButton)
    })

    test('a held save renders the critical alert button', async () => {
        heldSaveStore.set([{ name: 'Alice', kind: 'unusable-id', archived: false }])
        await withIcon(expectOneAlertButton)
    })

    test('the peer-wait line is the safe save-status-note status text, not a critical part', async () => {
        peerWaitingStatusStore.set(true)
        await withIcon((target) => {
            const note = target.querySelector('[data-part="save-status-note"]')
            expect(note?.getAttribute('role')).toBe('status')
            expect(note?.hasAttribute('data-part-critical')).toBe(false)
            expect(target.querySelector('[data-part="save-status-alert"]')).toBeNull()
        })
    })

    test('the saving animation is the safe save-status-saving part', async () => {
        DBState.db = { showSavingIcon: true } as unknown as Database
        saving.state = true
        await withIcon((target) => {
            const icon = target.querySelector('[data-part="save-status-saving"]')
            expect(icon).not.toBeNull()
            expect(icon!.hasAttribute('data-part-critical')).toBe(false)
            expect(target.querySelector('[data-part="save-status-alert"]')).toBeNull()
        })
    })
})
