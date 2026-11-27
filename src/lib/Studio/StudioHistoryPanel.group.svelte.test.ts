// @vitest-environment jsdom
/**
 * Regression reproducer for the History panel in a group visit: the real screen, panel, owner service and group adapter
 * on the memory doubles. A member step is listed with the member wording (never the lorebook wording), the panel is not
 * hidden for the group owner, Undo from the panel and the Undo shortcut both put the three parallel member arrays back.
 */
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
        clearCharEmotionCache: () => {},
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
// The real English texts: the member step texts take the member's name.
vi.mock('src/lang', async () => {
    const english = await import('src/lang/en')
    return { language: english.languageEnglish }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { buildAddMember, buildSetTalk } from 'src/ts/studio/edit/groupMembers'
import { makeCharacter, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { allRowsGeometry, setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { groupOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { arraysOf, GROUP_ID, loadedCharacter, makeGroup, type Arrays } from '../../ts/studio/history/tests/group.test-helpers'
import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import StudioScreen from './StudioScreen.svelte'

function fixtureDb() {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const world = [makeGroup(), loadedCharacter('A'), loadedCharacter('B'), loadedCharacter('C'), loadedCharacter('X')]
    return { ...base, characters: world }
}

const G = groupOwnerKey(GROUP_ID)
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const stubAck = { display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as unknown as SaveAck
const START: Arrays = { characters: ['A', 'B', 'C'], talks: [1 / 6, 2 / 6, 3 / 6], active: [true, false, true] }

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve(): void {}
    disconnect(): void {}
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
    setStudioEnabled(true)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    setWindowGeometryForTests(allRowsGeometry())
})

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    setWindowGeometryForTests(undefined)
    vi.unstubAllGlobals()
})

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

function makeService(): OwnerHistoryService {
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(stubAck)
    return service
}

// The Studio screen over the group, with the History panel opened by its toggle.
async function mountGroupPanel(service: OwnerHistoryService): Promise<void> {
    openStudio({ owner: { type: 'character', id: GROUP_ID }, from: 'chat' }, null)
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioScreen, { target: host, props: {} }), host })
    flushSync()
    await settle()
    await service.whenReady(G)
    part('studio-history-toggle')?.click()
    await settle()
}

const stepTexts = (): (string | undefined)[] =>
    parts('studio-history-step').map((row) => row.querySelector('span')?.textContent?.trim())

async function press(name: string): Promise<void> {
    const button = part(name) as HTMLButtonElement
    button.focus()
    button.click()
    flushSync()
    await settle()
    await settle()
}

async function ctrlZ(): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'z' })
    part('studio')!.dispatchEvent(event)
    flushSync()
    await settle()
    return event
}

describe('the History panel in a group visit', () => {
    test('is shown for the group owner and lists a member step with the member wording', async () => {
        const service = makeService()
        await mountGroupPanel(service)
        expect(part('studio-history')).not.toBeNull()
        expect(part('studio-history-none')).toBeNull()
        expect(service.objEdit(G, buildAddMember('X', 'Name X')).ok).toBe(true)
        expect(service.objEdit(G, buildSetTalk('A', 'Name A', 5 / 6)).ok).toBe(true)
        flushSync()
        await settle()
        expect(stepTexts()).toEqual([
            'Changed the talkativeness of "Name A"',
            'Added member "Name X"',
        ])
    })

    test('Undo from the panel restores the three arrays', async () => {
        const service = makeService()
        await mountGroupPanel(service)
        expect(service.objEdit(G, buildAddMember('X', 'Name X')).ok).toBe(true)
        flushSync()
        await settle()
        expect(arraysOf().characters).toEqual([...START.characters, 'X'])
        await press('studio-history-undo')
        expect(arraysOf()).toEqual(START)
        expect(service.view(G).undone).toHaveLength(1)
        expect(parts('studio-history-step').filter((row) => row.dataset.undone === 'true')).toHaveLength(1)
    })

    test('the Undo shortcut undoes a member step', async () => {
        const service = makeService()
        await mountGroupPanel(service)
        expect(service.objEdit(G, buildSetTalk('B', 'Name B', 5 / 6)).ok).toBe(true)
        flushSync()
        await settle()
        expect(arraysOf().talks[1]).toBe(5 / 6)
        expect((await ctrlZ()).defaultPrevented).toBe(true)
        expect(arraysOf()).toEqual(START)
        expect(service.view(G).done).toHaveLength(0)
    })
})
