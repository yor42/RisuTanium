/**
 * A plugin's write to the plugin list (CHORE-64): what `setDatabase` and
 * `setDatabaseLite` do with a `plugins` value, what `installPlugin` returns, and
 * what the Update button, a manual re-import and hot reload keep.
 *
 * Invariants exercised here:
 * - A write that carries `plugins` never removes an installed plugin and never
 *   lets two entries share a name. An entry whose script equals the installed
 *   script, or whose header version is not newer than the installed version, is
 *   ignored: no prompt, no change.
 * - A script-changed entry (newer version) is an update and a new name is an
 *   install. Both are asked for by name before anything is written. Details
 *   come from the new script's header, never from the entry the caller sent.
 * - A declined, refused or stale change drops the whole plugin-list change, the
 *   other keys of the call are still written, and the call rejects with a
 *   message that names the plugin and the reason.
 * - Every update path keeps the saved values of arguments the new header still
 *   declares (same declared type) and keeps the on/off state, hot reload
 *   excepted: hot reload keeps values and switches the plugin on.
 * - The merge is applied against the live list when the prompts are answered,
 *   so Settings changes made while a prompt is open survive.
 *
 * Titles starting with "guard:" pin behaviour that holds before and after the
 * change. Every other test is a regression reproducer for the behaviour it names.
 *
 * Drives the REAL `plugins.svelte.ts`, the REAL V3 wrappers from
 * `makeRisuaiAPIV3`, the REAL `stubDowngrade.ts` and `coldCharacter.ts`. The
 * alert queue, the sandbox host, cold storage and the stores' persistence are
 * mocks: they say nothing about the native backends.
 *
 * Assertions on prompts and rejections follow a fixed contract: a prompt text
 * contains the plugin names (and versions) the scenario requires, a rejection
 * message contains the plugin name and a lower-case reason (`declined`,
 * `refused`, `changed meanwhile`, `not newer than installed`, `not an array`),
 * and a required warning is only checked for having been logged.
 */
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'

//#region module mocks

/**
 * The `alertConfirm` queue. `policy` answers each prompt immediately (true or
 * false) or holds it open (`'hold'`) until the test settles it.
 */
const confirms = vi.hoisted(() => {
    const driver = {
        texts: [] as string[],
        held: [] as Array<{ text: string, settle: (answer: boolean) => void }>,
        errors: [] as string[],
        policy: (_text: string, _index: number): boolean | 'hold' => true,
        ask(text: string): Promise<boolean> {
            const index = driver.texts.length
            driver.texts.push(text)
            const verdict = driver.policy(text, index)
            if (verdict === 'hold') {
                return new Promise<boolean>((settle) => { driver.held.push({ text, settle }) })
            }
            return Promise.resolve(verdict)
        },
    }
    return driver
})
const runs = vi.hoisted(() => [] as string[])

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
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

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('../apiV3/factory'), () => ({
    SandboxHost: class {
        constructor(_api: unknown) {}
        run(_iframe: unknown, script: string) { runs.push(script) }
        terminate() {}
    },
}) as unknown as typeof import('../apiV3/factory'))

vi.mock(import('../../storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('../../stores.svelte')
    return {
        getCurrentCharacter: vi.fn(),
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async (code: string) => ({ modifiedCode: code })),
}) as unknown as typeof import('../pluginSafety'))

vi.mock(import('../pluginSafeClass'), () => ({
    SafeDocument: class {},
    SafeIdbFactory: class {},
    SafeLocalStorage: class {
        getItem = vi.fn()
        setItem = vi.fn()
        removeItem = vi.fn()
        clear = vi.fn()
        key = vi.fn()
        keys = vi.fn()
    },
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../pluginSafeClass'))

vi.mock(import('../apiV3/transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../apiV3/transpiler'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        hotReloading: [] as string[],
        pluginAlertModalStore: writable(null),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../alert'), () => {
    const quiet = () => {}
    return {
        alertConfirm: (text: string) => confirms.ask(text),
        alertPluginConfirm: async () => true,
        alertError: (msg: string | Error) => { confirms.errors.push(msg instanceof Error ? msg.message : String(msg)) },
        alertErrorWait: async () => {},
        alertNormal: quiet,
        alertNormalWait: async () => {},
        alertMd: quiet,
        alertToast: quiet,
        alertWait: () => ({}),
        alertClear: quiet,
        waitAlert: async () => {},
    } as unknown as typeof import('../../alert')
})

vi.mock(import('../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    getFetchLogs: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
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

vi.mock(import('../../process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../../process/mcp/pluginmcp'))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../process/files/inlays'))

vi.mock(import('../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../translator/translator'))

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`),
    risuChatParser: vi.fn(),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../model/types'), () => ({
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: {},
    LLMTokenizer: {},
}) as unknown as typeof import('../../model/types'))

vi.mock(import('../../process/index.svelte'), () => ({
    sendChat: vi.fn(async () => {}),
    doingChat: writable(false),
}) as unknown as typeof import('../../process/index.svelte'))

vi.mock(import('../../process/scripts'), () => ({
    processScriptFull: vi.fn(),
}) as unknown as typeof import('../../process/scripts'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model' }) as unknown),
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../../process/request/request'), () => ({
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../../process/request/request'))

vi.mock(import('../../process/modules'), () => ({
    getModuleLorebooks: vi.fn(),
}) as unknown as typeof import('../../process/modules'))

vi.mock(import('../../process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('../../process/ttsHooks'))

//#endregion

import { getV2PluginAPIs, importPlugin, updatePlugin, loadPlugins } from '../plugins.svelte'
import { makeRisuaiAPIV3, loadV3Plugins } from '../apiV3/v3.svelte'
import { DBState, hotReloading } from '../../stores.svelte'
import { buildColdStub } from '../../process/coldCharacter'

//#region fixtures

const A = 'plug-a'
const B = 'plug-b'
const U = 'plug-u'
const C = 'plug-c'
const D = 'plug-d'
const P = 'plug-p'

interface ScriptOptions {
    /** `null` leaves the `//@version` line out. */
    version?: string | null
    /** `null` leaves the `//@api` line out. */
    api?: string | null
    /** Argument declarations, for example `'k string'` or `'cb int {{checkbox}}'`. */
    args?: string[]
    ipc?: string[]
    displayName?: string
    updateUrl?: string
    link?: string
    body?: string
}

function makeScript(name: string, options: ScriptOptions = {}): string {
    const lines = [`//@name ${name}`]
    const api = options.api === undefined ? '3.0' : options.api
    if (api !== null) lines.push(`//@api ${api}`)
    if (options.version !== null) lines.push(`//@version ${options.version ?? '1.0.0'}`)
    if (options.displayName) lines.push(`//@display-name ${options.displayName}`)
    if (options.updateUrl) lines.push(`//@update-url ${options.updateUrl}`)
    if (options.link) lines.push(`//@link ${options.link}`)
    for (const arg of options.args ?? []) lines.push(`//@arg ${arg}`)
    for (const ipc of options.ipc ?? []) lines.push(`//@allowed-ipc ${ipc}`)
    lines.push(`// body ${options.body ?? 'body'}`)
    return lines.join('\n')
}

interface EntryOptions {
    realArg?: Record<string, string | number>
    /** Absent means true; an explicit `undefined` keeps the key with no value. */
    enabled?: boolean | undefined
    extra?: Record<string, unknown>
}

/** The entry `importPlugin` would store for `script`, with the saved values and flags given. */
function entryOf(script: string, options: EntryOptions = {}): RisuPlugin {
    const lines = script.split('\n')
    const name = lines.find((l) => l.startsWith('//@name'))!.slice(7).trim()
    const version = lines.find((l) => l.startsWith('//@version'))?.slice(10).trim() ?? ''
    const args: Record<string, 'int' | 'string'> = {}
    const argMeta: Record<string, Record<string, string>> = {}
    for (const line of lines.filter((l) => l.startsWith('//@arg '))) {
        const [, key, type] = line.split(' ')
        args[key] = type as 'int' | 'string'
        if (line.includes('{{checkbox}}')) argMeta[key] = { checkbox: '1' }
    }
    const allowedIPC = lines.filter((l) => l.startsWith('//@allowed-ipc ')).flatMap((l) => l.split(' ').slice(1))
    return {
        name,
        script,
        arguments: args,
        realArg: options.realArg ?? {},
        version: '3.0',
        customLink: [],
        argMeta,
        versionOfPlugin: version,
        updateURL: '',
        allowedIPC,
        enabled: 'enabled' in options ? options.enabled : true,
        ...options.extra,
    } as RisuPlugin
}

const A_V1 = makeScript(A, { version: '1.0.0', args: ['key string'], body: 'a v1' })
const A_V2 = makeScript(A, { version: '1.1.0', args: ['key string', 'newkey string'], ipc: [B], body: 'a v2' })
const B_V1 = makeScript(B, { version: '1.0.0', args: ['k string', 'cb int {{checkbox}}'], body: 'b v1' })
const B_V11 = makeScript(B, { version: '1.1.0', args: ['k string', 'cb int {{checkbox}}'], body: 'b v11' })
const B_V12 = makeScript(B, { version: '1.2.0', args: ['k string', 'cb int {{checkbox}}'], body: 'b v12' })
const U_V1 = makeScript(U, { version: '1.0.0', args: ['u string'], body: 'u v1' })
const U_V11 = makeScript(U, { version: '1.1.0', args: ['u string'], body: 'u v11' })
const C_V1 = makeScript(C, { version: '1.0.0', args: ['token string'], body: 'c v1' })
const D_V1 = makeScript(D, { version: '1.0.0', args: ['dk string'], body: 'd v1' })

const fixtureA = () => entryOf(A_V1, { realArg: { key: 'secret-a' }, enabled: true })
const fixtureB = () => entryOf(B_V1, { realArg: { k: 'secret-b', cb: '1' }, enabled: false })
const fixtureU = () => entryOf(U_V1, { realArg: { u: 'secret-u' }, enabled: undefined })
/** C as a plugin would send it: values the host must not trust, and a lying `enabled`. */
const sentC = () => entryOf(C_V1, { realArg: { token: 'supplied-by-plugin' }, enabled: false })
const sentD = () => entryOf(D_V1, { realArg: { dk: 'supplied-by-plugin' }, enabled: false })

type CharacterFixture = Database['characters'][number]

function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        type: 'character',
        name: `${chaId} name`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: 5000,
        desc: `${chaId} description`,
        globalLore: [],
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
        ...extra,
    } as unknown as CharacterFixture
}

/** The placeholder of an archived character as it sits in the list after load. */
function stubOf(full: CharacterFixture, key: string): CharacterFixture {
    const stub = buildColdStub(full as never, key, []) as unknown as Record<string, unknown>
    Object.assign(stub, { customscript: [], firstMessage: '', globalLore: [], desc: '', viewScreen: 'none', emotionImages: [] })
    return stub as unknown as CharacterFixture
}

function installDb(plugins: RisuPlugin[], characters: CharacterFixture[] = []): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins,
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
    } as unknown as Database
}

