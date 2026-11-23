// @vitest-environment jsdom
/**
 * TA-5(e), the mounted-screen walk (part 3: This chat sheet). Fixture F2: ChatScreen.svelte on its ChatShell branch, with the This chat
 * sheet opened from the header menu, in both ShellSheet layouts (phone and wide). ChatScreen, ChatShell, ThisChatSheet and ShellSheet
 * are real; the mocks set state and stand in for the siblings those files do not contain.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { escapeWalkViolations } from './fixtures/criticalClosure'
import { CRITICAL_PARTS, ESCAPE_ANCESTORS } from './engine'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const chat = (id: string, name: string) => ({ id, name, note: '', localLore: [], message: [
        { role: 'user', data: 'a', chatId: `${id}-1`, time: 1_000 },
        { role: 'char', data: 'b', chatId: `${id}-2`, time: 2_000 },
    ] })
    const DBState = $state({ db: {
        theme: '', textScreenColor: '', textBorder: false, textScreenRounded: false, textScreenBorder: '', customBackground: '', classicMaxWidth: false, waifuWidth: 100, waifuWidth2: 100,
        characters: [{ chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, removedQuotes: true, creatorNotes: '', viewScreen: 'none', chats: [chat('c1', 'Harbour night'), chat('c2', 'Second')] }],
        personas: [{ id: 'p1', name: 'Captain' }], selectedPersona: 0, username: 'User', sendWithEnter: true, jailbreak: '', jailbreakToggle: false,
        supaModelType: 'none', hypav2: false, hypaV3: false, customPromptTemplateToggle: '', globalChatVariables: {},
    } })
    const selIdState = $state({ selId: 0 })
    const additionalChatMenu = $state([])
    return {
        DBState, selIdState, selectedCharID: writable(0), additionalChatMenu, settingsOpen: writable(false), hypaV3ModalOpen: writable(false),
        MobileGUI: writable(false), DynamicGUI: writable(false), sideBarClosing: writable(false), sideBarStore: writable(false), MobileSideBar: writable(0),
        CharEmotion: writable({}), moduleBackgroundEmbedding: writable(''),
    }
})
vi.mock('src/ts/process/index.svelte', async () => { const { writable } = await import('svelte/store'); return { doingChat: writable(false), chatProcessStage: writable(0) } })
vi.mock('src/lib/ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0 } }))
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => true }))
vi.mock('src/ts/process/chatOnScreen.svelte', () => ({ holdChatView: () => () => {} }))
vi.mock('src/ts/media/charImageLookups', () => ({ useCharImageLookups: () => ({ get: vi.fn(), getIf: vi.fn(), dispose: vi.fn() }) }))
vi.mock('src/ts/gui/surfaceTone', () => ({ packBaseTone: () => undefined }))
vi.mock('src/ts/gui/chatBackground', () => ({ canvasYieldDeclaration: () => '', hasUserChatBackground: () => false }))

// Siblings that the F2 chain does not contain.
vi.mock('src/lib/ChatScreens/DefaultChatScreen.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/Others/ChatList.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/Setting/Pages/Module/ModuleChatMenu.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatScreens/BackgroundDom.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatScreens/ResizeBox.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatScreens/TransitionImage.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/UI/GUI/SideBarArrow.svelte', () => ({ default: () => ({}) }))
// The transcript's list stands in with message elements, so the role check has messages to observe.
vi.mock('src/lib/ChatShell/ShellMessageList.svelte', () => ({
    default: (anchor: Comment) => {
        for (const role of ['user', 'system', 'user']) {
            const message = document.createElement('article')
            message.setAttribute('data-role', role)
            anchor.before(message)
        }
    },
}))
vi.mock('src/lib/ChatShell/ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatShell/PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatShell/ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatShell/ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatShell/ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatShell/CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatShell/SendFailureCard.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/Setting/settingsRoute', () => ({}))
vi.mock('src/ts/chatShell/sendFailure.svelte', () => ({ shellGenerationSource: (closeMenu: () => void) => ({ closeMenu }), failureOf: () => null, retrySendFailure: vi.fn() }))
vi.mock('src/ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, isComposerBusyIn: () => false, branchAt: vi.fn() }))
vi.mock('src/ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => ({}) }))
vi.mock('src/ts/globalApi.svelte', () => ({ aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined) }))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('src/ts/process/chatTree', () => ({ isChatAltReadable: () => true }))
vi.mock('src/ts/util', () => ({ parseToggleSyntax: () => [], findCharacterbyId: vi.fn(), getCustomBackground: vi.fn(async () => ''), getEmotion: vi.fn(() => '') }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), showHypaV2Alert: vi.fn() }))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/characters', () => ({ exportChat: vi.fn(), removeChatConfirmed: vi.fn(async () => false) }))

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import ChatScreen from 'src/lib/ChatScreens/ChatScreen.svelte'

const allowed = new Set<string>([...ESCAPE_ANCESTORS, ...CRITICAL_PARTS])

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement

function setViewport(width: number): void {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

async function openSheet(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatScreen, { target })
    await vi.waitFor(() => {
        flushSync()
        expect(target.querySelector('[data-part="chat-header-menu"]')).not.toBeNull()
    }, { timeout: 15000 })
    target.querySelector<HTMLButtonElement>('[data-part="chat-header-menu"]')!.click()
    await vi.waitFor(() => {
        flushSync()
        expect(target.querySelector('[data-part="this-chat-all-settings"]')).not.toBeNull()
    }, { timeout: 15000 })
    await tick()
}

beforeEach(() => {
    localStorage.clear()
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

describe('F2 the This chat sheet', () => {
    for (const [label, width] of [['phone', 400], ['wide', 1000]] as const) {
        test(`${label}: "All settings" is a marked escape element, and the transcript's messages cannot reach it`, async () => {
            setViewport(width)
            await openSheet()
            expect(escapeWalkViolations(target, 'this-chat-all-settings', { count: 1, marked: true }, allowed)).toEqual([])
        })
    }
})
