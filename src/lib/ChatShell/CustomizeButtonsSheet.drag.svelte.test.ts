// @vitest-environment jsdom
/**
 * CHORE-729: the grip on each Customize buttons row reorders the visible list by pointer drag.
 *
 * Invariants:
 * - Only the grip starts a drag, and only past the slop; a release that changes nothing, and every abort, writes nothing.
 * - A drop applies to the latest shared order and never moves a hidden id.
 * - Escape during a drag cancels only the drag; the next Escape closes the sheet.
 * - Pin, Move up, Move down and Restore defaults abort a live drag before they change the order.
 * - Drag state is cleared even when the save throws.
 *
 * MOCKED: pointer capture, row and sheet geometry (sheet 0..400, row i at top 60 + 44 i and 44 high, so its midpoint is
 * 82 + 44 i) and the animation frame queue (run by hand). jsdom has no layout, capture or touch-action behaviour.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

vi.mock('../../lang', () => ({ language: {
    chatShellCustomizeButtons: 'Customize buttons', chatShellOnThisDevice: 'On this device',
    chatShellMoveUp: 'Move up', chatShellMoveDown: 'Move down', chatShellRestoreDefaults: 'Restore defaults',
} }))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))
import CustomizeButtonsSheet from './CustomizeButtonsSheet.svelte'
import { DEFAULT_ORDER, writeSlots, type ActionId } from '../../ts/chatShell/actionSlots'
import { updateSlots } from '../../ts/chatShell/slotsStore.svelte'

const SLOTS_KEY = 'risuChatShell.actionSlots'
let target: HTMLElement
let app: ReturnType<typeof CustomizeButtonsSheet> | undefined
let frames: Map<number, FrameRequestCallback>
let nextFrame: number
const setCapture = vi.fn()

const DEF: ActionId[] = [...DEFAULT_ORDER]
const DEFAULT_PINS: ActionId[] = ['edit', 'delete']
const R: ActionId[] = ['edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'deleteAfter', 'customizeButtons', 'hideAI']
const E: ActionId[] = ['edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'hideAI', 'deleteAfter', 'customizeButtons', 'bookmark']
const G3: ActionId[] = ['delete', 'copy', 'edit', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI', 'deleteAfter', 'customizeButtons']
const H0: ActionId[] = ['hideAI', 'edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'deleteAfter', 'customizeButtons']
const S10: ActionId[] = ['delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'edit', 'bookmark', 'hideAI', 'deleteAfter', 'customizeButtons']
const C3: ActionId[] = ['copy', 'delete', 'edit', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI', 'deleteAfter', 'customizeButtons']
const DC: ActionId[] = ['edit', 'delete', 'translate', 'copy', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI', 'deleteAfter', 'customizeButtons']

function box(top: number, height: number): DOMRect {
    return { top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) }
}

beforeEach(() => {
    frames = new Map()
    nextFrame = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(nextFrame, callback); return nextFrame++ })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    setCapture.mockClear()
    Object.assign(HTMLElement.prototype, { setPointerCapture: setCapture, releasePointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false) })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const part = this.getAttribute('data-part')
        if (part === 'chat-sheet') return box(0, 400)
        if (part === 'chat-customize-action') return box(60 + 44 * [...this.parentElement!.querySelectorAll('[data-part="chat-customize-action"]')].indexOf(this), 44)
        return box(0, 0)
    })
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    localStorage.removeItem(SLOTS_KEY)
    localStorage.removeItem('risuChatShell.haptics')
    Reflect.deleteProperty(navigator, 'vibrate')
    for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) Reflect.deleteProperty(HTMLElement.prototype, name)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function mountSheet(props: { onchange?: () => void; onclose?: () => void } = {}): { state: { open: boolean }; onclose: () => void } {
    target = document.createElement('div')
    document.body.appendChild(target)
    const state = $state({ open: true })
    const onclose = props.onclose ?? vi.fn()
    app = mount(CustomizeButtonsSheet, { target, props: { get open() { return state.open }, onclose, onchange: props.onchange } })
    flushSync()
    return { state, onclose }
}
function section(): HTMLElement { return target.querySelector<HTMLElement>('[data-part="chat-sheet"]')! }
function rows(): HTMLElement[] { return [...target.querySelectorAll<HTMLElement>('[data-part="chat-customize-action"]')] }
function rowOf(id: string): HTMLElement { return rows().find((row) => row.querySelector('label')!.textContent === id)! }
function gripOf(id: string): HTMLElement { return rowOf(id).querySelector<HTMLElement>('.customize-grip')! }
function stored(): { order: ActionId[]; pinned: ActionId[] } { return JSON.parse(localStorage.getItem(SLOTS_KEY)!) }
function noWrite(): void { expect(localStorage.getItem(SLOTS_KEY)).toBeNull() }
function midOf(id: string): number { return 82 + 44 * rows().indexOf(rowOf(id)) }

interface PointerInit { y?: number; pointerId?: number; pointerType?: string; button?: number }
function fire(on: EventTarget, type: string, init: PointerInit = {}): MouseEvent {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: init.y ?? 0, button: init.button ?? 0 })
    Object.defineProperties(event, { pointerType: { value: init.pointerType ?? 'touch' }, pointerId: { value: init.pointerId ?? 1 } })
    on.dispatchEvent(event)
    flushSync()
    return event
}
function down(on: Element, init: PointerInit = {}): MouseEvent { return fire(on, 'pointerdown', init) }
function moveTo(y: number, init: PointerInit = {}): void { fire(section(), 'pointermove', { ...init, y }) }
function upAt(y: number, init: PointerInit = {}): void { fire(section(), 'pointerup', { ...init, y }) }
function gripDown(id: string, init: PointerInit = {}): void { down(gripOf(id), { y: midOf(id), ...init }) }
function press(name: string): void {
    ;[...target.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.getAttribute('aria-label') === name || button.textContent === name)!.click()
    flushSync()
}
function dragging(): HTMLElement[] { return [...target.querySelectorAll<HTMLElement>('[data-customize-dragging]')] }
function expectNoDragState(): void {
    expect(target.querySelectorAll('[data-customize-dragging]').length).toBe(0)
    expect(target.querySelectorAll('[data-customize-drop]').length).toBe(0)
    expect(target.querySelectorAll('.customize-drop-line').length).toBe(0)
}
function runFrames(): void {
    const queued = [...frames.values()]
    frames.clear()
    for (const callback of queued) callback(0)
    flushSync()
}
function escape(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    flushSync()
    return event
}

describe('a grip drag reorders the visible list', () => {
    test('D1a: edit dropped at gap 3 moves below copy and the hidden ids keep their indices', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(190)
        expect(dragging()).toEqual([rowOf('edit')])
        upAt(190)
        expect(stored().order).toEqual(G3)
        expectNoDragState()
    })
    test('D1b: hideAI dropped at gap 0 moves to the top', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('hideAI')
        moveTo(70)
        upAt(70)
        expect(stored().order).toEqual(H0)
    })
    test('D1c: a stored layout with drifted hidden ids keeps them where they are', () => {
        writeSlots({ order: R, pinned: DEFAULT_PINS })
        mountSheet()
        gripDown('hideAI')
        moveTo(500)
        upAt(500)
        expect(stored().order).toEqual(E)
    })
    test('D1d: the gaps beside the dragged row show no line and write nothing', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        for (const y of [70, 100]) {
            gripDown('edit')
            moveTo(y)
            expect(dragging()).toEqual([rowOf('edit')])
            expect(target.querySelectorAll('[data-customize-drop]').length).toBe(0)
            upAt(y)
            noWrite()
            expectNoDragState()
        }
    })
    test('D1e: the drop line is drawn at the gap under the pointer', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(190)
        expect(rowOf('translate').getAttribute('data-customize-drop')).toBe('before')
        expect(rowOf('translate').querySelector('.customize-drop-line')).not.toBeNull()
        moveTo(600)
        expect(rowOf('hideAI').getAttribute('data-customize-drop')).toBe('after')
        upAt(600)
    })
})

describe('every abort writes nothing and clears the drag state', () => {
    test.each([
        ['pointercancel', () => fire(section(), 'pointercancel')],
        ['lostpointercapture', () => fire(section(), 'lostpointercapture')],
        ['window blur', () => { window.dispatchEvent(new Event('blur')); flushSync() }],
    ])('D2: %s after arming', (_name, trigger) => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(190)
        expect(dragging().length).toBe(1)
        trigger()
        expectNoDragState()
        upAt(190)
        noWrite()
    })
    test('D3: Escape cancels only the drag, and the next Escape closes the sheet', () => {
        localStorage.removeItem(SLOTS_KEY)
        const { onclose } = mountSheet()
        gripDown('edit')
        moveTo(190)
        const first = escape()
        expect(first.defaultPrevented).toBe(true)
        expect(onclose).not.toHaveBeenCalled()
        expectNoDragState()
        upAt(190)
        noWrite()
        escape()
        expect(onclose).toHaveBeenCalledTimes(1)
    })
})

describe('only the grip starts a drag', () => {
    test('D4: a press on the label or on Move up does nothing', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        for (const on of [rowOf('edit').querySelector('label')!, rowOf('edit').querySelector('button')!]) {
            down(on, { y: 82 })
            moveTo(182)
            expectNoDragState()
            upAt(182)
        }
        expect(setCapture).not.toHaveBeenCalled()
        noWrite()
    })
    test('D5: a 300 px grip drag neither moves nor closes the sheet', () => {
        localStorage.removeItem(SLOTS_KEY)
        const { onclose } = mountSheet()
        gripDown('edit')
        for (const y of [150, 250, 382]) {
            moveTo(y)
            expect(section().hasAttribute('data-dragging')).toBe(false)
            expect(section().hasAttribute('data-moved')).toBe(false)
        }
        upAt(382)
        expect(onclose).not.toHaveBeenCalled()
    })
    test('D8a: a secondary mouse button does nothing', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit', { pointerType: 'mouse', button: 2 })
        moveTo(182, { pointerType: 'mouse' })
        expectNoDragState()
        upAt(182, { pointerType: 'mouse' })
        noWrite()
    })
    test('D8b: a press that stays inside the slop does nothing', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(85)
        expectNoDragState()
        upAt(85)
        noWrite()
    })
})

describe('autoscroll', () => {
    test('D6: the gap accounts for how far the sheet has scrolled', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(395)
        for (let frame = 0; frame < 10; frame++) runFrames()
        expect(section().scrollTop).toBeGreaterThan(0)
        upAt(395)
        expect(stored().order).toEqual(S10)
    })
})

describe('the drag ends with the sheet', () => {
    test('D7a: closing the sheet mid-drag aborts', () => {
        localStorage.removeItem(SLOTS_KEY)
        const { state } = mountSheet()
        const retained = section()
        gripDown('edit')
        moveTo(190)
        state.open = false
        flushSync()
        fire(retained, 'pointerup', { y: 190 })
        noWrite()
    })
    test('D7b: unmounting mid-drag aborts', async () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        const retained = section()
        gripDown('edit')
        moveTo(190)
        await unmount(app!)
        app = undefined
        fire(retained, 'pointerup', { y: 190 })
        noWrite()
    })
})

describe('the haptic tick', () => {
    function vibrate() {
        const spy = vi.fn(() => true)
        Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value: spy })
        return spy
    }
    test('D9: a touch drop that changes the order ticks once, and not at arming', () => {
        const spy = vibrate()
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(190)
        expect(spy).not.toHaveBeenCalled()
        upAt(190)
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy).toHaveBeenCalledWith(10)
    })
    test.each([
        ['a touch drop into the own gap', 'touch', 100, false],
        ['a changing mouse drop', 'mouse', 190, false],
        ['a changing pen drop', 'pen', 190, false],
        ['a changing touch drop with haptics switched off', 'touch', 190, true],
    ])('D9: no tick on %s', (_name, pointerType, y, switchedOff) => {
        const spy = vibrate()
        if (switchedOff) localStorage.setItem('risuChatShell.haptics', '0')
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit', { pointerType })
        moveTo(y, { pointerType })
        upAt(y, { pointerType })
        expect(spy).not.toHaveBeenCalled()
    })
    test('D9: no tick on a cancelled touch drag', () => {
        const spy = vibrate()
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(190)
        fire(section(), 'pointercancel')
        expect(spy).not.toHaveBeenCalled()
    })
})

describe('the grip markup', () => {
    test('D10: first in the row, hidden from assistive technology, no part and no live region', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        expect(rows().length).toBe(12)
        for (const row of rows()) {
            const grip = row.firstElementChild as HTMLElement
            expect(grip.classList.contains('customize-grip')).toBe(true)
            expect(grip.getAttribute('aria-hidden')).toBe('true')
            expect(grip.getAttribute('data-panel-gesture')).toBe('off')
            expect(grip.style.touchAction).toBe('none')
            expect(grip.hasAttribute('tabindex')).toBe(false)
            expect(grip.hasAttribute('data-part')).toBe(false)
            expect(row.querySelectorAll('button').length).toBe(2)
        }
        expect(section().querySelector('[aria-live]')).toBeNull()
    })
})

describe('the drop applies to the latest shared order', () => {
    test('D11: a change from another sheet mid-drag is kept', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(190)
        updateSlots({ order: ['copy', 'edit', 'delete', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI', 'deleteAfter', 'customizeButtons'], pinned: DEFAULT_PINS })
        flushSync()
        upAt(190)
        expect(stored().order).toEqual(C3)
    })
    test('D12: a throwing save still clears the drag state', () => {
        localStorage.removeItem(SLOTS_KEY)
        const errors: Error[] = []
        const onError = (event: ErrorEvent) => { errors.push(event.error as Error); event.preventDefault() }
        window.addEventListener('error', onError)
        try {
            mountSheet({ onchange: () => { throw new Error('boom') } })
            gripDown('edit')
            moveTo(190)
            upAt(190)
            expect(errors.map((error) => error.message)).toEqual(['boom'])
            expectNoDragState()
            gripDown('copy')
            moveTo(midOf('copy') + 60)
            expect(dragging()).toEqual([rowOf('copy')])
            fire(section(), 'pointercancel')
        } finally {
            window.removeEventListener('error', onError)
        }
    })
    test('D13: a second pointer is ignored while a drag is live', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(190)
        gripDown('hideAI', { pointerId: 2 })
        expect(dragging()).toEqual([rowOf('edit')])
        upAt(190)
        expect(stored().order).toEqual(G3)
    })
})

describe('a change to the layout aborts a live drag first', () => {
    test('D14a: pinning', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(190)
        rowOf('copy').querySelector<HTMLInputElement>('input')!.click()
        flushSync()
        expectNoDragState()
        upAt(190)
        expect(stored()).toEqual({ order: DEF, pinned: ['edit', 'delete', 'copy'] })
    })
    test('D14b: Restore defaults', () => {
        writeSlots({ order: R, pinned: ['edit', 'delete'] })
        mountSheet()
        gripDown('hideAI')
        moveTo(70)
        press('Restore defaults')
        expectNoDragState()
        upAt(70)
        expect(stored()).toEqual({ order: DEF, pinned: ['edit', 'delete'] })
    })
    test('D14c: Move up and Move down', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        gripDown('edit')
        moveTo(190)
        press('Move down copy')
        expectNoDragState()
        expect(stored().order).toEqual(DC)
        upAt(190)
        expect(stored().order).toEqual(DC)
    })
})
