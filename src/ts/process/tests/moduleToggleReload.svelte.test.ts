// @vitest-environment jsdom

/**
 * Toggling a module that cannot change what the chat shows must not set `ReloadGUIPointer`; toggling one that can
 * must set it exactly once. The real `stores.svelte.ts` (its module `$effect`), `modules.ts` (`moduleUpdate`),
 * `moduleUpdateDeps`, `moduleRefList`, `moduleRefs`, `moduleGuiBump`, `ModuleChatMenu.svelte`, `ChatBody.svelte`
 * (inside a host keyed like Chat.svelte) and `BackgroundDom.svelte` run over a real `$state` `DBState.db`. MOCKED:
 * the database accessors (re-implemented over the real `DBState`), the parser (a call counter), the translator,
 * scripts, alert, util, globalApi and the other heavy imports of `modules.ts`, and `ensureSelectedModules` (a spy).
 *
 * `moduleUpdate` keeps module-global state, so every test imports the whole graph afresh after `vi.resetModules()`.
 * Pointer sets are counted by a subscriber added after setup; its initial call is ignored. Parse counts are
 * `ParseMarkdown` calls of the mounted `ChatBody`.
 *
 * Labels: R = regression reproducer (must fail on the pre-change base), G = guard (passes before and after).
 * "store write" means a write of the DB state without the menu handler, as a plugin or the Settings page writes it.
 */
import type * as SvelteRuntime from 'svelte'
import { get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { toAssetList } from 'src/ts/storage/assetList'
import { moduleStubOf } from 'src/ts/storage/store2/moduleStubMatch'
import type { ModuleEntry } from 'src/ts/storage/store2/format/types'
import type { RisuModule } from '../modules'

// The first test of a cold run transforms the whole graph (stores, modules, ChatBody, BackgroundDom).
vi.setConfig({ testTimeout: 90_000 })

//#region module mocks

interface MockDb {
    modules: RisuModule[]
    enabledModules: string[]
    moduleIntergration: string
    characters: CharacterShape[]
    [key: string]: unknown
}

interface CharacterShape {
    chaId: string
    type: 'character'
    name: string
    chatPage: number
    chats: Array<{ id: string, modules: string[], message: unknown[] }>
    modules?: string[]
    backgroundHTML?: string
    customscript: unknown[]
}

const h = vi.hoisted(() => ({
    // Set right after the real stores load; the accessors below read the real `DBState` through it.
    deps: null as null | { state: { db: unknown }, selectedCharID: Writable<number> },
    parseMarkdown: vi.fn(async (..._args: unknown[]) => 'parsed'),
    chatParser: vi.fn((text: string) => text),
    ensureSpy: vi.fn(),
}))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: h.chatParser,
    assetRegex: /{{asset:[^}]+}}/g,
    ParseMarkdown: h.parseMarkdown,
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
    resetScriptCache: vi.fn(),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/moduleEnsure'), async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/process/moduleEnsure')>()),
    ensureSelectedModules: h.ensureSpy,
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
    downloadFile: vi.fn(),
    forageStorage: {},
    getFileSrc: vi.fn(async () => ''),
    LocalWriter: class {},
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    saveAssetFromPieces: vi.fn(),
    VirtualWriter: class {},
}) as unknown as typeof import('src/ts/globalApi.svelte'))

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

//#endregion

//#region rig

