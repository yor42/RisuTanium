/**
 * `openURL` on Tauri invokes the opener plugin's `plugin:opener|open_url`
 * command with only the URL; the shell plugin's open is never used. A rejected
 * promise or a synchronous throw from it is swallowed with a fixed warning
 * that never contains the URL, because OAuth URLs carry state and PKCE values.
 *
 * This file drives the REAL `openURL`; every module `globalApi.svelte.ts`
 * imports is mocked, following `globalApi.saveDbTauriAtomic.svelte.test.ts`.
 * `invoke` and the shell plugin are mocks, so a passing test says nothing
 * about the native plugin, the capability scope or the Android launch.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
    frozenSaveKeysStore: writable([]),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(() => new Promise<void>(() => {})),
    sleepForever: vi.fn(() => new Promise<void>(() => {})),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        async getItem(_key: string) { return null }
        async setItem(_key: string, _value: Uint8Array) {}
        async keys() { return [] as string[] }
        async removeItem(_key: string) {}
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { openURL } from 'src/ts/globalApi.svelte'

const SECRET_URL = 'https://auth.example.invalid/authorize?state=SECRETSTATE&code_challenge=SECRETPKCE'

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(open).mockReset()
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    unhandled.length = 0
    vi.restoreAllMocks()
})

const OPEN_URL_COMMAND = 'plugin:opener|open_url'

function openUrlCalls() {
    return vi.mocked(invoke).mock.calls.filter((call) => call[0] === OPEN_URL_COMMAND)
}

async function settle() {
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
}

function warnedStrings(warn: ReturnType<typeof vi.spyOn>): string[] {
    return warn.mock.calls.map((call) => call.map(String).join(' '))
}

describe('openURL on Tauri', () => {
    test('calls the opener\'s open_url with only the URL and never the shell open', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        openURL(SECRET_URL)
        await settle()

        const calls = openUrlCalls()
        expect(calls).toHaveLength(1)
        const args = calls[0][1]
        expect(args).toStrictEqual({ url: SECRET_URL })
        expect(Object.keys(args as object)).toEqual(['url'])
        expect(open).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalled()
    })

    test('passes the caller\'s string unchanged with no client scheme filter', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(invoke).mockRejectedValue(new Error('Not allowed to open url'))

        for (const input of ['/hub-proxy/x', 'javascript:alert(1)']) {
            openURL(input)
        }
        await settle()

        const calls = openUrlCalls()
        expect(calls.map((call) => call[1])).toStrictEqual([{ url: '/hub-proxy/x' }, { url: 'javascript:alert(1)' }])
        expect(warn).toHaveBeenCalledTimes(2)
    })

    test('a rejected open_url is caught and warned about without the URL', async () => {
        process.on('unhandledRejection', onUnhandled)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(invoke).mockRejectedValueOnce(new Error(`Not allowed to open url ${SECRET_URL}`))

        openURL(SECRET_URL)
        await settle()

        expect(unhandled).toHaveLength(0)
        expect(warn).toHaveBeenCalledTimes(1)
        for (const text of warnedStrings(warn)) {
            expect(text).not.toContain('SECRETSTATE')
            expect(text).not.toContain('SECRETPKCE')
            expect(text).not.toContain('auth.example.invalid')
        }
    })

    test('a synchronous throw from invoke does not escape and is warned about without the URL', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(invoke).mockImplementationOnce(() => {
            throw new Error(`boom ${SECRET_URL}`)
        })

        expect(() => openURL(SECRET_URL)).not.toThrow()
        await settle()

        expect(warn).toHaveBeenCalledTimes(1)
        for (const text of warnedStrings(warn)) {
            expect(text).not.toContain('SECRETSTATE')
            expect(text).not.toContain('auth.example.invalid')
        }
    })

    test('a resolved open_url does not warn', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(invoke).mockResolvedValueOnce(undefined)

        openURL(SECRET_URL)
        await settle()

        expect(openUrlCalls()).toHaveLength(1)
        expect(warn).not.toHaveBeenCalled()
    })
})
