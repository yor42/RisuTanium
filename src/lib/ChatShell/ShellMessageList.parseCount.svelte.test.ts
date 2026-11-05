// @vitest-environment jsdom
/**
 * Reproducer: while a reply streams, completed rows are not parsed again. The display parse of a completed row runs once
 * when the row is created and again only when that row's own text changes; the number of completed-row parses must not
 * grow with the number of stream chunks. A list that hands every row a fresh copy of its message on each chunk
 * re-parses every visible completed row per chunk, so the cost would scale with the loaded rows.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'

const parsed = vi.hoisted(() => ({ texts: [] as string[] }))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: false, alwaysScrollToNewMessage: false,
        chatLoadInitialPages: 5, chatLoadAdditionalPages: 2 } })
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

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: [] as Message[] }] }) as Character

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    character.chats[0].message = []
    character.chats[0].isStreaming = false
    parsed.texts = []
})

function completedParses(): number {
    return parsed.texts.filter((text) => text.startsWith('completed')).length
}

async function showWithCompletedRows(count: number): Promise<void> {
    const rows: Message[] = []
    for (let i = 0; i < count; i++) rows.push({ chatId: `done-${i}`, role: i % 2 === 0 ? 'char' : 'user', data: `completed ${i}` })
    rows.push({ chatId: 'stream', role: 'char', data: 'streaming' })
    character.chats[0].message = rows
    character.chats[0].isStreaming = true
    target = document.createElement('div')
    const host = document.createElement('main')
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host } })
    flushSync()
    await tick()
}

describe('reproducer: completed rows are not parsed again while a reply streams', () => {
    test('the completed-row parse count stays constant across successive stream chunks', async () => {
        await showWithCompletedRows(5)
        const mountParses = completedParses()
        expect(mountParses).toBe(5)
        const streamIndex = character.chats[0].message.length - 1
        const counts: number[] = []
        for (let chunk = 0; chunk < 8; chunk++) {
            character.chats[0].message[streamIndex].data += ` chunk${chunk}`
            flushSync()
            await tick()
            counts.push(completedParses())
        }
        expect(counts).toEqual(new Array<number>(8).fill(mountParses))
    })

    test('control: a change to one completed row parses that row alone, so the counter can see a re-parse', async () => {
        await showWithCompletedRows(3)
        const before = completedParses()
        character.chats[0].message[1].data = 'completed edited'
        flushSync()
        await tick()
        await vi.waitFor(() => expect(parsed.texts.filter((text) => text === 'completed edited')).toHaveLength(1), { timeout: 15000 })
        expect(completedParses()).toBe(before + 1)
    })
})
