// @vitest-environment jsdom

/**
 * Compare-and-keep in the shared plugin setter (`setDatabase`, `setDatabaseLite`), seen through the real V3 bridge
 * functions: an unchanged copy of `characters` that comes back leaves every live character unmarked and in place, and
 * every other write is marked by the setter itself.
 *
 * Over the REAL `v3.svelte.ts`, `plugins.svelte.ts`, `factory.ts`, `characterSaveMarks.ts`, `dbChangeEffects.svelte.ts`
 * (identity tracker), `dbWriteHook.ts` and the store2 encoder rig. The app's normaliser is mocked (it assigns the root),
 * as in the sibling V3 suites. Fixtures come from the real producers: `buildCharactersProfile` for residents (one chat
 * with alternative records, one group), `buildColdStub` for placeholders.
 *
 * Labels: (R) regression reproducer, fails on the base while an unchanged write marks every character or replaces a
 * live proxy; (G) compatibility guard,
 * passes before and after; (D) diagnostic. A store2 pass is made over the tracker's marks, and its tree is decoded back
 * with `assembleDatabase`, so a mark that is missing shows as a stale value.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { flushSync } from 'svelte'
import type { Database, character } from '../../../storage/database.svelte'
import type { toSaveType } from '../../../storage/risuSave'
import type { RisuPlugin } from '../../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
const readColdStorageItemMock = vi.hoisted(() => vi.fn())

vi.mock('localforage', () => ({
    default: {
        createInstance: (options?: { name?: string }) => ({
            getItem: vi.fn(async (key: string) => {
                if (options?.name === 'plugin_permissions') {
                    if (key.endsWith('_db_lastGrantTime')) return Date.now()
                    if (key.endsWith('_db')) return true
                    if (key.endsWith('_dbWrite_lastGrantTime')) return Date.now()
                    if (key.endsWith('_dbWrite')) return true
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
    markPluginPanelHidden: vi.fn(),
    markPluginPanelShown: vi.fn(),
}))

vi.mock(import('../../../storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('../../../stores.svelte')
    return {
        getCurrentCharacter: vi.fn(),
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('../../../storage/database.svelte')
})

vi.mock(import('../../pluginSafeClass'), () => ({
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
}) as unknown as typeof import('../../pluginSafeClass'))

vi.mock(import('../transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../transpiler'))

vi.mock(import('../../../stores.svelte'), () => {
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
    } as unknown as typeof import('../../../stores.svelte')
})

vi.mock(import('../../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => ({
    alertConfirm: alertConfirmMock,
    alertPluginConfirm: alertConfirmMock,
    alertError: vi.fn(),
    alertErrorWait: vi.fn(async () => {}),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertMd: vi.fn(),
    doingAlert: vi.fn(() => false),
    alertToast: vi.fn(),
    alertWait: vi.fn(() => ({})),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('../../../alert'))

vi.mock(import('../../../globalApi.svelte'), () => ({
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
    readColdStorageItem: readColdStorageItemMock,
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
import { resetReconcileSwitchForTest } from '../../characterReconcile'
import { getV2PluginAPIs } from '../../plugins.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { buildColdStub } from '../../../process/tests/coldStubFixture'
import { resetChatStreamingState } from '../../../storage/characterDefaults'
import { registerDbChangeEffects } from '../../../storage/dbChangeEffects.svelte'
import { installDbWriteHook, uninstallDbWriteHook } from '../../../storage/dbWriteHook'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../../storage/characterSaveMarks'
import { assembleDatabase, previousFrom } from '../../../storage/store2/codec'
import type { EncodedTree } from '../../../storage/store2/codec'
import { createKeyMint } from '../../../storage/store2/commit'
import { createSaveEncoder } from '../../../storage/store2/saveEncoder'
import {
    bytesOf, dbWithCharacters, differingIdentities, encodeWith, fakeLists, mulberry32, roundTrip, seededEnv, type Obj,
} from '../../../storage/tests/store2/codecFixtures'
import { buildCharactersProfile, rigRequest, RIG_NOW } from '../../../storage/tests/store2/writeAmplificationRig'

//#region fixtures

type CharacterFixture = Database['characters'][number]

const PLUGIN_NAME = 'reconcile-test-plugin'
const EDITED = 'desc edited by the plugin'
const SUPA_DATA = 'stale supa memory'
const SUPA_COVERED = 'm0'

function makePlugin(): RisuPlugin {
    return {
        name: PLUGIN_NAME,
        script: 'reconcile-script',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

const altRecord = (id: string, parent: string | null, a: number): Obj => ({ m: { role: 'char', data: id, chatId: id, time: a }, p: parent, a })

interface World {
    db: Database
    ids: string[]
}

/**
 * Three residents as the producer builds them: the first holds a chat whose messages carry path ids and whose
 * alternative records are codec-valid, the last is a group.
 */
function producerWorld(): World {
    const { db, characters } = buildCharactersProfile(3)
    const firstChat = (characters[0].chats as Obj[])[0]
    ;(firstChat.message as Obj[]).forEach((message, index) => { message.chatId = `m${index + 1}` })
    firstChat.alt = [altRecord('x', 'm1', 1), altRecord('y', 'm2', 2)]
    Object.assign(characters[2], { type: 'group', characters: ['group-member-a', 'group-member-b'] })
    return { db, ids: characters.map((entry) => entry.chaId as string) }
}