interface Rig {
    stores: typeof import('src/ts/stores.svelte')
    modules: typeof import('../modules')
    bump: typeof import('../moduleGuiBump')
    Menu: typeof import('src/lib/Setting/Pages/Module/ModuleChatMenu.svelte').default
    Host: typeof import('./ModuleToggleReloadHarness.svelte').default
    Background: typeof import('src/lib/ChatScreens/BackgroundDom.svelte').default
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// The Svelte runtime is re-imported with the rest of the graph: components and stores built after `vi.resetModules()`
// belong to the new runtime copy, and only that copy's `flushSync` runs their effects.
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

/**
 * Imports the whole graph afresh. Until the new stores are wired, the mocked accessors return the empty database,
 * so the first effect run of the fresh graph sees no previous test's database.
 */
async function freshRig(): Promise<Rig> {
    h.deps = null
    vi.resetModules()
    runtime = await import('svelte')
    h.parseMarkdown.mockClear()
    h.chatParser.mockClear()
    h.ensureSpy.mockClear()
    const stores = await import('src/ts/stores.svelte')
    // Same synchronous step as the store import: from here on the mocked accessors read this graph's DBState.
    h.deps = { state: stores.DBState, selectedCharID: stores.selectedCharID }
    stores.DBState.db = { modules: [], enabledModules: [], moduleIntergration: '', characters: [] } as unknown as Database
    const modules = await import('../modules')
    const bump = await import('../moduleGuiBump')
    const Menu = (await import('src/lib/Setting/Pages/Module/ModuleChatMenu.svelte')).default
    const Host = (await import('./ModuleToggleReloadHarness.svelte')).default
    const Background = (await import('src/lib/ChatScreens/BackgroundDom.svelte')).default
    return { stores, modules, bump, Menu, Host, Background }
}

interface CharSpec {
    chaId: string
    /** The `modules` list of each chat. */
    chats: string[][]
    chatPage?: number
    /** Left absent when undefined, as a character that never had a long-press toggle. */
    modules?: string[]
    backgroundHTML?: string
}

interface DbSpec {
    modules: RisuModule[]
    enabled?: string[]
    characters: CharSpec[]
    selected?: number
}

function characterOf(spec: CharSpec): CharacterShape {
    const character: CharacterShape = {
        chaId: spec.chaId,
        type: 'character',
        name: spec.chaId,
        chatPage: spec.chatPage ?? 0,
        chats: spec.chats.map((modules, i) => ({ id: `${spec.chaId}-chat${i}`, modules: [...modules], message: [] })),
        customscript: [],
    }
    if (spec.modules !== undefined) {
        character.modules = [...spec.modules]
    }
    if (spec.backgroundHTML !== undefined) {
        character.backgroundHTML = spec.backgroundHTML
    }
    return character
}

/** Installs a database and selects a character; the first module effect run happens here, before any count starts. */
function installDb(rig: Rig, spec: DbSpec): void {
    rig.stores.DBState.db = {
        translatorType: 'google',
        translator: 'ko',
        translatorInputLanguage: 'en',
        aiModel: 'gpt',
        autoTranslate: false,
        autoTranslateCachedOnly: false,
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        showTranslationLoading: false,
        newImageHandlingBeta: false,
        zoomsize: 100,
        modules: spec.modules,
        enabledModules: spec.enabled ?? [],
        moduleIntergration: '',
        personas: [],
        characters: spec.characters.map(characterOf),
    } as unknown as Database
    rig.stores.selectedCharID.set(spec.selected ?? 0)
    flush()
}

const live = (rig: Rig) => rig.stores.DBState.db as unknown as MockDb

interface PointerWatch {
    count: () => number
    reset: () => void
}

/** Counts pointer sets from now on; the subscriber's own initial call is ignored. */
function watchPointer(rig: Rig): PointerWatch {
    let sets = 0
    let first = true
    rig.stores.ReloadGUIPointer.subscribe(() => {
        if (first) {
            first = false
            return
        }
        sets += 1
    })
    return { count: () => sets, reset: () => { sets = 0 } }
}

function mountInto(component: unknown, props: Record<string, unknown> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = runtime.mount(component as never, { target, props }) as Record<string, unknown>
    mounted.push({ instance, target })
    flush()
    return target
}

/** The menu's toggle button of the row named `name` (the last button of the row). */
function toggleButton(menu: HTMLElement, name: string): HTMLButtonElement {
    const row = (Array.from(menu.querySelectorAll('div.pl-3.py-3')) as HTMLElement[])
        .find((r) => r.querySelector('span')?.textContent?.trim() === name)
    if (!row) {
        throw new Error(`No menu row named ${name}`)
    }
    const buttons = row.querySelectorAll('button')
    return buttons[buttons.length - 1] as HTMLButtonElement
}

function tap(menu: HTMLElement, name: string): void {
    toggleButton(menu, name).click()
    flush()
}

function longPress(menu: HTMLElement, name: string): void {
    toggleButton(menu, name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    flush()
}

// Store writes: the same writes without the menu handler.
function chatListOf(rig: Rig, char = 0, chat = 0): string[] {
    return live(rig).characters[char].chats[chat].modules
}

function addToChat(rig: Rig, id: string, char = 0, chat = 0): void {
    chatListOf(rig, char, chat).push(id)
    live(rig).characters[char].chats[chat].modules = chatListOf(rig, char, chat)
    flush()
}

function removeFromChat(rig: Rig, id: string, char = 0, chat = 0): void {
    const list = chatListOf(rig, char, chat)
    list.splice(list.indexOf(id), 1)
    live(rig).characters[char].chats[chat].modules = list
    flush()
}

function addToGlobal(rig: Rig, id: string): void {
    live(rig).enabledModules.push(id)
    live(rig).enabledModules = live(rig).enabledModules
    flush()
}

function removeFromGlobal(rig: Rig, id: string): void {
    const list = live(rig).enabledModules
    list.splice(list.indexOf(id), 1)
    live(rig).enabledModules = list
    flush()
}

//#endregion

//#region fixtures

type RegexEntry = NonNullable<RisuModule['regex']>[number]
type LoreEntry = NonNullable<RisuModule['lorebook']>[number]
type TriggerEntry = NonNullable<RisuModule['trigger']>[number]

/** Shape A: what the Settings page writes for a new module. */
function shapeA(id: string): RisuModule {
    return { name: id, description: '', id }
}

/** Shape B: the loaded body of a `.bin` module with empty body lists; the loader converts `assets` with `toAssetList`. */
function shapeB(id: string): RisuModule {
    return { ...shapeA(id), lorebook: [], regex: [], trigger: [], assets: toAssetList([]) }
}

const regexEntry = (type: RegexEntry['type']): RegexEntry => ({ comment: 'r', in: 'a', out: 'b', type, flag: 'g', ableFlag: true })
const loreEntry: LoreEntry = { key: 'k', secondkey: '', insertorder: 100, comment: 'c', content: 'x', mode: 'normal', alwaysActive: false, selective: false }
const triggerEntry: TriggerEntry = { comment: 't', type: 'manual', conditions: [], effect: [] }

const withRegex = (id: string, type: RegexEntry['type'] = 'editdisplay'): RisuModule => ({ ...shapeA(id), regex: [regexEntry(type)] })

function stubOf(id: string): RisuModule {
    const entry: ModuleEntry = {
        id, name: id, description: '', unit: ['u-' + id, 10, 1, 1], al: ['a-' + id, 5, 2, 3], il: null, hasToggle: false, dsp: false,
    }
    return moduleStubOf(entry) as unknown as RisuModule
}

const oneChar = (over: Partial<CharSpec> = {}): CharSpec[] => [{ chaId: 'c0', chats: [[]], ...over }]

//#endregion

describe('R1 an inert module toggled in the chat menu sets no pointer (tap)', () => {
    test.each([['A', shapeA], ['B', shapeB]] as const)('regression reproducer: R1%s tap add and remove set the pointer 0 times and rebuild no body', async (_label, make) => {
        const rig = await freshRig()
        installDb(rig, { modules: [make('X')], characters: oneChar() })
        const menu = mountInto(rig.Menu)
        mountInto(rig.Host)
        await settle()
        const sets = watchPointer(rig)
        const parsesBefore = h.parseMarkdown.mock.calls.length

        tap(menu, 'X')
        await settle()
        expect(chatListOf(rig)).toEqual(['X'])
        expect(sets.count(), 'pointer sets by the add').toBe(0)
        expect(h.parseMarkdown.mock.calls.length - parsesBefore, 'body parses after the add').toBe(0)

        sets.reset()
        tap(menu, 'X')
        await settle()
        expect(chatListOf(rig)).toEqual([])
        expect(sets.count(), 'pointer sets by the remove').toBe(0)
        expect(h.parseMarkdown.mock.calls.length - parsesBefore, 'body parses after the remove').toBe(0)
    })

    test('guard: an affecting toggle remounts the body (the parse counter sees a rebuild)', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [withRegex('X')], characters: oneChar() })
        const menu = mountInto(rig.Menu)
        mountInto(rig.Host)
        await settle()
        const parsesBefore = h.parseMarkdown.mock.calls.length

        tap(menu, 'X')
        await settle()

        expect(h.parseMarkdown.mock.calls.length - parsesBefore).toBeGreaterThanOrEqual(1)
    })
})

