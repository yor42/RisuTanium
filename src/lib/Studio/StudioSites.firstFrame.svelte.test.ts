// @vitest-environment jsdom
/**
 * First-frame focus of the Studio sites that move focus after a state change: the search result pick, the tree
 * row menu, the character form's add-greeting button and the Retry button of both forms. Each must hold focus on
 * its target before the first animation frame after the action; requestAnimationFrame is a manual queue, so a
 * wait that needs a frame or a timer has not finished when the first frame reads the focus. Every one of these
 * sites moves focus; none scrolls.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

const db = $state({ db: {} as ReturnType<typeof studioDbOf> })
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
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import type { ChatSource } from 'src/ts/studio/ownerModel'
import { loreBody, makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { drainMicrotasks, installFrameQueue, readAtFirstFrame, runFrame, uninstallFrameQueue } from 'src/ts/tests/firstFrame.test-helpers'
import { createOwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryLoaderForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioCharacterForm from './StudioCharacterForm.svelte'
import StudioChatNoteForm from './StudioChatNoteForm.svelte'
import StudioScreen from './StudioScreen.svelte'
import StudioTree from './StudioTree.svelte'

interface LiveChat extends ChatSource {
    note: string
    fmIndex?: number
}

// The owner the screen, the tree and the search read.
function screenDb() {
    return studioDbOf(makeInput({
        character: makeCharacter({
            globalLore: [loreBody('Castle', 'the king lives here'), loreBody('Forest', 'tall trees and a king')],
            chats: [makeChat({ id: 'chat-1', name: 'First chat' })],
        }),
    }))
}

// The owner the two forms edit live.
function formDb() {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const chat: LiveChat = { ...makeChat({ id: 'c1', name: 'First chat' }), note: 'n0', fmIndex: 2 }
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: ['g0', 'g1', 'g2'], chats: [chat] }
    return { ...base, characters: [character] }
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const ownerTarget = { owner: { type: 'character', id: 'cha-1' }, from: 'chat' } as const

function makeAck(clock: FakeClock): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => h.marks,
        getCommittedMarkCount: () => 0,
        afterNextCommit: () => {},
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    return createSaveAck(deps)
}

let rigCount = 0

function installService(): void {
    const clock = createFakeClock()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock,
        pageSession: `p${++rigCount}`,
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
}

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(component, { target: host, props }), host })
    flushSync()
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

// Real time passes here, with the native frame callback: every wait the setup started has finished before the
// test installs its frame queue.
async function settleReal(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30))
    flushSync()
}

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect(): void {}
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))

// Runs the action with the frame queue installed and returns what `read` saw at the first frame after it.
async function atFirstFrame<T>(action: () => void, read: () => T): Promise<T> {
    installFrameQueue()
    const seen = readAtFirstFrame(read)
    action()
    flushSync()
    await drainMicrotasks()
    runFrame()
    return seen
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    selection.selId = 0
    setStudioEnabled(true)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(async () => {
    runFrame()
    uninstallFrameQueue()
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('StudioSearch: a picked result', () => {
    test('the Studio root holds focus at the first frame after Enter opens the first result', async () => {
        db.db = screenDb()
        openStudio(ownerTarget, null)
        mountInto(StudioScreen)
        await settleReal()
        part('studio-search-toggle')?.click()
        flushSync()
        const field = part('studio-search-input') as HTMLInputElement
        field.value = 'forest'
        field.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await vi.waitFor(() => {
            flushSync()
            expect(parts('studio-search-result')).toHaveLength(1)
        })
        field.focus()
        await settleReal()
        expect(document.activeElement).toBe(field)

        const active = await atFirstFrame(
            () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
            () => document.activeElement,
        )
        expect(studioScreen.searchOpen).toBe(false)
        expect(active).toBe(part('studio'))
    })
})

describe('StudioTree: the row menu', () => {
    test('the menu button holds focus at the first frame after Shift+F10 on a row', async () => {
        db.db = screenDb()
        openStudio(ownerTarget, null)
        mountInto(StudioTree)
        await settleReal()
        const lore = document.querySelector<HTMLElement>('[data-row-id="k:character:cha-1/lore"]')!
        lore.focus()
        await settleReal()

        const active = await atFirstFrame(
            () => lore.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })),
            () => document.activeElement,
        )
        expect(active).toBe(part('studio-row-menu-classic'))
    })
})

describe('StudioCharacterForm', () => {
    function mountForm(): void {
        db.db = formDb()
        studioScreen.chaId = 'A'
        studioScreen.visitId = 'v1'
        studioScreen.open = true
        mountInto(StudioCharacterForm, { chaId: 'A' })
    }

    test('the new first-message box holds focus at the first frame after Add', async () => {
        installService()
        mountForm()
        await settleReal()
        const before = parts('studio-greeting-input').length
        const add = part('studio-greeting-add')!
        add.focus()

        const active = await atFirstFrame(() => add.click(), () => document.activeElement)
        const inputs = parts('studio-greeting-input')
        expect(inputs).toHaveLength(before + 1)
        expect(active).toBe(inputs.at(-1))
    })

    test('a Retry that fails again returns with focus on the new Retry button at the first frame', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        setStudioHistoryServiceForTests(null)
        setStudioHistoryLoaderForTests(async () => {
            throw new Error('the service chunk could not be loaded')
        })
        mountForm()
        await settleReal()
        const retry = part('studio-history-retry') as HTMLButtonElement
        retry.focus()

        const active = await atFirstFrame(() => retry.click(), () => document.activeElement)
        expect(part('studio-history-retry')).not.toBeNull()
        expect(active).toBe(part('studio-history-retry'))
    })
})

describe('StudioChatNoteForm', () => {
    test('a Retry that fails again returns with focus on the new Retry button at the first frame', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        setStudioHistoryServiceForTests(null)
        setStudioHistoryLoaderForTests(async () => {
            throw new Error('the service chunk could not be loaded')
        })
        db.db = formDb()
        studioScreen.chaId = 'A'
        studioScreen.visitId = 'v1'
        studioScreen.open = true
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settleReal()
        const retry = part('studio-history-retry') as HTMLButtonElement
        retry.focus()

        const active = await atFirstFrame(() => retry.click(), () => document.activeElement)
        expect(part('studio-history-retry')).not.toBeNull()
        expect(active).toBe(part('studio-history-retry'))
    })
})