const installBase = (characters: CharacterFixture[] = []) => installDb([fixtureA(), fixtureB(), fixtureU()], characters)

//#endregion

//#region helpers

const plain = <T>(value: T): T => $state.snapshot(value) as T
const liveList = () => DBState.db.plugins as unknown as RisuPlugin[]
const liveEntry = (name: string) => liveList().find((p) => p.name === name)!
const liveNames = () => liveList().map((p) => p.name)
const liveSummary = () => plain(liveList())
const liveCharacter = (chaId: string) => DBState.db.characters.find((c: CharacterFixture) => c.chaId === chaId) as unknown as Record<string, unknown>

const sleepTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type SetterKind = 'setDatabase' | 'setDatabaseLite'
const SETTERS: SetterKind[] = ['setDatabase', 'setDatabaseLite']

type CallerApi = ReturnType<typeof makeRisuaiAPIV3>

/** The V3 wrappers as seen by the plugin `name`: the installed entry when it is installed, a synthetic one otherwise. */
function apiFor(name: string): CallerApi {
    const installed = liveList().find((p) => p.name === name)
    const entry = installed ? plain(installed) : entryOf(makeScript(name, { body: 'caller' }), { realArg: {}, enabled: true })
    return makeRisuaiAPIV3({} as HTMLIFrameElement, entry)
}

let warnSpy: MockInstance<typeof console.warn>

/** Calls a setter. A synchronous throw becomes a rejection, a synchronous write still happens before this returns. */
async function send(kind: SetterKind, api: CallerApi, payload: Record<string, unknown>): Promise<unknown> {
    warnSpy.mockClear()
    return await (api[kind] as (db: unknown) => unknown)(payload)
}

/** The rejection message of `call`, or null when it fulfilled. */
async function failure(call: Promise<unknown>): Promise<string | null> {
    try {
        await call
        return null
    } catch (error) {
        return error instanceof Error ? error.message : `non-error rejection: ${String(error)}`
    }
}

function expectRejected(message: string | null, names: string[], reason: string): void {
    expect(message, 'the call is expected to reject').not.toBeNull()
    for (const name of names) {
        expect(message!).toContain(name)
    }
    expect(message!.toLowerCase()).toContain(reason)
}

/** The prompt that is open at `index`, or undefined when none opens. */
async function openPrompt(index = 0) {
    for (let i = 0; i < 100 && confirms.held.length <= index; i++) {
        await sleepTurn()
    }
    return confirms.held[index]
}

/**
 * Starts `start` with every prompt held, runs `whileOpen` once the first prompt
 * is open, answers it and every later prompt of the call the same way, and
 * returns the call's rejection message and the first prompt's text.
 */
async function withOpenPrompt(start: () => Promise<unknown>, whileOpen: () => void | Promise<void>, answer = true) {
    confirms.policy = () => 'hold'
    const outcome = failure(start())
    const prompt = await openPrompt(0)
    expect(prompt, 'a prompt is expected to open').toBeDefined()
    await whileOpen()
    confirms.policy = () => answer
    prompt!.settle(answer)
    return { message: await outcome, prompt: prompt!.text }
}

/** A snapshot of the plugin list with the entry `name` replaced. */
function listWith(name: string, replacement: RisuPlugin): RisuPlugin[] {
    return liveSummary().map((p) => (p.name === name ? replacement : p))
}

