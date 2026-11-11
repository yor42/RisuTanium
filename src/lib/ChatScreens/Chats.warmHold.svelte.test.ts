// @vitest-environment jsdom

/**
 * The warm hold of the real legacy list `Chats.svelte`, under the real chat surface. The rows are a test-only probe
 * (`WarmHoldProbeRow`, through a `ChatMessageBoundary` mock): each makes its loader at init like `ChatBody`, scans a
 * blank body first and a rendered one after, and one row shows a warm deferred image. A gate probe, a loader made before
 * the list opens, tells whether the hold is active: it observes a warm node while a hold is active and asks for it at
 * once otherwise.
 *
 * Labels: G = guard (passes before and after the change); the other rows fail on the base or under their mutant.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'

const transport = vi.hoisted(() => ({ sizes: {} as Record<string, number> }))

vi.mock('../../ts/storage/tauriByteTransport', () => ({
    isAndroidTransport: () => true,
    statStoredSize: async (key: string) => transport.sizes[key] ?? 0,
}))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as unknown[], autoScrollToNewMessage: false, alwaysScrollToNewMessage: false, streamingDisplayOptimizationMode: 'off' } })
    return {
        DBState,
        selectedCharID: writable(-1),
        settingsOpen: writable(false),
        ReloadChatPointer: writable<Record<number, number>>({}),
        ReloadGUIPointer: writable(0),
        createSimpleCharacter: () => null,
    }
})
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedStateMessageIndex }
})
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
vi.mock('../../ts/media/charImageLookups', () => ({ useCharImageLookups: () => ({ get: () => '' }) }))
vi.mock('../../lang', () => ({ language: {} }))
vi.mock('./ChatMessageBoundary.svelte', async () => ({ default: (await import('../ChatShell/WarmHoldProbeRow.svelte')).default }))

import Chats from './Chats.svelte'
import { probeConfig } from '../ChatShell/WarmHoldProbeRow.svelte'
import { DBState, ReloadGUIPointer, selectedCharID, settingsOpen } from '../../ts/stores.svelte'
import { installChatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'
import { resetTopLevelChangesForTests } from '../../ts/storage/topLevelChanges'
import {
    DEFERRED_IMAGE_PLACEHOLDER_SRC, DEFERRED_IMAGE_SRC_ATTRIBUTE, androidAssetSizeVerdict, rememberWholeReadUrl, resetAssetUrlGateForTest,
} from '../../ts/storage/assetUrlGate'
import { createDeferredImageLoader, resetDeferredImagesForTest } from './deferredAssetImages'

const MIB = 1024 * 1024
const URL_OF = (key: string) => 'http://asset.localhost/' + key
let app: ReturnType<typeof Chats> | undefined
let target: HTMLElement
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
const props = $state({
    messages: character.chats![0].message,
    currentCharacter: character,
    onReroll: () => {},
    unReroll: () => {},
    currentUsername: 'User',
    userIcon: '',
    loadPages: 20,
    windowResetToken: 0,
})

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
async function showList() {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(Chats, { target, props })
    flushSync()
    await tick()
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

const rowImages = () => Array.from(target.querySelectorAll('img'))
const isDeferred = (img: HTMLImageElement) => img.getAttribute('src') === DEFERRED_IMAGE_PLACEHOLDER_SRC && img.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
const isObserved = (img: Element) => FakeObserver.instances.some((observer) => observer.observed.has(img))

/** A promise a test resolves by hand: the moment a slow row's parse ends. */
function heldPromise() {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

/** The list at rest: shown, with the opening hold already ended (the gate probe is real). */
async function showSettledList() {
    await showList()
    await frame()
    await frame()
    expect(await gateIsOn()).toBe(false)
}

/** Settings opens over the list and closes after a reload signal, which makes the return a rebuild. */
async function leaveAndReturnRebuilt() {
    settingsOpen.set(true)
    await tick()
    await tick()
    ReloadGUIPointer.update((value) => value + 1)
    settingsOpen.set(false)
    for (let i = 0; i < 4; i++) {
        await tick()
    }
    await settle()
}

function switchRoom() {
    character.chatPage = 1
    props.messages = character.chats![1].message
    flushSync()
}

beforeEach(async () => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    FakeObserver.instances = []
    transport.sizes = {}
    resetAssetUrlGateForTest()
    resetDeferredImagesForTest()
    resetTopLevelChangesForTests()
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    ReloadGUIPointer.set(0)
    installChatSurface()
    character.chatPage = 0
    character.chats![0].message = messages(6)
    character.chats![1].message = messages(6, 'o')
    props.messages = character.chats![0].message
    DBState.db.characters = [character]
    selectedCharID.set(0)
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
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    resetDeferredImagesForTest()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.replaceChildren()
})

