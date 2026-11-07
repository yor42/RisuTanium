// @vitest-environment jsdom
// The page-size settings reach the new shell clamped: a stored initial of 500 mounts at most 100 articles (99 rows plus the first
// message), so the completed-row parse count at open and after a held-state bump is bounded by the mounted rows. The stored value is never written.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'

const parsed = vi.hoisted(() => ({ texts: [] as string[] }))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: false, alwaysScrollToNewMessage: false,
        chatLoadInitialPages: 500, chatLoadAdditionalPages: 500 } })
    const ReloadChatPointer = writable<Record<number, number>>({})
    const ReloadGUIPointer = writable(0)
    const ScrollToMessageStore = $state({ value: -1 })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer, ReloadGUIPointer, ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/gui/colorscheme', async () => {
    const { writable } = await import('svelte/store')
    return { ColorSchemeTypeStore: writable('dark') }
})
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false }
})
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: (id: string | undefined) => id === 'stream' }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => false, onDraftsChanged: () => () => {} }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0, heldGui: 0, heldChat: {} as Record<number, number> })
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: () => () => {} }
})
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', () => ({ language: { loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted' } }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => { parsed.texts.push(text); return text } }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn() }))
vi.mock('../../ts/process/messageActions.svelte', () => ({ handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn() }))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false,
    dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))

import ShellMessageList from './ShellMessageList.svelte'
import { DBState } from '../../ts/stores.svelte'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: [] as Message[] }] }) as Character

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    character.chats[0].message = []
    parsed.texts = []
})

function completedParses(): number {
    return parsed.texts.filter((text) => text.startsWith('completed')).length
}

async function showWithCompletedRows(count: number): Promise<void> {
    const rows: Message[] = []
    for (let i = 0; i < count; i++) rows.push({ chatId: `done-${i}`, role: i % 2 === 0 ? 'char' : 'user', data: `completed ${i}` })
    character.chats[0].message = rows
    target = document.createElement('div')
    host = document.createElement('main')
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host } })
    flushSync()
    await tick()
}
function mountedCount(): number {
    return host.querySelectorAll('article[data-part="chat-message"]').length
}

describe('a stored page count of 500 reaches the shell clamped', () => {
    test('T2: opening a 1,000-message chat parses at most the 100 mounted rows, and a held-state bump does not parse more', async () => {
        await showWithCompletedRows(1000)
        expect(mountedCount()).toBeLessThanOrEqual(100)
        expect(completedParses()).toBeLessThanOrEqual(100)
        const opened = completedParses()
        chatSurface.heldGui += 1
        flushSync()
        await tick()
        expect(completedParses() - opened).toBeLessThanOrEqual(100)
    })
    test('G3: the stored settings are unchanged by opening the chat and reading back', async () => {
        await showWithCompletedRows(1000)
        app!.onScroll()
        flushSync()
        await tick()
        expect(DBState.db.chatLoadInitialPages).toBe(500)
        expect(DBState.db.chatLoadAdditionalPages).toBe(500)
    })
})