/** What a self-updater that rebuilds its own entry from its own header parser sends: no `allowedIPC`, an empty carried value. */
function rebuiltA(): RisuPlugin {
    return {
        name: A,
        displayName: A,
        script: A_V2,
        arguments: { key: 'string', newkey: 'string' },
        realArg: { key: '' },
        argMeta: {},
        version: '3.0',
        customLink: [],
        versionOfPlugin: '1.1.0',
        updateURL: '',
        enabled: true,
    } as RisuPlugin
}

beforeEach(async () => {
    // Plugin loads that an earlier test left running must not leave a plugin registered: a registered plugin is skipped by the next load.
    await sleepTurn()
    for (let i = 0; i < 6; i++) {
        await loadV3Plugins([])
    }
    confirms.texts.length = 0
    confirms.held.length = 0
    confirms.errors.length = 0
    confirms.policy = () => true
    runs.length = 0
    hotReloading.length = 0
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    for (const prompt of confirms.held) {
        prompt.settle(false)
    }
    vi.restoreAllMocks()
})

//#endregion

describe('S1 a snapshot written back unchanged', () => {
    test('setDatabase leaves every plugin as it was, asks nothing and keeps all saved values and enabled states', async () => {
        installBase()
        const before = liveSummary()
        const api = apiFor(A)
        const snapshot = await api.getDatabase('all') as unknown as Record<string, unknown>
        confirms.texts.length = 0

        await send('setDatabase', api, snapshot)

        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(liveEntry(A).realArg).toEqual({ key: 'secret-a' })
        expect(liveEntry(B).realArg).toEqual({ k: 'secret-b', cb: '1' })
        expect(liveEntry(B).enabled).toBe(false)
        expect(liveEntry(U).realArg).toEqual({ u: 'secret-u' })
        expect(liveEntry(U).enabled).toBeUndefined()
    })

    test('guard: setDatabaseLite leaves every plugin as it was, asks nothing and keeps all saved values and enabled states', async () => {
        installBase()
        const before = liveSummary()
        const api = apiFor(A)
        const snapshot = await api.getDatabase('all') as unknown as Record<string, unknown>
        confirms.texts.length = 0

        await send('setDatabaseLite', api, snapshot)

        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(liveEntry(A).realArg).toEqual({ key: 'secret-a' })
        expect(liveEntry(B).realArg).toEqual({ k: 'secret-b', cb: '1' })
        expect(liveEntry(B).enabled).toBe(false)
        expect(liveEntry(U).realArg).toEqual({ u: 'secret-u' })
        expect(liveEntry(U).enabled).toBeUndefined()
    })
})

describe.each(SETTERS)('S2/S3 a plugin updates itself through %s', (kind) => {
    test('one prompt names the plugin and the versions from and to; accepting updates it in place and keeps its saved value, IPC grant and on state', async () => {
        installBase()
        const before = liveSummary()
        const sent = [rebuiltA(), before[1], before[2]]

        const result = await send(kind, apiFor(A), { plugins: sent })

        expect(confirms.texts).toHaveLength(1)
        expect(confirms.texts[0]).toContain(A)
        expect(confirms.texts[0]).toContain('1.0.0')
        expect(confirms.texts[0]).toContain('1.1.0')
        expect(result).toBeUndefined()
        expect(liveNames()).toEqual([A, B, U])
        expect(liveEntry(A).script).toBe(A_V2)
        expect(liveEntry(A).versionOfPlugin).toBe('1.1.0')
        expect(liveEntry(A).realArg).toEqual({ key: 'secret-a', newkey: '' })
        expect(liveEntry(A).allowedIPC).toEqual([B])
        expect(liveEntry(A).enabled).toBe(true)
        expect(plain(liveEntry(B))).toEqual(before[1])
        expect(plain(liveEntry(U))).toEqual(before[2])
    })

    test('declining rejects naming the plugin and the reason, leaves the list as it was, and the rollback write then asks nothing and resolves', async () => {
        installBase()
        const before = liveSummary()
        confirms.policy = () => false

        const message = await failure(send(kind, apiFor(A), { plugins: [rebuiltA(), before[1], before[2]] }))

        expect(liveSummary()).toEqual(before)
        expectRejected(message, [A], 'declined')

        confirms.texts.length = 0
        await send(kind, apiFor(A), { plugins: before })
        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
    })

    test('the updated entry takes its details from the new script header, not from the fields the plugin sent', async () => {
        installBase()
        const richScript = makeScript(A, {
            version: '1.1.0',
            args: ['key string', 'newkey string'],
            ipc: [B],
            displayName: 'Plug A Display',
            updateUrl: 'https://example.invalid/plug-a.js',
            link: 'https://example.invalid/a hover text',
            body: 'a rich',
        })
        const sent = {
            ...rebuiltA(),
            script: richScript,
            displayName: 'sent display name',
            updateURL: 'https://example.invalid/sent.js',
            customLink: [{ link: 'https://example.invalid/sent' }],
            allowedIPC: ['sent-ipc'],
            versionOfPlugin: '0.0.1',
            arguments: { sent: 'string' },
            enabled: false,
        } as RisuPlugin

        await send(kind, apiFor(A), { plugins: [sent, ...liveSummary().slice(1)] })

        const updated = plain(liveEntry(A))
        expect(updated.script).toBe(richScript)
        expect(updated.displayName).toBe('Plug A Display')
        expect(updated.updateURL).toBe('https://example.invalid/plug-a.js')
        expect(updated.customLink).toEqual([{ link: 'https://example.invalid/a', hoverText: 'hover text' }])
        expect(updated.allowedIPC).toEqual([B])
        expect(updated.versionOfPlugin).toBe('1.1.0')
        expect(updated.arguments).toEqual({ key: 'string', newkey: 'string' })
        expect(updated.enabled).toBe(true)
    })
})

describe('S2/S3 V2 callers', () => {
    test('V2 setDatabaseLite with a plugin name asks about the self-update and rejects when it is declined', async () => {
        installBase()
        const before = liveSummary()
        confirms.policy = () => false

        const message = await failure(Promise.resolve().then(() => getV2PluginAPIs().setDatabaseLite({ plugins: [rebuiltA(), before[1], before[2]] }, A)))

        expect(confirms.texts).toHaveLength(1)
        expect(confirms.texts[0]).toContain(A)
        expect(liveSummary()).toEqual(before)
        expectRejected(message, [A], 'declined')
    })

    test('V2 setDatabase with a plugin name keeps the other plugins when it updates itself', async () => {
        installBase()
        const before = liveSummary()

        await getV2PluginAPIs().setDatabase({ plugins: [rebuiltA(), before[1], before[2]] }, A)

        expect(confirms.texts).toHaveLength(1)
        expect(confirms.texts[0]).toContain(A)
        expect(liveNames()).toEqual([A, B, U])
        expect(liveEntry(A).script).toBe(A_V2)
        expect(liveEntry(A).realArg).toEqual({ key: 'secret-a', newkey: '' })
    })

    test('a V2 caller that passes no name still gets a prompt that names the plugin being updated', async () => {
        installBase()
        const before = liveSummary()

        await getV2PluginAPIs().setDatabase({ plugins: [rebuiltA(), before[1], before[2]] })

        expect(confirms.texts).toHaveLength(1)
        expect(confirms.texts[0]).toContain(A)
        expect(liveNames()).toEqual([A, B, U])
    })
})

