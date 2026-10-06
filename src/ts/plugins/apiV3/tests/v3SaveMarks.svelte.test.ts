/**
 * Report 17 ("CHORE-01 + Phase 2 item 2") Stage 1 §3.3/§3.4:
 *
 * S2: real V3 `setCharacterToIndex` on a NON-selected index -- persisted
 * through the IDENTITY TRACKER (dbChangeEffects.svelte.ts), with no explicit
 * mark call in `setCharacterToIndex` itself (plan §3.3 table: "No explicit
 * mark; the identity tracker covers it").
 *
 * S4: real, extracted `setChatToIndexImpl` on a NON-selected character --
 * persisted through an EXPLICIT `markCharacterForSave` call after the write
 * (plan §3.3 table).
 *
 * Both drive the REAL `src/ts/plugins/apiV3/v3.svelte.ts`, the REAL
 * `registerDbChangeEffects`, the REAL `characterSaveMarks.ts`, and the REAL
 * `RisuSaveEncoder` (encode -> decode round trip, since the plan's S3.4 table
 * marks both rows "persisted"). The module-mock set below is copied,
 * unchanged in shape, from
 * `src/ts/process/tests/pluginSendChatColdGuard.svelte.test.ts` (the existing
 * precedent for loading the real, otherwise very heavy `v3.svelte.ts`), minus
 * nothing -- this file needs the same full dependency graph -- plus the
 * storage-side mocks (`localforage`, `@tauri-apps/plugin-fs`, `platform`)
 * needed to also drive a real `RisuSaveEncoder`.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'
import type { toSaveType } from '../../../storage/risuSave'

//#region module mocks -- copied from pluginSendChatColdGuard.svelte.test.ts,
// paths adjusted for this file's location (src/ts/plugins/apiV3/tests/).

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const hasherMock = vi.hoisted(() => vi.fn(async () => 'hash'))
const processSendChatMock = vi.hoisted(() => vi.fn(async () => {}))

const memStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => memStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                memStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                memStore.delete(key)
            }),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../plugins.svelte'), () => ({
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
}) as unknown as typeof import('../../plugins.svelte'))

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({}) as unknown),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../../storage/database.svelte'))

vi.mock(import('../../pluginSafeClass'), () => ({
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../../pluginSafeClass'))

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('../../../stores.svelte'), () => {
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
    } as unknown as typeof import('../../../stores.svelte')
})

vi.mock(import('../../../util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => ({
    alertConfirm: alertConfirmMock,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('../../../alert'))

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    getFetchLogs: vi.fn(),
}) as unknown as typeof import('../../../globalApi.svelte'))

vi.mock(import('../../../gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../../gui/colorscheme'))

vi.mock(import('../../../platform'), () => ({
    isNodeServer: false,
    isTauri: false,
}) as unknown as typeof import('../../../platform'))

vi.mock(import('../../../process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../../../process/mcp/pluginmcp'))

vi.mock(import('../../../process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('../../../process/coldstorage.svelte'))

vi.mock(import('../../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../../process/files/inlays'))

vi.mock(import('../../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../../translator/translator'))

vi.mock(import('../../../parser/parser.svelte'), () => ({
    hasher: hasherMock,
    risuChatParser: vi.fn(),
}) as unknown as typeof import('../../../parser/parser.svelte'))

vi.mock(import('../../../model/types'), () => ({
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: {},
    LLMTokenizer: {},
}) as unknown as typeof import('../../../model/types'))

vi.mock(import('../../../process/index.svelte'), () => ({
    sendChat: processSendChatMock,
    doingChat: writable(false),
}) as unknown as typeof import('../../../process/index.svelte'))

vi.mock(import('../../../process/scripts'), () => ({
    processScriptFull: vi.fn(),
}) as unknown as typeof import('../../../process/scripts'))

vi.mock(import('../../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model' }) as unknown),
}) as unknown as typeof import('../../../model/modellist'))

vi.mock(import('../../../process/request/request'), () => ({
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../../../process/request/request'))

vi.mock(import('../../../process/modules'), () => ({
    getModuleLorebooks: vi.fn(),
}) as unknown as typeof import('../../../process/modules'))

vi.mock(import('../../../process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('../../../process/ttsHooks'))

//#endregion

import { makeRisuaiAPIV3, setChatToIndexImpl } from '../v3.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { registerDbChangeEffects } from '../../../storage/dbChangeEffects.svelte'
import { RisuSaveEncoder, decodeRisuSave } from '../../../storage/risuSave'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../../storage/characterSaveMarks'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [{ role: 'user', data: 'original', time: 1 }], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [{ name: 'test-plugin', script: '' }],
        pluginCustomStorage: {},
        characterOrder: ['char-0', 'char-1'],
        characters: [
            makeCharacter('char-0', 'Character Zero (selected)'),
            makeCharacter('char-1', 'Character One (not selected)'),
        ],
    } as unknown as Database
}

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

function snapshotDb(db: Database): Database {
    return $state.snapshot(db) as Database
}

afterEach(() => {
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('V3 setCharacterToIndex (persisted via the identity tracker, no explicit mark)', () => {
    test('replacing a NON-selected character element is persisted after encode -> decode', async () => {
        installDb()
        selectedCharID.set(0)

        const tracker = makeTracker()
        const markChanged = vi.fn()
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        installCharacterSaveMarks({ tracker, schedule: () => {} })

        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })

        // Mirrors saveDb()'s post-init trim.
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const api = makeRisuaiAPIV3({} as HTMLIFrameElement, { name: 'test-plugin' } as never)
        const replacement = makeCharacter('char-1', 'Character One (REPLACED by plugin)')
        api.setCharacterToIndex(1, replacement)
        flushSync()

        const toSave = structuredClone(tracker) as toSaveType
        expect(toSave.character).toContain('char-1')

        await encoder.set(snapshotDb(DBState.db), toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar1 = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-1')
        const decodedChar0 = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-0')

        expect(decodedChar1).toBeTruthy()
        expect(decodedChar1!.name).toBe('Character One (REPLACED by plugin)')
        expect(decodedChar0).toBeTruthy()
        expect(decodedChar0!.name).toBe('Character Zero (selected)')

        cleanup()
    })
})

describe('V3 setChatToIndexImpl (persisted via an explicit mark)', () => {
    test('writing a chat into a NON-selected character is persisted after encode -> decode', async () => {
        installDb()
        selectedCharID.set(0)

        const tracker = makeTracker()
        const markChanged = vi.fn()
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        installCharacterSaveMarks({ tracker, schedule: () => {} })

        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })

        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        const newChat = { id: 'char-1-chat-0', message: [{ role: 'user', data: 'plugin-written chat', time: 2 }], note: '', name: '', localLore: [] }
        // THE REAL FUNCTION UNDER TEST -- index 1 is char-1, NOT selected (char-0 is).
        setChatToIndexImpl(1, 0, newChat)
        flushSync()

        const toSave = structuredClone(tracker) as toSaveType
        expect(toSave.character).toContain('char-1')

        await encoder.set(snapshotDb(DBState.db), toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar1 = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-1')

        expect(decodedChar1).toBeTruthy()
        expect(decodedChar1!.chats[0].message[0].data).toBe('plugin-written chat')

        cleanup()
    })
})
