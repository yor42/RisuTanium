// @vitest-environment jsdom

/**
 * The warm hold of the real message list. The rows are a test-only probe (`WarmHoldProbeRow`): each makes its loader at
 * init like `ChatBody`, scans a blank body first and a rendered one after, and one row shows a warm deferred image. A
 * gate probe, a loader made before the list opens, tells whether the hold is active: it observes a warm node while a
 * hold is active and asks for it at once otherwise.
 *
 * Labels: G = guard (passes before and after the change); the other rows fail on the base or under their mutant.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'

let hiding: () => void = () => {}

const transport = vi.hoisted(() => ({ sizes: {} as Record<string, number> }))

vi.mock('../../ts/storage/tauriByteTransport', () => ({
    isAndroidTransport: () => true,
    statStoredSize: async (key: string) => transport.sizes[key] ?? 0,
}))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false,
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
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => false, onDraftsChanged: () => () => {} }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0, heldGui: 0, heldChat: {} as Record<number, number> })
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: (callback: () => void) => { hiding = callback; return () => {} } }
})
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', () => ({ language: { loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted' } }))
vi.mock('./ShellMessage.svelte', async () => ({ default: (await import('./WarmHoldProbeRow.svelte')).default }))

import ShellMessageList from './ShellMessageList.svelte'
import { probeConfig } from './WarmHoldProbeRow.svelte'
import { DBState, ScrollToMessageStore } from '../../ts/stores.svelte'
import { chatSurface as surface } from '../ChatScreens/chatSurface.svelte'
import {
    DEFERRED_IMAGE_PLACEHOLDER_SRC, DEFERRED_IMAGE_SRC_ATTRIBUTE, androidAssetSizeVerdict, rememberWholeReadUrl, resetAssetUrlGateForTest,
} from '../../ts/storage/assetUrlGate'
import { createDeferredImageLoader, resetDeferredImagesForTest } from '../ChatScreens/deferredAssetImages'

const MIB = 1024 * 1024
const CLIENT = 100
const URL_OF = (key: string) => 'http://asset.localhost/' + key
let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let top = 0
let height = 0
let gateIsOn: () => Promise<boolean> = async () => false

class FakeObserver {
    static instances: FakeObserver[] = []
    observed = new Set<Element>()
    constructor(public callback: IntersectionObserverCallback) {
        FakeObserver.instances.push(this)
    }
    observe(element: Element) { this.observed.add(element) }
    unobserve(element: Element) { this.observed.delete(element) }
    disconnect() { this.observed.clear() }
    fire(element: Element) {
        this.callback([{ target: element, isIntersecting: true }] as never, this as never)
    }
}
Object.defineProperty(FakeObserver.prototype, 'scrollMargin', { get: () => '' })

function messages(count: number, prefix = ''): Message[] {
    return Array.from({ length: count }, (_, i) => ({ chatId: `${prefix}m${i}`, role: i % 2 ? 'char' : 'user', data: String(i) }) as Message)
}
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: messages(6) }, { id: 'other', message: messages(6, 'o') }] }) as Character

async function settle() {
    for (let i = 0; i < 6; i++) {
        await Promise.resolve()
    }
    await tick()
}
async function frame() {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await tick()
}
async function show(startTop = 0, settleFrame = true) {
    top = startTop
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: () => height, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: CLIENT, configurable: true })
    Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { top = value }, configurable: true })
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host } })
    flushSync()
    await tick()
    if (settleFrame) await frame()
}

function deferredNode(key: string): HTMLImageElement {
    const img = document.createElement('img')
    img.setAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE, URL_OF(key))
    img.setAttribute('src', DEFERRED_IMAGE_PLACEHOLDER_SRC)
    img.setAttribute('loading', 'lazy')
    return img
}

/** Reports `img` to the observer that watches it. */
function reachNode(img: Element) {
    const observer = FakeObserver.instances.find((candidate) => candidate.observed.has(img))
    if (!observer) throw new Error('no observer watches the node')
    observer.fire(img)
}

/** Reads `key` once so that its URL is warm, by a loader that is gone afterwards. */
async function warmUrl(key: string, mib: number) {
    transport.sizes[key] = mib * MIB
    await androidAssetSizeVerdict(key)
    rememberWholeReadUrl(URL_OF(key), key)
    const loader = createDeferredImageLoader()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const img = deferredNode(key)
    root.appendChild(img)
    loader.scan(root)
    reachNode(img)
    await settle()
    img.dispatchEvent(new Event('load'))
    await settle()
    loader.dispose()
    root.remove()
}

/** A loader made before any hold, with a warm URL of its own. */
async function makeGateProbe(): Promise<() => Promise<boolean>> {
    await warmUrl('gate', 10)
    const probe = createDeferredImageLoader()
    const root = document.createElement('div')
    document.body.appendChild(root)
    return async () => {
        const node = deferredNode('gate')
        root.replaceChildren(node)
        probe.scan(root)
        await settle()
        const asked = node.getAttribute('src') === URL_OF('gate')
        if (asked) {
            node.dispatchEvent(new Event('load'))
            await settle()
        }
        root.replaceChildren()
        return !asked
    }
}