describe.each(SETTERS)('S4 a plugin updates another plugin through %s', (kind) => {
    const sentB = () => ({ ...liveSummary()[1], script: B_V11, versionOfPlugin: '1.1.0', realArg: { k: '', cb: '0' }, enabled: true }) as RisuPlugin

    test('one prompt names both plugins and the versions; accepting keeps the target\'s saved values (a checkbox int stays a string) and its off state', async () => {
        installBase()
        const before = liveSummary()

        await send(kind, apiFor(A), { plugins: [before[0], sentB(), before[2]] })

        expect(confirms.texts).toHaveLength(1)
        expect(confirms.texts[0]).toContain(A)
        expect(confirms.texts[0]).toContain(B)
        expect(confirms.texts[0]).toContain('1.0.0')
        expect(confirms.texts[0]).toContain('1.1.0')
        expect(liveNames()).toEqual([A, B, U])
        expect(liveEntry(B).script).toBe(B_V11)
        expect(liveEntry(B).realArg).toEqual({ k: 'secret-b', cb: '1' })
        expect(liveEntry(B).enabled).toBe(false)
        expect(plain(liveEntry(A))).toEqual(before[0])
        expect(plain(liveEntry(U))).toEqual(before[2])
    })

    test('S4u updating a plugin whose enabled state is unset keeps it unset, so loadPlugins does not run it', async () => {
        installBase()
        const before = liveSummary()
        const sentU = { ...before[2], script: U_V11, versionOfPlugin: '1.1.0', enabled: true } as RisuPlugin

        await send(kind, apiFor(A), { plugins: [before[0], before[1], sentU] })

        expect(liveNames()).toEqual([A, B, U])
        expect(liveEntry(U).script).toBe(U_V11)
        expect(liveEntry(U).realArg).toEqual({ u: 'secret-u' })
        expect(liveEntry(U).enabled).toBeUndefined()
        runs.length = 0
        await loadPlugins()
        expect(runs).toContain(A_V1)
        expect(runs).not.toContain(U_V11)
    })
})

describe.each(SETTERS)('S5 a list that omits an installed plugin through %s', (kind) => {
    test('removes nothing and asks nothing', async () => {
        installBase()
        const before = liveSummary()

        await send(kind, apiFor(A), { plugins: [before[0], before[2]] })

        expect(confirms.texts).toHaveLength(0)
        expect(liveNames()).toEqual([A, B, U])
        expect(liveSummary()).toEqual(before)
    })

    test('a field edit on an entry whose script is unchanged is ignored with a warning and no prompt: a caller cannot rewrite another plugin\'s values or state through the list', async () => {
        installBase()
        const before = liveSummary()
        const editedB = { ...before[1], realArg: { k: 'written-by-a', cb: '0' }, enabled: true } as RisuPlugin

        const message = await failure(send(kind, apiFor(A), { plugins: [before[0], editedB, before[2]] }))

        expect(message).toBeNull()
        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(warnSpy).toHaveBeenCalled()
    })
})

describe('S5 setDatabaseLite with only ignored plugin entries', () => {
    test('guard: writes its other keys before it returns', async () => {
        installBase([fullCharacter('char-0')])
        const before = liveSummary()
        const edited = plain(DBState.db.characters)
        edited[0].name = 'edited by plugin'

        const returned = (apiFor(A).setDatabaseLite as (db: unknown) => unknown)({ plugins: before, characters: edited })

        expect(liveCharacter('char-0').name).toBe('edited by plugin')
        expect(liveSummary()).toEqual(before)
        await returned
    })
})

describe.each(SETTERS)('S6 a plugin installs another plugin through %s', (kind) => {
    test('the prompt names the new plugin and the plugin that asks; accepting appends it with header-default values and switches it on', async () => {
        installBase()
        const before = liveSummary()

        await send(kind, apiFor(A), { plugins: [...before, sentC()] })

        expect(confirms.texts).toHaveLength(1)
        expect(confirms.texts[0]).toContain(C)
        expect(confirms.texts[0]).toContain(A)
        expect(liveNames()).toEqual([A, B, U, C])
        expect(liveEntry(C).script).toBe(C_V1)
        expect(liveEntry(C).realArg).toEqual({ token: '' })
        expect(liveEntry(C).enabled).toBe(true)
        expect(liveSummary().slice(0, 3)).toEqual(before)
    })

    test('declining rejects naming the plugin and the reason and leaves the list as it was', async () => {
        installBase()
        const before = liveSummary()
        confirms.policy = () => false

        const message = await failure(send(kind, apiFor(A), { plugins: [...before, sentC()] }))

        expect(liveSummary()).toEqual(before)
        expectRejected(message, [C], 'declined')
    })

    test.each([
        ['an API 2.1 header', makeScript(C, { api: '2.1', args: ['token string'] })],
        ['a header with no API', makeScript(C, { api: null, args: ['token string'] })],
        ['a header that does not parse', makeScript(C, { args: ['token float'] })],
        ['a header that names another plugin', makeScript(A, { version: '1.0.0', args: ['token string'], body: 'imposter' })],
    ])('%s is refused before any prompt: the call rejects naming the plugin and the list is unchanged', async (_label, script) => {
        installBase()
        const before = liveSummary()

        const message = await failure(send(kind, apiFor(A), { plugins: [...before, entryOf(makeScript(C, { args: ['token string'] }), { extra: { script } })] }))

        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expectRejected(message, [C], 'refused')
    })
})

describe('S6 setDatabaseLite with a plugin list that cannot be applied', () => {
    test('never throws synchronously: the other keys are written before it returns and the failure is a rejected promise', async () => {
        installBase([fullCharacter('char-0')])
        const edited = plain(DBState.db.characters)
        edited[0].name = 'renamed by plugin'
        let outcome: Promise<unknown> | undefined

        expect(() => {
            outcome = (apiFor(A).setDatabaseLite as (db: unknown) => Promise<unknown>)({ plugins: 'not-a-list', characters: edited })
        }).not.toThrow()

        expect(liveCharacter('char-0').name).toBe('renamed by plugin')
        expect(outcome).toBeInstanceOf(Promise)
        expect(await failure(outcome as Promise<unknown>)).not.toBeNull()
    })
})

describe.each(SETTERS)('S7-style refused updates through %s', (kind) => {
    test.each([
        ['a header that names another plugin', makeScript('plug-other', { version: '2.0.0', args: ['k string', 'cb int {{checkbox}}'] })],
        ['an API 2.1 header', makeScript(B, { api: '2.1', version: '2.0.0', args: ['k string'] })],
        ['a header that does not parse', makeScript(B, { version: '2.0.0', args: ['k float'] })],
        ['a header that does not parse and carries the installed version', makeScript(B, { version: '1.0.0', args: ['k float'] })],
    ])('an update of an installed plugin with %s is refused before any prompt: the call rejects naming the plugin and the list is unchanged', async (_label, script) => {
        installBase()
        const before = liveSummary()
        const sent = { ...before[1], script } as RisuPlugin

        const message = await failure(send(kind, apiFor(A), { plugins: [before[0], sent, before[2]] }))

        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expectRejected(message, [B], 'refused')
    })
})

