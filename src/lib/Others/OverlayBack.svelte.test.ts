// @vitest-environment happy-dom

/**
 * Android Back on six App-level overlays (bookmark list, easy panel, popup editor, loadout modal,
 * Iris, custom sidebar config) does what each surface's own close control does. (R) = regression
 * reproducer: fails on a base without the Back handler (the surface stays open and the quit
 * warning shows); (G) = guard that may pass before and after. The reproducers import only modules
 * that exist on the pre-fix base.
 *
 * MOCKED: `stores.svelte` (the real shapes of the overlay stores), every heavy child component,
 * the request, storage and parser modules the overlays import, and `alertBack`. The quit warning
 * is a spy. Nothing is sent or saved.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const spies = vi.hoisted(() => ({ applyLoadout: vi.fn(), saveCurrentLoadout: vi.fn() }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const easyPanel = $state({ open: false })
    const popUpEditor = $state({ open: false, value: '', mode: 'default', language: '' })
    const loadout = $state({ open: false })
    const iris = $state({ open: false })
    const customSideBar = $state({ open: false })
    return {
        DBState: state,
        bookmarkListOpen: writable(false),
        selectedCharID: writable(0),
        createSimpleCharacter: () => ({}),
        ScrollToMessageStore: { value: -1 },
        easyPanelStore: easyPanel,
        popUpEditorStore: popUpEditor,
        loadoutModalStore: loadout,
        irisStore: iris,
        customSideBarConfigDialogStore: customSideBar,
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertInput: vi.fn(async () => ''), alertError: vi.fn() }))
vi.mock('src/ts/keyEventBlocked', () => ({ keyEventBlocked: vi.fn(() => false) }))
vi.mock('src/ts/characters', () => ({ getCharImage: vi.fn(() => '') }))
vi.mock('src/ts/util', () => ({
    findCharacterbyId: vi.fn(),
    getUserName: vi.fn(() => 'user'),
    getUserIcon: vi.fn(() => ''),
}))
vi.mock('src/lib/ChatScreens/Chat.svelte', () => ({ default: () => {} }))

vi.mock('src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/GUI/SegmentedControl.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/GUI/SliderInput.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/ModelList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Others/Help.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/GUI/CheckInput.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Others/AllSeperateParameters.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte', () => ({ default: () => {} }))

vi.mock('src/ts/parser/parser.svelte', () => ({ ParseMarkdown: vi.fn(), risuChatParser: vi.fn(() => '') }))
vi.mock('src/ts/tokenizer', () => ({ tokenize: vi.fn(async () => 0) }))
vi.mock('src/lib/SideBars/Toggles.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Others/MonacoEditor.svelte', () => ({ default: () => {} }))
vi.mock('src/ts/storage/database.svelte', () => ({ getCurrentCharacter: vi.fn(() => undefined) }))

vi.mock('src/ts/loadout', () => ({
    applyLoadout: spies.applyLoadout,
    saveCurrentLoadout: spies.saveCurrentLoadout,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))
vi.mock('src/ts/model/modellist', () => ({
    LLMFormat: { Anthropic: 1, OpenAICompatible: 2, VertexAIGemini: 3, GoogleCloud: 4 },
    getModelInfo: () => ({ format: 2 }),
}))
vi.mock('src/ts/process/request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('src/ts/process/mcp/risuaccess', () => ({
    RisuAccessClient: class { async getToolList() { return [] } },
}))
vi.mock('src/ts/iris', () => ({ getIrisSystemPrompt: vi.fn(async () => 'system') }))
vi.mock('src/ts/setting/utils', () => ({
    getFullSettingsData: () => [],
    getLabel: (item: { id: string }) => item.id,
}))

//#endregion

import { language } from 'src/lang'
import {
    DBState,
    bookmarkListOpen,
    customSideBarConfigDialogStore,
    easyPanelStore,
    irisStore,
    loadoutModalStore,
    popUpEditorStore,
} from 'src/ts/stores.svelte'
import { installBackGuard, registerBackHandler, resetBackHandlersForTests } from 'src/ts/backHandlers'
import BookmarkList from './BookmarkList.svelte'
import EasyPanel from './ProTools/EasyPanel.svelte'
import PopupEditor from './PopupEditor.svelte'
import LoadoutModal from './LoadoutModal.svelte'
import IrisModal from './IrisModal.svelte'
import CustomSidebarConfig from './CustomSidebarConfig.svelte'

// happy-dom has no Web Animations API; Svelte transitions call `element.animate`. The stub reports
// each animation finished at once.
Element.prototype.animate = (() => {
    const animation = {
        onfinish: null as (() => void) | null,
        cancel() {},
        finish() { animation.onfinish?.() },
        pause() {},
        play() {},
        currentTime: 0,
    }
    queueMicrotask(() => animation.onfinish?.())
    return animation
}) as unknown as typeof Element.prototype.animate

type Component = Parameters<typeof mount>[0]

interface Surface {
    name: string
    component: Component
    open: () => void
    isOpen: () => boolean
    /** Clicks the surface's own close control. */
    clickX: (target: HTMLElement) => void
}

