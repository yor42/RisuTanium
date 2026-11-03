// @vitest-environment jsdom

/**
 * A GUI bump issued from inside another effect's flush must not freeze the chat rows. The real `stores.svelte.ts`
 * (its module `$effect` and the first `ReloadGUIPointer` subscriber), the real `modules.ts` (`moduleUpdate`) and the
 * real `Chats.svelte` run over a real `$state` `DBState.db`. MOCKED: the database accessors (re-implemented over the
 * real `DBState`), the parser, scripts, alert, util, globalApi and the other heavy imports of `modules.ts`, and
 * `ChatMessageBoundary` (a stub row that depends on the enabled-module count, re-keys on the pointers like
 * `Chat.svelte` and renders a database value).
 *
 * `moduleUpdate` keeps module-global state, so every test imports the whole graph afresh after `vi.resetModules()`.
 * Pointer sets are counted by a subscriber added after setup; its initial call is ignored.
 *
 * Labels: R = regression reproducer (must fail on the pre-change base), G = guard (passes before and after).
 */
import type * as SvelteRuntime from 'svelte'
import { get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

// The first test of a cold run transforms the whole graph (stores, modules, Chats).
vi.setConfig({ testTimeout: 90_000 })

//#region module mocks

interface MockDb {
    modules: RisuModule[]
    enabledModules: string[]
    moduleIntergration: string
    characters: CharacterShape[]
    zoomsize: number
    [key: string]: unknown
}

interface CharacterShape {
    chaId: string
    type: 'character'
    name: string
    image: string
    chatPage: number
    chats: Array<{ id: string, modules: string[], message: unknown[] }>
    customscript: unknown[]
}

const h = vi.hoisted(() => ({
    // Set right after the real stores load; the accessors below read the real `DBState` through it.
    deps: null as null | { state: { db: unknown }, selectedCharID: Writable<number> },
    // Calls of the mocked script cache reset, in order with the other recorded events.
    events: [] as string[],
    // Runs inside the mocked script cache reset, to read state at that moment.
    onScriptReset: null as null | (() => void),
}))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text),
    assetRegex: /{{asset:[^}]+}}/g,
    ParseMarkdown: vi.fn(async () => 'parsed'),
    addMetadataToElement: vi.fn((html: string) => html),
    postTranslationParse: vi.fn((html: string) => html),
    trimMarkdown: vi.fn((html: string) => html),
    getDistance: vi.fn(() => 0),
    applyMarkdownToNode: vi.fn(),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
    waitForTranslatorModules: vi.fn(async () => {}),
    translateHTML: vi.fn(async (html: string) => html),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScriptFull: vi.fn(async (_char: unknown, data: string) => ({ data, emoChanged: false })),
    resetScriptCache: vi.fn(() => { h.events.push('resetScriptCache'); h.onScriptReset?.() }),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/moduleEnsure'), async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/process/moduleEnsure')>()),
    ensureSelectedModules: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), update: vi.fn(), subscribe: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => {
    const emptyDb = { modules: [], enabledModules: [], moduleIntergration: '', characters: [] }
    const db = () => (h.deps ? h.deps.state.db : emptyDb) as MockDb
    const getCurrentCharacter = () => {
        if (!h.deps) {
            return undefined
        }
        return db().characters[get(h.deps.selectedCharID)]
    }
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats[char.chatPage]
    }
    return {
        appVer: '1234.5.67',
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        getDatabase: vi.fn(db),
        setCurrentCharacter: vi.fn(),
        setDatabase: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    AssetSourceChangedError: class extends Error {},
    chatFoldedStateMessageIndex: { index: -1 },
    downloadFile: vi.fn(),
    forageStorage: {},
    getFileSrc: vi.fn(async () => ''),
    LocalWriter: class {},
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    saveAssetFromPieces: vi.fn(),
    VirtualWriter: class {},
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(() => false),
    selectFileByDom: vi.fn(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))
vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(),
}) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(),
    encodeRPack: vi.fn(),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))
vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))
vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(),
    importCharacterProcess: vi.fn(),
    preflightCardExport: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock('./ChatMessageBoundary.svelte', async () => ({
    default: (await import('./ChatsLivenessRowStub.svelte')).default,
}))

//#endregion

//#region rig

interface Rig {
    stores: typeof import('src/ts/stores.svelte')
    Chats: typeof import('./Chats.svelte').default
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// The Svelte runtime is re-imported with the rest of the graph: components built after `vi.resetModules()` belong to
// the new runtime copy, and only that copy's `flushSync` runs their effects.
let runtime: typeof SvelteRuntime
const flush = (): void => runtime.flushSync()

async function settle(): Promise<void> {
    flush()
    await sleep(20)
    flush()
}

const mounted: Array<{ instance: Record<string, unknown>, target: HTMLElement }> = []

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await runtime.unmount(instance as never).catch(() => {})
        target.remove()
    }
    document.body.replaceChildren()
})