const rowImages = () => Array.from(host.querySelectorAll('img'))
const isDeferred = (img: HTMLImageElement) => img.getAttribute('src') === DEFERRED_IMAGE_PLACEHOLDER_SRC && img.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
const isObserved = (img: Element) => FakeObserver.instances.some((observer) => observer.observed.has(img))

/** A promise a test resolves by hand: the moment a slow row's parse ends. */
function heldPromise() {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

function leaveAndReturnRebuilt() {
    hiding()
    surface.hidden = true
    flushSync()
    surface.rebuildEpoch += 1
    surface.hidden = false
    flushSync()
}

beforeEach(async () => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    FakeObserver.instances = []
    transport.sizes = {}
    resetAssetUrlGateForTest()
    resetDeferredImagesForTest()
    height = 1000
    surface.hidden = false
    surface.rebuildEpoch = 0
    character.chatPage = 0
    character.chats![0].message = messages(6)
    character.chats![1].message = messages(6, 'o')
    DBState.db.chatLoadInitialPages = 2
    DBState.db.autoScrollToNewMessage = true
    ScrollToMessageStore.value = -1
    probeConfig.url = URL_OF('a')
    probeConfig.imageIdx = 5
    probeConfig.slowIdx = null
    probeConfig.slowGate = null
    await warmUrl('a', 10)
    gateIsOn = await makeGateProbe()
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    resetDeferredImagesForTest()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
})

describe('the hold is taken before the rows of a chat exist', () => {
    test('SO1: on the first mount the row image of a warm URL is observed, not asked', async () => {
        await show(0, false)
        const images = rowImages()
        expect(images).toHaveLength(1)
        expect(isDeferred(images[0])).toBe(true)
        expect(isObserved(images[0])).toBe(true)
    })

    test('SO2: a chat switch in the same instance holds the new chat\'s rows too', async () => {
        await show(0)
        expect(await gateIsOn()).toBe(false)

        character.chatPage = 1
        flushSync()
        await tick()
        const images = rowImages()
        expect(images).toHaveLength(1)
        expect(isDeferred(images[0])).toBe(true)
        expect(isObserved(images[0])).toBe(true)
        expect(await gateIsOn()).toBe(true)
    })
})

describe('the hold ends with the list signal', () => {
    test('SO3: it lasts until the frame pass of the opening and ends there when every row has rendered', async () => {
        await show(0, false)
        expect(await gateIsOn()).toBe(true)

        await frame()
        expect(await gateIsOn()).toBe(false)
    })

    test('SO4: a switch before the frame replaces the hold; the new chat\'s frame ends it with no timer', async () => {
        await show(0, false)
        character.chatPage = 1
        flushSync()
        await tick()
        expect(await gateIsOn()).toBe(true)

        await frame()
        expect(await gateIsOn()).toBe(false)
    })

    test('SO5: leaving the list before the frame releases the hold', async () => {
        await show(0, false)
        expect(await gateIsOn()).toBe(true)

        await unmount(app!)
        app = undefined
        target.remove()
        expect(await gateIsOn()).toBe(false)
    })

    test('SO6 G: a frame pass that is skipped because the reader moved still ends the hold', async () => {
        await show(0, false)
        top = 250
        await frame()

        expect(top).toBe(250)
        expect(await gateIsOn()).toBe(false)
    })

    test('SO7 G: an append in the same chat takes no hold', async () => {
        await show(0)
        expect(await gateIsOn()).toBe(false)

        character.chats![0].message.push({ chatId: 'm6', role: 'user', data: '6' } as Message)
        flushSync()
        await tick()
        expect(await gateIsOn()).toBe(false)
    })
})

describe('a row whose scan of rendered markup comes late', () => {
    test('SO8: a rebuild after a visit holds the remounted rows until the slow row has rendered', async () => {
        await show(0)
        expect(await gateIsOn()).toBe(false)

        const slow = heldPromise()
        probeConfig.slowIdx = 5
        probeConfig.slowGate = slow.promise
        leaveAndReturnRebuilt()
        await tick()
        await frame()
        const images = rowImages()
        expect(images).toHaveLength(1)
        expect(isDeferred(images[0])).toBe(true)
        expect(await gateIsOn()).toBe(true)

        slow.resolve()
        await settle()
        expect(isDeferred(rowImages()[0])).toBe(true)
        expect(isObserved(rowImages()[0])).toBe(true)
        expect(await gateIsOn()).toBe(false)
    })

    test('SO9: a slow row that renders after the frame pass is still decided under the hold', async () => {
        const slow = heldPromise()
        probeConfig.slowIdx = 5
        probeConfig.slowGate = slow.promise
        await show(0, false)
        await frame()
        expect(await gateIsOn()).toBe(true)
        expect(isDeferred(rowImages()[0])).toBe(true)

        slow.resolve()
        await settle()
        expect(isDeferred(rowImages()[0])).toBe(true)
        expect(isObserved(rowImages()[0])).toBe(true)
        expect(await gateIsOn()).toBe(false)
    })
})
