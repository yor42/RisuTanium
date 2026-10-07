/**
 * What `saveDb()` does with the changes a person (or a boot-time import) makes in
 * the boot window: from the moment the UI is interactive until the change
 * effects are registered, while `encoder.init` is still encoding.
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder`,
 * `registerDbChangeEffects`, the page's block-store owner and `appStore` against
 * an in-memory byte store (see `saveLoopWorld.ts`). `encoder.init` is paused
 * between blocks through the yield budget, so a test can act inside the window.
 * In this harness `registerDbChangeEffects` runs once, at registration, and does
 * not react to later writes: a test that writes after registration is evidence
 * about the save loop's own requests, not about the effects. The real
 * `characterCards.ts` import branches run against recorders for alerts and file
 * reads. A mocked success here is not evidence of native backend behaviour, and
 * the events are stamped trusted with `Object.defineProperty` because the test
 * DOM never reports `isTrusted`.
 *
 * Title labels: (R) marks a reproducer: it fails against a loop that neither
 * records the characters selected in the window nor counts input, imports and
 * plugin panels as unsaved work, nor asks for a save when an import writes after
 * the window closed. (G) marks a guard of behaviour that holds with or without
 * the change, except S9 and S13, which guard the failure handling of the new
 * code: they describe what must stay true when the recording itself fails, and
 * they fail without the change only because there is no recorder to fail.
 */
import crc32 from 'crc/crc32'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, until, type World } from 'src/ts/storage/tests/saveLoopWorld'

vi.setConfig({ testTimeout: 40_000 })

const h = vi.hoisted(() => ({
    worldCount: 0,
    parked: new Set<number>(),
    holdSelect: null as null | Promise<void>,
    db: undefined as undefined | Record<string, unknown>,
    channels: [] as Array<{ onmessage: ((event: { data: unknown }) => void) | null }>,
    gate: {
        calls: 0,
        held: false,
        pauseAt: -1,
        reached: null as null | (() => void),
        release: null as null | (() => void),
    },
}))

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
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
    importPreset: vi.fn(async (file: { name: string }) => {
        ;(h.db!.botPresets as unknown[]).push({ name: file.name })
    }),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
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
        SettingsMenuIndex: writable(0),
        settingsOpen: writable(false),
        ShowRealmFrameStore: writable(''),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => {
        if (h.holdSelect) {
            await h.holdSelect
        }
        return '1'
    }),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

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
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
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

vi.mock(import('src/ts/parser/parser.svelte'), async (importOriginal) => ({
    ...(await importOriginal()),
    hasher: vi.fn(async () => 'hash'),
}))

vi.mock(import('src/ts/storage/saveYield'), () => ({
    createYieldBudget: () => ({
        noteYielded() {},
        async maybeYield() {
            h.gate.calls += 1
            if (h.gate.calls === h.gate.pauseAt) {
                h.gate.held = true
                await new Promise<void>((resolve) => {
                    h.gate.release = resolve
                    h.gate.reached?.()
                })
                h.gate.held = false
            }
        },
    }),
    yieldToEventLoop: async () => {},
}) as unknown as typeof import('src/ts/storage/saveYield'))

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
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(async () => ({ name: 'launched module', lorebook: [], trigger: [], regex: [] })),
}) as unknown as typeof import('src/ts/process/modules'))

// The desktop launch reads a handed-over file through the plugin; the bytes stand in for what it reads.
vi.mock(import('src/ts/importSource'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        openDesktopImportSource: vi.fn(async (path: string) => actual.importSourceOfBytes(
            path.split('/').pop() ?? path,
            launchedFileBytes(path),
        )),
    }
})

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#region fixtures

const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})
const { startWorld, parkAll } = kit

const ALPHA = 'alpha-cha'
const BETA = 'beta-cha'
const GAMMA = 'gamma-cha'
const reload = vi.fn()

