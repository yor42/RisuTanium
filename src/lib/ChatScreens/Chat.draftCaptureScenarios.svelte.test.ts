// @vitest-environment happy-dom

/**
 * Cross-cutting scenario tests for the durable-draft (MC-068) revert/restore/
 * type-back sequences ending in an involuntary unmount, cross-instance
 * staleness of a restored record's `updatedAt`, and overlapping translation
 * saves. Every assertion is on an observable outcome only -- the content
 * store (`draftContentOrphanGate.get`, `updatedAt`), `hasLocalDrafts()`, the
 * restore marker, and the edit buffer's own value.
 *
 * Kept as a SIBLING file to `Chat.draftRestoreMarker.svelte.test.ts` and
 * `Chat.messageEditor.svelte.test.ts` rather than an extension of either:
 * those files are already large and scoped to identity/seeding (the latter)
 * and the marker/revert affordance in isolation (the former), while this
 * file's scenarios interleave both editors' capture, the restore marker, and
 * the multi-tab orphan gate in longer sequences. The module-mock block below
 * is intentionally duplicated from those files (`vi.mock` factories are
 * hoisted per-file in Vitest and cannot be shared across files) rather than
 * extracted, to keep each test file's fixture self-contained and honest
 * about what it mocks.
 *
 * Mounts the REAL `Chat.svelte` against the REAL `src/ts/draftContentOrphanGate.ts`
 * (and the `src/ts/draftContents.ts` store it wraps) and `src/ts/localDrafts.ts`.
 * Everything heavy, side-effecting, or irrelevant to the capture/marker logic
 * under test is mocked, following the same precedent as the sibling files
 * above.
 *
 * Most of these tests exercise the capture these scenarios interleave. Five
 * are guards rather than feature pins -- each holds whether or not capture
 * wiring exists, so a future change can't regress the behaviour each one
 * checks:
 * - "restore, no edit, involuntary unmount": holds regardless, since with no
 *   edit made, the record set directly by the test is left untouched either
 *   way.
 * - both "overlapping saves where the first fails and the second succeeds
 *   leave no stale draft" variants: the no-stale-draft assertion holds
 *   whether or not capture wiring exists -- without it, typed text never
 *   reaches the content store, so there is nothing to leave behind; with it,
 *   the second (successful) save's own delete clears the captured draft
 *   instead. Their other assertions -- both saves are attempted in order,
 *   and the editor closes once the second succeeds -- are ordinary save
 *   behaviour, pinned here so it doesn't regress either.
 * - "an involuntary unmount while a save is in flight ...: success": holds
 *   whether or not capture wiring exists, for the same reason -- without it
 *   nothing was ever written; with it, the successful save's own delete
 *   clears the record (the "failure" variant of this same test does depend
 *   on capture wiring, since it expects the record left over from the failed
 *   save).
 * - "retrying a save after an earlier failure succeeds and clears the
 *   record": the record-absent assertion holds whether or not capture wiring
 *   exists, for the same reason as above; the translation editor's own
 *   liveness registration (an `$effect` registers it while
 *   `editTranslationMode` is on) is independent of content capture and is
 *   released when the successful retry closes the editor.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks (duplicated from Chat.draftRestoreMarker.svelte.test.ts -- see file header)

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
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
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

function setupMsg(text = 'original text') {
    DBState.db = baseDb() as never
    const chat = makeChat([makeMessage(text, 'chat-id-1')])
    DBState.db.characters = [makeCharacter([chat])] as never
    selIdState.selId = 0
    const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat), chatId: 'chat-id-1', index: 0 }
    return identity
}
function setupTr(text = 'source text') {
    DBState.db = baseDb({ translatorType: 'llm', translator: 'dummy' }) as never
    const chat = makeChat([makeMessage(text, 'chat-id-1')])
    DBState.db.characters = [makeCharacter([chat])] as never
    selIdState.selId = 0
    const tr: TranslationIdentity = { kind: 'tr', key: text }
    return tr
}
function editArea(target: HTMLElement) {
    return target.querySelector('.message-edit-area') as HTMLTextAreaElement | null
}
async function openTr(target: HTMLElement, expected: string) {
    (target.querySelector('.button-icon-translate') as HTMLButtonElement).click()
    flushSync()
    await reopenTr(target, expected)
}
async function reopenTr(target: HTMLElement, expected: string) {
    findButtonByText(target, language.editTranslation).click()
    await vi.waitFor(() => {
        flushSync()
        expect(editArea(target)?.value).toBe(expected)
    })
}
function pencil(target: HTMLElement) {
    (target.querySelector('.button-icon-edit') as HTMLButtonElement).click()
    flushSync()
}
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('main editor: revert / type-back / unmount sequences', () => {
    test('restore, revert, type away, type back to the reverted text, unmount: no record, no orphan', async () => {
        const id = setupMsg()
        draftContentOrphanGate.set(id, 'draft1', 'original text')
        const fx = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        pencil(fx.target)
        findRevertButton(fx.target)?.click()
        flushSync()
        await typeInto(fx.target, 'original textZ')
        expect(draftContentOrphanGate.get(id, 'original text')?.text).toBe('original textZ')
        await typeInto(fx.target, 'original text')
        await unmountFixture(fx)
        expect(draftContentOrphanGate.get(id, 'original text')).toBeUndefined()
        expect(hasLocalDrafts()).toBe(false)
    })

    test('revert then type, unmount: the record is the typed text', async () => {
        const id = setupMsg()
        draftContentOrphanGate.set(id, 'draft1', 'original text')
        const fx = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        pencil(fx.target)
        findRevertButton(fx.target)?.click()
        flushSync()
        await typeInto(fx.target, 'after revert')
        await unmountFixture(fx)
        expect(draftContentOrphanGate.get(id, 'original text')?.text).toBe('after revert')
    })

    test('restore, no edit, involuntary unmount: the record survives with an unchanged updatedAt', async () => {
        const id = setupMsg()
        draftContentOrphanGate.set(id, 'draft1', 'original text')
        const before = draftContentOrphanGate.get(id, 'original text')?.updatedAt
        await sleepMs(15)
        const fx = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        pencil(fx.target)
        await tick()
        await unmountFixture(fx)
        const after = draftContentOrphanGate.get(id, 'original text')
        expect(after?.text).toBe('draft1')
        expect(after?.updatedAt).toBe(before)
    })

    test('fresh open, type, type back to the message text, unmount: the record is deleted and the orphan released', async () => {
        const id = setupMsg()
        const fx = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        pencil(fx.target)
        await typeInto(fx.target, 'original textQ')
        expect(draftContentOrphanGate.get(id, 'original text')?.text).toBe('original textQ')
        await typeInto(fx.target, 'original text')
        await unmountFixture(fx)
        expect(hasLocalDrafts()).toBe(false)
        expect(draftContentOrphanGate.get(id, 'original text')).toBeUndefined()
    })

    test('a second open on the same instance, after an earlier typed session closed, does not re-stamp a record restored since', async () => {
        const id = setupMsg()
        const fx = mountChat({ idx: 0, message: 'original text', isLastMemory: false })
        pencil(fx.target)
        await typeInto(fx.target, 'session one typing')
        const ta = editArea(fx.target) as HTMLTextAreaElement
        ta.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await sleepMs(550)
        flushSync()
        expect(editArea(fx.target)).toBeNull()
        // Another surface (e.g. BookmarkList) files a draft for the same identity.
        draftContentOrphanGate.set(id, 'other surface draft', 'original text')
        const before = draftContentOrphanGate.get(id, 'original text')?.updatedAt
        await sleepMs(15)
        pencil(fx.target)
        await tick()
        expect(editArea(fx.target)?.value).toBe('other surface draft')
        expect(draftContentOrphanGate.get(id, 'original text')?.updatedAt).toBe(before)
    })
})

describe('translation editor: revert / type-back / unmount sequences', () => {
    test('tr open, type, type back to the cached seed, unmount: the record is deleted and the orphan released', async () => {
        const tr = setupTr()
        vi.mocked(getLLMCache).mockResolvedValueOnce('cached')
        const fx = mountChat({ idx: 0, message: 'source text', isLastMemory: false })
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'cachedQ')
        expect(draftContentOrphanGate.get(tr, 'source text')?.text).toBe('cachedQ')
        await typeInto(fx.target, 'cached')
        await unmountFixture(fx)
        expect(hasLocalDrafts()).toBe(false)
        expect(draftContentOrphanGate.get(tr, 'source text')).toBeUndefined()
    })

    test('a second tr open on the same instance, after an earlier typed-and-saved session, does not re-stamp a record restored since', async () => {
        const tr = setupTr()
        vi.mocked(getLLMCache).mockResolvedValueOnce('cached')
        const fx = mountChat({ idx: 0, message: 'source text', isLastMemory: false })
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'typed and saved')
        findButtonByText(fx.target, language.editTranslationSave).click()
        await vi.waitFor(() => { flushSync(); expect(editArea(fx.target)).toBeNull() })
        draftContentOrphanGate.set(tr, 'sibling draft', 'source text')
        const before = draftContentOrphanGate.get(tr, 'source text')?.updatedAt
        await sleepMs(15)
        vi.mocked(getLLMCache).mockResolvedValueOnce('typed and saved')
        await reopenTr(fx.target, 'sibling draft')
        await tick()
        expect(draftContentOrphanGate.get(tr, 'source text')?.updatedAt).toBe(before)
    })

    for (const order of ['fail-then-success', 'success-then-fail'] as const) {
        test('overlapping saves where the first fails and the second succeeds leave no stale draft, ' + order, async () => {
            const tr = setupTr()
            vi.mocked(getLLMCache).mockResolvedValueOnce('cached')
            const fx = mountChat({ idx: 0, message: 'source text', isLastMemory: false })
            await openTr(fx.target, 'cached')
            await typeInto(fx.target, 'T1')
            const failDelay = order === 'fail-then-success' ? 5 : 15
            const okDelay = order === 'fail-then-success' ? 15 : 5
            const failing = () => new Promise<void>((_res, rej) => { setTimeout(() => rej(new Error('transient')), failDelay) })
            const passing = () => new Promise<void>((res) => { setTimeout(() => res(), okDelay) })
            vi.mocked(setLLMCache).mockImplementationOnce(failing).mockImplementationOnce(passing)
            await expectNoUnhandledRejections(async () => {
                const save = findButtonByText(fx.target, language.editTranslationSave)
                save.click()
                await typeInto(fx.target, 'T2')
                save.click()
                await sleepMs(50)
                flushSync()
            })
            expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
            const saved = vi.mocked(setLLMCache).mock.calls.map((c) => c[1])
            expect(saved).toEqual(['T1', 'T2'])
            expect(editArea(fx.target)).toBeNull()
            const leftover = draftContentOrphanGate.get(tr, 'source text')
            vi.mocked(getLLMCache).mockResolvedValueOnce('T2')
            findButtonByText(fx.target, language.editTranslation).click()
            await vi.waitFor(() => { flushSync(); expect(editArea(fx.target)).not.toBeNull() })
            // The second save committed 'T2' to the cache, so a record still
            // offering 'T1' (or any other stale text) back on the next open
            // would be presenting text the user already moved past as if it
            // were their most recent edit.
            expect(leftover).toBeUndefined()
        })
    }

    test('text typed during a save that then fails is not lost on an involuntary unmount with no further keystroke', async () => {
        const tr = setupTr()
        vi.mocked(getLLMCache).mockResolvedValueOnce('cached')
        const fx = mountChat({ idx: 0, message: 'source text', isLastMemory: false })
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'T1')
        const failing = () => new Promise<void>((_res, rej) => { setTimeout(() => rej(new Error('quota')), 10) })
        vi.mocked(setLLMCache).mockImplementationOnce(failing)
        await expectNoUnhandledRejections(async () => {
            findButtonByText(fx.target, language.editTranslationSave).click()
            await typeInto(fx.target, 'T1 plus more typed during the save')
            await sleepMs(40)
            flushSync()
        })
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(editArea(fx.target)?.value).toBe('T1 plus more typed during the save')
        await unmountFixture(fx)
        expect(draftContentOrphanGate.get(tr, 'source text')?.text).toBe('T1 plus more typed during the save')
    })

    for (const outcome of ['success', 'failure'] as const) {
        test('an involuntary unmount while a save is in flight leaves the record consistent with how that save later settles: ' + outcome, async () => {
            const tr = setupTr()
            vi.mocked(getLLMCache).mockResolvedValueOnce('cached')
            const fx = mountChat({ idx: 0, message: 'source text', isLastMemory: false })
            await openTr(fx.target, 'cached')
            await typeInto(fx.target, 'T1')
            const settle = () => new Promise<void>((res, rej) => { setTimeout(() => (outcome === 'success' ? res() : rej(new Error('x'))), 10) })
            vi.mocked(setLLMCache).mockImplementationOnce(settle)
            await expectNoUnhandledRejections(async () => {
                findButtonByText(fx.target, language.editTranslationSave).click()
                await unmountFixture(fx)
                await sleepMs(40)
            })
            expect(vi.mocked(alertError)).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0)
            const rec = draftContentOrphanGate.get(tr, 'source text')
            if (outcome === 'success') expect(rec).toBeUndefined()
            else expect(rec?.text).toBe('T1')
        })
    }

    test('retrying a save after an earlier failure succeeds and clears the record', async () => {
        const tr = setupTr()
        vi.mocked(getLLMCache).mockResolvedValueOnce('cached')
        const fx = mountChat({ idx: 0, message: 'source text', isLastMemory: false })
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'retry text')
        vi.mocked(setLLMCache).mockRejectedValueOnce(new Error('x'))
        await expectNoUnhandledRejections(async () => {
            findButtonByText(fx.target, language.editTranslationSave).click()
            await sleepMs(20)
        })
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        findButtonByText(fx.target, language.editTranslationSave).click()
        await vi.waitFor(() => { flushSync(); expect(editArea(fx.target)).toBeNull() })
        expect(draftContentOrphanGate.get(tr, 'source text')).toBeUndefined()
        expect(hasLocalDrafts()).toBe(false)
    })
})
