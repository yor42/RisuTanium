// @vitest-environment jsdom

/**
 * The four PartialEditController modals and the floating buttons it builds in TS carry chat parts (#438 W3-7). The REAL component is
 * mounted with the real `partialEdit` matcher and `localDrafts`, and every state is reached through the real openers (the wrapper's
 * Edit and Delete buttons, the option rows). Each element is found by class, structure or text, never by its part, and the part is
 * asserted on it together with its direct parent. The outline tests pin the whole nesting, so a part that is dropped, renamed, swapped
 * or put on an element that is promised to carry none (the delete overlay, its meta, hint, confidence and button row, every icon and
 * label, the selection line and method spans) fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: the stores module (database), the viewport observer, requestAnimationFrame, elementFromPoint and the jsdom-missing
 * Range.getBoundingClientRect. Synthetic data only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: {} },
}))

import { language } from 'src/lang'
import { CRITICAL_PARTS } from 'src/ts/themePack/engine'
import PartialEditController from './PartialEditController.svelte'
import { chatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'
import { resetLocalDraftsForTest } from 'src/ts/localDrafts'

const UNIQUE = 'Hello partial edit text'
const TWICE = 'first line\n\nRepeat this sentence here\n\nmiddle line\n\nRepeat this sentence here\n\nlast line'
const TWICE_BLOCK = 'Repeat this sentence here'
const NO_MATCH = 'Completely different stored words'

let bodyRoot: HTMLElement
let paragraph: HTMLElement
let holder: HTMLElement
let mountedController: Record<string, unknown> | null = null
let saves: Array<{ newData: string, target: string }> = []
let hadRangeRect = false
let rangeRect: unknown

beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
        constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
        observe() {
            this.callback([{ isIntersecting: true }])
        }
        disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0)
        return 1
    })
    const proto = Range.prototype as unknown as Record<string, unknown>
    hadRangeRect = 'getBoundingClientRect' in proto
    rangeRect = proto.getBoundingClientRect
    proto.getBoundingClientRect = () => ({ left: 10, right: 110, top: 10, bottom: 30, width: 100, height: 20, x: 10, y: 10, toJSON: () => ({}) })
    saves = []
    bodyRoot = document.createElement('div')
    paragraph = document.createElement('p')
    bodyRoot.append(paragraph)
    document.body.append(bodyRoot)
    ;(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => paragraph
})

afterEach(async () => {
    if (mountedController !== null) {
        await unmount(mountedController as never)
    }
    mountedController = null
    window.getSelection()?.removeAllRanges()
    document.body.replaceChildren()
    resetChatSurfaceForTests()
    resetLocalDraftsForTest()
    const proto = Range.prototype as unknown as Record<string, unknown>
    if (hadRangeRect) proto.getBoundingClientRect = rangeRect
    else delete proto.getBoundingClientRect
    vi.unstubAllGlobals()
})

function show(messageData: string, block: string, props: Record<string, unknown> = { blockEditEnabled: true }) {
    paragraph.textContent = block
    holder = document.createElement('div')
    document.body.append(holder)
    mountedController = mount(PartialEditController, {
        target: holder,
        props: { messageData, chatIndex: 0, bodyRoot, ...props },
        events: { save: (event: CustomEvent<{ newData: string, target: string }>) => saves.push(event.detail) },
    } as never) as unknown as Record<string, unknown>
    flushSync()
}

function hover() {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5, bubbles: true }))
    flushSync()
}

async function settled(check: () => void) {
    await vi.waitFor(() => {
        flushSync()
        check()
    })
}

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null
const norm = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

function one<T extends Element>(root: ParentNode, selector: string): T {
    const found = root.querySelectorAll<T>(selector)
    expect(found, selector).toHaveLength(1)
    return found[0]
}

/** The only button under the root whose normalised text is exactly `text`. */
function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((el) => norm(el.textContent) === norm(text))
    expect(found, `button with text ${text}`).toHaveLength(1)
    return found[0]
}

function buttonByTitle(root: ParentNode, title: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((el) => el.getAttribute('title') === title)
    expect(found, `button titled ${title}`).toHaveLength(1)
    return found[0]
}

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

function expectUnparted(root: ParentNode, selector: string, parent: Element | null = null) {
    const found = Array.from(root.querySelectorAll(selector))
    expect(found.length, selector).toBeGreaterThan(0)
    for (const el of found) {
        expect(partOf(el), selector).toBeNull()
        if (parent) expect(el.parentElement, selector).toBe(parent)
    }
}

