// @vitest-environment jsdom
/**
 * The token bias list form over a real history service on the memory doubles (T2-BI-UI, T2-BI-UI-5, T2-BI-UI-6 and the
 * blur case of T2-BI-6; diagnostics). Every change is one `editField` of the registered path; the clamp and the zeroed
 * notes, the exact-string duplicate note, the phone card attribute, the delete toast and the read-only list for an
 * unreadable value are checked on the DOM. The toast host is the real one on a fake clock.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

const db = $state({ db: { characters: [] as Record<string, unknown>[] } })
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
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, resetToastHostForTests, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioBiasList from './StudioBiasList.svelte'

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function fakeToastClock(): ToastClock {
    let time = 0
    return { now: () => time, after: () => () => {} }
}

interface Rig {
    service: OwnerHistoryService
    host: ToastHost
}

let mounted: { app: ReturnType<typeof mount>; target: HTMLElement }[] = []

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

async function open(bias: unknown, options: { hostFor?: (real: ToastHost) => ToastHost; editable?: boolean } = {}): Promise<Rig> {
    db.db.characters = [{ chaId: 'A', type: 'character', name: 'Alice', bias, chats: [], chatPage: 0 }]
    const real = createToastHost({ clock: fakeToastClock() })
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
    await service.whenReady(A)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const host = options.hostFor ? options.hostFor(real) : real
    const app = mount(StudioBiasList, { target, props: { chaId: 'A', owner: A, service, editable: options.editable ?? true, host } })
    mounted.push({ app, target })
    await settle()
    return { service, host: real }
}

const live = (): { bias: unknown } => db.db.characters[0] as { bias: unknown }
const bytes = (): string => JSON.stringify(live().bias)
const tokens = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>('[data-bias-token]')]
const values = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>('[data-bias-value]')]
const rowsEls = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-part="studio-bias-row"]')]
const deletes = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('[data-bias-delete]')]
const addButton = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-bias-add]')!
const notes = (): string[] => [...document.querySelectorAll('[role="note"]')].map((element) => element.textContent ?? '')

function type(field: HTMLInputElement, value: string): void {
    field.value = value
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    flushSync()
}

function commitValue(field: HTMLInputElement, value: string): void {
    field.value = value
    field.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

beforeEach(() => {
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
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.target.remove()
    }
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('T2-BI-UI: the rows, the notes and the layout', () => {
    test('mounting shows one row per token and writes nothing', async () => {
        const { service } = await open([['a', 1], ['b', -2]])
        expect(tokens().map((field) => field.value)).toEqual(['a', 'b'])
        expect(values().map((field) => field.value)).toEqual(['1', '-2'])
        expect(rowsEls()).toHaveLength(2)
        expect(h.marks).toBe(0)
        expect(service.view(A).done).toHaveLength(0)
    })

    test('Add appends [empty, 0] as one step of its own', async () => {
        const { service } = await open([['a', 1]])
        addButton().click()
        flushSync()
        expect(live().bias).toEqual([['a', 1], ['', 0]])
        addButton().click()
        flushSync()
        expect(service.view(A).done).toHaveLength(2)
    })

    test('a value of 250 is stored as 100 and shows the clamp note', async () => {
        await open([['a', 1]])
        commitValue(values()[0], '250')
        expect(live().bias).toEqual([['a', 100]])
        expect(values()[0].value).toBe('100')
        expect(notes()).toEqual(['studioBiasClamp'])
    })

    test('an emptied value is stored as 0 and shows the zeroed note', async () => {
        await open([['a', 5]])
        commitValue(values()[0], '')
        expect(live().bias).toEqual([['a', 0]])
        expect(values()[0].value).toBe('0')
        expect(notes()).toEqual(['studioBiasZeroed'])
    })

    test('an ordinary value is stored as typed and clears an earlier note; each commit is a step of its own', async () => {
        const { service } = await open([['a', 5]])
        commitValue(values()[0], '250')
        commitValue(values()[0], '7')
        expect(live().bias).toEqual([['a', 7]])
        expect(notes()).toEqual([])
        expect(service.view(A).done).toHaveLength(2)
    })

    test('the clamp note and the duplicate note of one row are joined', async () => {
        await open([['a', 1], ['a', 2]])
        expect(notes()).toEqual(['studioBiasDup', 'studioBiasDup'])
        commitValue(values()[1], '999')
        expect(notes()).toEqual(['studioBiasDup', 'studioBiasClamp · studioBiasDup'])
    })

    test('the duplicate rule is the exact string: a leading space is another token', async () => {
        await open([['a', 1], [' a', 2]])
        expect(notes()).toEqual([])
        type(tokens()[1], 'a')
        expect(notes()).toEqual(['studioBiasDup', 'studioBiasDup'])
    })

    test('a phone (stack layout) shows each row as a card, a wide layout as a row', async () => {
        studioScreen.layout = 'stack'
        await open([['a', 1]])
        expect(rowsEls()[0].getAttribute('data-layout')).toBe('card')
        studioScreen.layout = 'wide'
        flushSync()
        expect(rowsEls()[0].getAttribute('data-layout')).toBe('row')
    })

    test('a read-only owner shows disabled rows', async () => {
        await open([['a', 1]], { editable: false })
        expect(tokens()[0].disabled).toBe(true)
        expect(values()[0].disabled).toBe(true)
        expect(addButton().disabled).toBe(true)
        expect(deletes()[0].disabled).toBe(true)
        expect(notes()).toEqual([])
    })
})

describe('T2-BI-6 (blur case): token typing coalesces per row and a blur closes the step', () => {
    test('typing is one step, a blur closes it, and the next keystroke is a new step', async () => {
        const { service } = await open([['a', 1], ['b', 2]])
        type(tokens()[0], 'a!')
        type(tokens()[0], 'a!!')
        expect(service.view(A).done).toHaveLength(1)
        tokens()[0].dispatchEvent(new FocusEvent('blur'))
        type(tokens()[0], 'a!!!')
        expect(service.view(A).done).toHaveLength(2)
        expect(live().bias).toEqual([['a!!!', 1], ['b', 2]])
    })

    test('typing in another row is a step of its own', async () => {
        const { service } = await open([['a', 1], ['b', 2]])
        type(tokens()[0], 'a!')
        type(tokens()[1], 'b!')
        expect(service.view(A).done).toHaveLength(2)
    })
})

describe('T2-BI-UI-5: the delete toast and the focus after a delete', () => {
    test('a delete removes the row and posts one toast whose Undo puts it back', async () => {
        const { host } = await open([['a', 1], ['b', 2]])
        deletes()[0].click()
        await settle()
        expect(live().bias).toEqual([['b', 2]])
        expect(host.visible).toHaveLength(1)
        expect(host.visible[0].text).toBe('studioBiasDeleted')
        await host.activate(host.visible[0].id)
        expect(live().bias).toEqual([['a', 1], ['b', 2]])
    })

    test('an undo of the delete by another way, then the toast, gives no duplicate row', async () => {
        // A host that ignores dismissal stands for a toast the host kept: only the step-on-top check is under test.
        const { service, host } = await open([['a', 1], ['b', 2]], { hostFor: (real) => ({ ...real, dismissUndo: () => {} }) })
        deletes()[0].click()
        await settle()
        expect((await service.replay(A, { kind: 'undo' })).ok).toBe(true)
        expect(live().bias).toEqual([['a', 1], ['b', 2]])
        expect(host.visible).toHaveLength(1)
        await host.activate(host.visible[0].id)
        expect(live().bias).toEqual([['a', 1], ['b', 2]])
        expect(service.view(A).done).toHaveLength(0)
    })

    test('a step that landed after the delete keeps the toast from undoing anything', async () => {
        // A host that ignores dismissal stands for a toast the host kept: only the step-on-top check is under test.
        const { service, host } = await open([['a', 1], ['b', 2]], { hostFor: (real) => ({ ...real, dismissUndo: () => {} }) })
        deletes()[0].click()
        await settle()
        commitValue(values()[0], '9')
        expect(live().bias).toEqual([['b', 9]])
        expect(host.visible).toHaveLength(1)
        await host.activate(host.visible[0].id)
        expect(live().bias).toEqual([['b', 9]])
        expect(service.view(A).done).toHaveLength(2)
    })

    test('a delete clears the notes, so a note never lands on a row that takes its index later', async () => {
        await open([['a', 1], ['b', 2]])
        commitValue(values()[1], '999')
        expect(notes()).toEqual(['studioBiasClamp'])
        deletes()[0].click()
        await settle()
        expect(tokens().map((field) => field.value)).toEqual(['b'])
        expect(notes()).toEqual([])
        addButton().click()
        flushSync()
        expect(tokens().map((field) => field.value)).toEqual(['b', ''])
        expect(notes()).toEqual([])
    })

    test('focus goes to the next row, else the previous row, else Add', async () => {
        await open([['a', 1], ['b', 2], ['c', 3]])
        deletes()[1].click()
        await settle()
        expect(document.activeElement).toBe(tokens()[1])
        expect(tokens()[1].value).toBe('c')
        deletes()[1].click()
        await settle()
        expect(document.activeElement).toBe(tokens()[0])
        expect(tokens()[0].value).toBe('a')
        deletes()[0].click()
        await settle()
        expect(document.activeElement).toBe(addButton())
    })
})

describe('T2-BI-UI-6 (AS-C6): an unreadable list is shown read-only and nothing is written', () => {
    test.each([
        ['a null cell', [['tok', null]], ['tok']],
        ['a 3-tuple', [['tok', 1, 'x']], ['tok']],
        ['a non-array', 'x', []],
    ])('%s: disabled inputs, Add and Delete, the unreadable line, no write, the bytes unchanged', async (_name, malformed, shownTokens) => {
        const { service } = await open(malformed)
        const before = bytes()
        expect(notes()).toEqual(['studioBiasUnreadable'])
        expect(tokens().map((field) => field.value)).toEqual(shownTokens)
        expect(addButton().disabled).toBe(true)
        for (const field of [...tokens(), ...values(), ...deletes()]) {
            expect(field.disabled).toBe(true)
        }
        addButton().click()
        type(tokens()[0] ?? document.createElement('input'), 'x')
        flushSync()
        expect(bytes()).toBe(before)
        expect(h.marks).toBe(0)
        expect(service.view(A).done).toHaveLength(0)
    })
})
