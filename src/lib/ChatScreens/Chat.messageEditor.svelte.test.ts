// @vitest-environment happy-dom

/**
 * Tests for the durable-draft buffer/identity/capture behaviour of the MAIN
 * (original-text) message editor. Scope is `Chat.svelte`'s main editor only
 * -- not the translation editor, not the restore marker, not the multi-tab
 * capture cap.
 *
 * Most of these tests pin buffer/identity/capture behaviour. Four are guards
 * instead -- kept here to pin behaviour that must not regress, independent
 * of whether draft capture exists:
 * - "opening the editor with no matching draft seeds the buffer from the
 *   message prop"
 * - "a draft record whose stored base text no longer matches is not
 *   restored: seeds from message instead"
 * - "mounting fresh with a restore-eligible draft on file does not open the
 *   editor or register liveness"
 * - "a surviving instance that saves after a branch writes into the NEW
 *   chat, not the old one"
 *
 * This mounts the REAL `Chat.svelte` (and, for the BookmarkList repro, the REAL
 * `BookmarkList.svelte`, which mounts `Chat.svelte` itself) against the REAL
 * `src/ts/draftContentOrphanGate.ts` (and the `src/ts/draftContents.ts`
 * store it wraps), `src/ts/localDrafts.ts` and `src/ts/chatWindowPolicy.ts`
 * -- none of those are mocked or modified.
 * Everything else `Chat.svelte`/`BookmarkList.svelte` transitively pull in
 * that is heavy, has side effects, or is irrelevant to the editor/identity
 * logic under test (globalApi.svelte, storage/database.svelte, the parser,
 * the translator, process/* Lua and trigger machinery, TTS, the model list,
 * util's Tauri-backed file pickers, `characters.ts`) is mocked, following
 * the precedent in
 * `src/ts/globalApi.changeChatTo.svelte.test.ts`. `ChatBody.svelte` and
 * `PartialEditController.svelte` are stubbed to trivial components: neither
 * is exercised by the editor/identity logic this file tests (the fixture
 * keeps `enableBlockPartialEdit`/`enableDragPartialEdit` off, so
 * `PartialEditController` never renders even unstubbed; `ChatBody` renders
 * only in the non-edit display path, which these tests don't assert on).
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
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
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

describe('Chat.svelte main editor: identity and seeding', () => {
    // A guard, not a durable-drafts pin: this already holds with no stored
    // draft in play, and must keep holding.
    test('opening the editor with no matching draft seeds the buffer from the message prop', () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })

        const pencil = target.querySelector<HTMLButtonElement>('.button-icon-edit')
        expect(pencil).not.toBeNull()
        pencil!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
        expect(textarea).not.toBeNull()
        expect(textarea!.value).toBe('original text')
    })

    test('opening the editor with a matching draft record seeds from the draft, not the message prop', () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = {
            kind: 'msg',
            chatKey: chatWindowKey('char-1', chat),
            chatId: 'chat-id-1',
            index: 0,
        }
        draftContentOrphanGate.set(identity, 'draft text typed earlier', 'original text')

        const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
        expect(textarea!.value).toBe('draft text typed earlier')
    })

    // A guard: the restore path must never seed from a record whose stored
    // base text no longer matches the current message.
    test('a draft record whose stored base text no longer matches is not restored: seeds from message instead', () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('new text after reroll', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = {
            kind: 'msg',
            chatKey: chatWindowKey('char-1', chat),
            chatId: 'chat-id-1',
            index: 0,
        }
        draftContentOrphanGate.set(identity, 'stale draft', 'old text before reroll')

        const { target } = mountChat({ idx: 0, message: 'new text after reroll', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
        expect(textarea!.value).toBe('new text after reroll')
    })

    test('the identity is frozen at open and never re-derived when the message backfills a chatId mid-edit', async () => {
        DBState.db = baseDb() as never
        const msg = makeMessage('typed but never sent', undefined)
        const chat = makeChat([msg])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const { target } = mountChat({ idx: 0, message: 'typed but never sent', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        textarea.value = 'first keystroke'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        const preBackfillIdentity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: undefined, index: 0 }
        expect(draftContentOrphanGate.get(preBackfillIdentity, 'typed but never sent')).toEqual({
            text: 'first keystroke',
            baseData: 'typed but never sent',
            updatedAt: expect.any(Number),
        })

        // Simulate the Send backfill assigning a chatId to the very message
        // being edited, WHILE the editor stays open (no remount). Mutate
        // through the reactive proxy (`DBState.db...`), not the plain `chat`
        // object -- only a write through the proxy is visible to a
        // component that incorrectly re-reads its identity live instead of
        // using the one frozen at open.
        DBState.db.characters[0].chats[0].message[0].chatId = 'backfilled-id'

        textarea.value = 'second keystroke after backfill'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        // Correct (frozen) behaviour: still filed under the ORIGINAL,
        // index-keyed identity, now holding the latest text.
        expect(draftContentOrphanGate.get(preBackfillIdentity, 'typed but never sent')).toEqual({
            text: 'second keystroke after backfill',
            baseData: 'typed but never sent',
            updatedAt: expect.any(Number),
        })
        // And NOT split off into a freshly-derived chatId-keyed identity --
        // that would be the signature of an identity re-derived on every
        // capture instead of frozen at open.
        const postBackfillIdentity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'backfilled-id', index: 0 }
        expect(draftContentOrphanGate.get(postBackfillIdentity, 'typed but never sent')).toBeUndefined()
    })
})

describe('Chat.svelte main editor: both edit surfaces move to the buffer', () => {
    test('the cardboard theme textarea also decouples from the message prop', async () => {
        DBState.db = baseDb({ theme: 'cardboard' }) as never
        const chat = makeChat([makeMessage('cardboard original', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const { target } = mountChat({ idx: 0, message: 'cardboard original', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!
        expect(textarea.value).toBe('cardboard original')

        textarea.value = 'cardboard typed text'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        // This textarea's own `oninput` calls `captureMessageEdit` with the
        // typed value directly, independent of the `AutoresizeArea` surface
        // tested elsewhere in this file -- this pins that the cardboard
        // theme surface captures drafts too.
        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        expect(draftContentOrphanGate.get(identity, 'cardboard original')).toEqual({
            text: 'cardboard typed text',
            baseData: 'cardboard original',
            updatedAt: expect.any(Number),
        })
    })
})

describe('Chat.svelte main editor: capture and save (baseline)', () => {
    test('typing then saving writes the buffer into message and the DB, and clears the draft record', async () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const { target } = mountChat({ idx: 0, message: 'original', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        textarea.value = 'edited text'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        expect(draftContentOrphanGate.get(identity, 'original')).toEqual({ text: 'edited text', baseData: 'original', updatedAt: expect.any(Number) })

        // Save: click the pencil again (toggleOriginalEdit's save path).
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        // Read back through the reactive proxy (`DBState.db...`), not the
        // plain object `chat` was constructed from -- Svelte's `$state`
        // proxy does not write mutations onto the original raw object.
        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('edited text')
        // Deliberate exit (save) clears the draft. Read with the OLD
        // base ('original', what the record was actually stored under) --
        // not the new post-save base ('edited text'). Reading with the new
        // base would be a mismatched read, which `get()` itself self-deletes
        // on regardless of whether `edit()` itself ever calls `delete()`, so
        // that read alone could never distinguish a real deletion by `edit()`
        // from a merely-mismatched read.
        expect(draftContentOrphanGate.get(identity, 'original')).toBeUndefined()
        // The multi-tab gate's orphan registration must be released too --
        // not just the content record -- confirming `edit()` actually calls
        // through `draftContentOrphanGate.delete()` rather than merely
        // happening to read as gone.
        expect(hasLocalDrafts()).toBe(false)
    })

    test('long-press discard clears the draft record without committing', async () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const { target } = mountChat({ idx: 0, message: 'original', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        textarea.value = 'discard me'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        expect(draftContentOrphanGate.get(identity, 'original')).toEqual({ text: 'discard me', baseData: 'original', updatedAt: expect.any(Number) })

        // handleLongPress on the AutoresizeArea fires after TIME_MS via the
        // `longpress` action's mousedown+timeout; drive it directly through
        // a mousedown then wait past the timer.
        textarea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 550))
        flushSync()

        expect(draftContentOrphanGate.get(identity, 'original')).toBeUndefined()
        // Read back through the reactive proxy (`DBState.db...`), not the
        // plain object `chat` was constructed from -- Svelte's `$state`
        // proxy does not write mutations onto the original raw object (see
        // the save test above), so a read through `chat` could never fail
        // here regardless of whether the discard actually committed.
        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('original')
    })
})

describe('Chat.svelte main editor: capture holds the multi-tab gate after the editor instance goes away', () => {
    test('an involuntary loss of the editor instance unregisters the message-kind liveness but leaves the orphan registration (and the record) in place', async () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const { target, instance } = mountChat({ idx: 0, message: 'original', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        textarea.value = 'typed but never saved'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        // While the editor is open, its own per-instance 'message'-kind
        // registration (`editDraftKey`, unrelated to the content store) is
        // what makes this true.
        expect(hasMessageEditorDrafts()).toBe(true)

        // The editor instance is lost without a deliberate save or discard
        // (e.g. a chat switch tearing the component down mid-edit) --
        // `onDestroy`'s backstop unregisters `editDraftKey`, but nothing
        // here commits or reverts the buffer, so the stored record is left
        // exactly as typed.
        await unmount(instance as never).catch(() => {})

        // The message-kind liveness is gone (nothing suppresses a chat-list
        // window reset here)...
        expect(hasMessageEditorDrafts()).toBe(false)
        // ...but the content store's own orphan registration must still be
        // holding the multi-tab reload gate open, since the record itself
        // was never committed or reverted. On the raw (unwrapped)
        // `draftContents` store this registration never happened in the
        // first place, so this goes false too -- the regression this test
        // pins.
        expect(hasLocalDrafts()).toBe(true)
        // And the record itself -- not just the registration -- must still
        // be there with the typed text, matching this test's own title.
        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        expect(draftContentOrphanGate.get(identity, 'original')).toEqual({
            text: 'typed but never saved',
            baseData: 'original',
            updatedAt: expect.any(Number),
        })
    })
})

describe('Chat.svelte main editor: rehydration never sets editMode', () => {
    // A guard: a mount with no capture wiring at all also never opens the
    // editor, so this already holds; it stays pinned so a future change
    // cannot make a restore-eligible record auto-open the editor.
    test('mounting fresh with a restore-eligible draft on file does not open the editor or register liveness', () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        // A record survives from a prior involuntary unmount, and its base
        // text still matches -- this mount is "restore-eligible".
        draftContentOrphanGate.set(identity, 'recoverable text', 'original text')

        const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })

        // No editor open: no edit textarea in the DOM.
        expect(target.querySelector('.message-edit-area')).toBeNull()
        // No liveness registered either -- the window-policy immunity
        // depends on this.
        expect(hasMessageEditorDrafts()).toBe(false)
        // The record itself must still be there (nothing silently cleared
        // it) -- confirms this really was a restore-eligible mount, not a
        // vacuous one.
        expect(draftContentOrphanGate.get(identity, 'original text')).toEqual({ text: 'recoverable text', baseData: 'original text', updatedAt: expect.any(Number) })
    })
})

describe('Chat.svelte main editor: BookmarkList repro -- typing on one row survives a sibling row being removed', () => {
    test('typing into one expanded bookmark survives a different bookmark being removed, both in the DOM and in the draft record', async () => {
        DBState.db = baseDb() as never
        const msgA = makeMessage('bookmark A original', 'chatid-a')
        const msgB = makeMessage('bookmark B original', 'chatid-b')
        const chat = makeChat([msgA, msgB], { bookmarks: ['chatid-a', 'chatid-b'], bookmarkNames: {} })
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const { target } = mountBookmarks()

        // Expand bookmark A (first row's header). `.rounded-lg` (only the
        // row wrapper has it -- the nested edit textarea also carries
        // `border border-darkborderc` but uses `rounded-md`) keeps this
        // selector from also matching the AutoresizeArea's textarea once the
        // editor is open.
        const rows = Array.from(target.querySelectorAll<HTMLElement>('.border.border-darkborderc.rounded-lg'))
        expect(rows.length).toBe(2)
        const rowAHeader = rows[0].querySelector<HTMLElement>('[role="button"]')!
        rowAHeader.click()
        flushSync()

        const pencilA = rows[0].querySelector<HTMLButtonElement>('.button-icon-edit')
        expect(pencilA).not.toBeNull()
        pencilA!.click()
        flushSync()

        const textareaA = rows[0].querySelector<HTMLTextAreaElement>('.message-edit-area')!
        expect(textareaA.value).toBe('bookmark A original')
        textareaA.value = 'bookmark A TYPED'
        textareaA.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        const identityA: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chatid-a', index: 0 }
        // Captured already, before B is touched at all.
        expect(draftContentOrphanGate.get(identityA, 'bookmark A original')).toEqual({
            text: 'bookmark A TYPED',
            baseData: 'bookmark A original',
            updatedAt: expect.any(Number),
        })

        // Remove bookmark B -- a DIFFERENT bookmark's trash icon. This
        // causes `bookmarkedMessages` to recompute and mints a fresh item
        // object for A's surviving keyed block (same `chatId` key). This is a
        // survive-and-reuse event, not a destroy/remount.
        const trashB = rows[1].querySelector<HTMLButtonElement>('.hover\\:text-red-500')!
        trashB.click()
        flushSync()
        await tick()

        // A's row is still there (survived), and its buffer/textarea must
        // still show the typed text, not a reversion to the original.
        const rowsAfter = Array.from(target.querySelectorAll<HTMLElement>('.border.border-darkborderc.rounded-lg'))
        expect(rowsAfter.length).toBe(1)
        const textareaAAfter = rowsAfter[0].querySelector<HTMLTextAreaElement>('.message-edit-area')!
        expect(textareaAAfter.value).toBe('bookmark A TYPED')

        // And the draft record must still hold the typed text. If A's row
        // being reused (rather than destroyed and remounted) had corrupted
        // its buffer, the DOM check just above (`textareaAAfter.value`)
        // would already have failed; this additionally confirms the typed
        // text made it into the persisted draft, not just the visible
        // textarea.
        expect(draftContentOrphanGate.get(identityA, 'bookmark A original')).toEqual({
            text: 'bookmark A TYPED',
            baseData: 'bookmark A original',
            updatedAt: expect.any(Number),
        })
    })
})

describe('Chat.svelte main editor: pin -- edit() reads chatPage live, not frozen', () => {
    // A guard: `edit()` must keep reading chatPage live, not frozen, so a
    // future change cannot introduce cross-chat data loss by writing into
    // the wrong chat page.
    test('a surviving instance that saves after a branch writes into the NEW chat, not the old one', async () => {
        DBState.db = baseDb({ useChatCopy: false }) as never
        // The chat being edited starts at page 1 (NOT 0) -- deliberately, so
        // that a frozen-at-open chatPage (1) and the live chatPage after the
        // branch (0) actually diverge. If editing started at page 0, freezing
        // 0 and reading 0 live would be indistinguishable, and a component
        // that reads chatPage live would be indistinguishable from one that
        // freezes it at open.
        const decoyChat = makeChat([makeMessage('unrelated decoy', 'decoy-id')], { id: 'chat-decoy' })
        const originalChat = makeChat([makeMessage('shared base', 'shared-chat-id')], { id: 'chat-original', name: 'Original' })
        DBState.db.characters = [makeCharacter([decoyChat, originalChat], { chatPage: 1 })] as never
        selIdState.selId = 0

        const { target } = mountChat({ idx: 0, message: 'shared base', isLastMemory: false })

        // Open the editor and type -- this instance will survive the branch
        // below (production reuses it because branch/copy build the new chat
        // via `$state.snapshot`, preserving message hashes; this test
        // exercises `edit()`'s own save-path behaviour directly, which is
        // what this pin is about).
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        textarea.value = 'saved after branch'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        // Perform a copy-style chat switch: unshift a new chat (a snapshot-like
        // clone sharing the message's chatId) at the FRONT and changeChatTo(0),
        // as the chat list's Copy does (Branch keeps one chat). This shifts
        // `decoyChat` from index 0 to index 1 -- the frozen-at-open page
        // number -- so a frozen read lands squarely on it.
        const branchedChat = makeChat(
            [{ ...originalChat.message[0] }],
            { id: 'chat-branch' }
        )
        const chara = DBState.db.characters[0] as any
        chara.chats.unshift(branchedChat)
        changeChatTo(0)
        flushSync()

        expect(chara.chatPage).toBe(0)
        expect(chara.chats[1].id).toBe('chat-decoy')

        // Save: click the pencil again.
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        // Correct (live chatPage read): the NEW chat, now at page 0, gets
        // the save.
        expect(chara.chats[0].message[0].data).toBe('saved after branch')
        // The decoy chat, now at index 1 (the FROZEN-at-open page number),
        // must be untouched -- a frozen `chatPage` would have written here
        // instead, and being an unrelated "background" chat now, that would
        // be exactly the silent cross-chat data loss this pin guards against.
        expect(chara.chats[1].message[0].data).toBe('unrelated decoy')
        // The original chat itself, now at index 2, is untouched either way.
        expect(chara.chats[2].message[0].data).toBe('shared base')
    })
})
