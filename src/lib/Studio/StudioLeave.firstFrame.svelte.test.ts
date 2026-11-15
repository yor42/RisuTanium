// @vitest-environment jsdom
/**
 * Leaving Studio through Back: the control that opened it holds focus at the first animation frame after the
 * press, and only after the chat surface it sits in is shown again. requestAnimationFrame is a manual queue, so a
 * wait that needs a frame or a timer has not finished when the first frame reads the focus.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface TestCharacter {
    chaId: string
    name?: string
    type: string
    chatPage: number
    chats: { id: string }[]
}

const db = $state({ db: { characters: [] as TestCharacter[] } })
const selection = $state({ selId: 0 })
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const ReloadGUIPointer = writable(0)
const ReloadChatPointer = writable<Record<number, number>>({})
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })

vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get ReloadChatPointer() { return ReloadChatPointer },
    get CharConfigSubMenu() { return CharConfigSubMenu },
    get SettingsMenuIndex() { return SettingsMenuIndex },
    get botMakerMode() { return botMakerMode },
    get sideBarStore() { return sideBarStore },
    get QuickSettings() { return QuickSettings },
}))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { resetStudioHistoryAccessorForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { openStudio, resetStudioScreenForTests } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../ts/studio/studioOpen'
import { drainMicrotasks, installFrameQueue, readAtFirstFrame, runFrame, uninstallFrameQueue } from '../../ts/tests/firstFrame.test-helpers'
import { chatSurface, installChatSurface, resetChatSurfaceForTests } from '../ChatScreens/chatSurface.svelte'
import StudioScreen from './StudioScreen.svelte'

class ResizeObserverStub {
    static instances: ResizeObserverStub[] = []
    constructor(private readonly callback: ResizeObserverCallback) {
        ResizeObserverStub.instances.push(this)
    }
    observe(): void {}
    disconnect(): void {
        ResizeObserverStub.instances = ResizeObserverStub.instances.filter((entry) => entry !== this)
    }
    emit(width: number): void {
        this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
}

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined
let opener: HTMLButtonElement

const ownerTarget = { owner: { type: 'character', id: 'char' }, from: 'chat' } as const

function show(width: number): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioScreen, { target: host })
    flushSync()
    for (const observer of ResizeObserverStub.instances) observer.emit(width)
    flushSync()
}

// Real time passes here, with the native frame callback: the open focus the screen takes has finished before the
// test installs its frame queue.
async function settleReal(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30))
    flushSync()
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    ResizeObserverStub.instances = []
    localStorage.clear()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    db.db.characters = [{ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }] }]
    selection.selId = 0
    setStudioEnabled(true)
    opener = document.createElement('button')
    document.body.appendChild(opener)
})

afterEach(async () => {
    runFrame()
    uninstallFrameQueue()
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    opener.remove()
    resetChatSurfaceForTests()
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    setStudioEnabled(false)
    localStorage.clear()
    vi.unstubAllGlobals()
})

describe('T12 leaving Studio by Back', () => {
    test('the opener holds focus at the first frame', async () => {
        opener.focus()
        openStudio(ownerTarget, { element: opener })
        show(400)
        await settleReal()
        expect(document.activeElement).not.toBe(opener)

        installFrameQueue()
        const atFrame = readAtFirstFrame(() => document.activeElement)
        expect(dispatchBack()).toBe(true)
        flushSync()
        await drainMicrotasks()
        runFrame()
        expect(get(studioOpen)).toBe(false)
        expect(await atFrame).toBe(opener)
    })

    test('focus goes to the opener only after the chat surface is shown again', async () => {
        installChatSurface()
        opener.focus()
        openStudio(ownerTarget, { element: opener })
        show(400)
        await settleReal()
        expect(chatSurface.hidden).toBe(true)

        const hiddenAtFocus: boolean[] = []
        const focus = opener.focus.bind(opener)
        vi.spyOn(opener, 'focus').mockImplementation((options?: FocusOptions) => {
            hiddenAtFocus.push(chatSurface.hidden)
            focus(options)
        })
        installFrameQueue()
        const atFrame = readAtFirstFrame(() => ({ active: document.activeElement, hidden: chatSurface.hidden }))
        expect(dispatchBack()).toBe(true)
        flushSync()
        await drainMicrotasks()
        runFrame()
        const seen = await atFrame
        expect(seen.hidden).toBe(false)
        expect(seen.active).toBe(opener)
        expect(hiddenAtFocus).toEqual([false])
    })
})