describe('the hold is taken before the rows of a room exist', () => {
    test('CO1: on the first mount the row image of a warm URL is observed, not asked', async () => {
        await showList()
        const images = rowImages()
        expect(images).toHaveLength(1)
        expect(isDeferred(images[0])).toBe(true)
        expect(isObserved(images[0])).toBe(true)
        expect(await gateIsOn()).toBe(true)
    })

    test('CO2: a room change in the same instance holds the new room\'s rows too', async () => {
        await showSettledList()

        switchRoom()
        await tick()
        const images = rowImages()
        expect(images).toHaveLength(1)
        expect(isDeferred(images[0])).toBe(true)
        expect(isObserved(images[0])).toBe(true)
        expect(await gateIsOn()).toBe(true)
    })
})

describe('the hold ends with the list signal', () => {
    test('CO3: a room change lasts two frames, a first mount too', async () => {
        await showList()
        await frame()
        expect(await gateIsOn()).toBe(true)
        await frame()
        expect(await gateIsOn()).toBe(false)

        switchRoom()
        // A flush, not a tick: the async tick waits for a frame, which would use up one of the two the hold lasts.
        flushSync()
        await frame()
        expect(await gateIsOn()).toBe(true)
        await frame()
        expect(await gateIsOn()).toBe(false)
    })

    test('CO4: leaving the list before the frames releases the hold', async () => {
        await showList()
        expect(await gateIsOn()).toBe(true)

        await unmount(app!)
        app = undefined
        target.remove()
        expect(await gateIsOn()).toBe(false)
    })

    test('CO5 G: an append or a changed message in the same room takes no hold', async () => {
        await showSettledList()

        character.chats![0].message.push({ chatId: 'm6', role: 'user', data: '6' } as Message)
        flushSync()
        await tick()
        expect(await gateIsOn()).toBe(false)

        character.chats![0].message[5].data = 'changed'
        flushSync()
        await tick()
        expect(await gateIsOn()).toBe(false)
    })
})

describe('a row whose scan of rendered markup comes late', () => {
    test('CO6: a rebuild after a visit holds the remounted rows until the slow row has rendered', async () => {
        await showSettledList()

        const slow = heldPromise()
        probeConfig.slowIdx = 5
        probeConfig.slowGate = slow.promise
        await leaveAndReturnRebuilt()
        const images = rowImages()
        expect(images).toHaveLength(1)
        expect(isDeferred(images[0])).toBe(true)
        expect(isObserved(images[0])).toBe(true)
        await frame()
        expect(await gateIsOn()).toBe(true)

        slow.resolve()
        await settle()
        expect(isDeferred(rowImages()[0])).toBe(true)
        expect(isObserved(rowImages()[0])).toBe(true)
        expect(await gateIsOn()).toBe(false)
    })

    test('CO7: a slow row of a changed room that renders after the second frame is still decided under the hold', async () => {
        await showSettledList()

        const slow = heldPromise()
        probeConfig.slowIdx = 5
        probeConfig.slowGate = slow.promise
        switchRoom()
        await tick()
        await frame()
        await frame()
        expect(await gateIsOn()).toBe(true)
        expect(isDeferred(rowImages()[0])).toBe(true)

        slow.resolve()
        await settle()
        expect(isDeferred(rowImages()[0])).toBe(true)
        expect(isObserved(rowImages()[0])).toBe(true)
        expect(await gateIsOn()).toBe(false)
    })

    test('CO8 G: an update that arrives while Settings covers the list takes no hold', async () => {
        await showSettledList()

        settingsOpen.set(true)
        await tick()
        await tick()
        character.chats![0].message[5].data = 'changed'
        flushSync()
        await tick()
        expect(await gateIsOn()).toBe(false)
    })
})