/** The producer world after boot: `setDatabase` leaves the streaming-mode key on every chat with the value undefined. */
function bootedWorld(): World {
    const world = producerWorld()
    for (const entry of world.db.characters) {
        resetChatStreamingState(entry)
    }
    return world
}

const STREAMING_KEY = 'activeStreamingDisplayOptimizationMode'

const holdsStreamingKey = (list: Obj[]): boolean => list.every((entry) => (entry.chats as Obj[]).every((chat) => Object.hasOwn(chat, STREAMING_KEY)))

/** The live list holds a structured clone, so each test owns its tree and the encoded base stays untouched. */
function installWorld(world: World): void {
    DBState.db = structuredClone(world.db)
}

const live = () => DBState.db.characters as unknown as Obj[]
const api2 = () => getV2PluginAPIs()
const api3 = () => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

/** The V3 read copy of the list after one trip over the bridge: plain, without `alt`. */
async function bridgeCopy(): Promise<Obj[]> {
    const read = await api3().getDatabase(['characters']) as { characters: Obj[] }
    return structuredClone(read.characters)
}

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

interface Wiring {
    tracker: toSaveType
    /** Installs the tracker as the page's explicit mark target (a no-op when `install` was set at wiring). */
    install: () => void
}

const stoppers: Array<() => void> = []

/**
 * `identity`: the page's identity tracker. `hook`: the explicit write hook on the db root. `install`: the mark target
 * exists before the write; false leaves the boot window open (the hook's marks are dropped, the setter's are queued).
 */
function wire(options: { identity: boolean, hook: boolean, install: boolean }): Wiring {
    const tracker = makeTracker()
    resetCharacterSaveMarksForTest()
    if (options.identity) {
        stoppers.push($effect.root(() => { registerDbChangeEffects({ tracker, markChanged: vi.fn() }) }))
        // The seeding run of the identity effect happens before the write, so a missing mark cannot be an unseeded run.
        flushSync()
    }
    if (options.hook) {
        installDbWriteHook(DBState, { selectedChaId: () => undefined })
    }
    const install = () => installCharacterSaveMarks({ tracker, schedule: () => {} })
    if (options.install) {
        install()
    }
    return { tracker, install }
}

const marked = (wiring: Wiring): string[] => wiring.tracker.character.map(String).sort()

/** The pass over the tracker's marks, its decoded database, and the second pass that names every resident. */
interface Passes {
    decoded: Database
    secondUnchanged: boolean
    secondNewUnits: number
}

async function storePasses(base: EncodedTree, markedIds: readonly string[]): Promise<Passes> {
    const plain = $state.snapshot(DBState.db) as Database
    const encoder = createSaveEncoder({ previous: previousFrom(base), lists: fakeLists, env: seededEnv(77), now: () => RIG_NOW })
    const plan = await encoder.plan(plain, rigRequest(markedIds))
    const built = await plan.commitRequest().build({ mint: createKeyMint(seededEnv(900), null).mint, seq: 2, now: RIG_NOW })
    plan.acknowledge()
    const bytes = new Map<string, Uint8Array>()
    for (const unit of base.units) {
        bytes.set(unit.key, bytesOf(unit))
    }
    for (const unit of built.units) {
        bytes.set(unit.key, unit.bytes)
    }
    const decoded = assembleDatabase(built.manifest.body, { get: (key: string) => bytes.get(key) })
    // After the setter and one pass with the setter's own marks, a pass that names every resident has nothing to write
    // but the manifest: nobody wrote into a live character without a mark.
    const residents = (plain.characters as unknown as Obj[]).map((entry) => String(entry.chaId))
    const second = await encoder.plan(plain, rigRequest(residents))
    return { decoded, secondUnchanged: second.unchanged, secondNewUnits: second.newUnits }
}

function decodedCharacter(decoded: Database, chaId: string): Obj {
    const found = (decoded.characters as unknown as Obj[]).find((entry) => entry.chaId === chaId)
    if (found === undefined) {
        throw new Error(`The decoded database holds no character ${chaId}.`)
    }
    return found
}

