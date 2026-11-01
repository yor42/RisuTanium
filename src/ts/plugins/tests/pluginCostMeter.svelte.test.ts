// @vitest-environment jsdom
/**
 * The plugin-cost counters of a measurement build (CHORE-17 stage 0), over the REAL `v3.svelte.ts`, `plugins.svelte.ts`,
 * `factory.ts` (the host bridge, driven with synthetic messages) and `dbChangeEffects.svelte.ts` (the identity tracker).
 *
 * Test kinds: "guard:" rows pass with the counters present or absent and must fail if a counter changes a result, throws
 * into the caller or records with the switch off; "diagnostic:" rows establish that each listed phase is recorded.
 * The measurement flag is true under vitest (development mode); the run-time switch is localStorage
 * `risu-measure-savepass`.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'
import type { RisuPlugin } from '../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
const readColdStorageItemMock = vi.hoisted(() => vi.fn())

vi.mock('localforage', () => ({
    default: {
        createInstance: (options?: { name?: string }) => ({
            getItem: vi.fn(async (key: string) => {
                // A stored recent 'db' grant keeps the database APIs from prompting.
                if (options?.name === 'plugin_permissions') {
                    if (key.endsWith('_db_lastGrantTime')) return Date.now()
                    if (key.endsWith('_db')) return true
                }
                return null
            }),
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

vi.mock('src/ts/process/memory/busyActions', () => ({
    beginChokePoint: vi.fn(() => () => {}),
}))

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
        alertStore: writable({ type: 'none', msg: '' }),
        hotReloading: writable(false),
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
    const show = () => {}
    return {
        alertConfirm: alertConfirmMock,
        alertPluginConfirm: alertConfirmMock,
        alertError: vi.fn(show),
        alertErrorWait: vi.fn(async () => {}),
        alertNormal: vi.fn(show),
        alertNormalWait: vi.fn(async () => {}),
        alertMd: vi.fn(show),
        doingAlert: vi.fn(() => false),
        alertToast: vi.fn(show),
        alertWait: vi.fn(() => ({})),
        alertClear: vi.fn(),
        waitAlert: vi.fn(async () => {}),
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
    readColdStorageItem: readColdStorageItemMock,
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../process/files/inlays'))

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

import { makeRisuaiAPIV3 } from '../apiV3/v3.svelte'
import { SandboxHost } from '../apiV3/factory'
import { getV2PluginAPIs } from '../plugins.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { buildColdStub } from '../../process/coldCharacter'
import { registerDbChangeEffects } from '../../storage/dbChangeEffects.svelte'
import {
    resetPluginMeterForTest, setPluginMeterClockForTest, type PluginCostRecord, type PluginMeterHandle, type PluginRecordKind,
} from '../pluginCostMeter'

//#region fixtures

type CharacterFixture = Database['characters'][number]
type Entry = Record<string, unknown>
type MeterGlobal = { __risuPluginMeter?: PluginMeterHandle }

const PLUGIN_NAME = 'meter-test-plugin'
const SWITCH_KEY = 'risu-measure-savepass'

function makePlugin(): RisuPlugin {
    return {
        name: PLUGIN_NAME,
        script: 'meter-script',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

function rec(id: string, p: string | null, a: number): Entry {
    return { m: { role: 'char', data: id, chatId: id, time: a }, p, a }
}

const sent = (...ids: string[]) => ids.map((chatId) => ({ role: 'user', data: chatId, chatId, time: 1 }))

/** A chat with the alternatives `alt` (absent when null), in the shape the alternatives bridge keeps. */
function altChat(id: string, alt: Entry[] | null): Entry {
    return { id, message: sent('m1', 'm2'), note: '', name: id, localLore: [], ...(alt ? { alt } : {}) }
}

/** A full character with one chat holding two alternative records. */
function fullCharacter(chaId: string): character {
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
        chats: [altChat(`${chaId}-chat-0`, [rec('x', 'm1', 1), rec('y', 'm1', 2)])],
    } as unknown as character
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [{ name: PLUGIN_NAME, script: '' }],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
    } as unknown as Database
}

const api3 = () => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

function switchOn(): void {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === SWITCH_KEY ? 'on' : null })
    resetPluginMeterForTest()
}

function switchOff(): void {
    vi.stubGlobal('localStorage', { getItem: () => null })
    resetPluginMeterForTest()
}

function meter(): PluginMeterHandle {
    const found = (globalThis as MeterGlobal).__risuPluginMeter
    if (found === undefined) {
        throw new Error('The meter handle is not installed.')
    }
    return found
}

function recordsOf(kind: PluginRecordKind): PluginCostRecord[] {
    return meter().all().filter(record => record.kind === kind)
}

