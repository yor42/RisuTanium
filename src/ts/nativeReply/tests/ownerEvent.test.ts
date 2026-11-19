/**
 * T17 (guard, new rule): how `fetchNative` takes and reports a reply owner. The owner is taken once at the invoke and
 * only from a bound grant; a lookalike, an untrusted request and an ineligible send add nothing to the invoke. The
 * owner event decides `owned`; a refusal marks the key unowned. T22 (guard): an owned request's `stopped` or stamped
 * event for an id with no pump asks for a reconcile, and no other orphan does. Mutant M29 treats `owned:false` as owned,
 * M34 ignores the stopped event.
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
const transport = vi.hoisted(() => ({ android: false }))
vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, isAndroidTransport: () => transport.android }
})
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
import { fetchNative, globalFetch } from 'src/ts/globalApi.svelte'
import { resetInFlightForTest } from 'src/ts/process/inFlightWork'
import { bindGrant, issueNativeReplyGrant } from 'src/ts/nativeReply/grant'
import { createPumpProbe } from 'src/ts/nativeReply/ownedBody'
import { heldReply, resetPageStateForTests, setReconcileTrigger } from 'src/ts/nativeReply/pageState'

const invokeMock = vi.mocked(invoke)
const URL_ = 'https://api.example.invalid/v1/chat'
const KEY = '0b9c1a7e-0000-4000-8000-000000000001'
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const emit = (id: string, event: Record<string, unknown>) => streamEvents.emit(JSON.stringify({ id, ...event }))
const parse = { kind: 'openai-chat' as const, deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }
const base = { target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha', generationInfo: {}, promptInfo: {}, escape: false, requestedMs: 1 }

let seq = 0
const startCalls = () => invokeMock.mock.calls.filter((call) => call[0] === 'streamed_fetch')

async function begin(arg: Parameters<typeof fetchNative>[1] = {}, internal?: Parameters<typeof fetchNative>[2]) {
    invokeMock.mockClear()
    const pending = fetchNative(URL_, { body: '{}', chatId: `owner-${seq++}`, ...arg }, internal).catch(() => null)
    for (let i = 0; i < 50 && startCalls().length === 0; i++) {
        await tick()
    }
    const args = startCalls()[0]?.[1] as { id: string, replyOwner?: unknown } | undefined
    return { pending, args }
}

beforeEach(async () => {
    transport.android = false
    resetInFlightForTest()
    resetPageStateForTests()
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
})

describe('the reply owner at the invoke', () => {
    test('a bound owner is passed once, with its key, page version and blob, and marks the key invoked', async () => {
        const grant = issueNativeReplyGrant(KEY, base)
        const owner = bindGrant(grant, parse)
        const probe = createPumpProbe()
        const { args } = await begin({ nativeReply: owner, pumpProbe: probe })
        expect(args?.replyOwner).toMatchObject({ key: KEY, pageVersion: 1 })
        expect(JSON.parse((args?.replyOwner as { blob: string }).blob)).toMatchObject({ target: { chaId: 'cha', chatId: 'chat' } })
        expect(heldReply(KEY)?.invoked).toBe(true)
        expect(probe.abandon).not.toBeNull()
        // The same owner is not taken again.
        const second = await begin({ nativeReply: owner })
        expect(second.args?.replyOwner).toBeUndefined()
    })

    test('a lookalike owner, an untrusted request and a send with no owner add nothing to the invoke', async () => {
        issueNativeReplyGrant(KEY, base)
        const forged = await begin({ nativeReply: { key: KEY } })
        expect(forged.args).toBeDefined()
        expect('replyOwner' in (forged.args as object)).toBe(false)
        expect(heldReply(KEY)?.invoked).toBe(false)

        const bound = bindGrant(issueNativeReplyGrant('11111111-0000-4000-8000-000000000002', base), parse)
        const untrusted = await begin({ nativeReply: bound }, { nativePolicy: { allowPrivate: false } })
        expect('replyOwner' in (untrusted.args as object)).toBe(false)

        const plain = await begin({})
        expect('replyOwner' in (plain.args as object)).toBe(false)
    })

    test('the owner event decides: owned keeps the key, a refusal marks it unowned', async () => {
        const probe = createPumpProbe()
        const owner = bindGrant(issueNativeReplyGrant(KEY, base), parse)
        const { args } = await begin({ nativeReply: owner, pumpProbe: probe })
        emit(args!.id, { type: 'owner', key: KEY, owned: true })
        await tick()
        expect(probe.owned).toBe(true)
        expect(heldReply(KEY)?.unowned).toBeUndefined()

        const refused = createPumpProbe()
        const second = '22222222-0000-4000-8000-000000000003'
        const owner2 = bindGrant(issueNativeReplyGrant(second, base), parse)
        const { args: args2 } = await begin({ nativeReply: owner2, pumpProbe: refused })
        emit(args2!.id, { type: 'owner', key: second, owned: false, reason: 'exists' })
        await tick()
        expect(refused.owned).toBe(false)
        expect(heldReply(second)?.unowned).toBe(true)
    })

    test('the head and the end stamp reach the probe', async () => {
        const probe = createPumpProbe()
        const owner = bindGrant(issueNativeReplyGrant(KEY, base), parse)
        const { args } = await begin({ nativeReply: owner, pumpProbe: probe })
        emit(args!.id, { type: 'headers', body: { 'content-type': 'application/json' }, status: 201 })
        emit(args!.id, { type: 'end', reply: { key: KEY, outcome: 'done', stored: true } })
        for (let i = 0; i < 5; i++) { await tick() }
        expect(probe.head).toEqual({ status: 201, headers: { 'content-type': 'application/json' } })
        expect(probe.stamp).toEqual({ key: KEY, outcome: 'done', stored: true })
    })
})

describe('the native notice arm (guard, new rule)', () => {
    afterEach(() => {
        delete window.__risuTaniumReplyNotificationsHost
    })

    test('a grant with a payload arms the host with the token the invoke carries, before the invoke, once', async () => {
        const order: string[] = []
        const armNative = vi.fn((_token: number, _json: string) => { order.push('arm') })
        window.__risuTaniumReplyNotificationsHost = { armNative }
        invokeMock.mockImplementation((command: string) => {
            if (command === 'streamed_fetch') {
                order.push('invoke')
                return new Promise<string>(() => {})
            }
            return Promise.resolve(undefined)
        })
        const owner = bindGrant(issueNativeReplyGrant(KEY, base, '{"v":1,"marker":true}'), parse)
        const { args } = await begin({ nativeReply: owner, pumpProbe: createPumpProbe() })
        const token = (args?.replyOwner as { noticeToken?: number }).noticeToken
        expect(token).toBeGreaterThan(0)
        expect(armNative).toHaveBeenCalledTimes(1)
        expect(armNative).toHaveBeenCalledWith(token, '{"v":1,"marker":true}')
        expect(order).toEqual(['arm', 'invoke'])
        // The owner is taken once, so a second use arms nothing.
        await begin({ nativeReply: owner })
        expect(armNative).toHaveBeenCalledTimes(1)
    })

    test('a grant without a payload, a lookalike and an untrusted request arm nothing and add no token', async () => {
        const armNative = vi.fn()
        window.__risuTaniumReplyNotificationsHost = { armNative }
        const plain = bindGrant(issueNativeReplyGrant(KEY, base), parse)
        const { args } = await begin({ nativeReply: plain, pumpProbe: createPumpProbe() })
        expect('noticeToken' in (args?.replyOwner as object)).toBe(false)

        const armed = bindGrant(issueNativeReplyGrant('11111111-0000-4000-8000-000000000002', base, '{}'), parse)
        const untrusted = await begin({ nativeReply: armed }, { nativePolicy: { allowPrivate: false } })
        expect('replyOwner' in (untrusted.args as object)).toBe(false)
        const forged = await begin({ nativeReply: { key: KEY } })
        expect('replyOwner' in (forged.args as object)).toBe(false)
        expect(armNative).not.toHaveBeenCalled()
    })

    test('a host that throws on the arm does not stop the request', async () => {
        window.__risuTaniumReplyNotificationsHost = { armNative: () => { throw new Error('bridge gone') } }
        const owner = bindGrant(issueNativeReplyGrant(KEY, base, '{}'), parse)
        const { args } = await begin({ nativeReply: owner, pumpProbe: createPumpProbe() })
        expect(args?.replyOwner).toMatchObject({ key: KEY })
    })
})

describe('the failure result carries the stamp (T3: guard, new rule)', () => {
    const failedStamp = { key: KEY, outcome: 'failed', stored: false, announced: true }

    /** The streamed_fetch command settles when the test calls `settle`, as the native command does. */
    function controlledCommand(): { settle: (result: Record<string, unknown>) => void } {
        let settle: (result: Record<string, unknown>) => void = () => {}
        invokeMock.mockImplementation((command: string) => command === 'streamed_fetch'
            ? new Promise<string>((resolve) => { settle = (result) => resolve(JSON.stringify(result)) })
            : Promise.resolve(undefined))
        return { settle: (result) => settle(result) }
    }

    test('a: the error event first and a result without a reply keep the stamp', async () => {
        const command = controlledCommand()
        const probe = createPumpProbe()
        const owner = bindGrant(issueNativeReplyGrant(KEY, base), parse)
        const { args } = await begin({ nativeReply: owner, pumpProbe: probe })
        emit(args!.id, { type: 'error', body: 'connection refused', reply: failedStamp })
        for (let i = 0; i < 5; i++) { await tick() }
        expect(probe.stamp).toEqual(failedStamp)
        command.settle({ success: false, body: 'connection refused' })
        for (let i = 0; i < 5; i++) { await tick() }
        expect(probe.stamp).toEqual(failedStamp)
    })

    test('b: a result that carries the stamp sets it when no event did', async () => {
        const command = controlledCommand()
        const probe = createPumpProbe()
        const owner = bindGrant(issueNativeReplyGrant(KEY, base), parse)
        await begin({ nativeReply: owner, pumpProbe: probe })
        command.settle({ success: false, body: 'connection refused', reply: failedStamp })
        for (let i = 0; i < 5; i++) { await tick() }
        expect(probe.stamp).toEqual(failedStamp)
    })

    test('c: no stamp in the event or the result leaves it null, as before', async () => {
        const command = controlledCommand()
        const probe = createPumpProbe()
        const owner = bindGrant(issueNativeReplyGrant(KEY, base), parse)
        const { args } = await begin({ nativeReply: owner, pumpProbe: probe })
        emit(args!.id, { type: 'error', body: 'refused' })
        command.settle({ success: false, body: 'refused' })
        for (let i = 0; i < 5; i++) { await tick() }
        expect(probe.stamp).toBeNull()
    })

    test('d: a later event without a reply never clears a stamp the result set', async () => {
        const command = controlledCommand()
        const probe = createPumpProbe()
        const owner = bindGrant(issueNativeReplyGrant(KEY, base), parse)
        const { args } = await begin({ nativeReply: owner, pumpProbe: probe })
        command.settle({ success: false, body: 'x', reply: failedStamp })
        for (let i = 0; i < 5; i++) { await tick() }
        emit(args!.id, { type: 'error', body: 'x' })
        for (let i = 0; i < 5; i++) { await tick() }
        expect(probe.stamp).toEqual(failedStamp)
    })
})

