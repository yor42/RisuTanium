// @vitest-environment jsdom
/**
 * The raw text view of the toggle builder, mounted through the builder over a real history service on the memory
 * doubles. Texts are the strings the classic textarea stores, LF and CRLF.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

interface LiveCharacter {
    chaId: string
    type: string
    name: string
    license?: string
    customModuleToggle?: string
    chats: { id: string, note: string }[]
    chatPage: number
}

const db = $state({ db: { characters: [] as LiveCharacter[] } })
const selection = $state({ selId: 0 })

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
    for (const key of [
        'studioTgDeleted', 'studioTgMoved', 'studioTgOptionN', 'studioTgSummarySelect', 'studioTgSummaryGroup', 'studioTgUnreadableCount', 'studioTgLineN',
        'studioTgCarryAskKey', 'studioTgCarryAskOptions', 'studioTgCarryAskKind', 'studioTgCarryAskDrop', 'studioTgCarryAskUnclear',
        'studioTgCarryAskOptionsLate', 'studioTgCarryAskOptionsLateRenamed', 'studioTgCarryOverwrite', 'studioTgCarryShared', 'studioTgCarryOldStays',
    ]) own[key] = withArguments(key)
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { flushStudioFields } from 'src/ts/studio/fieldFlush'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { compositionEnd, compositionStart, composeText } from '../../ts/ime/tests/imeEventSequence'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
import type { ToggleTextPort } from '../../ts/studio/edit/toggleTextPort'
import { createToggleBuilder } from '../../ts/studio/toggleBuilder.svelte'
import { resetToggleCarrySessionForTests } from '../../ts/studio/toggleCarryPending'
import { textOf } from '../../ts/studio/toggleDef'
import StudioToggleBuilder from './StudioToggleBuilder.svelte'
import StudioToggleText from './StudioToggleText.svelte'

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

interface Rig {
    clock: FakeClock
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
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return { clock, service }
}

let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []

function mountBuilder(): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioToggleBuilder, { target: host, props: { target: { kind: 'character', chaId: 'A' } } }), host })
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
const area = () => part('studio-toggle-textarea') as HTMLTextAreaElement
const text = () => db.db.characters[0].customModuleToggle ?? ''
const steps = (rig: Rig) => rig.service.view(A).done.length

function typeInto(field: HTMLTextAreaElement, value: string): void {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function setText(value: string | undefined): void {
    db.db.characters = [{ chaId: 'A', type: 'character', name: 'Alice', customModuleToggle: value, chats: [], chatPage: 0 }]
}

// Opens the text view of a text over a fresh rig.
async function openText(value: string): Promise<Rig> {
    setText(value)
    const rig = makeRig()
    mountBuilder()
    await settle()
    part('studio-toggle-view-text')?.click()
    await settle()
    return rig
}

class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve(): void {}
    disconnect(): void {}
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 0 })
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selection.selId = 0
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
})

afterEach(async () => {
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
    await unmountAll()
    localStorage.clear()
    resetToggleCarrySessionForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
})

describe('R-D1 the text view writes what is typed', () => {
    test('a new line is written and the other lines keep their bytes, as one step marked for saving', async () => {
        const rig = await openText('a=A\nb=B\n')
        expect(area().value).toBe('a=A\nb=B\n')
        typeInto(area(), 'a=A\nb=B\nx=X\n')
        await settle()
        expect(text()).toBe('a=A\nb=B\nx=X\n')
        expect(steps(rig)).toBe(1)
        expect(h.marks).toBeGreaterThan(0)
    })

    test('showing the view and leaving it writes nothing', async () => {
        const rig = await openText('a=A\r\nb=B\r\n')
        part('studio-toggle-view-list')?.click()
        await settle()
        expect(part('studio-toggle-textarea')).toBeNull()
        expect(text()).toBe('a=A\r\nb=B\r\n')
        expect(steps(rig)).toBe(0)
        expect(h.marks).toBe(0)
    })

    test('typing a value that equals the saved text writes nothing', async () => {
        const rig = await openText('a=A\r\nb=B\r\n')
        typeInto(area(), 'a=A\nb=B\n')
        await settle()
        expect(steps(rig)).toBe(0)
        expect(h.marks).toBe(0)
    })

    test('typing keeps the view in step with the written text', async () => {
        await openText('a=A\n')
        typeInto(area(), 'a=A\nb=B\n')
        await settle()
        expect(area().value).toBe('a=A\nb=B\n')
        expect(part('studio-toggle-text-held')).toBeNull()
    })
})

describe('R-D2 and T-1 a CRLF text keeps its carriage returns', () => {
    test('the field shows no carriage return, and editing line 2 keeps the \\r of every other line', async () => {
        const rig = await openText('a=A\r\nb=B\r\nc=C\r\n')
        expect(area().value).toBe('a=A\nb=B\nc=C\n')
        typeInto(area(), 'a=A\nb=Bee\nc=C\n')
        await settle()
        expect(text()).toBe('a=A\r\nb=Bee\r\nc=C\r\n')
        expect(steps(rig)).toBe(1)
    })

    test('a line typed at the end of a CRLF text is written with the text ending', async () => {
        await openText('a=A\r\nb=B\r\n')
        typeInto(area(), 'a=A\nb=B\nd=D\n')
        await settle()
        expect(text()).toBe('a=A\r\nb=B\r\nd=D\r\n')
    })

    test('an LF text stays LF', async () => {
        await openText('a=A\nb=B\n')
        typeInto(area(), 'a=A\nb=Bee\n')
        await settle()
        expect(text()).toBe('a=A\nb=Bee\n')
    })
})

describe('R-D3 the gutter marks', () => {
    test('an unreadable line has an error mark at its own number, and the mark follows an edit', async () => {
        await openText('a=A\nbroken\n')
        const errors = () => parts('studio-toggle-mark').filter((mark) => mark.dataset.severity === 'error').map((mark) => mark.dataset.line)
        expect(errors()).toEqual(['2'])
        typeInto(area(), 'n=N\na=A\nbroken\n')
        await settle()
        expect(errors()).toEqual(['3'])
    })

    test('a mark carries its message as accessible text, with the line number', async () => {
        await openText('a=A=select=x,y=tail\n')
        const mark = parts('studio-toggle-mark').find((candidate) => candidate.dataset.code === 'partsBeyondFour')
        expect(mark?.dataset.severity).toBe('warning')
        expect(mark?.querySelector('.sr-only')?.textContent).toBe('studioTgLineN(1): studioTgMarkPartsBeyondFour')
    })

    test('the gutter has a number for every line of the field', async () => {
        await openText('a=A\nb=B\n')
        expect(part('studio-toggle-gutter')?.children.length).toBe(3)
    })
})

describe('R-F5 a key rename in the text view', () => {
    test('a key-renaming text edit is written with no hold, and leaving the text view shows the banner', async () => {
        const rig = await openText('a=A\nb=B\n')
        typeInto(area(), 'z=A\nb=B\n')
        await settle()
        expect(text()).toBe('z=A\nb=B\n')
        expect(steps(rig)).toBe(1)
        expect(part('studio-toggle-text-held')).toBeNull()
        expect(part('studio-toggle-carry')).toBeNull()
        area().dispatchEvent(new FocusEvent('blur'))
        await settle()
        expect(part('studio-toggle-carry')).not.toBeNull()
        expect(part('studio-toggle-carry-line')?.dataset.kind).toBe('key')
    })

    test('the last typed text is the one written', async () => {
        await openText('a=A\nb=B\n')
        typeInto(area(), 'z=A\nb=B\n')
        typeInto(area(), 'a=A\nb=B\nc=C\n')
        await settle()
        expect(text()).toBe('a=A\nb=B\nc=C\n')
    })
})

describe('R-D5 the selection follows the view switch', () => {
    const row = (index: number) => parts('studio-toggle-row')[index]

    test('list to text puts the caret at the start of the open row', async () => {
        setText('a=A\r\nbb=B\r\nc=C\r\n')
        makeRig()
        mountBuilder()
        await settle()
        row(1).click()
        flushSync()
        part('studio-toggle-view-text')?.click()
        await settle()
        expect(area().selectionStart).toBe(area().value.indexOf('bb=B'))
    })

    test('text to list opens the row under the caret; an untouched caret leaves the selection alone', async () => {
        setText('a=A\nb=B\n\nc=C\n')
        makeRig()
        mountBuilder()
        await settle()
        row(0).click()
        flushSync()
        part('studio-toggle-view-text')?.click()
        await settle()
        part('studio-toggle-view-list')?.click()
        await settle()
        expect((part('studio-toggle-label') as HTMLInputElement).value).toBe('A')
        part('studio-toggle-view-text')?.click()
        await settle()
        area().dispatchEvent(new FocusEvent('focus'))
        area().setSelectionRange(area().value.indexOf('c=C') + 1, area().value.indexOf('c=C') + 1)
        part('studio-toggle-view-list')?.click()
        await settle()
        expect((part('studio-toggle-label') as HTMLInputElement).value).toBe('C')
    })

    test('switching with nothing open and the caret untouched opens nothing', async () => {
        setText('a=A\nb=B\n')
        makeRig()
        mountBuilder()
        await settle()
        part('studio-toggle-view-text')?.click()
        await settle()
        part('studio-toggle-view-list')?.click()
        await settle()
        expect(part('studio-toggle-editor')).toBeNull()
    })

    test('a caret on a blank line selects the row above it', async () => {
        setText('a=A\nb=B\n\nc=C\n')
        makeRig()
        mountBuilder()
        await settle()
        part('studio-toggle-view-text')?.click()
        await settle()
        area().dispatchEvent(new FocusEvent('focus'))
        const blank = area().value.indexOf('\n\n') + 1
        area().setSelectionRange(blank, blank)
        part('studio-toggle-view-list')?.click()
        await settle()
        expect((part('studio-toggle-label') as HTMLInputElement).value).toBe('B')
    })
})

describe('R-D6 an IME composition in the field', () => {
    test('nothing is written while composing; the end writes the composed text once', async () => {
        const rig = await openText('a=A\n')
        compositionStart(area())
        composeText(area(), 'a=A\nb=ㅎ')
        composeText(area(), 'a=A\nb=하')
        flushSync()
        await settle()
        expect(text()).toBe('a=A\n')
        expect(steps(rig)).toBe(0)
        area().value = 'a=A\nb=한'
        compositionEnd(area(), 'a=A\nb=한')
        await settle()
        expect(text()).toBe('a=A\nb=한')
        expect(steps(rig)).toBe(1)
    })

    test('a composition cut off by leaving the view writes the held text', async () => {
        await openText('a=A\n')
        compositionStart(area())
        composeText(area(), 'a=A\nb=하')
        await unmountAll()
        await settle()
        expect(text()).toBe('a=A\nb=하')
    })

    test('a page hide writes a held composition', async () => {
        await openText('a=A\n')
        compositionStart(area())
        composeText(area(), 'a=A\nb=하')
        expect(text()).toBe('a=A\n')
        flushStudioFields('hide')
        await settle()
        expect(text()).toBe('a=A\nb=하')
    })
})

describe('G-D1 format help and the read-only text', () => {
    test('the help lists one example line per type', async () => {
        await openText('a=A\n')
        const examples = parts('studio-toggle-format-example').map((example) => [example.dataset.kind, example.textContent])
        expect(examples).toEqual([
            ['check', 'key=Name'],
            ['select', 'key=Name=select=A,B'],
            ['text', 'key=Name=text'],
            ['textarea', 'key=Name=textarea'],
            ['group', 'key=Name=group'],
            ['divider', '=Name=divider'],
            ['caption', '=Name=caption'],
        ])
    })

    test('a text with a carriage return inside a line is read-only and says why', async () => {
        const rig = await openText('a=A\rX\nb=B\n')
        expect(area().readOnly).toBe(true)
        expect(part('studio-toggle-text-cr')).not.toBeNull()
        typeInto(area(), 'a=A\rX\nb=B\nc=C\n')
        await settle()
        expect(text()).toBe('a=A\rX\nb=B\n')
        expect(steps(rig)).toBe(0)
    })

    test('an ordinary text is editable and shows no such note', async () => {
        await openText('a=A\r\nb=B\r')
        expect(area().readOnly).toBe(false)
        expect(part('studio-toggle-text-cr')).toBeNull()
    })
})

describe('R-D4 a refused, unavailable or read-only write', () => {
    interface PortProbe {
        port: ToggleTextPort
        writes: string[]
        closes: { count: number }
    }

    // A port over a fixed saved text whose write answers with the given result.
    function probePort(saved: string, answer: StudioResult | null): PortProbe {
        const writes: string[] = []
        const closes = { count: 0 }
        const port: ToggleTextPort = {
            owner: A,
            begin() {},
            read: () => saved,
            view: () => ({ editable: true, banner: null, restricted: false }),
            write(next) {
                writes.push(next)
                return answer
            },
            closeOpenStep() { closes.count += 1 },
        }
        return { port, writes, closes }
    }

    function mountText(probe: PortProbe, editable: boolean) {
        const builder = createToggleBuilder(probe.port, { keyEditsLive: true, stem: 'x', appKeys: new Set<string>() })
        const host = document.createElement('div')
        document.body.appendChild(host)
        mounted.push({ app: mount(StudioToggleText, { target: host, props: { builder, port: probe.port, editable } }), host })
        flushSync()
        return builder
    }

    test('T-D4r typed text stays in the field across an outside change after a refused write, and leaving the field shows the saved text', async () => {
        const probe = probePort('a=A\nb=B\n', { ok: false, reason: 'not-selected' })
        const builder = mountText(probe, true)
        typeInto(area(), 'z=A\nb=B\n')
        await settle()
        builder.resync('a=A\nb=B\nq=Q\n')
        await settle()
        expect(area().value).toBe('z=A\nb=B\n')
        area().dispatchEvent(new FocusEvent('blur'))
        await settle()
        expect(area().value).toBe('a=A\nb=B\nq=Q\n')
        expect(part('studio-toggle-text-error')).toBeNull()
    })

    test('a refused write stores nothing, keeps the typed text, shows the refusal and leaves the saved definition alone', async () => {
        const probe = probePort('a=A\n', { ok: false, reason: 'not-selected' })
        const builder = mountText(probe, true)
        typeInto(area(), 'a=A\nb=B\n')
        await settle()
        expect(probe.writes).toEqual(['a=A\nb=B\n'])
        expect(area().value).toBe('a=A\nb=B\n')
        expect(part('studio-toggle-text-error')?.textContent).toBe('studioRefusalNotSelected')
        expect(textOf(builder.def)).toBe('a=A\n')
    })

    test('a landed write takes the written text into the definition and clears any alert', async () => {
        const probe = probePort('a=A\n', { ok: true })
        const builder = mountText(probe, true)
        typeInto(area(), 'a=A\nb=B\n')
        await settle()
        expect(probe.writes).toEqual(['a=A\nb=B\n'])
        expect(textOf(builder.def)).toBe('a=A\nb=B\n')
        expect(area().value).toBe('a=A\nb=B\n')
        expect(part('studio-toggle-text-error')).toBeNull()
    })

    test('a write path that is not there keeps the typed text and shows the loading refusal', async () => {
        const probe = probePort('a=A\n', null)
        const builder = mountText(probe, true)
        typeInto(area(), 'a=A\nb=B\n')
        await settle()
        expect(area().value).toBe('a=A\nb=B\n')
        expect(part('studio-toggle-text-error')?.textContent).toBe('studioRefusalLoading')
        expect(textOf(builder.def)).toBe('a=A\n')
    })

    test('leaving the field after a refusal shows the saved text again and clears the alert', async () => {
        const probe = probePort('a=A\n', { ok: false, reason: 'not-selected' })
        mountText(probe, true)
        typeInto(area(), 'a=A\nb=B\n')
        await settle()
        area().dispatchEvent(new FocusEvent('blur'))
        await settle()
        expect(part('studio-toggle-text-error')).toBeNull()
        expect(area().value).toBe('a=A\n')
    })

    test('a field that is not editable is read-only and typing writes nothing', async () => {
        const probe = probePort('a=A\n', { ok: true })
        mountText(probe, false)
        expect(area().readOnly).toBe(true)
        typeInto(area(), 'a=A\nb=B\n')
        await settle()
        expect(probe.writes).toEqual([])
    })

    test('leaving the field closes the open history step', async () => {
        const probe = probePort('a=A\n', { ok: true })
        mountText(probe, true)
        const before = probe.closes.count
        area().dispatchEvent(new FocusEvent('blur'))
        await settle()
        expect(probe.closes.count).toBe(before + 1)
    })

    test('the gutter shows no marks while the field holds text that is not the saved text', async () => {
        const probe = probePort('a=A\nbroken\n', { ok: false, reason: 'not-selected' })
        mountText(probe, true)
        expect(parts('studio-toggle-mark').length).toBe(1)
        typeInto(area(), 'a=A\nbroken\nc=C\n')
        await settle()
        expect(parts('studio-toggle-mark').length).toBe(0)
    })
})
