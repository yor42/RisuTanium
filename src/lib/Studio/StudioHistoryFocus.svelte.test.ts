// @vitest-environment jsdom
/**
 * Where focus lands after a History action in Studio: the real history service on the memory doubles, mounted
 * inside the Studio screen with the History panel open. "Settle" awaits resolved promises on one fake clock.
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

import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import type { ChatSource } from 'src/ts/studio/ownerModel'
import { makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioScreen from './StudioScreen.svelte'

interface LiveChat extends ChatSource {
    note: string
    fmIndex?: number
}

interface Live {
    desc: string
    hideChatIcon?: boolean
    license?: string
    type?: string
    alternateGreetings: string[]
    chats: LiveChat[]
}

function fixtureDb(patch: Partial<Live> = {}) {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const chat: LiveChat = { ...makeChat({ id: 'c1', name: 'First chat' }), note: 'n0', fmIndex: 2 }
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: ['g0', 'g1', 'g2'], ...patch, chats: patch.chats ?? [chat] }
    return { ...base, characters: [character] }
}

const A = characterOwnerKey('A')
const CHAT = chatOwnerKey('A', 'c1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const basicTarget = { owner: { type: 'character', id: 'A' }, kind: 'basic', item: 'A/basic:0', from: 'chat' } as const

// ---------------------------------------------------------------- rigs

function makeAck(clock: FakeClock): SaveAck {
    const committed = 0
    const deps: SaveAckDeps = {
        getMarkCount: () => h.marks,
        getCommittedMarkCount: () => committed,
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

interface Rig {
    service: OwnerHistoryService
}

let rigCount = 0

function makeRig(): Rig {
    const clock = createFakeClock()
    const store = createMemoryStudioStore({})
    const claim = createClaimDouble()
    const service = createOwnerHistoryService({ store, claim, clock, pageSession: `p${++rigCount}`, registerLeaveFlush: () => () => {} })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return { service }
}

// ---------------------------------------------------------------- dom helpers

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(component, { target: host, props })
    mounted.push({ app, host })
    flushSync()
    return host
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

async function settle(): Promise<void> {
    await drainMicrotasks()
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

function click(name: string): void {
    part(name)?.click()
    flushSync()
}

function live() {
    return db.db.characters[0]
}

// Edits that stay separate steps: a pause is not needed because each one closes the open step.
function edit(rig: Rig, text: string): void {
    expect(rig.service.editField(A, 'desc', text).ok).toBe(true)
    rig.service.closeOpenStep(A)
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
})

afterEach(async () => {
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.unstubAllGlobals()
})

// ---------------------------------------------------------------- focus after a History action

const inputs = () => parts('studio-greeting-input') as HTMLTextAreaElement[]

function narrow(width: number): void {
    class Narrow {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(): void {
            this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
        }
        disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', Narrow)
}

async function screenWithPanel(options: { width?: number; patch?: Partial<Live> } = {}): Promise<Rig> {
    if (options.patch) db.db = fixtureDb(options.patch)
    if (options.width !== undefined) narrow(options.width)
    const rig = makeRig()
    openStudio(basicTarget, null)
    mountInto(StudioScreen)
    await settle()
    click('studio-history-toggle')
    await settle()
    return rig
}

// A press as a pointer makes it: the control takes focus, then the click runs.
async function press(name: string): Promise<HTMLElement> {
    const button = part(name) as HTMLButtonElement
    button.focus()
    button.click()
    flushSync()
    await settle()
    await settle()
    return button
}

async function confirmRestorePoint(): Promise<void> {
    await press('studio-history-restore-open')
    expect(part('studio-restore-sheet')).not.toBeNull()
    await press('studio-restore-confirm')
    expect(part('studio-restore-sheet')).toBeNull()
}

function keyOn(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    flushSync()
    return event
}

describe('F: focus lands on the first message an Undo, Redo or Restore put back or changed', () => {
    test('F1 Undo of a delete focuses the restored row', async () => {
        const rig = await screenWithPanel()
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        flushSync()
        await press('studio-history-undo')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(document.activeElement).toBe(inputs()[1])
        expect(inputs()[1].value).toBe('g1')
    })

    test('F2 Redo of a delete focuses the row that took the slot', async () => {
        const rig = await screenWithPanel()
        edit(rig, 'e1')
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        expect(rig.service.undo(A).ok).toBe(true)
        flushSync()
        await press('studio-history-redo')
        expect(live().alternateGreetings).toEqual(['g0', 'g2'])
        expect(document.activeElement).toBe(inputs()[1])
        expect(inputs()[1].value).toBe('g2')
    })

    test('F3 Restore deleted focuses the restored row, never the body', async () => {
        const rig = await screenWithPanel()
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        flushSync()
        await press('studio-history-restore-item')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(document.activeElement).not.toBe(document.body)
        expect(document.activeElement).toBe(inputs()[1])
        expect(inputs()[1].value).toBe('g1')
    })

    test('F4 a restore point focuses the row it put back, not the Restore button', async () => {
        const rig = await screenWithPanel()
        expect(rig.service.greetingEdit(A, 2, 'changed').ok).toBe(true)
        rig.service.closeOpenStep(A)
        flushSync()
        await confirmRestorePoint()
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(document.activeElement).toBe(inputs()[2])
        expect(inputs()[2].value).toBe('g2')
    })

    test('F5 Undo of an add focuses the row before the removed one', async () => {
        const rig = await screenWithPanel()
        expect(rig.service.greetingAdd(A).ok).toBe(true)
        flushSync()
        expect(inputs()).toHaveLength(4)
        await press('studio-history-undo')
        expect(inputs()).toHaveLength(3)
        expect(document.activeElement).toBe(inputs()[2])
    })

    test('F5b Undo of the only add focuses the Add button', async () => {
        const rig = await screenWithPanel({ patch: { alternateGreetings: [] } })
        expect(rig.service.greetingAdd(A).ok).toBe(true)
        flushSync()
        await press('studio-history-undo')
        expect(inputs()).toHaveLength(0)
        expect(document.activeElement).toBe(part('studio-greeting-add'))
    })

    test('F6 when several rows and the description changed, the first changed row wins', async () => {
        const rig = await screenWithPanel()
        expect(rig.service.greetingEdit(A, 2, 'x2').ok).toBe(true)
        rig.service.closeOpenStep(A)
        expect(rig.service.greetingEdit(A, 0, 'x0').ok).toBe(true)
        rig.service.closeOpenStep(A)
        edit(rig, 'x-desc')
        flushSync()
        await confirmRestorePoint()
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(live().desc).toBe('d0')
        expect(document.activeElement).toBe(inputs()[0])
    })

    test('F7 an Undo that changed only the description focuses the description', async () => {
        const rig = await screenWithPanel()
        edit(rig, 'e1')
        edit(rig, 'e2')
        flushSync()
        await press('studio-history-undo')
        expect(live().desc).toBe('e1')
        expect(document.activeElement).toBe(part('studio-form-desc'))
    })

    test('F17 an Undo that changed only the hide-icon box focuses the hide-icon box', async () => {
        const rig = await screenWithPanel()
        expect(rig.service.editField(A, 'hideChatIcon', true).ok).toBe(true)
        rig.service.closeOpenStep(A)
        flushSync()
        await press('studio-history-undo')
        expect(live().hideChatIcon).not.toBe(true)
        const box = document.querySelector<HTMLElement>('[data-part="studio-character-form"] [data-part="studio-form-hide-icon"]')
        expect(box).not.toBeNull()
        expect(document.activeElement).toBe(box)
    })

    test('F8 a refused Undo leaves focus on Undo and says why (guard)', async () => {
        const rig = await screenWithPanel()
        edit(rig, 'e1')
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        live().alternateGreetings.length = 0
        live().chats[0].fmIndex = 5
        flushSync()
        const undo = await press('studio-history-undo')
        expect(part('studio-history-message')?.textContent).toBe('studioRefusalPrecondition')
        expect(document.activeElement).toBe(undo)
    })

    test('F9 with no form on screen, focus goes to the panel, never the body', async () => {
        const rig = await screenWithPanel({ width: 400 })
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        studioScreen.detailShown = false
        flushSync()
        expect(part('studio-character-form')).toBeNull()
        await press('studio-history-restore-item')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(document.activeElement).toBe(part('studio-history'))
    })

    test('F10 the chat note: Undo focuses the note box', async () => {
        const rig = await screenWithPanel()
        setStudioSelection('chat:c1', null, null)
        flushSync()
        await settle()
        expect(part('studio-form-note')).not.toBeNull()
        expect(rig.service.editField(CHAT, 'note', 'n1').ok).toBe(true)
        rig.service.closeOpenStep(CHAT)
        expect(rig.service.editField(CHAT, 'note', 'n2').ok).toBe(true)
        rig.service.closeOpenStep(CHAT)
        flushSync()
        await press('studio-history-undo')
        expect(live().chats[0].note).toBe('n1')
        expect(document.activeElement).toBe(part('studio-form-note'))
    })

    test('F11 Ctrl+Z from the Studio root focuses the restored row, and Ctrl+Z goes on from there', async () => {
        const rig = await screenWithPanel()
        click('studio-history-close')
        edit(rig, 'e1')
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        flushSync()
        const root = part('studio') as HTMLElement
        root.focus()
        expect(keyOn(root, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true)
        await settle()
        expect(document.activeElement).toBe(inputs()[1])
        expect(inputs()[1].dataset.studioFocusValue).toBe('g1')
        expect(keyOn(inputs()[1], { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true)
        await settle()
        expect(live().desc).toBe('d0')
        expect(document.activeElement).toBe(part('studio-form-desc'))
    })

    test('F12 a revert focuses the first row it put back', async () => {
        const rig = await screenWithPanel()
        edit(rig, 'e1')
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        flushSync()
        await press('studio-history-revert')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(document.activeElement).toBe(inputs()[1])
    })

    test('F13 the phone layout: the box behind the open panel takes focus and the panel stays open', async () => {
        const rig = await screenWithPanel({ width: 400 })
        expect(studioScreen.layout).toBe('stack')
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        flushSync()
        await press('studio-history-undo')
        expect(part('studio-history')).not.toBeNull()
        expect(document.activeElement).toBe(inputs()[1])
    })

    test('F14 Cancel, Back and Escape on Cancel still return focus to the Restore button (guard)', async () => {
        const rig = await screenWithPanel()
        edit(rig, 'e1')
        flushSync()
        for (const close of [
            () => click('studio-restore-cancel'),
            () => { dispatchBack(); flushSync() },
            () => keyOn(part('studio-restore-cancel')!, { key: 'Escape' }),
        ]) {
            await press('studio-history-restore-open')
            expect(document.activeElement).toBe(part('studio-restore-cancel'))
            close()
            await settle()
            await settle()
            expect(part('studio-restore-sheet')).toBeNull()
            expect(document.activeElement).toBe(part('studio-history-restore-open'))
        }
    })

    test('F15 Escape while focus is outside the sheet leaves focus where it is', async () => {
        const rig = await screenWithPanel()
        edit(rig, 'e1')
        flushSync()
        await press('studio-history-restore-open')
        const field = part('studio-form-desc') as HTMLTextAreaElement
        field.focus()
        keyOn(field, { key: 'Escape' })
        await settle()
        await settle()
        expect(part('studio-restore-sheet')).toBeNull()
        expect(document.activeElement).toBe(field)
    })

    test('F16 a Confirm that cannot change anything is refused: the sheet stays and focus stays on Confirm (guard)', async () => {
        const rig = await screenWithPanel()
        edit(rig, 'e1')
        // The description was changed outside Studio's history, so the sheet keeps it by default; the list already
        // matches the restore point, so nothing is left to write.
        live().desc = 'outside'
        flushSync()
        await press('studio-history-restore-open')
        expect(part('studio-restore-sheet')).not.toBeNull()
        const confirm = await press('studio-restore-confirm')
        expect(part('studio-restore-refusal')?.textContent).toBe('studioRefusalPrecondition')
        expect(part('studio-restore-sheet')).not.toBeNull()
        expect(live().desc).toBe('outside')
        expect(document.activeElement).toBe(confirm)
    })
})