function expectNothingLeftUnmarked(passes: Passes): void {
    expect(passes.secondUnchanged).toBe(true)
    expect(passes.secondNewUnits).toBe(1)
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort()

//#endregion

beforeEach(() => {
    selectedCharID.set(0)
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    vi.stubGlobal('ImageBitmap', class {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    while (stoppers.length > 0) {
        stoppers.pop()?.()
    }
    uninstallDbWriteHook()
    resetCharacterSaveMarksForTest()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

const SETTERS = ['setDatabase', 'setDatabaseLite'] as const
type Setter = typeof SETTERS[number]

describe('an unchanged copy written back', () => {
    test.each(SETTERS)('(R) R1/R2 %s marks no character', async (method) => {
        const world = producerWorld()
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: true, hook: true, install: true })
        const copy = await bridgeCopy()
        await api3()[method]({ characters: copy })
        flushSync()
        expect(marked(wiring)).toEqual([])
    })

    test('(R) the selected character is marked by the selection effect when the list is reassigned, and no other id is', async () => {
        // The selection effect re-runs for the selected slot whenever `characters` is reassigned, kept or not. That mark is
        // an invariant outside the setter; the setter's own marks are measured with no selection in the tests around it.
        const world = producerWorld()
        installWorld(world)
        selectedCharID.set(0)
        const wiring = wire({ identity: true, hook: true, install: true })
        const copy = await bridgeCopy()
        await api3().setDatabase({ characters: copy })
        flushSync()
        expect(marked(wiring)).toEqual([world.ids[0]])
    })

    test.each(SETTERS)('(R) R1/R2 %s keeps every live proxy in place', async (method) => {
        const world = producerWorld()
        installWorld(world)
        selectedCharID.set(-1)
        wire({ identity: true, hook: true, install: true })
        const before = [...DBState.db.characters]
        const copy = await bridgeCopy()
        await api3()[method]({ characters: copy })
        flushSync()
        expect(DBState.db.characters).toHaveLength(3)
        DBState.db.characters.forEach((entry, index) => expect(entry).toBe(before[index]))
    })

    test.each(SETTERS)('(R) R3 %s with one edited character marks exactly that character, and the pass persists the edit', async (method) => {
        const world = producerWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: true, hook: true, install: true })
        const copy = await bridgeCopy()
        copy[1].desc = EDITED
        await api3()[method]({ characters: copy })
        flushSync()
        expect(marked(wiring)).toEqual([world.ids[1]])
        const passes = await storePasses(base, marked(wiring))
        expect(decodedCharacter(passes.decoded, world.ids[1]).desc).toBe(EDITED)
        expect(decodedCharacter(passes.decoded, world.ids[0]).desc).toBe((world.db.characters as unknown as Obj[])[0].desc)
        expectNothingLeftUnmarked(passes)
    })
})

describe('a JSON-round-tripped copy written back after boot', () => {
    /** The plugin's copy: the bridge clone with every undefined-valued key dropped, as `JSON.stringify` does. */
    async function jsonCopy(): Promise<Obj[]> {
        const raw = await bridgeCopy()
        // Precondition: the bridge copy owns the boot key, so only the plugin's round trip removes it.
        expect(holdsStreamingKey(raw)).toBe(true)
        const copy = JSON.parse(JSON.stringify(raw)) as Obj[]
        expect((copy[1].chats as Obj[]).some((chat) => Object.hasOwn(chat, STREAMING_KEY))).toBe(false)
        return copy
    }

    test.each(SETTERS)('(R) S-R1 %s marks no character and keeps every live proxy', async (method) => {
        const world = bootedWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: true, hook: true, install: true })
        const before = [...DBState.db.characters]
        const copy = await jsonCopy()
        await api3()[method]({ characters: copy })
        flushSync()
        expect(marked(wiring)).toEqual([])
        expect(DBState.db.characters).toHaveLength(3)
        DBState.db.characters.forEach((entry, index) => expect(entry).toBe(before[index]))
        expectNothingLeftUnmarked(await storePasses(base, marked(wiring)))
    })

    test.each(SETTERS)('(R) S-R2 %s with one edited character marks exactly that character, and the pass persists the edit', async (method) => {
        const world = bootedWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: true, hook: true, install: true })
        const copy = await jsonCopy()
        copy[1].desc = EDITED
        await api3()[method]({ characters: copy })
        flushSync()
        expect(marked(wiring)).toEqual([world.ids[1]])
        const passes = await storePasses(base, marked(wiring))
        expect(decodedCharacter(passes.decoded, world.ids[1]).desc).toBe(EDITED)
        expectNothingLeftUnmarked(passes)
    })

    test.each(SETTERS)('(G) S-G1 %s: a removed defined field is marked and the decoded character lacks it', async (method) => {
        const world = bootedWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: true, hook: true, install: true })
        const copy = await jsonCopy()
        expect(copy[1].desc).toBeTruthy()
        delete copy[1].desc
        await api3()[method]({ characters: copy })
        flushSync()
        expect(marked(wiring)).toContain(world.ids[1])
        const passes = await storePasses(base, marked(wiring))
        expect(Object.hasOwn(decodedCharacter(passes.decoded, world.ids[1]), 'desc')).toBe(false)
        expect(decodedCharacter(passes.decoded, world.ids[0]).desc).toBe((world.db.characters as unknown as Obj[])[0].desc)
    })

    test.each(SETTERS)('(G) S-G2 %s: null written over a live undefined is marked and decodes as null', async (method) => {
        const world = bootedWorld()
        ;(world.db.characters as unknown as Obj[])[1].trashTime = undefined
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: true, hook: true, install: true })
        const copy = await jsonCopy()
        copy[1].trashTime = null
        await api3()[method]({ characters: copy })
        flushSync()
        expect(marked(wiring)).toContain(world.ids[1])
        const passes = await storePasses(base, marked(wiring))
        expect(decodedCharacter(passes.decoded, world.ids[1]).trashTime).toBeNull()
    })
})

describe('the measurement switch that forces the fallback', () => {
    afterEach(() => {
        resetReconcileSwitchForTest()
    })

    test.each(SETTERS)('(G) C7 %s: with the switch off every character is marked, installed as the plugin wrote it, and the result is unchanged', async (method) => {
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-reconcile' ? 'off' : null })
        resetReconcileSwitchForTest()
        const world = producerWorld()
        installWorld(world)
        const wiring = wire({ identity: false, hook: false, install: true })
        const before = [...DBState.db.characters]
        const copy = await bridgeCopy()
        copy[1].desc = EDITED
        await api3()[method]({ characters: copy })
        expect(marked(wiring)).toEqual(sorted(world.ids))
        DBState.db.characters.forEach((entry, index) => expect(entry).not.toBe(before[index]))
        expect((DBState.db.characters[1] as unknown as Obj).desc).toBe(EDITED)
    })
})