describe('R2 an inert module long-pressed in the chat menu sets no pointer', () => {
    test('regression reproducer: R2 long-press add and remove, character.modules absent at start, set the pointer 0 times', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [shapeA('X')], characters: oneChar() })
        const menu = mountInto(rig.Menu)
        await settle()
        expect(live(rig).characters[0].modules).toBeUndefined()
        const sets = watchPointer(rig)

        longPress(menu, 'X')
        await settle()
        expect(live(rig).characters[0].modules).toEqual(['X'])
        expect(sets.count(), 'pointer sets by the add').toBe(0)

        sets.reset()
        longPress(menu, 'X')
        await settle()
        expect(live(rig).characters[0].modules).toEqual([])
        expect(sets.count(), 'pointer sets by the remove').toBe(0)
    })
})

describe('R3 an inert module toggled by the Settings global list sets no pointer', () => {
    test('regression reproducer: R3 enabledModules push and splice with reassignment set the pointer 0 times', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [shapeA('X')], characters: oneChar() })
        const sets = watchPointer(rig)

        addToGlobal(rig, 'X')
        expect(sets.count(), 'pointer sets by the add').toBe(0)
        removeFromGlobal(rig, 'X')
        expect(sets.count(), 'pointer sets by the add and the remove').toBe(0)
    })
})

