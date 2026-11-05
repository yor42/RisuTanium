// @vitest-environment jsdom
// Fixed-position layers inside a row (the partial-edit overlays) must not be clipped by the row's containment: while one is open the
// list lifts `older` (content-visibility) from that row, and the message body carries no transform at rest.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: false, alwaysScrollToNewMessage: false,
        chatLoadInitialPages: 20, chatLoadAdditionalPages: 2, enableBlockPartialEdit: true, enableDragPartialEdit: false } })
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
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
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
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))

import ShellMessageList from './ShellMessageList.svelte'
import { DBState } from '../../ts/stores.svelte'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: [] as Message[] }] }) as Character

function row(id: string): Message { return { chatId: id, role: 'char', data: id } }
function article(id: string): HTMLElement { return target.querySelector<HTMLElement>(`article[data-chat-id="${id}"]`)! }
function container(id: string): HTMLElement { return article(id).closest<HTMLElement>('[data-part="chat-message-container"]')! }
async function show() {
    character.chats[0].message = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'].map(row)
    target = document.createElement('div')
    host = document.createElement('main')
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host } })
    flushSync()
    await tick()
}
// The partial-edit controller renders its modal inline in the row; a stand-in node with its class is the only thing the row watches for.
async function openOverlay(id: string): Promise<HTMLElement> {
    const overlay = document.createElement('div')
    overlay.className = 'partial-edit-overlay'
    article(id).appendChild(overlay)
    await Promise.resolve()
    flushSync()
    await tick()
    return overlay
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    character.chats[0].message = []
    DBState.db.enableBlockPartialEdit = true
    DBState.db.enableDragPartialEdit = false
})

describe('layers inside a row', () => {
    test('rows older than the newest three are contained, the newest ones are not', async () => {
        await show()
        expect(container('m0').classList.contains('older')).toBe(true)
        expect(container('m2').classList.contains('older')).toBe(true)
        expect(container('m3').classList.contains('older')).toBe(false)
        expect(container('m5').classList.contains('older')).toBe(false)
    })
    test('an open partial-edit overlay lifts the containment of its row only, and closing it restores it', async () => {
        await show()
        const overlay = await openOverlay('m0')
        expect(container('m0').classList.contains('older')).toBe(false)
        expect(container('m1').classList.contains('older')).toBe(true)
        overlay.remove()
        await Promise.resolve()
        flushSync()
        await tick()
        expect(container('m0').classList.contains('older')).toBe(true)
    })
    test('the overlay is never inside an element that carries the containment', async () => {
        await show()
        const overlay = await openOverlay('m1')
        expect(overlay.closest('[data-part="chat-message-container"].older')).toBeNull()
    })
    test('a row destroyed while its overlay is open leaves no stale lift behind', async () => {
        await show()
        await openOverlay('m0')
        character.chats[0].message = ['m1', 'm2', 'm3', 'm4', 'm5', 'x0', 'x1'].map(row)
        flushSync()
        await tick()
        expect(target.querySelector('article[data-chat-id="m0"]')).toBeNull()
        character.chats[0].message = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'].map(row)
        flushSync()
        await tick()
        expect(container('m0').classList.contains('older')).toBe(true)
    })
    test('at rest no message body carries a transform, so fixed-position card content is not confined to the body', async () => {
        await show()
        for (const id of ['m0', 'm3', 'm5']) {
            const body = article(id).querySelector<HTMLElement>('[data-part="chat-message-body"]')!
            expect(body.style.transform).toBe('')
        }
    })
    test('with both partial-edit settings off the row watches for no overlay at all', async () => {
        DBState.db.enableBlockPartialEdit = false
        DBState.db.enableDragPartialEdit = false
        await show()
        await openOverlay('m0')
        expect(container('m0').classList.contains('older')).toBe(true)
    })
    test('the drag-only partial-edit setting also watches for the overlay', async () => {
        DBState.db.enableBlockPartialEdit = false
        DBState.db.enableDragPartialEdit = true
        await show()
        await openOverlay('m0')
        expect(container('m0').classList.contains('older')).toBe(false)
    })
    test('after a touch tap, a cancelled touch and a slop-only release no body carries a transform or a spring', async () => {
        await show()
        const body = article('m5').querySelector<HTMLElement>('[data-part="chat-message-body"]')!
        const touch = (kind: string, x: number) => {
            const event = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: 100 })
            Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 } })
            body.dispatchEvent(event)
            flushSync()
        }
        touch('pointerdown', 200); touch('pointerup', 200)
        expect(body.style.transform).toBe('')
        expect(body.hasAttribute('data-spring')).toBe(false)
        touch('pointerdown', 200); touch('pointercancel', 200)
        expect(body.style.transform).toBe('')
        expect(body.hasAttribute('data-spring')).toBe(false)
        touch('pointerdown', 200); touch('pointermove', 204); touch('pointerup', 204)
        expect(body.style.transform).toBe('')
        expect(body.hasAttribute('data-spring')).toBe(false)
    })
})
