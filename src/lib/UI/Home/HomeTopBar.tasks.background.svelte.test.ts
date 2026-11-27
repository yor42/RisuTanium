// @vitest-environment jsdom

/**
 * The Tasks dialog's two tabs, mounted through `HomeTopBar.svelte`: Replies (the existing list) and Background (prompt
 * previews and tasks sent to the background).
 *
 * REAL: `HomeTopBar`, `HomeTasks`, `PatternDialog`, `chatOrigin` (registrations through `registerWork`, the way `sendChat`
 * makes them) and `alertTask` (tasks with the `background: true` definition the importers pass, shown through a fake
 * toast presenter on a manual clock).
 * MOCKED: `stores.svelte` (`DBState.db.characters` counts its reads) and `backgroundJobs`, wrapped so its calls count.
 *
 * Fixture FX-1 is the one of `HomeTopBar.tasks.svelte.test.ts`.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { registerWork, type WorkHandle } from 'src/ts/process/chatOrigin'
import { studioOpen } from 'src/ts/studio/studioOpen'
import type { TaskClock, TaskDef, TaskView } from 'src/lib/Nexus/pattern/taskProgress'

//#region module mocks

const store = vi.hoisted(() => ({
    characters: [] as Array<Record<string, unknown>>,
    reads: 0,
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const db = {
        visibleModes: ['rp', 'hybrid', 'utility'],
        hideUnusedModes: false,
        username: 'Juno',
        get characters() {
            store.reads++
            return store.characters
        },
    }
    return {
        DBState: { db },
        settingsOpen: writable(false),
        selectedCharID: writable(-1),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('./homeEmptyActions'), () => ({
    openPersonaSettings: vi.fn(),
}) as unknown as typeof import('./homeEmptyActions'))

vi.mock(import('src/ts/alertTask.svelte'), async (importActual) => {
    const actual = await importActual()
    return { ...actual, backgroundJobs: vi.fn(actual.backgroundJobs) }
})

//#endregion

import HomeTopBar from './HomeTopBar.svelte'
import { settingsOpen } from 'src/ts/stores.svelte'
import {
    alertTask,
    backgroundJobs,
    backgroundTask,
    resetTaskHostForTests,
    setTaskClockForTests,
    setTaskToastPresenter,
    taskReopened,
    taskShown,
    type TaskToastPresenter,
} from 'src/ts/alertTask.svelte'

const X = { chaId: 'cha-x', name: 'Xena', chats: [{ id: 'chat-a', name: 'Alpha' }, { id: 'chat-b', name: 'Beta' }, { id: 'chat-d', name: 'Delta' }] }
const Y = { chaId: 'cha-y', name: 'Yuri', chats: [{ id: 'chat-c', name: 'Gamma' }, { id: 'chat-e', name: 'Epsilon' }] }

const ALPHA = { chaId: 'cha-x', chatId: 'chat-a' }
const BETA = { chaId: 'cha-x', chatId: 'chat-b' }
const GAMMA = { chaId: 'cha-y', chatId: 'chat-c' }

const handles: WorkHandle[] = []
const instances: unknown[] = []
const targets: HTMLElement[] = []

function reg(origin: { chaId: string, chatId: string }, kind: 'reply' | 'preview' | 'work', stop?: () => void): WorkHandle {
    const handle = registerWork(origin, stop, kind)
    handles.push(handle)
    return handle
}

type Band = 'phone' | 'mid' | 'wide'

function mountBar(band: Band | { band: Band } = 'phone'): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    const props = typeof band === 'string' ? { band } : band
    instances.push(mount(HomeTopBar, { target, props }))
    flushSync()
    return target
}

const buttonOf = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[data-part="home-tasks-button"]')
const badgeOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-part="home-badge"]')
const dialogOf = () => document.querySelector<HTMLElement>('[data-part="pattern-dialog"]')
const tabsOf = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
const panelsOf = () => Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
const rowsOf = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="home-task-row"]'))
const stopsOf = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-part="home-run-stop"]'))
const opensOf = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-part="home-task-open"]'))
const cancelsOf = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-part="home-run-cancel"]'))
const closeOf = () => document.querySelector<HTMLButtonElement>('[data-part="home-dialog-action"]')
const statusOf = () => document.querySelector<HTMLElement>('[data-part="home-dialog"] [role="status"]')
const bodyOf = () => document.querySelector<HTMLElement>('[data-part="home-dialog-body"]')
const textsOf = (part: string) => rowsOf().map((row) => row.querySelector(`[data-part="${part}"]`)?.textContent)

function openDialog(root: HTMLElement): HTMLButtonElement {
    const button = buttonOf(root)!
    button.click()
    flushSync()
    expect(dialogOf()).not.toBeNull()
    return button
}

function selectTab(index: number): void {
    tabsOf()[index].click()
    flushSync()
}

function end(...list: WorkHandle[]): void {
    for (const handle of list) handle.end()
    flushSync()
}

function key(target: HTMLElement, name: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
    flushSync()
}

//#region background tasks

const def: TaskDef = {
    title: 'Import',
    subtitle: 'Characters',
    steps: [{ label: 'Read file' }, { label: 'Add items', noun: 'Assets' }],
    onCancel: () => { },
    background: true,
}

interface FakePresenter extends TaskToastPresenter {
    ends: Array<{ id: number, returnFocus: boolean }>
    updates: number
}

function fakePresenter(): FakePresenter {
    let nextId = 100
    const presenter: FakePresenter = {
        ends: [],
        updates: 0,
        post(_view: TaskView) { return nextId++ },
        update() { presenter.updates++ },
        end(id, opts) { presenter.ends.push({ id, returnFocus: opts.returnFocus }) },
    }
    return presenter
}

/** A manual clock: time moves only through `advance`, which runs due timers in order. */
function manualClock() {
    let now = 0
    let nextId = 1
    const timers = new Map<number, { at: number, run: () => void }>()
    const clock: TaskClock = {
        now: () => now,
        setTimeout: (run, ms) => {
            const id = nextId++
            timers.set(id, { at: now + ms, run })
            return id as unknown as ReturnType<typeof setTimeout>
        },
        clearTimeout: (id) => { timers.delete(id as unknown as number) },
        hidden: () => false,
    }
    return {
        clock,
        advance(ms: number) {
            const target = now + ms
            for (;;) {
                let next: [number, { at: number, run: () => void }] | undefined
                for (const entry of timers) if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry
                if (!next) break
                timers.delete(next[0])
                now = Math.max(now, next[1].at)
                next[1].run()
            }
            now = target
            flushSync()
        },
    }
}