function buttonWhere(target: HTMLElement, predicate: (button: HTMLButtonElement) => boolean): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find(predicate)
    if (!found) {
        throw new Error('no matching button')
    }
    return found
}

const surfaces: Surface[] = [
    {
        name: 'bookmark list',
        component: BookmarkList as Component,
        open: () => bookmarkListOpen.set(true),
        isOpen: () => get(bookmarkListOpen),
        clickX: (target) => (target.querySelectorAll('.ml-auto button')[1] as HTMLButtonElement).click(),
    },
    {
        name: 'easy panel',
        component: EasyPanel as Component,
        open: () => { easyPanelStore.open = true },
        isOpen: () => easyPanelStore.open,
        clickX: (target) => (target.querySelector('h2 button') as HTMLButtonElement).click(),
    },
    {
        name: 'popup editor',
        component: PopupEditor as Component,
        open: () => { popUpEditorStore.open = true },
        isOpen: () => popUpEditorStore.open,
        clickX: (target) => buttonWhere(target, (b) => b.textContent?.trim() === 'X').click(),
    },
    {
        name: 'loadout modal',
        component: LoadoutModal as Component,
        open: () => { loadoutModalStore.open = true },
        isOpen: () => loadoutModalStore.open,
        clickX: (target) => buttonWhere(target, (b) => b.getAttribute('aria-label') === language.uiCommon.close).click(),
    },
    {
        name: 'Iris',
        component: IrisModal as Component,
        open: () => { irisStore.open = true },
        isOpen: () => irisStore.open,
        clickX: (target) => buttonWhere(target, (b) => b.getAttribute('aria-label') === language.uiCommon.close).click(),
    },
    {
        name: 'custom sidebar config',
        component: CustomSidebarConfig as Component,
        open: () => { customSideBarConfigDialogStore.open = true },
        isOpen: () => customSideBarConfigDialogStore.open,
        clickX: (target) => buttonWhere(target, (b) => b.textContent?.trim() === language.uiCommon.close).click(),
    },
]

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []
const cleanups: Array<() => void> = []

async function mountSurface(surface: Surface): Promise<{ target: HTMLElement; destroy: () => void }> {
    surface.open()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(surface.component, { target, props: {} })
    mounted.push(component)
    flushSync()
    await vi.advanceTimersByTimeAsync(5000)
    flushSync()
    return {
        target,
        destroy: () => {
            unmount(component)
            mounted.splice(mounted.indexOf(component), 1)
            target.remove()
        },
    }
}

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

function closeEverything(): void {
    bookmarkListOpen.set(false)
    easyPanelStore.open = false
    popUpEditorStore.open = false
    popUpEditorStore.value = ''
    loadoutModalStore.open = false
    irisStore.open = false
    customSideBarConfigDialogStore.open = false
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    showToast.mockReset()
    spies.applyLoadout.mockReset()
    spies.saveCurrentLoadout.mockReset()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    closeEverything()
    DBState.db = {
        characters: [{
            type: 'character', name: 'Char', image: '', chatPage: 0,
            chats: [{ message: [], bookmarks: [], bookmarkNames: {} }],
        }],
        customSidebarItems: [],
        loadouts: [],
        loadoutApplyOptions: { modules: true, globalVariables: true, preset: true, persona: true },
        subModel: 'sub',
        seperateModelsForAxModels: false,
        seperateModels: {},
    } as unknown as Database
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    for (const cleanup of cleanups.splice(0)) {
        cleanup()
    }
    closeEverything()
    document.body.replaceChildren()
    resetBackHandlersForTests()
    vi.useRealTimers()
})