const blockWrapper = (): HTMLElement => one<HTMLElement>(document.body, '.partial-edit-btn-wrapper:not(.partial-edit-drag-btn-wrapper)')
const dragWrapper = (): HTMLElement => one<HTMLElement>(document.body, '.partial-edit-drag-btn-wrapper')
const editTitle = () => language.partialEdit.editButtonTooltip
const deleteTitle = () => language.partialEdit.deleteButtonTooltip

async function openEdit(messageData: string, block: string) {
    show(messageData, block)
    hover()
    buttonByTitle(blockWrapper(), editTitle()).click()
}

async function openDelete(messageData: string, block: string) {
    show(messageData, block)
    hover()
    buttonByTitle(blockWrapper(), deleteTitle()).click()
}

function expectButtons(wrapper: HTMLElement) {
    expect(partOf(wrapper)).toBe('chat-partial-buttons')
    expect(wrapper.parentElement).toBe(document.body)
    const edit = buttonByTitle(wrapper, editTitle())
    const del = buttonByTitle(wrapper, deleteTitle())
    expect(partOf(edit)).toBe('chat-partial-start-edit')
    expect(edit.parentElement).toBe(wrapper)
    expect(partOf(del)).toBe('chat-partial-start-delete')
    expect(del.parentElement).toBe(wrapper)
    for (const button of [edit, del]) {
        const inner = Array.from(button.querySelectorAll('*'))
        expect(inner.length).toBeGreaterThan(0)
        for (const el of inner) expect(partOf(el), el.tagName).toBeNull()
    }
    expect(outline(wrapper)).toBe('chat-partial-buttons(chat-partial-start-edit chat-partial-start-delete)')
}

describe('the TS-built floating buttons', () => {
    test('acceptance R1: the block wrapper and its two buttons carry the chat parts, the icons none', () => {
        show(UNIQUE, UNIQUE)
        hover()
        expectButtons(blockWrapper())
    })

    test('acceptance R2: the drag wrapper is built by the same function and carries the same parts', async () => {
        show(UNIQUE, UNIQUE, { dragEditEnabled: true })
        const range = document.createRange()
        range.selectNodeContents(paragraph)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        await settled(() => expect(document.body.querySelector('.partial-edit-drag-btn-wrapper')).not.toBeNull())
        expectButtons(dragWrapper())
    })
})

describe('the edit modal', () => {
    test('acceptance R3: overlay, panel, header, meta, field, actions and buttons; icons and labels carry none', async () => {
        await openEdit(UNIQUE, UNIQUE)
        await settled(() => expect(holder.querySelector('.partial-edit-modal')).not.toBeNull())
        const overlay = one<HTMLElement>(holder, '.partial-edit-overlay')
        expect(partOf(overlay)).toBe('chat-partial-scrim')
        expect(overlay.parentElement).toBe(holder)
        const panel = one<HTMLElement>(overlay, '.partial-edit-modal')
        expect(partOf(panel)).toBe('chat-partial-edit')
        expect(panel.parentElement).toBe(overlay)
        const header = one<HTMLElement>(panel, '.partial-edit-header')
        expect(partOf(header)).toBe('chat-partial-header')
        expect(header.parentElement).toBe(panel)
        const title = one<HTMLElement>(header, '.partial-edit-title')
        expect(partOf(title)).toBe('chat-partial-title')
        expect(title.parentElement).toBe(header)
        const meta = one<HTMLElement>(header, '.partial-match-meta')
        expect(partOf(meta)).toBe('chat-partial-meta')
        expect(meta.parentElement).toBe(header)
        const hint = one<HTMLElement>(meta, '.partial-match-hint')
        expect(partOf(hint)).toBe('chat-partial-hint')
        expect(hint.parentElement).toBe(meta)
        const confidence = one<HTMLElement>(meta, '.partial-match-confidence')
        expect(partOf(confidence)).toBe('chat-partial-confidence')
        expect(confidence.parentElement).toBe(meta)
        const field = one<HTMLTextAreaElement>(panel, 'textarea')
        expect(partOf(field)).toBe('chat-partial-field')
        expect(field.parentElement).toBe(panel)
        const actions = one<HTMLElement>(panel, '.partial-edit-buttons')
        expect(partOf(actions)).toBe('chat-partial-actions')
        expect(actions.parentElement).toBe(panel)
        const save = buttonByText(actions, language.partialEdit.save)
        const cancel = buttonByText(actions, language.partialEdit.cancel)
        expect(partOf(save)).toBe('chat-partial-save')
        expect(save.parentElement).toBe(actions)
        expect(partOf(cancel)).toBe('chat-partial-cancel')
        expect(cancel.parentElement).toBe(actions)
        expectUnparted(actions, 'svg', null)
        expectUnparted(actions, 'span', null)
        for (const button of [save, cancel]) {
            for (const el of Array.from(button.querySelectorAll('svg, span'))) {
                expect(partOf(el), el.tagName).toBeNull()
                expect(el.parentElement).toBe(button)
            }
        }
        expect(outline(overlay)).toBe('chat-partial-scrim(chat-partial-edit(chat-partial-header(chat-partial-title chat-partial-meta(chat-partial-hint chat-partial-confidence)) chat-partial-field chat-partial-actions(chat-partial-save chat-partial-cancel)))')
    })

    test('guard G2: Save dispatches one save; a click on the overlay closes, a click on the panel does not', async () => {
        await openEdit(UNIQUE, UNIQUE)
        await settled(() => expect(holder.querySelector('.partial-edit-modal')).not.toBeNull())
        one<HTMLElement>(holder, '.partial-edit-modal').click()
        flushSync()
        expect(holder.querySelector('.partial-edit-modal')).not.toBeNull()
        const field = one<HTMLTextAreaElement>(holder, 'textarea')
        field.value = 'Edited words'
        field.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        buttonByText(holder, language.partialEdit.save).click()
        flushSync()
        expect(saves).toEqual([{ newData: 'Edited words', target: 'original', translationKey: undefined }])
        expect(holder.querySelector('.partial-edit-modal')).toBeNull()
    })

    test('guard G2b: a click on the overlay itself closes the editor without saving', async () => {
        await openEdit(UNIQUE, UNIQUE)
        await settled(() => expect(holder.querySelector('.partial-edit-modal')).not.toBeNull())
        one<HTMLElement>(holder, '.partial-edit-overlay').click()
        flushSync()
        expect(holder.querySelector('.partial-edit-overlay')).toBeNull()
        expect(saves).toEqual([])
    })
})

