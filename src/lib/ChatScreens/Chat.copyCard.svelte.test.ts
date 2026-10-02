// @vitest-environment happy-dom

/**
 * The "Copy as card" item of the "..." popup menu of the REAL `Chat.svelte`,
 * opened through the REAL `PopupButton.svelte` and `PopupList.svelte` (mounted
 * the way `App.svelte` mounts it, only while `popupStore.children` is set).
 *
 * Invariants pinned here:
 *  - the item exists only when `useChatCopy` is on, the message is not blank and
 *    the browser has `ClipboardItem` and `navigator.clipboard.write`; it exists
 *    for the first message (idx -1);
 *  - a click calls `navigator.clipboard.write` once, synchronously inside the
 *    click handler, with one `ClipboardItem` whose `text/plain` is the message
 *    copy text and whose `text/html` is a card holding the escaped display
 *    name, "From RisuTanium" and, for a character message only, a model badge;
 *  - every input of the card (name, avatar path) is captured at the click, so a
 *    later change of the selected character cannot change the card;
 *  - a user message takes its avatar from the persona icon, never from the
 *    character image; an empty path never reaches the avatar encoder;
 *  - a body image outside the app keeps its address and a `/proxy2` image is
 *    left out, and the click fetches nothing;
 *  - the status line says whether the card was complete, simplified, or fell
 *    back to plain text, shows "Loading" while the card write is pending, and
 *    names the error when the write is rejected;
 *  - the plain copy button of a message tells the card controller about its
 *    copy, so a card write still pending is superseded and the plain text is
 *    written again when the card write settles, with the status staying on the
 *    plain copy's result;
 *  - a second tap on the item of the same message while its card is pending
 *    starts no second write.
 *
 * `navigator.clipboard`, `fetch` and the avatar encoder (`src/ts/chatCardImage`)
 * are recording stubs; nothing here touches a real clipboard, network, canvas
 * or the Tauri file system. A passing test says nothing about a real browser's
 * gesture, permission or clipboard-commit rules.
 *
 * The status assertions use the English strings literally.
 * The test "guard: the popup menu opens and shows its other items" passes with
 * or without the feature and pins the harness; so do the tests whose title
 * starts with "guard:".
 */

import { flushSync, mount, unmount, untrack, type ComponentProps } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'

//#region module mocks

// `popupStore` is shaped like the one in `src/ts/stores.svelte.ts`: a `$state`
// object, so the host effect below sees the popup open and close.
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    const popupStore = $state({
        children: null as null | import('svelte').Snippet,
        mouseX: 0,
        mouseY: 0,
        openId: 0,
    })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CurrentTriggerIdStore: writable(null),
        popupStore,
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
    // A stored image path resolves to a same-origin app image address.
    getFileSrc: vi.fn(async (path: string) => (path ? `/sw/img/${path}` : '')),
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
    alertSelect: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

// The card body is the message text parsed as HTML, unchanged.
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

