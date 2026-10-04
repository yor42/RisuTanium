// @vitest-environment happy-dom

/**
 * Tests for MC-068 -- the restore marker and one-click revert -- plus the
 * translation editor's capture wiring.
 *
 * Kept as a SIBLING file to `Chat.messageEditor.svelte.test.ts` rather than
 * an extension of it: that file is already large and scoped to the main
 * editor's own identity-and-seeding behaviour. This file adds a materially
 * different surface (the translation editor, its own mocked
 * `getLLMCache`/`setLLMCache` return values varied per test) on top of the
 * marker/revert affordance, so folding it into the existing file would both
 * bloat it and force per-test overrides of a shared default mock that the
 * existing tests rely on staying put. The module-mock block below is
 * intentionally duplicated from that file (vi.mock factories are hoisted
 * per-file in Vitest and cannot be shared across files) rather than
 * extracted, to keep each test file's fixture self-contained and honest
 * about what it mocks.
 *
 * Mounts the REAL `Chat.svelte` against the REAL `src/ts/draftContentOrphanGate.ts`
 * (and the `src/ts/draftContents.ts` store it wraps) and `src/ts/localDrafts.ts`.
 * Everything heavy, side-effecting, or irrelevant to the marker/capture logic
 * under test is mocked, following the same precedent as
 * `Chat.messageEditor.svelte.test.ts`.
 *
 * Most of these tests exercise the marker, the revert affordance, and the
 * translation editor's capture. Six are guards rather than feature pins --
 * each holds independent of whether the marker/capture logic exists, so a
 * future change can't regress the behaviour each one checks:
 * - "no stored draft at all: no marker": holds regardless, since with no
 *   stored draft to seed from, there is nothing to render a marker for.
 * - "the record's updatedAt is unchanged by merely opening the editor on it"
 *   (main editor): holds regardless, since the editor's own record lookup
 *   never calls the store's write path, so nothing re-stamps `updatedAt`.
 * - both "restore, type away ... type back" tests (main editor, and the
 *   through-the-base-text variant): each test's final buffer value equals
 *   the text the record already held before mounting, so the assertion
 *   holds independent of whether typing is captured to the store during the
 *   test.
 * - "a tr: record never seeds the main (original-text) editor": holds
 *   regardless, since the main editor's own lookup only ever queries a
 *   `msg:`-kind identity, which a `tr:` record can never match.
 * - "a msg: record never seeds the translation editor": holds regardless,
 *   since the translation editor's own lookup only ever queries a `tr:`-kind
 *   identity, which a `msg:` record can never match.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks (duplicated from Chat.messageEditor.svelte.test.ts -- see file header)

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
    alertError: vi.fn(),
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

vi.mock('./ChatBody.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
const partialEditProps = vi.hoisted(() => ({ current: null as null | { $$events?: { save?: (e: CustomEvent) => unknown } } }))
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown, props: { $$events?: { save?: (e: CustomEvent) => unknown } }) => {
        partialEditProps.current = props
        return { destroy: () => {} }
    },
}))

//#endregion

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import Chat from './Chat.svelte'
import { draftContentOrphanGate } from 'src/ts/draftContentOrphanGate'
import { type MessageIdentity, type TranslationIdentity } from 'src/ts/draftContents'
import { chatWindowKey } from 'src/ts/chatWindowPolicy'
import { hasLocalDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'
import { language } from '../../lang'
import { getLLMCache, setLLMCache } from 'src/ts/translator/translator'
import { alertError } from 'src/ts/alert'
import { formatDraftAge } from 'src/ts/draftAge'
import { ParseMarkdown } from 'src/ts/parser/parser.svelte'

//#region fixture helpers (see Chat.messageEditor.svelte.test.ts for the identical originals)

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

async function unmountFixture(fixture: { target: HTMLElement; instance: unknown }) {
    await unmount(fixture.instance as never).catch(() => {})
    const instanceIdx = mountedInstances.indexOf(fixture.instance)
    if (instanceIdx >= 0) {
        mountedInstances.splice(instanceIdx, 1)
    }
    const targetIdx = mountedTargets.indexOf(fixture.target)
    if (targetIdx >= 0) {
        mountedTargets.splice(targetIdx, 1)
    }
}

function findButtonByText(target: HTMLElement, text: string): HTMLButtonElement {
    const btn = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
    if (!btn) {
        throw new Error(`no button found containing text: ${text}`)
    }
    return btn
}

function findRevertButton(target: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(language.draftRevert))
}

async function typeInto(target: HTMLElement, value: string) {
    const ta = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
    ta.value = value
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    await tick()
}

// A failed translation write is reported through `alertError` by the call
// sites in `Chat.svelte`, so no rejection may reach the process unhandled.
// This runs `fn` with its own 'unhandledRejection' listener registered
// (Node escalates an unhandled rejection to an uncaught exception when no
// listener exists) and fails if any rejection was reported meanwhile.
async function expectNoUnhandledRejections<T>(fn: () => Promise<T>): Promise<T> {
    const seen: unknown[] = []
    const listener = (reason: unknown) => { seen.push(reason) }
    process.on('unhandledRejection', listener)
    let result: T
    try {
        result = await fn()
    } finally {
        process.off('unhandledRejection', listener)
    }
    expect(seen).toEqual([])
    return result
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
    vi.useRealTimers()
})

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
})

//#endregion

describe('Chat.svelte main editor: the restore marker (MC-068)', () => {
    test('a draft whose text differs from the base text opens with the marker shown, naming the draft age', () => {
        vi.useFakeTimers()
        const openedAt = 1_700_000_000_000
        vi.setSystemTime(openedAt)

        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(identity, 'draft text typed earlier', 'original text')

        // 12 minutes pass with the editor still closed, then it is opened.
        const restoredAt = openedAt + 12 * 60_000
        vi.setSystemTime(restoredAt)

        const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const status = target.querySelector('[role="status"]')
        expect(status).not.toBeNull()
        expect(status!.textContent).toContain(language.draftRestored)

        // MC-068: the marker must also name how long ago the draft is
        // from. `formatDraftAge` is pure (see draftAge.test.ts), so the
        // expected string is computed with the very same function, the same
        // (updatedAt, now) pair the record/system clock establish, and the
        // same `DBState.db.language` read the component itself uses -- not
        // hardcoded English. This depends on `createDraftContentStore`'s
        // `now` being late-bound rather than a captured `Date.now` reference,
        // so `vi.setSystemTime` above actually reaches the singleton store's
        // own stamping.
        const expectedAge = formatDraftAge(openedAt, restoredAt, DBState.db.language ?? '')
        expect(status!.textContent).toContain(expectedAge)

        const revertButton = findRevertButton(target)
        expect(revertButton).toBeTruthy()
        expect(revertButton!.getAttribute('type')).toBe('button')
    })

    test('a draft whose text equals the current base text is not a restore: it is deleted, and the editor opens with no marker (MC-068)', () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        // This exact state (baseData === current message text, AND
        // record.text === that same text) never arises from live editing of
        // a msg: record -- the app only ever offers a stored record back
        // when its text differs from the current message (MC-068). This
        // is a defensive read-time check (`startOriginalEdit`'s own
        // `isDraftRestore` test) for a state reachable only by writing
        // directly to the store, as this test does, not by any live editing
        // sequence. It is exercised here anyway because the defense should
        // hold regardless of how such a record got there.
        draftContentOrphanGate.set(identity, 'original text', 'original text')

        const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        expect(target.querySelector('[role="status"]')).toBeNull()
        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        expect(textarea.value).toBe('original text')
        // The record must actually be gone, not merely hidden.
        expect(draftContentOrphanGate.get(identity, 'original text')).toBeUndefined()
    })

    test('no stored draft at all: no marker', () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        expect(target.querySelector('[role="status"]')).toBeNull()
    })
})

describe('Chat.svelte main editor: opening a restored draft without typing does not touch its updatedAt', () => {
    test('the record\'s updatedAt is unchanged by merely opening the editor on it -- no typing since', async () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(identity, 'draft text typed earlier', 'original text')
        const original = draftContentOrphanGate.get(identity, 'original text')
        const originalUpdatedAt = original?.updatedAt
        expect(typeof originalUpdatedAt).toBe('number')

        // Real wall-clock time passes before the editor opens (no fake
        // timers active in this test, so the store's late-bound `now()`
        // reads the real clock here) -- if merely opening the editor
        // re-stamps the record, `updatedAt` will visibly have moved forward
        // by at least this much.
        await new Promise((r) => setTimeout(r, 20))

        const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        await tick()

        // Opening the editor on an already-restored draft must not re-stamp
        // `updatedAt` -- only a user edit advances it; opening never does.
        // Otherwise the marker's age would reset to "just now" on every
        // reopen of an untouched draft.
        const afterOpen = draftContentOrphanGate.get(identity, 'original text')
        expect(afterOpen?.updatedAt).toBe(originalUpdatedAt)
    })
})

describe('Chat.svelte translation editor: opening a restored draft without typing does not touch its updatedAt (translation twin of the main-editor test above)', () => {
    test('the record\'s updatedAt is unchanged by merely opening the translation editor on it -- no typing since', async () => {
        const messageText = 'source text for translation'
        DBState.db = baseDb({ translatorType: 'llm', translator: 'dummy-translator' }) as never
        const chat = makeChat([makeMessage(messageText, 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }
        draftContentOrphanGate.set(trIdentity, 'typed translation draft', messageText)
        const original = draftContentOrphanGate.get(trIdentity, messageText)
        const originalUpdatedAt = original?.updatedAt
        expect(typeof originalUpdatedAt).toBe('number')

        // Real wall-clock time passes before the editor opens, same as the
        // main-editor version of this test above.
        await new Promise((r) => setTimeout(r, 20))

        // Cached translation differs from the stored draft, so this is a
        // genuine restore (isDraftRestore(record, seed) is true).
        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        findButtonByText(target, language.editTranslation).click()
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelector<HTMLTextAreaElement>('.message-edit-area')?.value).toBe('typed translation draft')
        })

        // The translation editor must not re-stamp `updatedAt` on open
        // either -- same guarantee as the main editor's above, pinned
        // separately here since it is a second, independent surface.
        const afterOpen = draftContentOrphanGate.get(trIdentity, messageText)
        expect(afterOpen?.updatedAt).toBe(originalUpdatedAt)
    })
})

describe('Chat.svelte main editor: the record reflects the latest typed content, even when it returns to the text the editor opened with', () => {
    test('restore, type away from it, type back to the restored text, involuntary unmount: the stored draft is the latest buffer content', async () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0
        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(identity, 'draft1', 'original text')

        const fx = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        fx.target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        await typeInto(fx.target, 'draft1x')
        await typeInto(fx.target, 'draft1')
        expect(fx.target.querySelector<HTMLTextAreaElement>('.message-edit-area')!.value).toBe('draft1')

        await unmountFixture(fx)

        // The buffer went draft1 (the text the editor opened with) -> draft1x
        // (typed) -> draft1 (typed back to the same value). The record must
        // reflect the actual latest content, `draft1`, not get stuck holding
        // `draft1x` merely because the buffer's final value happens to equal
        // what the editor opened with.
        expect(draftContentOrphanGate.get(identity, 'original text')?.text).toBe('draft1')
    })

    test('restore, edit the buffer through the base text (record deleted) and back to the restored text, unmount: the draft survives', async () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0
        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(identity, 'draft1', 'original text')

        const fx = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        fx.target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        // Passing through the base text deletes the record outright (the
        // equals-base guard, unrelated to this test) -- typing back to the
        // restored text afterward must re-create it rather than leave it
        // deleted.
        await typeInto(fx.target, 'original text')
        await typeInto(fx.target, 'draft1')

        await unmountFixture(fx)

        expect(draftContentOrphanGate.get(identity, 'original text')?.text).toBe('draft1')
    })

    test('translation editor: the same restore / type-away / type-back sequence', async () => {
        const messageText = 'source text for translation'
        DBState.db = baseDb({ translatorType: 'llm', translator: 'dummy-translator' }) as never
        const chat = makeChat([makeMessage(messageText, 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0
        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }
        draftContentOrphanGate.set(trIdentity, 'tdraft', messageText)

        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const fx = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        fx.target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        findButtonByText(fx.target, language.editTranslation).click()
        await vi.waitFor(() => {
            flushSync()
            expect(fx.target.querySelector<HTMLTextAreaElement>('.message-edit-area')?.value).toBe('tdraft')
        })

        await typeInto(fx.target, 'tdraftx')
        await typeInto(fx.target, 'tdraft')

        await unmountFixture(fx)

        expect(draftContentOrphanGate.get(trIdentity, messageText)?.text).toBe('tdraft')
    })
})

describe('Chat.svelte translation editor: two overlapping failing saves must not leave capture permanently off', () => {
    test('after both overlapping saves reject, typing is still captured', async () => {
        const messageText = 'source text for translation'
        DBState.db = baseDb({ translatorType: 'llm', translator: 'dummy-translator' }) as never
        const chat = makeChat([makeMessage(messageText, 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0
        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }

        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        findButtonByText(target, language.editTranslation).click()
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelector<HTMLTextAreaElement>('.message-edit-area')?.value).toBe('cached translation')
        })

        await typeInto(target, 'typed 1')
        expect(draftContentOrphanGate.get(trIdentity, messageText)?.text).toBe('typed 1')

        // Both Save clicks fire before either settles. Neither rejection may
        // leave typing uncaptured afterward: the editor must still be open
        // under the same identity once both have landed.
        const slowReject = () => new Promise<void>((_, rej) => setTimeout(() => rej(new Error('quota')), 5))
        vi.mocked(setLLMCache).mockImplementationOnce(slowReject).mockImplementationOnce(slowReject)

        await expectNoUnhandledRejections(async () => {
            const save = findButtonByText(target, language.editTranslationSave)
            save.click()
            save.click()
            await new Promise((r) => setTimeout(r, 40))
            flushSync()
        })
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(2)

        // Neither failed save is a deliberate exit -- the editor must still
        // be open.
        expect(target.querySelector<HTMLTextAreaElement>('.message-edit-area')).not.toBeNull()

        await typeInto(target, 'typed after two failed saves')
        expect(draftContentOrphanGate.get(trIdentity, messageText)?.text).toBe('typed after two failed saves')
    })
})

describe('Chat.svelte: markerOnLightSurface applies the same light palette to mobilechat as to cardboard, differing from the default theme', () => {
    test('the main-editor marker\'s class list matches between mobilechat and cardboard, and differs from the default theme', () => {
        function markerClassFor(theme: string): string {
            DBState.db = baseDb({ theme, clickToEdit: theme === 'mobilechat' }) as never
            const chat = makeChat([makeMessage('original text', 'chat-id-1')])
            DBState.db.characters = [makeCharacter([chat])] as never
            selIdState.selId = 0
            const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
            draftContentOrphanGate.set(identity, 'draft text typed earlier', 'original text')

            const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
            if (theme === 'mobilechat') {
                // The mobilechat layout renders no pencil button -- editing
                // is entered by clicking the message body itself, gated on
                // `clickToEdit` (see `Chat.svelte`'s display-span `onclick`).
                target.querySelector<HTMLElement>('.chattext')!.click()
            } else {
                target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
            }
            flushSync()

            const status = target.querySelector('[role="status"]')
            expect(status).not.toBeNull()
            const cls = status!.getAttribute('class')!
            draftContentOrphanGate.clear()
            return cls
        }

        // cardboard's own main-editor marker hardcodes its `lightSurface`
        // argument to `true` directly at its call site (it never reads
        // `markerOnLightSurface`), so it is an independent reference point:
        // if `markerOnLightSurface` were hardcoded to `false`, mobilechat's
        // rendered class would flip to the dark variant while cardboard's
        // stayed light, and the first assertion below would fail. The same
        // mutation would also make mobilechat equal the (unaffected, still
        // dark) default theme, failing the second assertion too.
        const mobilechatClass = markerClassFor('mobilechat')
        const cardboardClass = markerClassFor('cardboard')
        const defaultClass = markerClassFor('default')

        expect(mobilechatClass).toBe(cardboardClass)
        expect(mobilechatClass).not.toBe(defaultClass)
    })
})

describe('Chat.svelte main editor: revert', () => {
    test('clicking Revert replaces the buffer with the message text, deletes the record, and hides the marker -- the editor stays open', () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(identity, 'draft text typed earlier', 'original text')

        const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const revertButton = findRevertButton(target)!
        revertButton.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
        expect(textarea).not.toBeNull() // still open
        expect(textarea!.value).toBe('original text')
        expect(target.querySelector('[role="status"]')).toBeNull()
        expect(draftContentOrphanGate.get(identity, 'original text')).toBeUndefined()
    })

    test('after a revert, reopening the editor (a fresh mount) is not offered the rejected draft again', () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(identity, 'draft text typed earlier', 'original text')

        const first = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        first.target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        findRevertButton(first.target)!.click()
        flushSync()

        const second = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        second.target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        expect(second.target.querySelector('[role="status"]')).toBeNull()
        const textarea = second.target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        expect(textarea.value).toBe('original text')
    })
})

describe('Chat.svelte main editor: the marker on the cardboard theme surface (both surfaces)', () => {
    test('the cardboard raw textarea also shows the marker with the draft age', () => {
        vi.useFakeTimers()
        const openedAt = 1_700_000_000_000
        vi.setSystemTime(openedAt)

        DBState.db = baseDb({ theme: 'cardboard' }) as never
        const chat = makeChat([makeMessage('cardboard original', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(identity, 'cardboard draft typed earlier', 'cardboard original')
        const restoredAt = openedAt + 5 * 60_000
        vi.setSystemTime(restoredAt)

        const { target } = mountChat({ idx: 0, message: 'cardboard original', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')
        expect(textarea).not.toBeNull()
        expect(textarea!.value).toBe('cardboard draft typed earlier')

        const status = target.querySelector('[role="status"]')
        expect(status).not.toBeNull()
        expect(status!.textContent).toContain(language.draftRestored)

        // Same late-bound-`now()` dependency as the default-theme marker
        // test above -- see that test's comment.
        const expectedAge = formatDraftAge(openedAt, restoredAt, DBState.db.language ?? '')
        expect(status!.textContent).toContain(expectedAge)
    })

    test('reverting on the cardboard surface deletes the record, and a fresh mount is not offered it again', () => {
        DBState.db = baseDb({ theme: 'cardboard' }) as never
        const chat = makeChat([makeMessage('cardboard original', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(identity, 'cardboard draft typed earlier', 'cardboard original')

        const first = mountChat({ idx: 0, message: 'cardboard original', isLastMemory: false })
        first.target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        findRevertButton(first.target)!.click()
        flushSync()

        const textarea = first.target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!
        expect(textarea.value).toBe('cardboard original')
        expect(first.target.querySelector('[role="status"]')).toBeNull()

        const second = mountChat({ idx: 0, message: 'cardboard original', isLastMemory: false })
        second.target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        expect(second.target.querySelector('[role="status"]')).toBeNull()
        expect(second.target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!.value).toBe('cardboard original')
    })
})

describe('Chat.svelte main editor: deliberate exits hide the marker (save and long-press discard)', () => {
    test('saving clears the draft, so a later reopen shows no marker', async () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(identity, 'draft text typed earlier', 'original text')

        const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click() // open: seeds + marker
        flushSync()
        expect(target.querySelector('[role="status"]')).not.toBeNull()

        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click() // save
        flushSync()
        await tick()

        // Read with the OLD base ('original text', what the record was
        // actually filed under) -- not the post-save message text. A read
        // with the new base is a mismatched read, which `get()` itself
        // self-deletes on regardless of whether `edit()` itself ever calls
        // `delete()`, so that read alone could never distinguish a real
        // deletion by `edit()` from a merely-mismatched read -- and so would
        // a fresh mount's own `startOriginalEdit()` seeding check below --
        // its `message` prop is already the NEW text, so that seeding read
        // would also mismatch-and-self-delete independent of `edit()`.
        expect(draftContentOrphanGate.get(identity, 'original text')).toBeUndefined()
        // The multi-tab gate's orphan registration must be released too.
        expect(hasLocalDrafts()).toBe(false)

        const reopened = mountChat({ idx: 0, message: 'draft text typed earlier', isLastMemory: false })
        reopened.target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        expect(reopened.target.querySelector('[role="status"]')).toBeNull()
    })

    test('a long-press discard clears the draft, so a later reopen shows no marker', async () => {
        DBState.db = baseDb() as never
        const chat = makeChat([makeMessage('original text', 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(identity, 'draft text typed earlier', 'original text')

        const { target } = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click() // open: seeds + marker
        flushSync()
        expect(target.querySelector('[role="status"]')).not.toBeNull()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        textarea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 550))
        flushSync()

        const reopened = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        reopened.target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        expect(reopened.target.querySelector('[role="status"]')).toBeNull()
    })
})

describe('Chat.svelte translation editor: capture, marker and revert', () => {
    function setUpTranslatable(messageText: string) {
        DBState.db = baseDb({ translatorType: 'llm', translator: 'dummy-translator' }) as never
        const chat = makeChat([makeMessage(messageText, 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0
        return chat
    }

    function openTranslationEditor(target: HTMLElement) {
        // The translate TOGGLE button (`.button-icon-translate`, inside the
        // `translationButton` snippet) is rendered via `{@render
        // translationButton()}` with no args, so its `showNames` parameter
        // defaults to false and it never gets a text label in this layout --
        // it must be found by class, not by text. The Edit/Save Translation
        // button below it, by contrast, lives in the separate `genInfo()`
        // snippet and renders its label unconditionally, so text lookup
        // works for it.
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        findButtonByText(target, language.editTranslation).click()
    }

    test('typing survives an involuntary unmount, and reopening shows the draft seeded with the marker', async () => {
        const messageText = 'source text for translation'
        setUpTranslatable(messageText)
        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }

        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const first = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(first.target)
        await vi.waitFor(() => {
            flushSync()
            const ta = first.target.querySelector<HTMLTextAreaElement>('.message-edit-area')
            expect(ta?.value).toBe('cached translation')
        })
        expect(first.target.querySelector('[role="status"]')).toBeNull()

        const textarea = first.target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        textarea.value = 'typed translation draft'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        await unmountFixture(first)

        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const second = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(second.target)
        await vi.waitFor(() => {
            flushSync()
            const ta = second.target.querySelector<HTMLTextAreaElement>('.message-edit-area')
            expect(ta?.value).toBe('typed translation draft')
        })

        const status = second.target.querySelector('[role="status"]')
        expect(status).not.toBeNull()
        expect(status!.textContent).toContain(language.draftRestored)

        // The identity must be namespaced under 'tr', not collide with a
        // 'msg' identity built from the same raw chat/index.
        expect(draftContentOrphanGate.get(trIdentity, messageText)).toEqual({
            text: 'typed translation draft',
            baseData: messageText,
            updatedAt: expect.any(Number),
        })
    })

    test('opening the translation editor stores the parsed tr: key as baseData, not the raw message text, and restores from it on a later open', async () => {
        const messageText = 'raw message text, never used as a key'
        const parsedKey = `parsed::${messageText}`
        setUpTranslatable(messageText)

        // `ParseMarkdown` is an identity mock everywhere else in this file
        // (module-level default: `vi.fn(async (text) => text)`), which makes
        // the tr: key equal the raw message text -- exactly the coincidence
        // that would let a bug (comparing the stored record's baseData
        // against `message` instead of the parsed key, on either the initial
        // capture or a later restore) pass every other test in this file
        // undetected. Overriding it for both calls this test makes
        // (`getTranslationCacheKey()`, from `loadTranslationForEdit()`, the
        // only ParseMarkdown call before the identity/baseData are frozen --
        // once per open, so once per mount below) makes the key provably
        // different from the message text on both opens.
        vi.mocked(ParseMarkdown).mockImplementationOnce(async () => parsedKey).mockImplementationOnce(async () => parsedKey)
        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')

        const first = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(first.target)
        await vi.waitFor(() => {
            flushSync()
            const ta = first.target.querySelector<HTMLTextAreaElement>('.message-edit-area')
            expect(ta?.value).toBe('cached translation')
        })

        const textarea = first.target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        textarea.value = 'typed translation draft'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        const trIdentity: TranslationIdentity = { kind: 'tr', key: parsedKey }
        const record = draftContentOrphanGate.get(trIdentity, parsedKey)
        expect(record?.baseData).toBe(parsedKey)
        expect(record?.baseData).not.toBe(messageText)

        await unmountFixture(first)

        // Reopening (a fresh mount, the same non-identity parse) must offer
        // the typed draft back, not the freshly re-fetched cached
        // translation. Comparing the stored record against the raw message
        // text instead of the parsed key would mismatch here (`key` and
        // `message` are provably different in this test), silently deleting
        // the record and disabling the restore -- exactly the failure mode
        // that stays invisible everywhere else in this file, where the two
        // happen to be equal.
        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const second = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(second.target)
        await vi.waitFor(() => {
            flushSync()
            const ta = second.target.querySelector<HTMLTextAreaElement>('.message-edit-area')
            expect(ta?.value).toBe('typed translation draft')
        })

        const status = second.target.querySelector('[role="status"]')
        expect(status).not.toBeNull()
        expect(status!.textContent).toContain(language.draftRestored)
    })

    test('a translation draft whose text equals the cached translation is not a restore (MC-068 applied to the tr editor): deleted, seeded from cache, no marker', async () => {
        const messageText = 'source text for translation'
        setUpTranslatable(messageText)
        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }
        // Unlike the msg: equivalent of this check (see the main editor's
        // "equals the current base text" test above), this state IS
        // reachable by the live app, not only by writing directly to the
        // store as this test does: baseData (the source-text key) and the
        // seed compared here (the CACHED TRANSLATION) are independent axes
        // for a tr: record. A user can draft translation D, close
        // without saving (record: text=D, baseData=key K), and then a
        // RETRANSLATE for that same source text can update the cache for K
        // to a new value that happens to equal D -- baseData is untouched
        // (still K), so the record survives the read, but it is no longer a
        // meaningful "restore" once the cache already agrees with it.
        draftContentOrphanGate.set(trIdentity, 'cached translation', messageText)

        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(target)
        await vi.waitFor(() => {
            flushSync()
            const ta = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
            expect(ta?.value).toBe('cached translation')
        })

        expect(target.querySelector('[role="status"]')).toBeNull()
        expect(draftContentOrphanGate.get(trIdentity, messageText)).toBeUndefined()
    })

    test('revert restores the cached translation seeded at open (not baseData/key), deletes the record, hides the marker, and keeps the editor open', async () => {
        const messageText = 'source text for translation'
        setUpTranslatable(messageText)
        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }
        draftContentOrphanGate.set(trIdentity, 'typed translation draft', messageText)

        vi.mocked(getLLMCache).mockResolvedValueOnce('previously cached translation')
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(target)
        await vi.waitFor(() => {
            flushSync()
            const ta = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
            expect(ta?.value).toBe('typed translation draft')
        })
        expect(target.querySelector('[role="status"]')).not.toBeNull()

        findRevertButton(target)!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
        expect(textarea).not.toBeNull() // editor stays open
        // The value seeded from the cache at open time, NOT `messageText`
        // (which is baseData/the key) and NOT the rejected draft.
        expect(textarea!.value).toBe('previously cached translation')
        expect(target.querySelector('[role="status"]')).toBeNull()
        expect(draftContentOrphanGate.get(trIdentity, messageText)).toBeUndefined()
    })

    test('saving the translation edit via the Save button deletes the record', async () => {
        const messageText = 'source text for translation'
        setUpTranslatable(messageText)
        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }
        draftContentOrphanGate.set(trIdentity, 'typed translation draft', messageText)

        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(target)
        await vi.waitFor(() => {
            flushSync()
            const ta = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
            expect(ta?.value).toBe('typed translation draft')
        })

        findButtonByText(target, language.editTranslationSave).click()
        // Waits on the record's actual deletion, not merely on `setLLMCache`
        // having been called: the record is only deleted after
        // `updateTranslationCache`'s await settles, so a rejection must leave
        // it intact, and that delete lands in a later microtask than the call
        // itself -- polling the call alone would race ahead of the deletion.
        await vi.waitFor(() => {
            flushSync()
            expect(draftContentOrphanGate.get(trIdentity, messageText)).toBeUndefined()
        })
        expect(vi.mocked(setLLMCache)).toHaveBeenCalledWith(messageText, 'typed translation draft')
    })

    test('saving the translation edit via long-press also deletes the record', async () => {
        const messageText = 'source text for translation'
        setUpTranslatable(messageText)
        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }
        draftContentOrphanGate.set(trIdentity, 'typed translation draft', messageText)

        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(target)
        await vi.waitFor(() => {
            flushSync()
            const ta = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
            expect(ta?.value).toBe('typed translation draft')
        })

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        textarea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 550))
        flushSync()

        // Same reasoning as the Save-button test above: wait on the record's
        // actual deletion, not merely on the `setLLMCache` call.
        await vi.waitFor(() => {
            flushSync()
            expect(draftContentOrphanGate.get(trIdentity, messageText)).toBeUndefined()
        })
        expect(vi.mocked(setLLMCache)).toHaveBeenCalledWith(messageText, 'typed translation draft')
    })

    test('a rejecting setLLMCache does not delete the draft record, and typing after the failed save is still captured', async () => {
        const messageText = 'source text for translation'
        setUpTranslatable(messageText)
        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }
        draftContentOrphanGate.set(trIdentity, 'typed translation draft', messageText)

        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(target)
        await vi.waitFor(() => {
            flushSync()
            const ta = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
            expect(ta?.value).toBe('typed translation draft')
        })

        vi.mocked(setLLMCache).mockRejectedValueOnce(new Error('network down'))

        // `saveTranslationEdit` propagates a failed save to its caller; the
        // Save button reports it once through `alertError` and leaves the
        // editor as it was.
        await expectNoUnhandledRejections(async () => {
            findButtonByText(target, language.editTranslationSave).click()
            await new Promise((r) => setTimeout(r, 20))
            flushSync()
        })
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toEqual(new Error('network down'))

        // A failed save is not a deliberate exit: the record must survive,
        // and the identity capture writes under must stay the one already in
        // place.
        expect(draftContentOrphanGate.get(trIdentity, messageText)).toEqual({
            text: 'typed translation draft',
            baseData: messageText,
            updatedAt: expect.any(Number),
        })

        // Typing after the failed save must still be captured under the same
        // frozen identity.
        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        textarea.value = 'typed again after the failed save'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await tick()

        expect(draftContentOrphanGate.get(trIdentity, messageText)?.text).toBe('typed again after the failed save')
    })

    test('a rejecting setLLMCache on a long-press save is reported once, keeps the editor open with the typed text and the record, and a retry closes it', async () => {
        const messageText = 'source text for translation'
        setUpTranslatable(messageText)
        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }
        draftContentOrphanGate.set(trIdentity, 'typed translation draft', messageText)

        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(target)
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelector<HTMLTextAreaElement>('.message-edit-area')?.value).toBe('typed translation draft')
        })

        vi.mocked(setLLMCache).mockRejectedValueOnce(new Error('quota'))
        await expectNoUnhandledRejections(async () => {
            const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
            textarea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
            await new Promise((r) => setTimeout(r, 550))
            flushSync()
        })

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toEqual(new Error('quota'))
        expect(target.querySelector<HTMLTextAreaElement>('.message-edit-area')?.value).toBe('typed translation draft')
        expect(draftContentOrphanGate.get(trIdentity, messageText)?.text).toBe('typed translation draft')

        findButtonByText(target, language.editTranslationSave).click()
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelector('.message-edit-area')).toBeNull()
        })
        expect(draftContentOrphanGate.get(trIdentity, messageText)).toBeUndefined()
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
    })

    test('a successful retry of a reported Save failure closes the editor and deletes the record', async () => {
        const messageText = 'source text for translation'
        setUpTranslatable(messageText)
        const trIdentity: TranslationIdentity = { kind: 'tr', key: messageText }
        draftContentOrphanGate.set(trIdentity, 'typed translation draft', messageText)

        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(target)
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelector<HTMLTextAreaElement>('.message-edit-area')?.value).toBe('typed translation draft')
        })

        vi.mocked(setLLMCache).mockRejectedValueOnce(new Error('quota'))
        await expectNoUnhandledRejections(async () => {
            findButtonByText(target, language.editTranslationSave).click()
            await new Promise((r) => setTimeout(r, 20))
            flushSync()
        })
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(target.querySelector('.message-edit-area')).not.toBeNull()

        findButtonByText(target, language.editTranslationSave).click()
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelector('.message-edit-area')).toBeNull()
        })
        expect(draftContentOrphanGate.get(trIdentity, messageText)).toBeUndefined()
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
    })

    test('a rejection while loading the translation for editing is reported once and leaves the editor closed', async () => {
        const messageText = 'source text for translation'
        setUpTranslatable(messageText)

        vi.mocked(getLLMCache).mockRejectedValueOnce(new Error('cache read failed'))
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        await expectNoUnhandledRejections(async () => {
            openTranslationEditor(target)
            await new Promise((r) => setTimeout(r, 20))
            flushSync()
        })

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toEqual(new Error('cache read failed'))
        expect(target.querySelector('.message-edit-area')).toBeNull()
    })

    test('a rejecting translation write from a partial-edit save is reported once with no unhandled rejection', async () => {
        const messageText = 'source text for translation'
        DBState.db = baseDb({ translatorType: 'llm', translator: 'dummy-translator', enableBlockPartialEdit: true }) as never
        const chat = makeChat([makeMessage(messageText, 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        partialEditProps.current = null
        mountChat({ idx: 0, message: messageText, isLastMemory: false })
        const save = partialEditProps.current?.$$events?.save
        expect(save).toBeTypeOf('function')

        vi.mocked(setLLMCache).mockRejectedValueOnce(new Error('quota'))
        await expectNoUnhandledRejections(async () => {
            await save!(new CustomEvent('save', { detail: { newData: 'edited translation', target: 'translation', translationKey: messageText } }))
            await new Promise((r) => setTimeout(r, 20))
        })

        expect(vi.mocked(setLLMCache)).toHaveBeenCalledWith(messageText, 'edited translation')
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toEqual(new Error('quota'))
    })

    test('a tr: record never seeds the main (original-text) editor', () => {
        const sharedText = 'shared text'
        DBState.db = baseDb() as never // translatorType left at 'none': plain main-editor scenario
        const chat = makeChat([makeMessage(sharedText, 'chat-id-1')])
        DBState.db.characters = [makeCharacter([chat])] as never
        selIdState.selId = 0

        const trIdentity: TranslationIdentity = { kind: 'tr', key: sharedText }
        draftContentOrphanGate.set(trIdentity, 'tr draft should not appear in main editor', sharedText)

        const { target } = mountChat({ idx: 0, message: sharedText, isLastMemory: false })
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        expect(textarea.value).toBe(sharedText)
        expect(target.querySelector('[role="status"]')).toBeNull()
    })

    test('a msg: record never seeds the translation editor', async () => {
        const messageText = 'source text for translation'
        const chat = setUpTranslatable(messageText)

        const msgIdentity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
        draftContentOrphanGate.set(msgIdentity, 'msg draft should not appear in translation editor', messageText)

        vi.mocked(getLLMCache).mockResolvedValueOnce('the actual cached translation')
        const { target } = mountChat({ idx: 0, message: messageText, isLastMemory: false })
        openTranslationEditor(target)
        await vi.waitFor(() => {
            flushSync()
            const ta = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
            expect(ta?.value).toBe('the actual cached translation')
        })
        expect(target.querySelector('[role="status"]')).toBeNull()
    })
})
