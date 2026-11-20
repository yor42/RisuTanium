// @vitest-environment jsdom

/**
 * A preflight sheet that mounts right after a file picker returned files takes one blur and refocus of Cancel, after the
 * window has settled and before its opening text is written. The picker is the REAL `selectFileByDom` from `util.ts`,
 * played by `util.domPickerHarness.ts`; a pass says nothing about TalkBack or native window focus.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(), appDataDir: vi.fn(), join: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 14 },
    readFile: vi.fn(async () => new Uint8Array()),
    open: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(),
    rename: vi.fn(),
    writeFile: vi.fn(),
}))
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], allowAllExtentionFiles: false })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({})),
}))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import PatternTask from './PatternTask.svelte'
import { createTaskController, taskMiB, type TaskClock, type TaskConfirm, type TaskController, type TaskView } from './taskProgress'
import { language } from '../../../lang'
import { selectFileByDom } from 'src/ts/util'
import { installDomPicker, type DomPicker } from 'src/ts/util.domPickerHarness'
import { PICK_RETURN_WINDOW_MS, resetPickOpenerForTest } from '../../../ts/pickOpener'

const steps = [{ label: 'Read file' }, { label: 'Add items' }]
const confirm: TaskConfirm = {
    headline: language.importPreflightHeadline(2),
    consequences: [language.importPreflightSize(taskMiB(22.5 * 1024 * 1024)), language.importPreflightAdds],
    cancelLabel: language.cancel,
    primaryLabel: language.importPreflightStart,
}
const OPENING = `${language.importPreflightHeadline(2)}. ${language.importPreflightSize('22.5 MiB')}`

const clock: TaskClock = {
    now: () => performance.now(),
    setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => { },
    hidden: () => false,
}

const mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []
let picker: DomPicker

interface Sheet {
    controller: TaskController
    target: HTMLElement
    onconfirm: ReturnType<typeof vi.fn>
}

function open(): Sheet {
    const controller = createTaskController({ title: 'Import', steps, onCancel: () => { }, confirm }, clock)
    const onconfirm = vi.fn()
    const props = $state({ view: controller.view as TaskView, lowPower: false, oncancel: () => { }, onanswer: () => { }, onconfirm, ondecline: () => { } })
    controller.subscribe((view) => { props.view = view })
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ target, app: mount(PatternTask, { target, props }) })
    flushSync()
    return { controller, target, onconfirm }
}

function part(target: HTMLElement, name: string): HTMLElement {
    return target.querySelector<HTMLElement>(`[data-part="${name}"]`)!
}

async function pickTwoFiles(): Promise<void> {
    const pending = selectFileByDom(['png'], 'multiple')
    picker.pick([new File([new Uint8Array([1])], 'a.png'), new File([new Uint8Array([2])], 'b.png')])
    await pending
}

interface FocusLog {
    events: string[]
    textAtFocus: string[]
}

/** Records focus and blur on `element`, and the status text each focus event saw. */
function watch(element: HTMLElement, status: HTMLElement): FocusLog {
    const log: FocusLog = { events: [], textAtFocus: [] }
    element.addEventListener('focus', () => {
        log.events.push('focus')
        log.textAtFocus.push(status.textContent ?? '')
    })
    element.addEventListener('blur', () => log.events.push('blur'))
    return log
}

/** Mounts a sheet and counts focus events on its Cancel from the first one, which `open` already fired. */
function openWatched(): { sheet: Sheet, log: FocusLog, cancel: HTMLElement, status: HTMLElement } {
    const sheet = open()
    const cancel = part(sheet.target, 'pattern-warn-cancel')
    const status = part(sheet.target, 'pattern-task-status')
    const log = watch(cancel, status)
    return { sheet, log, cancel, status }
}

beforeEach(() => {
    resetPickOpenerForTest()
    vi.useFakeTimers()
    picker = installDomPicker()
})

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app)
        target.remove()
    }
    picker.restore()
    resetPickOpenerForTest()
    vi.useRealTimers()
})

describe('the preflight sheet after a picker returned files', () => {
    // R307-2
    test('Cancel is blurred and refocused once after a frame plus 300 ms, and the opening text follows the refocus', async () => {
        await pickTwoFiles()
        const { log, cancel, status } = openWatched()
        expect(status.textContent).toBe('')
        vi.advanceTimersByTime(250)
        expect(log.events).toEqual([])
        vi.advanceTimersByTime(100)
        flushSync()
        expect(log.events).toEqual(['blur', 'focus'])
        expect(document.activeElement).toBe(cancel)
        // The text is not in the DOM at either focus event: it is written after the refocus.
        expect(log.textAtFocus).toEqual([''])
        expect(status.textContent).toBe(OPENING)
        vi.advanceTimersByTime(5000)
        expect(log.events).toEqual(['blur', 'focus'])
    })

    // R307-2b
    test('a pick that returned longer ago than the window gives no refocus', async () => {
        await pickTwoFiles()
        vi.advanceTimersByTime(PICK_RETURN_WINDOW_MS + 1)
        const { log, status } = openWatched()
        vi.advanceTimersByTime(1000)
        flushSync()
        expect(log.events).toEqual([])
        expect(status.textContent).toBe(OPENING)
    })

    // R307-2b
    test('one pick refocuses only the first of two sheets that open after it', async () => {
        await pickTwoFiles()
        const first = open()
        const second = openWatched()
        vi.advanceTimersByTime(1000)
        flushSync()
        expect(second.log.events).toEqual([])
        expect(first.target.querySelector('[data-part="pattern-warn-cancel"]')).not.toBeNull()
    })

    // R307-2c
    test('no refocus when focus has moved off Cancel before the delay', async () => {
        await pickTwoFiles()
        const { sheet, log, cancel } = openWatched()
        const primary = part(sheet.target, 'pattern-warn-primary')
        primary.focus()
        vi.advanceTimersByTime(1000)
        flushSync()
        expect(document.activeElement).toBe(primary)
        expect(log.events).toEqual(['blur'])
        expect(cancel).not.toBe(document.activeElement)
    })

    // R307-3, a compatibility guard: it passes before and after the change.
    test('guard: without a pick Cancel sees no blur and no second focus', () => {
        const { log, cancel } = openWatched()
        vi.advanceTimersByTime(1000)
        flushSync()
        expect(log.events).toEqual([])
        expect(document.activeElement).toBe(cancel)
    })

    // R307-3b, a compatibility guard: it passes before and after the change.
    test('guard: the arm guard is not restarted by the refocus', async () => {
        await pickTwoFiles()
        const { sheet } = openWatched()
        const primary = part(sheet.target, 'pattern-warn-primary')
        vi.advanceTimersByTime(200)
        primary.click()
        expect(sheet.onconfirm).not.toHaveBeenCalled()
        vi.advanceTimersByTime(60)
        primary.click()
        expect(sheet.onconfirm).toHaveBeenCalledTimes(1)
    })
})
