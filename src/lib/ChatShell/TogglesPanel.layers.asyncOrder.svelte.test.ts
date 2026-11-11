// @vitest-environment jsdom
import 'src/ts/tests/asyncScheduler.test-helpers'

/**
 * The toggles panel opened at a row, under Svelte's async scheduler (the helper import above is first): the
 * scenarios of `TogglesPanel.layers.svelte.test.ts` run again with the REAL ChatShell, ShellSheet, TogglesPanel and
 * ToggleRow. There the sheet's `{#if open}` branch is created before a `$effect.pre` of the panel runs, so the aim at
 * the row must be known when the opening is read, or the sheet's one-shot initial focus lands on the title.
 * Regression reproducer for that ordering; the same scenarios stay green under the shipped scheduler.
 *
 * KNOWN LIMITATION (stale aim): under the async scheduler the aim may be computed before the panel's opening effect
 * calls `syncFavourites()`. If another tab removed the star in between, no row is aimed and focus falls to the sheet
 * section instead of the title. No test asserts that case; a later fix should replace this note with one.
 *
 * MOCKED: as in `TogglesPanel.layers.svelte.test.ts`, the shell parts around the panel, the + menu (stood in for by
 * its props), `DBState` and the process and storage modules.
 */
import { vi } from 'vitest'

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

import { registerTogglesPanelOpenAtSuite } from './TogglesPanel.layers.scenarios.test-helpers.svelte'

registerTogglesPanelOpenAtSuite(plus)
