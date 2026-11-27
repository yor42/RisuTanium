// @vitest-environment jsdom

/**
 * Regression test for #764: while a HypaV3 summary runs and a save-problem
 * alert button is also visible, the collapsed progress pill shifts below the
 * alert (`top-16` vs `top-3` + 40 px alert height) so both controls remain
 * visible and tappable without overlapping.
 *
 * MOCKED: `src/ts/stores.svelte`, `src/ts/globalApi.svelte`, and `src/ts/alert`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { FrozenSaveKeyInfo } from 'src/ts/stores.svelte'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { heldSaveStore } from 'src/ts/storage/saveHold'

vi.mock('src/ts/globalApi.svelte', () => {
    const saving = $state({ state: false })
    return { saving, getSavingStoppedDetail: () => '' } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock('src/ts/stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        hypaV3ProgressStore: writable({ open: false, miniMsg: '', msg: '', subMsg: '' }),
        savingStoppedReason: writable(''),
        peerWaitingStatus: writable(false),
        frozenSaveKeysStore: writable<FrozenSaveKeyInfo[]>([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

const { alertNormalSpy } = vi.hoisted(() => ({
    alertNormalSpy: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
    alertNormal: alertNormalSpy,
}))

import {
    DBState,
    frozenSaveKeysStore,
    hypaV3ProgressStore,
    peerWaitingStatus,
    savingStoppedReason,
} from 'src/ts/stores.svelte'
import HypaV3Progress from './HypaV3Progress.svelte'
import SavePopupIcon from './SavePopupIcon.svelte'

let mounted: Array<{ target: HTMLElement; apps: Array<Record<string, unknown>> }> = []

function mountBoth(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const saveApp = mount(SavePopupIcon, { target, props: {} }) as unknown as Record<string, unknown>
    const progressApp = mount(HypaV3Progress, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, apps: [saveApp, progressApp] })
    flushSync()
    return target
}

beforeEach(() => {
    DBState.db = {} as unknown as Database
    hypaV3ProgressStore.set({ open: true, miniMsg: '2/5', msg: 'Summarizing', subMsg: 'Chunk 2 of 5' })
    savingStoppedReason.set('')
    peerWaitingStatus.set(false)
    frozenSaveKeysStore.set([])
    heldSaveStore.set([])
    resetPageStorageModeForTests()
    alertNormalSpy.mockReset()
})

afterEach(async () => {
    for (const entry of mounted) {
        for (const app of entry.apps) {
            await unmount(app as never)
        }
        entry.target.remove()
    }
    mounted = []
})

describe('HypaV3Progress and SavePopupIcon coexistence (#764)', () => {
    test('keeps the pill at top-4 when no save-problem alert is shown', () => {
        const target = mountBoth()
        const pill = target.querySelector('[data-part="memory-progress-pill"]') as HTMLButtonElement
        expect(target.querySelector('[data-part="save-status-alert"]')).toBeNull()
        expect(pill.classList.contains('top-4')).toBe(true)
        expect(pill.classList.contains('top-16')).toBe(false)
    })

    test.each([
        ['read-only page', () => setPageStorageMode({ kind: 'read-only', reason: 'server-capability' }), () => resetPageStorageModeForTests()],
        ['savingStoppedReason', () => savingStoppedReason.set('node-conflict'), () => savingStoppedReason.set('')],
        ['frozenSaveKeysStore', () => frozenSaveKeysStore.set([{ chaId: 'dup-1', names: ['A', 'B'] }]), () => frozenSaveKeysStore.set([])],
        ['heldSaveStore', () => heldSaveStore.set([{ name: 'Alice', kind: 'unusable-id', archived: false }]), () => heldSaveStore.set([])],
    ])('shifts the progress pill below save-status-alert for %s and restores it when cleared', (_label, activate, clear) => {
        const target = mountBoth()
        activate()
        flushSync()

        const alertButton = target.querySelector('[data-part="save-status-alert"]') as HTMLButtonElement
        const pill = target.querySelector('[data-part="memory-progress-pill"]') as HTMLButtonElement
        expect(alertButton).not.toBeNull()
        expect(pill).not.toBeNull()
        expect(alertButton.classList.contains('top-3')).toBe(true)
        expect(pill.classList.contains('top-16')).toBe(true)
        expect(pill.classList.contains('top-4')).toBe(false)

        alertButton.click()
        flushSync()
        expect(alertNormalSpy).toHaveBeenCalledTimes(1)

        pill.click()
        flushSync()
        expect(target.querySelector('[data-part="memory-progress-card"]')).not.toBeNull()
        ;(target.querySelector('[data-part="memory-progress-card"]') as HTMLButtonElement).click()
        flushSync()

        clear()
        flushSync()
        const restoredPill = target.querySelector('[data-part="memory-progress-pill"]') as HTMLButtonElement
        expect(target.querySelector('[data-part="save-status-alert"]')).toBeNull()
        expect(restoredPill.classList.contains('top-4')).toBe(true)
        expect(restoredPill.classList.contains('top-16')).toBe(false)
    })
})