describe('writes the setter must mark', () => {
    test('(G) G1 a V2 in-place edit through the live wrapper is marked and persisted', async () => {
        const world = producerWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        const wiring = wire({ identity: false, hook: false, install: true })
        const pluginDb = api2().getDatabase() as unknown as Database
        ;(pluginDb.characters[1] as unknown as Obj).name = 'edited in place'
        await Promise.resolve(api2().setDatabaseLite(pluginDb))
        expect(marked(wiring)).toContain(world.ids[1])
        const passes = await storePasses(base, marked(wiring))
        expect(decodedCharacter(passes.decoded, world.ids[1]).name).toBe('edited in place')
    })

    test.each(SETTERS)('(G) G2 %s: a reversal marks every character and the list follows the plugin', async (method) => {
        const world = producerWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        const wiring = wire({ identity: false, hook: false, install: true })
        const copy = await bridgeCopy()
        // Three residents: the reversal keeps the middle slot's chaId, so only the chaId rule of the compare marks it.
        await api3()[method]({ characters: [...copy].reverse() })
        expect(live().map((entry) => entry.chaId)).toEqual([...world.ids].reverse())
        expect(marked(wiring)).toEqual(sorted(world.ids))
        const passes = await storePasses(base, marked(wiring))
        expectNothingLeftUnmarked(passes)
    })

    const SHAPES: Array<[string, (copy: Obj[]) => Obj[]]> = [
        ['a deletion in the middle', (copy) => [copy[0], copy[2]]],
        ['an insertion in the middle', (copy) => [copy[0], { ...structuredClone(copy[1]), chaId: 'inserted-id' }, copy[1], copy[2]]],
        ['an append at the end', (copy) => [...copy, { ...structuredClone(copy[0]), chaId: 'appended-id' }]],
        ['a removal from the end', (copy) => copy.slice(0, 2)],
    ]

    test.each(SHAPES.flatMap(([name, shape]) => SETTERS.map((method) => [name, shape, method] as const)))(
        '(G) G3 %s through %s marks every character of the written list',
        async (_name, shape, method) => {
            const world = producerWorld()
            installWorld(world)
            const wiring = wire({ identity: false, hook: false, install: true })
            const written = shape(await bridgeCopy())
            await api3()[method]({ characters: written })
            expect(live().map((entry) => entry.chaId)).toEqual(written.map((entry) => entry.chaId))
            expect(marked(wiring)).toEqual(sorted(written.map((entry) => entry.chaId as string)))
        },
    )

    test.each(SETTERS)('(G) G4 %s: with no hook and no identity effect, the setter alone marks the changed character', async (method) => {
        const world = producerWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        const wiring = wire({ identity: false, hook: false, install: true })
        const copy = await bridgeCopy()
        copy[2].desc = EDITED
        await api3()[method]({ characters: copy })
        expect(marked(wiring)).toContain(world.ids[2])
        const passes = await storePasses(base, marked(wiring))
        expect(decodedCharacter(passes.decoded, world.ids[2]).desc).toBe(EDITED)
        expectNothingLeftUnmarked(passes)
    })

    test('(G) G6 two live holders of one id: a change at the second holder marks the id', async () => {
        const world = producerWorld()
        ;(world.db.characters as unknown as Obj[])[1].chaId = world.ids[0]
        installWorld(world)
        const wiring = wire({ identity: false, hook: false, install: true })
        const copy = await bridgeCopy()
        copy[1].desc = EDITED
        await api3().setDatabase({ characters: copy })
        expect(marked(wiring)).toContain(world.ids[0])
        expect(live()[1].desc).toBe(EDITED)
    })

    test('(R) G6 a proxy kept at one slot and also placed at a later slot of the same id is marked through that slot', async () => {
        const world = producerWorld()
        ;(world.db.characters as unknown as Obj[])[1].chaId = world.ids[0]
        // No alternatives, so the plain copy equals the live holder without the live-alt reattachment, which a duplicate
        // id makes ambiguous.
        for (const character of world.db.characters as unknown as Obj[]) {
            for (const chat of character.chats as Obj[]) {
                delete chat.alt
            }
        }
        installWorld(world)
        const wiring = wire({ identity: false, hook: false, install: true })
        const holder = live()[0]
        const copyOfHolder = (await bridgeCopy())[0]
        // Slot 0 holds an equal plain bridge copy; slot 1 holds the live holder of slot 0 itself, whose id is the second holder's.
        await Promise.resolve(api2().setDatabaseLite({ characters: [copyOfHolder, holder, live()[2]] }))
        // Slot 0 is the kept live proxy, so the id can only come from slot 1.
        expect(live()[0]).toBe(holder)
        expect(marked(wiring)).toContain(world.ids[0])
    })

    test.each(SETTERS)('(G) G7 %s: an element whose read throws falls back to marking every character', async (method) => {
        const world = producerWorld()
        installWorld(world)
        const wiring = wire({ identity: false, hook: false, install: true })
        const copy = await bridgeCopy()
        Object.defineProperty(copy[1], 'notes', { enumerable: true, configurable: true, get() { throw new Error('the getter fails') } })
        await api3()[method]({ characters: copy })
        expect(marked(wiring)).toEqual(sorted(world.ids))
        expect(live().map((entry) => entry.chaId)).toEqual(world.ids)
    })

    test.each(SETTERS)('(G) G7 %s: nesting deeper than the compare cap is marked', async (method) => {
        const world = producerWorld()
        const nest = (depth: number): Obj => {
            const root: Obj = {}
            let cursor = root
            for (let i = 0; i < depth; i++) {
                const child: Obj = {}
                cursor.next = child
                cursor = child
            }
            cursor.leaf = 'end'
            return root
        }
        ;(world.db.characters as unknown as Obj[])[1].deep = nest(300)
        installWorld(world)
        const wiring = wire({ identity: false, hook: false, install: true })
        const copy = await bridgeCopy()
        await api3()[method]({ characters: copy })
        expect(marked(wiring)).toContain(world.ids[1])
    })
})

