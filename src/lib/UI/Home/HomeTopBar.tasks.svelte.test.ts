// @vitest-environment jsdom

/**
 * The Home top bar's Tasks button and its "Replies in progress" dialog, mounted through `HomeTopBar.svelte`.
 *
 * REAL: `HomeTopBar`, `HomeTasks`, `PatternDialog`, `chatOrigin` (the registrations are made through
 * `registerWork`, the way `sendChat` makes them), the modal layers, the Back handlers.
 * MOCKED: `stores.svelte`. `DBState.db` is a plain object, not `$state`, because Svelte's state proxy
 * rejects accessor descriptors and `characters` must be an accessor that counts its reads.
 *
 * Fixture FX-1: character X holds the chats Alpha, Beta and Delta; character Y holds Gamma and Epsilon; a
 * group G holds Hall and is registered as `sendChat` registers a group turn (the group as owner, the
 * member as `memberChaId`, an outer send with a stop and a recursion without one).
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { dispatchBack, installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { registerWork, type WorkHandle } from 'src/ts/process/chatOrigin'
import { studioOpen } from 'src/ts/studio/studioOpen'

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

//#endregion

import HomeTopBar from './HomeTopBar.svelte'
import { DBState, settingsOpen } from 'src/ts/stores.svelte'

type Band = 'phone' | 'mid' | 'wide'

const X = { chaId: 'cha-x', name: 'Xena', chats: [{ id: 'chat-a', name: 'Alpha' }, { id: 'chat-b', name: 'Beta' }, { id: 'chat-d', name: 'Delta' }] }
const Y = { chaId: 'cha-y', name: 'Yuri', chats: [{ id: 'chat-c', name: 'Gamma' }, { id: 'chat-e', name: 'Epsilon' }] }
const G = { chaId: 'grp-g', type: 'group', name: 'Guild', characters: ['cha-x'], chats: [{ id: 'chat-g', name: 'Hall' }] }

const ALPHA = { chaId: 'cha-x', chatId: 'chat-a' }
const BETA = { chaId: 'cha-x', chatId: 'chat-b' }
const GAMMA = { chaId: 'cha-y', chatId: 'chat-c' }
const GROUP_TURN = { chaId: 'grp-g', chatId: 'chat-g', memberChaId: 'cha-x' }

const db = DBState.db as unknown as { visibleModes: string[], hideUnusedModes: boolean }

const handles: WorkHandle[] = []
const instances: unknown[] = []
const targets: HTMLElement[] = []

interface Watch { callback: ResizeObserverCallback, owner: ResizeObserver, targets: Element[], active: boolean }
// Reset at the start of the one test that stubs the global, so observers never leak between tests.
let watches: Watch[] = []

class RecordingObserver implements ResizeObserver {
    private readonly watch: Watch
    constructor(callback: ResizeObserverCallback) {
        this.watch = { callback, owner: this, targets: [], active: true }
        watches.push(this.watch)
    }
    observe(target: Element): void {
        this.watch.targets.push(target)
    }
    unobserve(target: Element): void {
        this.watch.targets = this.watch.targets.filter((t) => t !== target)
    }
    disconnect(): void {
        this.watch.active = false
    }
}

function reg(origin: { chaId: string, chatId: string, memberChaId?: string }, kind: 'reply' | 'preview' | 'work', stop?: () => void): WorkHandle {
    const handle = registerWork(origin, stop, kind)
    handles.push(handle)
    return handle
}

function mountBar(band: Band = 'phone', parent?: HTMLElement): HTMLElement {
    const target = document.createElement('div')
    ;(parent ?? document.body).appendChild(target)
    targets.push(target)
    instances.push(mount(HomeTopBar, { target, props: { band } }))
    flushSync()
    return target
}

const buttonOf = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[data-part="home-tasks-button"]')
const badgeOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-part="home-badge"]')
const dialogOf = () => document.querySelector<HTMLElement>('[data-part="pattern-dialog"]')
const rowsOf = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="home-task-row"]'))
const stopsOf = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-part="home-run-stop"]'))
const closeOf = () => document.querySelector<HTMLButtonElement>('[data-part="home-dialog-action"]')
const statusOf = () => document.querySelector<HTMLElement>('[data-part="home-dialog"] [role="status"]')
const textsOf = (part: string) => rowsOf().map((row) => row.querySelector(`[data-part="${part}"]`)?.textContent)

function openDialog(root: HTMLElement): HTMLButtonElement {
    const button = buttonOf(root)!
    button.click()
    flushSync()
    expect(dialogOf()).not.toBeNull()
    return button
}

function press(key: string): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    flushSync()
}

function end(...list: WorkHandle[]): void {
    for (const handle of list) handle.end()
    flushSync()
}

beforeEach(() => {
    store.characters = [X, Y, G]
    store.reads = 0
    db.visibleModes = ['rp', 'hybrid', 'utility']
    db.hideUnusedModes = false
    resetBackHandlersForTests()
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
    resetBackHandlersForTests()
})

describe('the Tasks button', () => {
    test('T-S6-01: exists at every band width, with no badge and the plain name while idle', () => {
        for (const band of ['phone', 'mid', 'wide'] as const) {
            const root = mountBar(band)
            const button = buttonOf(root)
            expect(button, band).not.toBeNull()
            expect(badgeOf(root), band).toBeNull()
            expect(button!.getAttribute('aria-label'), band).toBeNull()
            expect(button!.textContent?.trim(), band).toBe(language.homeTasks)
        }
    })

    test('T-S6-02: is shown with hiding on and only Roleplay visible', () => {
        db.visibleModes = ['rp']
        db.hideUnusedModes = true
        for (const band of ['phone', 'mid', 'wide'] as const) {
            expect(buttonOf(mountBar(band)), band).not.toBeNull()
        }
    })

    test('T-S6-03: the badge counts chats with a reply, not previews or other work, and the name carries the count', () => {
        reg(ALPHA, 'reply')
        reg(ALPHA, 'reply')
        reg(BETA, 'reply')
        reg(GAMMA, 'reply')
        reg({ chaId: 'cha-x', chatId: 'chat-d' }, 'preview')
        reg({ chaId: 'cha-y', chatId: 'chat-e' }, 'work')
        const root = mountBar('phone')

        expect(badgeOf(root)!.textContent).toBe('3')
        expect(badgeOf(root)!.getAttribute('aria-hidden')).toBe('true')
        expect(buttonOf(root)!.getAttribute('aria-label')).toBe(language.homeTasksName(3))
    })

    test('T-S6-04: the badge follows replies ending; a second send in a chat holds its row', () => {
        const rA1 = reg(ALPHA, 'reply')
        const rA2 = reg(ALPHA, 'reply')
        const rB = reg(BETA, 'reply')
        const rC = reg(GAMMA, 'reply')
        const root = mountBar('phone')
        expect(badgeOf(root)!.textContent).toBe('3')

        end(rB)
        expect(badgeOf(root)!.textContent).toBe('2')
        end(rA1)
        expect(badgeOf(root)!.textContent).toBe('2')
        end(rA2, rC)
        expect(badgeOf(root)).toBeNull()
        expect(buttonOf(root)!.getAttribute('aria-label')).toBeNull()
    })

    test('T-S6-17: phone order is menu, brand, Tasks, switcher, chip; mid and wide put Tasks in the chip cluster; it cannot shrink', () => {
        const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

        const phone = mountBar('phone')
        const menu = phone.querySelector('[data-part="home-menu-button"]')!
        const brand = phone.querySelector('[data-part="home-brand"]')!
        const tasks = buttonOf(phone)!
        const fieldset = phone.querySelector('fieldset')!
        const chip = phone.querySelector('[data-part="home-persona-chip"]')!
        expect(menu.parentElement!.contains(tasks)).toBe(true)
        expect([before(menu, brand), before(brand, tasks), before(tasks, fieldset), before(fieldset, chip)]).toEqual([true, true, true, true])
        expect(tasks.classList.contains('shrink-0')).toBe(true)
        expect(tasks.classList.contains('min-w-11')).toBe(true)
        expect(tasks.classList.contains('min-h-11')).toBe(true)

        for (const band of ['mid', 'wide'] as const) {
            const root = mountBar(band)
            const tasksButton = buttonOf(root)!
            const chipButton = root.querySelector('[data-part="home-persona-chip"]')!
            expect(chipButton.parentElement!.contains(tasksButton), band).toBe(true)
            expect([
                before(root.querySelector('[data-part="home-brand"]')!, root.querySelector('fieldset')!),
                before(root.querySelector('fieldset')!, tasksButton),
                before(tasksButton, chipButton),
            ], band).toEqual([true, true, true])
        }
    })
})

describe('the Tasks dialog', () => {
    test('T-S6-05: Escape, Close and Back each close it and focus returns to the button', () => {
        reg(ALPHA, 'reply')
        installBackGuard({ showToast: vi.fn() })
        const root = mountBar('phone')
        const button = buttonOf(root)!

        for (const how of ['escape', 'close', 'back'] as const) {
            openDialog(root)
            expect(dialogOf()!.getAttribute('role')).toBe('dialog')
            expect(dialogOf()!.getAttribute('aria-labelledby')).not.toBeNull()
            if (how === 'escape') press('Escape')
            else if (how === 'close') {
                closeOf()!.click()
                flushSync()
            } else {
                expect(dispatchBack()).toBe(true)
                flushSync()
            }
            expect(dialogOf(), how).toBeNull()
            expect(document.activeElement, how).toBe(button)
        }
    })

    test('T-S6-06: rows read character and chat names in order, Stop names carry the character, an empty name reads Unnamed', () => {
        reg(ALPHA, 'reply')
        reg(BETA, 'reply')
        reg(GAMMA, 'reply')
        const root = mountBar('phone')
        openDialog(root)

        expect(textsOf('home-run-title')).toEqual(['Xena', 'Xena', 'Yuri'])
        expect(textsOf('home-run-meta')).toEqual(['Alpha', 'Beta', 'Gamma'])
        expect(stopsOf().map((stop) => stop.getAttribute('aria-label'))).toEqual(
            ['Xena', 'Xena', 'Yuri'].map((name) => language.chatStopReplyFor(name)),
        )
        expect(stopsOf().map((stop) => stop.textContent)).toEqual([language.chatShellStop, language.chatShellStop, language.chatShellStop])

        store.characters = [{ ...X, name: '', chats: [{ id: 'chat-a', name: '' }, X.chats[1]] }, Y, G]
        end(...handles.splice(0))
        reg(ALPHA, 'reply')
        flushSync()
        expect(textsOf('home-run-title')).toEqual([language.settingsPage.unnamed])
        expect(textsOf('home-run-meta')).toEqual([language.settingsPage.unnamed])
    })

    test('T-S6-07: no chat or character id appears in the dialog text, for a stale chat or an unresolved character', () => {
        reg(ALPHA, 'reply')
        reg({ chaId: 'cha-x', chatId: 'chat-zz' }, 'reply')
        reg({ chaId: 'cha-q', chatId: 'chat-q' }, 'reply')
        const root = mountBar('phone')
        openDialog(root)

        const text = dialogOf()!.textContent!
        for (const id of ['cha-x', 'chat-a', 'chat-zz', 'cha-q', 'chat-q']) expect(text).not.toContain(id)
        expect(rowsOf()).toHaveLength(3)
        expect(textsOf('home-run-title')).toEqual(['Xena', 'Xena', language.settingsPage.unnamed])
    })

    test('T-S6-08: Stop on a row stops that chat\'s reply and its other work, and no other chat or character', () => {
        const sA = vi.fn()
        const swA = vi.fn()
        const sB = vi.fn()
        const sC = vi.fn()
        const sG = vi.fn()
        reg(ALPHA, 'reply', sA)
        reg(ALPHA, 'work', swA)
        reg(BETA, 'reply', sB)
        reg(GAMMA, 'reply', sC)
        reg(GROUP_TURN, 'reply', sG)
        const root = mountBar('phone')
        openDialog(root)

        stopsOf()[0].click()
        flushSync()

        expect(sA).toHaveBeenCalledTimes(1)
        expect(swA).toHaveBeenCalledTimes(1)
        expect(sB).not.toHaveBeenCalled()
        expect(sC).not.toHaveBeenCalled()
        expect(sG).not.toHaveBeenCalled()
    })

    test('T-S6-09: a pressed Stop reads Stopping and is aria-disabled, a repeat press does nothing, the row stays until the replies end', () => {
        const sA = vi.fn()
        const rA1 = reg(ALPHA, 'reply', sA)
        const rA2 = reg(ALPHA, 'reply')
        const root = mountBar('phone')
        openDialog(root)

        const stop = stopsOf()[0]
        stop.click()
        flushSync()
        expect(stop.textContent).toBe(language.keepAliveStopping)
        expect(stop.getAttribute('aria-disabled')).toBe('true')
        // The visible text is the name while stopping, so the name says it is stopping.
        expect(stop.getAttribute('aria-label')).toBeNull()

        stop.click()
        flushSync()
        expect(sA).toHaveBeenCalledTimes(1)
        expect(rowsOf()).toHaveLength(1)

        end(rA1)
        expect(rowsOf()).toHaveLength(1)
        end(rA2)
        expect(rowsOf()).toHaveLength(0)
    })

    test('T-S6-10: two chats of one character are two rows; the last one ending shows the empty copy and keeps the dialog open', () => {
        const rA = reg(ALPHA, 'reply')
        const rB = reg(BETA, 'reply')
        const rC = reg(GAMMA, 'reply')
        const root = mountBar('phone')
        openDialog(root)
        expect(textsOf('home-run-title')).toEqual(['Xena', 'Xena', 'Yuri'])

        end(rB)
        expect(textsOf('home-run-meta')).toEqual(['Alpha', 'Gamma'])
        end(rA, rC)
        expect(rowsOf()).toHaveLength(0)
        expect(dialogOf()).not.toBeNull()
        expect(dialogOf()!.querySelector('[data-part="home-dialog-body"]')!.textContent).toBe(language.homeTasksEmpty)
    })

    test('T-S6-11: when the focused row ends, focus goes to the Stop now at its place, else the one before, else Close', () => {
        const rA = reg(ALPHA, 'reply')
        const rB = reg(BETA, 'reply')
        const rC = reg(GAMMA, 'reply')
        const root = mountBar('phone')
        openDialog(root)

        stopsOf()[1].focus()
        end(rB)
        expect(document.activeElement).toBe(stopsOf()[1])
        expect(rowsOf()[1].textContent).toContain('Gamma')

        stopsOf()[1].focus()
        end(rC)
        expect(document.activeElement).toBe(stopsOf()[0])

        stopsOf()[0].focus()
        end(rA)
        expect(document.activeElement).toBe(closeOf())
    })

    test('T-S6-11b: focus already on Close or on another row\'s Stop is not moved when a row ends', () => {
        const rA = reg(ALPHA, 'reply')
        const rB = reg(BETA, 'reply')
        const rC = reg(GAMMA, 'reply')
        const root = mountBar('phone')
        openDialog(root)

        // Focus was on B's Stop, then moved to Close: B ending must not pull it back to a Stop.
        stopsOf()[1].focus()
        closeOf()!.focus()
        end(rB)
        expect(document.activeElement).toBe(closeOf())

        // Focus was on A's Stop, then moved to C's Stop: A ending leaves it on C's Stop.
        stopsOf()[0].focus()
        stopsOf()[1].focus()
        const stopOfC = stopsOf()[1]
        end(rA)
        expect(document.activeElement).toBe(stopOfC)
        expect(stopsOf()).toHaveLength(1)
        end(rC)
    })

    test('T-S6-09b: after a stopped reply ends, a new reply in the same chat reads Stop and can be stopped', () => {
        const s1 = vi.fn()
        const s2 = vi.fn()
        const first = reg(ALPHA, 'reply', s1)
        const root = mountBar('phone')
        openDialog(root)

        stopsOf()[0].click()
        flushSync()
        expect(stopsOf()[0].textContent).toBe(language.keepAliveStopping)
        end(first)
        expect(rowsOf()).toHaveLength(0)

        reg(ALPHA, 'reply', s2)
        flushSync()
        expect(dialogOf()).not.toBeNull()
        const stop = stopsOf()[0]
        expect(stop.textContent).toBe(language.chatShellStop)
        expect(stop.getAttribute('aria-disabled')).toBeNull()
        expect(stop.getAttribute('aria-label')).toBe(language.chatStopReplyFor('Xena'))

        stop.click()
        flushSync()
        expect(s2).toHaveBeenCalledTimes(1)
        expect(s1).toHaveBeenCalledTimes(1)
    })

    test('T-S6-12: the polite status is empty at open and speaks only a change of the count', () => {
        const rA = reg(ALPHA, 'reply')
        const rB = reg(BETA, 'reply')
        const rC = reg(GAMMA, 'reply')
        const root = mountBar('phone')
        openDialog(root)
        expect(statusOf()!.textContent).toBe('')

        end(rC)
        expect(statusOf()!.textContent).toBe(language.homeTasksCount(2))

        const extra = reg(ALPHA, 'reply')
        flushSync()
        end(extra)
        expect(statusOf()!.textContent).toBe(language.homeTasksCount(2))

        end(rA, rB)
        expect(statusOf()!.textContent).toBe(language.homeTasksEmpty)
    })

    test('T-S6-12b: a reply that ends in the same update that opens the dialog is part of the baseline, not announced', () => {
        reg(ALPHA, 'reply')
        const rB = reg(BETA, 'reply')
        const root = mountBar('phone')

        buttonOf(root)!.click()
        rB.end()
        flushSync()

        expect(dialogOf()).not.toBeNull()
        expect(rowsOf()).toHaveLength(1)
        expect(statusOf()!.textContent).toBe('')
    })
    test('T-S6-13: Back closes it and the handler goes with it', () => {
        reg(ALPHA, 'reply')
        const showToast = vi.fn()
        installBackGuard({ showToast })
        const root = mountBar('phone')
        openDialog(root)

        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(dialogOf()).toBeNull()
        expect(showToast).not.toHaveBeenCalled()

        dispatchBack()
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('T-S6-14: Settings or Studio opening closes it, and focus does not go back to the button', async () => {
        reg(ALPHA, 'reply')
        const root = mountBar('phone')
        const button = buttonOf(root)!

        for (const cover of [() => settingsOpen.set(true), () => studioOpen.set(true)]) {
            openDialog(root)
            stopsOf()[0].focus()
            // The page is made usable first, so a teardown that returned focus to the button would succeed.
            document.querySelectorAll('[inert]').forEach((element) => element.removeAttribute('inert'))
            cover()
            flushSync()
            await tick()
            expect(dialogOf()).toBeNull()
            expect(document.activeElement).not.toBe(button)
            settingsOpen.set(false)
            studioOpen.set(false)
            flushSync()
        }
    })

    test('T-S6-15: the page behind is inert while it is open, the dialog layer is not, and nothing is inert after', () => {
        reg(ALPHA, 'reply')
        const main = document.createElement('main')
        document.body.appendChild(main)
        targets.push(main)
        const section = document.createElement('section')
        main.appendChild(section)
        const root = mountBar('wide', main)
        const button = buttonOf(root)!
        const chip = root.querySelector('[data-part="home-persona-chip"]')!

        openDialog(root)
        expect(button.closest('[inert]')).not.toBeNull()
        expect(chip.closest('[inert]')).not.toBeNull()
        expect(section.hasAttribute('inert')).toBe(true)
        expect(document.querySelector('[data-part="pattern-layer"]')!.closest('[inert]')).toBeNull()

        closeOf()!.click()
        flushSync()
        expect(main.querySelector('[inert]')).toBeNull()
    })

    test('T-S6-16: no characters are read while idle or through preview starts and ends; they are read while a reply runs', () => {
        const root = mountBar('phone')
        expect(store.reads).toBe(0)
        for (let i = 0; i < 5; i++) {
            const preview = reg(ALPHA, 'preview')
            flushSync()
            end(preview)
        }
        expect(store.reads).toBe(0)

        const reply = reg(ALPHA, 'reply')
        flushSync()
        expect(store.reads).toBeGreaterThanOrEqual(1)
        openDialog(root)
        const row = rowsOf()[0]
        expect(row).toBeDefined()

        const preview = reg(BETA, 'preview')
        flushSync()
        end(preview)
        expect(rowsOf()[0]).toBe(row)
        end(reply)
    })

    test('T-S6-18: a band change keeps the dialog open, once, with focus inside it and Back still closing it', () => {
        reg(ALPHA, 'reply')
        installBackGuard({ showToast: vi.fn() })
        const props = $state<{ band: Band }>({ band: 'phone' })
        const target = document.createElement('div')
        document.body.appendChild(target)
        targets.push(target)
        instances.push(mount(HomeTopBar, { target, props }))
        flushSync()
        openDialog(target)

        props.band = 'mid'
        flushSync()
        expect(document.querySelectorAll('[data-part="pattern-dialog"]')).toHaveLength(1)
        expect(dialogOf()!.contains(document.activeElement)).toBe(true)

        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(dialogOf()).toBeNull()
    })

    // The switch between the wide and the mid layout of a wide band changes classes on the same nodes, so an open
    // dialog, its focused Stop and the inert page behind it survive; only the layout assertion is red on the base.
    test('T-S6-61: a width switch of the wide bar keeps the dialog, the focused Stop and Back', () => {
        watches = []
        let barWidth = 811
        const original = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
        Object.defineProperty(Element.prototype, 'clientWidth', {
            configurable: true,
            get(this: Element): number {
                if (this.getAttribute('data-part') === 'home-topbar') return barWidth
                return (original?.get?.call(this) as number | undefined) ?? 0
            },
        })
        vi.stubGlobal('ResizeObserver', RecordingObserver)
        try {
            reg(ALPHA, 'reply')
            installBackGuard({ showToast: vi.fn() })
            const root = mountBar('wide')
            const bar = root.querySelector('header')!
            const deliver = (width: number): void => {
                barWidth = width
                for (const w of watches) {
                    if (w.active && w.targets.includes(bar.parentElement!)) w.callback([], w.owner)
                }
                flushSync()
            }
            expect(bar.getAttribute('data-layout')).toBe('mid')

            const button = openDialog(root)
            const dialog = dialogOf()!
            const stop = stopsOf()[0]
            stop.focus()
            expect(document.activeElement).toBe(stop)

            deliver(1275)
            expect(bar.getAttribute('data-layout')).toBe('wide')
            expect(buttonOf(root)).toBe(button)
            expect(dialogOf()).toBe(dialog)
            expect(document.querySelectorAll('[data-part="pattern-dialog"]')).toHaveLength(1)
            expect(document.activeElement).toBe(stop)
            expect(button.closest('[inert]')).not.toBeNull()

            deliver(811)
            expect(bar.getAttribute('data-layout')).toBe('mid')
            expect(buttonOf(root)).toBe(button)
            expect(dialogOf()).toBe(dialog)
            expect(document.activeElement).toBe(stop)
            expect(button.closest('[inert]')).not.toBeNull()

            expect(dispatchBack()).toBe(true)
            flushSync()
            expect(dialogOf()).toBeNull()
        } finally {
            vi.unstubAllGlobals()
            if (original) {
                Object.defineProperty(Element.prototype, 'clientWidth', original)
            } else {
                Reflect.deleteProperty(Element.prototype, 'clientWidth')
            }
        }
    })

    test('T-S6-19: a group turn, outer and recursion, is one row named after the group, and its Stop stops that turn only', () => {
        const sG = vi.fn()
        const sX = vi.fn()
        reg(GROUP_TURN, 'reply', sG)
        reg({ ...GROUP_TURN }, 'reply')
        reg(ALPHA, 'preview', sX)
        const root = mountBar('phone')

        expect(badgeOf(root)!.textContent).toBe('1')
        openDialog(root)
        expect(textsOf('home-run-title')).toEqual(['Guild'])
        expect(textsOf('home-run-meta')).toEqual(['Hall'])

        stopsOf()[0].click()
        flushSync()
        expect(sG).toHaveBeenCalledTimes(1)
        expect(sX).not.toHaveBeenCalled()
    })
})