describe('the delete confirm', () => {
    async function confirm() {
        await openDelete(UNIQUE, UNIQUE)
        await settled(() => expect(holder.querySelector('.partial-delete-modal')).not.toBeNull())
        return one<HTMLElement>(holder, '.partial-edit-overlay')
    }

    test('acceptance R4: the confirm is the protected root, holds only protected names, and its overlay, meta, row, icons and labels carry none', async () => {
        const overlay = await confirm()
        expect(partOf(overlay)).toBeNull()
        expect(overlay.parentElement).toBe(holder)
        const panel = one<HTMLElement>(overlay, '.partial-delete-modal')
        expect(partOf(panel)).toBe('chat-partial-delete')
        expect(panel.hasAttribute('data-part-critical')).toBe(true)
        expect(panel.parentElement).toBe(overlay)
        const header = one<HTMLElement>(panel, '.partial-delete-header')
        expect(partOf(header)).toBe('chat-critical-header')
        expect(header.parentElement).toBe(panel)
        const title = one<HTMLElement>(header, '.partial-delete-title')
        expect(partOf(title)).toBe('chat-critical-title')
        expect(title.parentElement).toBe(header)
        const meta = one<HTMLElement>(header, '.partial-match-meta')
        expect(partOf(meta)).toBeNull()
        expect(meta.parentElement).toBe(header)
        const hint = one<HTMLElement>(meta, '.partial-match-hint')
        expect(partOf(hint)).toBeNull()
        expect(hint.parentElement).toBe(meta)
        const confidence = one<HTMLElement>(meta, '.partial-match-confidence')
        expect(partOf(confidence)).toBeNull()
        expect(confidence.parentElement).toBe(meta)
        const message = one<HTMLElement>(panel, '.partial-delete-message')
        const preview = one<HTMLElement>(panel, '.partial-delete-preview')
        for (const el of [message, preview]) {
            expect(partOf(el)).toBe('chat-critical-body')
            expect(el.parentElement).toBe(panel)
        }
        const row = one<HTMLElement>(panel, '.partial-edit-buttons')
        expect(partOf(row)).toBeNull()
        expect(row.parentElement).toBe(panel)
        const yes = buttonByText(row, language.partialEdit.deleteYes)
        const no = buttonByText(row, language.partialEdit.deleteNo)
        for (const button of [yes, no]) {
            expect(partOf(button)).toBe('chat-critical-action')
            expect(button.parentElement).toBe(row)
            for (const el of Array.from(button.querySelectorAll('svg, span'))) {
                expect(partOf(el), el.tagName).toBeNull()
                expect(el.parentElement).toBe(button)
            }
        }
        for (const el of Array.from(row.querySelectorAll('svg, span'))) expect(partOf(el), el.tagName).toBeNull()
        // Closure: the confirm holds protected names only, and only the panel is the marked root.
        for (const el of Array.from(overlay.querySelectorAll('[data-part]'))) expect(CRITICAL_PARTS, partOf(el) ?? '').toContain(partOf(el))
        expect(Array.from(overlay.querySelectorAll('[data-part-critical]'))).toEqual([panel])
        expect(outline(overlay)).toBe('chat-partial-delete(chat-critical-header(chat-critical-title) chat-critical-body chat-critical-body chat-critical-action chat-critical-action)')
    })

    test('guard G1: Yes dispatches exactly one save without the range', async () => {
        await confirm()
        buttonByText(holder, language.partialEdit.deleteYes).click()
        flushSync()
        expect(saves).toHaveLength(1)
        expect(saves[0].newData).toBe('')
        expect(holder.querySelector('.partial-edit-overlay')).toBeNull()
    })

    test('guard G1b: No dispatches none and removes the overlay', async () => {
        await confirm()
        buttonByText(holder, language.partialEdit.deleteNo).click()
        flushSync()
        expect(saves).toEqual([])
        expect(holder.querySelector('.partial-edit-overlay')).toBeNull()
    })
})

