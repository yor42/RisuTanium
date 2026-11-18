// @vitest-environment jsdom
/**
 * The example-dialogue cards of the advanced character form over a real history service on the memory doubles.
 * Every write is one `editText(..., 'exampleMessage', whole, ...)` of the whole stored text: a card edit changes only
 * the bytes of the lines it touched, a typed `<START>` is held as body text until the caret leaves its line, and
 * viewing, focusing or switching the view writes nothing.
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
    for (const key of ['ltProblemCount', 'ltProblemsShowAll', 'ltProblemLine', 'ltProblemFix', 'cbsUnclosed', 'cbsStrayBlockClose', 'cbsNotABlock', 'ltMacroMatches']) own[key] = withArguments(key)
    own.ltMacroRows = new Proxy({}, { get: (_target, id) => typeof id === 'string' ? `row:${id}` : undefined })
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { language } from 'src/lang'
import { dispatchBack } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { refusalText } from 'src/ts/studio/edit/studioToasts'
import { addBlock, deleteCard, markOpening, moveBlock } from 'src/ts/studio/longText/exampleCards'
import { V2_CRLF_EXAMPLE } from 'src/ts/studio/longText/exampleFixtures.test-helpers'
import { createMacroIndex } from 'src/ts/studio/longText/macroIndex'
import { setMacroIndexForTests } from 'src/ts/studio/longText/macroIndexService'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createGate, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioExampleForm from './StudioExampleForm.svelte'

interface LiveCharacter {
    chaId: string
    type: string
    name: string
    exampleMessage?: string
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
}

function makeCharacter(overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        name: 'Alice',
        exampleMessage: '<START>\nA\n<START>\nB',
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
    const app = mount(StudioExampleForm, { target: host, props: { chaId: 'A' } })
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
const cards = () => parts('studio-example-input') as HTMLTextAreaElement[]
const values = () => cards().map((field) => field.value)
const handles = () => parts('studio-example-handle') as HTMLButtonElement[]
const menuButtons = () => parts('studio-example-menu') as HTMLButtonElement[]
const textView = () => part('studio-example-text') as HTMLTextAreaElement
const refusalLine = (): string | undefined => part('studio-form-refusal')?.textContent ?? undefined
const stepsOf = (service: OwnerHistoryService) => service.view(A).done

function live(): LiveCharacter {
    return db.db.characters[0]
}

// A browser-shaped `input`: the value is set before the event, the caret is where the user left it.
function typeIn(field: HTMLTextAreaElement, value: string, init: { caret?: number; inputType?: string } = {}): void {
    field.value = value
    const caret = init.caret ?? value.length
    field.setSelectionRange(caret, caret)
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: init.inputType ?? 'insertText' }))
    flushSync()
}

function composeInto(field: HTMLTextAreaElement, value: string): void {
    field.value = value
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }))
    flushSync()
}

function compositionStart(field: HTMLTextAreaElement): void {
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
}

function compositionEnd(field: HTMLTextAreaElement): void {
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    flushSync()
}

function setVisibility(state: 'hidden' | 'visible'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

function hidePage(): void {
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    flushSync()
}

// Types a marker key by key at the end of card `index`, as a keyboard would.
function typeKeys(field: HTMLTextAreaElement, base: string, keys: string): string {
    let value = base
    for (const key of keys) {
        value += key
        typeIn(field, value)
    }
    return value
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

async function mountWith(text: string | undefined): Promise<Rig> {
    if (text === undefined) delete live().exampleMessage
    else live().exampleMessage = text
    const rig = makeRig()
    mountForm()
    await settle()
    return rig
}

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
    setVisibility('visible')
    setMacroIndexForTests(null)
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// ---------------------------------------------------------------- viewing writes nothing

describe('F3 viewing and editing example cards', () => {
    test('X-1 a CRLF text mounts as two cards; mount, focus, blur and a list-text-list round trip write nothing', async () => {
        const rig = await mountWith(V2_CRLF_EXAMPLE)
        expect(values()).toEqual(['{{user}}: hello\n{{char}}: hi there', '{{user}}: again\n{{char}}: yes\n'])
        for (const field of cards()) {
            field.focus()
            field.blur()
        }
        ;(part('studio-example-view-text') as HTMLButtonElement).click()
        await settle()
        expect(textView()).not.toBeNull()
        textView().focus()
        textView().blur()
        ;(part('studio-example-view-list') as HTMLButtonElement).click()
        await settle()
        expect(cards()).toHaveLength(2)
        expect(live().exampleMessage).toBe(V2_CRLF_EXAMPLE)
        expect(h.marks).toBe(0)
        expect(stepsOf(rig.service)).toHaveLength(0)
    })

    test('X-2 typing in card 2 changes only the touched line, keeps CRLF, marks once per write and is one coalesced step', async () => {
        const rig = await mountWith(V2_CRLF_EXAMPLE)
        const field = cards()[1]
        typeIn(field, '{{user}}: againX\n{{char}}: yes\n', { caret: 15 })
        typeIn(field, '{{user}}: againXY\n{{char}}: yes\n', { caret: 16 })
        typeIn(field, '{{user}}: againXYZ\n{{char}}: yes\n', { caret: 17 })
        expect(live().exampleMessage).toBe('<START>\r\n{{user}}: hello\r\n{{char}}: hi there\r\n<START>\r\n{{user}}: againXYZ\r\n{{char}}: yes\r\n')
        expect(h.marks).toBe(3)
        const steps = stepsOf(rig.service)
        expect(steps).toHaveLength(1)
        expect(steps[0].label).toEqual({ kind: 'field', field: 'exampleMessage' })
    })

    test('X-9 while the owner loads or is not editable the cards are read-only, the controls are disabled and nothing is called', async () => {
        const rig = makeRig()
        const gate = createGate()
        rig.claim.hook = () => gate.promise
        mountForm()
        await settle()
        expect(cards().every((field) => field.readOnly)).toBe(true)
        expect((part('studio-example-add') as HTMLButtonElement).disabled).toBe(true)
        expect(handles().every((button) => button.disabled)).toBe(true)
        expect(menuButtons().every((button) => button.disabled)).toBe(true)
        typeIn(cards()[0], 'typed')
        handles()[1].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp', altKey: true }))
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nB')
        expect(h.marks).toBe(0)
        gate.release()
        await settle()
    })

    test('X-11a the card header counts the turns and the lines with unused text after a second colon', async () => {
        await mountWith('<START>\n{{char}}: hi: there')
        const subtitle = part('studio-example-subtitle')?.textContent ?? ''
        expect(subtitle).toContain('ltExTurns(1)')
        expect(subtitle).toContain('ltExNotUsed(1)')
    })

    test('X-11a a card with no unused text shows only its turn count', async () => {
        await mountWith('<START>\n{{user}}: a\n{{char}}: b')
        const subtitle = part('studio-example-subtitle')?.textContent ?? ''
        expect(subtitle).toContain('ltExTurns(2)')
        expect(subtitle).not.toContain('ltExNotUsed')
    })

    describe('S5 turn notes in the highlight overlay', () => {
        beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
        afterEach(() => { vi.useRealTimers() })

        const overlayIn = (index: number): HTMLElement => cards()[index].closest('[data-part="studio-example-card"]')!.querySelector('[data-part="studio-lt-overlay"]') as HTMLElement
        // A note can span several coloured pieces, so a note's text is its pieces joined.
        const noteText = (index: number, note: string): string => Array.from(overlayIn(index).querySelectorAll(`[data-note="${note}"]`)).map((el) => el.textContent ?? '').join('')
        const pause = (): void => { vi.advanceTimersByTime(250); flushSync() }

        test('X-11b the speaker prefix and the unused tail are marked in the overlay after the pause', async () => {
            await mountWith('<START>\n{{char}}: hi: there')
            pause()
            expect(noteText(0, 'speaker')).toBe('{{char}}:')
            expect(noteText(0, 'notUsed')).toBe(': there')
            expect(overlayIn(0).textContent).toBe('{{char}}: hi: there\n')
        })

        test('X-11b a line with no second colon has a speaker note and no unused note; a line without a speaker has neither', async () => {
            await mountWith('<START>\n{{user}}: a\nplain: text')
            pause()
            expect(noteText(0, 'speaker')).toBe('{{user}}:')
            expect(noteText(0, 'notUsed')).toBe('')
        })

        test('X-11c the notes follow an edit before the pause and are the same after it', async () => {
            await mountWith('<START>\n{{char}}: hi: there')
            pause()
            typeIn(cards()[0], '{{char}}: hixy: there', { caret: 14 })
            expect(noteText(0, 'speaker')).toBe('{{char}}:')
            expect(noteText(0, 'notUsed')).toBe(': there')
            pause()
            expect(noteText(0, 'speaker')).toBe('{{char}}:')
            expect(noteText(0, 'notUsed')).toBe(': there')
        })

        test('notes never change bytes: the stored text stays as seeded and nothing is marked', async () => {
            await mountWith('<START>\n{{char}}: hi: there')
            pause()
            expect(live().exampleMessage).toBe('<START>\n{{char}}: hi: there')
            expect(h.marks).toBe(0)
        })

        test('the text view gets no notes', async () => {
            await mountWith('<START>\n{{char}}: hi: there')
            ;(part('studio-example-view-text') as HTMLButtonElement).click()
            await settle()
            pause()
            expect(document.querySelectorAll('[data-note]')).toHaveLength(0)
        })
    })

    test('an empty example text mounts ltExEmpty and no card', async () => {
        await mountWith('')
        expect(part('studio-example-empty')?.textContent).toBe('ltExEmpty')
        expect(cards()).toHaveLength(0)
    })

    test('a text with an opening shows the opening card with its note, and no move controls', async () => {
        await mountWith('hello\n<START>\nA')
        expect(cards()).toHaveLength(2)
        expect(part('studio-example-opening-note')?.textContent).toBe('ltOpeningNote')
        expect(values()).toEqual(['hello', 'A'])
        await openMenu(0)
        expect(part('studio-example-move-up')).toBeNull()
        expect(part('studio-example-mark-opening')).not.toBeNull()
    })

    test('X-12 a card composing when the page hides is written once and marked once', async () => {
        const rig = await mountWith('<START>\nA\n<START>\nB')
        const field = cards()[1]
        compositionStart(field)
        composeInto(field, 'B한')
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nB')
        hidePage()
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nB한')
        expect(h.marks).toBe(1)
        expect(stepsOf(rig.service)).toHaveLength(1)
    })
})

// ---------------------------------------------------------------- the held marker

describe('F3 a typed start marker', () => {
    test('X-3 typing <START> key by key stays one card; the closing > is its own step; Enter splits and the caret lands in the new card', async () => {
        const rig = await mountWith('<START>\nA')
        const field = cards()[0]
        field.focus()
        const base = typeKeys(field, 'A\n', '<START')
        expect(live().exampleMessage).toBe('<START>\nA\n<START')
        expect(stepsOf(rig.service)).toHaveLength(1)
        typeIn(field, `${base}>`)
        expect(live().exampleMessage).toBe('<START>\nA\n<START>')
        expect(cards()).toHaveLength(1)
        expect(stepsOf(rig.service)).toHaveLength(2)
        typeIn(field, `${base}>\n`)
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\n')
        expect(refusalLine()).toBeUndefined()
        expect(values()).toEqual(['A', ''])
        expect(document.activeElement).toBe(cards()[1])
        expect(cards()[1].selectionStart).toBe(0)
    })

    test('X-3 deleting the > of a held marker before leaving never renders two cards and is its own step', async () => {
        const rig = await mountWith('<START>\nA')
        const field = cards()[0]
        field.focus()
        typeIn(field, 'A\n<START>')
        expect(cards()).toHaveLength(1)
        typeIn(field, 'A\n<START', { inputType: 'deleteContentBackward' })
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA\n<START')
        expect(cards()).toHaveLength(1)
        expect(values()).toEqual(['A\n<START'])
        expect(stepsOf(rig.service)).toHaveLength(2)
    })

    test('AS16 cutting or overtyping a held marker line in a card is its own undo step', async () => {
        const rig = await mountWith('<START>\nA')
        const field = cards()[0]
        field.focus()
        typeIn(field, 'A\n<START>')
        expect(stepsOf(rig.service)).toHaveLength(1)
        typeIn(field, 'A\n', { inputType: 'deleteByCut' })
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA\n')
        expect(stepsOf(rig.service)).toHaveLength(2)
        typeIn(field, 'A\n<START>')
        typeIn(field, 'A\nx', { inputType: 'insertText' })
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA\nx')
        expect(stepsOf(rig.service)).toHaveLength(4)
    })

    test('X-3 moving the caret to another line of the held card with no key event splits at the selection change', async () => {
        await mountWith('<START>\nA')
        const field = cards()[0]
        field.focus()
        typeIn(field, 'A\n<START>')
        expect(cards()).toHaveLength(1)
        field.setSelectionRange(0, 0)
        document.dispatchEvent(new Event('selectionchange'))
        await settle()
        expect(cards()).toHaveLength(2)
        expect(values()).toEqual(['A', ''])
    })

    test('X-4 a pasted marker splits at once and the caret lands in the card that holds it', async () => {
        const rig = await mountWith('<START>\nA')
        const field = cards()[0]
        field.focus()
        typeIn(field, 'A\n<START>\nB', { inputType: 'insertFromPaste' })
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nB')
        expect(values()).toEqual(['A', 'B'])
        expect(document.activeElement).toBe(cards()[1])
        expect(cards()[1].selectionStart).toBe(1)
        expect(stepsOf(rig.service)).toHaveLength(1)
    })

    test('X-4 a pasted marker line at the caret is not held: the new card shows at once', async () => {
        await mountWith('<START>\nA')
        const field = cards()[0]
        field.focus()
        typeIn(field, 'A\n<START>', { inputType: 'insertFromPaste' })
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA\n<START>')
        expect(values()).toEqual(['A', ''])
        expect(document.activeElement).toBe(cards()[1])
    })

    test('X-5 a click into another card while a marker is held splits, and focus stays on the clicked card', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        const first = cards()[0]
        first.focus()
        typeIn(first, 'A\n<START>')
        expect(cards()).toHaveLength(2)
        const clicked = cards()[1]
        clicked.focus()
        await settle()
        expect(cards()).toHaveLength(3)
        expect(values()).toEqual(['A', '', 'B'])
        expect(document.activeElement).toBe(clicked)
        expect(clicked.value).toBe('B')
    })

    test('X-16 a held marker is shown split before the card actions, and Move up equals moveBlock', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        const second = cards()[1]
        second.focus()
        typeIn(second, 'B\n<START>')
        expect(cards()).toHaveLength(2)
        menuButtons()[1].focus()
        await settle()
        expect(cards()).toHaveLength(3)
        expect(document.activeElement).toBe(menuButtons()[1])
        const stored = live().exampleMessage ?? ''
        await openMenu(1)
        await pickItem('studio-example-move-up')
        expect(live().exampleMessage).toBe(moveBlock(stored, 1, 0))
    })

    test('X-17 a peer edit before the held line keeps the held card whole and its value untouched', async () => {
        const rig = await mountWith('<START>\nA\n<START>\nB')
        const second = cards()[1]
        second.focus()
        typeIn(second, 'B\n<START>')
        expect(cards()).toHaveLength(2)
        const held = cards()[1]
        const peer = rig.service.editText(A, 'exampleMessage', '<START>\nA peer line\n<START>\nB\n<START>', 'single')
        expect(peer.ok).toBe(true)
        flushSync()
        expect(values()).toEqual(['A peer line', 'B\n<START>'])
        expect(cards()[1]).toBe(held)
        expect(held.value).toBe('B\n<START>')
    })

    test('X-18 a composition on the held last line of the text survives a peer edit and compositionend keeps the peer text', async () => {
        const rig = await mountWith('<START>\nA\n<START>\nB')
        const second = cards()[1]
        second.focus()
        typeIn(second, 'B\n<START>')
        compositionStart(second)
        composeInto(second, 'B\n<START>ㅎ')
        rig.service.editText(A, 'exampleMessage', '<START>\nA peer line\n<START>\nB\n<START>', 'single')
        flushSync()
        expect(cards()[1].value).toBe('B\n<START>ㅎ')
        composeInto(second, 'B\n<START>하')
        compositionEnd(second)
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA peer line\n<START>\nB\n<START>하')
        expect(refusalLine()).toBeUndefined()
    })

    // New-rule guards: a composition shows more than is stored, so the release compares in the field's own text.
    test('X-18b an IME keyup during a composition on a held line that is not the last line of the text keeps the composition', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        const first = cards()[0]
        first.focus()
        typeIn(first, 'A\n<START>')
        expect(cards()).toHaveLength(2)
        compositionStart(first)
        composeInto(first, 'A\n<START>ㅎ')
        first.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Process', keyCode: 229 }))
        await settle()
        expect({
            count: cards().length,
            value: first.value,
            focusedCard: cards().indexOf(document.activeElement as HTMLTextAreaElement),
            refusal: refusalLine() ?? null,
            stored: live().exampleMessage,
        }).toEqual({ count: 2, value: 'A\n<START>ㅎ', focusedCard: 0, refusal: null, stored: '<START>\nA\n<START>\n<START>\nB' })
    })

    test('X-18c a selectionchange during a composition on a held line that is not the last line of the text keeps the composition', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        const first = cards()[0]
        first.focus()
        typeIn(first, 'A\n<START>')
        compositionStart(first)
        composeInto(first, 'A\n<START>ㅎ')
        document.dispatchEvent(new Event('selectionchange'))
        await settle()
        const after = { count: cards().length, value: cards()[0].value }
        composeInto(first, 'A\n<START>하')
        compositionEnd(first)
        await settle()
        expect({ after, stored: live().exampleMessage, refusal: refusalLine() ?? null }).toEqual({
            after: { count: 2, value: 'A\n<START>ㅎ' },
            stored: '<START>\nA\n<START>하\n<START>\nB',
            refusal: null,
        })
    })

    test('the handle and menu labels count the example blocks, not the opening, and the opening is not named an example', async () => {
        await mountWith('o\n<START>\nA\n<START>\nB')
        expect(handles().map((button) => button.getAttribute('aria-label'))).toEqual([language.ltOpening, language.ltExCardHandle(1), language.ltExCardHandle(2)])
        expect(menuButtons().map((button) => button.getAttribute('aria-label'))).toEqual([language.ltOpening, language.ltExCardMenu(1), language.ltExCardMenu(2)])
    })

    test('X-19 an action on another card releases the hold first and resolves by id: the clicked card goes, its neighbour stays', async () => {
        await mountWith('<START>\nA\n<START>\nB\n<START>\nC')
        const first = cards()[0]
        first.focus()
        typeIn(first, 'A\n<START>')
        expect(cards()).toHaveLength(3)
        const before = live().exampleMessage ?? ''
        menuButtons()[2].click()
        flushSync()
        ;(part('studio-example-delete') as HTMLButtonElement).click()
        await settle()
        expect(live().exampleMessage).toBe(deleteCard(before, 3))
        expect(live().exampleMessage).toContain('B')
        expect(live().exampleMessage).not.toContain('C')
    })
})

// ---------------------------------------------------------------- races with outside changes

describe('F3 outside changes', () => {
    test('X-6 a peer edit of block 1 while card 2 composes: compositionend writes block 2 and keeps the peer text', async () => {
        const rig = await mountWith('<START>\nA\n<START>\nB')
        const field = cards()[1]
        compositionStart(field)
        composeInto(field, 'B한')
        rig.service.editText(A, 'exampleMessage', '<START>\nA peer\n<START>\nB', 'single')
        flushSync()
        expect(cards()[0].value).toBe('A peer')
        compositionEnd(field)
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA peer\n<START>\nB한')
    })

    test('X-7 a peer inserting a block at the front while card k composes: the text lands in the same block', async () => {
        const rig = await mountWith('<START>\nA\n<START>\nB')
        const field = cards()[1]
        compositionStart(field)
        composeInto(field, 'B한')
        rig.service.editText(A, 'exampleMessage', '<START>\nZ\n<START>\nA\n<START>\nB', 'single')
        flushSync()
        expect(cards()).toHaveLength(3)
        compositionEnd(field)
        await settle()
        expect(live().exampleMessage).toBe('<START>\nZ\n<START>\nA\n<START>\nB한')
    })
})

// ---------------------------------------------------------------- structural ops

describe('F3 structural actions', () => {
    test('X-8 Add, Delete, Move and the opening mark are one single step each with the pure results', async () => {
        const rig = await mountWith('<START>\nA\n<START>\nB')
        let text = live().exampleMessage ?? ''

        ;(part('studio-example-add') as HTMLButtonElement).click()
        await settle()
        expect(live().exampleMessage).toBe(addBlock(text))
        expect(document.activeElement).toBe(cards()[2])
        text = live().exampleMessage ?? ''

        await openMenu(0)
        await pickItem('studio-example-move-down')
        expect(live().exampleMessage).toBe(moveBlock(text, 0, 1))
        expect(document.activeElement).toBe(handles()[1])
        text = live().exampleMessage ?? ''

        await openMenu(2)
        await pickItem('studio-example-delete')
        expect(live().exampleMessage).toBe(deleteCard(text, 2))
        expect(document.activeElement).toBe(cards()[1])
        expect(stepsOf(rig.service)).toHaveLength(3)
        expect(h.marks).toBe(3)
    })

    test('X-8 giving the opening a start mark is one step and focuses the new first card', async () => {
        const rig = await mountWith('hello\n<START>\nA')
        const text = live().exampleMessage ?? ''
        await openMenu(0)
        await pickItem('studio-example-mark-opening')
        expect(live().exampleMessage).toBe(markOpening(text))
        expect(stepsOf(rig.service)).toHaveLength(1)
        expect(h.marks).toBe(1)
        expect(document.activeElement).toBe(cards()[0])
    })

    test('X-8 Alt+ArrowUp on the handle of card 2 moves it; inside the text it is not handled', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        const text = live().exampleMessage ?? ''
        const inside = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp', altKey: true })
        cards()[1].dispatchEvent(inside)
        expect(inside.defaultPrevented).toBe(false)
        expect(live().exampleMessage).toBe(text)
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp', altKey: true })
        handles()[1].dispatchEvent(event)
        await settle()
        expect(event.defaultPrevented).toBe(true)
        expect(live().exampleMessage).toBe(moveBlock(text, 1, 0))
    })

    test('the first block cannot move up and the last cannot move down', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        await openMenu(0)
        expect((part('studio-example-move-up') as HTMLButtonElement).disabled).toBe(true)
        expect((part('studio-example-move-down') as HTMLButtonElement).disabled).toBe(false)
        menuButtons()[0].click()
        flushSync()
        await openMenu(1)
        expect((part('studio-example-move-down') as HTMLButtonElement).disabled).toBe(true)
    })
})

// ---------------------------------------------------------------- the text view

describe('F4 the text view', () => {
    async function showText(): Promise<void> {
        ;(part('studio-example-view-text') as HTMLButtonElement).click()
        await settle()
    }

    test('X-10 a one-line edit on mixed endings changes only that line; switching writes nothing', async () => {
        const rig = await mountWith('a\r\nb\nc')
        await showText()
        expect(textView().value).toBe('a\nb\nc')
        expect(h.marks).toBe(0)
        typeIn(textView(), 'a\nB\nc', { caret: 3 })
        expect(live().exampleMessage).toBe('a\r\nB\nc')
        expect(h.marks).toBe(1)
        expect(stepsOf(rig.service)).toHaveLength(1)
    })

    test('X-10 a trailing-blank-only edit is written as one step', async () => {
        const rig = await mountWith('a\nb')
        await showText()
        typeIn(textView(), 'a\nb\n')
        expect(live().exampleMessage).toBe('a\nb\n')
        expect(h.marks).toBe(1)
        expect(stepsOf(rig.service)).toHaveLength(1)
    })

    test.each([
        ['LF', '<START>\nA\n<START>\nB', '<START>\nAx\nB'],
        ['CRLF', '<START>\r\nA\r\n<START>\r\nB', '<START>\r\nAx\r\nB'],
    ])('X-10 and AS16 removing a start line in the text view (%s) is its own step, not merged into the open one', async (_name, seed, expected) => {
        const rig = await mountWith(seed)
        await showText()
        typeIn(textView(), '<START>\nAx\n<START>\nB', { caret: 10 })
        expect(stepsOf(rig.service)).toHaveLength(1)
        typeIn(textView(), '<START>\nAx\nB', { inputType: 'deleteByCut' })
        expect(stepsOf(rig.service)).toHaveLength(2)
        expect(live().exampleMessage).toBe(expected)
    })

    test('X-10 adding a start line in the text view is its own step', async () => {
        const rig = await mountWith('a\nb')
        await showText()
        typeIn(textView(), 'ax\nb', { caret: 2 })
        expect(stepsOf(rig.service)).toHaveLength(1)
        typeIn(textView(), 'ax\n<START>\nb', { caret: 10 })
        expect(stepsOf(rig.service)).toHaveLength(2)
    })

    test('the list and the text show the same bytes after an edit in either', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        typeIn(cards()[0], 'AA')
        await showText()
        expect(textView().value).toBe('<START>\nAA\n<START>\nB')
    })
})

// ---------------------------------------------------------------- absent key

describe('F3 a character without an example text', () => {
    test('X-20 the form mounts empty; Add and text-view typing are refused with the refusal line and write nothing', async () => {
        const rig = await mountWith(undefined)
        expect(part('studio-example-empty')?.textContent).toBe('ltExEmpty')
        ;(part('studio-example-add') as HTMLButtonElement).click()
        await settle()
        expect(refusalLine()).toBe(refusalText('precondition'))
        expect('exampleMessage' in live()).toBe(false)
        ;(part('studio-example-view-text') as HTMLButtonElement).click()
        await settle()
        typeIn(textView(), 'typed')
        expect(refusalLine()).toBe(refusalText('precondition'))
        expect('exampleMessage' in live()).toBe(false)
        expect(h.marks).toBe(0)
        expect(stepsOf(rig.service)).toHaveLength(0)
    })
})

// ---------------------------------------------------------------- the focus layer on a card

describe('F3c the focus layer on an example card', () => {
    const nested = () => part('studio-lt-focus-input') as HTMLTextAreaElement
    const announced = () => part('studio-example-announce')?.textContent ?? ''

    async function openLayer(index = 0): Promise<void> {
        ;(parts('studio-lt-focus')[index] as HTMLButtonElement).click()
        flushSync()
        await settle()
        expect(nested()).not.toBeNull()
    }

    // A marker, an Enter and more text typed in the layer, as a keyboard would deliver them.
    function typeMarkerBlock(): void {
        typeIn(nested(), 'A\n<START>')
        typeIn(nested(), 'A\n<START>\n', { inputType: 'insertLineBreak' })
        typeIn(nested(), 'A\n<START>\nHello')
    }

    function keyOn(target: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
        flushSync()
    }

    test('X-15(i) a marker, Enter and text typed in the layer stay in the one card and land in the stored text as typed', async () => {
        const rig = await mountWith('<START>\nA')
        await openLayer()
        let inlineFocusIns = 0
        cards()[0].addEventListener('focusin', () => { inlineFocusIns += 1 })
        typeMarkerBlock()
        await settle()
        expect(inlineFocusIns).toBe(0)
        expect(document.activeElement).toBe(nested())
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nHello')
        expect(cards()).toHaveLength(1)
        expect(nested().value).toBe('A\n<START>\nHello')
        expect(refusalLine()).toBeUndefined()
        expect(stepsOf(rig.service).length).toBeGreaterThan(0)
    })

    test('X-15(ii) Esc splits at the marker, puts the caret in the new card and announces it, with no further write', async () => {
        const rig = await mountWith('<START>\nA')
        await openLayer()
        typeMarkerBlock()
        await settle()
        const marks = h.marks
        const steps = stepsOf(rig.service).length
        keyOn(nested(), 'Escape')
        await settle()
        expect(part('studio-lt-focus-layer')).toBeNull()
        expect(values()).toEqual(['A', 'Hello'])
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nHello')
        expect(document.activeElement).toBe(cards()[1])
        expect(cards()[1].selectionStart).toBe(5)
        expect(announced()).toContain('ltExSplit')
        expect(h.marks).toBe(marks)
        expect(stepsOf(rig.service)).toHaveLength(steps)
    })

    test('X-15(iii) the hardware Back, while composing, writes the composed text once into the same block before the layer closes', async () => {
        const rig = await mountWith('<START>\nA')
        await openLayer()
        typeMarkerBlock()
        await settle()
        compositionStart(nested())
        composeInto(nested(), 'A\n<START>\nHello안')
        const marks = h.marks
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nHello')
        expect(dispatchBack()).toBe(true)
        flushSync()
        await settle()
        expect(part('studio-lt-focus-layer')).toBeNull()
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nHello안')
        expect(h.marks).toBe(marks + 1)
        expect(values()).toEqual(['A', 'Hello안'])
        expect(stepsOf(rig.service).length).toBeGreaterThan(0)
    })

    test('X-15(iii) the header Back button takes focus before its click, so the held composition is written first', async () => {
        await mountWith('<START>\nA')
        await openLayer()
        typeMarkerBlock()
        await settle()
        compositionStart(nested())
        composeInto(nested(), 'A\n<START>\nHello안')
        const back = part('studio-lt-focus-close') as HTMLButtonElement
        back.focus()
        back.click()
        flushSync()
        await settle()
        expect(part('studio-lt-focus-layer')).toBeNull()
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nHello안')
        expect(values()).toEqual(['A', 'Hello안'])
    })

    test('X-15(iv) the layer opened by Ctrl+E holds the card whole and splits on close like the button does', async () => {
        await mountWith('<START>\nA')
        cards()[0].focus()
        keyOn(cards()[0], 'e', { ctrlKey: true })
        await settle()
        expect(nested()).not.toBeNull()
        typeMarkerBlock()
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nHello')
        expect(cards()).toHaveLength(1)
        expect(nested().value).toBe('A\n<START>\nHello')
        keyOn(nested(), 'Escape')
        await settle()
        expect(values()).toEqual(['A', 'Hello'])
    })

    test('DV-F3d a marker typed key by key, Enter and text stay one card until close, then the caret is in the new card', async () => {
        await mountWith('<START>\nA')
        await openLayer()
        const base = typeKeys(nested(), 'A\n', '<START>')
        expect(cards()).toHaveLength(1)
        typeIn(nested(), `${base}\n`, { inputType: 'insertLineBreak' })
        await settle()
        expect(cards()).toHaveLength(1)
        typeIn(nested(), `${base}\nHi`)
        await settle()
        expect(cards()).toHaveLength(1)
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nHi')
        keyOn(nested(), 'Escape')
        await settle()
        expect(values()).toEqual(['A', 'Hi'])
        expect(document.activeElement).toBe(cards()[1])
        expect(cards()[1].selectionStart).toBe(2)
    })

    test('a layer closed without a split announces nothing and leaves the caret in the same card', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        await openLayer(1)
        typeIn(nested(), 'B2')
        await settle()
        keyOn(nested(), 'Escape')
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nB2')
        expect(values()).toEqual(['A', 'B2'])
        expect(announced()).toBe('')
        expect(document.activeElement).toBe(cards()[1])
        expect(cards()[1].selectionStart).toBe(2)
    })

    test('X-16(L) a marker held in card 1 splits when focus moves to its Maximize button, and the layer opens on the split card', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        const second = cards()[1]
        second.focus()
        typeIn(second, 'B\n<START>')
        expect(cards()).toHaveLength(2)
        const opener = parts('studio-lt-focus')[1] as HTMLButtonElement
        opener.focus()
        await settle()
        expect(cards()).toHaveLength(3)
        expect(document.activeElement).toBe(opener)
        opener.click()
        flushSync()
        await settle()
        expect(nested().value).toBe('B')
        typeIn(nested(), 'B!')
        await settle()
        expect(live().exampleMessage).toBe('<START>\nA\n<START>\nB!\n<START>')
        keyOn(nested(), 'Escape')
        await settle()
        expect(values()).toEqual(['A', 'B!', ''])
        expect(announced()).toBe('')
    })

    test('a marker still held when the layer opens by Ctrl+E stays in the card while the layer is open and splits at close', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        const second = cards()[1]
        second.focus()
        typeIn(second, 'B\n<START>')
        expect(cards()).toHaveLength(2)
        keyOn(second, 'e', { ctrlKey: true })
        await settle()
        expect(nested().value).toBe('B\n<START>')
        expect(cards()).toHaveLength(2)
        keyOn(nested(), 'Escape')
        await settle()
        expect(cards()).toHaveLength(3)
        expect(announced()).toContain('ltExSplit')
        expect(document.activeElement).toBe(cards()[2])
    })

    test('after the layer has closed the inline rule applies again: an Enter after a typed marker splits at once', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        await openLayer(1)
        keyOn(nested(), 'Escape')
        await settle()
        const second = cards()[1]
        second.focus()
        typeIn(second, 'B\n<START>')
        expect(cards()).toHaveLength(2)
        typeIn(second, 'B\n<START>\n', { inputType: 'insertLineBreak' })
        await settle()
        expect(cards()).toHaveLength(3)
    })

    test('I-8 a peer edit inside the held card while the layer is open may split the view, but the next write lands in the shown card', async () => {
        await mountWith('<START>\nA')
        await openLayer()
        typeMarkerBlock()
        await settle()
        live().exampleMessage = '<START>\nAB\n<START>\nHello'
        flushSync()
        await settle()
        expect(cards()).toHaveLength(2)
        expect(nested().value).toBe('AB')
        typeIn(nested(), 'ABC')
        await settle()
        expect(live().exampleMessage).toBe('<START>\nABC\n<START>\nHello')
        keyOn(nested(), 'Escape')
        await settle()
        expect(values()).toEqual(['ABC', 'Hello'])
    })

    test('the layer of a card that goes away is released: a later marker typed in another card is held as usual', async () => {
        await mountWith('<START>\nA\n<START>\nB')
        await openLayer(1)
        live().exampleMessage = '<START>\nA'
        flushSync()
        await settle()
        expect(part('studio-lt-focus-layer')).toBeNull()
        const only = cards()[0]
        only.focus()
        typeIn(only, 'A\n<START>')
        expect(cards()).toHaveLength(1)
        expect(values()).toEqual(['A\n<START>'])
    })
})
