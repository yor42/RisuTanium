// @vitest-environment jsdom
/**
 * The first-message cards of the character form over a real history service on the memory doubles: menu, Alt+arrows,
 * mouse drag, swap with the default first message, Duplicate. Every action is one history step through the service's
 * list operations, and the open chat follows the text it shows.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

const db = $state({ db: { characters: [] as LiveCharacter[] } })
const selection = $state({ selId: 0 })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
    }
})
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of ['ltProblemCount', 'ltProblemsShowAll', 'ltProblemLine', 'ltProblemFix', 'cbsUnclosed', 'cbsStrayBlockClose', 'cbsNotABlock', 'ltMacroMatches', 'ltCardHandle', 'ltCardMenu', 'ltCardMoved']) own[key] = withArguments(key)
    own.ltMacroRows = new Proxy({}, { get: (_target, id) => typeof id === 'string' ? `row:${id}` : undefined })
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { createMacroIndex } from 'src/ts/studio/longText/macroIndex'
import { setMacroIndexForTests } from 'src/ts/studio/longText/macroIndexService'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { refusalText } from 'src/ts/studio/edit/studioToasts'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createGate, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioCharacterForm from './StudioCharacterForm.svelte'

interface LiveCharacter {
    chaId: string
    type: string
    desc: string
    firstMessage?: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
}

function makeCharacter(overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        firstMessage: 'G',
        alternateGreetings: ['A', 'B', 'C'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 0 }],
        chatPage: 0,
        ...overrides,
    }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// ---------------------------------------------------------------- rigs

interface Rig {
    clock: FakeClock
    claim: ReturnType<typeof createClaimDouble>
    service: OwnerHistoryService
}

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

function makeRig(): Rig {
    const clock = createFakeClock()
    const claim = createClaimDouble()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim,
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return { clock, claim, service }
}

// ---------------------------------------------------------------- dom helpers

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountForm(): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = mount(StudioCharacterForm, { target: host, props: { chaId: 'A' } })
    mounted.push({ app, host })
    flushSync()
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

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const inputs = () => parts('studio-greeting-input') as HTMLTextAreaElement[]
const handles = () => parts('studio-card-handle') as HTMLButtonElement[]
const menuButtons = () => parts('studio-card-menu') as HTMLButtonElement[]
const values = () => inputs().map((field) => field.value)
const announced = () => part('studio-card-announce')?.textContent ?? ''

function live(): LiveCharacter {
    return db.db.characters[0]
}

async function openMenu(index: number): Promise<void> {
    menuButtons()[index].click()
    flushSync()
    await settle()
}

async function pickItem(name: string): Promise<void> {
    ;(part(name) as HTMLButtonElement).click()
    await settle()
}

function altArrow(target: HTMLElement, key: 'ArrowUp' | 'ArrowDown', init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, altKey: true, ...init })
    target.dispatchEvent(event)
    flushSync()
    return event
}

// Rows laid out 100 px apart from the top, as the browser would measure them.
function layoutRows(): void {
    parts('studio-greeting-row').forEach((row, index) => {
        row.getBoundingClientRect = () => ({ top: index * 100, bottom: index * 100 + 100, height: 100, left: 0, right: 300, width: 300, x: 0, y: index * 100, toJSON: () => ({}) })
    })
}

function pointer(target: EventTarget, type: string, init: PointerEventInit): void {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }))
    flushSync()
}

const stepsOf = (service: OwnerHistoryService) => service.view(A).done

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    db.db.characters = [makeCharacter()]
    selection.selId = 0
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
    setMacroIndexForTests(createMacroIndex([{ name: 'char', aliases: [], summary: 'char', usage: null, docOnly: false, internalOnly: false, blockSyntax: false, deprecated: null }]))
})

afterEach(async () => {
    setMacroIndexForTests(null)
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// ---------------------------------------------------------------- moves

describe('F1-MV the menu, the keys and the mouse move a card as one step, and the chat follows', () => {
    test('F1-MV1 menu Move down on card 0 of [A,B,C] with the chat on 0 gives [B,A,C], chat 1, one greetingMove step, focus on handle 1', async () => {
        const rig = makeRig()
        mountForm()
        await settle()
        await openMenu(0)
        await pickItem('studio-card-move-down')
        expect(live().alternateGreetings).toEqual(['B', 'A', 'C'])
        expect(live().chats[0].fmIndex).toBe(1)
        expect(stepsOf(rig.service)).toHaveLength(1)
        expect(stepsOf(rig.service)[0].label).toEqual({ kind: 'greetingMove' })
        expect(h.marks).toBe(1)
        expect(document.activeElement).toBe(handles()[1])
        expect(announced()).toBe('ltCardMoved(2,3)')
    })

    test('F1-MV1b the first card cannot move up and the last cannot move down', async () => {
        makeRig()
        mountForm()
        await settle()
        await openMenu(0)
        expect((part('studio-card-move-up') as HTMLButtonElement).disabled).toBe(true)
        expect((part('studio-card-move-down') as HTMLButtonElement).disabled).toBe(false)
        menuButtons()[0].click()
        flushSync()
        expect(part('studio-card-move-down')).toBeNull()
        await openMenu(2)
        expect((part('studio-card-move-down') as HTMLButtonElement).disabled).toBe(true)
        expect((part('studio-card-move-up') as HTMLButtonElement).disabled).toBe(false)
    })

    test.each(['handle', 'menu button'] as const)('F1-MV2 Alt+ArrowUp on the %s of card 2 moves it to 1', async (which) => {
        const rig = makeRig()
        mountForm()
        await settle()
        const target = which === 'handle' ? handles()[2] : menuButtons()[2]
        const event = altArrow(target, 'ArrowUp')
        await settle()
        expect(event.defaultPrevented).toBe(true)
        expect(live().alternateGreetings).toEqual(['A', 'C', 'B'])
        expect(stepsOf(rig.service)).toHaveLength(1)
    })

    test('F1-MV2b inside the text field Alt+arrows are neither handled nor prevented; at card 0 and while composing nothing moves', async () => {
        const rig = makeRig()
        mountForm()
        await settle()
        const inside = altArrow(inputs()[1], 'ArrowUp')
        expect(inside.defaultPrevented).toBe(false)
        altArrow(handles()[0], 'ArrowUp')
        altArrow(handles()[1], 'ArrowUp', { isComposing: true })
        altArrow(handles()[1], 'ArrowUp', { keyCode: 229 })
        await settle()
        expect(live().alternateGreetings).toEqual(['A', 'B', 'C'])
        expect(stepsOf(rig.service)).toHaveLength(0)
        expect(h.marks).toBe(0)
    })

    test('F1-MV3 a mouse drag from 0 past the last card is exactly one greetingMove(0,2)', async () => {
        const rig = makeRig()
        const spy = vi.spyOn(rig.service, 'greetingMove')
        mountForm()
        await settle()
        layoutRows()
        pointer(handles()[0], 'pointerdown', { pointerType: 'mouse', button: 0, clientY: 50 })
        pointer(window, 'pointermove', { pointerType: 'mouse', clientY: 160 })
        pointer(window, 'pointermove', { pointerType: 'mouse', clientY: 290 })
        expect(part('studio-card-drop-line')).not.toBeNull()
        pointer(window, 'pointerup', { pointerType: 'mouse', clientY: 290 })
        await settle()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy).toHaveBeenCalledWith(A, 0, 2)
        expect(live().alternateGreetings).toEqual(['B', 'C', 'A'])
        expect(stepsOf(rig.service)).toHaveLength(1)
        expect(part('studio-card-drop-line')).toBeNull()
    })

    test('F1-MV3b a touch pointer does not drag, and Escape or a cancelled pointer mid-drag makes no step', async () => {
        const rig = makeRig()
        mountForm()
        await settle()
        layoutRows()
        pointer(handles()[0], 'pointerdown', { pointerType: 'touch', button: 0, clientY: 50 })
        pointer(window, 'pointermove', { pointerType: 'touch', clientY: 290 })
        pointer(window, 'pointerup', { pointerType: 'touch', clientY: 290 })
        expect(stepsOf(rig.service)).toHaveLength(0)

        pointer(handles()[0], 'pointerdown', { pointerType: 'mouse', button: 0, clientY: 50 })
        pointer(window, 'pointermove', { pointerType: 'mouse', clientY: 290 })
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        pointer(window, 'pointerup', { pointerType: 'mouse', clientY: 290 })
        expect(stepsOf(rig.service)).toHaveLength(0)

        pointer(handles()[0], 'pointerdown', { pointerType: 'pen', button: 0, clientY: 50 })
        pointer(window, 'pointermove', { pointerType: 'pen', clientY: 290 })
        pointer(window, 'pointercancel', { pointerType: 'pen', clientY: 290 })
        pointer(window, 'pointerup', { pointerType: 'pen', clientY: 290 })
        await settle()
        expect(live().alternateGreetings).toEqual(['A', 'B', 'C'])
        expect(stepsOf(rig.service)).toHaveLength(0)
    })

    test('F1-ID1 after a move the fields are in list order with data-index equal to position', async () => {
        makeRig()
        mountForm()
        await settle()
        await openMenu(0)
        await pickItem('studio-card-move-down')
        expect(values()).toEqual(['B', 'A', 'C'])
        expect(inputs().map((field) => field.dataset.index)).toEqual(['0', '1', '2'])
        expect(parts('studio-greeting-row')).toHaveLength(3)
    })
})

// ---------------------------------------------------------------- swap, duplicate, index rule

describe('F1-SW and F1-DUP', () => {
    test('F1-SW1 swapping card 1 exchanges it with the first message, the chat follows its text, and swapping again restores', async () => {
        live().chats[0].fmIndex = 1
        const rig = makeRig()
        mountForm()
        await settle()
        await openMenu(1)
        await pickItem('studio-card-swap')
        expect(live().firstMessage).toBe('B')
        expect(live().alternateGreetings).toEqual(['A', 'G', 'C'])
        expect(live().chats[0].fmIndex).toBe(-1)
        expect(stepsOf(rig.service)).toHaveLength(1)
        expect(stepsOf(rig.service)[0].label).toEqual({ kind: 'greetingSwap' })
        expect(announced()).toBe('ltCardSwapped')
        expect(document.activeElement).toBe(menuButtons()[1])
        await openMenu(1)
        await pickItem('studio-card-swap')
        expect(live().firstMessage).toBe('G')
        expect(live().alternateGreetings).toEqual(['A', 'B', 'C'])
        expect(live().chats[0].fmIndex).toBe(1)
        expect(stepsOf(rig.service)).toHaveLength(2)
    })

    test('F1-SW2 a character with no first-message key refuses the swap with the refusal line and changes nothing', async () => {
        delete live().firstMessage
        const rig = makeRig()
        mountForm()
        await settle()
        await openMenu(1)
        await pickItem('studio-card-swap')
        expect(part('studio-form-refusal')?.textContent).toBe(refusalText('precondition'))
        expect(live().alternateGreetings).toEqual(['A', 'B', 'C'])
        expect(stepsOf(rig.service)).toHaveLength(0)
        expect(h.marks).toBe(0)
    })

    test('F1-DUP Duplicate on card 1 appends a copy at the end as one greetingAddMany step and focuses it', async () => {
        const rig = makeRig()
        mountForm()
        await settle()
        await openMenu(1)
        await pickItem('studio-card-duplicate')
        expect(live().alternateGreetings).toEqual(['A', 'B', 'C', 'B'])
        expect(stepsOf(rig.service)).toHaveLength(1)
        expect(stepsOf(rig.service)[0].label).toEqual({ kind: 'greetingAddMany', count: 1 })
        expect(h.marks).toBe(1)
        expect(document.activeElement).toBe(inputs()[3])
        expect(announced()).toBe('ltCardCopied')
    })

    test('F1-IDX a peer inserts a card at the front between the menu opening and the click: the action uses the card at its current index', async () => {
        const rig = makeRig()
        mountForm()
        await settle()
        await openMenu(1)
        live().alternateGreetings = ['N', ...live().alternateGreetings]
        await settle()
        await pickItem('studio-card-move-down')
        expect(live().alternateGreetings).toEqual(['N', 'A', 'C', 'B'])
        expect(stepsOf(rig.service)).toHaveLength(1)
    })

    test('F1-HOLD composing in card 1 while a peer moves the cards writes nothing into a neighbour', async () => {
        const rig = makeRig()
        mountForm()
        await settle()
        const field = inputs()[1]
        field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        field.value = 'B한'
        field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }))
        flushSync()
        expect(rig.service.greetingMove(A, 0, 2).ok).toBe(true)
        flushSync()
        field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        flushSync()
        await settle()
        expect(live().alternateGreetings).toEqual(['B', 'C', 'A'])
        expect(stepsOf(rig.service)).toHaveLength(1)
    })
})

// ---------------------------------------------------------------- read-only and menu behaviour

describe('F1-RO and the menu', () => {
    test('F1-RO1 while the owner loads the handle, the menu button and Add are disabled and Alt+arrows make no call', async () => {
        const rig = makeRig()
        const gate = createGate()
        rig.claim.hook = () => gate.promise
        const spy = vi.spyOn(rig.service, 'greetingMove')
        mountForm()
        await settle()
        expect(handles().every((button) => button.disabled)).toBe(true)
        expect(menuButtons().every((button) => button.disabled)).toBe(true)
        expect((part('studio-greeting-add') as HTMLButtonElement).disabled).toBe(true)
        expect((part('studio-greeting-paste') as HTMLButtonElement).disabled).toBe(true)
        altArrow(handles()[1], 'ArrowUp')
        altArrow(menuButtons()[1], 'ArrowDown')
        expect(spy).not.toHaveBeenCalled()
        gate.release()
        await settle()
    })

    test('F2-ENTRY the Paste several button sits beside Add and opens the sheet, which is gone again after Cancel', async () => {
        makeRig()
        mountForm()
        await settle()
        const paste = part('studio-greeting-paste') as HTMLButtonElement
        expect(paste.parentElement).toBe((part('studio-greeting-add') as HTMLButtonElement).parentElement)
        expect(paste.textContent).toBe('ltPasteSeveral')
        paste.click()
        await settle()
        expect(part('studio-paste-sheet')).not.toBeNull()
        ;(part('studio-paste-cancel') as HTMLButtonElement).click()
        await settle()
        expect(part('studio-paste-sheet')).toBeNull()
    })

    test('F1-MENU Escape closes the menu and returns focus to its button, and propagates only when no menu was open', async () => {
        makeRig()
        mountForm()
        await settle()
        await openMenu(1)
        expect(part('studio-card-move-down')).not.toBeNull()
        // Opening puts focus on the first enabled item; Escape there closes the menu and returns focus to its button.
        expect(document.activeElement?.getAttribute('data-part')).toBe('studio-card-duplicate')
        const closing = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        const closingStop = vi.spyOn(closing, 'stopPropagation')
        document.activeElement!.dispatchEvent(closing)
        flushSync()
        expect(part('studio-card-move-down')).toBeNull()
        expect(document.activeElement).toBe(menuButtons()[1])
        expect(closingStop).toHaveBeenCalledTimes(1)
        // Escape on the button of an open menu closes it too.
        await openMenu(1)
        const onButton = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        const onButtonStop = vi.spyOn(onButton, 'stopPropagation')
        menuButtons()[1].dispatchEvent(onButton)
        flushSync()
        expect(part('studio-card-move-down')).toBeNull()
        expect(onButtonStop).toHaveBeenCalledTimes(1)
        const idle = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        const idleStop = vi.spyOn(idle, 'stopPropagation')
        menuButtons()[1].dispatchEvent(idle)
        expect(idleStop).not.toHaveBeenCalled()
    })

    test('F1-MENU2 the card shows its first line, or the empty label, and the menu button says it has a menu', async () => {
        live().alternateGreetings = ['first line\nsecond', '']
        makeRig()
        mountForm()
        await settle()
        expect(parts('studio-card-summary').map((node) => node.textContent)).toEqual(['first line', 'ltCardUntitled'])
        expect(menuButtons()[0].getAttribute('aria-haspopup')).toBe('menu')
    })
})