describe('the selection modal', () => {
    function expectSelection(overlay: HTMLElement, titleText: string) {
        expect(partOf(overlay)).toBe('chat-partial-scrim')
        expect(overlay.parentElement).toBe(holder)
        const panel = one<HTMLElement>(overlay, '.partial-match-selection-modal')
        expect(partOf(panel)).toBe('chat-partial-match')
        expect(panel.parentElement).toBe(overlay)
        const header = one<HTMLElement>(panel, '.match-selection-header')
        expect(partOf(header)).toBe('chat-partial-header')
        expect(header.parentElement).toBe(panel)
        const title = one<HTMLElement>(header, '.match-selection-title')
        expect(partOf(title)).toBe('chat-partial-title')
        expect(norm(title.textContent)).toBe(norm(titleText))
        const count = one<HTMLElement>(header, '.match-count')
        expect(partOf(count)).toBe('chat-partial-count')
        expect(count.parentElement).toBe(header)
        const list = one<HTMLElement>(panel, '.match-list')
        expect(partOf(list)).toBe('chat-partial-list')
        expect(list.parentElement).toBe(panel)
        const options = Array.from(list.querySelectorAll<HTMLElement>('.match-item'))
        expect(options).toHaveLength(2)
        for (const option of options) {
            expect(partOf(option)).toBe('chat-partial-option')
            expect(option.parentElement).toBe(list)
            const meta = one<HTMLElement>(option, '.match-meta')
            expect(partOf(meta)).toBe('chat-partial-option-meta')
            expect(meta.parentElement).toBe(option)
            const confidence = one<HTMLElement>(meta, '.match-confidence')
            expect(partOf(confidence)).toBe('chat-partial-confidence')
            expect(confidence.parentElement).toBe(meta)
            expectUnparted(meta, '.match-line', meta)
            expectUnparted(meta, '.match-method', meta)
            const text = one<HTMLElement>(option, '.match-text')
            expect(partOf(text)).toBe('chat-partial-option-text')
            expect(text.parentElement).toBe(option)
            for (const context of Array.from(option.querySelectorAll<HTMLElement>('.match-context-before, .match-context-after'))) {
                expect(partOf(context)).toBe('chat-partial-context')
                expect(context.parentElement).toBe(option)
            }
        }
        const actions = one<HTMLElement>(panel, '.partial-edit-buttons')
        expect(partOf(actions)).toBe('chat-partial-actions')
        expect(actions.parentElement).toBe(panel)
        const cancel = buttonByText(actions, language.cancel)
        expect(partOf(cancel)).toBe('chat-partial-cancel')
        expect(cancel.parentElement).toBe(actions)
        for (const el of Array.from(cancel.querySelectorAll('svg, span'))) {
            expect(partOf(el), el.tagName).toBeNull()
            expect(el.parentElement).toBe(cancel)
        }
        const option = 'chat-partial-option(chat-partial-option-meta(chat-partial-confidence) chat-partial-context chat-partial-option-text chat-partial-context)'
        expect(outline(overlay)).toBe(`chat-partial-scrim(chat-partial-match(chat-partial-header(chat-partial-title chat-partial-count) chat-partial-list(${option} ${option}) chat-partial-actions(chat-partial-cancel)))`)
    }

    test('acceptance R5: edit mode with two matches carries the selection vocabulary', async () => {
        await openEdit(TWICE, TWICE_BLOCK)
        await settled(() => expect(holder.querySelector('.partial-match-selection-modal')).not.toBeNull())
        expectSelection(one<HTMLElement>(holder, '.partial-edit-overlay'), language.partialEdit.selectMatch)
    })

    test('acceptance R5b: delete mode carries the same vocabulary and an option opens the protected confirm', async () => {
        await openDelete(TWICE, TWICE_BLOCK)
        await settled(() => expect(holder.querySelector('.partial-match-selection-modal')).not.toBeNull())
        expectSelection(one<HTMLElement>(holder, '.partial-edit-overlay'), language.partialEdit.selectDeleteMatch)
        holder.querySelectorAll<HTMLElement>('.match-item')[0].click()
        flushSync()
        const panel = one<HTMLElement>(holder, '.partial-delete-modal')
        expect(partOf(panel)).toBe('chat-partial-delete')
        expect(holder.querySelector('.partial-match-selection-modal')).toBeNull()
    })

    test('guard: Cancel closes the selection without saving', async () => {
        await openEdit(TWICE, TWICE_BLOCK)
        await settled(() => expect(holder.querySelector('.partial-match-selection-modal')).not.toBeNull())
        buttonByText(holder, language.cancel).click()
        flushSync()
        expect(holder.querySelector('.partial-edit-overlay')).toBeNull()
        expect(saves).toEqual([])
    })
})

