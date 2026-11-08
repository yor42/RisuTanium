// @vitest-environment jsdom
/**
 * The delete confirm of the This-chat sheet (S4, S12), with the REAL ChatShell, ShellHeader, ThisChatSheet,
 * ChatDeleteConfirm, PatternWarning and ShellSheet: the confirm is a danger warning with its arm delay, rendered after the
 * sheet layer and not inside it, with its own Back handler; Esc and Back return to the sheet; nothing stays inert; after
 * the delete the transcript takes focus without scrolling. Guards by construction: the components are new. The chat
 * list, the stores and the module-level actions are replaced; `removeChatConfirmed` is a faithful small stand-in whose
 * real behaviour is pinned in removeChatConfirmed.confirm.svelte.test.ts.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'

const h = vi.hoisted(() => ({
    removeCalls: 0,
    /** Runs at the moment `removeChatConfirmed` has the answer and is about to remove. */
    atRemoval: null as null | (() => void),
    removeResults: [] as boolean[],
    busy: false,
}))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const chat = (id: string, name: string) => ({ id, name, note: '', localLore: [], message: [{ role: 'user', data: 'a', chatId: `${id}-1`, time: 1_000 }, { role: 'char', data: 'b', chatId: `${id}-2`, time: 2_000 }] })
    const DBState = $state({ db: {
        characters: [{ chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, removedQuotes: true, creatorNotes: '', chats: [chat('c1', 'Harbour night'), chat('c2', 'Second')] }],
        personas: [{ id: 'p1', name: 'Captain' }], selectedPersona: 0, username: 'User', sendWithEnter: true, jailbreak: '', jailbreakToggle: false,
        supaModelType: 'none', hypav2: false, hypaV3: false, customPromptTemplateToggle: '', globalChatVariables: {},
    } })
    const selIdState = $state({ selId: 0 })
    const additionalChatMenu = $state([])
    return {
        DBState, selIdState, selectedCharID: writable(0), additionalChatMenu, settingsOpen: writable(false), hypaV3ModalOpen: writable(false),
        MobileGUI: writable(false), DynamicGUI: writable(false), sideBarClosing: writable(false), sideBarStore: writable(false), MobileSideBar: writable(0),
    }
})
vi.mock('../../ts/process/index.svelte', async () => { const { writable } = await import('svelte/store'); return { doingChat: writable(false), chatProcessStage: writable(0) } })
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0 } }))
vi.mock('./ShellMessageList.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./SendFailureCard.svelte', () => ({ default: () => ({}) }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
vi.mock('../Setting/settingsRoute', () => ({}))
vi.mock('../../ts/chatShell/sendFailure.svelte', () => ({ shellGenerationSource: (closeMenu: () => void) => ({ closeMenu }), failureOf: () => null, retrySendFailure: vi.fn() }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn() }))
vi.mock('../../ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => ({}) }))
vi.mock('../../ts/globalApi.svelte', () => ({ aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined) }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../../ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('../../ts/process/chatTree', () => ({ isChatAltReadable: () => true }))
vi.mock('../../ts/util', () => ({ parseToggleSyntax: () => [], findCharacterbyId: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), showHypaV2Alert: vi.fn() }))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/characters', () => ({
    exportChat: vi.fn(),
    removeChatConfirmed: async (owner: { chats: unknown[], chatPage: number }, chat: unknown, confirm?: (request: { chat: unknown, busy: boolean }) => Promise<boolean>) => {
        h.removeCalls++
        if (owner.chats.length === 1) return false
        const confirmed = confirm ? await confirm({ chat, busy: h.busy }) : true
        h.atRemoval?.()
        const at = owner.chats.indexOf(chat)
        if (!confirmed || at === -1 || owner.chats.length <= 1) {
            h.removeResults.push(false)
            return false
        }
        owner.chatPage = 0
        owner.chats.splice(at, 1)
        h.removeResults.push(true)
        return true
    },
}))
const languageMock = vi.hoisted(() => {
    const fns: Record<string, unknown> = {
        chatShellChatOpened: (chat: string) => ('Opened ' + chat),
        chatShellChatStats: (n: number, time: string) => `stats:${n}:${time}`,
        chatShellDeleteChatConfirm: (name: string, n: number) => `confirm:${name}:${n}`,
        asPersona: (name: string) => `as ${name}`,
    }
    return { language: new Proxy({ errors: { onlyOneChat: 'ONLY-ONE' } } as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : key in fns ? fns[key as string] : String(key) }) }
})
vi.mock('../../lang', () => languageMock)
vi.mock('src/lang', () => languageMock)