describe('light entries written back', () => {
    const lightOf = async (): Promise<Obj[]> => (await api3().getLightCharacters()) as unknown as Obj[]

    const WIRINGS = SETTERS.flatMap((method) => [false, true].map((tracked) => [method, tracked] as const))

    test.each(WIRINGS)('(R) L-R1 %s tracked=%s: a light list written back in place marks no character and keeps every proxy', async (method, tracked) => {
        const world = producerWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: tracked, hook: tracked, install: true })
        const before = [...DBState.db.characters]
        const entries = await lightOf()
        expect(entries.map((entry) => entry.chaId)).toEqual(world.ids)
        const counts = await api3()[method]({ characters: entries })
        flushSync()
        expect(counts).toEqual({ lightKept: 3, lightLeftOut: 0 })
        expect(marked(wiring)).toEqual([])
        expect(DBState.db.characters).toHaveLength(3)
        DBState.db.characters.forEach((entry, index) => expect(entry).toBe(before[index]))
        expectNothingLeftUnmarked(await storePasses(base, marked(wiring)))
    })

    test.each(SETTERS)('(R) L-R2 %s: a reordered light list marks exactly the moved holders and the order follows', async (method) => {
        const world = producerWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: false, hook: false, install: true })
        const [e0, e1, e2] = await lightOf()
        await api3()[method]({ characters: [e0, e2, e1] })
        expect(live().map((entry) => entry.chaId)).toEqual([world.ids[0], world.ids[2], world.ids[1]])
        // The exact marks are the evidence that a pass is scheduled for the order; the pass below encodes it either way.
        expect(marked(wiring)).toEqual(sorted([world.ids[1], world.ids[2]]))
        const passes = await storePasses(base, marked(wiring))
        expect((passes.decoded.characters as unknown as Obj[]).map((entry) => entry.chaId)).toEqual([world.ids[0], world.ids[2], world.ids[1]])
        expectNothingLeftUnmarked(passes)
    })

    test.each(SETTERS)('(R) L-R2 %s: a reversal of three leaves the middle holder unmarked and marks both ends', async (method) => {
        const world = producerWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: false, hook: false, install: true })
        const entries = await lightOf()
        await api3()[method]({ characters: [...entries].reverse() })
        expect(live().map((entry) => entry.chaId)).toEqual([...world.ids].reverse())
        expect(marked(wiring)).toEqual(sorted([world.ids[0], world.ids[2]]))
        expectNothingLeftUnmarked(await storePasses(base, marked(wiring)))
    })

    test.each(SETTERS)('(R) L-R3 %s: light entries beside one edited full copy mark only the edited character', async (method) => {
        const world = producerWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: false, hook: false, install: true })
        const entries = await lightOf()
        const copy = await bridgeCopy()
        copy[1].desc = EDITED
        await api3()[method]({ characters: [entries[0], copy[1], entries[2]] })
        expect(marked(wiring)).toEqual([world.ids[1]])
        const passes = await storePasses(base, marked(wiring))
        expect(decodedCharacter(passes.decoded, world.ids[1]).desc).toBe(EDITED)
        expectNothingLeftUnmarked(passes)
    })

    test.each(SETTERS)('(R) L-R4 %s: light entries and an appended new character mark only the new one', async (method) => {
        const world = producerWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: false, hook: false, install: true })
        const entries = await lightOf()
        const fresh = { ...structuredClone((await bridgeCopy())[0]), chaId: 'appended-id' }
        await api3()[method]({ characters: [...entries, fresh] })
        expect(live().map((entry) => entry.chaId)).toEqual([...world.ids, 'appended-id'])
        expect(marked(wiring)).toEqual(['appended-id'])
        const passes = await storePasses(base, marked(wiring))
        expect(passes.decoded.characters).toHaveLength(4)
        expectNothingLeftUnmarked(passes)
    })

    test.each(SETTERS)('(R) L-R5 %s: an entry without a holder ahead of the holders shifts no mark', async (method) => {
        const world = producerWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: false, hook: false, install: true })
        const entries = await lightOf()
        const orphan = { ...entries[0], chaId: 'no-such-holder' }
        const counts = await api3()[method]({ characters: [entries[0], orphan, entries[1], entries[2]] })
        expect(counts).toEqual({ lightKept: 3, lightLeftOut: 1 })
        expect(live().map((entry) => entry.chaId)).toEqual(world.ids)
        expect(marked(wiring)).toEqual([])
        expectNothingLeftUnmarked(await storePasses(base, marked(wiring)))
    })

    /** An empty chat that still holds stale memory fields; each arm leaves a different subset. */
    const STALE_ARMS: Array<[string, (chat: Obj) => void, (chat: Obj) => void]> = [
        ['data and covered id', (chat) => { chat.supaMemoryData = SUPA_DATA; chat.supaMemoryCoveredId = SUPA_COVERED },
            (chat) => { expect(chat.supaMemoryData).toBe(''); expect(chat.supaMemoryCoveredId).toBeUndefined() }],
        ['data only', (chat) => { chat.supaMemoryData = SUPA_DATA; delete chat.supaMemoryCoveredId },
            (chat) => { expect(chat.supaMemoryData).toBe('') }],
        ['covered id only', (chat) => { chat.supaMemoryData = ''; chat.supaMemoryCoveredId = SUPA_COVERED },
            (chat) => { expect(chat.supaMemoryCoveredId).toBeUndefined() }],
    ]

    test.each(SETTERS.flatMap((method) => STALE_ARMS.map((arm) => [method, ...arm] as const)))(
        '(G) L-G1 %s, stale %s: a light holder whose empty chat is cleared is marked and the clear persists (passes before and after)',
        async (method, _name, stale, expectCleared) => {
            const world = producerWorld()
            const chat = ((world.db.characters as unknown as Obj[])[1].chats as Obj[])[0]
            chat.message = []
            stale(chat)
            const base = encodeWith(world.db)
            installWorld(world)
            selectedCharID.set(-1)
            const wiring = wire({ identity: false, hook: false, install: true })
            await api3()[method]({ characters: await lightOf() })
            expect(marked(wiring)).toContain(world.ids[1])
            const passes = await storePasses(base, marked(wiring))
            expectCleared((decodedCharacter(passes.decoded, world.ids[1]).chats as Obj[])[0])
            expectNothingLeftUnmarked(passes)
        },
    )

    test.each(SETTERS)('(G) L-G2 %s: a light list missing its last entry marks every remaining holder (passes before and after)', async (method) => {
        const world = producerWorld()
        installWorld(world)
        selectedCharID.set(-1)
        const wiring = wire({ identity: false, hook: false, install: true })
        const entries = await lightOf()
        await api3()[method]({ characters: entries.slice(0, 2) })
        expect(live().map((entry) => entry.chaId)).toEqual(world.ids.slice(0, 2))
        expect(marked(wiring)).toEqual(sorted(world.ids.slice(0, 2)))
    })

    describe('with the measurement switch off', () => {
        afterEach(() => {
            resetReconcileSwitchForTest()
        })

        test.each(SETTERS)('(G) L-G3 %s: every holder is marked (passes before and after)', async (method) => {
            vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-reconcile' ? 'off' : null })
            resetReconcileSwitchForTest()
            const world = producerWorld()
            installWorld(world)
            selectedCharID.set(-1)
            const wiring = wire({ identity: false, hook: false, install: true })
            await api3()[method]({ characters: await lightOf() })
            expect(marked(wiring)).toEqual(sorted(world.ids))
        })
    })
})

