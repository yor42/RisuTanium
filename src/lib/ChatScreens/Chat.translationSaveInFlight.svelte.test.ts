// @vitest-environment happy-dom

/**
 * Translation-editor Save while the cache write is still pending, in the REAL
 * `Chat.svelte`: what happens to text typed after the click, to the durable
 * draft record (MC-068), and to the order of writes. Every assertion is on an
 * observable outcome: the `setLLMCache` calls and their settle order, the
 * editor's presence and value, the content store (`draftContentOrphanGate.get`),
 * `hasLocalDrafts()` and the restore marker.
 *
 * Invariants pinned here:
 *  - a save writes the text as of the click; text typed during the write is
 *    never discarded: the editor stays open with it, and its record keeps the
 *    keystroke-time age;
 *  - when the buffer at settle time equals the text written, and no later save
 *    from this view is pending, the editor closes and the record is deleted
 *    (return to origin); while a later save is pending, the record stays;
 *  - after a kept-open settle the cached text is the seed, so typing back to it
 *    leaves no restorable draft, while typing back to the older seed keeps a
 *    record that differs from the cache;
 *  - the record is shared by key across instances: a settle deletes it only if
 *    it holds exactly the text that settle wrote, and an unmounted instance
 *    never writes into it or changes another instance's editor;
 *  - a record deleted by Revert in a remounted instance stays deleted when an
 *    unmounted instance's write settles later;
 *  - an editor session never closes while one of its saves is queued;
 *  - writes from one instance land in click order, each starting after the
 *    previous one settled, and the later text is the last write even when the
 *    buffer has returned to an earlier written text.
 *
 * Test purposes (the label is in the title):
 *  - "regression reproducer" fails against the unfixed save path;
 *  - "guard" holds before and after and protects behaviour that must stay;
 *  - "new behaviour" pins behaviour that did not exist before.
 *
 * `setLLMCache` is a deferred stub; nothing here touches a real cache, network
 * or file system, and a pass says nothing about native storage behaviour. The
 * module-mock block is duplicated from `Chat.draftCaptureScenarios.svelte.test.ts`
 * because `vi.mock` factories are hoisted per file.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks (duplicated from Chat.draftCaptureScenarios.svelte.test.ts -- see file header)

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
import { type TranslationIdentity } from 'src/ts/draftContents'
import { hasLocalDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'
import { language } from '../../lang'
import { getLLMCache, setLLMCache } from 'src/ts/translator/translator'

//#region fixture helpers

const SOURCE = 'source text'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountChat() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(Chat, { target, props: { idx: 0, message: SOURCE, isLastMemory: false } })
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

function editArea(target: HTMLElement) {
    return target.querySelector('.message-edit-area') as HTMLTextAreaElement | null
}

/** Opens the translation editor; the cache holds `cached`, and the editor is expected to show `expected`. */
async function openTr(target: HTMLElement, cached: string, expected: string = cached) {
    vi.mocked(getLLMCache).mockResolvedValueOnce(cached);
    (target.querySelector('.button-icon-translate') as HTMLButtonElement).click()
    flushSync()
    findButtonByText(target, language.editTranslation).click()
    await vi.waitFor(() => {
        flushSync()
        expect(editArea(target)?.value).toBe(expected)
    })
}

function clickSave(target: HTMLElement) {
    findButtonByText(target, language.editTranslationSave).click()
    flushSync()
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Lets a released write's continuation run to completion. */
async function afterSettle() {
    await sleepMs(30)
    flushSync()
    await tick()
}

interface Held {
    release: () => void
}

/** The next `setLLMCache` call stays pending until `release` is called. */
function holdNextWrite(): Held {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
        release = resolve
    })
    vi.mocked(setLLMCache).mockImplementationOnce(() => pending)
    return { release }
}

function writtenTexts(): string[] {
    return vi.mocked(setLLMCache).mock.calls.map((c) => c[1])
}

function record() {
    const tr: TranslationIdentity = { kind: 'tr', key: SOURCE }
    return draftContentOrphanGate.get(tr, SOURCE)
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
    DBState.db = {
        askRemoval: false,
        instantRemove: false,
        translatorType: 'llm',
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        requestInfoInsideChat: false,
        clickToEdit: false,
        zoomsize: 100,
        lineHeight: 1.25,
        enableBlockPartialEdit: false,
        enableDragPartialEdit: false,
        useChatCopy: false,
        translator: 'dummy',
        swipe: false,
        showFirstMessagePages: false,
        enableBookmark: true,
        createFolderOnBranch: false,
        iconsize: 100,
        memoryLimitThickness: 2,
        theme: 'default',
        guiHTML: '',
        roundIcons: false,
        characters: [{
            chaId: 'char-1',
            type: 'character',
            ttsMode: 'none',
            chatPage: 0,
            chats: [{
                id: 'chat-1',
                message: [{ role: 'char', data: SOURCE, chatId: 'chat-id-1' }],
                bookmarks: [] as string[],
                bookmarkNames: {} as Record<string, string>,
            }],
        }],
    } as never
    selIdState.selId = 0
})