import ChatShell from './ChatShell.svelte'
import { DBState, selIdState } from '../../ts/stores.svelte'

type ChatFixture = { id: string, name: string }
type OwnerFixture = { chats: ChatFixture[], chatPage: number }
const owner = () => DBState.db.characters[0] as unknown as OwnerFixture

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement
let focusCalls: { element: Element, options: FocusOptions | undefined }[] = []
const realFocus = HTMLElement.prototype.focus

async function settle(): Promise<void> {
    flushSync()
    await tick()
    flushSync()
}

async function show(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        expect(target.querySelector('[data-part="chat-header-menu"]')).not.toBeNull()
        expect(target.querySelector('[data-part="chat-composer-host"]')).not.toBeNull()
    }, { timeout: 15000 })
}

const menuButton = () => target.querySelector<HTMLButtonElement>('[data-part="chat-header-menu"]')!
const sheetLayer = () => target.querySelector<HTMLElement>('[data-part="chat-sheet-layer"]')
const confirmLayer = () => target.querySelector<HTMLElement>('[data-part="pattern-layer"]')
const part = (name: string) => target.querySelector<HTMLElement>(`[data-part="this-chat-${name}"]`)
const inertCount = () => target.querySelectorAll('[inert]').length

async function openSheet(): Promise<void> {
    menuButton().click()
    await vi.waitFor(() => {
        flushSync()
        expect(sheetLayer()).not.toBeNull()
    }, { timeout: 15000 })
}

async function openConfirm(): Promise<void> {
    part('delete')!.click()
    await vi.waitFor(() => {
        flushSync()
        expect(confirmLayer()).not.toBeNull()
    })
}

beforeEach(() => {
    h.removeCalls = 0
    h.removeResults = []
    h.atRemoval = null
    h.busy = false
    focusCalls = []
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
        focusCalls.push({ element: this, options })
        return realFocus.call(this, options)
    }
    DBState.db.characters[0].chats = [
        { id: 'c1', name: 'Harbour night', note: '', localLore: [], message: [{ role: 'user', data: 'a', chatId: 'c1-1', time: 1_000 }, { role: 'char', data: 'b', chatId: 'c1-2', time: 2_000 }] },
        { id: 'c2', name: 'Second', note: '', localLore: [], message: [] },
    ] as never
    DBState.db.characters[0].chatPage = 0
    selIdState.selId = 0
})

