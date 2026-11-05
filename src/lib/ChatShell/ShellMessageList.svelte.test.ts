// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: false, alwaysScrollToNewMessage: false,
        chatLoadInitialPages: 2, chatLoadAdditionalPages: 2 } })
    const ReloadChatPointer = writable<Record<number, number>>({})
    const ReloadGUIPointer = writable(0)
    const ScrollToMessageStore = $state({ value: -1 })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer, ReloadGUIPointer, ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false }
})
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting' }))
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
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
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
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment, props: { msgDisplay?: string, renderRevision?: number }) => {
    if (props.msgDisplay === 'bad') throw new Error('row failed')
    const node = document.createElement('div')
    node.setAttribute('data-part', 'completed-body')
    anchor.before(node)
    $effect(() => { node.textContent = `${props.msgDisplay}:${props.renderRevision}` })
    return {}
} }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))

import ShellMessageList from './ShellMessageList.svelte'
import { ReloadGUIPointer as gui, ScrollToMessageStore as bookmark } from '../../ts/stores.svelte'
import { chatFoldedStateMessageIndex as folded } from '../../ts/globalApi.svelte'
import { chatSurface as surface } from '../ChatScreens/chatSurface.svelte'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: [] as Message[] }] }) as Character

function row(id: string): Message { return { chatId: id, role: 'char', data: id } }
function find(id: string) { return target.querySelector(`[data-chat-id="${id}"]`) }
async function show() {
    target = document.createElement('div')
    host = document.createElement('main')
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host } })
    flushSync()
    await tick()
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    character.chats[0].message = []
    delete character.chats[0].supaMemoryCoveredId
    character.chats[0].isStreaming = false
    folded.index = -1
    bookmark.value = -1
    surface.hidden = false
    surface.rebuildEpoch = 0
    gui.set(0)
})

describe('ShellMessageList row identity and window', () => {
    test('memory boundary marks the covered reply', async () => {
        character.chats[0].message = [row('covered'), row('newer')]
        character.chats[0].supaMemoryCoveredId = 'covered'
        await show()
        expect(find('covered')?.querySelector('[data-part="chat-message-memory-limit"]')).not.toBeNull()
        expect(find('newer')?.querySelector('[data-part="chat-message-memory-limit"]')).toBeNull()
    })
    test('T1: a stream chunk keeps the streaming article and completed rows mounted', async () => {
        character.chats[0].message = [row('done'), row('stream')]
        character.chats[0].isStreaming = true
        await show()
        const done = find('done')
        const doneBody = done?.querySelector('[data-part="completed-body"]')
        const stream = find('stream')
        character.chats[0].message[1].data += ' next chunk'
        flushSync()
        expect(find('done')).toBe(done)
        expect(find('done')?.querySelector('[data-part="completed-body"]')).toBe(doneBody)
        expect(find('stream')).toBe(stream)
    })

    test('T2: a GUI bump keeps completed row nodes, and an inserted ID keeps its row', async () => {
        character.chats[0].message = [row('a'), row('b'), row('c')]
        await show()
        const b = find('b')
        const c = find('c')
        const body = b?.querySelector('[data-part="completed-body"]')
        expect(b).not.toBeNull()
        gui.set(1)
        surface.heldGui = 1
        flushSync()
        expect(find('b')).toBe(b)
        expect(find('c')).toBe(c)
        expect(find('b')?.querySelector('[data-part="completed-body"]')).toBe(body)
        expect(body?.textContent).toBe('b:1')
        character.chats[0].message.splice(2, 0, row('inserted'))
        flushSync()
        expect(find('b')).toBe(b)
    })

    test('Load more and the first-message row', async () => {
        character.chats[0].message = [row('a'), row('b'), row('c'), row('d')]
        await show()
        expect(find('a')).toBeNull()
        folded.index = 2
        flushSync()
        const button = target.querySelector<HTMLButtonElement>('[data-part="chat-load-more"]')
        expect(button).not.toBeNull()
        button?.click()
        flushSync()
        expect(find('a')).not.toBeNull()
        expect(target.querySelector('[data-part="chat-first-message"]')).not.toBeNull()
    })

    test('bookmark jump waits for the hidden surface', async () => {
        character.chats[0].message = [row('a'), row('b')]
        await show()
        const scroll = vi.fn()
        Element.prototype.scrollIntoView = scroll
        surface.hidden = true
        bookmark.value = 1
        flushSync()
        expect(bookmark.value).toBe(1)
        expect(scroll).not.toHaveBeenCalled()
        surface.hidden = false
        flushSync()
        await tick()
        expect(bookmark.value).toBe(-1)
        expect(scroll).toHaveBeenCalledTimes(1)
    })

    test('a throwing row shows its retry fallback while other rows remain', async () => {
        character.chats[0].message = [row('good'), row('bad')]
        await show()
        expect(find('good')).not.toBeNull()
        expect(target.querySelector('[data-part="chat-message-failed"]')?.textContent).toContain('Failed')
    })

    test('an interrupted completed reply keeps its note and the first message remains at the end', async () => {
        character.chats[0].message = [{ ...row('stopped'), interrupted: true }]
        await show()
        expect(find('stopped')?.querySelector('[data-part="chat-message-interrupted"]')?.textContent).toContain('Interrupted')
        expect(target.querySelector('[data-part="chat-first-message"]')).not.toBeNull()
    })

    test('a surface rebuild replaces stale rows after the hidden visit', async () => {
        character.chats[0].message = [row('a')]
        await show()
        const before = find('a')
        surface.hidden = true
        character.chats[0].message[0].data = 'changed while hidden'
        flushSync()
        expect(find('a')).toBe(before)
        surface.rebuildEpoch += 1
        surface.hidden = false
        flushSync()
        expect(find('a')).not.toBe(before)
    })
})