describe('S7 the Update button and a manual re-import', () => {
    /** B with saved values, one dropped argument and one argument that changes type. */
    const B_OLD = makeScript(B, { version: '1.0.0', args: ['k string', 'cb int {{checkbox}}', 'old string', 't string'], body: 'b old' })
    const B_NEW = makeScript(B, { version: '1.3.0', args: ['k string', 'cb int {{checkbox}}', 't int', 'fresh string'], body: 'b new' })
    const installWithSavedValues = () => installDb([
        fixtureA(),
        entryOf(B_OLD, { realArg: { k: 'secret-b', cb: '1', old: 'x', t: 'text' }, enabled: false }),
        fixtureU(),
    ])

    test('the Update button keeps saved values and the off state; a retyped argument takes the default and a dropped argument is gone', async () => {
        installWithSavedValues()

        await importPlugin(B_NEW, { isUpdate: true, originalPluginName: B })

        expect(liveNames()).toEqual([A, B, U])
        expect(liveEntry(B).script).toBe(B_NEW)
        expect(liveEntry(B).realArg).toEqual({ k: 'secret-b', cb: '1', t: 0, fresh: '' })
        expect(liveEntry(B).enabled).toBe(false)
    })

    test('the Update button keeps a plugin whose enabled state is unset unset', async () => {
        installBase()

        await importPlugin(U_V11, { isUpdate: true, originalPluginName: U })

        expect(liveEntry(U).script).toBe(U_V11)
        expect(liveEntry(U).realArg).toEqual({ u: 'secret-u' })
        expect(liveEntry(U).enabled).toBeUndefined()
    })

    test('the //@update-url updater keeps saved values and the off state', async () => {
        installWithSavedValues()
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200, text: async () => B_NEW } as Response)

        const updated = await updatePlugin({ ...plain(liveEntry(B)), updateURL: 'https://example.invalid/plug-b.js' })

        expect(updated).toBe(true)
        expect(liveEntry(B).script).toBe(B_NEW)
        expect(liveEntry(B).realArg).toEqual({ k: 'secret-b', cb: '1', t: 0, fresh: '' })
        expect(liveEntry(B).enabled).toBe(false)
    })

    test('a confirmed manual re-import of the same name keeps saved values and the off state', async () => {
        installWithSavedValues()

        await importPlugin(B_NEW)

        expect(confirms.texts).toHaveLength(1)
        expect(liveNames()).toEqual([A, B, U])
        expect(liveEntry(B).script).toBe(B_NEW)
        expect(liveEntry(B).realArg).toEqual({ k: 'secret-b', cb: '1', t: 0, fresh: '' })
        expect(liveEntry(B).enabled).toBe(false)
    })

    test('a saved value edited in Settings while the duplicate prompt is open survives the re-import', async () => {
        installWithSavedValues()
        confirms.policy = () => 'hold'

        const done = importPlugin(B_NEW)
        const prompt = await openPrompt(0)
        expect(prompt, 'the duplicate prompt is expected to open').toBeDefined()
        liveEntry(B).realArg.k = 'edited-in-settings'
        prompt!.settle(true)
        await done

        expect(liveEntry(B).script).toBe(B_NEW)
        expect(liveEntry(B).realArg.k).toBe('edited-in-settings')
        expect(liveEntry(B).enabled).toBe(false)
    })

    test('guard: declining the duplicate prompt leaves the installed plugin as it was', async () => {
        installWithSavedValues()
        const before = liveSummary()
        confirms.policy = () => false

        await importPlugin(B_NEW)

        expect(liveSummary()).toEqual(before)
    })
})

describe('S7h hot reload', () => {
    const B_HOT = makeScript(B, { version: '1.0.0', args: ['k string', 'cb int {{checkbox}}'], body: 'b hot' })

    test('a disabled plugin keeps its saved values and is switched on', async () => {
        installBase()

        await importPlugin(B_HOT, { isHotReload: true, isUpdate: true })

        expect(liveNames()).toEqual([A, B, U])
        expect(liveEntry(B).script).toBe(B_HOT)
        expect(liveEntry(B).realArg).toEqual({ k: 'secret-b', cb: '1' })
        expect(liveEntry(B).enabled).toBe(true)
        expect(hotReloading).toContain(B)
    })

    test('guard: hot reload replaces the script even when the version did not change', async () => {
        installBase()

        await importPlugin(B_HOT, { isHotReload: true, isUpdate: true })

        expect(liveEntry(B).versionOfPlugin).toBe('1.0.0')
        expect(liveEntry(B).script).toBe(B_HOT)
    })

    test('guard: hot reload of a plugin that is not installed installs it switched on', async () => {
        installBase()

        await importPlugin(C_V1, { isHotReload: true, isUpdate: true })

        expect(liveNames()).toEqual([A, B, U, C])
        expect(liveEntry(C).enabled).toBe(true)
        expect(liveEntry(C).realArg).toEqual({ token: '' })
    })
})

describe('loadPlugins', () => {
    test('guard: runs the enabled plugins and not a disabled one or one whose enabled state is unset', async () => {
        installBase()
        runs.length = 0

        await loadPlugins()

        expect(runs).toEqual([A_V1])
    })
})

describe.each(SETTERS)('S8 Settings changes while a prompt is open, through %s', (kind) => {
    test('S8a a plugin removed in Settings is not brought back by the accepted update', async () => {
        installBase()
        const before = liveSummary()

        const { message } = await withOpenPrompt(
            () => send(kind, apiFor(A), { plugins: [rebuiltA(), before[1], before[2]] }),
            () => { liveList().splice(1, 1) },
        )

        expect(message).toBeNull()
        expect(liveNames()).toEqual([A, U])
        expect(liveEntry(A).script).toBe(A_V2)
    })

    test('S8b a plugin installed in Settings meanwhile stays; the accepted install is appended after it', async () => {
        installBase()
        const before = liveSummary()

        const { message } = await withOpenPrompt(
            () => send(kind, apiFor(A), { plugins: [...before, sentC()] }),
            () => { liveList().push(entryOf(D_V1, { realArg: { dk: '' }, enabled: true })) },
        )

        expect(message).toBeNull()
        expect(liveNames()).toEqual([A, B, U, D, C])
    })

    test('S8c an update whose target was removed meanwhile rejects as changed meanwhile and the list keeps what Settings left', async () => {
        installBase()
        const before = liveSummary()

        const { message } = await withOpenPrompt(
            () => send(kind, apiFor(A), { plugins: [before[0], { ...before[1], script: B_V11, versionOfPlugin: '1.1.0' } as RisuPlugin, before[2]] }),
            () => { liveList().splice(1, 1) },
        )

        expectRejected(message, [B], 'changed meanwhile')
        expect(liveNames()).toEqual([A, U])
    })

    test('S8d an update whose target was replaced by the Update button meanwhile rejects as changed meanwhile and the replacement stays', async () => {
        installBase()
        const before = liveSummary()

        const { message } = await withOpenPrompt(
            () => send(kind, apiFor(A), { plugins: [before[0], { ...before[1], script: B_V11, versionOfPlugin: '1.1.0' } as RisuPlugin, before[2]] }),
            async () => { await importPlugin(B_V12, { isUpdate: true, originalPluginName: B }) },
        )

        expectRejected(message, [B], 'changed meanwhile')
        expect(liveNames()).toEqual([A, B, U])
        expect(liveEntry(B).script).toBe(B_V12)
    })

    test('S8e a saved value edited in Settings while the prompt is open survives the accepted update', async () => {
        installBase()
        const before = liveSummary()

        const { message } = await withOpenPrompt(
            () => send(kind, apiFor(A), { plugins: [rebuiltA(), before[1], before[2]] }),
            () => { liveEntry(A).realArg.key = 'new' },
        )

        expect(message).toBeNull()
        expect(liveEntry(A).script).toBe(A_V2)
        expect(liveEntry(A).realArg.key).toBe('new')
    })

    test('S8e a saved value edited and then edited back while the prompt is open ends as the value it was edited back to', async () => {
        installBase()
        const before = liveSummary()

        const { message } = await withOpenPrompt(
            () => send(kind, apiFor(A), { plugins: [rebuiltA(), before[1], before[2]] }),
            () => {
                liveEntry(A).realArg.key = 'new'
                liveEntry(A).realArg.key = 'secret-a'
            },
        )

        expect(message).toBeNull()
        expect(liveEntry(A).script).toBe(A_V2)
        expect(liveEntry(A).realArg.key).toBe('secret-a')
    })

    test('S8f a plugin switched off in Settings while the prompt is open stays off after the accepted update', async () => {
        installBase()
        const before = liveSummary()

        const { message } = await withOpenPrompt(
            () => send(kind, apiFor(A), { plugins: [rebuiltA(), before[1], before[2]] }),
            () => { liveEntry(A).enabled = false },
        )

        expect(message).toBeNull()
        expect(liveEntry(A).script).toBe(A_V2)
        expect(liveEntry(A).enabled).toBe(false)
    })
})

