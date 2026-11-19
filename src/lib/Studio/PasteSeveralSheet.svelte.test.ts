// @vitest-environment jsdom
/**
 * The paste-several sheet of the first-message cards over a real history service on the memory doubles: the text is
 * split by the shared splitter, Add is one greetingAppendMany step, and nothing the sheet holds reaches the service
 * before Add.
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
    return { language: helpers.studioLanguageMock() }
})

import { dispatchBack } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { refusalText } from 'src/ts/studio/edit/studioToasts'
import { splitPastedMessages } from 'src/ts/studio/longText/pasteSplit'
import { createMacroIndex } from 'src/ts/studio/longText/macroIndex'
import { setMacroIndexForTests } from 'src/ts/studio/longText/macroIndexService'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
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
const pasteButton = () => part('studio-greeting-paste') as HTMLButtonElement
const sheet = () => part('studio-paste-sheet')
const area = () => part('studio-paste-input') as HTMLTextAreaElement
const addButton = () => part('studio-paste-add') as HTMLButtonElement
const stepsOf = (service: OwnerHistoryService) => service.view(A).done

function live(): LiveCharacter {
    return db.db.characters[0]
}

async function openSheet(): Promise<void> {
    pasteButton().click()
    await settle()
}

function typeInto(text: string, init: InputEventInit = {}): void {
    area().value = text
    area().dispatchEvent(new InputEvent('input', { bubbles: true, ...init }))
    flushSync()
}

async function toggleDash(): Promise<void> {
    const box = part('studio-paste-dash') as HTMLInputElement
    box.click()
    await settle()
}

function escape(target: HTMLElement): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    flushSync()
    return event
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
    setMacroIndexForTests(null)
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// ---------------------------------------------------------------- rows

describe('F2 paste several', () => {
    test('F2-S1 `a\\n\\n\\nb\\n\\nc` counts 2; Add is one greetingAppendMany step with the exact slices, closes the sheet and focuses the first new card', async () => {
        const rig = makeRig()
        const spy = vi.spyOn(rig.service, 'greetingAppendMany')
        mountForm()
        await settle()
        await openSheet()
        expect(sheet()?.getAttribute('role')).toBe('dialog')
        expect(document.activeElement).toBe(area())
        typeInto('a\n\n\nb\n\nc')
        expect(part('studio-paste-count')?.textContent).toBe('ltPasteCount(2)')
        addButton().click()
        await settle()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy.mock.calls[0][1]).toEqual(['a', 'b\n\nc'])
        expect(live().alternateGreetings).toEqual(['A', 'B', 'C', 'a', 'b\n\nc'])
        expect(stepsOf(rig.service)).toHaveLength(1)
        expect(stepsOf(rig.service)[0].label).toEqual({ kind: 'greetingAddMany', count: 2 })
        expect(h.marks).toBe(1)
        expect(sheet()).toBeNull()
        expect(document.activeElement).toBe(inputs()[3])
        expect(part('studio-card-announce')?.textContent).toBe('ltPasteAdded(2)')
    })

    test('F2-S2 the dash checkbox changes the rule and its text; fences hold; the result equals a direct splitPastedMessages call', async () => {
        const rig = makeRig()
        const spy = vi.spyOn(rig.service, 'greetingAppendMany')
        mountForm()
        await settle()
        await openSheet()
        const text = 'a\n---\nb\n\nc'
        typeInto(text)
        expect(part('studio-paste-count')?.textContent).toBe('ltPasteCount(1)')
        const blankRule = part('studio-paste-rule')?.textContent
        await toggleDash()
        expect(part('studio-paste-count')?.textContent).toBe('ltPasteCount(2)')
        expect(part('studio-paste-rule')?.textContent).not.toBe(blankRule)
        addButton().click()
        await settle()
        expect(spy.mock.calls[0][1]).toEqual(splitPastedMessages(text, { splitOn: 'dash-lines' }))
        expect(spy.mock.calls[0][1]).toEqual(['a', 'b\n\nc'])
        await openSheet()
        expect((part('studio-paste-dash') as HTMLInputElement).checked).toBe(false)
        const fenced = '```\nx\n\n\ny\n```'
        typeInto(fenced)
        expect(part('studio-paste-count')?.textContent).toBe('ltPasteCount(1)')
        expect(splitPastedMessages(fenced, { splitOn: 'blank-lines' })).toHaveLength(1)
    })

    test('F2-S3 blank lines only: Add is disabled; Close makes 0 calls, steps and marks; reopening shows an empty sheet; focus returns to the button', async () => {
        const rig = makeRig()
        const spy = vi.spyOn(rig.service, 'greetingAppendMany')
        mountForm()
        await settle()
        await openSheet()
        expect(addButton().disabled).toBe(true)
        typeInto('\n\n\n   \n')
        expect(addButton().disabled).toBe(true)
        expect(part('studio-paste-count')?.textContent).toBe('ltPasteCount(0)')
        ;(part('studio-paste-cancel') as HTMLButtonElement).click()
        await settle()
        expect(sheet()).toBeNull()
        expect(spy).not.toHaveBeenCalled()
        expect(stepsOf(rig.service)).toHaveLength(0)
        expect(h.marks).toBe(0)
        expect(document.activeElement).toBe(pasteButton())
        await openSheet()
        expect(area().value).toBe('')
    })

    test('F2-S4 a refusal keeps the sheet and its text, shows the line and appends nothing', async () => {
        const rig = makeRig()
        const spy = vi.spyOn(rig.service, 'greetingAppendMany').mockReturnValue({ ok: false, reason: 'precondition' })
        mountForm()
        await settle()
        await openSheet()
        typeInto('x\n\n\ny')
        addButton().click()
        await settle()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(sheet()).not.toBeNull()
        expect(area().value).toBe('x\n\n\ny')
        expect(part('studio-paste-refusal')?.textContent).toBe(refusalText('precondition'))
        expect(part('studio-form-refusal')?.textContent).toBe(refusalText('precondition'))
        expect(live().alternateGreetings).toEqual(['A', 'B', 'C'])
        expect(stepsOf(rig.service)).toHaveLength(0)
        expect(h.marks).toBe(0)
    })

    test('F2-S5 Esc closes only the sheet and returns focus to the button; Back closes the sheet first and the next Back is not the sheet\'s', async () => {
        makeRig()
        mountForm()
        await settle()
        await openSheet()
        const event = escape(area())
        await settle()
        expect(sheet()).toBeNull()
        expect(document.activeElement).toBe(pasteButton())
        expect(event.defaultPrevented).toBe(true)
        const stopped = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        const stop = vi.spyOn(stopped, 'stopPropagation')
        await openSheet()
        area().dispatchEvent(stopped)
        flushSync()
        expect(stop).toHaveBeenCalledTimes(1)
        await openSheet()
        expect(dispatchBack()).toBe(true)
        flushSync()
        await settle()
        expect(sheet()).toBeNull()
        expect(document.activeElement).toBe(pasteButton())
        expect(dispatchBack()).toBe(false)
    })

    test('an Escape that cancels an IME composition does not close the sheet', async () => {
        makeRig()
        mountForm()
        await settle()
        await openSheet()
        const event = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, isComposing: true, bubbles: true, cancelable: true })
        area().dispatchEvent(event)
        flushSync()
        expect(sheet()).not.toBeNull()
        expect(event.defaultPrevented).toBe(false)
    })

    test('F2-S6 composing updates the count with 0 calls; the written values are byte-equal to the slices (no trimming inside a message)', async () => {
        const rig = makeRig()
        const spy = vi.spyOn(rig.service, 'greetingAppendMany')
        mountForm()
        await settle()
        await openSheet()
        area().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto('한\n\n\n글', { isComposing: true, inputType: 'insertCompositionText' })
        expect(part('studio-paste-count')?.textContent).toBe('ltPasteCount(2)')
        expect(spy).not.toHaveBeenCalled()
        area().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        typeInto('  a \nb\n\n\n  c  ')
        const typed = area().value
        addButton().click()
        await settle()
        expect(spy.mock.calls[0][1]).toEqual(splitPastedMessages(typed, { splitOn: 'blank-lines' }))
        expect(live().alternateGreetings.slice(3)).toEqual(['  a \nb', '  c  '])
    })

    test('F2-RO the entry is disabled while the owner loads, and the sheet cannot be opened', async () => {
        const rig = makeRig()
        const gate = createGate()
        rig.claim.hook = () => gate.promise
        const spy = vi.spyOn(rig.service, 'greetingAppendMany')
        mountForm()
        await settle()
        expect(pasteButton().disabled).toBe(true)
        pasteButton().click()
        flushSync()
        expect(sheet()).toBeNull()
        expect(spy).not.toHaveBeenCalled()
        gate.release()
        await settle()
    })
})