/** Imports the stores before `Chats`, so the module effect's root precedes the app root in a flush. */
async function freshRig(): Promise<Rig> {
    h.deps = null
    h.events.length = 0
    h.onScriptReset = null
    vi.resetModules()
    runtime = await import('svelte')
    const stores = await import('src/ts/stores.svelte')
    h.deps = { state: stores.DBState, selectedCharID: stores.selectedCharID }
    stores.DBState.db = { modules: [], enabledModules: [], moduleIntergration: '', characters: [] } as unknown as Database
    const Chats = (await import('./Chats.svelte')).default
    return { stores, Chats }
}

const ROWS = 5

const regexModule = (id: string): RisuModule => ({
    name: id,
    description: '',
    id,
    regex: [{ comment: 'r', in: 'a', out: 'b', type: 'editdisplay', flag: 'g', ableFlag: true }],
})

function installDb(rig: Rig): CharacterShape {
    const character: CharacterShape = {
        chaId: 'c0',
        type: 'character',
        name: 'c0',
        image: '',
        chatPage: 0,
        chats: [{ id: 'c0-chat0', modules: [], message: [] }],
        customscript: [],
    }
    rig.stores.DBState.db = {
        zoomsize: 100,
        modules: [regexModule('X')],
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
        characters: [character],
    } as unknown as Database
    rig.stores.selectedCharID.set(0)
    flush()
    return character
}

const live = (rig: Rig) => rig.stores.DBState.db as unknown as MockDb

function mountChats(rig: Rig): HTMLElement {
    const messages = Array.from({ length: ROWS }, (_, i) => ({ role: i % 2 ? 'user' : 'char', data: `m${i}`, chatId: `id${i}` }))
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = runtime.mount(rig.Chats as never, {
        target,
        props: {
            messages,
            currentCharacter: live(rig).characters[0],
            onReroll: () => {},
            unReroll: () => {},
            currentUsername: 'u',
            userIcon: '',
            loadPages: 30,
        },
    }) as Record<string, unknown>
    mounted.push({ instance, target })
    flush()
    return target
}

function rowTexts(target: HTMLElement): string[] {
    return Array.from(target.querySelectorAll('.liveness-row')).map((el) => el.textContent ?? '')
}

interface PointerWatch {
    count: () => number
    last: () => unknown
}

/** Counts `ReloadChatPointer` notifications from now on; the subscriber's own initial call is ignored. */
function watchChatPointer(rig: Rig): PointerWatch {
    let sets = 0
    let first = true
    let last: unknown = undefined
    rig.stores.ReloadChatPointer.subscribe((value) => {
        if (first) {
            first = false
            return
        }
        sets += 1
        last = value
        h.events.push('chatPointer')
    })
    return { count: () => sets, last: () => last }
}

//#endregion

describe('F1 a GUI bump on an empty chat-pointer map', () => {
    test('regression reproducer: T30 rows still follow a later change after the in-flush GUI bump of a global enable', async () => {
        const rig = await freshRig()
        installDb(rig)
        const target = mountChats(rig)
        await settle()
        expect(rowTexts(target)).toEqual(Array(ROWS).fill('100'))

        live(rig).enabledModules.push('X')
        await settle()

        live(rig).zoomsize = 150
        await settle()

        expect(rowTexts(target), 'row texts after a later unrelated change').toEqual(Array(ROWS).fill('150'))
    })

    test('regression reproducer: T31a a GUI bump with an empty map notifies no chat-pointer subscriber', async () => {
        const rig = await freshRig()
        const watch = watchChatPointer(rig)
        expect(get(rig.stores.ReloadChatPointer)).toEqual({})

        rig.stores.ReloadGUIPointer.update((n) => n + 1)

        expect(watch.count()).toBe(0)
    })

    test('guard: T31b a GUI bump with a non-empty map runs the hooks, resets it to {}, then resets the script cache', async () => {
        const rig = await freshRig()
        const { registerGuiReloadHook } = await import('src/ts/guiReloadHooks')
        registerGuiReloadHook(() => { h.events.push('hook') })
        rig.stores.ReloadChatPointer.set({ 2: 1 })
        const watch = watchChatPointer(rig)
        h.events.length = 0
        let mapAtScriptReset: unknown = undefined
        h.onScriptReset = () => { mapAtScriptReset = get(rig.stores.ReloadChatPointer) }

        rig.stores.ReloadGUIPointer.update((n) => n + 1)

        expect(watch.count()).toBe(1)
        expect(watch.last()).toEqual({})
        expect(mapAtScriptReset, 'map when the script cache reset ran').toEqual({})
        expect(h.events[0]).toBe('hook')
        expect(h.events.indexOf('hook')).toBeLessThan(h.events.indexOf('resetScriptCache'))
    })
})