let presenter: FakePresenter
let time: ReturnType<typeof manualClock>

/** A task sent to the background the way an importer's card does it. */
function backgrounded(overrides: Partial<TaskDef> = {}) {
    const handle = alertTask({ ...def, ...overrides })
    backgroundTask()
    flushSync()
    return handle
}

//#endregion

beforeEach(() => {
    store.characters = [X, Y]
    store.reads = 0
    resetBackHandlersForTests()
    presenter = fakePresenter()
    time = manualClock()
    setTaskClockForTests(time.clock)
    setTaskToastPresenter(presenter)
    vi.mocked(backgroundJobs).mockClear()
})

afterEach(async () => {
    for (const handle of handles.splice(0)) handle.end()
    settingsOpen.set(false)
    studioOpen.set(false)
    for (const instance of instances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    targets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetTaskHostForTests()
    setTaskClockForTests(null)
    resetBackHandlersForTests()
})

describe('the tabs', () => {
    test('T-613-10: a tablist of two tabs with counts, linked panels, roving tabindex and Replies selected when replies run', () => {
        reg(ALPHA, 'reply')
        reg(BETA, 'preview')
        const root = mountBar('phone')
        openDialog(root)

        const tabs = tabsOf()
        expect(tabs).toHaveLength(2)
        expect(document.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe(language.homeTasks)
        expect(tabs.map((tab) => tab.textContent)).toEqual([language.homeTasksTabReplies(1), language.homeTasksTabOther(1)])
        expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false'])
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1])

        const panels = panelsOf()
        expect(panels).toHaveLength(2)
        tabs.forEach((tab, index) => {
            expect(tab.getAttribute('aria-controls')).toBe(panels[index].id)
            expect(panels[index].getAttribute('aria-labelledby')).toBe(tab.id)
        })
        expect(panels.map((panel) => panel.hidden)).toEqual([false, true])
        expect(document.querySelector('[data-part="home-dialog-title"]')!.textContent).toBe(language.homeTasksTitle)
        expect(language.homeTasksTitle).toBe(language.homeTasks)

        selectTab(1)
        expect(tabsOf().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true'])
        expect(tabsOf().map((tab) => tab.tabIndex)).toEqual([-1, 0])
    })

    test('T-613-10: the counts show even at zero, and the first tab is Replies unless replies are empty and Background is not', () => {
        const idle = mountBar('phone')
        openDialog(idle)
        expect(tabsOf().map((tab) => tab.textContent)).toEqual([language.homeTasksTabReplies(0), language.homeTasksTabOther(0)])
        expect(tabsOf()[0].getAttribute('aria-selected')).toBe('true')
    })

    test('T-613-10: replies empty and a background job present opens on Background', () => {
        backgrounded()
        const root = mountBar('phone')
        openDialog(root)

        expect(tabsOf()[1].getAttribute('aria-selected')).toBe('true')
        expect(rowsOf()).toHaveLength(1)
    })

    test('T-613-11: arrows wrap, Home and End jump, focus follows, and Tab leaves the tablist into the panel', () => {
        reg(ALPHA, 'reply')
        const root = mountBar('phone')
        openDialog(root)
        const [replies, background] = tabsOf()

        replies.focus()
        key(replies, 'ArrowRight')
        expect(document.activeElement).toBe(background)
        expect(background.getAttribute('aria-selected')).toBe('true')
        expect(panelsOf().map((panel) => panel.hidden)).toEqual([true, false])

        key(background, 'ArrowRight')
        expect(document.activeElement).toBe(replies)
        expect(replies.getAttribute('aria-selected')).toBe('true')

        key(replies, 'ArrowLeft')
        expect(document.activeElement).toBe(background)

        key(background, 'Home')
        expect(document.activeElement).toBe(replies)
        key(replies, 'End')
        expect(document.activeElement).toBe(background)

        // The roving tabindex keeps the other tab out of the Tab order, so Tab goes on into the panel.
        expect(tabsOf().map((tab) => tab.tabIndex)).toEqual([-1, 0])
    })

    test('T-613-23: the selected tab survives a band change that replaces the Tasks instance', () => {
        const props = $state<{ band: Band }>({ band: 'phone' })
        reg(ALPHA, 'reply')
        reg(BETA, 'preview')
        const root = mountBar(props)
        openDialog(root)
        selectTab(1)
        expect(tabsOf()[1].getAttribute('aria-selected')).toBe('true')

        props.band = 'wide'
        flushSync()

        expect(dialogOf()).not.toBeNull()
        expect(tabsOf().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true'])
        expect(tabsOf().map((tab) => tab.tabIndex)).toEqual([-1, 0])
        expect(rowsOf()).toHaveLength(1)
    })
})

describe('the Background tab', () => {
    test('T-613-12: a preview row names the chat, says preview, and Stop stops that chat only; a work registration changes no count', () => {
        const stopPreview = vi.fn()
        const stopReply = vi.fn()
        const stopWork = vi.fn()
        const stopOther = vi.fn()
        reg(ALPHA, 'preview', stopPreview)
        reg(ALPHA, 'reply', stopReply)
        reg(ALPHA, 'work', stopWork)
        reg(GAMMA, 'work', stopOther)
        const root = mountBar('phone')
        openDialog(root)
        expect(tabsOf()[1].textContent).toBe(language.homeTasksTabOther(1))
        selectTab(1)

        expect(rowsOf()).toHaveLength(1)
        expect(textsOf('home-run-title')).toEqual(['Xena'])
        expect(textsOf('home-run-meta')).toEqual(['Alpha'])
        expect(textsOf('home-run-kind')).toEqual([language.homeTasksPreview])
        expect(rowsOf()[0].querySelector('[data-part="home-run-progress"]')).toBeNull()
        const stop = stopsOf()[0]
        expect(stop.getAttribute('aria-label')).toBe(language.homeTasksStopPreviewFor('Xena'))

        stop.click()
        flushSync()

        expect(stopPreview).toHaveBeenCalledTimes(1)
        expect(stopReply).toHaveBeenCalledTimes(1)
        expect(stopWork).toHaveBeenCalledTimes(1)
        expect(stopOther).not.toHaveBeenCalled()
        expect(stop.textContent).toBe(language.keepAliveStopping)
        expect(stop.getAttribute('aria-disabled')).toBe('true')
    })

    test('T-613-13: a task row shows title, subtitle and progress, and Cancel is offered only while allowed', () => {
        const onCancel = vi.fn()
        const handle = backgrounded({ onCancel })
        const root = mountBar('phone')
        openDialog(root)

        expect(textsOf('home-run-title')).toEqual(['Import'])
        expect(textsOf('home-run-meta')).toEqual(['Characters'])
        expect(textsOf('home-run-progress')[0]).toContain('Read file')
        expect(opensOf()).toHaveLength(1)
        expect(opensOf()[0].textContent).toBe(language.patternTaskToastOpen)
        expect(opensOf()[0].getAttribute('aria-label')).toBe(language.homeTasksOpenFor('Import'))
        expect(cancelsOf()).toHaveLength(1)
        expect(cancelsOf()[0].textContent).toBe(language.cancel)
        expect(cancelsOf()[0].getAttribute('aria-label')).toBe(language.homeTasksCancelFor('Import'))

        handle.setStep(1)
        handle.setCount(0, 10)
        time.advance(300)
        handle.setCount(4, 10)
        time.advance(300)
        expect(textsOf('home-run-progress')[0]).toContain('Add items')
        expect(textsOf('home-run-progress')[0]).not.toContain('%')

        expect(handle.lockCancel()).toBe(true)
        time.advance(300)
        expect(cancelsOf()).toHaveLength(0)
        expect(onCancel).not.toHaveBeenCalled()
    })

    test('T-613-13: pressing Cancel requests it once, the line reads the cancelling word and the button is gone', () => {
        const onCancel = vi.fn()
        backgrounded({ onCancel })
        const root = mountBar('phone')
        openDialog(root)

        cancelsOf()[0].click()
        flushSync()

        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(cancelsOf()).toHaveLength(0)
        expect(textsOf('home-run-progress')[0]).toBe(language.patternTaskCancelling)
    })

    test('T-613-13: a task without onCancel never offers Cancel', () => {
        backgrounded({ onCancel: undefined })
        const root = mountBar('phone')
        openDialog(root)

        expect(rowsOf()).toHaveLength(1)
        expect(cancelsOf()).toHaveLength(0)
    })

    test('T-613-13: Open brings the card back, closes the dialog and leaves focus to the card', () => {
        backgrounded()
        const root = mountBar('phone')
        const button = openDialog(root)

        opensOf()[0].click()
        flushSync()

        expect(dialogOf()).toBeNull()
        expect(taskShown()).toBe(true)
        expect(taskReopened()).toBe(true)
        expect(presenter.ends).toEqual([{ id: 100, returnFocus: false }])
        expect(document.activeElement).not.toBe(button)
        expect(document.activeElement).not.toBe(closeOf())
    })

    test('T-613-14: a row leaves when its task finishes or is closed and when its preview ends; the empty copy is per tab', () => {
        const finished = backgrounded({ title: 'Finished' })
        const closing = backgrounded({ title: 'Closing' })
        const failing = backgrounded({ title: 'Failing' })
        const preview = reg(ALPHA, 'preview')
        const root = mountBar('phone')
        openDialog(root)
        expect(textsOf('home-run-title')).toEqual(['Xena', 'Finished', 'Closing', 'Failing'])
        expect(tabsOf()[1].textContent).toBe(language.homeTasksTabOther(4))

        void finished.finish({ headline: 'Done' })
        time.advance(300)
        expect(textsOf('home-run-title')).toEqual(['Xena', 'Closing', 'Failing'])

        closing.close()
        flushSync()
        expect(textsOf('home-run-title')).toEqual(['Xena', 'Failing'])

        void failing.fail({ headline: 'Failed' })
        time.advance(300)
        expect(textsOf('home-run-title')).toEqual(['Xena'])

        end(preview)
        expect(rowsOf()).toHaveLength(0)
        expect(bodyOf()!.textContent).toBe(language.homeTasksOtherEmpty)
        expect(tabsOf()[1].textContent).toBe(language.homeTasksTabOther(0))
        expect(dialogOf()).not.toBeNull()

        selectTab(0)
        expect(bodyOf()!.textContent).toBe(language.homeTasksEmpty)
    })

    test('T-613-15: the badge and the button name count replies only, with previews and jobs present', () => {
        reg(ALPHA, 'reply')
        reg(BETA, 'preview')
        reg(GAMMA, 'preview')
        backgrounded()
        const root = mountBar('phone')

        expect(badgeOf(root)!.textContent).toBe('1')
        expect(buttonOf(root)!.getAttribute('aria-label')).toBe(language.homeTasksName(1))
        openDialog(root)
        expect(badgeOf(root)!.textContent).toBe('1')
    })

    test('T-613-16: the status is empty at open, speaks the background count in its own words and the reply count while Background shows', () => {
        const preview = reg(ALPHA, 'preview')
        const reply = reg(BETA, 'reply')
        const root = mountBar('phone')
        openDialog(root)
        expect(statusOf()!.textContent).toBe('')

        const second = reg(GAMMA, 'preview')
        flushSync()
        expect(statusOf()!.textContent).toBe(language.homeTasksOtherCount(2))

        end(second)
        end(preview)
        expect(statusOf()!.textContent).toBe(language.homeTasksOtherEmpty)

        selectTab(1)
        end(reply)
        expect(statusOf()!.textContent).toBe(language.homeTasksEmpty)
    })

    test('T-613-16: a job ending is announced by the background count', () => {
        const handle = backgrounded()
        const root = mountBar('phone')
        openDialog(root)
        expect(statusOf()!.textContent).toBe('')

        handle.close()
        flushSync()

        expect(statusOf()!.textContent).toBe(language.homeTasksOtherEmpty)
    })

    test('T-613-17: when the focused preview ends focus goes to the Stop at its place, else the one before, else Close; the other row keeps its node', () => {
        const rA = reg(ALPHA, 'preview')
        const rB = reg(BETA, 'preview')
        const rC = reg(GAMMA, 'preview')
        const root = mountBar('phone')
        openDialog(root)
        const gammaRow = rowsOf()[2]

        stopsOf()[1].focus()
        end(rB)
        expect(rowsOf()[1]).toBe(gammaRow)
        expect(document.activeElement).toBe(stopsOf()[1])

        stopsOf()[1].focus()
        end(rC)
        expect(document.activeElement).toBe(stopsOf()[0])

        stopsOf()[0].focus()
        end(rA)
        expect(document.activeElement).toBe(closeOf())
    })

    test('T-613-17: a job row keeps its node when another job ends', () => {
        const first = backgrounded({ title: 'First' })
        backgrounded({ title: 'Second' })
        const root = mountBar('phone')
        openDialog(root)
        const secondRow = rowsOf()[1]

        first.close()
        flushSync()

        expect(rowsOf()).toHaveLength(1)
        expect(rowsOf()[0]).toBe(secondRow)
        expect(textsOf('home-run-title')).toEqual(['Second'])
    })

    test('T-613-17: focus already on Close is left alone when a row ends', () => {
        const rA = reg(ALPHA, 'preview')
        reg(BETA, 'preview')
        const root = mountBar('phone')
        openDialog(root)

        stopsOf()[0].focus()
        closeOf()!.focus()
        end(rA)

        expect(document.activeElement).toBe(closeOf())
    })

    test('T-613-17: when Cancel leaves the focused job row, focus goes to that row\'s Open; when the job ends, to Close', () => {
        const handle = backgrounded()
        const root = mountBar('phone')
        openDialog(root)

        cancelsOf()[0].focus()
        handle.lockCancel()
        time.advance(300)
        expect(cancelsOf()).toHaveLength(0)
        expect(document.activeElement).toBe(opensOf()[0])

        handle.close()
        flushSync()
        expect(document.activeElement).toBe(closeOf())
    })

    test('T-613-18: Stop in the Replies tab shows Stopping in the Background row of the same chat and both leave when they end', () => {
        const stopReply = vi.fn()
        const stopPreview = vi.fn()
        const reply = reg(ALPHA, 'reply', stopReply)
        const preview = reg(ALPHA, 'preview', stopPreview)
        const root = mountBar('phone')
        openDialog(root)

        stopsOf()[0].click()
        flushSync()
        selectTab(1)

        expect(stopsOf()[0].textContent).toBe(language.keepAliveStopping)
        expect(stopsOf()[0].getAttribute('aria-disabled')).toBe('true')
        stopsOf()[0].click()
        flushSync()
        expect(stopReply).toHaveBeenCalledTimes(1)
        expect(stopPreview).toHaveBeenCalledTimes(1)

        end(reply)
        expect(stopsOf()[0].textContent).toBe(language.keepAliveStopping)
        end(preview)
        expect(rowsOf()).toHaveLength(0)

        const again = reg(ALPHA, 'preview', stopPreview)
        flushSync()
        expect(stopsOf()[0].textContent).toBe(language.chatShellStop)
        end(again)
    })

    test('T-613-19: a closed dialog reads no task state and no characters; a preview starting while Replies shows reads no names', () => {
        const root = mountBar('phone')
        const task = backgrounded()
        time.advance(300)
        const preview = reg(ALPHA, 'preview')
        flushSync()
        end(preview)
        void task

        expect(store.reads).toBe(0)
        expect(vi.mocked(backgroundJobs)).not.toHaveBeenCalled()

        reg(ALPHA, 'preview')
        flushSync()
        openDialog(root)
        expect(tabsOf()[1].getAttribute('aria-selected')).toBe('true')
        selectTab(0)
        store.reads = 0
        reg(GAMMA, 'preview')
        flushSync()
        expect(store.reads).toBe(0)

        selectTab(1)
        expect(store.reads).toBeGreaterThan(0)
        expect(textsOf('home-run-title')).toEqual(['Xena', 'Yuri', 'Import'])
    })

    test('T-613-20: an unknown chat reads Unnamed on the Background tab and no id text shows in either tab', () => {
        reg({ chaId: 'cha-gone', chatId: 'chat-gone' }, 'preview')
        reg({ chaId: 'cha-gone', chatId: 'chat-gone' }, 'reply')
        const root = mountBar('phone')
        openDialog(root)
        const unnamed = language.settingsPage.unnamed

        expect(textsOf('home-run-title')).toEqual([unnamed])
        selectTab(1)
        expect(textsOf('home-run-title')).toEqual([unnamed])
        expect(textsOf('home-run-meta')).toEqual([unnamed])
        expect(dialogOf()!.textContent).not.toContain('cha-gone')
        expect(dialogOf()!.textContent).not.toContain('chat-gone')
    })

    test('T-613-21: Open is aria-disabled and does nothing while another card is shown, and the dialog stays', () => {
        backgrounded()
        const root = mountBar('phone')
        openDialog(root)
        alertTask({ ...def, title: 'Shown' })
        flushSync()

        expect(opensOf()[0].getAttribute('aria-disabled')).toBe('true')
        opensOf()[0].click()
        flushSync()

        expect(dialogOf()).not.toBeNull()
        expect(taskReopened()).toBe(false)
        expect(presenter.ends).toEqual([])
        expect(backgroundJobs()).toHaveLength(1)
    })
})