// `sleep` really waits: `PopupButton` and `PopupList` order their listeners with it.
vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: vi.fn((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
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

// The avatar image seam: the only place that fetches, decodes and draws the
// avatar. `vi.hoisted` makes the stub available to the factory without importing
// the module in this file.
type EncodeAvatar = (
    src: string,
    opts: { maxSide: number; background: string; signal: AbortSignal },
) => Promise<string | null>
const encodeAvatar = vi.hoisted(() => vi.fn<EncodeAvatar>())
vi.mock('src/ts/chatCardImage', () => ({ encodeAvatar }))

//#endregion

import { DBState, popupStore, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { getFileSrc } from 'src/ts/globalApi.svelte'
import { getCurrentCharacter } from 'src/ts/storage/database.svelte'
import { ParseMarkdown } from 'src/ts/parser/parser.svelte'
import { getUserIcon, getUserName } from 'src/ts/util'
import Chat from './Chat.svelte'
import PopupList from '../UI/PopupList.svelte'

//#region fixtures and helpers

const MESSAGE = 'hello **world**'
const AVATAR_DATA_URL = 'data:image/jpeg;base64,ENCODEDAVATAR'
const COPIED = 'Copied'
const COPIED_SIMPLE_CARD = 'Copied (simple card)'
const COPIED_AS_TEXT = 'Copied as text'

type ChatProps = ComponentProps<typeof Chat>

function setupDb(): void {
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
        useChatCopy: true,
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
        characters: [{
            chaId: 'char-a',
            type: 'character',
            name: 'Original',
            image: '',
            ttsMode: 'none',
            chatPage: 0,
            chats: [{
                id: 'chat-a',
                message: [{ role: 'char', data: MESSAGE, chatId: 'id-1' }],
                bookmarks: [] as string[],
                bookmarkNames: {} as Record<string, string>,
            }],
        }],
    } as never
    selIdState.selId = 0
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: ReturnType<typeof mount>[] = []
let listApp: ReturnType<typeof mount> | null = null
let stopListHost: (() => void) | null = null

/**
 * Mounts a Chat whose props the test can change afterwards (`props` is
 * reactive), plus the popup list host the way `App.svelte` mounts it.
 */
async function mountChat(overrides: Partial<ChatProps> = {}): Promise<{ root: HTMLElement; props: ChatProps }> {
    const root = document.createElement('div')
    const listTarget = document.createElement('div')
    document.body.append(root, listTarget)
    mountedTargets.push(root, listTarget)

    stopListHost = $effect.root(() => {
        $effect(() => {
            const open = popupStore.children !== null
            untrack(() => {
                if (open && listApp === null) {
                    listApp = mount(PopupList, { target: listTarget })
                } else if (!open && listApp !== null) {
                    void unmount(listApp)
                    listApp = null
                }
            })
        })
    })

    const props: ChatProps = $state({
        idx: 0,
        message: MESSAGE,
        isLastMemory: false,
        name: 'Ann',
        role: 'char',
        ...overrides,
    })
    mountedInstances.push(mount(Chat, { target: root, props }))
    flushSync()
    await settle()
    return { root, props }
}

/** Lets every promise continuation and zero-delay timer that is ready run, then flushes the DOM. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}

/**
 * Opens the "..." menu. `PopupList` registers its outside-click listener a
 * timer after it mounts, so the wait outlasts that timer.
 */
async function openMenu(root: HTMLElement): Promise<void> {
    const menuButton = root.querySelector<HTMLElement>('.button-icon-menu')
    expect(menuButton, 'the "..." menu button').not.toBeNull()
    menuButton!.click()
    await new Promise((resolve) => setTimeout(resolve, 60))
    flushSync()
    expect(popupStore.children, 'the popup is open').not.toBeNull()
    expect(document.querySelector('.button-icon-bookmark'), 'the popup shows its other items').not.toBeNull()
}

function copyCardItem(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('.button-icon-copy-card')
}

function requireCopyCardItem(): HTMLButtonElement {
    const item = copyCardItem()
    expect(item, 'the "Copy as card" item in the popup menu').not.toBeNull()
    return item!
}

function statusText(root: HTMLElement): string {
    const span = root.querySelector('.grow > span.text-xs')
    expect(span, 'the status span').not.toBeNull()
    return span!.textContent ?? ''
}

interface ClipboardStub {
    write: Mock<(items: ClipboardItem[]) => Promise<void>>
    writeText: Mock<(text: string) => Promise<void>>
}

const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

/**
 * Replaces `navigator.clipboard` with recording stubs. Like a browser, `write`
 * waits for every value of every item and rejects when one rejects.
 */
function stubClipboard(options: { withWrite?: boolean } = {}): ClipboardStub {
    const stub: ClipboardStub = {
        write: vi.fn(async (items: ClipboardItem[]) => {
            for (const item of items) {
                for (const type of item.types) {
                    await item.getType(type)
                }
            }
        }),
        writeText: vi.fn(async () => {}),
    }
    const exposed = options.withWrite === false ? { writeText: stub.writeText } : stub
    Object.defineProperty(navigator, 'clipboard', { value: exposed, configurable: true })
    return stub
}

interface ClipboardGate {
    release: () => void
}

/**
 * Makes the stub's `write` wait, after it has read every payload, until the
 * returned gate is released; it then rejects with `rejection` when one is given.
 */
function gateWrites(clipboard: ClipboardStub, rejection?: Error): ClipboardGate {
    let release!: () => void
    const released = new Promise<void>((resolve) => {
        release = resolve
    })
    clipboard.write.mockImplementation(async (items: ClipboardItem[]) => {
        for (const item of items) {
            for (const type of item.types) {
                await item.getType(type)
            }
        }
        await released
        if (rejection) {
            throw rejection
        }
    })
    return { release }
}

/** Reads the status line after the pending state changes were flushed, without waiting. */
function statusNow(root: HTMLElement): string {
    flushSync()
    return statusText(root)
}

interface Deferred<T> {
    promise: Promise<T>
    resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => {
        resolve = r
    })
    return { promise, resolve }
}

/** The one `ClipboardItem` the stub's `write` received, with both of its payloads read. */
async function writtenCard(clipboard: ClipboardStub): Promise<{
    item: ClipboardItem
    plain: string
    html: string
    htmlType: string
}> {
    expect(clipboard.write, 'clipboard.write was called').toHaveBeenCalledTimes(1)
    const [items] = clipboard.write.mock.calls[0]
    expect(items, 'one ClipboardItem').toHaveLength(1)
    const item = items[0]
    const plainBlob = await item.getType('text/plain')
    const htmlBlob = await item.getType('text/html')
    return { item, plain: await plainBlob.text(), html: await htmlBlob.text(), htmlType: htmlBlob.type }
}

function setCharacterImage(image: string): void {
    DBState.db.characters[0].image = image
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
}

let fetchStub: Mock<(input: string) => Promise<{ ok: boolean }>>

beforeEach(() => {
    window.innerWidth = 1024
    setupDb()
    selectedCharID.set(0)
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    fetchStub = vi.fn(async () => ({ ok: false }))
    vi.stubGlobal('fetch', fetchStub)
    vi.mocked(ParseMarkdown).mockImplementation(async (text: string) => text)
    vi.mocked(getCurrentCharacter).mockImplementation(
        () => DBState.db.characters[selIdState.selId] as never,
    )
    vi.mocked(getUserIcon).mockReturnValue('')
    vi.mocked(getUserName).mockReturnValue('User')
    encodeAvatar.mockImplementation(async () => AVATAR_DATA_URL)
})

afterEach(async () => {
    vi.useRealTimers()
    process.off('unhandledRejection', onUnhandled)
    stopListHost?.()
    stopListHost = null
    if (listApp !== null) {
        void unmount(listApp)
        listApp = null
    }
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    popupStore.children = null
    popupStore.openId = 0
    vi.unstubAllGlobals()
    if (realClipboard) {
        Object.defineProperty(navigator, 'clipboard', realClipboard)
    } else {
        Reflect.deleteProperty(navigator, 'clipboard')
    }
    vi.clearAllMocks()
})

//#endregion

describe('the harness', () => {
    test('guard: the popup menu opens and shows its other items, and ClipboardItem exists', async () => {
        stubClipboard()
        const { root } = await mountChat()

        await openMenu(root)

        expect(typeof ClipboardItem).toBe('function')
    })
})

describe('the "Copy as card" menu item', () => {
    test('is present with useChatCopy on, a non-blank message and ClipboardItem, and is not the plain copy button', async () => {
        stubClipboard()
        const { root } = await mountChat()

        await openMenu(root)

        const item = requireCopyCardItem()
        expect(item.classList.contains('button-icon-copy')).toBe(false)
        expect(item.textContent).toContain('Copy as card')
    })

    test('is present for the first message (idx -1)', async () => {
        stubClipboard()
        const { root } = await mountChat({ idx: -1, message: 'Welcome' })

        await openMenu(root)

        requireCopyCardItem()
    })

    test('guard: is absent when useChatCopy is off', async () => {
        stubClipboard()
        DBState.db.useChatCopy = false
        const { root } = await mountChat()

        await openMenu(root)

        expect(copyCardItem()).toBeNull()
    })

    test('guard: is absent when ClipboardItem does not exist', async () => {
        stubClipboard()
        vi.stubGlobal('ClipboardItem', undefined)
        const { root } = await mountChat()

        await openMenu(root)

        expect(copyCardItem()).toBeNull()
    })

    test('guard: is absent when navigator.clipboard.write does not exist', async () => {
        stubClipboard({ withWrite: false })
        const { root } = await mountChat()

        await openMenu(root)

        expect(copyCardItem()).toBeNull()
    })

    test('guard: is absent for a blank first message', async () => {
        stubClipboard()
        const { root } = await mountChat({ idx: -1, message: '' })

        await openMenu(root)

        expect(copyCardItem()).toBeNull()
    })
})

describe('a click on "Copy as card"', () => {
    test('calls clipboard.write synchronously with one ClipboardItem and never writeText', async () => {
        const clipboard = stubClipboard()
        const { root } = await mountChat()
        await openMenu(root)

        requireCopyCardItem().click()

        // No await between the click and these assertions: the write must happen
        // synchronously inside the handler to keep the user gesture.
        expect(clipboard.write).toHaveBeenCalledTimes(1)
        const [items] = clipboard.write.mock.calls[0]
        expect(items).toHaveLength(1)
        expect(items[0]).toBeInstanceOf(ClipboardItem)
        expect(items[0].types).toEqual(expect.arrayContaining(['text/plain', 'text/html']))

        await settle()
        expect(clipboard.write).toHaveBeenCalledTimes(1)
        expect(clipboard.writeText).not.toHaveBeenCalled()
    })

    test('puts the message copy text in text/plain', async () => {
        const clipboard = stubClipboard()
        const { root } = await mountChat()
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()

        const { plain } = await writtenCard(clipboard)
        expect(plain).toBe(MESSAGE)
    })

    test('puts a text/html card in text/html with the display name escaped, the footer and a model badge for a character message', async () => {
        const clipboard = stubClipboard()
        const { root } = await mountChat({
            name: '<b>Ann</b>',
            role: 'char',
            messageGenerationInfo: { model: 'some-model' },
        })
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()

        const { html, htmlType } = await writtenCard(clipboard)
        expect(htmlType).toBe('text/html')
        const doc = new DOMParser().parseFromString(html, 'text/html')
        expect(doc.querySelector('h3')?.textContent).toBe('<b>Ann</b>')
        expect(doc.querySelector('h3 b'), 'the name is text, not markup').toBeNull()
        expect(html).not.toContain('<b>Ann</b>')
        expect(html).toContain('From RisuTanium')
        expect(html).toContain('test-model')
    })

    test('shows the user name escaped and no model badge for a user message', async () => {
        const clipboard = stubClipboard()
        vi.mocked(getUserName).mockReturnValue('<b>Bob</b>')
        const { root } = await mountChat({
            name: 'Ann',
            role: 'user',
            messageGenerationInfo: { model: 'some-model' },
        })
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()

        const { html } = await writtenCard(clipboard)
        const doc = new DOMParser().parseFromString(html, 'text/html')
        expect(doc.querySelector('h3')?.textContent).toBe('<b>Bob</b>')
        expect(doc.querySelector('h3 b')).toBeNull()
        expect(html).toContain('From RisuTanium')
        expect(html).not.toContain('test-model')
    })

    test('captures the name and the avatar path at the click: a later change of the selected character does not change the card', async () => {
        const clipboard = stubClipboard()
        const encoding = deferred<string | null>()
        encodeAvatar.mockImplementation(() => encoding.promise)
        setCharacterImage('origavatar')
        const { root, props } = await mountChat({ name: 'OriginalName' })
        await openMenu(root)

        requireCopyCardItem().click()
        props.name = 'ChangedName'
        DBState.db.characters[0].name = 'ChangedName'
        setCharacterImage('newavatar')
        flushSync()
        await settle()

        expect(encodeAvatar).toHaveBeenCalledTimes(1)
        const [src] = encodeAvatar.mock.calls[0]
        expect(src).toContain('/sw/img/origavatar')
        expect(src).not.toContain('newavatar')
        expect(vi.mocked(getFileSrc).mock.calls.map(([path]) => path)).not.toContain('newavatar')

        encoding.resolve(AVATAR_DATA_URL)
        await settle()

        const { html } = await writtenCard(clipboard)
        expect(html).toContain('OriginalName')
        expect(html).not.toContain('ChangedName')
        expect(html).toContain(AVATAR_DATA_URL)
    })

    // fetch-only: happy-dom loads no images, so this says nothing about image
    // loads; it only pins that the click itself issues no fetch.
    test('keeps an outside body image address, leaves out a /proxy2 image, and fetches nothing (fetch-only)', async () => {
        const clipboard = stubClipboard()
        const message = 'look <img src="https://x.example/a.png"> and <img src="/proxy2?url=https://x.example/b.png"> here'
        const { root } = await mountChat({ message })
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()

        const { html } = await writtenCard(clipboard)
        expect(html).toContain('https://x.example/a.png')
        expect(html).not.toContain('/proxy2')
        expect(html).not.toContain('b.png')
        expect(fetchStub).not.toHaveBeenCalled()
    })
})

describe('the avatar of a card', () => {
    test('a user message uses the persona icon path, not the character image', async () => {
        const clipboard = stubClipboard()
        vi.mocked(getUserIcon).mockReturnValue('personaicon')
        setCharacterImage('characterimage')
        const { root } = await mountChat({ role: 'user' })
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()

        expect(encodeAvatar).toHaveBeenCalledTimes(1)
        const [src] = encodeAvatar.mock.calls[0]
        expect(src).toContain('/sw/img/personaicon')
        expect(src).not.toContain('characterimage')
        expect(vi.mocked(getFileSrc).mock.calls.map(([path]) => path)).not.toContain('characterimage')
        await writtenCard(clipboard)
    })

    test('an empty path never reaches the encoder or the file lookup, and the status is Copied', async () => {
        const clipboard = stubClipboard()
        vi.mocked(getUserIcon).mockReturnValue('')
        setCharacterImage('characterimage')
        const { root } = await mountChat({ role: 'user' })
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()

        expect(encodeAvatar).not.toHaveBeenCalled()
        expect(getFileSrc).not.toHaveBeenCalled()
        expect(clipboard.write).toHaveBeenCalledTimes(1)
        expect(statusText(root)).toBe(COPIED)
        expect(statusText(root)).not.toBe(COPIED_SIMPLE_CARD)
    })

    test('a character message with no image never reaches the encoder, and the status is Copied', async () => {
        stubClipboard()
        setCharacterImage('')
        const { root } = await mountChat({ role: 'char' })
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()

        expect(encodeAvatar).not.toHaveBeenCalled()
        expect(getFileSrc).not.toHaveBeenCalled()
        expect(statusText(root)).toBe(COPIED)
    })
})

describe('the status of a card copy', () => {
    test('a full card with its avatar says Copied', async () => {
        stubClipboard()
        setCharacterImage('origavatar')
        const { root } = await mountChat()
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()

        expect(encodeAvatar).toHaveBeenCalledTimes(1)
        expect(statusText(root)).toBe(COPIED)
    })

    test('a card whose avatar could not be encoded says Copied (simple card)', async () => {
        const clipboard = stubClipboard()
        encodeAvatar.mockImplementation(async () => null)
        setCharacterImage('origavatar')
        const { root } = await mountChat()
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()

        expect(encodeAvatar).toHaveBeenCalledTimes(1)
        expect(clipboard.write).toHaveBeenCalledTimes(1)
        expect(statusText(root)).toBe(COPIED_SIMPLE_CARD)
    })

    test('a ClipboardItem constructor that throws falls back to writeText with the copy text and says Copied as text', async () => {
        const clipboard = stubClipboard()
        const { root } = await mountChat()
        await openMenu(root)
        vi.stubGlobal('ClipboardItem', function ThrowingClipboardItem() {
            throw new Error('construction failed')
        })

        requireCopyCardItem().click()
        await settle()

        expect(clipboard.write).not.toHaveBeenCalled()
        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(clipboard.writeText).toHaveBeenCalledWith(MESSAGE)
        expect(statusText(root)).toBe(COPIED_AS_TEXT)
        expect(unhandled).toEqual([])
    })

    test('shows Loading right after the click and the error name with "Copy failed" when the write is rejected', async () => {
        const clipboard = stubClipboard()
        const gate = gateWrites(clipboard, new DOMException('denied', 'NotAllowedError'))
        const { root } = await mountChat()
        await openMenu(root)

        requireCopyCardItem().click()

        expect(statusNow(root)).toBe('Loading')
        await settle()
        expect(statusText(root)).toBe('Loading')

        gate.release()
        await settle()

        expect(statusText(root)).toBe('NotAllowedError: Copy failed')
        expect(unhandled).toEqual([])
    })
})

describe('the card copy and the plain copy button of one message', () => {
    test('a plain copy while the card write is pending is written again when the card write settles, and the status stays Copied', async () => {
        const clipboard = stubClipboard()
        const gate = gateWrites(clipboard)
        const { root } = await mountChat()
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()
        expect(clipboard.write).toHaveBeenCalledTimes(1)

        const plainButton = root.querySelector<HTMLElement>('.button-icon-copy')
        expect(plainButton, 'the plain copy button').not.toBeNull()
        plainButton!.click()
        await settle()

        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(clipboard.writeText).toHaveBeenLastCalledWith(MESSAGE)
        expect(statusText(root)).toBe(COPIED)

        gate.release()
        await settle()

        expect(clipboard.writeText).toHaveBeenCalledTimes(2)
        expect(clipboard.writeText).toHaveBeenLastCalledWith(MESSAGE)
        expect(statusText(root)).toBe(COPIED)
        expect(unhandled).toEqual([])
    })

    test('a second tap on the card item of the same message while its card is pending writes nothing more and shows Loading', async () => {
        const clipboard = stubClipboard()
        const gate = gateWrites(clipboard)
        const { root } = await mountChat()
        await openMenu(root)

        requireCopyCardItem().click()
        await settle()
        if (copyCardItem() === null) {
            await openMenu(root)
        }
        requireCopyCardItem().click()
        await settle()

        expect(clipboard.write).toHaveBeenCalledTimes(1)
        expect(statusText(root)).toBe('Loading')

        gate.release()
        await settle()
        expect(statusText(root)).toBe(COPIED)
    })
})
