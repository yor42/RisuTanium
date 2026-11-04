// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} } }))

import PartialEditController from './PartialEditController.svelte'
import { resetChatSurfaceForTests } from './chatSurface.svelte'
import { hasMessageEditorDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'

const MESSAGE_TEXT = 'Hello partial edit text'
const getTranslationEditContext = vi.fn(async () => 'unavailable' as const)
let bodyRoot: HTMLElement
let paragraph: HTMLElement
let controller: ReturnType<typeof mount> | null = null
let elementFromPointDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
    elementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    vi.stubGlobal('IntersectionObserver', class {
        constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
        observe() { this.callback([{ isIntersecting: true }]) }
        disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0)
        return 1
    })
    bodyRoot = document.createElement('div')
    paragraph = document.createElement('p')
    paragraph.textContent = MESSAGE_TEXT
    bodyRoot.append(paragraph)
    document.body.append(bodyRoot)
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => paragraph })
})

afterEach(async () => {
    if (controller !== null) await unmount(controller)
    controller = null
    document.body.replaceChildren()
    if (elementFromPointDescriptor) Object.defineProperty(document, 'elementFromPoint', elementFromPointDescriptor)
    else Reflect.deleteProperty(document, 'elementFromPoint')
    resetChatSurfaceForTests()
    resetLocalDraftsForTest()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function showController() {
    const holder = document.createElement('div')
    document.body.append(holder)
    controller = mount(PartialEditController, {
        target: holder,
        props: {
            messageData: MESSAGE_TEXT,
            chatIndex: 0,
            bodyRoot,
            blockEditEnabled: true,
            translatedView: true,
            getTranslationEditContext,
        },
    })
    flushSync()
}

function startDeferredBlockEdit() {
    let resolveContext!: (context: { key: string; data: string }) => void
    const context = new Promise<{ key: string; data: string }>((resolve) => {
        resolveContext = resolve
    })
    const getContext = vi.fn(() => context)
    const props = $state({
        messageData: MESSAGE_TEXT,
        chatIndex: 0,
        bodyRoot,
        blockEditEnabled: true,
        translatedView: true,
        getTranslationEditContext: getContext,
    })
    const holder = document.createElement('div')
    document.body.append(holder)
    controller = mount(PartialEditController, { target: holder, props })
    flushSync()
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5, bubbles: true }))
    flushSync()
    const button = document.body.querySelector<HTMLButtonElement>('.partial-edit-btn-wrapper .partial-edit-btn-edit')
    expect(button).not.toBeNull()
    button!.click()
    expect(getContext).toHaveBeenCalledTimes(1)
    return { props, resolveContext }
}

describe('T13 unavailable translation context', () => {
    test('does not open a block edit or a match-failed modal', async () => {
        showController()
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5, bubbles: true }))
        flushSync()
        const button = document.body.querySelector<HTMLButtonElement>('.partial-edit-btn-wrapper .partial-edit-btn-edit')
        expect(button).not.toBeNull()
        button!.click()
        await vi.waitFor(() => expect(getTranslationEditContext).toHaveBeenCalledTimes(1))
        await new Promise((resolve) => setTimeout(resolve, 0))
        flushSync()
        expect(document.body.querySelector('.partial-edit-modal')).toBeNull()
        expect(document.body.querySelector('.partial-match-failed-modal')).toBeNull()
        expect(hasMessageEditorDrafts()).toBe(false)
    })
})

describe('T15 translated view changes during context wait', () => {
    test('T15: switching to original prevents the edit and draft', async () => {
        const { props, resolveContext } = startDeferredBlockEdit()
        props.translatedView = false
        flushSync()
        resolveContext({ key: 'k', data: MESSAGE_TEXT })
        await tick()
        await tick()
        flushSync()
        expect(document.body.querySelector('.partial-edit-modal')).toBeNull()
        expect(document.body.querySelector('.partial-match-failed-modal')).toBeNull()
        expect(hasMessageEditorDrafts()).toBe(false)
    })

    test('T15b: staying translated opens the edit', async () => {
        const { resolveContext } = startDeferredBlockEdit()
        resolveContext({ key: 'k', data: MESSAGE_TEXT })
        await tick()
        await tick()
        flushSync()
        expect(document.body.querySelector('.partial-edit-modal')).not.toBeNull()
        expect(document.body.querySelector('.partial-match-failed-modal')).toBeNull()
        expect(hasMessageEditorDrafts()).toBe(true)
    })
})