describe('a placeholder restored by the write', () => {
    interface UnitEntry { character: unknown }
    const units = new Map<string, UnitEntry>()

    function fullOf(chaId: string): character {
        const chat = (index: number, text: string): Obj => ({ id: `${chaId}-chat-${index}`, message: [{ role: 'user', data: text, chatId: 'm1', time: 1 }, { role: 'char', data: `${text} reply`, chatId: 'm2', time: 2 }], note: '', name: `${chaId}-chat-${index}`, localLore: [] })
        const first = { ...chat(0, 'first'), alt: [altRecord('x', 'm1', 1)] }
        return {
            type: 'character', name: `${chaId} name`, chaId, chatPage: 0, firstMsgIndex: 0, creatorNotes: '', lastInteraction: 5000,
            desc: `${chaId} description`, globalLore: [], chats: [first, chat(1, 'second')],
        } as unknown as character
    }

    /** The placeholder as it sits in the list after load: the fields the boot-time format check fills are default-filled. */
    function stubOf(full: character, key: string): CharacterFixture {
        const stub = buildColdStub(full, key, []) as unknown as Record<string, unknown>
        Object.assign(stub, { customscript: [], firstMessage: '', globalLore: [], desc: '', viewScreen: 'none', emotionImages: [] })
        return stub as unknown as CharacterFixture
    }

    beforeEach(() => {
        units.clear()
        readColdStorageItemMock.mockReset()
        readColdStorageItemMock.mockImplementation(async (key: string) => {
            const entry = units.get(key)
            return entry === undefined ? { status: 'missing' } : { status: 'ok', value: { character: structuredClone(entry.character) } }
        })
    })

    function archivedWorld(): void {
        const hero = fullOf('hero')
        units.set('unit-hero', { character: hero })
        const characters = [stubOf(hero, 'unit-hero'), fullOf('warm') as unknown as CharacterFixture]
        DBState.db = {
            formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [{ name: PLUGIN_NAME, script: '' }],
            pluginCustomStorage: {}, characterOrder: ['hero', 'warm'], characters,
        } as unknown as Database
    }

    test.each(SETTERS)('(G) G5 %s: equal content over the restored holder leaves the character complete', async (method) => {
        archivedWorld()
        wire({ identity: false, hook: false, install: true })
        const copy = await api3().getCharacterFromIndex(0) as Obj
        await api3()[method]({ characters: [copy, DBState.db.characters[1]] })
        const restored = live()[0]
        expect(restored.coldstorage).toBeFalsy()
        const chats = restored.chats as Obj[]
        expect((chats[0].message as Obj[])[0].data).toBe('first')
        expect($state.snapshot(chats[0].alt)).toEqual([altRecord('x', 'm1', 1)])
    })

    test.each(SETTERS)('(R) G5 %s: an equal copy of another character beside a restored placeholder is kept and not marked', async (method) => {
        archivedWorld()
        const wiring = wire({ identity: false, hook: false, install: true })
        const keptHolder = live()[1]
        const copy = await api3().getCharacterFromIndex(0) as Obj
        const warmCopy = structuredClone($state.snapshot(keptHolder)) as Obj
        await api3()[method]({ characters: [copy, warmCopy] })
        expect(live()[1]).toBe(keptHolder)
        expect(marked(wiring)).not.toContain('warm')
    })

    test.each(SETTERS)('(G) G5 %s: changed content over the restored holder is marked', async (method) => {
        archivedWorld()
        const wiring = wire({ identity: false, hook: false, install: true })
        const copy = await api3().getCharacterFromIndex(0) as Obj
        ;((copy.chats as Obj[])[0].message as Obj[])[0].data = 'edited'
        await api3()[method]({ characters: [copy, DBState.db.characters[1]] })
        expect(marked(wiring)).toContain('hero')
        expect((((live()[0].chats as Obj[])[0].message as Obj[])[0]).data).toBe('edited')
    })
})

