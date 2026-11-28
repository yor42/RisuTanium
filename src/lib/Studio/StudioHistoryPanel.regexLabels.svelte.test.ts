// @vitest-environment jsdom
// The History panel over a real history service, with the regex steps recorded by the real builders of `regexListOps.ts`:
// the step text names the regex field and the script (or the unnamed fallback) and never takes the lorebook's wording, while
// the lorebook steps keep their own text.
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
// The real English texts: the step texts take the script's name and the field.
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
import { regexCustomFlag, regexFieldEdit, regexStageEdit } from 'src/ts/studio/edit/regexListOps'
import { regexStepText } from 'src/ts/studio/edit/objListCopy'
import { makeCharacter as makeStudioCharacter, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { resetStudioScreenForTests, setStudioHistoryOpen, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type ObjBuildResult, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioHistoryPanel from './StudioHistoryPanel.svelte'

type Row = Record<string, unknown>

function fixtureDb() {
    const base = studioDbOf(makeInput({ character: makeStudioCharacter({ chaId: 'A' }) }))
    const lore: Row[] = [{ key: 'k', comment: 'Ann', content: 'body', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, bookVersion: 2 }]
    const regex: Row[] = [
        { comment: 'Alpha', in: 'a', out: 'b', type: 'editinput' },
        { comment: '', in: 'c', out: 'd', type: 'editoutput' },
    ]
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: [], chats: [], globalLore: lore, customscript: regex }
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

function makeService(): OwnerHistoryService {
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
    setStudioSelection(A, null, null)
    return service
}

function apply(service: OwnerHistoryService, build: (id: string, live: Parameters<Parameters<OwnerHistoryService['objEdit']>[1]>[1]) => ObjBuildResult): void {
    const result = service.objEdit(A, build)
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

describe('T24: regex step texts', () => {
    test('a named and an unnamed script read as regex steps, never as lorebook steps', async () => {
        const service = makeService()
        await service.whenReady(A)
        apply(service, regexFieldEdit(0, 'comment', 'Beta', null).build)
        apply(service, regexFieldEdit(1, 'in', 'found', null).build)
        apply(service, regexStageEdit(1, 'editdisplay').build)
        apply(service, regexCustomFlag(0, true).build)
        await mountPanel(service)

        const unnamed = languageEnglish.sidebarUi.unnamedScript
        // Newest first.
        expect(stepTexts()).toEqual([
            `Changed ${languageEnglish.customFlags} of "Beta"`,
            `Changed ${languageEnglish.studioRegexStage} of "${unnamed}"`,
            `Changed ${languageEnglish.studioRegexFind} of "${unnamed}"`,
            `Changed ${languageEnglish.name} of "Alpha"`,
        ])
        for (const text of stepTexts()) expect(text).not.toContain(languageEnglish.sidebarUi.unnamedLore)
    })

    test('a list action reads as that action on the named script, never the lorebook wording', async () => {
        const service = makeService()
        await service.whenReady(A)
        // A move label on a stage step: the step text is the regex move text.
        apply(service, (id, live) => {
            const built = regexStageEdit(0, 'editdisplay').build(id, live)
            return built.ok ? { ...built, label: { ...built.label, action: 'move' } } : built
        })
        await mountPanel(service)
        expect(stepTexts()).toEqual(['Moved "Alpha"'])
        expect(regexStepText({ kind: 'obj', list: 'regex', action: 'move', name: null })).toBe(`Moved "${languageEnglish.sidebarUi.unnamedScript}"`)
    })

    test('an import label with a count reads as the regex import step', async () => {
        const service = makeService()
        await service.whenReady(A)
        apply(service, (id, live) => {
            const built = regexStageEdit(0, 'editdisplay').build(id, live)
            return built.ok ? { ...built, label: { ...built.label, action: 'import', count: 3 } } : built
        })
        await mountPanel(service)
        expect(stepTexts()).toEqual([languageEnglish.studioRegexStepImport(3)])
        expect(regexStepText({ kind: 'obj', list: 'regex', action: 'import', count: 3, name: null })).toBe(languageEnglish.studioRegexStepImport(3))
    })

    test('a lorebook edit in the same history keeps the lorebook wording', async () => {
        const service = makeService()
        await service.whenReady(A)
        const list = db.db.characters[0].globalLore as unknown as Row[]
        const tracked = trackedOf(list, 0)
        if (tracked === null) throw new Error('no lore row')
        apply(service, loreFieldEdit(tracked, 0, 'comment', { had: true, value: '' }, null).build)
        apply(service, regexFieldEdit(0, 'comment', 'Beta', null).build)
        await mountPanel(service)
        expect(stepTexts()).toEqual([`Changed ${languageEnglish.name} of "Alpha"`, `Changed ${languageEnglish.name} of "Ann"`])
    })
})
