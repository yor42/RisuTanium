// @vitest-environment jsdom
// The History panel names the greeting move, swap and append-many steps with their own texts; without an explicit
// case the step would show its raw label kind.
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
// The real English texts: the count text is a function of the step's count.
vi.mock('src/lang', async () => {
    const english = await import('src/lang/en')
    return { language: english.languageEnglish }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { languageEnglish } from 'src/lang/en'
import { makeCharacter, makeInput, residentModule, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { publishOpenModuleId, resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { resetStudioScreenForTests, setStudioHistoryOpen, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { createOwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, seedOwner } from '../../ts/studio/history/tests/studioStoreDoubles'
import { emptyRecord, type Step, type StepLabel } from '../../ts/studio/history/historyModel'
import StudioHistoryPanel from './StudioHistoryPanel.svelte'

function fixtureDb() {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    return { ...base, characters: [{ ...base.characters[0], desc: 'd0', alternateGreetings: ['g0'], chats: [] }] }
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
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    resetStudioHistoryAccessorForTests()
    resetOpenModuleIdForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    vi.unstubAllGlobals()
})

function stepOf(id: string, label: StepLabel): Step {
    return { id, at: 1, label, ops: [] }
}

describe('step labels of the greeting list steps', () => {
    test('move, swap and append-many show their own texts, and the count is interpolated', async () => {
        const shared = new Map<string, string>()
        seedOwner(
            shared,
            {
                ...emptyRecord(A, 1),
                done: [stepOf('s1', { kind: 'greetingMove' }), stepOf('s2', { kind: 'greetingSwap' }), stepOf('s3', { kind: 'greetingAddMany', count: 3 })],
            },
            'w:labels',
        )
        const clock = createFakeClock()
        const service = createOwnerHistoryService({
            store: createMemoryStudioStore({ shared }),
            claim: createClaimDouble(),
            clock,
            pageSession: 'p1',
            registerLeaveFlush: () => () => {},
        })
        setStudioHistoryServiceForTests(service)
        studioScreen.chaId = 'A'
        studioScreen.visitId = 'v1'
        studioScreen.open = true
        setStudioSelection(A, null, null)
        setStudioHistoryOpen(true)
        const host = document.createElement('div')
        document.body.appendChild(host)
        mounted.push({ app: mount(StudioHistoryPanel, { target: host, props: {} }), host })
        flushSync()
        await service.whenReady(A)
        await drainMicrotasks()
        flushSync()
        const texts =Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-history-step"]')).map((row) => row.querySelector('span')?.textContent?.trim())
        expect(texts).toEqual([languageEnglish.studioStepGreetingAddMany(3), languageEnglish.studioStepGreetingSwap, languageEnglish.studioStepGreetingMove])
        expect(texts).toEqual(['3 first messages added', 'Alternative first message swapped with the default first message', 'First message moved'])
    })
})

describe('T5-LABEL: step labels of the module fields', () => {
    test('each module path names its step with its own field label', async () => {
        db.db = { ...fixtureDb(), modules: [residentModule('M1', { name: 'Mod One' })] } as unknown as ReturnType<typeof fixtureDb>
        const M1 = moduleOwnerKey('M1')
        const fields = ['moduleName', 'moduleDescription', 'moduleNamespace', 'moduleHideIcon', 'moduleLowLevelAccess', 'backgroundEmbedding'] as const
        const shared = new Map<string, string>()
        seedOwner(shared, { ...emptyRecord(M1, 1), done: fields.map((field, index) => stepOf(`m${index}`, { kind: 'field', field })) }, 'w:module-labels')
        const service = createOwnerHistoryService({
            store: createMemoryStudioStore({ shared }),
            claim: createClaimDouble(),
            clock: createFakeClock(),
            pageSession: 'p1',
            registerLeaveFlush: () => () => {},
            openModuleId: () => 'M1',
        })
        setStudioHistoryServiceForTests(service)
        publishOpenModuleId('M1')
        studioScreen.chaId = 'A'
        studioScreen.visitId = 'v1'
        studioScreen.open = true
        setStudioSelection(M1, null, null)
        setStudioHistoryOpen(true)
        const host = document.createElement('div')
        document.body.appendChild(host)
        mounted.push({ app: mount(StudioHistoryPanel, { target: host, props: {} }), host })
        flushSync()
        await service.whenReady(M1)
        await drainMicrotasks()
        flushSync()
        const texts = Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-history-step"]')).map((row) => row.querySelector('span')?.textContent?.trim())
        expect(texts).toEqual([languageEnglish.backgroundHTML, languageEnglish.lowLevelAccess, languageEnglish.hideChatIcon, languageEnglish.namespace, languageEnglish.description, languageEnglish.name])
    })
})