describe('the SupaMemory clear of an empty chat', () => {
    /** An empty chat that still holds the stale memory fields, as a deleted-messages chat is left. Only these three fields differ from the producer's chat; the chat keeps its id. */
    function staleWorld(): World {
        const world = producerWorld()
        const chat = ((world.db.characters as unknown as Obj[])[1].chats as Obj[])[0]
        chat.message = []
        chat.supaMemoryData = SUPA_DATA
        chat.supaMemoryCoveredId = SUPA_COVERED
        return world
    }

    function expectCleared(passes: Passes, chaId: string): void {
        const chat = (decodedCharacter(passes.decoded, chaId).chats as Obj[])[0]
        expect(chat.supaMemoryData).toBe('')
        expect(chat.supaMemoryCoveredId).toBeUndefined()
    }

    test.each(SETTERS)('(G) G9 arm a %s: in the boot window the clear is marked and persisted', async (method) => {
        const world = staleWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        // The hook is live and no mark target exists yet: the hook's marks are dropped, the setter's are queued.
        const wiring = wire({ identity: false, hook: true, install: false })
        const copy = await bridgeCopy()
        await api3()[method]({ characters: copy })
        wiring.install()
        expect(marked(wiring)).toContain(world.ids[1])
        const passes = await storePasses(base, marked(wiring))
        expectCleared(passes, world.ids[1])
        expectNothingLeftUnmarked(passes)
    })

    test.each(SETTERS)('(G) G9 arm b %s: with no hook the clear is marked and persisted', async (method) => {
        const world = staleWorld()
        const base = encodeWith(world.db)
        installWorld(world)
        const wiring = wire({ identity: false, hook: false, install: true })
        const copy = await bridgeCopy()
        await api3()[method]({ characters: copy })
        expect(marked(wiring)).toContain(world.ids[1])
        const passes = await storePasses(base, marked(wiring))
        expectCleared(passes, world.ids[1])
        expectNothingLeftUnmarked(passes)
    })
})

//#region G8 oracle

const SEED = Number(process.env.RECONCILE_SEED ?? 20261114)
const ITERATIONS = 200
const DECODE_EVERY = 10
/** Top-level keys whose change the setter treats as a different kind of write (identity, stubs). */
const PROTECTED_KEYS = new Set(['chaId', 'type', 'coldstorage'])

class Foreign {
    value = 1
}

interface Operation {
    name: string
    apply: () => void
}

function isContainer(value: unknown): value is Obj | unknown[] {
    return typeof value === 'object' && value !== null
}

/** Every mutation that can be applied to `root`, each a closure over the exact container and key. */
function operationsOf(root: Obj): Operation[] {
    const out: Operation[] = []
    const visit = (container: Obj | unknown[], depth: number): void => {
        const record = container as Record<string, unknown>
        if (Array.isArray(container)) {
            out.push({ name: 'push', apply: () => { container.push(1) } })
            out.push({ name: 'pop', apply: () => { container.pop() } })
            out.push({ name: 'splice', apply: () => { container.splice(0, 1) } })
            if (container.length >= 2) {
                out.push({ name: 'swap', apply: () => { [container[0], container[1]] = [container[1], container[0]] } })
            }
            if (container.length >= 1) {
                out.push({ name: 'hole', apply: () => { delete container[0] } })
            }
        } else {
            out.push({ name: 'addKey', apply: () => { record.zzAdded = 1 } })
        }
        for (const key of Object.keys(record)) {
            if (depth === 0 && PROTECTED_KEYS.has(key)) {
                continue
            }
            const value = record[key]
            out.push({ name: 'null', apply: () => { record[key] = null } })
            out.push({ name: 'undefined', apply: () => { record[key] = undefined } })
            if (!Array.isArray(container)) {
                out.push({ name: 'delete', apply: () => { delete record[key] } })
            }
            if (typeof value === 'string') {
                out.push({ name: 'text', apply: () => { record[key] = `${value} changed` } })
                out.push({ name: 'boxedString', apply: () => { record[key] = new String(value) } })
                out.push({ name: 'toJSON', apply: () => { record[key] = { toJSON: () => value } } })
                out.push({ name: 'date', apply: () => { record[key] = new Date(0) } })
            } else if (typeof value === 'number') {
                out.push({ name: 'plusOne', apply: () => { record[key] = value + 1 } })
                out.push({ name: 'negativeZero', apply: () => { record[key] = -0 } })
                out.push({ name: 'nan', apply: () => { record[key] = NaN } })
                out.push({ name: 'boxedNumber', apply: () => { record[key] = new Number(value) } })
            } else if (typeof value === 'boolean') {
                out.push({ name: 'flip', apply: () => { record[key] = !value } })
            } else if (isContainer(value) && !Array.isArray(value)) {
                out.push({ name: 'classInstance', apply: () => { record[key] = Object.assign(new Foreign(), value) } })
            }
            if (isContainer(value)) {
                visit(value, depth + 1)
            }
        }
    }
    visit(root, 0)
    return out
}

