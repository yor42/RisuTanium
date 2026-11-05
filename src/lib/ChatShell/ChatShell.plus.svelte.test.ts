// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../ts/stores.svelte', () => {
    const DBState = $state({ db: {
        characters: [{ chaId: 'c', name: 'Ari', type: 'character', chatPage: 0, removedQuotes: true, creatorNotes: '', chats: [{ id: 'chat', message: [{ role: 'user', data: '' }, { role: 'char', data: '' }] }] }],
        personas: [], selectedPersona: 0, username: 'User', sendWithEnter: true, useAutoTranslateInput: false,
        translator: '', useAutoSuggestions: false, useChatSticker: false, enableRisuaiProTools: false,
        showMenuChatList: false, showMenuHypaMemoryModal: false, sideMenuRerollButton: false,
        newMessageButtonStyle: 'bottom-center',
    } })
    const selIdState = $state({ selId: 0 })
    const additionalChatMenu = $state([])
    const additionalFloatingActionButtons = $state([])
    const chatPanelStore = $state([])
    const easyPanelStore = $state({ open: false })
    const popUpEditorStore = $state({ open: false, value: '', mode: 'default', language: '' })
    return {
        DBState, selIdState, selectedCharID: writable(0), additionalChatMenu, additionalFloatingActionButtons,
        chatPanelStore, easyPanelStore, hypaV3ModalOpen: writable(false),
        MobileGUI: writable(false), MobileSideBar: writable(0), popUpEditorStore,
    }
})
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: writable(false), chatProcessStage: writable(0) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0 } }))
vi.mock('./ShellMessageList.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../lang', () => ({ language: {
    chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona', chatShellMoreActions: 'More actions',
    chatShellMessages: 'Messages', chatShellMessage: 'Message', chatShellSend: 'Send', chatShellStop: 'Stop',
    chatShellRemoveAttachment: 'Remove attachment', chatShellStickers: 'Stickers',
    chatShellEnterAutomatic: 'Automatic', chatShellEnterSend: 'Send', chatShellEnterNewline: 'New line',
    asPersona: (name: string) => `as ${name}`, enterKey: 'Enter key', postFile: 'Post file',
    continueResponse: 'Continue', ttsStop: 'Stop speech', chatList: 'Chat list', easyPanel: 'Easy panel',
    screenshot: 'Screenshot', modules: 'Modules', reroll: 'Reroll', chatShellUtility: 'Utility',
    aiGenerationWarning: 'AI warning', loadingChatData: 'Loading', newMessage: 'New message',
    alerts: { screenshotTaking: 'Taking', screenshotMerging: 'Merging' },
    errors: { screenshotFailed: 'Failed', coldStorageLegacyChatRetryButton: 'Retry' },
} }))
vi.mock('../../ts/process/composerSurface.svelte', () => ({ createComposerSurface: () => {
    const shownDraft = $state({ messageInput: '', messageInputTranslate: '', fileInput: [] })
    return { shownDraft, resolveDraftKeyForWrite: () => null, writeDraft: vi.fn(), writeDraftAt: vi.fn() }
}, beginChatFileUpload: () => () => {}, trackChatFileUpload: vi.fn() }))
vi.mock('../../ts/process/composerDrafts.svelte', () => ({ peek: () => ({ messageInput: '' }), EMPTY_DRAFT_VIEW: { messageInput: '', messageInputTranslate: '', fileInput: [] } }))
vi.mock('../../ts/localDrafts', () => ({ COMPOSER_DRAFT_KIND: 'composer', registerDraft: vi.fn(), unregisterDraft: vi.fn() }))
vi.mock('../../ts/process/files/multisend', () => ({ postChatFile: vi.fn() }))
vi.mock('../../ts/process/composerActions.svelte', () => ({
    sendMain: vi.fn(), sendContinue: vi.fn(), reroll: vi.fn(), abortChat: vi.fn(),
    isComposerBusy: () => false, isComposerLocked: () => false, updateInputTransateMessage: vi.fn(),
}))
vi.mock('../../ts/chatShell/enterKey', () => ({ createEnterKeyController: () => ({
    hardwareSeen: false, observeViewport: vi.fn(), observeKey: vi.fn(), touch: vi.fn(), shouldSend: () => false,
    compositionStart: vi.fn(), compositionEnd: vi.fn(),
}) }))
vi.mock('../../ts/chatShell/deviceSettings', () => ({ readEnterMode: () => 'auto', writeEnterMode: vi.fn() }))
vi.mock('../ChatScreens/Suggestion.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/AssetInput.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/CreatorQuote.svelte', () => ({ default: () => ({}) }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
vi.mock('../Mobile/mobileBack', () => ({ closeShellChat: vi.fn() }))
vi.mock('../../ts/storage/pageStorageMode', () => ({ pageStorageModeStore: writable({ kind: 'store2' }), getPageStorageMode: () => ({ kind: 'store2' }) }))
vi.mock('../Utility/utilityGate', () => ({ utilityVisible: () => false, utilityOpen: writable(false) }))
vi.mock('../../ts/process/ttsModes', () => ({ canChatSpeak: () => false }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn() }))
vi.mock('../../ts/util', () => ({ findCharacterbyId: vi.fn() }))
vi.mock('../../ts/alert', () => ({ showHypaV2Alert: vi.fn(), alertWait: vi.fn(), alertNormal: vi.fn(), alertError: vi.fn() }))
vi.mock('../../ts/exportNotice', () => ({ downloadNotice: (value: string) => value }))
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: () => false, downloadFile: vi.fn() }))
vi.mock('../../ts/process/coldstorage.svelte', () => ({ coldStorageHeader: 'COLD:', preLoadChat: vi.fn(), retryLegacyColdChatLoad: vi.fn() }))
vi.mock('../../ts/process/coldstorageData', () => ({ matchColdStorageLoadErrorKey: () => null, legacyRetryView: vi.fn(), legacyRetryStateFor: vi.fn(), coldChatNoticeText: vi.fn() }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

describe('ChatShell plus composition', () => {
    test('the composer plus button opens the menu sheet', async () => {
        const { default: ChatShell } = await import('./ChatShell.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(ChatShell, { target })
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelector('[data-part="chat-composer-plus"]')).not.toBeNull()
        }, { timeout: 15000 })
        target.querySelector<HTMLButtonElement>('[data-part="chat-composer-plus"]')?.click()
        flushSync()
        expect(target.querySelector('[role="menu"]')).not.toBeNull()
        expect(target.querySelector('[data-testid="chat-shell-stub"]')?.classList.contains('default-chat-screen')).toBe(true)
        await unmount(app)
        target.remove()
    })
})