// `encoder.init` yields once after each block it encodes: the root, the preset
// list, the modules, the loadouts, the plugins and the plugin storage come
// first, then one yield per character in array order.
const AFTER_ROOT = 1
const AFTER_FIRST_CHARACTER = 7

interface TestCharacter {
    chaId: string
    name: string
    chats: Array<{ message: Array<{ role: string, data: string }> }>
}

const liveCharacters = () => h.db!.characters as TestCharacter[]
const liveModules = () => h.db!.modules as unknown[]

/** An event the person caused: the test DOM never reports `isTrusted`, so it is stamped. */
function userInput(type = 'pointerdown', trusted = true) {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, 'isTrusted', { value: trusted })
    document.body.dispatchEvent(event)
}

function broadcastFromPeer() {
    h.channels.at(-1)!.onmessage?.({ data: 'a peer tab' })
}

/**
 * Boots a world and holds `encoder.init` after `pauseAfter` yields, with the
 * database installed as the reactive state the change effects read.
 * `selectedAtStart` is the selection the page has when `saveDb()` starts;
 * `beforeSaveDb` runs what happens at boot before `saveDb()` is called.
 */
async function bootInWindow(pauseAfter: number, options: { selectedAtStart?: number, beforeSaveDb?: () => Promise<void> } = {}) {
    const w = await startWorld({ startLoop: false })
    const stores = await import('src/ts/stores.svelte')
    const holder = $state({ db: h.db })
    h.db = holder.db
    ;(stores.DBState as { db: unknown }).db = h.db
    // The mocked stores module is not reset with the module graph, so the selection a
    // previous test left is cleared here: a boot with no selection is the -1 path.
    stores.selectedCharID.set(-1)
    if (options.selectedAtStart !== undefined) {
        stores.selectedCharID.set(options.selectedAtStart)
    }
    await options.beforeSaveDb?.()
    h.gate.calls = 0
    h.gate.pauseAt = pauseAfter
    const reached = new Promise<void>((resolve) => { h.gate.reached = resolve })
    w.start()
    await reached
    return { w, stores }
}

/** Lets `encoder.init` finish; the change effects register right after it. */
function finishInit(): void {
    h.gate.pauseAt = -1
    h.gate.release?.()
}

function nextCommit(w: World): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no save commit within 8 s')), 8000)
        w.api.afterNextSaveCommit(() => {
            clearTimeout(timer)
            resolve()
        })
    })
}

/** What the loop did with the peer's broadcast: reloaded without asking, or asked. */
async function peerSaveOutcome(): Promise<'reloaded' | 'prompted'> {
    const { alertSelect } = await import('src/ts/alert')
    let outcome: 'reloaded' | 'prompted' | null = null
    await until(() => {
        if (reload.mock.calls.length > 0) {
            outcome = 'reloaded'
        } else if (vi.mocked(alertSelect).mock.calls.length > 0) {
            outcome = 'prompted'
        }
        return outcome !== null
    }, 'the page to reload or to ask about the peer\'s save')
    return outcome as unknown as 'reloaded' | 'prompted'
}

async function storedCharacter(w: World, chaId: string): Promise<TestCharacter | undefined> {
    const { validateLoadedBlocks } = await import('src/ts/storage/blockProfileValidate')
    const read = await w.owner.readCommitted({ validate: validateLoadedBlocks })
    if (read.kind !== 'loaded') {
        throw new Error(`the committed state did not read: ${read.kind}`)
    }
    return (read.tree as unknown as { characters: TestCharacter[] }).characters.find((character) => character.chaId === chaId)
}

/** The edits a person makes to a character in place: a rename and a message. */
function editInPlace(index: number, name: string) {
    const character = liveCharacters()[index]
    character.name = name
    character.chats[0].message.push({ role: 'user', data: 'typed in the window' })
}

