// @vitest-environment jsdom
/**
 * The History panel's lines for the asset steps the asset list makes: a delete that names its row, a rename that names
 * both of its names, and a line for every other kind of step, read back from a stored record the way a reload reads it.
 * The service is a stand-in that holds the steps; the panel is real.
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
    for (const key of [
        'studioStepAssetDeleteOne', 'studioStepAssetRename', 'studioStepAssetDeleteMany', 'studioStepAssetRemoveExtras', 'studioStepAssetMerge',
        'studioStepAssetMove', 'studioStepFolderRename', 'studioStepFolderDelete', 'studioStepAssetAdd', 'studioStepFolderCreate',
        'studioStepGreetingAddMany',
    ]) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { parseOwnerRecord, type Step, type StepLabel } from 'src/ts/studio/history/historyModel'
import type { OwnerHistoryService, OwnerView } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from 'src/ts/studio/history/studioHistoryService.svelte'
import { resetStudioScreenForTests, setStudioHistoryOpen, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import StudioHistoryPanel from './StudioHistoryPanel.svelte'

const A = characterOwnerKey('A')

function stepOf(id: string, label: StepLabel): Step {
    return { id, at: 0, label, ops: [] }
}

function viewOf(done: Step[], deleted: OwnerView['deleted'] = []): OwnerView {
    return { ownerKey: A, phase: 'ready', banner: null, restricted: false, editable: true, persisted: true, done, undone: [], deleted, restore: null, restoreLines: [], restoreNotes: [] }
}

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

function showSteps(done: Step[], deleted: OwnerView['deleted'] = []): string[] {
    setStudioHistoryServiceForTests({
        useOwner: () => {},
        setAck: () => {},
        closeOpenStep: () => {},
        view: () => viewOf(done, deleted),
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

    test('a delete of several rows says how many rows went', () => {
        const lines = showSteps([stepOf('s1', { kind: 'assetDelete', count: 3, name: null })])
        expect(lines).toEqual(['studioStepAssetDeleteMany(3)'])
    })
})

// One label of every kind the step union has, with the line each must show. Keyed by kind, so a kind added to the union
// without a row here fails the type check.
const everyLabel: { [K in StepLabel['kind']]: { labels: StepLabel[], lines: string[] } } = {
    field: {
        labels: [
            { kind: 'field', field: 'desc' }, { kind: 'field', field: 'firstMessage' }, { kind: 'field', field: 'exampleMessage' },
            { kind: 'field', field: 'customModuleToggle' }, { kind: 'field', field: 'hideChatIcon' }, { kind: 'field', field: 'note' },
        ],
        lines: ['description', 'firstMessage', 'exampleMessage', 'customPromptTemplateToggle', 'hideChatIcon', 'note'],
    },
    greetingAdd: { labels: [{ kind: 'greetingAdd' }], lines: ['studioStepGreetingAdd'] },
    greetingRemove: { labels: [{ kind: 'greetingRemove' }], lines: ['studioStepGreetingRemove'] },
    greetingEdit: { labels: [{ kind: 'greetingEdit' }], lines: ['studioStepGreetingEdit'] },
    greetingMove: { labels: [{ kind: 'greetingMove' }], lines: ['studioStepGreetingMove'] },
    greetingSwap: { labels: [{ kind: 'greetingSwap' }], lines: ['studioStepGreetingSwap'] },
    greetingAddMany: { labels: [{ kind: 'greetingAddMany', count: 2 }], lines: ['studioStepGreetingAddMany(2)'] },
    restorePoint: { labels: [{ kind: 'restorePoint' }], lines: ['studioStepRestorePoint'] },
    revert: { labels: [{ kind: 'revert', toStepId: 's0' }], lines: ['studioStepRevert'] },
    restoreDeleted: { labels: [{ kind: 'restoreDeleted', deletedId: 'd1' }], lines: ['studioStepRestoreDeleted'] },
    assetDelete: {
        labels: [{ kind: 'assetDelete', count: 1, name: 'grin' }, { kind: 'assetDelete', count: 4, name: null }],
        lines: ['studioStepAssetDeleteOne(grin)', 'studioStepAssetDeleteMany(4)'],
    },
    assetRemoveExtras: { labels: [{ kind: 'assetRemoveExtras', count: 2, name: 'smile' }], lines: ['studioStepAssetRemoveExtras(2,smile)'] },
    assetMerge: { labels: [{ kind: 'assetMerge', from: 'old', to: 'kept' }], lines: ['studioStepAssetMerge(old,kept)'] },
    assetRename: { labels: [{ kind: 'assetRename', from: 'a', to: 'b' }], lines: ['studioStepAssetRename(a,b)'] },
    assetMove: {
        labels: [{ kind: 'assetMove', count: 2, folder: 'Faces' }, { kind: 'assetMove', count: 1, folder: null }],
        lines: ['studioStepAssetMove(2,Faces)', 'studioStepAssetMove(1,studioAssetNoFolder)'],
    },
    folderRename: { labels: [{ kind: 'folderRename', from: 'F', to: 'G' }], lines: ['studioStepFolderRename(F,G)'] },
    folderDelete: { labels: [{ kind: 'folderDelete', name: 'F' }], lines: ['studioStepFolderDelete(F)'] },
    assetAdd: { labels: [{ kind: 'assetAdd', count: 3 }], lines: ['studioStepAssetAdd(3)'] },
    folderCreate: { labels: [{ kind: 'folderCreate', name: 'New' }], lines: ['studioStepFolderCreate(New)'] },
    folderReorder: { labels: [{ kind: 'folderReorder' }], lines: ['studioStepFolderReorder'] },
    // Interim line until the lore list UI names these steps.
    obj: { labels: [{ kind: 'obj', list: 'lore', action: 'edit', name: null, field: 'content' }], lines: ['loreBook'] },
    prop: { labels: [{ kind: 'prop', prop: 'loreSettings' }], lines: ['loreBook'] },
}

describe('the line of every kind of step, after a reload', () => {
    const labels = Object.values(everyLabel).flatMap((entry) => entry.labels)
    const expected = Object.values(everyLabel).flatMap((entry) => entry.lines)

    // The record as the store holds it and a reload reads it: serialised, parsed, and checked by the strict reader.
    function reloadedSteps(): Step[] {
        const stored = { ownerKey: A, touchedAt: 1, done: labels.map((label, index) => ({ id: `s${index}`, at: index, label, ops: [] })), undone: [], deleted: [], restore: null }
        const record = parseOwnerRecord(JSON.parse(JSON.stringify(stored)), A)
        if (record === null) throw new Error('the stored record did not read back')
        return record.done
    }

    test('each label reads back and shows its own line, never the kind', () => {
        const lines = showSteps(reloadedSteps())
        // The panel lists the newest step first.
        expect(lines).toEqual([...expected].reverse())
        for (const kind of Object.keys(everyLabel)) expect(lines).not.toContain(kind)
    })

    test('an asset step puts nothing in the deleted first messages', () => {
        showSteps(reloadedSteps())
        expect(document.querySelectorAll('[data-part="studio-history-deleted-item"]')).toHaveLength(0)
        expect(document.querySelector('[data-part="studio-history-deleted-empty"]')).not.toBeNull()
    })
})
