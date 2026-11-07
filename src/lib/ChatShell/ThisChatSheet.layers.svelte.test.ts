// @vitest-environment jsdom
/**
 * Layer order around the This-chat sheet (S13, MC-1086 Q2), with the REAL ChatShell, ShellHeader, ThisChatSheet,
 * PersonaSheet and ShellSheet: the persona picker opened from the sheet stacks above it and makes the sheet inert; Back
 * and Escape close the inner layer first; no element stays inert whichever layer closes first; the sheet and the picker
 * close when the shown chat changes. Guards by construction: the components are new.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const chat = (id: string, name: string) => ({ id, name, note: '', localLore: [], message: [{ role: 'user', data: 'a', chatId: `${id}-1`, time: 1_000 }] })
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
vi.mock('../Mobile/mobileBack', () => ({ closeShellChat: vi.fn() }))
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
vi.mock('../../ts/characters', () => ({ exportChat: vi.fn(), removeChatConfirmed: vi.fn(async () => false) }))
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

type OwnerFixture = { chats: { id: string }[], chatPage: number }
const owner = () => DBState.db.characters[0] as unknown as OwnerFixture

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement

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
    }, { timeout: 15000 })
}

const menuButton = () => target.querySelector<HTMLButtonElement>('[data-part="chat-header-menu"]')!
const layers = () => Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-sheet-layer"]'))
const part = (name: string) => target.querySelector<HTMLElement>(`[data-part="this-chat-${name}"]`)
const inertCount = () => target.querySelectorAll('[inert]').length
const hostParts = ['[data-part="chat-header-host"]', '[data-part="chat-transcript"]', '[data-part="chat-composer-host"]']

async function openSheet(): Promise<void> {
    menuButton().click()
    await vi.waitFor(() => {
        flushSync()
        expect(layers()).toHaveLength(1)
    }, { timeout: 15000 })
}

async function openPersona(): Promise<void> {
    part('persona')!.click()
    await vi.waitFor(() => {
        flushSync()
        expect(layers()).toHaveLength(2)
    })
}

function escape(): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

beforeEach(() => {
    DBState.db.characters[0].chats = [
        { id: 'c1', name: 'Harbour night', note: '', localLore: [], message: [{ role: 'user', data: 'a', chatId: 'c1-1', time: 1_000 }] },
        { id: 'c2', name: 'Second', note: '', localLore: [], message: [] },
    ] as never
    DBState.db.characters[0].chatPage = 0
    selIdState.selId = 0
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

describe('S13 persona over the sheet', () => {
    test('the persona layer follows the sheet layer, and the sheet is inert while the picker is open', async () => {
        await show()
        await openSheet()
        await openPersona()
        const [sheet, persona] = layers()
        expect(sheet.compareDocumentPosition(persona) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(sheet.hasAttribute('inert')).toBe(true)
        expect(persona.closest('[inert]')).toBeNull()
        for (const selector of hostParts) expect(target.querySelector(selector)!.hasAttribute('inert')).toBe(true)
    })

    test('closing the picker makes the sheet usable again and keeps the host parts inert under it', async () => {
        await show()
        await openSheet()
        await openPersona()
        escape()
        await settle()
        expect(layers()).toHaveLength(1)
        expect(layers()[0].hasAttribute('inert')).toBe(false)
        for (const selector of hostParts) expect(target.querySelector(selector)!.hasAttribute('inert')).toBe(true)
        expect(document.activeElement).toBe(part('persona'))
    })

    test('choosing a persona binds it to the chat and closes the picker, not the sheet', async () => {
        await show()
        await openSheet()
        await openPersona()
        const choice = Array.from(layers()[1].querySelectorAll<HTMLButtonElement>('[data-part="chat-sheet-item"]')).find((item) => item.textContent?.includes('Captain'))!
        choice.click()
        await settle()
        expect(layers()).toHaveLength(1)
        expect((DBState.db.characters[0].chats[0] as { bindedPersona?: string }).bindedPersona).toBe('p1')
    })

    test('the header button is the This-chat opener and opens no picker', async () => {
        await show()
        expect(layers()).toHaveLength(0)
        await openSheet()
        expect(menuButton().getAttribute('aria-label')).toBe('chatShellThisChat')
        expect(menuButton().getAttribute('aria-haspopup')).toBe('dialog')
        expect(layers()).toHaveLength(1)
    })
})

describe('Back and Escape order', () => {
    test('Back closes the picker first, then the sheet', async () => {
        await show()
        await openSheet()
        await openPersona()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(layers()).toHaveLength(1)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(layers()).toHaveLength(0)
        expect(inertCount()).toBe(0)
    })

    test('Escape closes the picker first, then the sheet', async () => {
        await show()
        await openSheet()
        await openPersona()
        escape()
        await settle()
        expect(layers()).toHaveLength(1)
        escape()
        await settle()
        expect(layers()).toHaveLength(0)
        expect(inertCount()).toBe(0)
        expect(document.activeElement).toBe(menuButton())
    })
})

describe('chat switch (S2, X-I8)', () => {
    test('the sheet and the picker close when the shown chat changes, and nothing stays inert', async () => {
        await show()
        await openSheet()
        await openPersona()
        owner().chatPage = 1
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(0)
        })
        expect(inertCount()).toBe(0)
    })

    test('the sheet closes when another character is selected', async () => {
        await show()
        await openSheet()
        DBState.db.characters.push({ chaId: 'char-b', name: 'Bo', type: 'character', chatPage: 0, chats: [{ id: 'b1', name: 'B chat', note: '', localLore: [], message: [] }] } as never)
        selIdState.selId = 1
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(0)
        })
        expect(inertCount()).toBe(0)
    })

    test('a note typed before the switch lands on the chat that was open, with the owner marked', async () => {
        await show()
        await openSheet()
        const note = part('note') as HTMLTextAreaElement
        note.focus()
        note.value = 'typed before the switch'
        note.dispatchEvent(new Event('input', { bubbles: true }))
        owner().chatPage = 1
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(0)
        })
        expect((DBState.db.characters[0].chats[0] as { note: string }).note).toBe('typed before the switch')
        expect((DBState.db.characters[0].chats[1] as { note: string }).note).toBe('')
    })
})

describe('close order leaves nothing inert (T2 in situ)', () => {
    test('the sheet closing under an open picker, then the picker, restores every element', async () => {
        await show()
        await openSheet()
        await openPersona()
        owner().chatPage = 1
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(0)
        })
        expect(inertCount()).toBe(0)
        for (const selector of hostParts) expect(target.querySelector(selector)!.hasAttribute('inert')).toBe(false)
    })
})