describe('R4 R5 an affecting module sets the pointer exactly once through the menu', () => {
    test('regression reproducer: R4 a regex module tapped in sets it 1 time', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [withRegex('X')], characters: oneChar() })
        const menu = mountInto(rig.Menu)
        await settle()
        const sets = watchPointer(rig)

        tap(menu, 'X')
        await settle()

        expect(sets.count(), 'pointer sets by the add').toBe(1)
    })

    test('regression reproducer: R5 a regex module long-pressed in, character.modules absent at start, sets it 1 time', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [withRegex('X')], characters: oneChar() })
        const menu = mountInto(rig.Menu)
        await settle()
        expect(live(rig).characters[0].modules).toBeUndefined()
        const sets = watchPointer(rig)

        longPress(menu, 'X')
        await settle()

        expect(sets.count(), 'pointer sets by the add').toBe(1)
    })
})

describe('R6 R7 modules that only feed a store set no pointer', () => {
    test('regression reproducer: R6 a hideIcon-only module added and removed sets the pointer 0 times', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [{ ...shapeA('X'), hideIcon: true }], characters: oneChar() })
        const sets = watchPointer(rig)

        addToChat(rig, 'X')
        expect(sets.count(), 'pointer sets by the add').toBe(0)
        removeFromChat(rig, 'X')
        expect(sets.count(), 'pointer sets by the add and the remove').toBe(0)
    })

    test('guard: R6 the hide-icon store follows a hideIcon-only module', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [{ ...shapeA('X'), hideIcon: true }], characters: oneChar() })
        expect(get(rig.stores.HideIconStore)).toBe(false)

        addToChat(rig, 'X')
        expect(get(rig.stores.HideIconStore)).toBe(true)
        removeFromChat(rig, 'X')
        expect(get(rig.stores.HideIconStore)).toBe(false)
    })

    test('regression reproducer: R7 an embedding-only module added sets the pointer 0 times', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [{ ...shapeA('X'), backgroundEmbedding: '<style>.e{}</style>' }], characters: oneChar() })
        const sets = watchPointer(rig)

        addToChat(rig, 'X')

        expect(sets.count(), 'pointer sets by the add').toBe(0)
    })

    test('guard: R7 the embedding reaches its store and the mounted background parse', async () => {
        const rig = await freshRig()
        installDb(rig, {
            modules: [{ ...shapeA('X'), backgroundEmbedding: '<style>.e{}</style>' }],
            characters: oneChar({ backgroundHTML: 'CARD' }),
        })
        mountInto(rig.Background)
        await settle()

        addToChat(rig, 'X')
        await settle()

        expect(get(rig.stores.moduleBackgroundEmbedding)).toContain('<style>.e{}</style>')
        expect(h.chatParser.mock.calls.some((call) => String(call[0]).includes('<style>.e{}</style>'))).toBe(true)
    })
})

describe('R8 a removal that leaves the referenced set unchanged sets no pointer', () => {
    test('regression reproducer: R8 a regex module on the chat and the character, tap removed from the chat, sets the pointer 0 times', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [withRegex('X')], characters: oneChar({ chats: [['X']], modules: ['X'] }) })
        const menu = mountInto(rig.Menu)
        await settle()
        const sets = watchPointer(rig)

        tap(menu, 'X')
        await settle()

        expect(chatListOf(rig)).toEqual([])
        expect(sets.count(), 'pointer sets by the remove').toBe(0)
    })
})