afterEach(async () => {
    HTMLElement.prototype.focus = realFocus
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

describe('S1/S12 opening', () => {
    test('the header button opens the This-chat sheet, and the initial focus is the title, not an input', async () => {
        await show()
        await openSheet()
        const title = part('title')!
        expect(document.activeElement).toBe(title)
        expect(document.activeElement?.matches('input, textarea')).toBe(false)
        expect(target.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('chatShellThisChat')
    })

    test('the sheet is modal: the header, the transcript and the composer are inert', async () => {
        await show()
        await openSheet()
        for (const selector of ['[data-part="chat-header-host"]', '[data-part="chat-transcript"]', '[data-part="chat-composer-host"]']) {
            expect(target.querySelector(selector)?.hasAttribute('inert')).toBe(true)
        }
    })

    test('closing returns focus to the header button and leaves nothing inert', async () => {
        await show()
        await openSheet()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await settle()
        expect(sheetLayer()).toBeNull()
        expect(inertCount()).toBe(0)
        expect(document.activeElement).toBe(menuButton())
    })
})

describe('S4 delete confirm', () => {
    test('Delete opens a danger confirm that names the chat and its message count, after the sheet layer and outside it', async () => {
        await show()
        await openSheet()
        await openConfirm()
        const layer = confirmLayer()!
        expect(layer.textContent).toContain('confirm:Harbour night:2')
        expect(layer.querySelector('[data-pattern-severity="danger"]')).not.toBeNull()
        expect(layer.closest('[data-part="chat-sheet-layer"]')).toBeNull()
        expect(sheetLayer()!.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(h.removeCalls).toBe(1)
    })

    test('the confirm is topmost: the sheet layer, the header, the transcript and the composer are inert, the confirm is not', async () => {
        await show()
        await openSheet()
        await openConfirm()
        expect(sheetLayer()!.hasAttribute('inert')).toBe(true)
        expect(target.querySelector('[data-part="chat-header-host"]')!.hasAttribute('inert')).toBe(true)
        expect(target.querySelector('[data-part="chat-transcript"]')!.hasAttribute('inert')).toBe(true)
        expect(confirmLayer()!.closest('[inert]')).toBeNull()
    })

    test('Cancel has focus first, and an early tap on Delete is ignored for the arm delay', async () => {
        await show()
        await openSheet()
        await openConfirm()
        const layer = confirmLayer()!
        expect(document.activeElement).toBe(layer.querySelector('[data-part="pattern-warn-cancel"]'))
        layer.querySelector<HTMLElement>('[data-part="pattern-warn-primary"]')!.click()
        await settle()
        expect(confirmLayer()).not.toBeNull()
        expect(owner().chats).toHaveLength(2)
        await new Promise((resolve) => setTimeout(resolve, 320))
        layer.querySelector<HTMLElement>('[data-part="pattern-warn-primary"]')!.click()
        await vi.waitFor(() => expect(owner().chats).toHaveLength(1))
    })

    test('a tap made before the confirm armed stays ignored when its handler runs after the arm delay', async () => {
        await show()
        await openSheet()
        await openConfirm()
        const tappedAt = performance.now()
        const primary = confirmLayer()!.querySelector<HTMLElement>('[data-part="pattern-warn-primary"]')!
        await new Promise((resolve) => setTimeout(resolve, 320))
        const early = new MouseEvent('click', { bubbles: true, cancelable: true })
        Object.defineProperty(early, 'timeStamp', { value: tappedAt + 10 })
        primary.dispatchEvent(early)
        await settle()
        expect(confirmLayer()).not.toBeNull()
        expect(owner().chats).toHaveLength(2)
        primary.click()
        await vi.waitFor(() => expect(owner().chats).toHaveLength(1))
    })

    test('Escape closes the confirm, keeps the sheet open and returns focus to Delete', async () => {
        await show()
        await openSheet()
        await openConfirm()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await vi.waitFor(() => {
            flushSync()
            expect(confirmLayer()).toBeNull()
        })
        expect(sheetLayer()).not.toBeNull()
        expect(sheetLayer()!.hasAttribute('inert')).toBe(false)
        expect(document.activeElement).toBe(part('delete'))
        await vi.waitFor(() => expect(h.removeResults).toEqual([false]))
        expect(owner().chats).toHaveLength(2)
    })

    test('Back closes the confirm first, then the next Back closes the sheet', async () => {
        await show()
        await openSheet()
        await openConfirm()
        expect(dispatchBack()).toBe(true)
        await vi.waitFor(() => {
            flushSync()
            expect(confirmLayer()).toBeNull()
        })
        expect(sheetLayer()).not.toBeNull()
        await vi.waitFor(() => expect(h.removeResults).toEqual([false]))
        expect(owner().chats).toHaveLength(2)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(sheetLayer()).toBeNull()
        expect(inertCount()).toBe(0)
    })

    test('confirming deletes the confirmed chat by reference, closes both layers and leaves nothing inert', async () => {
        await show()
        await openSheet()
        await openConfirm()
        await new Promise((resolve) => setTimeout(resolve, 320))
        confirmLayer()!.querySelector<HTMLElement>('[data-part="pattern-warn-primary"]')!.click()
        await vi.waitFor(() => {
            flushSync()
            expect(sheetLayer()).toBeNull()
            expect(confirmLayer()).toBeNull()
        })
        expect(owner().chats.map((c) => c.id)).toEqual(['c2'])
        expect(inertCount()).toBe(0)
    })

    // The confirm's layer is gone (its inert released) before the removal that waits for the answer runs, and the sheet is still open.
    test('the removal runs after the confirm layer is gone, while the sheet is still open and usable', async () => {
        await show()
        await openSheet()
        await openConfirm()
        await new Promise((resolve) => setTimeout(resolve, 320))
        const seen: { confirmLayer: boolean, sheetInert: boolean, sheetOpen: boolean }[] = []
        h.atRemoval = () => {
            seen.push({ confirmLayer: confirmLayer() !== null, sheetInert: sheetLayer()?.hasAttribute('inert') ?? false, sheetOpen: sheetLayer() !== null })
        }
        confirmLayer()!.querySelector<HTMLElement>('[data-part="pattern-warn-primary"]')!.click()
        await vi.waitFor(() => expect(owner().chats).toHaveLength(1))
        expect(seen).toEqual([{ confirmLayer: false, sheetInert: false, sheetOpen: true }])
    })

    // F-T7 ext.: the transcript is the real element and takes focus without scrolling.
    test('after a delete the transcript is focused with preventScroll', async () => {
        await show()
        await openSheet()
        await openConfirm()
        await new Promise((resolve) => setTimeout(resolve, 320))
        focusCalls = []
        confirmLayer()!.querySelector<HTMLElement>('[data-part="pattern-warn-primary"]')!.click()
        await vi.waitFor(() => {
            flushSync()
            expect(sheetLayer()).toBeNull()
            expect(document.activeElement).toBe(target.querySelector('[data-part="chat-transcript"]'))
        })
        const transcript = target.querySelector('[data-part="chat-transcript"]')!
        expect(transcript.getAttribute('tabindex')).toBe('-1')
        const onTranscript = focusCalls.filter((call) => call.element === transcript)
        expect(onTranscript.length).toBeGreaterThan(0)
        expect(onTranscript.at(-1)!.options).toEqual({ preventScroll: true })
    })

    test('the working flag reaches the confirm as a consequence line', async () => {
        h.busy = true
        await show()
        await openSheet()
        await openConfirm()
        expect(confirmLayer()!.textContent).toContain('removeChatWhileWorking')
    })

    test('a chat switch while the confirm is open answers it as cancelled and removes nothing', async () => {
        await show()
        await openSheet()
        await openConfirm()
        owner().chatPage = 1
        await vi.waitFor(() => {
            flushSync()
            expect(confirmLayer()).toBeNull()
            expect(sheetLayer()).toBeNull()
        })
        await vi.waitFor(() => expect(h.removeResults).toEqual([false]))
        expect(owner().chats).toHaveLength(2)
        expect(inertCount()).toBe(0)
    })

    test('confirming on a non-first chat deletes that chat, not the first one', async () => {
        owner().chatPage = 1
        await show()
        await openSheet()
        await openConfirm()
        await new Promise((resolve) => setTimeout(resolve, 320))
        confirmLayer()!.querySelector<HTMLElement>('[data-part="pattern-warn-primary"]')!.click()
        await vi.waitFor(() => expect(h.removeResults).toEqual([true]))
        expect(owner().chats.map((c) => c.id)).toEqual(['c1'])
    })

    test('on a sole chat Delete is disabled and opens no confirm', async () => {
        owner().chats.splice(1, 1)
        await show()
        await openSheet()
        part('delete')!.click()
        await settle()
        expect(confirmLayer()).toBeNull()
        expect(h.removeCalls).toBe(0)
        expect(part('delete')!.getAttribute('aria-disabled')).toBe('true')
    })
})