describe.each(SETTERS)('S9 stale copies and older versions through %s', (kind) => {
    const editedCharacters = () => {
        const edited = plain(DBState.db.characters)
        edited[0].name = 'edited by plugin P'
        return edited
    }

    test('a plugin writing back a snapshot taken before an update does not revert it: no prompt, the other keys are saved, the call resolves and warns', async () => {
        installBase([fullCharacter('char-0')])
        const staleSnapshot = liveSummary()
        installDb([entryOf(A_V2, { realArg: { key: 'secret-a', newkey: '' }, enabled: true }), fixtureB(), fixtureU()], [fullCharacter('char-0')])
        const edited = editedCharacters()

        const message = await failure(send(kind, apiFor(P), { plugins: staleSnapshot, characters: edited }))

        expect(message).toBeNull()
        expect(confirms.texts).toHaveLength(0)
        expect(liveEntry(A).script).toBe(A_V2)
        expect(liveEntry(A).versionOfPlugin).toBe('1.1.0')
        expect(liveCharacter('char-0').name).toBe('edited by plugin P')
        expect(warnSpy).toHaveBeenCalled()
    })

    test('an entry with the installed version but another script is ignored with a warning and no prompt', async () => {
        installBase()
        const before = liveSummary()
        const sameVersionOtherScript = { ...before[1], script: makeScript(B, { version: '1.0.0', args: ['k string', 'cb int {{checkbox}}'], body: 'b other body' }) } as RisuPlugin

        const message = await failure(send(kind, apiFor(P), { plugins: [before[0], sameVersionOtherScript, before[2]] }))

        expect(message).toBeNull()
        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(warnSpy).toHaveBeenCalled()
    })

    test('a removed plugin that a stale snapshot still holds is asked for as a new install; declining saves the other keys and rejects', async () => {
        installBase([fullCharacter('char-0')])
        const staleSnapshot = liveSummary()
        liveList().splice(1, 1)
        const before = liveSummary()
        confirms.policy = () => false

        const message = await failure(send(kind, apiFor(P), { plugins: staleSnapshot, characters: editedCharacters() }))

        expect(confirms.texts).toHaveLength(1)
        expect(confirms.texts[0]).toContain(B)
        expect(liveSummary()).toEqual(before)
        expect(liveCharacter('char-0').name).toBe('edited by plugin P')
        expectRejected(message, [B], 'declined')
    })

    test('a removed plugin that a stale snapshot still holds comes back with header defaults when the install is accepted', async () => {
        installBase()
        const staleSnapshot = liveSummary()
        liveList().splice(1, 1)

        const message = await failure(send(kind, apiFor(P), { plugins: staleSnapshot }))

        expect(message).toBeNull()
        expect(confirms.texts).toHaveLength(1)
        expect(liveNames()).toEqual([A, U, B])
        expect(liveEntry(B).realArg).toEqual({ k: '', cb: 0 })
        expect(liveEntry(B).enabled).toBe(true)
    })
})

describe.each(SETTERS)('S9b a plugin\'s own entry that the host does not see as newer, through %s', (kind) => {
    const cases: Array<[string, string, string]> = [
        ['the same version with another script', '1.0.0', '1.0.0'],
        ['a later release candidate of the same version', '1.0.0-rc1', '1.0.0-rc2'],
        ['the release after a release candidate', '1.0.0-rc1', '1.0.0'],
    ]

    function install(installedVersion: string) {
        const installedScript = makeScript(A, { version: installedVersion, args: ['key string'], body: 'a installed' })
        installDb([entryOf(installedScript, { realArg: { key: 'secret-a' }, enabled: true }), fixtureB(), fixtureU()], [fullCharacter('char-0')])
    }
    const sentOwn = (version: string) => ({ ...liveSummary()[0], script: makeScript(A, { version, args: ['key string'], body: 'a other' }) }) as RisuPlugin
    const editedCharacters = () => {
        const edited = plain(DBState.db.characters)
        edited[0].name = 'edited by plugin'
        return edited
    }

    test.each(cases)('%s: no prompt and no change, the other keys are saved, and the call rejects as not newer than installed', async (_label, installedVersion, incomingVersion) => {
        install(installedVersion)
        const before = liveSummary()

        const message = await failure(send(kind, apiFor(A), { plugins: [sentOwn(incomingVersion), before[1], before[2]], characters: editedCharacters() }))

        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(liveCharacter('char-0').name).toBe('edited by plugin')
        expectRejected(message, [], `not newer than installed ${A} ${installedVersion}`)
    })

    test.each(cases)('%s: the same write from another plugin resolves with a warning and no prompt', async (_label, installedVersion, incomingVersion) => {
        install(installedVersion)
        const before = liveSummary()

        const message = await failure(send(kind, apiFor(P), { plugins: [sentOwn(incomingVersion), before[1], before[2]], characters: editedCharacters() }))

        expect(message).toBeNull()
        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(liveCharacter('char-0').name).toBe('edited by plugin')
        expect(warnSpy).toHaveBeenCalled()
    })

    test('an installed plugin without a version names "(no version)" in the not-newer rejection', async () => {
        const unversioned = entryOf(A_V1, { realArg: { key: 'secret-a' }, enabled: true, extra: { versionOfPlugin: undefined } })
        installDb([unversioned, fixtureB(), fixtureU()])
        const before = liveSummary()

        const message = await failure(send(kind, apiFor(A), { plugins: [{ ...before[0], script: A_V2 } as RisuPlugin, before[1], before[2]] }))

        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expectRejected(message, [], `not newer than installed ${A} (no version)`)
    })

    test('a call that also carries a valid install shows no prompt, installs nothing, saves the other keys and rejects as not newer', async () => {
        install('1.0.0')
        const before = liveSummary()

        const message = await failure(send(kind, apiFor(A), { plugins: [sentOwn('1.0.0'), before[1], before[2], sentC()], characters: editedCharacters() }))

        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(liveCharacter('char-0').name).toBe('edited by plugin')
        expectRejected(message, [A], 'not newer than installed')
    })
})

