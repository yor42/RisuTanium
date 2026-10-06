/**
 * The permission checks behind `makeRisuaiAPIV3`
 * (`src/ts/plugins/apiV3/v3.svelte.ts`) keep these invariants:
 *
 *  - A grant or denial answered for one permission must never answer a
 *    different permission for the same plugin identity.
 *  - A plugin identity is its script, not its declared name: a plugin
 *    reinstalled under the same name with different script content is a
 *    different identity for permission purposes.
 *  - A provider registered through `addProvider` must never invoke the
 *    plugin-supplied function when the user denies the 'provider'
 *    permission, and must return
 *    `{ success: false, content: 'Plugin provider permission denied by user.' }`
 *    in that case.
 *  - None of the above may regress permission isolation between two
 *    genuinely different plugins (different name AND script), or the
 *    ability to honor a permission already persisted under the
 *    `${hasher(script)}_${permission}` key format.
 *
 * A session cache keyed by plugin name alone, or one entry per plugin for
 * every permission, breaks the first two.
 *
 * Every scenario below drives the real `makeRisuaiAPIV3(iframe, plugin)`
 * object end to end, with the user's answer supplied by mocking
 * `alertConfirm`. The readInlay consent guard also checks the consent string
 * `alertConfirm` receives, because that string is what identifies which
 * permission was requested. Isolation between scenarios that must
 * not interfere with each other is achieved with a distinct plugin script
 * per scenario: the session permission cache is keyed by the hash of the
 * script plus the permission, so a new scenario must use a script no other
 * scenario in this file uses, or it inherits a cached decision from
 * whichever scenario ran first.
 *
 * The module-mock set is copied, unchanged in shape, from
 * `pluginSendChatColdGuard.svelte.test.ts` (this file's structural
 * precedent for loading the real, dependency-heavy `v3.svelte.ts`), with
 * `plugins.svelte`'s mock extended to provide a real `customProviderStore`
 * writable and a real `pluginV2.providers`/`providerOptions` map -- both
 * needed to drive `addProvider` end to end -- and `getInlayAsset` /
 * `getFetchLogs` given resolvable fixture values so a *granted* permission
 * path can be told apart from a *denied* one by its return value, not just
 * by whether `alertConfirm` fired.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'
import type { Database } from '../../../storage/database.svelte'
import type { PluginV2ProviderArgument, RisuPlugin } from '../../plugins.svelte'

//#region module mocks -- see the file header for provenance.

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
// Deterministic, script-content-derived stand-in for the real SHA-256
// `hasher` (`src/ts/parser/parser.svelte.ts`): distinct script content
// always produces a distinct hash, which is what the identity test below
// needs to tell two script versions of "the same" plugin name apart.
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
        }),
    },
}))

vi.mock(import('../../plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: writable([] as string[]),
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
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => ({
    alertConfirm: alertConfirmMock,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('../../../alert'))

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {},
    // Resolvable so a granted `getFetchLogs()` call can be told apart from
    // a denied one (null) by its return value, not only by whether
    // `alertConfirm` fired.
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

vi.mock(import('../../../process/files/inlays'), () => ({
    // Resolvable so a granted `readInlay()` call can be told apart from a
    // denied one (null) by its return value.
    getInlayAsset: vi.fn(async () => 'asset-data'),
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

//#endregion

import { makeRisuaiAPIV3 } from '../v3.svelte'
import { DBState } from '../../../stores.svelte'
import { pluginV2 } from '../../plugins.svelte'

//#region fixtures

type PluginFixture = { name: string; script: string }

function installDb(plugins: PluginFixture[]): void {
    DBState.db = { plugins } as unknown as Database
}

function makeApi(pluginName: string) {
    // The API receives the installed plugin object, as `executePluginV3` does.
    const installed = DBState.db.plugins.find(p => p.name === pluginName)
    if (!installed) {
        throw new Error(`makeApi: no plugin named "${pluginName}" is installed`)
    }
    const plugin: RisuPlugin = {
        name: installed.name,
        script: installed.script,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
    return makeRisuaiAPIV3({} as HTMLIFrameElement, plugin)
}

function makeProviderArg(): PluginV2ProviderArgument {
    return {
        prompt_chat: [],
        frequency_penalty: 0,
        min_p: 0,
        presence_penalty: 0,
        repetition_penalty: 0,
        top_k: 0,
        top_p: 0,
        temperature: 0,
        mode: 'v3',
        max_tokens: 0,
    }
}

beforeEach(() => {
    memStore.clear()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    hasherMock.mockClear()
    pluginV2.providers.clear()
    pluginV2.providerOptions.clear()
})

//#endregion

describe('granting one permission does not grant another', () => {
    test('after "db" is granted, a later "fetchLogs" call still asks, and a "no" there is honored (denied/null)', async () => {
        installDb([{ name: 'grant-scope-plugin', script: 'script-grant-scope' }])
        const api = makeApi('grant-scope-plugin')

        alertConfirmMock.mockResolvedValueOnce(true)
        const dbResult = await api.getDatabase()
        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(dbResult).not.toBeNull()

        alertConfirmMock.mockResolvedValueOnce(false)
        const fetchLogsResult = await api.getFetchLogs()
        expect(alertConfirmMock).toHaveBeenCalledTimes(2)
        expect(fetchLogsResult).toBeNull()
    })
})

describe('denying one permission does not deny another', () => {
    test('after "fetchLogs" is denied, a later "db" call still asks, and a "yes" there is honored (granted/non-null)', async () => {
        installDb([{ name: 'deny-scope-plugin', script: 'script-deny-scope' }])
        const api = makeApi('deny-scope-plugin')

        alertConfirmMock.mockResolvedValueOnce(false)
        const fetchLogsResult = await api.getFetchLogs()
        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(fetchLogsResult).toBeNull()

        alertConfirmMock.mockResolvedValueOnce(true)
        const dbResult = await api.getDatabase()
        expect(alertConfirmMock).toHaveBeenCalledTimes(2)
        expect(dbResult).not.toBeNull()
    })
})

describe('a denied provider permission is enforced', () => {
    test('when the user denies "provider", the registered provider never calls the plugin function, and returns the denial result', async () => {
        installDb([{ name: 'provider-deny-plugin', script: 'script-provider-deny' }])
        const api = makeApi('provider-deny-plugin')
        const providerFunc = vi.fn(async () => ({ success: true, content: 'must never be reached' }))

        api.addProvider('deny-provider', providerFunc)
        const registered = pluginV2.providers.get('deny-provider')
        expect(registered).toBeTypeOf('function')

        alertConfirmMock.mockResolvedValueOnce(false)
        const result = await registered!(makeProviderArg())

        expect(providerFunc).not.toHaveBeenCalled()
        expect(result).toEqual({ success: false, content: 'Plugin provider permission denied by user.' })
    })

    // An allowed provider must still reach the plugin function; this also
    // shows the harness observes a call when one happens, which is what
    // makes the denial case above meaningful.
    test('guard: when the user allows "provider", the registered provider calls the plugin function and returns its result', async () => {
        installDb([{ name: 'provider-allow-plugin', script: 'script-provider-allow' }])
        const api = makeApi('provider-allow-plugin')
        const providerFunc = vi.fn(async () => ({ success: true, content: 'real result' }))

        api.addProvider('allow-provider', providerFunc)
        const registered = pluginV2.providers.get('allow-provider')

        alertConfirmMock.mockResolvedValueOnce(true)
        const result = await registered!(makeProviderArg())

        expect(providerFunc).toHaveBeenCalledTimes(1)
        expect(result).toEqual({ success: true, content: 'real result' })
    })
})

describe('a permission grant follows the plugin script, not its declared name', () => {
    test('the same name with a changed script asks again for "db", and honors the new answer', async () => {
        installDb([{ name: 'script-swap-plugin', script: 'script-version-X' }])
        const api1 = makeApi('script-swap-plugin')

        alertConfirmMock.mockResolvedValueOnce(true)
        const firstResult = await api1.getDatabase()
        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(firstResult).not.toBeNull()

        // The plugin is reinstalled in place under the same declared name,
        // with different script content -- e.g. an updated version of "the
        // same" plugin.
        DBState.db.plugins[0].script = 'script-version-Y'
        const api2 = makeApi('script-swap-plugin')

        alertConfirmMock.mockResolvedValueOnce(false)
        const secondResult = await api2.getDatabase()
        expect(alertConfirmMock).toHaveBeenCalledTimes(2)
        expect(secondResult).toBeNull()
    })
})

describe('guard: a permission grant for one plugin never applies to a different plugin', () => {
    // Each plugin here performs exactly one 'periodically'-reconfirmed
    // ('inlay') permission check, so the reconfirm-interval logic never
    // gets a second call on the same identity to potentially short-circuit
    // -- no time control is needed for this scenario.
    test('guard: granting "inlay" to one plugin does not grant it to a different plugin (different name and script)', async () => {
        installDb([
            { name: 'inlay-isolation-a', script: 'script-inlay-a' },
            { name: 'inlay-isolation-b', script: 'script-inlay-b' },
        ])
        const apiA = makeApi('inlay-isolation-a')
        const apiB = makeApi('inlay-isolation-b')

        alertConfirmMock.mockResolvedValueOnce(true)
        const resultA = await apiA.readInlay('id-a')
        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(resultA).toBe('asset-data')

        alertConfirmMock.mockResolvedValueOnce(false)
        const resultB = await apiB.readInlay('id-b')
        expect(alertConfirmMock).toHaveBeenCalledTimes(2)
        expect(resultB).toBeNull()
    })

    test('guard: readInlay asks for the inlay permission specifically, and persists the grant under "${hash}_inlay"', async () => {
        const pluginName = 'inlay-consent-plugin'
        const script = 'script-inlay-consent'
        installDb([{ name: pluginName, script }])
        const api = makeApi(pluginName)
        const scriptHash = await hasherMock(new TextEncoder().encode(script))

        alertConfirmMock.mockResolvedValueOnce(true)
        const result = await api.readInlay('id-consent')

        expect(alertConfirmMock).toHaveBeenCalledWith(language.inlayPermissionConsent.replace('{}', pluginName))
        expect(result).toBe('asset-data')
        expect(memStore.get(`${scriptHash}_inlay`)).toBe(true)
    })
})

describe('guard: a persisted grant recorded under the hash+permission key is honored without asking', () => {
    test('guard: a stored "${hash}_fetchLogs" = true grant, in the key format upstream builds write, is honored without prompting', async () => {
        const pluginName = 'legacy-pregranted-plugin'
        const script = 'legacy-script-content'
        installDb([{ name: pluginName, script }])
        const scriptHash = await hasherMock(new TextEncoder().encode(script))
        memStore.set(`${scriptHash}_fetchLogs`, true)

        const api = makeApi(pluginName)
        const result = await api.getFetchLogs()

        expect(alertConfirmMock).not.toHaveBeenCalled()
        expect(result).not.toBeNull()
    })
})

describe('permission requests made at the same time for one plugin script and permission', () => {
    // `alertConfirm` is a stand-in here: these tests pin how many prompts the
    // permission layer asks for and that one answer reaches every caller, and
    // say nothing about how the real alert queue shows or answers them.

    /** Makes the next confirm stay open until `answer` is called with the user's choice. */
    function heldConfirm(): { answer: (granted: boolean) => void } {
        let release: (granted: boolean) => void = () => {}
        alertConfirmMock.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve }))
        return { answer: (granted) => release(granted) }
    }

    /** Lets every request that can reach its confirm do so. */
    function letRequestsReachTheirConfirm(): Promise<void> {
        return new Promise<void>((resolve) => setTimeout(resolve, 30))
    }

    test.each([
        ['granted', true, 'script-shared-grant'],
        ['denied', false, 'script-shared-deny'],
    ])('two requests for the same permission ask once, and the one answer, %s, is what both receive', async (_label, granted, script) => {
        installDb([{ name: 'shared-prompt-plugin', script }])
        const api = makeApi('shared-prompt-plugin')
        const held = heldConfirm()

        const first = api.getDatabase()
        const second = api.getDatabase()
        await letRequestsReachTheirConfirm()

        expect.soft(alertConfirmMock, 'confirms asked for two requests').toHaveBeenCalledTimes(1)
        held.answer(granted)
        const results = await Promise.all([first, second])
        expect.soft(results.map((result) => result !== null), 'requests that were granted').toEqual([granted, granted])
    })

    test('two API objects made for the same plugin script share one prompt for the same permission', async () => {
        installDb([{ name: 'shared-across-apis-plugin', script: 'script-shared-across-apis' }])
        const held = heldConfirm()

        const first = makeApi('shared-across-apis-plugin').getDatabase()
        const second = makeApi('shared-across-apis-plugin').getDatabase()
        await letRequestsReachTheirConfirm()

        expect.soft(alertConfirmMock, 'confirms asked for two requests').toHaveBeenCalledTimes(1)
        held.answer(true)
        const results = await Promise.all([first, second])
        expect.soft(results.map((result) => result !== null), 'requests that were granted').toEqual([true, true])
    })

    test('guard: a request made after the shared prompt was answered is served without a new prompt', async () => {
        installDb([{ name: 'shared-then-cached-plugin', script: 'script-shared-then-cached' }])
        const api = makeApi('shared-then-cached-plugin')
        const held = heldConfirm()
        const first = api.getDatabase()
        const second = api.getDatabase()
        await letRequestsReachTheirConfirm()
        held.answer(true)
        await Promise.all([first, second])
        alertConfirmMock.mockClear()

        const later = await api.getDatabase()

        expect.soft(alertConfirmMock, 'confirms asked for the later request').not.toHaveBeenCalled()
        expect.soft(later).not.toBeNull()
    })

    test('guard: requests for two different permissions of one plugin ask separately', async () => {
        installDb([{ name: 'two-permissions-plugin', script: 'script-two-permissions' }])
        const api = makeApi('two-permissions-plugin')
        const dbConfirm = heldConfirm()
        const logsConfirm = heldConfirm()

        const db = api.getDatabase()
        const logs = api.getFetchLogs()
        await letRequestsReachTheirConfirm()

        expect.soft(alertConfirmMock, 'confirms asked for two permissions').toHaveBeenCalledTimes(2)
        dbConfirm.answer(true)
        logsConfirm.answer(false)
        const [dbResult, logsResult] = await Promise.all([db, logs])
        expect.soft(dbResult, 'the granted permission').not.toBeNull()
        expect.soft(logsResult, 'the denied permission').toBeNull()
    })

    test('guard: requests for the same permission from two different plugins ask separately', async () => {
        installDb([
            { name: 'two-plugins-a', script: 'script-two-plugins-a' },
            { name: 'two-plugins-b', script: 'script-two-plugins-b' },
        ])
        const confirmA = heldConfirm()
        const confirmB = heldConfirm()

        const a = makeApi('two-plugins-a').getDatabase()
        const b = makeApi('two-plugins-b').getDatabase()
        await letRequestsReachTheirConfirm()

        expect.soft(alertConfirmMock, 'confirms asked for two plugins').toHaveBeenCalledTimes(2)
        confirmA.answer(true)
        confirmB.answer(false)
        const [resultA, resultB] = await Promise.all([a, b])
        expect.soft(resultA, 'the plugin that was granted').not.toBeNull()
        expect.soft(resultB, 'the plugin that was denied').toBeNull()
    })

    test('guard: requests for the same permission from two scripts declaring the same name ask separately', async () => {
        installDb([{ name: 'same-name-plugin', script: 'script-same-name-first' }])
        const first = makeApi('same-name-plugin')
        DBState.db.plugins[0].script = 'script-same-name-second'
        const second = makeApi('same-name-plugin')
        const firstConfirm = heldConfirm()
        const secondConfirm = heldConfirm()

        const firstRequest = first.getDatabase()
        const secondRequest = second.getDatabase()
        await letRequestsReachTheirConfirm()

        expect.soft(alertConfirmMock, 'confirms asked for two scripts').toHaveBeenCalledTimes(2)
        firstConfirm.answer(true)
        secondConfirm.answer(false)
        const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest])
        expect.soft(firstResult, 'the script that was granted').not.toBeNull()
        expect.soft(secondResult, 'the script that was denied').toBeNull()
    })

    test('guard: a request made after a prompt that threw asks again', async () => {
        installDb([{ name: 'threw-then-asks-plugin', script: 'script-threw-then-asks' }])
        const api = makeApi('threw-then-asks-plugin')
        alertConfirmMock.mockImplementationOnce(async () => { throw new Error('the prompt failed') })

        await expect(api.getDatabase()).rejects.toThrow('the prompt failed')
        alertConfirmMock.mockImplementationOnce(async () => true)
        const later = await api.getDatabase()

        expect.soft(alertConfirmMock, 'confirms asked in all').toHaveBeenCalledTimes(2)
        expect.soft(later).not.toBeNull()
    })
})