//#endregion

describe('typing during a pending translation save', () => {
    test('regression reproducer: text typed after clicking Save stays in the open editor and its record keeps the keystroke-time age', async () => {
        const fx = mountChat()
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'T1')
        const held = holdNextWrite()
        clickSave(fx.target)
        await typeInto(fx.target, 'T1more')
        const typedAt = record()?.updatedAt
        expect(record()?.text).toBe('T1more')
        await sleepMs(15)

        held.release()
        await afterSettle()

        expect(writtenTexts()).toEqual(['T1'])
        expect(editArea(fx.target)?.value).toBe('T1more')
        expect(record()?.text).toBe('T1more')
        expect(record()?.updatedAt).toBe(typedAt)
    })

    test('guard: typing away and back to the written text during the save closes the editor and deletes the record', async () => {
        const fx = mountChat()
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'T1')
        const held = holdNextWrite()
        clickSave(fx.target)
        await typeInto(fx.target, 'T1x')
        await typeInto(fx.target, 'T1')

        held.release()
        await vi.waitFor(() => { flushSync(); expect(editArea(fx.target)).toBeNull() })

        expect(writtenTexts()).toEqual(['T1'])
        expect(record()).toBeUndefined()
        expect(hasLocalDrafts()).toBe(false)
    })

    test('new behaviour: typing back to the older cached text during the save keeps the editor open with a record that the next open offers', async () => {
        const fx = mountChat()
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'T1')
        const held = holdNextWrite()
        clickSave(fx.target)
        await typeInto(fx.target, 'cached')

        held.release()
        await afterSettle()

        expect(writtenTexts()).toEqual(['T1'])
        expect(editArea(fx.target)?.value).toBe('cached')
        expect(record()?.text).toBe('cached')

        await unmountFixture(fx)
        const reopened = mountChat()
        await openTr(reopened.target, 'T1', 'cached')
        expect(findRevertButton(reopened.target)).toBeDefined()
    })

    test('new behaviour: after a kept-open settle, typing back to the text just written leaves no restorable draft', async () => {
        const fx = mountChat()
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'T1')
        const held = holdNextWrite()
        clickSave(fx.target)
        await typeInto(fx.target, 'T1more')
        held.release()
        await afterSettle()
        expect(editArea(fx.target)?.value).toBe('T1more')

        await typeInto(fx.target, 'T1')

        expect(record()).toBeUndefined()
    })

    test('new behaviour: a kept-open settle clears the restore marker of a restored draft and leaves its record in place', async () => {
        const tr: TranslationIdentity = { kind: 'tr', key: SOURCE }
        draftContentOrphanGate.set(tr, 'restored draft', SOURCE)
        const fx = mountChat()
        await openTr(fx.target, 'cached', 'restored draft')
        expect(findRevertButton(fx.target), 'the restore marker').toBeDefined()
        const held = holdNextWrite()
        clickSave(fx.target)
        await typeInto(fx.target, 'restored draft, more')
        const typedAt = record()?.updatedAt
        await sleepMs(15)

        held.release()
        await afterSettle()

        expect(writtenTexts()).toEqual(['restored draft'])
        expect(editArea(fx.target)?.value).toBe('restored draft, more')
        expect(findRevertButton(fx.target)).toBeUndefined()
        expect(record()?.text).toBe('restored draft, more')
        expect(record()?.updatedAt).toBe(typedAt)
    })
})

describe('a save that settles after its instance was unmounted', () => {
    test('regression reproducer: a remounted instance keeps the record and editor it created while the first instance\'s write was pending', async () => {
        const a = mountChat()
        await openTr(a.target, 'cached')
        await typeInto(a.target, 'S1')
        const held = holdNextWrite()
        clickSave(a.target)
        await unmountFixture(a)

        const b = mountChat()
        await openTr(b.target, 'cached', 'S1')
        await typeInto(b.target, 'new')
        expect(record()?.text).toBe('new')

        held.release()
        await afterSettle()

        expect(writtenTexts()).toEqual(['S1'])
        expect(record()?.text).toBe('new')
        expect(editArea(b.target)?.value).toBe('new')
    })

    test('regression reproducer: a remounted instance keeps its record when the first instance had typed past its save and then settles, and again on its own unmount', async () => {
        const a = mountChat()
        await openTr(a.target, 'cached')
        await typeInto(a.target, 'S1')
        const held = holdNextWrite()
        clickSave(a.target)
        await typeInto(a.target, 'S1more')
        await unmountFixture(a)

        const b = mountChat()
        await openTr(b.target, 'cached', 'S1more')
        expect(findRevertButton(b.target), 'the restore marker').toBeDefined()
        await typeInto(b.target, 'new')
        expect(record()?.text).toBe('new')

        held.release()
        await afterSettle()

        expect(writtenTexts()).toEqual(['S1'])
        expect(record()?.text).toBe('new')

        await unmountFixture(b)
        expect(record()?.text).toBe('new')
    })

    test('new behaviour: with no remount, text typed past the save stays as a record that the next open offers', async () => {
        const a = mountChat()
        await openTr(a.target, 'cached')
        await typeInto(a.target, 'S1')
        const held = holdNextWrite()
        clickSave(a.target)
        await typeInto(a.target, 'S1more')
        await unmountFixture(a)

        held.release()
        await sleepMs(30)

        expect(writtenTexts()).toEqual(['S1'])
        expect(record()?.text).toBe('S1more')

        const b = mountChat()
        await openTr(b.target, 'S1', 'S1more')
        expect(findRevertButton(b.target), 'the restore marker').toBeDefined()
    })
})