describe.each(SETTERS)('S9c entries whose version cannot be compared, through %s', (kind) => {
    const B_V20 = makeScript(B, { version: '2.0.0', args: ['k string', 'cb int {{checkbox}}'], body: 'b v20' })

    test.each([
        ['an empty installed version', { versionOfPlugin: '' }],
        ['an installed entry without a version', { versionOfPlugin: undefined }],
        ['a numeric installed version', { versionOfPlugin: 2 }],
    ])('%s: the update is ignored with a warning, no prompt and no throw', async (_label, extra) => {
        installDb([fixtureA(), { ...fixtureB(), ...extra } as RisuPlugin, fixtureU()])
        const before = liveSummary()

        const message = await failure(send(kind, apiFor(A), { plugins: [before[0], { ...before[1], script: B_V20, versionOfPlugin: '2.0.0' } as RisuPlugin, before[2]] }))

        expect(message).toBeNull()
        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(warnSpy).toHaveBeenCalled()
    })

    test('an incoming script without a version line is ignored with a warning, no prompt and no throw', async () => {
        installBase()
        const before = liveSummary()
        const versionless = makeScript(B, { version: null, args: ['k string', 'cb int {{checkbox}}'], body: 'b versionless' })

        const message = await failure(send(kind, apiFor(A), { plugins: [before[0], { ...before[1], script: versionless } as RisuPlugin, before[2]] }))

        expect(message).toBeNull()
        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(warnSpy).toHaveBeenCalled()
    })
})

describe.each(SETTERS)('S9d a refusal in a call with a valid install, through %s', (kind) => {
    test('no prompt is shown, the other keys are saved, the list is unchanged and the call rejects naming the refused plugin', async () => {
        installBase([fullCharacter('char-0')])
        const before = liveSummary()
        const edited = plain(DBState.db.characters)
        edited[0].name = 'edited by plugin'
        const refusedD = entryOf(D_V1, { extra: { script: makeScript(D, { api: '2.1', args: ['dk string'] }) } })

        const message = await failure(send(kind, apiFor(A), { plugins: [...before, sentC(), refusedD], characters: edited }))

        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(liveCharacter('char-0').name).toBe('edited by plugin')
        expectRejected(message, [D], 'refused')
    })
})

describe.each(SETTERS)('S10 calls without a plugins key, through %s', (kind) => {
    test('guard: a call with only characters writes them and never touches the plugin list or prompts', async () => {
        installBase([fullCharacter('char-0')])
        const before = liveSummary()
        const edited = plain(DBState.db.characters)
        edited[0].name = 'edited by plugin'

        await send(kind, apiFor(A), { characters: edited })

        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(liveCharacter('char-0').name).toBe('edited by plugin')
    })

    test('guard: a call with only modules writes them and never touches the plugin list or prompts', async () => {
        installBase()
        const before = liveSummary()

        await send(kind, apiFor(A), { modules: [{ id: 'module-1', name: 'module one' }] })

        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(plain(DBState.db.modules)).toEqual([{ id: 'module-1', name: 'module one' }])
    })
})

describe.each(SETTERS)('S11 an archived character restored while a prompt is open, through %s', (kind) => {
    const HERO_UNIT = 'unit-hero'

    function setup() {
        const hero = fullCharacter('hero')
        installBase([fullCharacter('warm'), stubOf(hero, HERO_UNIT)])
        const characters = plain(DBState.db.characters)
        characters[0].name = 'warm renamed by plugin'
        return { characters, restore: () => { DBState.db.characters[1] = fullCharacter('hero') } }
    }

    test(`${kind === 'setDatabase' ? 'guard: ' : ''}accepting keeps the restored character full`, async () => {
        const { characters, restore } = setup()
        const before = liveSummary()

        const { message } = await withOpenPrompt(
            () => send(kind, apiFor(A), { plugins: [...before, sentC()], characters }),
            restore,
        )

        expect(message).toBeNull()
        expect(liveCharacter('hero').coldstorage).toBeUndefined()
        expect(liveCharacter('hero').desc).toBe('hero description')
        expect(liveCharacter('warm').name).toBe('warm renamed by plugin')
    })

    test('declining keeps the restored character full, writes the remaining characters and rejects', async () => {
        const { characters, restore } = setup()
        const before = liveSummary()

        const { message } = await withOpenPrompt(
            () => send(kind, apiFor(A), { plugins: [...before, sentC()], characters }),
            restore,
            false,
        )

        expect(liveCharacter('hero').coldstorage).toBeUndefined()
        expect(liveCharacter('hero').desc).toBe('hero description')
        expect(liveCharacter('warm').name).toBe('warm renamed by plugin')
        expect(liveSummary()).toEqual(before)
        expectRejected(message, [C], 'declined')
    })
})

describe.each(SETTERS)('S12 malformed input, through %s', (kind) => {
    test('a plugins value that is not an array writes the other keys and rejects as not an array', async () => {
        installBase([fullCharacter('char-0')])
        const before = liveSummary()
        const edited = plain(DBState.db.characters)
        edited[0].name = 'edited by plugin'

        const message = await failure(send(kind, apiFor(A), { plugins: 'not-a-list', characters: edited }))

        expect(liveCharacter('char-0').name).toBe('edited by plugin')
        expect(liveSummary()).toEqual(before)
        expectRejected(message, [], 'not an array')
    })

    test('entries without a string name or without a string script are ignored with a warning, no prompt and no change', async () => {
        installBase()
        const before = liveSummary()
        const noName = { ...sentC(), name: undefined } as unknown as RisuPlugin
        const noScript = { ...sentD(), script: undefined } as unknown as RisuPlugin

        const message = await failure(send(kind, apiFor(A), { plugins: [...before, noName, noScript] }))

        expect(message).toBeNull()
        expect(confirms.texts).toHaveLength(0)
        expect(liveSummary()).toEqual(before)
        expect(warnSpy).toHaveBeenCalled()
    })

    test('when a list repeats a name the first entry counts and the later one is ignored with a warning', async () => {
        installBase()
        const before = liveSummary()
        const later = entryOf(makeScript(C, { version: '2.0.0', args: ['token string'], body: 'c later' }), { realArg: { token: '' } })

        const message = await failure(send(kind, apiFor(A), { plugins: [...before, sentC(), later] }))

        expect(message).toBeNull()
        expect(confirms.texts).toHaveLength(1)
        expect(liveNames()).toEqual([A, B, U, C])
        expect(liveEntry(C).script).toBe(C_V1)
        expect(warnSpy).toHaveBeenCalled()
    })

    test('a script with a leading byte order mark is installed from its header and is stored exactly as sent', async () => {
        installBase()
        const before = liveSummary()
        const withBom = `﻿${C_V1}`

        const message = await failure(send(kind, apiFor(A), { plugins: [...before, entryOf(C_V1, { extra: { script: withBom } })] }))

        expect(message).toBeNull()
        expect(liveNames()).toEqual([A, B, U, C])
        expect(liveEntry(C).script).toBe(withBom)
        expect(liveEntry(C).realArg).toEqual({ token: '' })
    })
})

