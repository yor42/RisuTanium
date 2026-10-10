// @vitest-environment happy-dom

/**
 * `Chat.svelte` shows a note under a message mounted with `interrupted`, and
 * removes the flag from the live message when the person commits an edit of
 * its text, changed or not. Mocks as in `Chat.messageEditor.svelte.test.ts`
 * (copied, not shared: each suite mocks its own graph); the real `Chat.svelte`
 * is mounted.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CurrentTriggerIdStore: writable(null),
        popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: writable(false),
        createSimpleCharacter: vi.fn(() => null),
        bookmarkListOpen: writable(false),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    return {
        aiLawApplies: vi.fn(() => false),
        // Mirrors the one thing this file's chatPage-stays-live pin needs from the real
        // `changeChatTo`: writing `chatPage` for the currently selected
        // character. `SideChatList.svelte`'s copy and `Chat.svelte`'s own
        // branch button both call this with a numeric index (`0`) after
        // `unshift`ing the new chat.
        changeChatTo: vi.fn((v: number | string) => {
            const char = (stores.DBState as unknown as { db: any }).db.characters[
                (stores.selIdState as unknown as { selId: number }).selId
            ]
            if (typeof v === 'number' && char) {
                char.chatPage = v
            }
        }),
        foldChatToMessage: vi.fn(),
        getFileSrc: vi.fn(async () => ''),
        createChatCopyName: vi.fn((name: string) => `${name} Branch`),
        downloadFile: vi.fn(),
        fetchNative: vi.fn(),
        readImage: vi.fn(),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getCurrentChat: vi.fn(() => null),
    setCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    ParseMarkdown: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ shortName: 'test-model' })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: vi.fn(async () => {}),
    findCharacterbyId: vi.fn(() => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

// Stubbed out entirely -- neither is exercised by the editor/identity logic
// under test (see file header).
vi.mock('./ChatBody.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
// Keeps the props `Chat.svelte` mounts the controller with, so a test can
// deliver the controller's `save` event the way the real one does.
const partialEditMount = vi.hoisted(() => ({
    events: null as null | { save?: (event: CustomEvent) => unknown },
}))
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown, props: { $$events?: { save?: (event: CustomEvent) => unknown } }) => {
        partialEditMount.events = props.$$events ?? null
        return { destroy: () => {} }
    },
}))

//#endregion

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { changeChatTo } from 'src/ts/globalApi.svelte'
import Chat from './Chat.svelte'
import BookmarkList from '../Others/BookmarkList.svelte'
import { draftContentOrphanGate } from 'src/ts/draftContentOrphanGate'
import { draftIdentityKey, type MessageIdentity } from 'src/ts/draftContents'
import { chatWindowKey } from 'src/ts/chatWindowPolicy'
import { hasLocalDrafts, hasMessageEditorDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'

//#region fixture helpers

interface FixtureMessage {
    role: string
    data: string
    chatId?: string
}

function makeMessage(data: string, chatId?: string, role = 'char'): FixtureMessage {
    return { role, data, chatId }
}

function baseDb(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        askRemoval: false,
        instantRemove: false,
        translatorType: 'none',
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        requestInfoInsideChat: false,
        clickToEdit: false,
        zoomsize: 100,
        lineHeight: 1.25,
        enableBlockPartialEdit: false,
        enableDragPartialEdit: false,
        useChatCopy: false,
        translator: '',
        swipe: false,
        showFirstMessagePages: false,
        enableBookmark: true,
        createFolderOnBranch: false,
        iconsize: 100,
        memoryLimitThickness: 2,
        theme: 'default',
        guiHTML: '',
        roundIcons: false,
        ...overrides,
    }
}

function makeCharacter(chats: any[], overrides: Partial<Record<string, unknown>> = {}) {
    return {
        chaId: 'char-1',
        type: 'character',
        ttsMode: 'none',
        chatPage: 0,
        chats,
        ...overrides,
    }
}

function makeChat(messages: FixtureMessage[], overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'chat-1',
        message: messages,
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
        ...overrides,
    }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountChat(props: Record<string, unknown> & { isLastMemory: boolean }) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(Chat, { target, props })
    mountedInstances.push(instance)
    flushSync()
    return { target, instance }
}

function mountBookmarks() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(BookmarkList, { target, props: {} })
    mountedInstances.push(instance)
    flushSync()
    return { target, instance }
}

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    draftContentOrphanGate.clear()
    resetLocalDraftsForTest()
    vi.clearAllMocks()
})

beforeEach(() => {
    window.innerWidth = 1024
    // `BookmarkList.svelte` derives its character from the writable
    // `$selectedCharID` store; `Chat.svelte` (mounted standalone or nested
    // inside `BookmarkList`) derives it from `selIdState.selId` instead.
    // Keep both pointed at index 0 for every test.
    selectedCharID.set(0)
})

//#endregion

import { language } from 'src/lang'

function interruptedMessage(data: string): { role: string, data: string, chatId: string, interrupted: true } {
    return { role: 'char', data, chatId: 'chat-id-1', interrupted: true }
}

function liveMessage(): Record<string, unknown> {
    return (DBState.db.characters[0].chats[0].message[0] as unknown) as Record<string, unknown>
}

describe('the interrupted note under a message', () => {
    test('is shown under a message mounted with the flag', () => {
        DBState.db = baseDb() as never
        DBState.db.characters = [makeCharacter([makeChat([interruptedMessage('partial')])])] as never
        selIdState.selId = 0

        const { target } = mountChat({ idx: 0, message: 'partial', isLastMemory: false, interrupted: true })

        const note = target.querySelector('.interrupted-note')
        expect(note).not.toBeNull()
        expect(note!.textContent).toBe(language.messageInterrupted)
    })

    test('guard: is absent from a message mounted without the flag', () => {
        DBState.db = baseDb() as never
        DBState.db.characters = [makeCharacter([makeChat([makeMessage('whole', 'chat-id-1')])])] as never
        selIdState.selId = 0

        const { target } = mountChat({ idx: 0, message: 'whole', isLastMemory: false })

        expect(target.querySelector('.interrupted-note')).toBeNull()
    })

    test('is absent while the message is the optimized streaming message', () => {
        DBState.db = baseDb() as never
        DBState.db.characters = [makeCharacter([makeChat([interruptedMessage('partial')])])] as never
        selIdState.selId = 0

        const { target } = mountChat({ idx: 0, message: 'partial', isLastMemory: false, interrupted: true, isOptimizedStreamingMessage: true })

        expect(target.querySelector('.interrupted-note')).toBeNull()
    })
})

describe('committing an edit removes the flag', () => {
    function commitEdit(target: HTMLElement, text: string | null): void {
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        if (text !== null) {
            const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
            textarea.value = text
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
        }
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
    }

    test('a changed text', () => {
        DBState.db = baseDb() as never
        DBState.db.characters = [makeCharacter([makeChat([interruptedMessage('partial')])])] as never
        selIdState.selId = 0
        const { target } = mountChat({ idx: 0, message: 'partial', isLastMemory: false, interrupted: true })

        commitEdit(target, 'finished by hand')

        expect(liveMessage().data).toBe('finished by hand')
        expect('interrupted' in liveMessage()).toBe(false)
    })

    test('an unchanged text: the person has looked at it', () => {
        DBState.db = baseDb() as never
        DBState.db.characters = [makeCharacter([makeChat([interruptedMessage('partial')])])] as never
        selIdState.selId = 0
        const { target } = mountChat({ idx: 0, message: 'partial', isLastMemory: false, interrupted: true })

        commitEdit(target, null)

        expect(liveMessage().data).toBe('partial')
        expect('interrupted' in liveMessage()).toBe(false)
    })

    describe.each([
        ['a changed text', 'finished by a partial edit'],
        ['an unchanged text', 'partial'],
    ] as const)('a partial edit save of the original text (%s)', (_label, newData) => {
        function mountWithPartialEdit() {
            partialEditMount.events = null
            DBState.db = baseDb({ enableBlockPartialEdit: true }) as never
            DBState.db.characters = [makeCharacter([makeChat([interruptedMessage('partial')])])] as never
            selIdState.selId = 0
            return mountChat({ idx: 0, message: 'partial', isLastMemory: false, interrupted: true })
        }

        test('removes the flag', async () => {
            mountWithPartialEdit()
            expect(partialEditMount.events?.save).toBeTypeOf('function')

            await partialEditMount.events!.save!(new CustomEvent('save', { detail: { newData, target: 'original' } }))
            flushSync()

            expect(liveMessage().data).toBe(newData)
            expect('interrupted' in liveMessage()).toBe(false)
        })
    })

    test('guard: a partial edit save of a translation leaves the flag', async () => {
        DBState.db = baseDb({ enableBlockPartialEdit: true }) as never
        DBState.db.characters = [makeCharacter([makeChat([interruptedMessage('partial')])])] as never
        selIdState.selId = 0
        mountChat({ idx: 0, message: 'partial', isLastMemory: false, interrupted: true })

        await partialEditMount.events!.save!(new CustomEvent('save', { detail: { newData: 'translated', target: 'translation', translationKey: 'key-1' } }))

        expect(liveMessage().data).toBe('partial')
        expect(liveMessage().interrupted).toBe(true)
    })

    test('guard: opening the editor and leaving it without a commit keeps the flag', () => {
        DBState.db = baseDb() as never
        DBState.db.characters = [makeCharacter([makeChat([interruptedMessage('partial')])])] as never
        selIdState.selId = 0
        const { target } = mountChat({ idx: 0, message: 'partial', isLastMemory: false, interrupted: true })

        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        expect(liveMessage().interrupted).toBe(true)
    })
})
