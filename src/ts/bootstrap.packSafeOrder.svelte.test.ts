// @vitest-environment jsdom
/**
 * The page's order on Android: a theme pack never paints before the host has decided whether the app starts without it
 * (#629 S2). REAL: `loadData`, the host bridge, the launch options, the pack safe flag and mode, the colour modules, the
 * driver, the apply, the intake, the install flow, the surface gate and the real Tauri store over the in-memory IPC of
 * `tauriWireFake`. FAKED: the judge worker channel (real verdicts, no real Worker), object URLs, the host and the plugin
 * loader, which is a probe that reads the colour the way plugin API v3 does and tells the test it was reached.
 *
 * The profile comes from the real install flow over a pack built by `zipPack` (MC-329): the driver enters its scheme over a
 * distinct own scheme, and that profile and archive are what every case boots. `stores.svelte` and `database.svelte` are
 * `vi.doMock`ed from a `.svelte.ts` helper after every `vi.resetModules()`, so a case never boots a dead database graph.
 * OR-6 is the positive control: its pack is applied in the same harness, with the archive read and a sheet in the document.
 * Titles say reproducer (fails on the base at the named assertion) or guard (may pass before and after).
 */
import { createHash } from 'node:crypto'
import { setImmediate as macrotask } from 'node:timers/promises'
import { get } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installTauriWire, type TauriWire, type WireCall } from 'src/ts/storage/tests/tauriWireFake'
import { registerRealDispatch, stopAcknowledgingAlerts } from 'src/ts/tests/realDispatchBoot.test-helpers'
import { plainCopy, type BootGraphState, type Plain } from 'src/ts/tests/packSafeOrder.test-helpers.svelte'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { manifestText, validPackFiles, zipPack } from 'src/ts/themePack/fixtures/packBuilder'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 })

const h = vi.hoisted(() => ({
    isTauri: true,
    isNodeServer: false,
    bars: [] as string[],
    repairRejects: false,
    plant: (_key: string, _bytes: Uint8Array): void => { },
    onPlugins: async (): Promise<void> => { },
    sleepForeverCalls: 0,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(() => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
            dropInstance: vi.fn(async () => { }),
        })),
        dropInstance: vi.fn(async () => { }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.isTauri },
    get isNodeServer() { return h.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(async () => { }),
    checkNullish: (v: unknown) => v === null || v === undefined,
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { h.sleepForeverCalls += 1 }),
    getKeypairStore: vi.fn(async () => null),
    saveKeypairStore: vi.fn(async () => { }),
    base64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
    asBuffer: (v: Uint8Array) => Buffer.from(v),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/nativeReply/store'), () => ({
    createReplyStore: () => ({
        list: async () => [],
        readBody: async () => '',
        readBodyBytes: async () => new Uint8Array(),
        readPartialBytes: async () => new Uint8Array(),
        consume: async () => ({}),
        discard: async () => ({}),
        park: async () => { },
    }),
}) as unknown as typeof import('src/ts/nativeReply/store'))
vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: vi.fn(),
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/update'))

vi.mock(import('src/ts/desktopLaunch'), () => ({
    desktopLaunchImport: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/desktopLaunch'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    handlePendingRealmLink: vi.fn(async () => { }),
    hubURL: 'https://realm.risuai.net',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))
vi.mock(import('src/ts/media/avatarThumb'), () => ({ startAvatarThumbSweep: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/media/avatarThumb'))
vi.mock(import('src/ts/model/modellist'), () => ({ registerModelDynamic: vi.fn() }) as unknown as typeof import('src/ts/model/modellist'))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ maximize: vi.fn(async () => { }) })),
}))

// The bars receive the page colour the colour module reports; the recorder is how a case sees a pack colour reach them.
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn((colour: string) => { h.bars.push(colour) }),
}) as unknown as typeof import('src/ts/gui/systemBars'))