/** A PNG whose `chara` chunk holds a tavern (v1) card: the card the tavern branch of the PNG import adds. */
function tavernPng(): Uint8Array {
    const chunk = (type: string, body: Uint8Array) => {
        const typed = new Uint8Array([...new TextEncoder().encode(type), ...body])
        const length = new Uint8Array(4)
        new DataView(length.buffer).setUint32(0, body.length)
        const crc = new Uint8Array(4)
        new DataView(crc.buffer).setUint32(0, crc32(Buffer.from(typed)))
        return [...length, ...typed, ...crc]
    }
    const card = Buffer.from(JSON.stringify({ char_name: 'Tavern', char_persona: 'p', char_greeting: 'hi' })).toString('base64')
    return new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10,
        ...chunk('IHDR', new Uint8Array(13).fill(1)),
        ...chunk('tEXt', new TextEncoder().encode(`chara\0${card}`)),
        ...chunk('IDAT', new Uint8Array(40).fill(7)),
        ...chunk('IEND', new Uint8Array(0)),
    ])
}

/** What the mocked desktop launch reads for a path. */
function launchedFileBytes(path: string): Uint8Array {
    if (path.endsWith('.png')) {
        return tavernPng()
    }
    const text = path.endsWith('v2.json')
        ? JSON.stringify({
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: { name: 'Launched v2', description: '', personality: '', scenario: '', first_mes: 'hi', mes_example: '', extensions: { risuai: {} } },
        })
        : path.endsWith('.json')
            ? '{"char_name":"Launched","char_persona":"p","char_greeting":"hi"}'
            : 'module bytes'
    return new TextEncoder().encode(text)
}

function importModuleLink(module: Record<string, unknown> = { name: 'linked module' }) {
    const payload = encodeURIComponent(Buffer.from(JSON.stringify(module)).toString('base64'))
    location.hash = `#import_module=${payload}`
}

//#endregion

beforeAll(() => {
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(_data: unknown) {}
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(window.location, 'reload', { value: reload, configurable: true, writable: true })
})

beforeEach(() => {
    vi.clearAllMocks()
    h.holdSelect = null
    h.channels.length = 0
    h.gate.held = false
    h.gate.pauseAt = -1
    h.gate.release = null
    h.gate.reached = null
    reload.mockClear()
    window.sessionStorage.clear()
    location.hash = ''
    h.db = { ...makeDb('base', [ALPHA, BETA, GAMMA]), statics: { imports: 0 } }
})

afterEach(() => {
    // A world still held inside `encoder.init` is let go so its loop can be parked.
    h.gate.pauseAt = -1
    h.gate.release?.()
    parkAll()
    vi.restoreAllMocks()
    location.hash = ''
})

afterAll(() => {
    vi.stubGlobal('crypto', kit.realCrypto)
})

describe('a character edited in place in the boot window is saved by the first pass', () => {
    test('S1 (R): a character selected and edited after its block was encoded, then left for another, is saved', async () => {
        const { w, stores } = await bootInWindow(AFTER_FIRST_CHARACTER)
        const committed = nextCommit(w)
        stores.selectedCharID.set(0)
        editInPlace(0, 'alpha edited')
        stores.selectedCharID.set(1)
        finishInit()
        await committed
        await settled(w)
        const stored = await storedCharacter(w, ALPHA)
        expect(stored?.name).toBe('alpha edited')
        expect(stored?.chats[0].message).toHaveLength(1)
    })

    test('S1b (R): the character the idle hand-off selected before saveDb started is saved when it is edited after its block and then left', async () => {
        const { w, stores } = await bootInWindow(AFTER_FIRST_CHARACTER, { selectedAtStart: 0 })
        const committed = nextCommit(w)
        editInPlace(0, 'alpha edited')
        stores.selectedCharID.set(1)
        finishInit()
        await committed
        await settled(w)
        expect((await storedCharacter(w, ALPHA))?.name).toBe('alpha edited')
    })
})