function lastOf(kind: PluginRecordKind): PluginCostRecord {
    const found = recordsOf(kind).at(-1)
    if (found === undefined) {
        throw new Error(`No ${kind} record.`)
    }
    return found
}

const WRITE_SPANS = ['writeProblemMs', 'placeholderTargetsMs', 'stubDowngradesMs', 'idsDuplicatesMs', 'keepLiveAltMs', 'keyLoopMs', 'clearSupaMemoryMs', 'markLoopMs']

/** The result of the whole read-then-write scenario, with the live state after it. */
async function scenario(): Promise<{ read: unknown, after: unknown }> {
    installDb([fullCharacter('a') as unknown as CharacterFixture, fullCharacter('b') as unknown as CharacterFixture])
    const read = await api3().getDatabase(['characters', 'lineHeight'])
    await api3().setDatabase({ characters: [fullCharacter('a'), fullCharacter('b')] })
    await api3().setDatabaseLite({ lineHeight: 7 })
    return { read, after: $state.snapshot(DBState.db) }
}

//#endregion

beforeEach(() => {
    readColdStorageItemMock.mockReset()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    selectedCharID.set(0)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    switchOn()
})

afterEach(() => {
    resetPluginMeterForTest()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('the switch', () => {
    test('guard: with the switch off nothing is recorded and no global exists, and the results equal the switch-on results', async () => {
        switchOff()
        const off = await scenario()
        expect((globalThis as MeterGlobal).__risuPluginMeter).toBeUndefined()

        switchOn()
        const on = await scenario()
        expect(meter().all().length).toBeGreaterThan(0)
        expect(on.read).toEqual(off.read)
        expect(on.after).toEqual(off.after)
    })

    test('guard: a clock that fails after the record started changes no result and throws into no caller', async () => {
        switchOff()
        const plain = await scenario()

        switchOn()
        let reads = 0
        // The first read starts the record; every later read (laps, finish) throws.
        setPluginMeterClockForTest(() => {
            reads += 1
            if (reads > 1) {
                throw new Error('the clock failed')
            }
            return 0
        })
        const failing = await scenario()
        expect(reads).toBeGreaterThan(1)
        expect(failing.read).toEqual(plain.read)
        expect(failing.after).toEqual(plain.after)
    })
})

describe('diagnostic: the read split', () => {
    test('getDatabase records the permission, one snapshot span per key, the alt volume, the alt walk and the module load', async () => {
        installDb([fullCharacter('a') as unknown as CharacterFixture, fullCharacter('b') as unknown as CharacterFixture])
        await api3().getDatabase(['characters', 'lineHeight'])
        const { fields } = lastOf('read')
        expect(typeof fields.permissionMs).toBe('number')
        expect(Object.keys(fields.snapshotMs as Record<string, number>).sort()).toEqual(['characters', 'lineHeight'])
        expect(fields.altChats).toBe(2)
        expect(fields.altRecords).toBe(4)
        expect(typeof fields.withoutAltMs).toBe('number')
        expect(fields.materialiseModulesMs).toBeUndefined()
    })

    test('a read that includes the modules records the module load', async () => {
        installDb([fullCharacter('a') as unknown as CharacterFixture])
        await api3().getDatabase(['modules'])
        expect(typeof lastOf('read').fields.materialiseModulesMs).toBe('number')
    })
})

describe('diagnostic: the write split', () => {
    test('setDatabase records every listed span, the normaliser and the mark loop', async () => {
        installDb([fullCharacter('a') as unknown as CharacterFixture, fullCharacter('b') as unknown as CharacterFixture])
        await api3().setDatabase({ characters: [fullCharacter('a'), fullCharacter('b')] })
        const { fields } = lastOf('write')
        expect(fields.method).toBe('setDatabase')
        for (const name of WRITE_SPANS) {
            expect(typeof fields[name], name).toBe('number')
        }
        expect(typeof fields.normalizerMs).toBe('number')
        expect(fields.marksRaised).toBe(2)
    })

    test('setDatabaseLite records its own spans and assignment, without a normaliser', async () => {
        installDb([fullCharacter('a') as unknown as CharacterFixture])
        await api3().setDatabaseLite({ characters: [fullCharacter('a')] })
        const { fields } = lastOf('write')
        expect(fields.method).toBe('setDatabaseLite')
        for (const name of WRITE_SPANS) {
            expect(typeof fields[name], name).toBe('number')
        }
        expect(typeof fields.assignMs).toBe('number')
        expect(fields.normalizerMs).toBeUndefined()
    })

    test('a write without characters records no list-dependent span and no sameObject', async () => {
        installDb([fullCharacter('a') as unknown as CharacterFixture])
        await api3().setDatabase({ lineHeight: 3 })
        const { fields } = lastOf('write')
        expect(fields.idsDuplicatesMs).toBeUndefined()
        expect(fields.sameObject).toBeUndefined()
        expect(fields.marksRaised).toBe(0)
    })

    test('sameObject counts the live element a refused stub is swapped for, and counts nothing for fresh copies of the same chaId', async () => {
        const full = fullCharacter('a')
        installDb([full as unknown as CharacterFixture, fullCharacter('b') as unknown as CharacterFixture])
        const stub = buildColdStub(full, 'unit-a', []) as unknown as CharacterFixture

        // A stub with a unit key the live list does not hold, over a live full holder, is refused and the live holder takes its place.
        await api3().setDatabase({ characters: [stub, fullCharacter('b')] })
        const swapped = lastOf('write').fields
        expect(swapped.sameObject).toBe(1)
        expect(swapped.sameObjectChaIds).toEqual(['a'])

        await api3().setDatabase({ characters: [fullCharacter('a'), fullCharacter('b')] })
        const fresh = lastOf('write').fields
        expect(fresh.sameObject).toBe(0)
        expect(fresh.sameObjectChaIds).toEqual([])
    })
})

describe('diagnostic: the identity tracker', () => {
    test('a replaced character is booked as one new mark in the run that saw it', () => {
        installDb([fullCharacter('a') as unknown as CharacterFixture, fullCharacter('b') as unknown as CharacterFixture])
        const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        const markChanged = vi.fn()
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        const before = recordsOf('identity').length
        expect(before).toBeGreaterThan(0)

        DBState.db.characters = [fullCharacter('a'), DBState.db.characters[1]] as unknown as Database['characters']
        flushSync()
        const run = lastOf('identity')
        expect(recordsOf('identity').length).toBeGreaterThan(before)
        expect(run.fields.newMarks).toBe(1)
        expect(run.fields.characters).toBe(2)
        cleanup()
    })
})

describe('diagnostic: the bridge split', () => {
    type Msg = Record<string, unknown>

    async function request(api: Record<string, unknown>, data: Msg): Promise<{ response: Msg, calls: number }> {
        const host = new SandboxHost(api)
        const container = document.createElement('div')
        document.body.appendChild(container)
        host.run(container, '')
        const iframe = container.querySelector('iframe') as HTMLIFrameElement
        const win = iframe.contentWindow as Window
        const posted: Msg[] = []
        vi.spyOn(win, 'postMessage').mockImplementation(((message: Msg) => {
            posted.push(message)
        }) as unknown as typeof win.postMessage)
        const event = new MessageEvent('message', { data: { ...data, reqId: 'req-1' } })
        Object.defineProperty(event, 'source', { value: win })
        window.dispatchEvent(event)
        for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
        host.terminate()
        document.body.innerHTML = ''
        const response = posted.find((m) => m.type === 'RESPONSE' && m.reqId === 'req-1')
        if (!response) throw new Error('no RESPONSE posted')
        return { response, calls: posted.length }
    }

    beforeEach(() => {
        vi.stubGlobal('ImageBitmap', class {})
        if (!('sandbox' in HTMLIFrameElement.prototype)) {
            Object.defineProperty(HTMLIFrameElement.prototype, 'sandbox', {
                configurable: true,
                get() { return { add() {} } },
            })
        }
    })

    test('a call records the method, each span, one transfer walk and one post', async () => {
        const { response } = await request({ echo: async (value: unknown) => value }, { type: 'CALL_ROOT', method: 'echo', args: [{ kind: 'x' }] })
        expect(response.error).toBeUndefined()
        const { fields } = lastOf('bridge')
        expect(fields.method).toBe('echo')
        for (const name of ['deserializeMs', 'fnMs', 'serializeMs', 'collectTransferablesMs', 'postMessageMs']) {
            expect(typeof fields[name], name).toBe('number')
        }
        expect(fields.collectTransferablesCalls).toBe(1)
        expect(fields.failed).toBeUndefined()
    })

    test('a call that fails is recorded as failed, with no transfer walk', async () => {
        const { response } = await request({}, { type: 'CALL_ROOT', method: 'missing', args: [] })
        expect(typeof response.error).toBe('string')
        const { fields } = lastOf('bridge')
        expect(fields.method).toBe('missing')
        expect(fields.failed).toBe(true)
        expect(fields.collectTransferablesCalls).toBeUndefined()
    })

    test('guard: with the switch off a call records nothing and answers the same', async () => {
        const { response: on } = await request({ echo: async (value: unknown) => value }, { type: 'CALL_ROOT', method: 'echo', args: [{ kind: 'x' }] })
        switchOff()
        const { response: off } = await request({ echo: async (value: unknown) => value }, { type: 'CALL_ROOT', method: 'echo', args: [{ kind: 'x' }] })
        expect((globalThis as MeterGlobal).__risuPluginMeter).toBeUndefined()
        expect(off).toEqual(on)
    })
})