describe.each(SETTERS)('S13 two concurrent calls that install the same plugin, through %s', (kind) => {
    test('the plugin appears once and the call that applies second rejects as changed meanwhile', async () => {
        installBase()
        const before = liveSummary()
        confirms.policy = () => 'hold'

        const first = failure(send(kind, apiFor(A), { plugins: [...before, sentC()] }))
        const second = failure(send(kind, apiFor(P), { plugins: [...before, sentC()] }))
        const firstPrompt = await openPrompt(0)
        expect(firstPrompt, 'a prompt is expected to open').toBeDefined()
        firstPrompt!.settle(true)
        expect(await first).toBeNull()
        const secondPrompt = await openPrompt(1)
        expect(secondPrompt, 'the second call is expected to prompt as well').toBeDefined()
        secondPrompt!.settle(true)
        const secondMessage = await second

        expect(liveList().filter((p) => p.name === C)).toHaveLength(1)
        expectRejected(secondMessage, [C], 'changed meanwhile')
    })
})

describe.each(SETTERS)('S13b prompt order and the first decline in a call that updates and installs, through %s', (kind) => {
    const updatedB = () => ({ ...liveSummary()[1], script: B_V11, versionOfPlugin: '1.1.0' }) as RisuPlugin
    const installFirst = () => { const [a, , u] = liveSummary(); return [a, sentC(), updatedB(), u] }
    const updateFirst = () => { const [a, , u] = liveSummary(); return [a, updatedB(), sentC(), u] }
    const editedCharacters = () => {
        const edited = plain(DBState.db.characters)
        edited[0].name = 'edited by plugin'
        return edited
    }

    test('an install listed before an update is asked first; declining it stops the prompting, saves the other keys, leaves the list as it was and rejects naming the install', async () => {
        installBase([fullCharacter('char-0')])
        const before = liveSummary()
        const plugins = installFirst()
        confirms.policy = () => false

        const message = await failure(send(kind, apiFor(A), { plugins, characters: editedCharacters() }))

        expect(confirms.texts).toHaveLength(1)
        expect(confirms.texts[0]).toContain(C)
        expect(confirms.texts[0]).not.toContain(B)
        expect(liveSummary()).toEqual(before)
        expect(liveCharacter('char-0').name).toBe('edited by plugin')
        expectRejected(message, [C], 'declined')
    })

    test('prompts follow the order of the incoming list across installs and updates, and accepting all of them applies both changes', async () => {
        installBase()
        const before = liveSummary()

        const message = await failure(send(kind, apiFor(A), { plugins: installFirst() }))

        expect(message).toBeNull()
        expect(confirms.texts).toHaveLength(2)
        expect(confirms.texts[0]).toContain(C)
        expect(confirms.texts[0]).not.toContain(B)
        expect(confirms.texts[1]).toContain(B)
        expect(confirms.texts[1]).not.toContain(C)
        expect(liveNames()).toEqual([A, B, U, C])
        expect(liveEntry(B).script).toBe(B_V11)
        expect(liveEntry(C).script).toBe(C_V1)
        expect(liveSummary()[0]).toEqual(before[0])
        expect(liveSummary()[2]).toEqual(before[2])
    })

    test('an update listed before an install is asked first; declining it stops the prompting and rejects naming the update', async () => {
        installBase([fullCharacter('char-0')])
        const before = liveSummary()
        const plugins = updateFirst()
        confirms.policy = () => false

        const message = await failure(send(kind, apiFor(A), { plugins, characters: editedCharacters() }))

        expect(confirms.texts).toHaveLength(1)
        expect(confirms.texts[0]).toContain(B)
        expect(confirms.texts[0]).not.toContain(C)
        expect(liveSummary()).toEqual(before)
        expect(liveCharacter('char-0').name).toBe('edited by plugin')
        expectRejected(message, [B], 'declined')
    })
})

describe('S14 installPlugin', () => {
    test('returns the accepted installs, writes nothing, and the prompt names the plugin', async () => {
        installBase()
        const before = liveSummary()

        const accepted = await apiFor(A).installPlugin([sentC()])

        expect(confirms.texts).toHaveLength(1)
        expect(confirms.texts[0]).toContain(C)
        expect(accepted.map((p) => p.name)).toEqual([C])
        expect(liveSummary()).toEqual(before)
    })

    test('an entry with an installed name is not an install: it is left out of the result with a warning and no prompt', async () => {
        installBase()
        const before = liveSummary()
        warnSpy.mockClear()

        const accepted = await apiFor(A).installPlugin([{ ...before[0], script: A_V2 } as RisuPlugin])

        expect(confirms.texts).toHaveLength(0)
        expect(accepted).toEqual([])
        expect(warnSpy).toHaveBeenCalled()
        expect(liveSummary()).toEqual(before)
    })

    test('guard: a declined install is left out of the result', async () => {
        installBase()
        confirms.policy = () => false

        const accepted = await apiFor(A).installPlugin([sentC()])

        expect(accepted).toEqual([])
    })
})

describe('importPlugin refusals (parity table)', () => {
    const cases: Array<[string, string, string]> = [
        ['an empty name', '//@name\n//@api 3.0', 'plugin name must be longer than 0, did you put it correctly?'],
        ['no name', '//@api 3.0\n// body', 'plugin name not found, did you put it correctly?'],
        ['an argument without a type', '//@name plug-x\n//@api 3.0\n//@arg x', 'plugin argument is incorrect, did you put space in argument name?'],
        ['an unknown argument type', '//@name plug-x\n//@api 3.0\n//@arg x float', 'plugin argument type is "float", which is an unknown type.'],
        ['a link that is not https', '//@name plug-x\n//@api 3.0\n//@link http://example.invalid/x', 'plugin link must start with https, did you check it?'],
        ['an update URL that is not https', '//@name plug-x\n//@api 3.0\n//@version 1.0.0\n//@update-url http://example.invalid/x.js', 'plugin update URL must start with https, did you put it correctly?'],
        ['an update URL without a version', '//@name plug-x\n//@api 3.0\n//@update-url https://example.invalid/x.js', 'plugin version not found, did you put it correctly? It is required when update URL is provided.'],
        ['a version below 0.0.1', '//@name plug-x\n//@api 3.0\n//@version 0.0.0', 'plugin version must be at least 0.0.1'],
        ['API 2.1', '//@name plug-x\n//@api 2.1\n//@version 1.0.0', 'Your plugin specifies API version 2.1, which is outdated and no longer supported. Please update your plugin to use at least API version 3.0.'],
        ['no API', '//@name plug-x\n//@version 1.0.0', 'Your code does not include //@api or specifies API version 2.0, which is outdated. Please update your plugin to use at least API version 3.0.'],
    ]

    test.each(cases)('guard: %s is refused with the same text and installs nothing', async (_label, script, text) => {
        installBase()
        const before = liveSummary()

        await importPlugin(script)

        expect(confirms.errors).toEqual([text])
        expect(liveSummary()).toEqual(before)
    })

    test('guard: a header that names another plugin is refused as an update and changes nothing', async () => {
        installBase()
        const before = liveSummary()

        await importPlugin(makeScript('plug-other', { version: '2.0.0' }), { isUpdate: true, originalPluginName: B })

        expect(confirms.errors).toHaveLength(1)
        expect(confirms.errors[0]).toContain(B)
        expect(liveSummary()).toEqual(before)
    })
})