describe('translation saves from one instance', () => {
    test('regression reproducer: a second Save waits for the first write to settle, so the later text is the last write to land and the editor closes on it', async () => {
        const fx = mountChat()
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'T1')

        const settled: string[] = []
        let releaseSlow!: () => void
        const slow = new Promise<void>((resolve) => {
            releaseSlow = resolve
        })
        vi.mocked(setLLMCache)
            .mockImplementationOnce(async (_key: string, text: string) => {
                await slow
                settled.push(text)
            })
            .mockImplementationOnce(async (_key: string, text: string) => {
                settled.push(text)
            })

        clickSave(fx.target)
        await typeInto(fx.target, 'T2')
        clickSave(fx.target)
        await sleepMs(20)

        // The second write does not start while the first is pending.
        expect(writtenTexts()).toEqual(['T1'])
        expect(settled).toEqual([])

        releaseSlow()
        await vi.waitFor(() => { flushSync(); expect(editArea(fx.target)).toBeNull() })

        expect(writtenTexts()).toEqual(['T1', 'T2'])
        expect(settled).toEqual(['T1', 'T2'])
        expect(record()).toBeUndefined()
    })

    test('regression reproducer: typing back to an earlier written text after a second Save keeps the editor open on it and the last write is the later text', async () => {
        const fx = mountChat()
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'T1')
        const first = holdNextWrite()
        const second = holdNextWrite()
        clickSave(fx.target)
        await typeInto(fx.target, 'T2')
        clickSave(fx.target)
        await typeInto(fx.target, 'T1')

        first.release()
        await afterSettle()
        second.release()
        await afterSettle()

        expect(writtenTexts()).toEqual(['T1', 'T2'])
        expect(editArea(fx.target)?.value).toBe('T1')
        expect(record()?.text).toBe('T1')
    })

    test('regression reproducer: unmounting after typing back to the first of two written texts leaves a record holding it once both writes settle', async () => {
        const fx = mountChat()
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'T1')
        const first = holdNextWrite()
        const second = holdNextWrite()
        clickSave(fx.target)
        await typeInto(fx.target, 'T2')
        clickSave(fx.target)
        await typeInto(fx.target, 'T1')
        await unmountFixture(fx)

        first.release()
        await afterSettle()
        second.release()
        await afterSettle()

        expect(writtenTexts()).toEqual(['T1', 'T2'])
        expect(record()?.text).toBe('T1')

        const reopened = mountChat()
        await openTr(reopened.target, 'T2', 'T1')
        expect(findRevertButton(reopened.target), 'the restore marker').toBeDefined()
    })
})

describe('a restore marker and a draft record across sessions and instances', () => {
    test('guard: reverting a draft in a remounted instance stays final when the unmounted instance\'s write settles afterwards', async () => {
        const a = mountChat()
        await openTr(a.target, 'cached')
        await typeInto(a.target, 'S1')
        const held = holdNextWrite()
        clickSave(a.target)
        await typeInto(a.target, 'S1more')
        await unmountFixture(a)

        const b = mountChat()
        await openTr(b.target, 'cached', 'S1more')
        expect(findRevertButton(b.target), 'the restore marker').toBeDefined()
        findRevertButton(b.target)!.click()
        flushSync()
        await tick()
        expect(record()).toBeUndefined()
        expect(editArea(b.target)?.value).toBe('cached')

        held.release()
        await afterSettle()

        expect(writtenTexts()).toEqual(['S1'])
        expect(record()).toBeUndefined()
    })

    test('regression reproducer: the editor stays open until the last of two queued saves settles', async () => {
        const fx = mountChat()
        await openTr(fx.target, 'cached')
        await typeInto(fx.target, 'T1')
        const first = holdNextWrite()
        const second = holdNextWrite()
        clickSave(fx.target)
        clickSave(fx.target)
        first.release()
        await afterSettle()
        expect(editArea(fx.target), 'the editor while a save is still pending').not.toBeNull()

        second.release()
        await vi.waitFor(() => { flushSync(); expect(editArea(fx.target)).toBeNull() })

        expect(writtenTexts()).toEqual(['T1', 'T1'])
    })
})
