// @vitest-environment jsdom
// T38s: the restore sheet's lorebook line and notes over a real history service, with every lorebook change recorded by
// the real builders of `loreListOps.ts`. The line carries `lines` to the service on the first Confirm and on the
// riskyConfirm retry, and a line the service refused is noticed after the sheet closes.
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
vi.mock('src/lang', async () => {
    const english = await import('src/lang/en')
    return { language: english.languageEnglish }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { languageEnglish } from 'src/lang/en'
import { trackedOf } from 'src/ts/studio/edit/loreListModel'
import { loreFieldEdit } from 'src/ts/studio/edit/loreListOps'
import { answerRiskyQuestion, riskyQuestion } from 'src/ts/studio/edit/riskyConfirm.svelte'
import { makeCharacter as makeStudioCharacter, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { resetStudioScreenForTests, setStudioHistoryOpen, setStudioRestoreSheetOpen, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, SAVE_DEBOUNCE_MS } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioRestoreSheet from './StudioRestoreSheet.svelte'

type LoreRow = Record<string, unknown>

function entry(comment: string): LoreRow {
    return { key: 'k', comment, content: `body of ${comment}`, mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, bookVersion: 2, id: `id-${comment}` }
}

function fixtureDb() {
    const base = studioDbOf(makeInput({ character: makeStudioCharacter({ chaId: 'A' }) }))
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: [], chats: [], globalLore: [entry('Ann'), entry('Bob')] }
    return { ...base, characters: [character] }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []
let clock: FakeClock
let store: MemoryStudioStore
let visit = 'v1'
let sessions = 0

function createService(shared?: Map<string, string>): OwnerHistoryService {
    store = createMemoryStudioStore({ shared })
    sessions += 1
    const service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: `p${sessions}`,
        getVisitId: () => visit,
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    return service
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    db.db = fixtureDb()
    selection.selId = 0
    clock = createFakeClock()
    visit = 'v1'
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

const list = (): LoreRow[] => db.db.characters[0].globalLore as unknown as LoreRow[]
const character = (): { desc: string } => db.db.characters[0] as unknown as { desc: string }
const part = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))

async function started(): Promise<OwnerHistoryService> {
    const service = createService()
    studioScreen.chaId = 'A'
    studioScreen.visitId = visit
    studioScreen.open = true
    setStudioSelection(A, null, null)
    await service.whenReady(A)
    return service
}

// One lorebook field edit through the real builder.
function editLore(service: OwnerHistoryService, index: number, value: string): void {
    const t = trackedOf(list(), index)
    if (t === null) throw new Error('no row')
    expect(service.objEdit(A, loreFieldEdit(t, index, 'comment', { had: true, value }, null).build).ok).toBe(true)
}

async function openSheet(service: OwnerHistoryService): Promise<void> {
    setStudioHistoryServiceForTests(service)
    setStudioHistoryOpen(true)
    setStudioRestoreSheetOpen(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioRestoreSheet, { target: host, props: {} }), host })
    flushSync()
    await drainMicrotasks()
    flushSync()
}

async function confirm(): Promise<void> {
    part('studio-restore-confirm')?.click()
    flushSync()
    await drainMicrotasks()
    flushSync()
}

const titles = (): string[] => list().map((row) => String(row.comment))

// ---------------------------------------------------------------- T38s