describe('input in the boot window keeps a peer\'s save from reloading the tab', () => {
    test('S3 (R): a root setting changed after input, then a peer save before the first pass, asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        await bootInWindow(AFTER_FIRST_CHARACTER)
        userInput('pointerdown')
        h.db!.mainPrompt = 'changed in the window'
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    test('S4 (R): a character edited before its own block was encoded, after input, then a peer save, asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        const { stores } = await bootInWindow(AFTER_ROOT)
        stores.selectedCharID.set(2)
        userInput('keydown')
        liveCharacters()[2].name = 'gamma edited'
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    test('S5 (R): the S1 edits, then a peer save before the first pass, ask instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        const { stores } = await bootInWindow(AFTER_FIRST_CHARACTER)
        stores.selectedCharID.set(0)
        userInput('input')
        editInPlace(0, 'alpha edited')
        stores.selectedCharID.set(1)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })
})

describe('an import that lands in the boot window keeps a peer\'s save from reloading the tab', () => {
    test('S14 (R): a #import_module= link that lands before the effects register, with no input, then a peer save, asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        await bootInWindow(AFTER_FIRST_CHARACTER)
        const cards = await import('src/ts/characterCards')
        importModuleLink()
        await cards.characterURLImport()
        expect(liveModules(), 'the import wrote before the effects registered').toHaveLength(1)
        expect(h.gate.held, 'encoder.init still running at the time of the import, so nothing is registered yet').toBe(true)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    test('S14 (R): a #import_preset= link that lands before the effects register asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        await bootInWindow(AFTER_FIRST_CHARACTER)
        const cards = await import('src/ts/characterCards')
        location.hash = `#import_preset=${encodeURIComponent(Buffer.from('{}').toString('base64'))}`
        await cards.characterURLImport()
        expect((h.db!.botPresets as unknown[]).length, 'the import wrote before the effects registered').toBe(2)
        expect(h.gate.held, 'encoder.init still running at the time of the import').toBe(true)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    test('S14 (R): a module file the desktop launch handed over, imported before the effects register, asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        await bootInWindow(AFTER_FIRST_CHARACTER)
        const cards = await import('src/ts/characterCards')
        await cards.importOpenedFiles(['C:/launch/handed.risum'])
        expect(liveModules(), 'the import wrote before the effects registered').toHaveLength(1)
        expect(h.gate.held, 'encoder.init still running at the time of the import').toBe(true)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    test('S14 (G): a character card file imported while init runs is caught by the identity tracker, so a peer save asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        await bootInWindow(AFTER_FIRST_CHARACTER)
        const cards = await import('src/ts/characterCards')
        await cards.importOpenedFiles(['C:/launch/handed.json'])
        expect(liveCharacters(), 'the import wrote before the effects registered').toHaveLength(4)
        expect(h.gate.held, 'encoder.init still running at the time of the import').toBe(true)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })
})

describe('an import that finished before saveDb started keeps a peer\'s save from reloading the tab', () => {
    test('S14 (R): a #import_module= link imported before saveDb started, with no input, then a peer save, asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        let imported = 0
        await bootInWindow(AFTER_FIRST_CHARACTER, {
            beforeSaveDb: async () => {
                const cards = await import('src/ts/characterCards')
                importModuleLink()
                await cards.characterURLImport()
                imported = liveModules().length
            },
        })
        expect(imported, 'the import wrote before saveDb started').toBe(1)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    test('S14 (R): a character card file imported before saveDb started, so that init encoded it, then a peer save, asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        let imported = 0
        await bootInWindow(AFTER_FIRST_CHARACTER, {
            beforeSaveDb: async () => {
                const cards = await import('src/ts/characterCards')
                await cards.importOpenedFiles(['C:/launch/handed.json'])
                imported = liveCharacters().length
            },
        })
        expect(imported, 'the import wrote before saveDb started').toBe(4)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })
    test('S14 (R): a v2 character card file imported before saveDb started, then a peer save, asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        let imported = 0
        await bootInWindow(AFTER_FIRST_CHARACTER, {
            beforeSaveDb: async () => {
                const cards = await import('src/ts/characterCards')
                await cards.importOpenedFiles(['C:/launch/handed-v2.json'])
                imported = liveCharacters().length
            },
        })
        expect(imported, 'the import wrote before saveDb started').toBe(4)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })
})

describe('every import write site keeps a peer\'s save from reloading the tab', () => {
    test('S14 (R): a tavern PNG card imported before saveDb started, then a peer save, asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        let imported = 0
        await bootInWindow(AFTER_FIRST_CHARACTER, {
            beforeSaveDb: async () => {
                const cards = await import('src/ts/characterCards')
                await cards.importOpenedFiles(['C:/launch/handed-tavern.png'])
                imported = liveCharacters().length
            },
        })
        expect(imported, 'the import wrote before saveDb started').toBe(4)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    test('S14 (R): a preset file imported before saveDb started, then a peer save, asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        let presets = 0
        await bootInWindow(AFTER_FIRST_CHARACTER, {
            beforeSaveDb: async () => {
                const cards = await import('src/ts/characterCards')
                await cards.importOpenedFiles(['C:/launch/handed.risup'])
                presets = (h.db!.botPresets as unknown[]).length
            },
        })
        expect(presets, 'the import wrote before saveDb started').toBe(2)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })
})

describe('a plugin panel used in the boot window keeps a peer\'s save from reloading the tab', () => {
    const panel = () => ({ isConnected: true, style: { display: 'block' } })

    test('S15 (R): a panel shown in the window, with no input on the page, then a peer save, asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        await bootInWindow(AFTER_FIRST_CHARACTER)
        const busy = await import('src/ts/process/memory/busyActions')
        busy.markPluginPanelShown(panel())
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    test('S15b (R): a panel shown and hidden again inside the window still asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        await bootInWindow(AFTER_FIRST_CHARACTER)
        const busy = await import('src/ts/process/memory/busyActions')
        const shown = panel()
        busy.markPluginPanelShown(shown)
        busy.markPluginPanelHidden(shown)
        expect(busy.isPluginPanelOpen()).toBe(false)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })
})

describe('a boot with no unsaved work stays reloadable by a peer\'s save', () => {
    test('S6 (G): a boot with no input, no import and no panel, then a peer save, reloads the tab without asking', async () => {
        await bootInWindow(AFTER_FIRST_CHARACTER)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('reloaded')
    })

    test('S7 (G): a character the idle hand-off selected before saveDb started, with no input, then a peer save, reloads the tab without asking', async () => {
        await bootInWindow(AFTER_FIRST_CHARACTER, {
            selectedAtStart: 0,
            beforeSaveDb: async () => { liveCharacters()[0].name = 'normalised by the hand-off' },
        })
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('reloaded')
    })

    test('S11 (G): an event the page dispatched itself (not trusted) is not input, so a peer save reloads the tab', async () => {
        await bootInWindow(AFTER_FIRST_CHARACTER)
        userInput('pointerdown', false)
        userInput('keydown', false)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('reloaded')
    })

    test('S12 (G): input after the effects registered does not make the tab unsaved, so a peer save reloads it', async () => {
        const { w } = await bootInWindow(AFTER_FIRST_CHARACTER)
        const committed = nextCommit(w)
        finishInit()
        await committed
        await settled(w)
        userInput('click')
        userInput('keydown')
        broadcastFromPeer()
        expect(await peerSaveOutcome()).toBe('reloaded')
    })

    test('S16 (G): a link that imports nothing (unknown hash) leaves the tab reloadable', async () => {
        await bootInWindow(AFTER_FIRST_CHARACTER)
        const cards = await import('src/ts/characterCards')
        location.hash = '#nothing-to-import'
        await cards.characterURLImport()
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('reloaded')
    })

    test('S16 (G): a #import_module= link whose low-level-access prompt is declined writes nothing and leaves the tab reloadable', async () => {
        await bootInWindow(AFTER_FIRST_CHARACTER)
        const cards = await import('src/ts/characterCards')
        const { alertConfirm } = await import('src/ts/alert')
        vi.mocked(alertConfirm).mockResolvedValueOnce(false)
        importModuleLink({ name: 'needs access', lowLevelAccess: true })
        await cards.characterURLImport()
        expect(liveModules()).toHaveLength(0)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('reloaded')
    })

    test('S16 (G): a #import= link whose download fails writes nothing and leaves the tab reloadable', async () => {
        await bootInWindow(AFTER_FIRST_CHARACTER)
        const cards = await import('src/ts/characterCards')
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }))
        location.hash = '#import=https://example.invalid/card.png'
        await cards.characterURLImport()
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('reloaded')
    })
})

