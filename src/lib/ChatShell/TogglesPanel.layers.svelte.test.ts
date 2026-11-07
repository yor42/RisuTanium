// @vitest-environment jsdom
/**
 * Layer order around the toggles panel (S13, MC-1086 Q2), with the REAL ChatShell, ShellHeader, ThisChatSheet,
 * TogglesPanel, ToggleRow and ShellSheet: the panel opened from the This-chat sheet stacks above it and makes it
 * inert; the editor sheets of the panel sit beside it, never inside it; Back and Escape close the innermost layer
 * first; no element stays inert whichever layer closes first; the panel closes when the shown chat changes.
 * Guards by construction: the components are new.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const chat = (id: string, name: string) => ({ id, name, note: '', localLore: [], message: [{ role: 'user', data: 'a', chatId: `${id}-1`, time: 1_000 }] })
    const DBState = $state({ db: {
        characters: [{
            chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, removedQuotes: true, creatorNotes: '',
            customModuleToggle: 'on1=Switch\nsay=Say=text\nnotes=Notes=textarea\nmode=Mode=select=One,Two,Three,Four',
            chats: [chat('c1', 'Harbour night'), chat('c2', 'Second')],
        }],
        personas: [{ id: 'p1', name: 'Captain' }], selectedPersona: 0, username: 'User', sendWithEnter: true, jailbreak: '', jailbreakToggle: false,
        supaModelType: 'none', hypav2: false, hypaV3: false, customPromptTemplateToggle: '', globalChatVariables: { toggle_on1: '1' },
        botPresets: [{ name: 'Preset One' }], botPresetsId: 0,
    } })
    const selIdState = $state({ selId: 0 })
    const additionalChatMenu = $state([])
    return {
        DBState, selIdState, additionalChatMenu, selectedCharID: writable(0), settingsOpen: writable(false), hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0), MobileGUI: writable(false), DynamicGUI: writable(false), sideBarClosing: writable(false), sideBarStore: writable(false), MobileSideBar: writable(0),
    }
})
vi.mock('../../ts/process/index.svelte', async () => { const { writable } = await import('svelte/store'); return { doingChat: writable(false), chatProcessStage: writable(0) } })
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, closeEpoch: 0 })
    return { chatSurface }
})
vi.mock('./ShellMessageList.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellComposer.svelte', () => ({ default: () => ({}) }))
// The + menu is stood in for by its props: ChatShell hands it the Toggles handler and the summary, and the test calls them.
const plus = vi.hoisted(() => ({ props: undefined as undefined | { ontoggles?: (row?: { s: string, k: string }) => void, togglesSummary?: () => string | null } }))
vi.mock('./PlusSheet.svelte', () => ({ default: (_anchor: unknown, props: { ontoggles?: (row?: { s: string, k: string }) => void, togglesSummary?: () => string | null }) => { plus.props = props; return {} } }))
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
vi.mock('../../ts/process/modules', () => ({ getModuleToggles: () => '', getModules: () => [] }))
vi.mock('../../ts/process/chatTree', () => ({ isChatAltReadable: () => true }))
vi.mock('../../ts/util', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../ts/util')>()), findCharacterbyId: vi.fn() }))
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
        chatShellTogglesSummary: (n: number, on: number) => `sum:${n}:${on}`,
        chatShellTogglesMenu: (label: string) => `menu:${label}`,
        chatShellTogglesEditTitle: (label: string) => `edittitle:${label}`,
        chatShellTogglesTextSaved: (label: string) => `textsaved:${label}`,
        chatShellTogglesPickTitle: (label: string) => `picktitle:${label}`,
        chatShellTogglesPicked: (label: string, value: string) => `picked:${label}:${value}`,
        asPersona: (name: string) => `as ${name}`,
    }
    return { language: new Proxy({ errors: { onlyOneChat: 'ONLY-ONE' } } as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : key in fns ? fns[key as string] : String(key) }) }
})
vi.mock('../../lang', () => languageMock)
vi.mock('src/lang', () => languageMock)

import ChatShell from './ChatShell.svelte'
import { DBState, selIdState } from '../../ts/stores.svelte'
import { resetTogglePanelSession } from '../../ts/chatShell/togglePanel'
import { FAVOURITES_KEY } from '../../ts/chatShell/toggleFavourites'
import { syncFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'

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
const summaryRow = () => target.querySelector<HTMLButtonElement>('[data-part="this-chat-toggles"]')
const inertCount = () => target.querySelectorAll('[inert]').length
const hostParts = ['[data-part="chat-header-host"]', '[data-part="chat-transcript"]', '[data-part="chat-composer-host"]']
const rowControl = (key: string, part: string) => target.querySelector<HTMLElement>(`[data-part="toggle-row"][data-key="${key}"] [data-part="${part}"]`)!

async function openSheet(): Promise<void> {
    menuButton().click()
    await vi.waitFor(() => {
        flushSync()
        expect(layers()).toHaveLength(1)
    }, { timeout: 15000 })
}

async function openPanel(): Promise<void> {
    await vi.waitFor(() => {
        flushSync()
        expect(summaryRow()).not.toBeNull()
    }, { timeout: 15000 })
    summaryRow()!.click()
    await vi.waitFor(() => {
        flushSync()
        expect(layers()).toHaveLength(2)
    })
}

function escape(): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

// The shell loads its parts lazily; the first transform of all of them is slow, so it happens before any test clock starts.
beforeAll(async () => {
    await Promise.all([import('./ShellHeader.svelte'), import('./PersonaSheet.svelte'), import('./ChatDeleteConfirm.svelte'), import('./ThisChatSheet.svelte'), import('./TogglesPanel.svelte')])
}, 120000)

beforeEach(() => {
    resetTogglePanelSession()
    DBState.db.characters[0].chats = [
        { id: 'c1', name: 'Harbour night', note: '', localLore: [], message: [{ role: 'user', data: 'a', chatId: 'c1-1', time: 1_000 }] },
        { id: 'c2', name: 'Second', note: '', localLore: [], message: [] },
    ] as never
    DBState.db.characters[0].chatPage = 0
    DBState.db.globalChatVariables = { toggle_on1: '1' }
    selIdState.selId = 0
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    document.body.replaceChildren()
    resetBackHandlersForTests()
    localStorage.removeItem(FAVOURITES_KEY)
    syncFavourites()
})

describe('the panel opened from the This-chat sheet (S13)', () => {
    test('the sheet shows the summary row; the panel layer follows the sheet layer and the sheet is inert under it', async () => {
        await show()
        await openSheet()
        await vi.waitFor(() => {
            flushSync()
            expect(summaryRow()).not.toBeNull()
        }, { timeout: 15000 })
        expect(summaryRow()!.textContent).toContain('sum:4:1')
        await openPanel()
        const [sheet, panel] = layers()
        expect(sheet.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(sheet.hasAttribute('inert')).toBe(true)
        expect(panel.closest('[inert]')).toBeNull()
        for (const selector of hostParts) expect(target.querySelector(selector)!.hasAttribute('inert')).toBe(true)
        expect(document.activeElement).toBe(target.querySelector('[data-part="toggles-title"]'))
    })

    test('closing the panel returns focus to the summary row and makes the sheet usable again', async () => {
        await show()
        await openSheet()
        await openPanel()
        escape()
        await settle()
        expect(layers()).toHaveLength(1)
        expect(layers()[0].hasAttribute('inert')).toBe(false)
        for (const selector of hostParts) expect(target.querySelector(selector)!.hasAttribute('inert')).toBe(true)
        expect(document.activeElement).toBe(summaryRow())
    })

    test('the sheet and the panel close when the shown chat changes, and nothing stays inert', async () => {
        await show()
        await openSheet()
        await openPanel()
        owner().chatPage = 1
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(0)
        })
        expect(inertCount()).toBe(0)
        for (const selector of hostParts) expect(target.querySelector(selector)!.hasAttribute('inert')).toBe(false)
    })
})

describe('Back and Escape close the innermost layer first (S8)', () => {
    test('Back closes the inline editor, then the panel, then the sheet', async () => {
        await show()
        await openSheet()
        await openPanel()
        rowControl('say', 'toggle-text-button').click()
        await settle()
        expect(target.querySelector('[data-part="toggle-text-input"]')).not.toBeNull()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(target.querySelector('[data-part="toggle-text-input"]')).toBeNull()
        expect(layers()).toHaveLength(2)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(layers()).toHaveLength(1)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(layers()).toHaveLength(0)
        expect(inertCount()).toBe(0)
    })

    test('Escape reverts the inline editor first, then closes the panel, then the sheet', async () => {
        await show()
        await openSheet()
        await openPanel()
        rowControl('say', 'toggle-text-button').click()
        await settle()
        const input = target.querySelector<HTMLInputElement>('[data-part="toggle-text-input"]')!
        input.value = 'typed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        escape()
        await settle()
        expect(target.querySelector('[data-part="toggle-text-input"]')).toBeNull()
        expect(DBState.db.globalChatVariables.toggle_say).toBeUndefined()
        expect(layers()).toHaveLength(2)
        escape()
        await settle()
        expect(layers()).toHaveLength(1)
        escape()
        await settle()
        expect(layers()).toHaveLength(0)
        expect(inertCount()).toBe(0)
    })

    test('the editor sheet of a textarea sits beside the panel, above it, and Back closes it before the panel', async () => {
        await show()
        await openSheet()
        await openPanel()
        rowControl('notes', 'toggle-text-button').click()
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(3)
        })
        const [, panel, editor] = layers()
        // The inner layer is a sibling of the panel's layer, never inside the panel's sheet element: that element keeps a transform.
        expect(panel.querySelector('[data-part="toggles-editor-field"]')).toBeNull()
        expect(editor.querySelector('[data-part="toggles-editor-field"]')).not.toBeNull()
        expect(panel.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(panel.hasAttribute('inert')).toBe(true)
        expect(editor.closest('[inert]')).toBeNull()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(layers()).toHaveLength(2)
        expect(panel.hasAttribute('inert')).toBe(false)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(layers()).toHaveLength(1)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(layers()).toHaveLength(0)
        expect(inertCount()).toBe(0)
    })

    test('the list sheet of a long select sits beside the panel; choosing closes it and keeps the panel', async () => {
        await show()
        await openSheet()
        await openPanel()
        rowControl('mode', 'toggle-select-list').click()
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(3)
        })
        const picker = target.querySelector<HTMLElement>('[data-part="toggles-picker"]')!
        expect(layers()[1].contains(picker)).toBe(false)
        Array.from(target.querySelectorAll<HTMLElement>('[data-part="toggles-picker-option"]'))[3].click()
        await settle()
        expect(layers()).toHaveLength(2)
        expect(DBState.db.globalChatVariables.toggle_mode).toBe('3')
    })

    test('an editor sheet open when the chat changes closes with the rest and nothing stays inert', async () => {
        await show()
        await openSheet()
        await openPanel()
        rowControl('notes', 'toggle-text-button').click()
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(3)
        })
        owner().chatPage = 1
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(0)
        })
        expect(inertCount()).toBe(0)
        for (const selector of hostParts) expect(target.querySelector(selector)!.hasAttribute('inert')).toBe(false)
    })
})

describe('the panel opened from the + menu (nothing under it)', () => {
    async function openFromPlus(): Promise<void> {
        await vi.waitFor(() => {
            flushSync()
            expect(plus.props?.ontoggles).toBeTypeOf('function')
        }, { timeout: 15000 })
        plus.props!.ontoggles!()
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(1)
        })
    }

    test('the menu item reads the same summary as the sheet row', async () => {
        await show()
        await vi.waitFor(() => {
            flushSync()
            expect(plus.props?.togglesSummary).toBeTypeOf('function')
        }, { timeout: 15000 })
        expect(plus.props!.togglesSummary!()).toBe('sum:4:1')
    })

    test('the panel alone is modal over the host parts and Back closes it', async () => {
        await show()
        await openFromPlus()
        for (const selector of hostParts) expect(target.querySelector(selector)!.hasAttribute('inert')).toBe(true)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(layers()).toHaveLength(0)
        expect(inertCount()).toBe(0)
    })

    test('the panel closes when the shown chat changes', async () => {
        await show()
        await openFromPlus()
        owner().chatPage = 1
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(0)
        })
        expect(inertCount()).toBe(0)
    })

    test('the panel closes with the close epoch of the screen', async () => {
        await show()
        await openFromPlus()
        chatSurface.closeEpoch++
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(0)
        })
        expect(inertCount()).toBe(0)
    })
})

describe('the panel opened at a row (R1)', () => {
    const favouriteText = () => target.querySelector<HTMLElement>('[data-part="toggles-favourites"] [data-part="toggle-row"][data-key="say"] [data-part="toggle-text-button"]')

    async function waitForHandler(): Promise<void> {
        await vi.waitFor(() => {
            flushSync()
            expect(plus.props?.ontoggles).toBeTypeOf('function')
        }, { timeout: 15000 })
    }

    async function openWith(row?: { s: string, k: string }): Promise<void> {
        await waitForHandler()
        const before = layers().length
        if (row) plus.props!.ontoggles!(row)
        else plus.props!.ontoggles!()
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(before + 1)
        })
    }

    test('L1: the star handed by the + menu reaches the panel and focuses that row text button', async () => {
        localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ v: 1, items: [{ s: 'character:char-a', k: 'say' }] }))
        syncFavourites()
        await show()
        await openWith({ s: 'character:char-a', k: 'say' })
        expect(favouriteText()).not.toBeNull()
        expect(document.activeElement).toBe(favouriteText())
        expect(target.querySelectorAll('[data-opened-at]')).toHaveLength(1)
    })

    test('L2: Back from the panel, then an opening with no star or from the summary row, focuses the title', async () => {
        localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ v: 1, items: [{ s: 'character:char-a', k: 'say' }] }))
        syncFavourites()
        await show()
        await openWith({ s: 'character:char-a', k: 'say' })
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(layers()).toHaveLength(0)
        await openWith()
        expect(document.activeElement).toBe(target.querySelector('[data-part="toggles-title"]'))
        expect(target.querySelectorAll('[data-opened-at]')).toHaveLength(0)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(layers()).toHaveLength(0)
        await openSheet()
        await openPanel()
        expect(document.activeElement).toBe(target.querySelector('[data-part="toggles-title"]'))
        expect(target.querySelectorAll('[data-opened-at]')).toHaveLength(0)
    })
})
