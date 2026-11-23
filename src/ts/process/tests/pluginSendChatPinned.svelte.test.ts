/**
 * The v3 plugin API's `risuai.sendChat` pins the chat that is selected when it is called: the permission prompt can
 * outlast a chat switch, so the message and the reply go to the pinned chat, and only that chat's own work, a native
 * reply for it, or the composer's window in it refuses the call. Every check that throws runs before the work
 * registration begins, so no refused call leaves one behind.
 *
 * Test kinds: V1, V2, V4, V8 and V9 are regression reproducers for the global flag and the re-read selection;
 * the hint assertion of V7 is a reproducer too (the base passes no hint). V3, V5, V6, V10 and the message half of V7
 * are compatibility guards. Each case passes its own plugin script, because the session permission cache is keyed by
 * the hash of the script.
 *
 * Built like pluginSendChatColdGuard.svelte.test.ts: the REAL `makeRisuaiAPIV3`, the real `activeUnits`, the real
 * work registry and the real runningReplies map; the rest of what `v3.svelte.ts` imports is mocked.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins/plugins.svelte'

//#region module mocks, as in pluginSendChatColdGuard.svelte.test.ts

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
// Content-derived, matching the real hasher's determinism: distinct plugin
// scripts always produce distinct hashes, which is what keeps the guard and
// control cases below from sharing one permission-cache entry.
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
const processSendChatMock = vi.hoisted(() => vi.fn(async () => {}))
const getModelInfoMock = vi.hoisted(() => vi.fn(() => ({ id: 'test-model' }) as unknown))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: { providers: new Map() },
    getV2PluginAPIs: () => ({
        safeLocalStorage: {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            keys: vi.fn(),
        },
    }),
    handlePluginInstallViaPlugin: vi.fn(),
    pluginV2: { providers: new Map(), chatOutput: new Set() },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../plugins/apiV3/factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../../plugins/apiV3/factory'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({}) as unknown),
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../plugins/pluginSafeClass'), () => ({
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../../plugins/pluginSafeClass'))

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../alert'), () => ({
    alertConfirm: alertConfirmMock,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {},
    getFetchLogs: vi.fn(),
    // AV-3: getFileSrcCached calls this predicate.
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../gui/colorscheme'))

vi.mock(import('../../platform'), () => ({
    isNodeServer: false,
    isTauri: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../mcp/pluginmcp'))

// The reader/writer this test doesn't exercise -- kept as bare stubs so
// `v3.svelte.ts` can import it without pulling in the real module's Tauri
// fs / globalApi.svelte dependency graph.
vi.mock(import('../coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('../coldstorage.svelte'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../translator/translator'))

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: hasherMock,
    risuChatParser: vi.fn(),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../model/types'), () => ({
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: {},
    LLMTokenizer: {},
}) as unknown as typeof import('../../model/types'))

vi.mock(import('../index.svelte'), () => ({
    sendChat: processSendChatMock,
    doingChat: writable(false),
}) as unknown as typeof import('../index.svelte'))

vi.mock(import('../scripts'), () => ({
    processScriptFull: vi.fn(),
}) as unknown as typeof import('../scripts'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: getModelInfoMock,
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../request/request'), () => ({
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../request/request'))

vi.mock(import('../modules'), () => ({
    getModuleLorebooks: vi.fn(),
}) as unknown as typeof import('../modules'))

vi.mock(import('../ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('../ttsHooks'))

//#endregion

import { makeRisuaiAPIV3 } from '../../plugins/apiV3/v3.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { hasAnyWork } from '../chatOrigin'
import { coldStorageHeader } from '../coldstorageData'
import { addRunningReplies, resetRunningRepliesForTests } from '../../nativeReply/runningReplies.svelte'
import { clearRunningSends, simulateRunningSend } from './activeUnits.test-helpers'

function makePlugin(name: string): RisuPlugin {
    return {
        name,
        script: `script-of-${name}`,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

function makeChar(chaId: string, chatId?: string): { chaId: string, name: string, type: string, chatPage: number, chats: { id?: string, message: { role: string, data: string, time: number }[], note: string, name: string, localLore: unknown[] }[] } {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [{ ...(chatId ? { id: chatId } : {}), message: [{ role: 'char', data: 'first', time: 1 }], note: '', name: '', localLore: [] }],
    }
}

function installWorld(...chars: ReturnType<typeof makeChar>[]): void {
    DBState.db = { characters: chars } as unknown as Database
}

const dataOf = (charIndex: number) => DBState.db.characters[charIndex].chats[0].message.map((message) => message.data)

describe('risuai.sendChat pins the chat selected at the call', () => {
    beforeEach(() => {
        alertConfirmMock.mockReset()
        alertConfirmMock.mockImplementation(async () => true)
        processSendChatMock.mockClear()
        getModelInfoMock.mockReset()
        getModelInfoMock.mockImplementation(() => ({ id: 'test-model' }))
        clearRunningSends()
        resetRunningRepliesForTests()
    })

    afterEach(() => {
        clearRunningSends()
        resetRunningRepliesForTests()
    })

    test('V1: the message and the reply go to the chat selected at the call, not the one selected after the prompt', async () => {
        installWorld(makeChar('char-a', 'chat-a'), makeChar('char-b', 'chat-b'))
        selectedCharID.set(0)
        alertConfirmMock.mockImplementationOnce(async () => {
            selectedCharID.set(1)
            return true
        })
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('v1'))

        await expect(api.sendChat('hi')).resolves.toBe(true)

        expect(dataOf(0)).toEqual(['first', 'hi'])
        expect(dataOf(1)).toEqual(['first'])
        const arg = processSendChatMock.mock.calls[0] as unknown as [number, { origin: { chaId: string, chatId: string }, originHint: { owner: unknown, chat: unknown } }]
        expect(arg[0]).toBe(-1)
        expect(arg[1].origin).toMatchObject({ chaId: 'char-a', chatId: 'chat-a' })
        expect(arg[1].originHint.owner).toBe(DBState.db.characters[0])
        expect(arg[1].originHint.chat).toBe(DBState.db.characters[0].chats[0])
    })

    test('V2: a unit held in another chat does not refuse the call', async () => {
        installWorld(makeChar('char-a', 'chat-a'), makeChar('char-b', 'chat-b'))
        selectedCharID.set(0)
        simulateRunningSend({ chaId: 'char-b', chatId: 'chat-b' })
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('v2'))

        await expect(api.sendChat('hi')).resolves.toBe(true)

        expect(dataOf(0)).toEqual(['first', 'hi'])
        expect(processSendChatMock).toHaveBeenCalledTimes(1)
    })

    test('V3: guard: a unit held in the pinned chat rejects with the existing text and pushes nothing', async () => {
        installWorld(makeChar('char-a', 'chat-a'))
        selectedCharID.set(0)
        simulateRunningSend({ chaId: 'char-a', chatId: 'chat-a' })
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('v3'))

        await expect(api.sendChat('hi')).rejects.toThrow('A chat is already in progress')

        expect(dataOf(0)).toEqual(['first'])
        expect(processSendChatMock).not.toHaveBeenCalled()
        expect(hasAnyWork()).toBe(false)
    })

    test('V4: a native entry for the pinned chat rejects and pushes nothing', async () => {
        installWorld(makeChar('char-a', 'chat-a'))
        selectedCharID.set(0)
        addRunningReplies([{ key: 'native-1', target: { chaId: 'char-a', chatId: 'chat-a', name: 'running' } }])
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('v4'))

        await expect(api.sendChat('hi')).rejects.toThrow('A chat is already in progress')

        expect(dataOf(0)).toEqual(['first'])
        expect(processSendChatMock).not.toHaveBeenCalled()
    })

    test('V5: guard: a plugin model rejects before any registration begins, on every call', async () => {
        installWorld(makeChar('char-a', 'chat-a'))
        selectedCharID.set(0)
        getModelInfoMock.mockImplementation(() => ({ id: 'pluginmodel:::x' }))
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('v5'))

        await expect(api.sendChat('hi')).rejects.toThrow('Sending chat with plugin-based model is currently blocked')
        expect(hasAnyWork()).toBe(false)
        await expect(api.sendChat('hi')).rejects.toThrow('Sending chat with plugin-based model is currently blocked')

        expect(hasAnyWork()).toBe(false)
        expect(dataOf(0)).toEqual(['first'])
        expect(processSendChatMock).not.toHaveBeenCalled()
    })

    test('V6: guard: nothing selected rejects with "No character selected" and registers nothing', async () => {
        installWorld(makeChar('char-a', 'chat-a'))
        selectedCharID.set(5)
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('v6'))

        await expect(api.sendChat('hi')).rejects.toThrow('No character selected')

        expect(hasAnyWork()).toBe(false)
        expect(processSendChatMock).not.toHaveBeenCalled()
    })

    test('V7: guard: with two live characters sharing an id, the message lands in the selected one and the hint is passed', async () => {
        installWorld(makeChar('dup', 'same'), makeChar('dup', 'same'))
        selectedCharID.set(1)
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('v7'))
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        await expect(api.sendChat('hi')).resolves.toBe(true)

        expect(dataOf(0)).toEqual(['first'])
        expect(dataOf(1)).toEqual(['first', 'hi'])
        const arg = processSendChatMock.mock.calls[0] as unknown as [number, { originHint: { owner: unknown } }]
        expect(arg[1].originHint.owner).toBe(DBState.db.characters[1])
    })

    // MC-3795: a pinned chat that is gone pushes nothing and throws the existing text.
    test('V8: a pinned chat without an id that is deleted during the prompt rejects and pushes nowhere', async () => {
        const char = makeChar('char-a')
        installWorld(char)
        selectedCharID.set(0)
        alertConfirmMock.mockImplementationOnce(async () => {
            const chats = DBState.db.characters[0].chats
            chats.splice(0, 1, { id: 'other-chat', message: [{ role: 'char', data: 'other', time: 1 }], note: '', name: '', localLore: [] })
            return true
        })
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('v8'))

        await expect(api.sendChat('hi')).rejects.toThrow('No active chat found')

        expect(dataOf(0)).toEqual(['other'])
        expect(hasAnyWork()).toBe(false)
        expect(processSendChatMock).not.toHaveBeenCalled()
    })

    // Regression reproducer for a refusal read from the selection after the prompt instead of the pinned chat.
    test('V9: a unit held in the chat selected after the prompt does not refuse a call pinned to another chat', async () => {
        installWorld(makeChar('char-a', 'chat-a'), makeChar('char-b', 'chat-b'))
        selectedCharID.set(0)
        simulateRunningSend({ chaId: 'char-b', chatId: 'chat-b' })
        alertConfirmMock.mockImplementationOnce(async () => {
            selectedCharID.set(1)
            return true
        })
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('v9'))

        await expect(api.sendChat('hi')).resolves.toBe(true)

        expect(dataOf(0)).toEqual(['first', 'hi'])
        expect(dataOf(1)).toEqual(['first'])
    })

    // E-r2-4: the cold re-check after the prompt is visible to the plugin as a rejection with the cold text.
    test('V10: a chat that goes cold during the prompt rejects with the cold-storage text, pushes nothing and registers nothing', async () => {
        installWorld(makeChar('char-a', 'chat-a'))
        selectedCharID.set(0)
        alertConfirmMock.mockImplementationOnce(async () => {
            DBState.db.characters[0].chats[0].message = [{ role: 'char', data: coldStorageHeader + 'v10-cold-key', time: 1 }]
            return true
        })
        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('v10'))

        await expect(api.sendChat('hi')).rejects.toThrow("This chat hasn't finished loading from cold storage yet")

        expect(DBState.db.characters[0].chats[0].message).toHaveLength(1)
        expect(hasAnyWork()).toBe(false)
        expect(processSendChatMock).not.toHaveBeenCalled()
    })
})
