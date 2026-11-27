// @vitest-environment jsdom
// The History panel over a real history service, with every lorebook step recorded by the real builders of
// `loreListOps.ts`: step texts per action, the preview of a deleted entry or folder, and the text of a restore the list
// rules refuse (the panel's Restore from History button and the delete toast's Undo say the same sentence).
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

const db = $state({ db: fixtureDb() })
const selection = $state({ selId: 0 })
const quickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const stores = {
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        sideBarStore: writable(false),
        frozenSaveKeysStore: writable([]),
    }
    return {
        ...stores,
        get DBState() { return db },
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
// The real English texts: the step texts take the entry's name and counts.
vi.mock('src/lang', async () => {
    const english = await import('src/lang/en')
    return { language: english.languageEnglish }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { languageEnglish } from 'src/lang/en'
import { trackedOf, type LoreTracked } from 'src/ts/studio/edit/loreListModel'
import {
    loreAddEntry,
    loreAddFolder,
    loreAlwaysActive,
    loreBulkActive,
    loreDelete,
    loreDeleteFolder,
    loreDuplicate,
    loreFieldEdit,
    loreMove,
    loreNewId,
    loreProbabilitySet,
    type LoreIds,
    type LoreOp,
} from 'src/ts/studio/edit/loreListOps'
import { buildLoreFlag } from 'src/ts/studio/edit/loreSettingsOps'
import { createStudioToasts } from 'src/ts/studio/edit/studioToasts'
import { makeCharacter as makeStudioCharacter, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { resetStudioScreenForTests, setStudioHistoryOpen, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { createToastHost, resetToastHostForTests, type ToastClock } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioHistoryPanel from './StudioHistoryPanel.svelte'

type LoreRow = Record<string, unknown>

function entry(comment: string, extra: LoreRow = {}): LoreRow {
    return { key: 'k', comment, content: `body of ${comment}`, mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, bookVersion: 2, ...extra }
}

function folder(key: string, comment: string): LoreRow {
    return entry(comment, { key, mode: 'folder', content: '' })
}

function worldRows(): LoreRow[] {
    return [
        entry('Ann', { id: 'id-a' }),
        entry('Bob', { id: 'id-a' }),
        folder('folder:f1', 'Fold'),
        entry('Kid', { folder: 'folder:f1' }),
        folder('folder:f2', 'Empty'),
    ]
}

function fixtureDb() {
    const base = studioDbOf(makeInput({ character: makeStudioCharacter({ chaId: 'A' }) }))
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: [], chats: [], globalLore: worldRows(), loreSettings: { tokenBudget: 100, scanDepth: 3, recursiveScanning: false } }
    return { ...base, characters: [character] }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    db.db = fixtureDb()
    selection.selId = 0
    setStudioEnabled(true)
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
})

afterEach(async () => {
    for (const item of mounted.splice(0)) {
        await unmount(item.app)
        item.host.remove()
    }
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetToastHostForTests()
    vi.unstubAllGlobals()
})

// ---------------------------------------------------------------- rig

function list(): LoreRow[] {
    return db.db.characters[0].globalLore as unknown as LoreRow[]
}

function tracked(comment: string): { t: LoreTracked; at: number } {
    const at = list().findIndex((row) => row.comment === comment)
    const t = trackedOf(list(), at)
    if (at < 0 || t === null) throw new Error(`no row ${comment}`)
    return { t, at }
}

const ids: LoreIds = { newId: (() => { let n = 0; return () => `fresh-${++n}` })(), newFolderKey: () => 'fresh-folder' }

function makeService(): OwnerHistoryService {
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    // Studio is open on the character, which is what lets an edit through.
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
    setStudioSelection(A, null, null)
    return service
}

function apply(service: OwnerHistoryService, op: LoreOp | LoreOp['build']): void {
    const result = service.objEdit(A, typeof op === 'function' ? op : op.build)
    expect(result.ok, JSON.stringify(result)).toBe(true)
}

async function mountPanel(service: OwnerHistoryService): Promise<void> {
    setStudioHistoryOpen(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioHistoryPanel, { target: host, props: {} }), host })
    flushSync()
    await service.whenReady(A)
    await drainMicrotasks()
    flushSync()
}

const stepTexts = (): (string | undefined)[] =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-history-step"]')).map((row) => row.querySelector('span')?.textContent?.trim())

const previews = (): (string | undefined)[] =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-history-deleted-item"]')).map((row) => row.querySelector('span')?.textContent?.trim())

// ---------------------------------------------------------------- TH1, TH2

describe('TH1: lorebook step texts per action', () => {
    test('every action of the list names its step; none shows the bare list name', async () => {
        const service = makeService()
        await service.whenReady(A)
        const ann = tracked('Ann')
        apply(service, loreNewId(tracked('Bob').t, tracked('Bob').at, ids))
        apply(service, loreFieldEdit(ann.t, ann.at, 'comment', { had: true, value: 'Annie' }, null))
        apply(service, loreProbabilitySet(tracked('Annie').t, tracked('Annie').at, 40, null))
        apply(service, loreDuplicate('character', tracked('Annie').t, tracked('Annie').at, ids))
        apply(service, loreMove(tracked('Annie').t, tracked('Annie').at, 'bottom'))
        apply(service, loreAddEntry(null, ids))
        apply(service, loreAddFolder(ids))
        apply(service, loreFieldEdit(tracked('Fold').t, tracked('Fold').at, 'comment', { had: true, value: 'Fold2' }, null))
        apply(service, loreAlwaysActive(tracked('Fold2').t, tracked('Fold2').at, true))
        apply(service, loreBulkActive(true))
        apply(service, buildLoreFlag('fullWordMatching', true))
        apply(service, loreDelete(tracked('Bob').t, tracked('Bob').at))
        apply(service, loreDeleteFolder(tracked('Empty').t, tracked('Empty').at))
        apply(service, loreDeleteFolder(tracked('Fold2').t, tracked('Fold2').at))
        await mountPanel(service)

        const unnamedLore = languageEnglish.sidebarUi.unnamedLore
        const unnamedFolder = languageEnglish.sidebarUi.unnamedFolder
        // Newest first.
        const texts = stepTexts()
        expect(texts.slice(0, 4)).toEqual(['Deleted folder "Fold2" and 1 item in it', 'Deleted folder "Empty"', 'Deleted "Bob"', 'Lorebook settings changed'])
        expect(texts[4]).toMatch(/^Changed always active of \d+ entr(y|ies)$/)
        expect(texts.slice(5)).toEqual([
            'Changed always active of folder "Fold2"',
            'Renamed folder to "Fold2"',
            `Added folder "${unnamedFolder}"`,
            `Added "${unnamedLore}"`,
            'Moved "Annie"',
            'Duplicated "Annie"',
            'Changed the probability of "Annie"',
            `Changed ${languageEnglish.name} of "Ann"`,
            'Gave "Bob" a new ID',
        ])
        // No step shows the bare list name any more.
        expect(texts).not.toContain(languageEnglish.loreBook)
    })

    test('a folder delete says how many items went with it (0, 1 and n)', async () => {
        list().splice(4, 0, entry('Kid2', { folder: 'folder:f1' }))
        const service = makeService()
        await service.whenReady(A)
        apply(service, loreDeleteFolder(tracked('Empty').t, tracked('Empty').at))
        apply(service, loreDeleteFolder(tracked('Fold').t, tracked('Fold').at))
        await mountPanel(service)
        expect(stepTexts()).toEqual(['Deleted folder "Fold" and 2 items in it', 'Deleted folder "Empty"'])
        list().push(folder('folder:f3', 'Solo'), entry('Only', { folder: 'folder:f3' }))
        apply(service, loreDeleteFolder(tracked('Solo').t, tracked('Solo').at))
        flushSync()
        expect(stepTexts()[0]).toBe('Deleted folder "Solo" and 1 item in it')
    })
})

describe('TH2: the preview of a deleted entry or folder', () => {
    test('a deleted entry shows its name; a folder shows its name and how many more went with it', async () => {
        const service = makeService()
        await service.whenReady(A)
        apply(service, loreDelete(tracked('Bob').t, tracked('Bob').at))
        apply(service, loreDeleteFolder(tracked('Fold').t, tracked('Fold').at))
        await mountPanel(service)
        // Newest first.
        expect(previews()).toEqual(['Fold and 1 more', 'Bob'])
        expect(previews()).not.toContain(languageEnglish.loreBook)
    })
})

// ---------------------------------------------------------------- TH3

describe('TH3: a restore the list rules refuse says why, in the panel and in the Undo toast', () => {
    // The deleted row's id is held again by a row added outside Studio, so putting it back would make a second holder.
    test('Restore from History shows the id-taken sentence and writes nothing', async () => {
        const service = makeService()
        await service.whenReady(A)
        const before = JSON.stringify(list())
        // Ann shares an id with Bob, so Bob is the deleted row whose identity another row still holds.
        apply(service, loreDelete(tracked('Bob').t, tracked('Bob').at))
        await mountPanel(service)
        const button = document.querySelector<HTMLButtonElement>('[data-part="studio-history-restore-item"]')
        expect(button).not.toBeNull()
        list().push(entry('Other', { id: 'id-a' }))
        const withTwin = JSON.stringify(list())
        button?.click()
        flushSync()
        expect(document.querySelector('[data-part="studio-history-message"]')?.textContent).toBe(languageEnglish.studioLoreRestoreIdTaken)
        expect(JSON.stringify(list())).toBe(withTwin)
        expect(before).not.toBe(withTwin)
    })

    test('the delete toast Undo, refused the same way, shows the same sentence', async () => {
        const service = makeService()
        await service.whenReady(A)
        apply(service, loreDelete(tracked('Bob').t, tracked('Bob').at))
        const [item] = service.view(A).deleted
        list().push(entry('Other', { id: 'id-a' }))
        const clock: ToastClock = { now: () => 0, after: () => () => {} }
        const host = createToastHost({ clock })
        const toasts = createStudioToasts({ service: () => service, host })
        await host.activate(toasts.postDeleted(A, item.id))
        expect(host.visible).toHaveLength(1)
        expect(host.visible[0].kind).not.toBe('success')
        expect(host.visible[0].text).toBe(languageEnglish.studioLoreRestoreIdTaken)
    })

    test('a lore delete undone from its toast logs the neutral restore line, and the success toast names lore', async () => {
        const service = makeService()
        await service.whenReady(A)
        apply(service, loreDelete(tracked('Kid').t, tracked('Kid').at))
        const [item] = service.view(A).deleted
        await mountPanel(service)
        const clock: ToastClock = { now: () => 0, after: () => () => {} }
        const host = createToastHost({ clock })
        const toasts = createStudioToasts({ service: () => service, host })
        await host.activate(toasts.postDeleted(A, item.id, languageEnglish.studioLoreDeleted('Kid'), languageEnglish.studioLoreToastRestored))
        await drainMicrotasks()
        flushSync()
        expect(host.visible.map((toast) => [toast.kind, toast.text])).toEqual([['success', languageEnglish.studioLoreToastRestored]])
        expect(stepTexts()[0]).toBe(languageEnglish.studioStepRestoreDeleted)
        expect(stepTexts()[0]).not.toMatch(/first message/i)
    })

    test('a refusal with no list rule keeps the generic text', async () => {
        const service = makeService()
        await service.whenReady(A)
        apply(service, loreDelete(tracked('Ann').t, tracked('Ann').at))
        const [item] = service.view(A).deleted
        const clock: ToastClock = { now: () => 0, after: () => () => {} }
        const host = createToastHost({ clock })
        const toasts = createStudioToasts({ service: () => service, host })
        // The list is gone from the character, which the service refuses without a list rule.
        ;(db.db.characters[0] as unknown as { globalLore: unknown }).globalLore = 'x'
        await host.activate(toasts.postDeleted(A, item.id))
        expect(host.visible[0].kind).not.toBe('success')
        expect(host.visible[0].text).not.toBe(languageEnglish.studioLoreRestoreIdTaken)
    })
})