describe('T38s: the restore sheet carries the lorebook line', () => {
    test('(a) a lorebook-only visit shows one line and no field rows; Confirm reverts the list in one step', async () => {
        const service = await started()
        editLore(service, 0, 'Annie')
        const stepsBefore = service.view(A).done.length
        await openSheet(service)
        const lines = parts('studio-restore-line')
        expect(lines).toHaveLength(1)
        expect(lines[0].dataset.list).toBe('lore')
        expect(lines[0].textContent).toBe('Lorebook: undo 1 change')
        expect(part('studio-restore-fields')).toBeNull()
        await confirm()
        expect(titles()).toEqual(['Ann', 'Bob'])
        expect(service.view(A).done.length).toBe(stepsBefore + 1)
        expect(studioScreen.restoreSheetOpen).toBe(false)
        expect(studioScreen.notice).toBeNull()
    })

    test('(a) the line counts the journal entries and reads plural for more than one', async () => {
        const service = await started()
        editLore(service, 0, 'Annie')
        editLore(service, 1, 'Bobby')
        await openSheet(service)
        expect(parts('studio-restore-line').map((line) => line.textContent)).toEqual(['Lorebook: undo 2 changes'])
    })

    test('(d) a list changed outside is left as it is: the fields apply, the sheet closes and the notice says why', async () => {
        const service = await started()
        expect(service.editText(A, 'desc', 'edited').ok).toBe(true)
        editLore(service, 0, 'Annie')
        list()[0].content = 'changed outside'
        await openSheet(service)
        expect(parts('studio-restore-line')).toHaveLength(1)
        await confirm()
        expect(character().desc).toBe('d0')
        expect(list()[0].comment).toBe('Annie')
        expect(list()[0].content).toBe('changed outside')
        expect(studioScreen.restoreSheetOpen).toBe(false)
        expect(studioScreen.notice).toBe(languageEnglish.studioLoreRestoreChanged)
    })

    test('(g) a lorebook-only visit after a field visit: no field rows, and Confirm reverts only the list', async () => {
        const service = await started()
        expect(service.editText(A, 'desc', 'first visit').ok).toBe(true)
        visit = 'v2'
        studioScreen.visitId = 'v2'
        editLore(service, 0, 'Annie')
        await openSheet(service)
        expect(parts('studio-restore-field')).toHaveLength(0)
        expect(parts('studio-restore-line')).toHaveLength(1)
        await confirm()
        expect(titles()).toEqual(['Ann', 'Bob'])
        expect(character().desc).toBe('first visit')
    })

    test('(i) an earlier visit: the field rows show, no line, and the earlier-visit note says the list is not undone', async () => {
        const service = await started()
        editLore(service, 0, 'Annie')
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        visit = 'v2'
        studioScreen.visitId = 'v2'
        const second = createService(new Map(store.shared))
        await second.whenReady(A)
        expect(second.editText(A, 'desc', 'with a field').ok).toBe(true)
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        visit = 'v3'
        studioScreen.visitId = 'v3'
        const third = createService(new Map(store.shared))
        await third.whenReady(A)
        await openSheet(third)
        expect(parts('studio-restore-field').map((row) => row.dataset.path)).toContain('desc')
        expect(parts('studio-restore-line')).toHaveLength(0)
        const notes = parts('studio-restore-earlier-note')
        expect(notes).toHaveLength(1)
        expect(notes[0].dataset.list).toBe('lore')
        expect(notes[0].textContent).toBe(languageEnglish.studioLoreRestoreEarlierVisit)
    })

    test('(m) the riskyConfirm retry sends the confirmed flags and the lines read again at retry time', async () => {
        const real = await started()
        editLore(real, 0, 'Annie')
        const calls: { keep: string[]; options: unknown }[] = []
        // The first attempt is refused for a flag that needs a question; the second lands.
        const wrapped: OwnerHistoryService = {
            ...real,
            restore(owner, keep, options): StudioResult {
                calls.push({ keep: [...keep], options })
                return calls.length === 1 ? { ok: false, reason: 'riskyConfirm', paths: ['escapeOutput'] } : { ok: true }
            },
        }
        await openSheet(wrapped)
        expect(parts('studio-restore-line')).toHaveLength(1)
        part('studio-restore-confirm')?.click()
        flushSync()
        await drainMicrotasks()
        expect(riskyQuestion()).not.toBeNull()
        // While the question is open the list is reverted another way, so the visit has no line left to send.
        expect(real.restore(A, new Set(), { lines: ['lore'] }).ok).toBe(true)
        expect(real.view(A).restoreLines).toEqual([])
        answerRiskyQuestion(true)
        await drainMicrotasks()
        flushSync()
        expect(calls).toHaveLength(2)
        expect(calls[0].options).toEqual({ lines: ['lore'] })
        expect(calls[1].options).toEqual({ confirmed: ['escapeOutput'], lines: [] })
        expect(studioScreen.restoreSheetOpen).toBe(false)
    })

    test('(m) a retry with nothing changed meanwhile sends the same line again', async () => {
        const real = await started()
        editLore(real, 0, 'Annie')
        const calls: { options: unknown }[] = []
        const wrapped: OwnerHistoryService = {
            ...real,
            restore(_owner, _keep, options): StudioResult {
                calls.push({ options })
                return calls.length === 1 ? { ok: false, reason: 'riskyConfirm', paths: ['escapeOutput'] } : { ok: true }
            },
        }
        await openSheet(wrapped)
        part('studio-restore-confirm')?.click()
        flushSync()
        await drainMicrotasks()
        answerRiskyQuestion(true)
        await drainMicrotasks()
        flushSync()
        expect(calls.map((call) => call.options)).toEqual([{ lines: ['lore'] }, { confirmed: ['escapeOutput'], lines: ['lore'] }])
    })

    test('a refused restore shows the generic text, and an id-taken refusal its own sentence', async () => {
        const real = await started()
        editLore(real, 0, 'Annie')
        let next: StudioResult = { ok: false, reason: 'precondition' }
        const wrapped: OwnerHistoryService = { ...real, restore: () => next }
        await openSheet(wrapped)
        await confirm()
        expect(part('studio-restore-refusal')?.textContent).toBe(languageEnglish.studioRefusalPrecondition)
        next = { ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'idTaken' } }
        await confirm()
        expect(part('studio-restore-refusal')?.textContent).toBe(languageEnglish.studioLoreRestoreIdTaken)
        expect(studioScreen.restoreSheetOpen).toBe(true)
    })
})
