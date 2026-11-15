/**
 * `readInlay` of the V3 plugin API reads through the real inlays module with an in-memory app store, so
 * the body reads that a plugin causes are observable:
 *
 *  - A video or audio over the send limit gives the plugin `null`, and its body is never read from the
 *    app store. The only report is one `console.warn` naming the plugin and the inlay: no alert, no toast.
 *  - A video of exactly the limit, a small audio and an image of any size are returned as data URIs.
 *  - The permission check runs before any inlay is read, and an absent id gives `null`.
 *
 * The module-mock set is the one of `v3PluginPermissions.svelte.test.ts` without its inlays mock, plus the
 * mocks the real inlays module needs. Each scenario uses a plugin script no other scenario in this file
 * uses, because the session permission cache is keyed by the script hash and caches denials too.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import type { Database } from '../../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins.svelte'
import { resetBusyActionsForTest } from '../../../process/memory/busyActions'
import { inlayMetaKey } from '../../../process/files/inlayKeys'
import { INLAY_SEND_LIMIT_BYTES } from '../../../process/files/inlaySendGate'
import type { InlayRecord } from '../../../process/files/inlayStore'
import { createMemoryByteStore, type MemoryByteStore } from '../../../process/files/tests/memoryByteStore'
import { setInlayAsset, type InlayAsset } from '../../../process/files/inlays'

//#region module mocks -- see the file header for provenance.

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())
const alertToastMock = vi.hoisted(() => vi.fn())
const postToastMock = vi.hoisted(() => vi.fn())
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))

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
            keys: vi.fn(async () => [...memStore.keys()]),
        }),
    },
}))

vi.mock(import('../../plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: writable([] as string[]),
    getV2PluginAPIs: () => ({
        addRisuReplacer: vi.fn(),
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
    pluginV2: {
        providers: new Map(),
        providerOptions: new Map(),
        chatOutput: new Set(),
    },
}) as unknown as typeof import('../../plugins.svelte'))

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({}) as unknown),
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
    asBuffer: (arr: Uint8Array) => arr,
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => ({
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertNormal: alertNormalMock,
    alertToast: alertToastMock,
}) as unknown as typeof import('../../../alert'))

vi.mock('src/ts/toast/toastHost.svelte', () => ({ postToast: postToastMock }))

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {},
    getFetchLogs: vi.fn(() => []),
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
    sendChat: vi.fn(async () => {}),
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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'fixed-uuid') }))
vi.mock(import('src/ts/media'), () => ({ getImageType: vi.fn() }))

//#endregion

import { makeRisuaiAPIV3 } from '../v3.svelte'
import { DBState } from '../../../stores.svelte'

const MIB = 1024 * 1024
const HEAVY_TIMEOUT_MS = 30_000

const BIG_IMAGE_TEXT = 'data:image/png;base64,' + 'A'.repeat(28 * MIB)

const ID = {
    videoOver: 'cap-video-over',
    audioOver: 'cap-audio-over',
    videoExact: 'cap-video-exact',
    audioSmall: 'cap-audio-small',
    imageBigText: 'cap-image-big-text',
    videoSmall: 'cap-video-small',
    gone: 'cap-gone',
}

let appStore: MemoryByteStore

function blobOf(size: number, mime: string): Blob {
    return new Blob([new Uint8Array(size)], { type: mime })
}

function asset(data: string | Blob, extra: Record<string, unknown> = {}): InlayAsset {
    return { name: 'clip.mp4', ext: 'mp4', type: 'video', data, ...extra } as InlayAsset
}

function bodyKeyOf(id: string): string {
    const bytes = appStore.files.get(inlayMetaKey(id) as string)
    expect(bytes).toBeDefined()
    return (JSON.parse(new TextDecoder().decode(bytes)) as InlayRecord).body
}

function bodyReadsOf(id: string): string[] {
    const body = bodyKeyOf(id)
    return appStore.reads.filter((key) => key === body)
}

function makeApi(pluginName: string, script: string) {
    DBState.db = { plugins: [{ name: pluginName, script }] } as unknown as Database
    const plugin: RisuPlugin = {
        name: pluginName,
        script,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
    return makeRisuaiAPIV3({} as HTMLIFrameElement, plugin)
}

/** The warns that name this inlay, so unrelated warns from the inlays code do not count. */
function warnsNaming(warn: { mock: { calls: unknown[][] } }, id: string): unknown[][] {
    return warn.mock.calls.filter((args) => args.some((arg) => String(arg).includes(id)))
}

