// @vitest-environment jsdom
/**
 * The History panel's lines for the asset steps the asset list makes: a delete that names its row and a rename that
 * names both of its names. The service is a stand-in that holds the steps; the panel is real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const db = $state({ db: { characters: [{ chaId: 'A', type: 'character', chats: [], chatPage: 0 }] } })
const selection = $state({ selId: 0 })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    MobileGUI: writable(false),
    settingsOpen: writable(false),
    ReloadGUIPointer: writable(0),
    CharConfigSubMenu: writable(0),
    SettingsMenuIndex: writable(-1),
    botMakerMode: writable(false),
    sideBarStore: writable(false),
    frozenSaveKeysStore: writable([]),
}))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = {}
    for (const key of ['studioStepAssetDeleteOne', 'studioStepAssetRename']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import type { Step, StepLabel } from 'src/ts/studio/history/historyModel'
import type { OwnerHistoryService, OwnerView } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from 'src/ts/studio/history/studioHistoryService.svelte'
import { resetStudioScreenForTests, setStudioHistoryOpen, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import StudioHistoryPanel from './StudioHistoryPanel.svelte'

const A = characterOwnerKey('A')

function stepOf(id: string, label: StepLabel): Step {
    return { id, at: 0, label, ops: [] }
}

function viewOf(done: Step[]): OwnerView {
    return { ownerKey: A, phase: 'ready', banner: null, restricted: false, editable: true, persisted: true, done, undone: [], deleted: [], restore: null }
}

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

function showSteps(done: Step[]): string[] {
    setStudioHistoryServiceForTests({
        useOwner: () => {},
        setAck: () => {},
        closeOpenStep: () => {},
        view: () => viewOf(done),
    } as unknown as OwnerHistoryService)
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioHistoryPanel, { target: host })
    flushSync()
    return Array.from(document.querySelectorAll('[data-part="studio-history-step"]')).map((row) => row.querySelector('span')?.textContent?.trim() ?? '')
}

beforeEach(() => {
    resetStudioScreenForTests()
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
    setStudioSelection(A, null, null)
    setStudioHistoryOpen(true)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
})

describe('the lines of the asset list\'s steps', () => {
    test('a delete of one named row says which row was deleted', () => {
        const lines = showSteps([stepOf('s1', { kind: 'assetDelete', count: 1, name: 'grin' })])
        expect(lines).toEqual(['studioStepAssetDeleteOne(grin)'])
    })

    test('a rename says the old and the new name', () => {
        const lines = showSteps([stepOf('s1', { kind: 'assetRename', from: 'smile', to: 'happy' })])
        expect(lines).toEqual(['studioStepAssetRename(smile,happy)'])
    })

    test('the lines come newest first beside the other steps', () => {
        const lines = showSteps([
            stepOf('s1', { kind: 'greetingAdd' }),
            stepOf('s2', { kind: 'assetRename', from: 'a', to: 'b' }),
            stepOf('s3', { kind: 'assetDelete', count: 1, name: 'b' }),
        ])
        expect(lines).toEqual(['studioStepAssetDeleteOne(b)', 'studioStepAssetRename(a,b)', 'studioStepGreetingAdd'])
    })

    test('a delete of several rows keeps the kind line until the bulk lists name it', () => {
        const lines = showSteps([stepOf('s1', { kind: 'assetDelete', count: 3, name: null })])
        expect(lines).toEqual(['assetDelete'])
    })
})
