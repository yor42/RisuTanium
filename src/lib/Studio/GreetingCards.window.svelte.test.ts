// @vitest-environment jsdom
/**
 * The first-message cards of the character form with 500 alternates: only the cards near the view are in the page,
 * a mouse drag reads every card by its data index and lands the card on a position that was not mounted before the
 * drag, an added card that is outside the window is revealed before it takes focus, and the open menu's card stays
 * mounted when the band moves away. Real history service on the memory doubles; layout is faked the way the other
 * window tests do. "regression reproducer:" titles fail against the cards that mounted every row.
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
import { setWindowGeometryForTests } from '../../ts/windowing/windowHost.svelte'
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

const COUNT = 500
let frames: (() => void)[] = []
let bandShift = 0

function runFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) frame()
    flushSync()
}

async function settleWindow(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        await drainMicrotasks()
        flushSync()
        runFrames()
    }
}

const rowWrappers = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-form-greetings"] [data-window-key]'))
const manyGreetings = (count = COUNT) => Array.from({ length: count }, (_, i) => `g${i}`)
// A drag mounts every card, which is slow with real text fields: it uses a shorter list that is still larger than the window.
const DRAG_COUNT = 80
function pointer(target: EventTarget, type: string, init: PointerEventInit): void {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }))
    flushSync()
}

beforeEach(() => {
    h.marks = 0
    frames = []
    bandShift = 0
    setWindowGeometryForTests({
        rectOf: () => ({ top: -bandShift, height: 600 }),
        viewport: () => 600,
        scrollBy: () => {},
        schedule: (callback) => {
            frames.push(callback)
            return () => { frames = frames.filter((frame) => frame !== callback) }
        },
    })
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
    setWindowGeometryForTests(undefined)
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('the windowed first-message cards', () => {
    test('regression reproducer: 500 alternates mount only the cards near the view', async () => {
        db.db.characters = [makeCharacter({ alternateGreetings: manyGreetings() })]
        makeRig()
        mountForm()
        await settleWindow()
        expect(inputs().length).toBeGreaterThan(0)
        expect(inputs().length).toBeLessThan(60)
        expect(rowWrappers()[0].getAttribute('aria-setsize')).toBe(String(COUNT))
        expect(inputs()[0].getAttribute('data-index')).toBe('0')
    })

    test('regression reproducer: a mouse drag onto a position that was not mounted is one greetingMove to that data index', async () => {
        db.db.characters = [makeCharacter({ alternateGreetings: manyGreetings(DRAG_COUNT) })]
        const rig = makeRig()
        const spy = vi.spyOn(rig.service, 'greetingMove')
        mountForm()
        await settleWindow()
        expect(parts('studio-greeting-row').length).toBeLessThan(DRAG_COUNT / 2)
        pointer(handles()[0], 'pointerdown', { pointerType: 'mouse', button: 0, clientY: 50 })
        await settleWindow()
        // The drag keeps every card in the page, so every rect is read.
        expect(parts('studio-greeting-row').length).toBe(DRAG_COUNT)
        // Rows sit 100 px apart by their data index; 59 other rows have their middle above this pointer.
        const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const index = Number(this.getAttribute('data-row-index') ?? 0)
            return { top: index * 100, bottom: index * 100 + 100, height: 100, left: 0, right: 300, width: 300, x: 0, y: index * 100, toJSON: () => ({}) }
        })
        try {
            pointer(window, 'pointermove', { pointerType: 'mouse', clientY: 60 * 100 + 10 })
            pointer(window, 'pointerup', { pointerType: 'mouse', clientY: 60 * 100 + 10 })
        } finally {
            rectSpy.mockRestore()
        }
        await settleWindow()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy).toHaveBeenCalledWith(A, 0, 59)
        const greetings = live().alternateGreetings
        expect(greetings.length).toBe(DRAG_COUNT)
        expect(greetings[59]).toBe('g0')
        expect(greetings[0]).toBe('g1')
        expect(new Set(greetings).size).toBe(DRAG_COUNT)
        expect(parts('studio-greeting-row').length).toBeLessThan(DRAG_COUNT / 2)
    })

    test('regression reproducer: Add focuses the new last card although it is outside the window', async () => {
        db.db.characters = [makeCharacter({ alternateGreetings: manyGreetings() })]
        makeRig()
        mountForm()
        await settleWindow()
        expect(inputs().some((field) => field.getAttribute('data-index') === String(COUNT))).toBe(false)
        ;(part('studio-greeting-add') as HTMLButtonElement).click()
        await settleWindow()
        expect(live().alternateGreetings.length).toBe(COUNT + 1)
        await vi.waitFor(async () => {
            await settleWindow()
            expect((document.activeElement as HTMLElement | null)?.getAttribute('data-index')).toBe(String(COUNT))
        })
    })

    test('regression reproducer: the card with the open menu stays mounted when the band moves away', async () => {
        db.db.characters = [makeCharacter({ alternateGreetings: manyGreetings() })]
        makeRig()
        mountForm()
        await settleWindow()
        await openMenu(2)
        await settleWindow()
        bandShift = 40000
        window.dispatchEvent(new Event('scroll'))
        await settleWindow()
        expect(part('studio-card-menu-list')).not.toBeNull()
        expect(inputs().some((field) => field.getAttribute('data-index') === '0')).toBe(false)
        expect(menuButtons().some((button) => button.getAttribute('aria-expanded') === 'true')).toBe(true)
    })
})