function expectNoAlertOrToast(): void {
    expect(alertErrorMock).not.toHaveBeenCalled()
    expect(alertNormalMock).not.toHaveBeenCalled()
    expect(alertToastMock).not.toHaveBeenCalled()
    expect(postToastMock).not.toHaveBeenCalled()
}

beforeAll(async () => {
    resetBusyActionsForTest()
    appStore = createMemoryByteStore({})
    injectAppStore(appStore)
    await setInlayAsset(ID.videoOver, asset(blobOf(INLAY_SEND_LIMIT_BYTES + 1, 'video/mp4')))
    await setInlayAsset(ID.audioOver, asset(blobOf(INLAY_SEND_LIMIT_BYTES + 1, 'audio/mp3'), { name: 'clip.mp3', ext: 'mp3', type: 'audio' }))
    await setInlayAsset(ID.videoExact, asset(blobOf(INLAY_SEND_LIMIT_BYTES, 'video/mp4')))
    await setInlayAsset(ID.audioSmall, asset(blobOf(1024, 'audio/mp3'), { name: 'clip.mp3', ext: 'mp3', type: 'audio' }))
    await setInlayAsset(ID.imageBigText, asset(BIG_IMAGE_TEXT, { name: 'pic.png', ext: 'png', type: 'image' }))
    await setInlayAsset(ID.videoSmall, asset(blobOf(64, 'video/mp4')))
}, HEAVY_TIMEOUT_MS)

beforeEach(() => {
    memStore.clear()
    appStore.reads.length = 0
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertErrorMock.mockReset()
    alertNormalMock.mockReset()
    alertToastMock.mockReset()
    postToastMock.mockReset()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('readInlay of a video or audio over the send limit', () => {
    async function readOverCap(id: string, pluginName: string, script: string): Promise<void> {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const api = makeApi(pluginName, script)
        const consent = language.inlayPermissionConsent.replace('{}', pluginName)

        const result = await api.readInlay(id)

        expect(result).toBeNull()
        expect(bodyReadsOf(id)).toEqual([])
        const warns = warnsNaming(warn, id)
        expect(warns).toHaveLength(1)
        expect(warns[0].some((arg) => String(arg).includes(pluginName))).toBe(true)
        expectNoAlertOrToast()
        expect(alertConfirmMock.mock.calls.length).toBeGreaterThan(0)
        for (const call of alertConfirmMock.mock.calls as unknown as unknown[][]) {
            expect(call[0]).toBe(consent)
        }
    }

    test('a video gives null with one warning and no body read, alert or toast', async () => {
        await readOverCap(ID.videoOver, 'cap-video-plugin', 'script-cap-video')
    }, HEAVY_TIMEOUT_MS)

    test('an audio gives null with one warning and no body read, alert or toast', async () => {
        await readOverCap(ID.audioOver, 'cap-audio-plugin', 'script-cap-audio')
    }, HEAVY_TIMEOUT_MS)
})

describe('guard: readInlay of a file within the limit or of an image', () => {
    test('a video of exactly the limit, a small audio and an image over the limit are returned as data URIs without a cap warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const api = makeApi('cap-guard-plugin', 'script-cap-guard')

        const video = await api.readInlay(ID.videoExact)
        const audio = await api.readInlay(ID.audioSmall)
        const image = await api.readInlay(ID.imageBigText)

        expect(video?.data.startsWith('data:')).toBe(true)
        expect(audio?.data.startsWith('data:')).toBe(true)
        expect(image?.data.startsWith('data:')).toBe(true)
        expect(image?.data.length).toBe(BIG_IMAGE_TEXT.length)
        for (const id of [ID.videoExact, ID.audioSmall, ID.imageBigText]) {
            expect(warnsNaming(warn, id)).toHaveLength(0)
        }
        expectNoAlertOrToast()
    }, HEAVY_TIMEOUT_MS)
})

describe('guard: the permission check and an absent id', () => {
    test('a denied plugin gets null and no body of that inlay is read', async () => {
        alertConfirmMock.mockImplementation(async () => false)
        const api = makeApi('cap-denied-plugin', 'script-cap-denied')

        const result = await api.readInlay(ID.videoSmall)

        expect(result).toBeNull()
        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(bodyReadsOf(ID.videoSmall)).toEqual([])
    })

    test('an absent id gives null', async () => {
        const api = makeApi('cap-absent-plugin', 'script-cap-absent')

        expect(await api.readInlay(ID.gone)).toBeNull()
    })
})