describe('R9 a stub add', () => {
    async function stubTapped(): Promise<{ rig: Rig, sets: PointerWatch }> {
        const rig = await freshRig()
        installDb(rig, { modules: [stubOf('S')], characters: oneChar() })
        const menu = mountInto(rig.Menu)
        await settle()
        const sets = watchPointer(rig)
        tap(menu, 'S')
        await settle()
        return { rig, sets }
    }

    /** What the loader does on install: replace the slot, drop the memo, announce once. */
    function install(rig: Rig, body: RisuModule): void {
        live(rig).modules[0] = body
        rig.modules.refreshModules()
        rig.bump.bumpModuleGui()
        flush()
    }

    test('regression reproducer: R9 a stub tap plus its install set the pointer 2 times in total', async () => {
        const { rig, sets } = await stubTapped()
        expect(sets.count(), 'pointer sets by the stub add').toBe(1)

        install(rig, shapeB('S'))
        await settle()

        expect(sets.count(), 'pointer sets by the add and the install').toBe(2)
    })

    test('guard: R9 the install after a stub add sets the pointer exactly once more', async () => {
        const { rig, sets } = await stubTapped()
        sets.reset()

        install(rig, shapeB('S'))
        await settle()

        expect(sets.count()).toBe(1)
    })
})

describe('R10 R11 R12 the first inert toggle after a switch or boot sets no pointer', () => {
    test('regression reproducer: R10 first inert tap after a same-ids chat switch sets the pointer 0 times', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [shapeA('G'), shapeB('X')], enabled: ['G'], characters: oneChar({ chats: [[], []] }) })
        const menu = mountInto(rig.Menu)
        await settle()
        const sets = watchPointer(rig)

        live(rig).characters[0].chatPage = 1
        flush()
        expect(sets.count(), 'pointer sets by the switch').toBe(0)

        tap(menu, 'X')
        await settle()

        expect(chatListOf(rig, 0, 1)).toEqual(['X'])
        expect(sets.count(), 'pointer sets by the add').toBe(0)
    })

    test('regression reproducer: R11 first inert tap after a boot with nothing referenced sets the pointer 0 times', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [shapeA('X')], characters: oneChar() })
        const menu = mountInto(rig.Menu)
        await settle()
        const sets = watchPointer(rig)

        tap(menu, 'X')
        await settle()

        expect(chatListOf(rig)).toEqual(['X'])
        expect(sets.count(), 'pointer sets by the add').toBe(0)
    })

    test('regression reproducer: R12 first inert long press after a same-ids character switch sets the pointer 0 times', async () => {
        const rig = await freshRig()
        installDb(rig, {
            modules: [shapeA('G'), shapeA('X')],
            enabled: ['G'],
            characters: [{ chaId: 'P', chats: [[]] }, { chaId: 'Q', chats: [[]] }],
            selected: 0,
        })
        const menu = mountInto(rig.Menu)
        await settle()
        const sets = watchPointer(rig)

        rig.stores.selectedCharID.set(1)
        flush()
        expect(sets.count(), 'pointer sets by the switch').toBe(0)

        longPress(menu, 'X')
        await settle()

        expect(live(rig).characters[1].modules).toEqual(['X'])
        expect(sets.count(), 'pointer sets by the add').toBe(0)
    })
})

describe('G1-G8 G17 a change that can alter the display sets the pointer exactly once (store write)', () => {
    const cases: Array<[string, () => RisuModule]> = [
        ['G1 regex (editprocess only)', () => withRegex('X', 'editprocess')],
        ['G2 lorebook', () => ({ ...shapeA('X'), lorebook: [loreEntry] })],
        ['G3 trigger', () => ({ ...shapeA('X'), trigger: [triggerEntry] })],
        ['G4 assets', () => ({ ...shapeA('X'), assets: toAssetList([['n', 'p', 'png']]) })],
        ['G5 namespace only', () => ({ ...shapeA('X'), namespace: 'ns1' })],
        ['G6 customModuleToggle only', () => ({ ...shapeA('X'), customModuleToggle: '<toggle>' })],
        ['G7 an unknown field', () => ({ ...shapeA('X'), futureField: 'x' } as RisuModule)],
    ]

    test.each(cases)('guard: %s add', async (_label, make) => {
        const rig = await freshRig()
        installDb(rig, { modules: [make()], characters: oneChar() })
        const sets = watchPointer(rig)

        addToChat(rig, 'X')

        expect(sets.count()).toBe(1)
    })

    test('guard: G8 a stub removed sets the pointer 1 time', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [stubOf('S')], characters: oneChar({ chats: [['S']] }) })
        const sets = watchPointer(rig)

        removeFromChat(rig, 'S')

        expect(sets.count()).toBe(1)
    })

    test('guard: G17 a namespace reference to a namespaced row sets the pointer 1 time', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [{ ...shapeA('X'), namespace: 'ns1' }], characters: oneChar() })
        const sets = watchPointer(rig)

        addToChat(rig, 'ns1')

        expect(sets.count()).toBe(1)
    })
})