vi.mock(import('src/ts/process/moduleLorebookRepair'), () => ({
    repairModuleListLorebooks: vi.fn(async () => {
        if (h.repairRejects) {
            throw new Error('module list repair failed')
        }
    }),
}) as unknown as typeof import('src/ts/process/moduleLorebookRepair'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        staleAccountProfile: false,
        Init: vi.fn(async () => { }),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => { }),
        keys: vi.fn(async (): Promise<string[]> => []),
        removeItem: vi.fn(async () => { }),
    },
    saveDb: vi.fn(async () => { }),
    getDbBackups: async () => [],
    buildAssetKeepSet: vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })),
    getBasename: (p: string) => p.split('/').pop(),
    checkCharOrder: vi.fn(),
    getUncleanablesSync: vi.fn((): string[] => []),
    wasAssetWrittenThisPage: vi.fn(() => false),
    listAssetsWrittenThisPage: vi.fn((): string[] => []),
    AppendableBuffer: class {
        chunks: Uint8Array[] = []
        append(chunk: Uint8Array) { this.chunks.push(chunk) }
        get buffer() { return new Uint8Array() }
    },
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
    getCommittedSaveMarkCount: vi.fn(() => 0),
    getSaveMarkCount: vi.fn(() => 0),
    afterNextSaveCommit: vi.fn(async () => { }),
    characterCommitVerdict: vi.fn(() => 'committed'),
    requestSaveNow: vi.fn(),
    getFileSrc: vi.fn(),
    downloadFile: vi.fn(),
    // The install phase stores the archive where the boot's driver reads it back through the real store.
    saveAsset: vi.fn(async (data: Uint8Array, customId = '', fileName = '') => {
        const key = `assets/${customId}.${fileName.split('.').pop()}`
        h.plant(key, data.slice())
        return key
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

// The judge answers are the real handler's; only the Worker is replaced. Delivery is a microtask so fake timers never hold it.
vi.mock('src/ts/themePack/worker/spawnJudgeWorker', async () => {
    const { handleJudgeRequest } = await import('src/ts/themePack/worker/judgeHandler')
    class FakeWorker {
        private readonly listeners: Array<(event: Event) => void> = []

        postMessage(message: Parameters<typeof handleJudgeRequest>[0]): void {
            const answer = handleJudgeRequest(message)
            void Promise.resolve().then(() => {
                for (const listener of this.listeners) listener(new MessageEvent('message', { data: answer }))
            })
        }

        terminate(): void { }

        addEventListener(type: string, listener: (event: Event) => void): void {
            if (type === 'message') this.listeners.push(listener)
        }
    }
    return { spawnJudgeWorker: () => new FakeWorker() }
})

//#region the utf8Write clamp
// The legacy encoder of an installed-pack profile writes past a Buffer's end in this runtime; the clamp is the test-only
// stand-in the asset-folder backup tests use. It is installed for this file and restored after it.

interface Utf8Writer { utf8Write(this: Uint8Array, text: string, position: number, length: number): number }
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write

beforeAll(() => {
    utf8WriterProto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
})

afterAll(() => {
    utf8WriterProto.utf8Write = nativeUtf8Write
})

//#endregion

//#region fixture

const MAIN_KEY = 'database/database.bin'
const BOUND_MS = 2000
/** What a late or absent answer must never turn into: the time a case may take when nothing waits. */
const NO_WAIT_MS = 1500

interface Fixture {
    profile: Plain
    archiveKey: string
    archive: Uint8Array
    /** The background of the installed pack scheme, which no own scheme shares. */
    packBg: string
}

let fixture: Fixture

function baseDb(extra: Plain = {}): Plain {
    return {
        formatversion: 999,
        characters: [{ chaId: 'a', name: 'A', type: 'character', chats: [] }],
        modules: [],
        personas: [],
        characterOrder: [],
        mainPrompt: 'fixture-main-prompt',
        loreBookToken: 8000,
        hotkeys: [],
        botPresets: [],
        coldstorage: false,
        checkCorruption: false,
        botSettingAtStart: false,
        betaMobileGUI: false,
        didFirstSetup: true,
        heightMode: 'auto',
        ...extra,
    }
}

type Helper = typeof import('src/ts/tests/packSafeOrder.test-helpers.svelte')
type SvelteRuntime = typeof import('svelte')
let helper: Helper
let runtime: SvelteRuntime

/** Loads the reactive helper and the svelte runtime after a module reset, so the graph and the boot code share one runtime. */
async function loadReactiveParts(): Promise<void> {
    helper = await import('src/ts/tests/packSafeOrder.test-helpers.svelte')
    runtime = await import('svelte')
}

function flushSync(): void {
    runtime.flushSync()
}

function mockGraph(g: BootGraphState, installPhase: boolean): void {
    vi.doMock('src/ts/stores.svelte', () => ({
        DBState: g.DBState,
        LoadingStatusState: g.LoadingStatusState,
        MobileGUI: g.MobileGUI,
        botMakerMode: g.botMakerMode,
        selectedCharID: g.selectedCharID,
        loadedStore: g.loadedStore,
        alertStore: g.alertStore,
        SafeModeStore: g.SafeModeStore,
        CustomCSSStore: g.CustomCSSStore,
    }))
    vi.doMock('src/ts/storage/database.svelte', () => ({
        getDatabase: g.getDatabase,
        setDatabase: installPhase ? vi.fn() : g.setDatabase,
        defaultSdDataFunc: vi.fn(() => ({})),
        presetTemplate: { name: 'test-preset' },
    }))
}

let savedCreate: typeof URL.createObjectURL | undefined
let savedRevoke: typeof URL.revokeObjectURL | undefined

function installUrlFake(): void {
    savedCreate = URL.createObjectURL
    savedRevoke = URL.revokeObjectURL
    let minted = 0
    URL.createObjectURL = (): string => `blob:http://localhost/${++minted}`
    URL.revokeObjectURL = (): void => { }
}

function restoreUrlFake(): void {
    for (const [name, saved] of [['createObjectURL', savedCreate], ['revokeObjectURL', savedRevoke]] as const) {
        if (saved === undefined) {
            Reflect.deleteProperty(URL, name)
        } else {
            Object.defineProperty(URL, name, { value: saved, configurable: true, writable: true })
        }
    }
}

function resetDocument(): void {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme-pack-base')
    const app = document.createElement('style')
    app.id = 'appcss'
    document.head.appendChild(app)
    const custom = document.createElement('style')
    custom.id = 'customcss'
    document.body.appendChild(custom)
}

async function until(done: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
        flushSync()
        if (done()) {
            return
        }
        await macrotask()
    }
    throw new Error(`timed out waiting for ${what}`)
}

/** A pack the judge accepts whole, with a canvas no built-in own scheme uses. */
const PACK_SHEET = ':root{--nexus-canvas:#2a1a3a;--nexus-surface:#182430;--nexus-text:#f0f0f0}[data-part="chat-message-avatar"]{opacity:1}'

/**
 * Installs a pack with the real install flow over a distinct own scheme and keeps the resulting profile and archive. The
 * driver of this graph writes the profile itself: nothing in the fixture is hand-written.
 */
async function buildFixture(): Promise<Fixture> {
    const wire = installTauriWire({ os: 'android' })
    wire.fs.directories.add('assets')
    h.plant = (key, bytes) => wire.fs.plant(key, bytes)
    vi.resetModules()
    await loadReactiveParts()
    const g = helper.createBootGraphState(() => ({}))
    mockGraph(g, true)
    installUrlFake()
    resetDocument()
    const colour = await import('src/ts/gui/colorscheme')
    const { runThemePackInstall, resetThemePackInstallFlowForTests } = await import('src/lib/Setting/Pages/Display/themePackInstallFlow.svelte')
    const { judgePackSheets } = await import('src/ts/themePack/index')
    const { installThemePack } = await import('src/ts/themePack/install')
    const { intakePackBytes } = await import('src/ts/themePack/intake')
    const { declareSurface, installThemePackGate, resetThemePackGateForTests } = await import('src/ts/themePack/surfaceGate.svelte')
    const apply = await import('src/ts/themePack/activePack.svelte')
    const { packSafe } = await import('src/ts/themePack/packSafeFlag.svelte')
    const { resetPackSheetForTests } = await import('src/ts/themePack/apply')
    resetThemePackInstallFlowForTests()
    g.DBState.db = {
        themePacks: [], colorScheme: structuredClone(colour.defaultColorScheme), colorSchemeName: 'default',
        customColorScheme: structuredClone(colour.defaultColorScheme), textTheme: 'standard', customTextTheme: {}, font: 'default', customCSS: '',
    }
    installThemePackGate(() => false)
    const shell = declareSurface('chat')
    flushSync()
    apply.startThemePackApply()
    flushSync()
    colour.changeColorScheme('ocean')
    flushSync()
    const bytes = zipPack(validPackFiles({ 'manifest.json': manifestText({ name: 'Order pack', packId: 'order-pack' }), 'chat.css': PACK_SHEET }))
    await runThemePackInstall({
        pickFile: async () => ({ name: 'pack.risutheme', size: bytes.length }) as unknown as File,
        readFile: async () => bytes,
        intake: (verified) => intakePackBytes(verified, async (sheets) => judgePackSheets(sheets)),
        install: installThemePack,
        confirm: async () => true,
        notify: vi.fn(),
    })
    await until(() => apply.themePackApplyState().phase === 'applied', 'the installed pack to apply').catch((error: unknown) => {
        throw new Error(`${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(apply.themePackApplyState())} active=${String(g.DBState.db.activeThemePack)} packs=${JSON.stringify(g.DBState.db.themePacks)} safeflag=${JSON.stringify(plainCopy(packSafe))}`)
    })
    const profile = plainCopy(g.DBState.db)
    const archiveKey = `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
    const stored = wire.fs.files.get(archiveKey)
    expect(stored, 'the install flow stored the archive where the driver reads it').toBeDefined()
    expect(profile.colorSchemeName).toBe('theme-pack')
    const packBg = (profile.colorScheme as { bgcolor: string }).bgcolor
    expect(packBg.toLowerCase(), 'the pack scheme differs from the own scheme').not.toBe(colour.colorSchemePresets.ocean.bgcolor.toLowerCase())
    shell()
    apply.resetThemePackApplyForTests()
    resetPackSheetForTests()
    resetThemePackGateForTests()
    restoreUrlFake()
    resetDocument()
    return { profile, archiveKey, archive: new Uint8Array(stored as Uint8Array), packBg: packBg.toLowerCase() }
}

//#endregion

//#region the host and the run

type Answer = (options: unknown) => void

interface CaseOptions {
    platform?: 'android' | 'desktop' | 'node' | 'web'
    route?: 'store2' | 'readonly' | 'stopped' | 'corrupt'
    host?: 'listener' | 'legacy' | 'none'
    /** The host's reaction to the n-th ask of the page; absent, the host never answers. */
    onAsk?: (n: number, answer: Answer) => void
    /** The ask throws for this method only; every other message is accepted. */
    throwOnAsk?: boolean
    search?: string
    repairRejects?: boolean
    /** Fake only `setTimeout` from the probe on, and let this much fake time pass before the probe returns. */
    fakeFromProbe?: { passBeforeReturn: number }
    /** Runs in the probe, after the colour was read. */
    atProbe?: (run: Run) => Promise<void> | void
}

interface Run {
    g: BootGraphState
    wire: TauriWire
    answer: Answer
    asks: () => number
    loadData: () => Promise<void>
    probeReached: Promise<void>
    probe: { reached: boolean, bg: string, on: boolean, source: string | null, fields: Plain }
    packSafe: { on: boolean, source: string | null }
    packBanner: { mode: string, canTurnOff: boolean }
    packAnnouncement: { off: boolean }
    applyPhase: () => string
    setProperties: Array<[string, string]>
    packNodes: () => Element[]
    archiveReads: () => string[]
    ready: () => void
    done: boolean
}

const PACK_FIELDS = ['activeThemePack', 'themePacks', 'colorSchemeName', 'colorScheme', 'themePackSchemeSnapshot', 'customColorScheme'] as const

function packFields(db: Plain): Plain {
    return Object.fromEntries(PACK_FIELDS.map((key) => [key, plainCopy(db[key])]))
}

function targetsOf(call: WireCall): string[] {
    const args = call.args as Record<string, unknown> | undefined
    if (args === undefined || args === null || typeof args !== 'object') {
        return []
    }
    return ['key', 'path'].map((name) => args[name]).filter((value): value is string => typeof value === 'string')
}

let cleanups: Array<() => void> = []
let memoryFiles: Map<string, Uint8Array> | null = null
let memoryReads: string[] | null = null

function plantFile(wire: TauriWire, key: string, bytes: Uint8Array): void {
    if (memoryFiles !== null) {
        memoryFiles.set(key, bytes.slice())
    } else {
        wire.fs.plant(key, bytes)
    }
}

async function startCase(options: CaseOptions = {}): Promise<Run> {
    const platform = options.platform ?? 'android'
    const route = options.route ?? 'store2'
    localStorage.clear()
    history.replaceState(null, '', options.search ?? '/')
    h.isTauri = platform === 'android' || platform === 'desktop'
    h.isNodeServer = platform === 'node'
    h.bars.length = 0
    h.repairRejects = options.repairRejects ?? false
    h.sleepForeverCalls = 0
    memoryFiles = null
    memoryReads = null
    const wire = installTauriWire({ os: platform === 'desktop' ? 'windows' : 'android' })
    wire.fs.directories.add('assets')
    h.plant = (key, bytes) => plantFile(wire, key, bytes)
    vi.resetModules()
    await loadReactiveParts()
    const g = helper.createBootGraphState(() => baseDb({ characters: [] }))
    mockGraph(g, false)
    resetDocument()
    installUrlFake()
    const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')
    const mainBytes = route === 'corrupt' ? new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) : encodeRisuSaveLegacy({ ...baseDb(), ...fixture.profile })
    if (platform === 'node') {
        const store = createMemoryByteStore()
        memoryFiles = store.files
        memoryReads = store.reads
        store.files.set(MAIN_KEY, mainBytes)
        const unused = async () => { throw new Error('not used') }
        store.guarded = { probe: async () => ({ checkOnly: true, retire: true, pieces: false }), writeChecked: unused, removeChecked: unused, retireChecked: unused }
        const { injectAppStore } = await import('src/ts/storage/store/appStore')
        injectAppStore(store, 'node')
    } else {
        wire.fs.plant(MAIN_KEY, mainBytes)
    }
    plantFile(wire, fixture.archiveKey, fixture.archive)
    if (route === 'store2') {
        await registerRealDispatch({ kind: platform === 'node' ? 'node' : 'tauri', acknowledgeAlerts: true })
    } else {
        const { registerStore2Boot } = await import('src/ts/storage/store2/bootActive')
        registerStore2Boot(async () => (route === 'stopped' ? { kind: 'stopped' } : { kind: 'legacy-readonly', reason: 'backend-unavailable', notices: [] }))
    }

    const colour = await import('src/ts/gui/colorscheme')
    const { packSafe } = await import('src/ts/themePack/packSafeFlag.svelte')
    const mode = await import('src/ts/themePack/packSafeMode.svelte')
    const apply = await import('src/ts/themePack/activePack.svelte')
    const { declareSurface, installThemePackGate }= await import('src/ts/themePack/surfaceGate.svelte')
    installThemePackGate(() => false)
    const shell = declareSurface('chat')
    flushSync()

    const setProperties: Array<[string, string]> = []
    const original = document.documentElement.style.setProperty.bind(document.documentElement.style)
    const spy = vi.spyOn(document.documentElement.style, 'setProperty').mockImplementation((property: string, value: string | null, priority?: string) => {
        setProperties.push([property, String(value)])
        original(property, value, priority)
    })
    const added: Element[] = []
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node instanceof Element) {
                    added.push(...(node.matches('style[data-theme-pack]') ? [node] : []), ...node.querySelectorAll('style[data-theme-pack]'))
                }
            }
        }
    })
    observer.observe(document, { childList: true, subtree: true })

    let asks = 0
    const answer: Answer = (reply) => { window.__risuTaniumLaunchOptions?.(reply) }
    const onAsk = (): void => {
        asks += 1
        if (options.throwOnAsk) {
            throw new Error('the host refused the request')
        }
        options.onAsk?.(asks, answer)
    }
    const form = options.host ?? 'listener'
    if (form === 'listener') {
        window.__risuTaniumHost = {
            postMessage(text: string): void {
                const message = JSON.parse(text) as { bridge?: string, method?: string }
                if (message.bridge === 'keepAlive' && message.method === 'requestLaunchOptions') {
                    onAsk()
                }
            },
            addEventListener(): void { },
            removeEventListener(): void { },
        }
    } else if (form === 'legacy') {
        window.__risuTaniumKeepAlive = { requestLaunchOptions: onAsk }
    }

    let reach: () => void = () => { }
    const probeReached = new Promise<void>((resolve) => { reach = resolve })
    const run = {} as Run
    const probe: Run['probe'] = { reached: false, bg: '', on: false, source: null, fields: {} }
    h.onPlugins = async () => {
        colour.updateTextThemeAndCSS()
        colour.updateColorScheme()
        probe.bg = colour.effectiveColorScheme(g.getDatabase() as unknown as Parameters<typeof colour.effectiveColorScheme>[0]).bgcolor.toLowerCase()
        probe.on = packSafe.on
        probe.source = packSafe.source
        probe.fields = packFields(g.getDatabase())
        probe.reached = true
        if (options.fakeFromProbe) {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            vi.spyOn(globalThis, 'setTimeout')
            if (options.fakeFromProbe.passBeforeReturn > 0) {
                await vi.advanceTimersByTimeAsync(options.fakeFromProbe.passBeforeReturn)
            }
        }
        reach()
        await options.atProbe?.(run)
    }
    vi.doMock('src/ts/plugins/plugins.svelte', () => ({ loadPlugins: vi.fn(async () => { await h.onPlugins() }) }))
    const { loadData } = await import('src/ts/bootstrap')

    cleanups.push(() => {
        observer.disconnect()
        spy.mockRestore()
        shell()
        apply.resetThemePackApplyForTests()
        restoreUrlFake()
        stopAcknowledgingAlerts()
    })
    Object.assign(run, {
        g,
        wire,
        answer,
        asks: () => asks,
        loadData,
        probeReached,
        probe,
        packSafe,
        packBanner: mode.packBanner,
        packAnnouncement: mode.packAnnouncement,
        applyPhase: () => apply.themePackApplyState().phase,
        setProperties,
        packNodes: () => {
            added.push(...[...observer.takeRecords()].flatMap((record) => [...record.addedNodes].filter((node): node is Element => node instanceof Element).flatMap((node) => [...(node.matches('style[data-theme-pack]') ? [node] : []), ...node.querySelectorAll('style[data-theme-pack]')])))
            return added
        },
        archiveReads: () => [
            ...wire.calls.filter((call) => call.cmd.startsWith('read_range') && targetsOf(call).some((target) => target.includes('assets/tp-'))).map((call) => call.cmd),
            ...(memoryReads ?? []).filter((key) => key.includes('assets/tp-')),
        ],
        ready: () => { window.__risuTaniumPackSafeModeReady?.() },
        done: false,
    })
    return run
}

/** Lets effects and queued microtasks and macrotasks run, so a sheet that was going to appear has appeared. */
async function drain(rounds = 40): Promise<void> {
    for (let index = 0; index < rounds; index++) {
        flushSync()
        await macrotask()
    }
}

const loaded = (run: Run): boolean => get(run.g.loadedStore)

/** No pack read, no pack node ever, and no pack colour on the root, the bars or the probe's answer. */
function expectClean(run: Run): void {
    expect(run.archiveReads(), 'the archive was never read').toEqual([])
    expect(run.packNodes().length, 'no pack sheet was ever added').toBe(0)
    expect(run.setProperties.filter(([, value]) => value.toLowerCase() === fixture.packBg), 'the root never took the pack colour').toEqual([])
    expect(h.bars.filter((colour) => colour.toLowerCase() === fixture.packBg), 'the bars never took the pack colour').toEqual([])
    if (run.probe.reached) {
        expect(run.probe.bg, 'the probe never read the pack colour').not.toBe(fixture.packBg)
    }
}

async function expectApplied(run: Run): Promise<void> {
    await until(() => run.applyPhase() === 'applied', 'the pack to apply')
    expect(run.packNodes().length).toBeGreaterThan(0)
    expect(run.archiveReads().length, 'the harness sees archive reads').toBeGreaterThan(0)
    expect(document.documentElement.style.getPropertyValue('--risu-theme-bgcolor').toLowerCase()).toBe(fixture.packBg)
}

/**
 * The no-answer sequence under fake time that starts at the probe: with no answer the page waits at the theme step. Returns
 * the page's state one fake millisecond before the bound and after it.
 */
async function runBound(run: Run): Promise<{ beforeBound: { loaded: boolean, source: string | null }, started: boolean }> {
    const boot = run.loadData()
    await run.probeReached
    const timers = vi.mocked(globalThis.setTimeout)
    for (let attempt = 0; attempt < 400; attempt++) {
        if (timers.mock.calls.some((call) => call[1] === BOUND_MS) || loaded(run)) {
            break
        }
        await macrotask()
    }
    const started = timers.mock.calls.some((call) => call[1] === BOUND_MS)
    await vi.advanceTimersByTimeAsync(BOUND_MS - 1)
    const beforeBound = { loaded: loaded(run), source: run.packSafe.source }
    await vi.advanceTimersByTimeAsync(1)
    vi.mocked(globalThis.setTimeout).mockRestore()
    vi.useRealTimers()
    await boot
    return { beforeBound, started }
}

async function bootAndDrain(run: Run): Promise<number> {
    const startedAt = performance.now()
    await run.loadData()
    const took = performance.now() - startedAt
    await drain()
    return took
}

//#endregion

beforeAll(async () => {
    vi.stubGlobal('safeStructuredClone', <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T)
    fixture = await buildFixture()
}, 180_000)

afterEach(async () => {
    vi.useRealTimers()
    for (const clean of cleanups.splice(0)) {
        clean()
    }
    Reflect.deleteProperty(window, '__risuTaniumHost')
    Reflect.deleteProperty(window, '__risuTaniumKeepAlive')
    Reflect.deleteProperty(window, '__risuTaniumLaunchOptions')
    Reflect.deleteProperty(window, '__risuTaniumPackSafeModeReady')
    const { resetToastHostForTests } = await import('src/ts/toast/toastHost.svelte')
    resetToastHostForTests()
    resetDocument()
    vi.unstubAllGlobals()
})

beforeEach(() => {
    vi.stubGlobal('safeStructuredClone', <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
})

const FORMS = ['listener', 'legacy'] as const

describe.each(FORMS)('the order on Android, host reached through the %s form', (form) => {
    it('OR-6 guard (positive control): an early false, also inside the ask, applies the pack with its offer', async () => {
        for (const synchronous of [true, false]) {
            const run = await startCase({
                host: form,
                onAsk: (_n, answer) => {
                    if (synchronous) {
                        answer({ packSafeMode: false, touchExploration: false })
                    } else {
                        queueMicrotask(() => answer({ packSafeMode: false, touchExploration: false }))
                    }
                },
            })
            const took = await bootAndDrain(run)
            await expectApplied(run)
            expect(packNodeCount(run), 'one sheet').toBe(1)
            expect(run.packSafe.on).toBe(false)
            expect(run.packBanner.mode).toBe('offer')
            expect(took).toBeLessThan(NO_WAIT_MS)
            expect(loaded(run)).toBe(true)
            cleanups.splice(0).forEach((clean) => clean())
        }
    })

    it('OR-1 guard: a true right after the ask, and inside it, keeps the pack off with the notice', async () => {
        for (const synchronous of [true, false]) {
            const run = await startCase({
                host: form,
                onAsk: (_n, answer) => {
                    if (synchronous) {
                        answer({ packSafeMode: true, touchExploration: false })
                    } else {
                        queueMicrotask(() => answer({ packSafeMode: true, touchExploration: false }))
                    }
                },
            })
            const took = await bootAndDrain(run)
            expectClean(run)
            expect(run.packSafe.on).toBe(true)
            expect(run.packSafe.source).toBe('shortcut')
            expect(run.packBanner.mode).toBe('notice')
            expect(took).toBeLessThan(NO_WAIT_MS)
            cleanups.splice(0).forEach((clean) => clean())
        }
    })

    it('OR-2 reproducer: a true after the probe, inside the bound, is clean, with the notice, and does not wait the bound out', async () => {
        const run = await startCase({ host: form, onAsk: () => { } })
        const boot = run.loadData()
        await run.probeReached
        expect(run.probe.fields).toEqual(packFields(fixture.profile))
        const answeredAt = performance.now()
        run.answer({ packSafeMode: true, touchExploration: false })
        await boot
        const waited = performance.now() - answeredAt
        await drain()
        expectClean(run)
        expect(run.packSafe.source).toBe('shortcut')
        expect(run.packBanner.mode).toBe('notice')
        expect(waited).toBeLessThan(NO_WAIT_MS)
        expect(packFields(run.g.getDatabase())).toEqual(packFields(fixture.profile))
    })

    it('OR-3 reproducer: no answer ends the wait with the no-answer state, a clean page and the notice with Turn off', async () => {
        const run = await startCase({ host: form, onAsk: () => { }, fakeFromProbe: { passBeforeReturn: 0 } })
        await runBound(run)
        await drain()
        expectClean(run)
        expect(loaded(run)).toBe(true)
        expect(run.packSafe.source).toBe('noAnswer')
        expect(run.packBanner.mode).toBe('notice')
        expect(run.packBanner.canTurnOff).toBe(true)
        expect(packFields(run.g.getDatabase())).toEqual(packFields(fixture.profile))
    })

    it('OR-4 reproducer: a host whose ask throws is the same as no host, with no wait', async () => {
        const run = await startCase({ host: form, throwOnAsk: true })
        const took = await bootAndDrain(run)
        expectClean(run)
        expect(run.asks()).toBeGreaterThan(0)
        expect(loaded(run)).toBe(true)
        expect(run.packSafe.source).toBe('noAnswer')
        expect(took).toBeLessThan(NO_WAIT_MS)
    })

    it('OR-7 reproducer: a false after the probe keeps the page clean until then, then applies the pack with its offer and no added delay', async () => {
        const run = await startCase({ host: form, onAsk: () => { }, fakeFromProbe: { passBeforeReturn: 0 } })
        const boot = run.loadData()
        await run.probeReached
        expect(run.probe.fields).toEqual(packFields(fixture.profile))
        expectClean(run)
        // The answer comes once the boot waits at its theme step, so a banner offered before the wait ended would see the hold.
        const timers = vi.mocked(globalThis.setTimeout)
        for (let attempt = 0; attempt < 400 && !timers.mock.calls.some((call) => call[1] === BOUND_MS); attempt++) {
            await macrotask()
        }
        expect(timers.mock.calls.some((call) => call[1] === BOUND_MS), 'the boot waits at the theme step').toBe(true)
        const answeredAt = performance.now()
        run.answer({ packSafeMode: false, touchExploration: false })
        timers.mockRestore()
        vi.useRealTimers()
        await boot
        const waited = performance.now() - answeredAt
        await expectApplied(run)
        expect(run.packSafe.on).toBe(false)
        expect(run.packBanner.mode, 'the offer is made once the pack is about to apply').toBe('offer')
        expect(waited).toBeLessThan(NO_WAIT_MS)
        expect(packFields(run.g.getDatabase())).toEqual(packFields(fixture.profile))
    })

    it('OR-8 reproducer: nothing until the bound, then a false, stays clean and pack-free', async () => {
        const run = await startCase({ host: form, onAsk: () => { }, fakeFromProbe: { passBeforeReturn: 0 } })
        await runBound(run)
        run.answer({ packSafeMode: false, touchExploration: false })
        await drain()
        expectClean(run)
        expect(run.packSafe.on).toBe(true)
        expect(run.packSafe.source).toBe('noAnswer')
    })

    it('OR-9a guard: a true, then a second ask answered false, stays in safe mode', async () => {
        const run = await startCase({
            host: form,
            onAsk: (n, answer) => answer({ packSafeMode: n === 1, touchExploration: false }),
        })
        await bootAndDrain(run)
        run.ready()
        await drain()
        expect(run.asks()).toBe(2)
        expectClean(run)
        expect(run.packSafe.on).toBe(true)
        expect(run.packSafe.source).toBe('shortcut')
    })

    it('OR-9b reproducer: a malformed first answer does not release the hold, and a true after the probe is clean', async () => {
        const run = await startCase({
            host: form,
            onAsk: (_n, answer) => answer({ packSafeMode: 'false', touchExploration: false }),
        })
        const boot = run.loadData()
        await run.probeReached
        expectClean(run)
        expect(run.probe.on, 'the page is still held at the probe').toBe(true)
        run.answer({ packSafeMode: true, touchExploration: false })
        await boot
        await drain()
        expectClean(run)
        expect(run.packSafe.source).toBe('shortcut')
    })

    it('OR-9c reproducer: a true after the pack was applied removes the sheet and paints the own scheme', async () => {
        const run = await startCase({
            host: form,
            onAsk: (n, answer) => {
                if (n === 1) {
                    answer({ packSafeMode: false, touchExploration: false })
                }
            },
        })
        await bootAndDrain(run)
        await expectApplied(run)
        run.answer({ packSafeMode: true, touchExploration: false })
        await drain()
        expect(document.querySelectorAll('style[data-theme-pack]').length).toBe(0)
        expect(run.packSafe.on).toBe(true)
        expect(run.packSafe.source).toBe('shortcut')
        expect(document.documentElement.style.getPropertyValue('--risu-theme-bgcolor').toLowerCase()).not.toBe(fixture.packBg)
    })

    it('OR-10a reproducer: with no answer, a boot step that fails after the probe stays clean and shows the boot error', async () => {
        const run = await startCase({ host: form, onAsk: () => { }, repairRejects: true })
        await run.loadData()
        await drain()
        expect(run.probe.reached).toBe(true)
        expectClean(run)
        expect(loaded(run)).toBe(false)
        expect(get(run.g.alertStore).type).toBe('error')
    })

    it('OR-10b reproducer: a read-only legacy page with a late true is clean', async () => {
        const run = await startCase({ host: form, route: 'readonly', onAsk: () => { } })
        const boot = run.loadData()
        await run.probeReached
        expectClean(run)
        run.answer({ packSafeMode: true, touchExploration: false })
        await boot
        await drain()
        expectClean(run)
        expect(run.packSafe.source).toBe('shortcut')
        expect(run.packBanner.canTurnOff, 'a read-only page has no turn-off').toBe(false)
    })

    it('OR-10c reproducer: a stopped boot and a corrupted save neither wait nor read nor add a sheet', async () => {
        for (const route of ['stopped', 'corrupt'] as const) {
            const run = await startCase({ host: form, route, onAsk: () => { } })
            const took = await bootAndDrain(run)
            expect(run.probe.reached).toBe(false)
            expectClean(run)
            expect(loaded(run)).toBe(false)
            expect(took).toBeLessThan(NO_WAIT_MS)
            if (route === 'corrupt') {
                expect(get(run.g.alertStore).type).toBe('error')
            }
            cleanups.splice(0).forEach((clean) => clean())
        }
    })

    it.each([0, 2500])('OR-11 reproducer: the bound starts at the theme step: not loaded 1999 ms after the wait began, loaded pack-free at 2000 (%i ms pass before the probe returns)', async (passBeforeReturn) => {
        const run = await startCase({ host: form, onAsk: () => { }, fakeFromProbe: { passBeforeReturn } })
        const result = await runBound(run)
        await drain()
        expect(result.started, 'the wait began at the theme step').toBe(true)
        expect(result.beforeBound.loaded, 'not loaded 1999 ms after the wait began').toBe(false)
        expect(result.beforeBound.source).toBe('undecided')
        expect(loaded(run)).toBe(true)
        expectClean(run)
        expect(run.packSafe.source).toBe('noAnswer')
    })

    it('OR-5 reproducer: Android with no host has no wait and no pack', async () => {
        const run = await startCase({ host: 'none' })
        const took = await bootAndDrain(run)
        expectClean(run)
        expect(loaded(run)).toBe(true)
        expect(run.packSafe.source).toBe('noAnswer')
        expect(took).toBeLessThan(NO_WAIT_MS)
    })

    it('OR-13 guard: the URL flag never waits, and a later false leaves its source', async () => {
        const run = await startCase({ host: form, search: '/?nothemepack', onAsk: () => { } })
        const took = await bootAndDrain(run)
        expectClean(run)
        expect(run.packSafe.source).toBe('url')
        expect(took).toBeLessThan(NO_WAIT_MS)
        run.answer({ packSafeMode: false, touchExploration: false })
        await drain()
        expectClean(run)
        expect(run.packSafe.on).toBe(true)
        expect(run.packSafe.source).toBe('url')
    })
})

describe('the other platforms ask nothing and hold nothing', () => {
    it.each(['desktop', 'node'] as const)('OR-12 guard: %s sends no ask, takes no hold and applies the pack', async (platform) => {
        const run = await startCase({ platform, host: 'listener', onAsk: () => { } })
        const took = await bootAndDrain(run)
        expect(run.asks()).toBe(0)
        expect(run.probe.on, 'no hold at the probe').toBe(false)
        expect(run.probe.source).toBeNull()
        expect(took).toBeLessThan(NO_WAIT_MS)
        await expectApplied(run)
        expect(run.packSafe.source).toBeNull()
    })

    it('OR-12 guard: a page with no byte store refuses before any ask or hold', async () => {
        const run = await startCase({ platform: 'web', host: 'listener', onAsk: () => { } })
        const took = await bootAndDrain(run)
        expect(run.asks()).toBe(0)
        expect(run.probe.reached).toBe(false)
        expect(run.packSafe.on).toBe(false)
        expect(loaded(run)).toBe(false)
        expect(took).toBeLessThan(NO_WAIT_MS)
        expectClean(run)
    })
})

describe('a saved profile that left safe mode boots pack-free', () => {
    type Leave = (run: Run) => Promise<void>

    /**
     * Boots with the pack applied, goes into safe mode, leaves it through the named route, then boots the saved pack fields
     * again with the host answering false: the page then reads no archive and shows no pack node, root attribute or colour.
     */
    async function rebootAfter(leave: Leave, options: { settleFirst: boolean }): Promise<void> {
        const first = await startCase({
            host: 'listener',
            onAsk: (n, answer) => {
                if (n === 1) {
                    answer({ packSafeMode: false, touchExploration: false })
                }
            },
        })
        if (options.settleFirst) {
            await bootAndDrain(first)
            await expectApplied(first)
        } else {
            await first.loadData()
        }
        first.answer({ packSafeMode: true, touchExploration: false })
        await leave(first)
        await drain()
        const saved = Object.fromEntries(Object.entries(packFields(first.g.getDatabase())).filter(([, value]) => value !== undefined))
        const original = fixture.profile
        fixture.profile = { ...original, ...saved }
        try {
            const second = await startCase({ host: 'listener', onAsk: (_n, answer) => answer({ packSafeMode: false, touchExploration: false }) })
            await bootAndDrain(second)
            await drain()
            expectClean(second)
            expect(document.documentElement.hasAttribute('data-theme-pack-base'), 'no pack attribute on the root').toBe(false)
            expect(document.querySelectorAll('style[data-theme-pack]').length, 'no pack sheet in the document').toBe(0)
            expect(second.packSafe.on).toBe(false)
        } finally {
            fixture.profile = original
        }
    }

    const flow = () => import('src/lib/Setting/Pages/Display/themePackInstallFlow.svelte')

    it('RS-4 guard: after None', async () => {
        await rebootAfter(async () => {
            const { selectThemePack } = await flow()
            expect(selectThemePack(undefined, { notify: vi.fn() })).toBe('selected')
        }, { settleFirst: true })
    })

    it('RS-4 guard: after Remove', async () => {
        await rebootAfter(async (run) => {
            const { removeThemePack } = await flow()
            const entry = (run.g.getDatabase().themePacks as unknown[])[0]
            expect(await removeThemePack(entry, 'Order pack', { confirm: async () => true, notify: vi.fn() })).toBe('removed')
        }, { settleFirst: true })
    })

    it('RS-4 guard: after the banner turn-off', async () => {
        await rebootAfter(async () => {
            const { tapTurnOff } = await import('src/ts/themePack/packSafeMode.svelte')
            tapTurnOff()
        }, { settleFirst: true })
    })

    it('RS-4 guard: after None while the first apply is still in flight', async () => {
        await rebootAfter(async () => {
            const { selectThemePack } = await flow()
            expect(selectThemePack(undefined, { notify: vi.fn() })).toBe('selected')
        }, { settleFirst: false })
    })
})

function packNodeCount(run: Run): number {
    return document.querySelectorAll('style[data-theme-pack]').length || run.packNodes().length
}
