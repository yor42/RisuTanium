// @vitest-environment jsdom

/**
 * The Personas page with 500 personas: only the grid lines near the view are in the page, a pointer drag reads the
 * rects of every card in data order and moves the persona to a position that was not mounted before the drag, and
 * closing the editor focuses a card that scrolled out of the window. Mounts the REAL page over a `$state` store; layout
 * is faked the way the other window tests do. "regression reproducer:" titles fail against the page that mounted every
 * card.
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, RisuPersona } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        additionalSettingsMenu: [],
        easyPanelStore: { open: false },
        MobileGUI: writable(false),
        SettingsMenuIndex: writable(-1),
        settingsOpen: writable(false),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/lite', () => ({ isLite: writable(false) }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('../../ts/persona', () => ({
    exportPersona: vi.fn(async () => {}),
    selectUserImg: vi.fn(async () => {}),
    readPersonaFiles: vi.fn(async () => []),
    addPersonasFromPng: vi.fn(async () => []),
}))
vi.mock('../../ts/media/charImageLookups', () => ({
    useCharImageLookups: () => ({ get: vi.fn(async () => 'background-image: none'), getIf: () => null, dispose: () => {} }),
}))
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: vi.fn(), postUndoToast: vi.fn() }))

import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { setSettingsSubLevel, settingsShellBackStep } from '../../ts/settingsShell/settingsNavigation'
import { DBState } from '../../ts/stores.svelte'
import { setWindowGeometryForTests } from '../../ts/windowing/windowHost.svelte'
import Page from './PersonasShellPage.svelte'

const COUNT = 500
let frames: (() => void)[] = []
let bandShift = 0
const mounted: Array<ReturnType<typeof mount>> = []

function runFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) frame()
    flushSync()
}

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
        runFrames()
    }
}

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
    window.dispatchEvent(new Event('resize'))
    flushSync()
}

function seed(): void {
    const personas: RisuPersona[] = Array.from({ length: COUNT }, (_, i) => ({ id: `p${i}`, name: `Persona ${i}`, icon: '', personaPrompt: '', note: '' }))
    DBState.db = { personas, selectedPersona: 0, username: 'Persona 0', userIcon: '', personaPrompt: '', userNote: '', characters: [] } as unknown as Database
}

async function mountPage(width: number): Promise<HTMLElement> {
    setWidth(width)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Page, { target }))
    await settle()
    return target
}

const cards = (target: HTMLElement) => Array.from(target.querySelectorAll<HTMLElement>('[data-part="settings-persona-card"]'))
const ids = () => DBState.db.personas.map((persona) => persona.id)

beforeEach(() => {
    frames = []
    bandShift = 0
    resetBackHandlersForTests()
    seed()
    setWindowGeometryForTests({
        rectOf: () => ({ top: -bandShift, height: 600 }),
        viewport: () => 600,
        scrollBy: () => {},
        schedule: (callback) => {
            frames.push(callback)
            return () => { frames = frames.filter((frame) => frame !== callback) }
        },
    })
})

afterEach(async () => {
    for (const app of mounted.splice(0)) await unmount(app)
    document.body.innerHTML = ''
    setWindowGeometryForTests(undefined)
    setSettingsSubLevel(null)
    resetBackHandlersForTests()
    setWidth(1280)
})

describe('the windowed persona grid', () => {
    test('regression reproducer: 500 personas mount only the grid lines near the view', async () => {
        const target = await mountPage(1280)
        const mountedCards = cards(target)
        expect(mountedCards.length).toBeGreaterThan(0)
        expect(mountedCards.length).toBeLessThan(80)
        // Two columns: a line is two cards, so 250 lines.
        const lines = Array.from(target.querySelectorAll<HTMLElement>('[data-window-key]'))
        expect(lines[0].getAttribute('aria-setsize')).toBe(String(COUNT / 2))
        expect(lines[0].querySelectorAll('[data-part="settings-persona-card"]').length).toBe(2)
    })

    test('regression reproducer: one column at a narrow width has a line per persona', async () => {
        const target = await mountPage(600)
        const line = target.querySelector<HTMLElement>('[data-window-key]')!
        expect(line.getAttribute('aria-setsize')).toBe(String(COUNT))
        expect(line.querySelectorAll('[data-part="settings-persona-card"]').length).toBe(1)
    })

    describe('pointer drag', () => {
        const stubbed = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const
        let rectSpy: ReturnType<typeof vi.spyOn>

        beforeEach(() => {
            for (const name of stubbed) {
                Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: name === 'hasPointerCapture' ? () => true : vi.fn() })
            }
            // Two columns of 190 x 72 cards on an 80 px line pitch, placed by the card's data index.
            rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
                const raw = this.getAttribute('data-persona-index')
                if (raw === null) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }
                const index = Number(raw)
                const left = (index % 2) * 200
                const top = Math.floor(index / 2) * 80
                return { left, right: left + 190, top, bottom: top + 72, width: 190, height: 72, x: left, y: top, toJSON: () => ({}) }
            })
        })

        afterEach(async () => {
            for (const app of mounted.splice(0)) await unmount(app)
            rectSpy.mockRestore()
            for (const name of stubbed) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
        })

        function pointer(type: string, x: number, y: number): Event {
            const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
            Object.defineProperty(event, 'pointerId', { value: 1 })
            return event
        }

        test('regression reproducer: a card dragged onto a position that was not mounted lands there in the whole list', async () => {
            const target = await mountPage(1280)
            const handle = target.querySelector<HTMLElement>('[data-part="settings-persona-drag"]')!
            handle.dispatchEvent(pointer('pointerdown', 10, 10))
            await settle()
            // The drag pins every line, so the rects of all 500 cards are read.
            expect(cards(target).length).toBe(COUNT)
            // Card 400 sits on line 200 in the left column.
            handle.dispatchEvent(pointer('pointermove', 10, 200 * 80 + 10))
            flushSync()
            handle.dispatchEvent(pointer('pointerup', 10, 200 * 80 + 10))
            await settle()
            const order = ids()
            expect(order.length).toBe(COUNT)
            expect(order[400]).toBe('p0')
            expect(order[0]).toBe('p1')
            expect(new Set(order).size).toBe(COUNT)
            expect(cards(target).length).toBeLessThan(80)
        })
    })

    test('regression reproducer: closing the editor focuses a card that scrolled out of the window', async () => {
        const target = await mountPage(700)
        const opener = cards(target)[3].querySelector<HTMLElement>('[data-persona-open]')!
        opener.click()
        await settle()
        // The band moves far down the list: card 3 leaves the page.
        bandShift = 40000
        window.dispatchEvent(new Event('scroll'))
        await settle()
        expect(cards(target).some((card) => card.getAttribute('data-persona-index') === '3')).toBe(false)
        settingsShellBackStep()
        await settle()
        const active = document.activeElement
        expect(active?.closest('[data-part="settings-persona-card"]')?.getAttribute('data-persona-index')).toBe('3')
    })
})
