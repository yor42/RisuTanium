/**
 * CHORE-07 -- the v3 plugin API's `risuai.sendChat`
 * (`src/ts/plugins/apiV3/v3.svelte.ts`) must refuse a chat whose first
 * message is still a live cold-storage pointer (`isColdChat`) BEFORE the
 * permission prompt (`getPluginPermission`) and BEFORE pushing the
 * plugin's message into `chat.message` -- not only after. The
 * `isColdChat` check in `sendChat` (`src/ts/process/index.svelte.ts`)
 * runs inside `processSendChat`, which this handler only calls
 * AFTER the permission prompt and the push have already happened.
 *
 * IMPORTANT:
 *  - Removing the guard lets `sendChat` fall through to
 *    `getPermission('sendChat')`, push the message onto `chat.message` and
 *    call `processSendChat`, resolving `true` instead of rejecting -- that
 *    resolve/reject difference, plus the `alertConfirm`/push/
 *    `processSendChat` calls it gates, is the behavioural signal the guard
 *    test below checks for.
 *  - `getPluginPermission` derives the plugin's identity from the `plugin`
 *    object passed into `makeRisuaiAPIV3` (its script, hashed), never from a
 *    `DBState.db.plugins` lookup, so the fixture below carries no
 *    `db.plugins` entry.
 *  - Assertions read through `DBState.db.characters[0]...` (the reactive
 *    Svelte 5 $state proxy), never through a raw plain-object reference
 *    held separately -- a write made through the proxy does not appear on
 *    a plain object that was merely used to construct the initial value
 *    assigned to `DBState.db`.
 *  - A CONTROL case below drives a NON-cold chat through the same API and
 *    asserts it DOES reach the permission prompt and DOES push/call
 *    `processSendChat`, proving this harness can observe both when they
 *    happen. The guard and control cases pass DIFFERENT plugin scripts (not
 *    only different names) into `makeRisuaiAPIV3`, so neither run is
 *    short-circuited by the session permission cache in `v3.svelte.ts`,
 *    which is keyed by the hash of the script plus the permission and
 *    persists for the lifetime of the test file since that module is only
 *    evaluated once -- if both cases shared one script, whichever ran first
 *    would cache the `sendChat` decision for that script hash, and the
 *    second run would take the cached-decision fast path regardless of test
 *    order, silently skipping `alertConfirm`.
 *
 * This file drives the REAL `makeRisuaiAPIV3` factory (exported from
 * `v3.svelte.ts` for exactly this purpose, so the guard can be exercised
 * without the iframe/SandboxHost bridge -- that bridge itself is not
 * covered here) and
 * the REAL, dependency-free `isColdChat` (`coldstorageData.ts`), through
 * `v3.svelte.ts`'s own import. Every other module `v3.svelte.ts` imports is
 * mocked below purely so the module can be constructed at all.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins/plugins.svelte'

//#region module mocks -- every static import of `v3.svelte.ts` other than
// `svelte/store`, `uuid`, `src/lang`, `coldstorageData.ts` and
// `pluginColdStorage.ts` (dependency-free/side-effect-free, left real), and
// the module under test itself.

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
// Content-derived, matching the real hasher's determinism: distinct plugin
// scripts always produce distinct hashes, which is what keeps the guard and
// control cases below from sharing one permission-cache entry.
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
const processSendChatMock = vi.hoisted(() => vi.fn(async () => {}))

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
    getModelInfo: vi.fn(() => ({ id: 'test-model' }) as unknown),
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
import { coldStorageHeader } from '../coldstorageData'

function makePlugin(name: string, script: string): RisuPlugin {
    return {
        name,
        script,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

function makePointerChatDb(coldKey: string): Database {
    return {
        characters: [{
            chaId: 'plugin-guard-char',
            name: 'Plugin Guard Character',
            type: 'character',
            chatPage: 0,
            chats: [{
                message: [{ time: 1, data: coldStorageHeader + coldKey, role: 'char' }],
                note: '',
                name: '',
                localLore: [],
            }],
        }],
    } as unknown as Database
}

function makeNormalChatDb(): Database {
    return {
        characters: [{
            chaId: 'plugin-control-char',
            name: 'Plugin Control Character',
            type: 'character',
            chatPage: 0,
            chats: [{
                message: [{ time: 1, data: 'a perfectly ordinary message', role: 'char' }],
                note: '',
                name: '',
                localLore: [],
            }],
        }],
    } as unknown as Database
}

describe('CHORE-07: risuai.sendChat refuses a cold chat before the permission prompt and before the push', () => {
    beforeEach(() => {
        alertConfirmMock.mockClear()
        hasherMock.mockClear()
        processSendChatMock.mockClear()
    })

    test('a cold chat rejects, never prompts for permission, and never pushes the message', async () => {
        const db = makePointerChatDb('plugin-guard-cold-key')
        DBState.db = db
        selectedCharID.set(0)

        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('guard-test-plugin', 'cold-guard-script'))

        const messageBefore = JSON.parse(JSON.stringify(DBState.db.characters[0].chats[0].message))

        await expect(api.sendChat('hello')).rejects.toThrow()

        expect(DBState.db.characters[0].chats[0].message).toEqual(messageBefore)
        expect(alertConfirmMock).not.toHaveBeenCalled()
        expect(hasherMock).not.toHaveBeenCalled()
        expect(processSendChatMock).not.toHaveBeenCalled()
    })

    test('CONTROL: a non-cold chat DOES reach the permission prompt and DOES push/call processSendChat', async () => {
        const db = makeNormalChatDb()
        DBState.db = db
        selectedCharID.set(0)

        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin('control-test-plugin', 'control-script'))

        const result = await api.sendChat('a control message')

        // Proves this harness CAN observe the permission prompt and the
        // push/processSendChat call when nothing refuses the send -- the
        // guard test's "not called" assertions above are meaningful only
        // because this control case shows they'd be `true` otherwise.
        expect(result).toBe(true)
        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(processSendChatMock).toHaveBeenCalledTimes(1)
        expect(DBState.db.characters[0].chats[0].message.at(-1)).toMatchObject({
            data: 'a control message',
            role: 'user',
        })
    })
})