/** A plain snapshot without the `alt` records: the bridge copy never carries them and the setter reattaches the live ones. */
function withoutAlt(value: Obj): Obj {
    const strip = (node: unknown): unknown => {
        if (Array.isArray(node)) {
            return node.map(strip)
        }
        if (isContainer(node)) {
            const out: Obj = {}
            for (const [key, child] of Object.entries(node)) {
                if (key !== 'alt') {
                    out[key] = strip(child)
                }
            }
            return out
        }
        return node
    }
    return strip(value) as Obj
}

function encodesDiffer(a: Obj, b: Obj): boolean {
    try {
        return differingIdentities(encodeWith(dbWithCharacters([a])), encodeWith(dbWithCharacters([b]))).length > 0
    } catch {
        return true
    }
}

//#endregion

describe('the oracle at the setter', () => {
    const ORACLE_CASES = SETTERS.flatMap((method) => [false, true].map((booted) => [method, booted] as const))

    test.each(ORACLE_CASES)('(G) G8 %s booted=%s: a write that changes the live encoding is marked, and a mutated copy that encodes differently from live is never kept', async (method: Setter, booted: boolean) => {
        const rng = mulberry32(SEED)
        // Booted: the world as `setDatabase` leaves it, and the copy as a plugin's JSON round trip returns it.
        const world = booted ? bootedWorld() : producerWorld()
        const base = encodeWith(world.db)
        let mutated = 0
        let obliged = 0
        let falseEqualChecked = 0
        let decodedRuns = 0
        let decodedChecked = 0
        for (let iteration = 0; iteration < ITERATIONS; iteration++) {
            const label = `seed ${SEED} iteration ${iteration}`
            installWorld(world)
            const wiring = wire({ identity: false, hook: false, install: true })
            const before = live().map((entry) => $state.snapshot(entry) as Obj)
            const copy = booted ? JSON.parse(JSON.stringify(await bridgeCopy())) as Obj[] : await bridgeCopy()
            let applied = 'none'
            let mutatedSlot = -1
            let copyDiffers = false
            if (rng() < 0.8) {
                mutatedSlot = Math.floor(rng() * copy.length)
                const operations = operationsOf(copy[mutatedSlot])
                const chosen = operations[Math.floor(rng() * operations.length)]
                chosen.apply()
                applied = chosen.name
                mutated++
                copyDiffers = mutatedSlot < before.length && encodesDiffer(withoutAlt(before[mutatedSlot]), copy[mutatedSlot])
            }
            let refused = false
            try {
                await api3()[method]({ characters: copy })
            } catch {
                // A refused or failed write is judged by what it left behind.
                refused = true
            }
            const after = live().map((entry) => $state.snapshot(entry) as Obj)
            const markedIds = marked(wiring)
            for (let slot = 0; slot < after.length; slot++) {
                if (slot < before.length && encodesDiffer(before[slot], after[slot])) {
                    obliged++
                    expect(markedIds, `${label} (${applied}) slot ${slot} changed but was not marked`).toContain(String(after[slot].chaId))
                }
            }
            // A mutated copy that encodes differently from the live character must not be kept, that is it must be marked:
            // dropping the plugin's write leaves live unchanged and consistent, so only this obligation sees a false "equal".
            if (!refused && copyDiffers && mutatedSlot < after.length) {
                falseEqualChecked++
                expect(markedIds, `${label} (${applied}) slot ${mutatedSlot} was kept although the plugin changed it`).toContain(String(before[mutatedSlot].chaId))
            }
            if (iteration % DECODE_EVERY === 0 && after.length === world.ids.length) {
                let passes: Passes | undefined
                try {
                    passes = await storePasses(base, markedIds)
                } catch {
                    passes = undefined
                }
                if (passes !== undefined) {
                    decodedRuns++
                    // The expected value is the live state after one codec round trip, so the codec's own normalisation of
                    // odd values (null, NaN, -0) is on both sides and only a stale unit shows as a difference.
                    let expected: Obj[] | undefined
                    try {
                        expected = roundTrip(dbWithCharacters(after)).assembled.characters as unknown as Obj[]
                    } catch {
                        // A character the codec refuses has no stored form to compare; the pass over it was a no-op.
                        expected = undefined
                    }
                    if (expected !== undefined) {
                        decodedChecked++
                        for (let slot = 0; slot < after.length; slot++) {
                            expect(encodesDiffer(decodedCharacter(passes.decoded, String(after[slot].chaId)), expected[slot]), `${label} (${applied}) slot ${slot} decoded differently`).toBe(false)
                        }
                    }
                    expectNothingLeftUnmarked(passes)
                }
            }
        }
        expect(mutated).toBeGreaterThan(ITERATIONS / 2)
        expect(obliged).toBeGreaterThan(20)
        expect(falseEqualChecked).toBeGreaterThan(20)
        expect(decodedRuns).toBeGreaterThanOrEqual(ITERATIONS / DECODE_EVERY / 2)
        expect(decodedChecked).toBeGreaterThanOrEqual(ITERATIONS / DECODE_EVERY / 2)
    })
})