describe('G9-G15 G18 the predicate follows the current rows and the selection', () => {
    test('guard: G9 an in-place regex push into an enabled inert module re-runs no effect and sets no pointer', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [shapeB('X')], characters: oneChar() })
        addToChat(rig, 'X')
        await settle()
        const sets = watchPointer(rig)
        const effectRuns = h.ensureSpy.mock.calls.length

        live(rig).modules[0].regex?.push(regexEntry('editdisplay'))
        await settle()

        expect(h.ensureSpy.mock.calls.length).toBe(effectRuns)
        expect(sets.count()).toBe(0)
    })

    test('guard: G10 an inert module that became affecting in place sets the pointer 1 time on removal', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [shapeB('X')], characters: oneChar() })
        addToChat(rig, 'X')
        live(rig).modules[0].regex = [regexEntry('editdisplay')]
        flush()
        const sets = watchPointer(rig)

        rig.stores.ReloadGUIPointer.update((n) => n + 1)
        expect(sets.count(), 'editor close').toBe(1)
        sets.reset()
        removeFromChat(rig, 'X')

        expect(sets.count(), 'pointer sets by the remove').toBe(1)
    })

    test('regression reproducer: G11 an affecting module made inert in place sets the pointer 0 times on removal', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [withRegex('X')], characters: oneChar() })
        addToChat(rig, 'X')
        live(rig).modules[0].regex = []
        flush()
        const sets = watchPointer(rig)

        rig.stores.ReloadGUIPointer.update((n) => n + 1)
        expect(sets.count(), 'editor close').toBe(1)
        sets.reset()
        removeFromChat(rig, 'X')

        expect(sets.count(), 'pointer sets by the remove').toBe(0)
    })

    test('guard: G12 an enabled inert row deleted through the Settings delete writes sets the pointer 1 time', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [shapeA('G')], enabled: ['G'], characters: oneChar() })
        const sets = watchPointer(rig)

        live(rig).modules.splice(0, 1)
        live(rig).modules = live(rig).modules
        live(rig).enabledModules.splice(0, 1)
        live(rig).enabledModules = live(rig).enabledModules
        flush()

        expect(sets.count()).toBe(1)
    })

    test('guard: G13 removing an id held by an inert row and a later regex row sets the pointer 1 time', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [shapeA('D'), withRegex('D')], characters: oneChar() })
        addToChat(rig, 'D')
        const sets = watchPointer(rig)

        removeFromChat(rig, 'D')

        expect(sets.count()).toBe(1)
    })

    test('guard: G14 a whole-list replacement reordering two enabled inert rows sets the pointer 1 time', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [shapeA('A'), shapeA('B')], enabled: ['A', 'B'], characters: oneChar() })
        const sets = watchPointer(rig)

        live(rig).modules = [shapeA('B'), shapeA('A')]
        flush()

        expect(sets.count()).toBe(1)
    })

    test('guard: G15 a chat switch whose lists differ by one inert module sets the pointer 1 time', async () => {
        const rig = await freshRig()
        installDb(rig, { modules: [shapeA('X')], characters: oneChar({ chats: [[], ['X']] }) })
        const sets = watchPointer(rig)

        live(rig).characters[0].chatPage = 1
        flush()

        expect(sets.count()).toBe(1)
    })

    test('guard: G18 a character switch (both at chatPage 0) whose lists differ by one inert module sets the pointer 1 time', async () => {
        const rig = await freshRig()
        installDb(rig, {
            modules: [shapeA('X')],
            characters: [{ chaId: 'P', chats: [[]] }, { chaId: 'Q', chats: [['X']] }],
        })
        const sets = watchPointer(rig)

        rig.stores.selectedCharID.set(1)
        flush()

        expect(sets.count()).toBe(1)
    })
})
