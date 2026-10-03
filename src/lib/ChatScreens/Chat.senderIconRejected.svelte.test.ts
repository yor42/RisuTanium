// @vitest-environment happy-dom

/**
 * What `Chat.svelte`'s sender icon shows when its `img` prop rejects.
 *
 * Invariants pinned here:
 *  - a rejected `img` renders exactly one icon block, with the same style and
 *    classes as the placeholder shown while `img` is pending;
 *  - a rejection leaves no unhandled rejection, whether `img` was already
 *    rejected when the message mounted or rejects later;
 *  - after a rejection, a new `img` that resolves replaces the placeholder with
 *    its own style.
 *
 * Every test here is a regression reproducer: without a rejection branch on the
 * icon's `{#await}` block the rejection is rethrown as an unhandled rejection
 * and the icon block disappears.
 *
 * This mounts the REAL `Chat.svelte` with the same module mocks as
 * `Chat.senderIconMount.svelte.test.ts`; `ChatBody.svelte` and
 * `PartialEditController.svelte` are stubbed to trivial components.
 */

import { flushSync, mount, tick, unmount, type ComponentProps } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks (duplicated from Chat.senderIconMount.svelte.test.ts: `vi.mock` factories are per-file)

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

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiLawApplies: vi.fn(() => false),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    createChatCopyName: vi.fn((name: string) => `${name} Branch`),
    downloadFile: vi.fn(),
    fetchNative: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

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

//#region fixtures and helpers

function setupDb() {
    DBState.db = {
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
        enableBookmark: false,
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
                message: [{ role: 'char', data: 'hello', chatId: 'c1' }],
                bookmarks: [] as string[],
                bookmarkNames: {} as Record<string, string>,
            }],
        }],
    } as never
    selIdState.selId = 0
}

function deferred() {
    let resolve!: (v: string) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<string>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

// Lets a queued microtask, and the promise callbacks it triggers, run to
// completion, then lets a timer-driven unhandled-rejection report arrive and
// flushes the resulting DOM update.
async function settle() {
    for (let i = 0; i < 6; i++) await Promise.resolve()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}

function icons(target: HTMLElement) {
    return Array.from(target.querySelectorAll('.bg-textcolor2'))
}

function iconShape(el: Element) {
    return { style: el.getAttribute('style'), className: el.getAttribute('class') }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

const chatProps = { idx: 0, message: 'hello', isLastMemory: false }

// `props` is passed to `mount` as-is (not spread) so a getter on it stays live.
function mountChat(props: ComponentProps<typeof Chat>) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(Chat, { target, props })
    mountedInstances.push(instance)
    flushSync()
    return { target, instance }
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
}

afterEach(async () => {
    process.off('unhandledRejection', onUnhandled)
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.clearAllMocks()
})

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
    setupDb()
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
})

//#endregion

describe('Chat.svelte sender icon: a rejected img', () => {
    test('regression reproducer: an img that is already rejected at mount renders one placeholder icon and no unhandled rejection', async () => {
        const { target } = mountChat({ ...chatProps, img: Promise.reject(new Error('boom')) })
        const pending = icons(target)
        expect(pending).toHaveLength(1)
        const pendingShape = iconShape(pending[0])

        await settle()

        expect(unhandled).toEqual([])
        expect(icons(target)).toHaveLength(1)
        expect(iconShape(icons(target)[0])).toEqual(pendingShape)
    })

    test('regression reproducer: an img that rejects after the mount settled renders one placeholder icon and no unhandled rejection', async () => {
        const d = deferred()
        const { target } = mountChat({ ...chatProps, img: d.promise })
        await settle()
        const pendingShape = iconShape(icons(target)[0])

        d.reject(new Error('late'))
        await settle()

        expect(unhandled).toEqual([])
        expect(icons(target)).toHaveLength(1)
        expect(iconShape(icons(target)[0])).toEqual(pendingShape)
    })

    test('regression reproducer: after a rejection, a new img that resolves replaces the placeholder with its style', async () => {
        const props = $state({ img: Promise.reject(new Error('boom')) as Promise<string> })
        const { target } = mountChat({
            ...chatProps,
            get img() {
                return props.img
            },
        })
        await settle()
        expect(icons(target)).toHaveLength(1)

        const next = deferred()
        props.img = next.promise
        flushSync()
        await settle()
        next.resolve('color: blue;')
        await settle()

        expect(unhandled).toEqual([])
        expect(icons(target)).toHaveLength(1)
        expect(icons(target)[0].getAttribute('style')).toContain('color: blue;')
    })
})