describe('what is saved and what is asked, in cases the window must not disturb', () => {
    test('S2 (G): a character that was selected and then deleted in the window is skipped, and the others are saved', async () => {
        const { w, stores } = await bootInWindow(AFTER_FIRST_CHARACTER)
        const { alertError } = await import('src/ts/alert')
        const committed = nextCommit(w)
        stores.selectedCharID.set(0)
        stores.selectedCharID.set(1)
        liveCharacters().splice(0, 1)
        finishInit()
        await committed
        await settled(w)
        expect(await storedCharacter(w, BETA)).toBeDefined()
        expect(await storedCharacter(w, GAMMA)).toBeDefined()
        expect(alertError).not.toHaveBeenCalled()
    })

    test('S2b (G): a character before the selected one deleted in the window does not move the recorded edit to another character', async () => {
        const { w, stores } = await bootInWindow(AFTER_FIRST_CHARACTER)
        const committed = nextCommit(w)
        stores.selectedCharID.set(1)
        editInPlace(1, 'beta edited')
        liveCharacters().splice(0, 1)
        stores.selectedCharID.set(1)
        finishInit()
        await committed
        await settled(w)
        expect((await storedCharacter(w, BETA))?.name).toBe('beta edited')
        expect((await storedCharacter(w, GAMMA))?.name).toBe(GAMMA)
    })

    test('S8 (G): a peer save after the effects registered and a character was marked asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        const { w } = await bootInWindow(AFTER_FIRST_CHARACTER)
        const committed = nextCommit(w)
        finishInit()
        await committed
        await settled(w)
        h.db!.mainPrompt = 'edited after boot'
        w.marks.markCharacterForSave(ALPHA)
        broadcastFromPeer()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    // Pins markBootWrite's request after the window closed: the effects run once at registration in this harness, so
    // without that request nothing marks this write.
    test('S14 (R): a #import_module= link imported after the effects registered asks for a save, so a peer save asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        const { w } = await bootInWindow(AFTER_FIRST_CHARACTER)
        const cards = await import('src/ts/characterCards')
        const committed = nextCommit(w)
        finishInit()
        await committed
        await settled(w)
        importModuleLink()
        await cards.characterURLImport()
        expect(liveModules()).toHaveLength(1)
        broadcastFromPeer()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    test('S13 (G): a selection that names no character is unsaved work, so a peer save asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        const { stores } = await bootInWindow(AFTER_FIRST_CHARACTER)
        stores.selectedCharID.set(99)
        stores.selectedCharID.set(-1)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })

    test('S9 (G): a page that cannot install the input listener still saves, and a peer save asks instead of reloading', async () => {
        h.holdSelect = new Promise<void>(() => {})
        const original = window.addEventListener.bind(window)
        vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
            if (type === 'pointerdown') {
                throw new Error('listeners are unavailable')
            }
            original(type, listener, options)
        })
        await bootInWindow(AFTER_FIRST_CHARACTER)
        broadcastFromPeer()
        finishInit()
        expect(await peerSaveOutcome()).toBe('prompted')
        expect(reload).not.toHaveBeenCalled()
    })
})