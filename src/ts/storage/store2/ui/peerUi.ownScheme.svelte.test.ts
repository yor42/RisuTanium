// @vitest-environment node
/**
 * Every alert the peer UI raises to ask a data-losing question carries `ownScheme: 'saveGuard'`; the ones that
 * ask nothing (the checking wait, the export report) do not. The REAL `alert.ts` and `alertPrompts.ts` run against a
 * real `writable` standing in for `alertStore`. Every test is a compatibility guard: the flag is new, so none of them
 * fails for a defect that existed before it.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

//#endregion

import { changeLanguage } from 'src/lang'
import type { alertData } from 'src/ts/alert'
import { resetAlertPromptsForTests } from 'src/ts/alertPrompts'
import { alertStore } from 'src/ts/stores.svelte'
import type { ConflictRecord } from 'src/ts/storage/store2/fastForward/records'
import type { PeerParkPrompt } from 'src/ts/storage/store2/saveLoop'
import type { Staging } from 'src/ts/storage/store2/owner'
import { askForeignMarkerQuestion, createPeerUi, type PeerExportResult } from 'src/ts/storage/store2/ui/peerUi'

function shown(): alertData {
    return get(alertStore)
}

async function waitForType(type: alertData['type']): Promise<alertData> {
    await vi.waitFor(() => expect(shown().type).toBe(type))
    return shown()
}

const calm = () => ({ parked: true, dirty: false, drafts: false })
const cleanNow = async () => 'clean' as const

const prompt = (fields: Partial<PeerParkPrompt> & Pick<PeerParkPrompt, 'offers'>): PeerParkPrompt => ({
    reason: 'peer-commit',
    unsaved: true,
    ...fields,
})

beforeEach(() => {
    changeLanguage('en')
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
})

afterEach(() => {
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
})

describe('peer UI questions carry the save-guard flag', () => {
    test('askForeignMarkerQuestion', async () => {
        const marker: Staging = { owner: 'peer-page', prefix: 'prefix-1', startedAt: 1_700_000_000_000, label: 'bulk' }
        void askForeignMarkerQuestion(marker)
        expect((await waitForType('select')).ownScheme).toBe('saveGuard')
    })

    test('decide', async () => {
        const ui = createPeerUi({ reload: vi.fn() })
        void ui.decide(prompt({ offers: ['reload'] }))
        expect((await waitForType('select')).ownScheme).toBe('saveGuard')
    })

    test('resolve', async () => {
        const ui = createPeerUi({ reload: vi.fn() })
        const record: ConflictRecord = {
            id: 'presets',
            label: { kind: 'presets' },
            choices: ['mine', 'theirs', 'both'],
            keepBoth: null,
            preselect: 'mine',
            fingerprint: { mine: 'a', theirs: 'b' },
            legacy: 'presets',
        }
        void ui.resolve?.({ conflicts: [record] })
        const data = await waitForType('peerConflicts')
        expect(data.ownScheme).toBe('saveGuard')
    })

    test('parkedClean (askClean)', async () => {
        const ui = createPeerUi({ reload: vi.fn() })
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), calm, cleanNow)
        expect((await waitForType('select')).ownScheme).toBe('saveGuard')
    })

    test('exportThisTab hand-off prompt', async () => {
        const write = vi.fn(async (_manifestKey: string): Promise<PeerExportResult> => ({ status: 'saved', notices: [] }))
        const ui = createPeerUi({ reload: vi.fn(), exportAvailable: true, exportThisTab: write })
        void ui.exportThisTab?.('manifest-a')
        // The export report is a markdown alert that closes before the hand-off question shows.
        await waitForType('markdown')
        alertStore.set({ type: 'none', msg: '' })
        const data = await waitForType('select')
        expect(data.ownScheme).toBe('saveGuard')
    })

    test('moduleEdited (askModuleEdited)', async () => {
        const ui = createPeerUi({ reload: vi.fn() })
        ui.moduleEdited?.({ moduleId: 'mod-1', moduleName: 'Name' }, () => true)
        expect((await waitForType('select')).ownScheme).toBe('saveGuard')
    })

    test('the checking wait raises no flag', async () => {
        const ui = createPeerUi({ reload: vi.fn() })
        let settle: (verdict: 'clean') => void = () => { }
        const request = () => new Promise<'clean'>((resolve) => { settle = resolve })
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), calm, request)
        await waitForType('select')
        await new Promise<void>((resolve) => setTimeout(resolve, 400))
        alertStore.set({ type: 'none', msg: '0' })
        const wait = await waitForType('wait')
        expect('ownScheme' in wait).toBe(false)
        settle('clean')
    })
})
