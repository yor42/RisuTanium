/**
 * P8 (guard, new rule), P20 (guard, passes before and after), P21 (guard, passes before and after): the event pump of an
 * owned stream. A `stopped` event only notes its stamp: it feeds `onStamp` and `probe.stamp` and never closes the stream,
 * so the caller's own abort ends it. An `offset` on a chunk event changes nothing the page reads. An abandoned owned
 * request cancels natively once, and a `stopped` event that then has no pump asks for a reconcile and is not queued.
 *
 * Drives the REAL `fetchNative` with the module mocks of `globalApi.streamedFetch.svelte.test.ts` (copied: each suite
 * mocks its own graph). The Tauri bridge is a mock, so a passing test says nothing about native behaviour.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))
vi.mock(import('src/ts/platform'), () => ({ isTauri: true, isNodeServer: false, isIOS: () => false }) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})), setDatabase: vi.fn(), presetTemplate: { name: 'test-preset' }, defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test', appSubVer: 'test', getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} }, selectedCharID: writable(-1), selIdState: { selId: -1 }, alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false), botMakerMode: writable(false), loadedStore: writable(false), LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0), bodyIntercepterStore: [], savingStoppedReason: writable(null), frozenSaveKeysStore: writable([]),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(), alertConfirm: vi.fn(async () => true), alertError: vi.fn(), alertWait: vi.fn(), alertMd: vi.fn(), alertNormal: vi.fn(),
    alertSelect: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(), alertNormalWait: vi.fn(), alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }), waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(), checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 1))), sleepForever: vi.fn(() => new Promise<void>(() => {})),
}) as unknown as typeof import('src/ts/util'))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p), invoke: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'), join: vi.fn(async (...p: string[]) => p.join('/')), basename: vi.fn(async (p: string) => p.split('/').pop()),
}))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => {}) }))
vi.mock('src/ts/vendor/streamSaver', () => ({
    default: { useBlobFallback: false, createWriteStream: () => ({ ready: Promise.resolve(), writable: { getWriter: () => ({ write: async () => {}, close: async () => {} }) } }) },
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => { throw new Error('no operating-system plugin') } }))
const streamEvents = vi.hoisted(() => ({ emit: (_payload: string) => {} }))
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (_name: string, callback: (event: { payload: string }) => void) => {
        streamEvents.emit = (payload: string) => callback({ payload })
        return vi.fn()
    }),
}))
vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => {}) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => {}) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({ hasher: vi.fn((s: string) => s) }) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({ characterURLImport: vi.fn(), hubURL: 'https://example.invalid' }) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({ registerDbChangeEffects: vi.fn() }) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        async getItem(_key: string) { return null }
        async setItem(_key: string, _value: Uint8Array) {}
        async keys() { return [] as string[] }
        async removeItem(_key: string) {}
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/index.svelte'), () => ({}) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock(import('src/ts/process/scripts'), () => ({ risuChatParser: vi.fn((text: string) => text) }) as unknown as typeof import('src/ts/process/scripts'))
vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => {}) }) as unknown as typeof import('src/ts/process/modules'))
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({ getColdStorageItem: vi.fn() }) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

import { invoke } from '@tauri-apps/api/core'
import { fetchNative } from 'src/ts/globalApi.svelte'
import { resetInFlightForTest } from 'src/ts/process/inFlightWork'
import { bindGrant, issueNativeReplyGrant } from 'src/ts/nativeReply/grant'
import { createPumpProbe, isOrphanReplyEvent, type ReplyStamp } from 'src/ts/nativeReply/ownedBody'
import { resetPageStateForTests, setReconcileTrigger } from 'src/ts/nativeReply/pageState'

const invokeMock = vi.mocked(invoke)
const URL_ = 'https://api.example.invalid/v1/chat'
const KEY = '0b9c1a7e-0000-4000-8000-000000000001'
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const ticks = async (count = 6) => { for (let i = 0; i < count; i++) { await tick() } }
const emit = (id: string, event: Record<string, unknown>) => streamEvents.emit(JSON.stringify({ id, ...event }))
const parse = { kind: 'openai-chat' as const, deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }
const base = { target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha', generationInfo: {}, promptInfo: {}, escape: false, requestedMs: 1 }
const stoppedStamp: ReplyStamp = { key: KEY, outcome: 'stopped', stored: false }
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

let seq = 0
const startCalls = () => invokeMock.mock.calls.filter((call) => call[0] === 'streamed_fetch')
const cancelCalls = () => invokeMock.mock.calls.filter((call) => call[0] === 'cancel_streamed_fetch')

/** Starts an owned fetch and returns once the native invoke happened; the response resolves with the head. */
async function beginOwned(probe = createPumpProbe(), signal?: AbortSignal) {
    invokeMock.mockClear()
    const owner = bindGrant(issueNativeReplyGrant(KEY, base), parse)
    const pending = fetchNative(URL_, { body: '{}', chatId: `stopped-${seq++}`, nativeReply: owner, pumpProbe: probe, signal })
    for (let i = 0; i < 50 && startCalls().length === 0; i++) {
        await tick()
    }
    const id = (startCalls()[0]?.[1] as { id: string }).id
    emit(id, { type: 'owner', key: KEY, owned: true })
    emit(id, { type: 'headers', body: { 'content-type': 'text/event-stream' }, status: 200 })
    const response = await pending
    return { id, probe, response }
}