describe('the failed modal', () => {
    test('acceptance R6: the failed modal carries the alert vocabulary, icon and label none', async () => {
        await openEdit(NO_MATCH, UNIQUE)
        await settled(() => expect(holder.querySelector('.partial-match-failed-modal')).not.toBeNull())
        const overlay = one<HTMLElement>(holder, '.partial-edit-overlay')
        expect(partOf(overlay)).toBe('chat-partial-scrim')
        expect(overlay.parentElement).toBe(holder)
        const panel = one<HTMLElement>(overlay, '.partial-match-failed-modal')
        expect(partOf(panel)).toBe('chat-partial-failed')
        expect(panel.parentElement).toBe(overlay)
        const header = one<HTMLElement>(panel, '.partial-match-failed-header')
        expect(partOf(header)).toBe('chat-partial-header')
        expect(header.parentElement).toBe(panel)
        const title = one<HTMLElement>(header, '.partial-match-failed-title')
        expect(partOf(title)).toBe('chat-partial-title')
        expect(title.parentElement).toBe(header)
        const message = one<HTMLElement>(panel, '.partial-match-failed-message')
        expect(partOf(message)).toBe('chat-partial-message')
        expect(message.parentElement).toBe(panel)
        const actions = one<HTMLElement>(panel, '.partial-edit-buttons')
        expect(partOf(actions)).toBe('chat-partial-actions')
        expect(actions.parentElement).toBe(panel)
        const ok = buttonByText(actions, language.confirm)
        expect(partOf(ok)).toBe('chat-partial-dismiss')
        expect(ok.parentElement).toBe(actions)
        for (const el of Array.from(ok.querySelectorAll('svg, span'))) {
            expect(partOf(el), el.tagName).toBeNull()
            expect(el.parentElement).toBe(ok)
        }
        expect(outline(overlay)).toBe('chat-partial-scrim(chat-partial-failed(chat-partial-header(chat-partial-title) chat-partial-message chat-partial-actions(chat-partial-dismiss)))')
    })

    test('guard G3: OK closes the failed modal', async () => {
        await openEdit(NO_MATCH, UNIQUE)
        await settled(() => expect(holder.querySelector('.partial-match-failed-modal')).not.toBeNull())
        buttonByText(holder, language.confirm).click()
        flushSync()
        expect(holder.querySelector('.partial-edit-overlay')).toBeNull()
    })
})

describe('behaviour that stays', () => {
    test('guard: opening Settings still hides the wrappers and closes an open confirm', async () => {
        await openDelete(UNIQUE, UNIQUE)
        await settled(() => expect(holder.querySelector('.partial-delete-modal')).not.toBeNull())
        chatSurface.closeEpoch += 1
        flushSync()
        expect(holder.querySelector('.partial-delete-modal')).toBeNull()
        expect(blockWrapper().style.display).toBe('none')
    })
})