describe.each(surfaces)('$name Back', (surface) => {
    test('(R) Back closes the surface, then the root warns', async () => {
        await mountSurface(surface)
        expect(surface.isOpen()).toBe(true)
        expect(pressBack()).toBe(true)
        expect(surface.isOpen()).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) Back leaves the surface as its close control does', async () => {
        const first = await mountSurface(surface)
        surface.clickX(first.target)
        flushSync()
        expect(surface.isOpen()).toBe(false)
        first.destroy()
        await mountSurface(surface)
        pressBack()
        expect(surface.isOpen()).toBe(false)
    })

    test('(G) an unmounted surface stops answering Back', async () => {
        const { destroy } = await mountSurface(surface)
        destroy()
        expect(pressBack()).toBe(true)
        expect(surface.isOpen()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) a surface that is already closed but still mounted is not handled and keeps focus', async () => {
        const { target } = await mountSurface(surface)
        const field = document.createElement('input')
        document.body.appendChild(field)
        field.focus()
        closeEverything()
        flushSync()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(field)
        expect(target.isConnected).toBe(true)
    })

    test('(G) a surface opened after an older one answers first', async () => {
        const older = { open: true }
        cleanups.push(registerBackHandler(() => {
            if (!older.open) {
                return false
            }
            older.open = false
            return true
        }))
        await mountSurface(surface)
        expect(pressBack()).toBe(true)
        expect(surface.isOpen()).toBe(false)
        expect(older.open).toBe(true)
        expect(pressBack()).toBe(true)
        expect(older.open).toBe(false)
    })
})

describe('surface-specific Back', () => {
    test('(G) the popup editor keeps the typed value for the caller', async () => {
        const surface = surfaces[2]
        await mountSurface(surface)
        popUpEditorStore.value = 'typed text'
        expect(pressBack()).toBe(true)
        expect(popUpEditorStore.open).toBe(false)
        expect(popUpEditorStore.value).toBe('typed text')
    })

    test('(G) the loadout modal applies and saves nothing when Back closes it', async () => {
        const surface = surfaces[3]
        const { target } = await mountSurface(surface)
        const name = target.querySelector('input[type="text"]') as HTMLInputElement
        name.value = 'half typed'
        name.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect(pressBack()).toBe(true)
        expect(loadoutModalStore.open).toBe(false)
        expect(spies.applyLoadout).not.toHaveBeenCalled()
        expect(spies.saveCurrentLoadout).not.toHaveBeenCalled()
    })

    test('(G) the custom sidebar config closes from its add page too, not back to the list', async () => {
        const surface = surfaces[5]
        const { target } = await mountSurface(surface)
        buttonWhere(target, (b) => b.textContent?.trim() === language.othersUi.addItem).click()
        flushSync()
        expect(pressBack()).toBe(true)
        expect(customSideBarConfigDialogStore.open).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('(R) Iris closes the backlog first, then the dialogue, as its two close buttons do', async () => {
        const surface = surfaces[4]
        const { target } = await mountSurface(surface)
        buttonWhere(target, (b) => b.getAttribute('title') === language.iris.viewBacklog).click()
        flushSync()
        expect(pressBack()).toBe(true)
        expect(irisStore.open).toBe(true)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(irisStore.open).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('(G) a Back during the Iris fade-out is not handled, the field keeps focus and the quit warning shows', async () => {
        const surface = surfaces[4]
        const { target } = await mountSurface(surface)
        const input = target.querySelector('input[type="text"]') as HTMLInputElement
        input.focus()
        irisStore.open = false
        flushSync()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(input)
    })
})