/** True when the read is still waiting after the pump had time to run. */
async function stillOpen(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<boolean> {
    const read = reader.read()
    const settled = await Promise.race([read.then(() => true), tick().then(() => false)])
    if (settled) {
        return false
    }
    // Leave the read pending for the caller: a later event or abort settles it.
    pendingRead = read
    return true
}
let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null

beforeEach(async () => {
    resetInFlightForTest()
    resetPageStateForTests()
    pendingRead = null
    invokeMock.mockReset()
    invokeMock.mockImplementation((command: string) => command === 'streamed_fetch'
        ? new Promise<string>(() => {})
        : Promise.resolve(undefined))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await tick()
})

afterEach(() => {
    vi.restoreAllMocks()
    resetInFlightForTest()
    setReconcileTrigger(null)
})

describe('P8: a stopped event only notes its stamp', () => {
    test('the stamp reaches probe.stamp and onStamp once, the stream stays open, the caller abort closes it quietly', async () => {
        const probe = createPumpProbe()
        const onStamp = vi.fn()
        probe.onStamp = onStamp
        const controller = new AbortController()
        const { id, response } = await beginOwned(probe, controller.signal)
        const reader = response.body!.getReader()

        emit(id, { type: 'stopped', reply: stoppedStamp })
        await ticks()

        expect(probe.stamp).toEqual(stoppedStamp)
        expect(onStamp).toHaveBeenCalledTimes(1)
        expect(onStamp).toHaveBeenCalledWith(stoppedStamp)
        expect(await stillOpen(reader)).toBe(true)

        controller.abort()
        await expect(pendingRead).resolves.toEqual({ done: true, value: undefined })
    })

    test('a probe with no onStamp (a non-stream request) also receives the stopped stamp; end and error stamps are unchanged', async () => {
        const probe = createPumpProbe()
        const { id } = await beginOwned(probe)
        emit(id, { type: 'stopped', reply: stoppedStamp })
        await ticks()
        expect(probe.stamp).toEqual(stoppedStamp)

        const doneStamp: ReplyStamp = { key: KEY, outcome: 'done', stored: true }
        emit(id, { type: 'end', reply: doneStamp })
        await ticks()
        expect(probe.stamp).toEqual(doneStamp)
    })

    test('an error event stamp reaches onStamp too', async () => {
        const probe = createPumpProbe()
        const onStamp = vi.fn()
        probe.onStamp = onStamp
        const { id } = await beginOwned(probe)
        const failed: ReplyStamp = { key: KEY, outcome: 'failed', stored: false, announced: true }
        emit(id, { type: 'error', body: 'lost', reply: failed })
        await ticks()
        expect(onStamp).toHaveBeenCalledWith(failed)
    })
})

describe('P20: an offset on a chunk event changes nothing the page reads', () => {
    test('the stream carries the same bytes with and without offset, and the event is not an orphan', async () => {
        const { id, response } = await beginOwned()
        const reader = response.body!.getReader()
        emit(id, { type: 'chunk', body: b64('hello '), offset: 0 })
        emit(id, { type: 'chunk', body: b64('world') })
        emit(id, { type: 'end' })
        const decoder = new TextDecoder()
        let text = ''
        for (;;) {
            const { done, value } = await reader.read()
            if (done) {
                break
            }
            text += decoder.decode(value, { stream: true })
        }
        expect(text).toBe('hello world')
        expect(isOrphanReplyEvent({ type: 'chunk', body: b64('x'), id: 'a', offset: 11 })).toBe(false)
        expect(isOrphanReplyEvent({ type: 'chunk', body: b64('x'), id: 'a' })).toBe(false)
    })
})

describe('P21: the mechanism an abandon relies on', () => {
    test('probe.abandon cancels natively once; a stopped event for the id then asks for a reconcile and is not queued', async () => {
        const trigger = vi.fn()
        setReconcileTrigger(trigger)
        const { id, probe, response } = await beginOwned()
        const reader = response.body!.getReader()

        probe.abandon!()
        probe.abandon!()
        await ticks()
        expect(cancelCalls()).toHaveLength(1)
        expect(cancelCalls()[0][1]).toEqual({ id })
        expect(trigger).not.toHaveBeenCalled()

        emit(id, { type: 'stopped', reply: stoppedStamp })
        expect(trigger).toHaveBeenCalledTimes(1)
        await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    })
})
