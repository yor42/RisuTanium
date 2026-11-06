// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../ts/stores.svelte', () => {
    const DBState = $state({ db: {
        characters: [{ chaId: 'c', type: 'character', chatPage: 0, chats: [{ message: [{ role: 'user', data: '' }, { role: 'char', data: '' }], modules: [] }] }],
        useChatSticker: false, showMenuChatList: false, enableRisuaiProTools: false,
        showMenuHypaMemoryModal: false, supaModelType: 'none', hypav2: false, hypaV3: false, sideMenuRerollButton: false,
    } })
    const selIdState = $state({ selId: 0 })
    const additionalChatMenu = $state([{ id: 'item', name: 'Plugin menu', callback: vi.fn() }])
    const easyPanelStore = $state({ open: false })
    return { DBState, selIdState, additionalChatMenu, easyPanelStore, selectedCharID: writable(0), hypaV3ModalOpen: writable(false) }
})
vi.mock('../../ts/storage/pageStorageMode', () => ({ pageStorageModeStore: writable({ kind: 'store2' }) }))
vi.mock('../Utility/utilityGate', () => ({ utilityVisible: vi.fn(() => false), utilityOpen: writable(false) }))
vi.mock('../../lang', () => ({ language: {
    chatShellMoreActions: 'More actions', continueResponse: 'Continue', ttsStop: 'Stop speech',
    chatShellStickers: 'Stickers', chatList: 'Chat list', easyPanel: 'Easy panel',
    hypaMemoryV2Modal: 'Hypa V2', hypaMemoryV3Modal: 'Hypa V3', screenshot: 'Screenshot',
    modules: 'Modules', reroll: 'Reroll', chatShellUtility: 'Utility',
    alerts: { screenshotTaking: 'Taking screenshot', screenshotMerging: 'Merging' },
    screenshotSaved: 'Saved', errors: { screenshotFailed: 'Screenshot failed' },
} }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ sendContinue: vi.fn(async () => {}), reroll: vi.fn(async () => {}) }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn() }))
vi.mock('../../ts/process/ttsModes', () => ({ canChatSpeak: vi.fn(() => false) }))
vi.mock('../../ts/util', () => ({ findCharacterbyId: vi.fn() }))
vi.mock('../../ts/alert', () => ({ showHypaV2Alert: vi.fn(), alertWait: vi.fn(), alertNormal: vi.fn(), alertError: vi.fn() }))
vi.mock('../../ts/exportNotice', () => ({ downloadNotice: (message: string) => message }))
vi.mock('../../ts/globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

function row(target: HTMLElement, name: string): HTMLButtonElement | undefined {
    return [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === name)
}

describe('PlusSheet', () => {
    beforeEach(async () => {
        const { DBState, easyPanelStore } = await import('../../ts/stores.svelte')
        Object.assign(DBState.db, {
            useChatSticker: false, showMenuChatList: false, enableRisuaiProTools: false,
            showMenuHypaMemoryModal: false, supaModelType: 'none', hypav2: false, hypaV3: false, sideMenuRerollButton: false,
        })
        Object.assign(DBState.db.characters[0].chats[0], { message: [{ role: 'user', data: '' }, { role: 'char', data: '' }], modules: [] })
        easyPanelStore.open = false
        vi.mocked((await import('../Utility/utilityGate')).utilityVisible).mockReturnValue(false)
        vi.mocked((await import('../../ts/process/ttsModes')).canChatSpeak).mockReturnValue(false)
        vi.clearAllMocks()
    })

    test('Continue requires two messages ending with a character reply', async () => {
        const { DBState } = await import('../../ts/stores.svelte')
        const { sendContinue } = await import('../../ts/process/composerActions.svelte')
        const { default: PlusSheet } = await import('./PlusSheet.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const props = $state({ open: true, opener: null, background: [], onclose: () => { props.open = false }, onstickers: vi.fn(), onchatlist: vi.fn(), onmodules: vi.fn() })
        const app = mount(PlusSheet, { target, props })
        flushSync()
        expect(row(target, 'Continue')?.disabled).toBe(false)
        for (const label of ['Stickers', 'Chat list', 'Easy panel', 'Hypa V2', 'Modules', 'Reroll', 'Utility']) expect(row(target, label)).toBeUndefined()
        Object.assign(DBState.db.characters[0].chats[0], { message: [{ role: 'char', data: '' }] })
        flushSync()
        expect(row(target, 'Continue')?.disabled).toBe(true)
        Object.assign(DBState.db.characters[0].chats[0], { message: [{ role: 'char', data: '' }, { role: 'user', data: '' }] })
        flushSync()
        expect(row(target, 'Continue')?.disabled).toBe(true)
        Object.assign(DBState.db.characters[0].chats[0], { message: [{ role: 'user', data: '' }, { role: 'char', data: '' }] })
        flushSync()
        row(target, 'Continue')?.click()
        await tick()
        expect(sendContinue).toHaveBeenCalledOnce()
        await unmount(app)
        target.remove()
    })

    test('gated menu rows, Utility Home order, keyboard and Back', async () => {
        const { DBState, selectedCharID } = await import('../../ts/stores.svelte')
        const utility = await import('../Utility/utilityGate')
        Object.assign(DBState.db, {
            useChatSticker: true, showMenuChatList: true, enableRisuaiProTools: true,
            showMenuHypaMemoryModal: true, supaModelType: 'hypav2', hypav2: true, sideMenuRerollButton: true,
        })
        vi.mocked(utility.utilityVisible).mockReturnValue(true)
        const { default: PlusSheet } = await import('./PlusSheet.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const props = $state({ open: true, opener: null, background: [], onclose: () => { props.open = false }, onstickers: vi.fn(), onchatlist: vi.fn(), onmodules: vi.fn() })
        const app = mount(PlusSheet, { target, props })
        flushSync()
        for (const label of ['Stickers', 'Chat list', 'Easy panel', 'Hypa V2', 'Modules', 'Reroll', 'Utility', 'Plugin menu']) expect(row(target, label)).toBeDefined()
        row(target, 'Stickers')?.focus()
        row(target, 'Stickers')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
        expect(document.activeElement).toBe(row(target, 'Utility'))
        row(target, 'Chat list')?.click()
        expect(props.onchatlist).toHaveBeenCalledOnce()
        flushSync()
        props.open = true
        flushSync()
        row(target, 'Modules')?.click()
        expect(props.onmodules).toHaveBeenCalledOnce()
        flushSync()
        props.open = true
        flushSync()
        const events: string[] = []
        const stopUtility = utility.utilityOpen.subscribe((open) => { if (open) events.push('utility') })
        const stopSelection = selectedCharID.subscribe((id) => { if (id === -1) events.push('home') })
        row(target, 'Utility')?.click()
        expect(events).toEqual(['home', 'utility'])
        expect(props.open).toBe(false)
        stopUtility()
        stopSelection()
        await unmount(app)
        target.remove()
    })

    test('Back closes the open menu', async () => {
        const { default: PlusSheet } = await import('./PlusSheet.svelte')
        const { dispatchBack } = await import('../../ts/backHandlers')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const props = $state({ open: true, opener: null, background: [], onclose: () => { props.open = false }, onstickers: vi.fn(), onchatlist: vi.fn(), onmodules: vi.fn() })
        const app = mount(PlusSheet, { target, props })
        flushSync()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(props.open).toBe(false)
        await unmount(app)
        target.remove()
    })

    test('speech and V3 memory rows follow their gates', async () => {
        const { DBState, hypaV3ModalOpen } = await import('../../ts/stores.svelte')
        const { canChatSpeak } = await import('../../ts/process/ttsModes')
        vi.mocked(canChatSpeak).mockReturnValue(true)
        Object.assign(DBState.db, { showMenuHypaMemoryModal: true, hypav2: false, hypaV3: true })
        const { default: PlusSheet } = await import('./PlusSheet.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const props = $state({ open: true, opener: null, background: [], onclose: () => { props.open = false }, onstickers: vi.fn(), onchatlist: vi.fn(), onmodules: vi.fn() })
        const app = mount(PlusSheet, { target, props })
        flushSync()
        expect(row(target, 'Stop speech')).toBeDefined()
        expect(row(target, 'Hypa V3')).toBeDefined()
        row(target, 'Hypa V3')?.click()
        expect(get(hypaV3ModalOpen)).toBe(true)
        await unmount(app)
        target.remove()
    })
})