describe('the local-network route', () => {
    test('an OpenAI-compatible request to a LAN address on Android carries the reply owner', async () => {
        transport.android = true
        const owner = bindGrant(issueNativeReplyGrant(KEY, base), parse)
        invokeMock.mockClear()
        const pending = globalFetch('http://192.168.1.20:8080/v1/chat/completions', {
            body: { model: 'm' },
            networkRoute: 'local_network',
            deliverWhileFrozen: true,
            nativeReply: owner,
            chatId: `owner-${seq++}`,
        }).catch(() => null)
        for (let i = 0; i < 50 && startCalls().length === 0; i++) {
            await tick()
        }
        const args = startCalls()[0]?.[1] as { replyOwner?: { key: string } } | undefined
        expect(args?.replyOwner).toMatchObject({ key: KEY, pageVersion: 1 })
        expect(heldReply(KEY)?.invoked).toBe(true)
        void pending
    })
})

describe('events with no pump', () => {
    test('a stopped or stamped event for an unknown id asks for a reconcile; a plain chunk does not', async () => {
        const trigger = vi.fn()
        setReconcileTrigger(trigger)
        emit('gone-1', { type: 'chunk', body: '' })
        emit('gone-1', { type: 'headers', body: {}, status: 200 })
        expect(trigger).not.toHaveBeenCalled()
        emit('gone-1', { type: 'stopped', reply: { key: KEY, outcome: 'stopped', stored: false } })
        expect(trigger).toHaveBeenCalledTimes(1)
        emit('gone-2', { type: 'end', reply: { key: KEY, outcome: 'done', stored: true } })
        expect(trigger).toHaveBeenCalledTimes(2)
    })

    test('a stopped event with no reply field still asks for a reconcile', () => {
        const trigger = vi.fn()
        setReconcileTrigger(trigger)
        emit('gone-3', { type: 'stopped' })
        expect(trigger).toHaveBeenCalledTimes(1)
    })
})
