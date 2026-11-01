/**
 * The default `getDatabase` copy of the character list (`copyCharactersWithoutAlt` plus the `withoutAltIn`
 * pass in `v3.svelte.ts`).
 *
 * The oracle is `$state.snapshot` followed by `withoutAltIn`, the copy the plugin API made before: the output
 * must stay equal to it in value, key order and alias structure (one object reachable twice stays one object).
 * The alternatives of a chat are never read from the live chat while the copy is made.
 *
 * Over the REAL `v3.svelte.ts` (the module-mock set of `v3ChatAlt.svelte.test.ts`).
 * Test kinds: "guard:" rows pass before and after the change; "reproducer:" rows fail on the code that
 * snapshots the list and then deletes `alt`.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import type { Database, character } from '../../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins.svelte'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: (options?: { name?: string }) => ({
            getItem: vi.fn(async (key: string) => {
                // A stored recent 'db' grant keeps the database API from prompting.
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

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

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
    alertConfirm: vi.fn(async () => true),
    alertPluginConfirm: vi.fn(async () => true),
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
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
}) as unknown as typeof import('../../../process/coldstorage.svelte'))

vi.mock(import('../../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../../process/files/inlays'))

vi.mock(import('../../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../../translator/translator'))

vi.mock(import('../../../parser/parser.svelte'), () => ({
    hasher: vi.fn(async () => 'hash'),
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
import { copyCharactersWithoutAlt } from '../pluginCopy.svelte'
import { withoutAltIn } from '../../chatAltBridge'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { buildColdStub } from '../../../process/coldCharacter'

//#region fixtures

type CharacterFixture = Database['characters'][number]
type Entry = Record<string, unknown>

const PLUGIN_NAME = 'copy-test-plugin'

const makePlugin = (): RisuPlugin => ({
    name: PLUGIN_NAME,
    script: 'copy-script',
    arguments: {},
    realArg: {},
    customLink: [],
    argMeta: {},
})

const api3 = () => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

const rec = (id: string, p: string | null, a: number): Entry => ({ m: { role: 'char', data: id, chatId: id, time: a }, p, a })

/** A chat as `chatAltBridge` stores it: a path of messages and alternatives that branch off it. */
function altChat(id: string, alt: Entry[] | null): Entry {
    return {
        id,
        message: ['m1', 'm2'].map((chatId) => ({ role: 'user', data: chatId, chatId, time: 1 })),
        note: '',
        name: id,
        localLore: [],
        ...(alt ? { alt } : {}),
    }
}

function fullCharacter(chaId: string, chats: Entry[], extra: Entry = {}): Entry {
    return {
        type: 'character',
        name: `${chaId} name`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: 5000,
        desc: `${chaId} description`,
        globalLore: [{ comment: `${chaId} lore`, content: 'c', key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }],
        chats,
        ...extra,
    }
}

const withAlt = (chaId: string) => fullCharacter(chaId, [
    altChat(`${chaId}-0`, [rec('x', 'm1', 1), rec('y', 'x', 2)]),
    altChat(`${chaId}-1`, null),
    altChat(`${chaId}-2`, [rec('z', null, 3)]),
])

const group = (chaId: string, members: string[]) => ({
    type: 'group',
    name: `${chaId} name`,
    chaId,
    characters: members,
    chats: [altChat(`${chaId}-0`, [rec('g', 'm1', 1)])],
})

/** The stub as it sits in the list after load (the fields the boot-time check default-fills are present). */
function stubOf(full: Entry, key: string): Entry {
    const stub = buildColdStub(full as unknown as character, key, []) as unknown as Entry
    return Object.assign(stub, { customscript: [], firstMessage: '', globalLore: [], desc: '', viewScreen: 'none', emotionImages: [] })
}

/** A placeholder in the shape an upstream-made archive leaves. */
const legacyPlaceholder = (chaId: string): Entry => ({
    type: 'character',
    name: `${chaId} name`,
    chaId,
    chats: [],
    coldstorage: `legacy-${chaId}`,
    image: '',
})

const profiles: [string, () => Entry[]][] = [
    ['P1 resident with alternatives and a group', () => [withAlt('a'), withAlt('b'), group('g', ['a', 'b'])]],
    ['P2 fork and upstream-shape placeholders', () => [stubOf(withAlt('s'), 'unit-s'), legacyPlaceholder('old'), withAlt('c')]],
    ['P3 mixed', () => [withAlt('a'), stubOf(withAlt('s'), 'unit-s'), group('g', ['a']), legacyPlaceholder('old')]],
]

function installDb(characters: Entry[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [{ name: PLUGIN_NAME, script: '' }],
        pluginCustomStorage: {},
        lineHeight: 1.5,
        characterOrder: characters.map((c) => c.chaId as string),
        characters: characters as unknown as CharacterFixture[],
    } as unknown as Database
}

/** What `getDatabase` returned before this change, for a raw value or a live key. */
function oracleCharacters(source: unknown): unknown {
    const copy = $state.snapshot(source)
    withoutAltIn(copy as Parameters<typeof withoutAltIn>[0])
    return copy
}

/** The copy as `getDatabase` makes it: the alt-skipping copy, then the `withoutAltIn` pass. */
function copiedCharacters(source: unknown): unknown {
    const copy = copyCharactersWithoutAlt(source)
    withoutAltIn(copy as Parameters<typeof withoutAltIn>[0])
    return copy
}

/** A character-shaped instance that is copied through `toJSON`. */
class Wrapped {
    toJSON(): Entry {
        return fullCharacter('w', [altChat('w-0', [rec('x', 'm1', 1)])])
    }
}

/** An instance that is copied through `toJSON`. */
class Marker {
    toJSON(): Entry {
        return { marked: true, nested: { n: 1 } }
    }
}

/** Each repeated object as `path=firstPath`, in walk order: the alias structure of a value. */
function aliasPairs(root: unknown): string[] {
    const seen = new Map<object, string>()
    const pairs: string[] = []
    const walk = (value: unknown, path: string): void => {
        if (typeof value !== 'object' || value === null) {
            return
        }
        const first = seen.get(value)
        if (first !== undefined) {
            pairs.push(`${path}=${first}`)
            return
        }
        seen.set(value, path)
        for (const key of Object.keys(value)) {
            walk((value as Entry)[key], `${path}.${key}`)
        }
    }
    walk(root, '$')
    return pairs
}

function expectSameCopy(actual: unknown, expected: unknown): void {
    expect(actual).toEqual(expected)
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
    expect(aliasPairs(actual)).toEqual(aliasPairs(expected))
}

function altAtChatPositions(copy: unknown): string[] {
    const found: string[] = []
    const list = copy as { chats?: { alt?: unknown }[] }[]
    list.forEach((character, i) => {
        character.chats?.forEach((chat, j) => {
            if (chat && typeof chat === 'object' && 'alt' in chat) found.push(`characters[${i}].chats[${j}]`)
        })
    })
    return found
}

//#endregion

beforeEach(() => {
    selectedCharID.set(0)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the default getDatabase copy', () => {
    const requests: [string, string[] | 'all'][] = [['all', 'all'], ['characters', ['characters']], ['lineHeight', ['lineHeight']]]
    const cases = profiles.flatMap(([profile, build]) => requests.map(([label, include]) => [profile, label, build, include] as const))

    test.each(cases)('guard: %s, includeOnly %s equals the snapshot oracle in value, key order and aliases', async (_profile, _label, build, include) => {
        installDb(build())
        const live = $state.snapshot(DBState.db.characters)
        const result = await api3().getDatabase(include) as Entry

        if (include === 'all' || include.includes('characters')) {
            expectSameCopy(result.characters, oracleCharacters(DBState.db.characters))
            expect(altAtChatPositions(result.characters)).toEqual([])
        } else {
            expect(result).not.toHaveProperty('characters')
        }
        if (include === 'all' || include.includes('lineHeight')) {
            expect(result.lineHeight).toBe(1.5)
        }
        // The live list is untouched.
        expect($state.snapshot(DBState.db.characters)).toEqual(live)
    })

    test('guard: the live alternatives keep their identity and content, and the copy is owned and mutable', async () => {
        installDb([withAlt('a')])
        const liveBefore = $state.snapshot(DBState.db.characters)
        const result = await api3().getDatabase(['characters']) as { characters: { chats: { message: { data: string }[] }[] }[] }

        result.characters[0].chats[0].message[0].data = 'changed'
        result.characters.push({ chats: [] })
        expect($state.snapshot(DBState.db.characters)).toEqual(liveBefore)
        expect((DBState.db.characters[0].chats[0] as unknown as { alt: Entry[] }).alt).toHaveLength(2)
    })

    test('guard: an alt key outside characters[i].chats[j] survives, as in the oracle', async () => {
        const character = withAlt('a')
        character.alt = [{ keep: 'character top level' }]
        ;(character.globalLore as Entry[])[0].alt = ['lore entry alt']
        installDb([character])

        const result = await api3().getDatabase(['characters']) as { characters: Entry[] }

        expectSameCopy(result.characters, oracleCharacters(DBState.db.characters))
        expect(result.characters[0].alt).toEqual([{ keep: 'character top level' }])
        expect((result.characters[0].globalLore as Entry[])[0].alt).toEqual(['lore entry alt'])
    })

    test('guard: a character that reaches the copy through toJSON still loses the alt of its chats (the post-pass)', async () => {
        installDb([withAlt('a'), new Wrapped() as unknown as Entry])

        const result = await api3().getDatabase(['characters']) as { characters: Entry[] }

        expect(altAtChatPositions(result.characters)).toEqual([])
        expectSameCopy(result.characters, oracleCharacters(DBState.db.characters))
    })

    test('reproducer: the alternatives of a chat are never read from the live chat', async () => {
        let altReads = 0
        const chat = altChat('a-0', null)
        Object.defineProperty(chat, 'alt', {
            enumerable: true,
            configurable: true,
            get() {
                altReads += 1
                return [rec('x', 'm1', 1)]
            },
        })
        // Assigned as the app's setDatabase assigns it: the raw tree, the accessor kept on the proxied chat.
        installDb([fullCharacter('a', [chat])])
        flushSync()

        altReads = 0
        $state.snapshot(DBState.db.characters)
        expect(altReads).toBeGreaterThan(0)

        altReads = 0
        const result = await api3().getDatabase(['characters']) as { characters: { chats: Entry[] }[] }

        expect(altReads).toBe(0)
        expect(result.characters[0].chats[0]).not.toHaveProperty('alt')
    })
})

describe('copyCharactersWithoutAlt aliasing', () => {
    const chat = (id: string) => altChat(id, [rec('x', 'm1', 1)])

    test('guard: a chat reachable at a key before chats and at chats[0], and the reverse, matches the oracle', () => {
        const sharedBefore = chat('s')
        const sharedAfter = chat('t')
        const raw = [
            fullCharacter('a', [sharedBefore], { early: sharedBefore }),
        ]
        const reversed = [
            { ...fullCharacter('b', [sharedAfter]), late: sharedAfter },
        ]

        for (const list of [raw, reversed]) {
            const copy = copiedCharacters(list)
            expectSameCopy(copy, oracleCharacters(list))
            expect(altAtChatPositions(copy)).toEqual([])
        }
    })

    test('guard: a chats array reachable at an earlier key, and a character reachable from an earlier character, match the oracle', () => {
        const chats = [chat('c0'), chat('c1')]
        const arrayCase = [{ early: chats, ...fullCharacter('a', chats) }, fullCharacter('b', [])]

        const second = fullCharacter('q', [chat('q0')])
        const characterCase = [{ ref: second, ...fullCharacter('p', [chat('p0')]) }, second]

        for (const list of [arrayCase, characterCase]) {
            const copy = copiedCharacters(list)
            expectSameCopy(copy, oracleCharacters(list))
            expect(altAtChatPositions(copy)).toEqual([])
        }
    })

    test('guard: a toJSON instance reached at two keys of one character becomes one shared copy, as in the oracle', () => {
        const marker = new Marker()
        const list = [fullCharacter('a', [chat('c0')], { first: marker, second: marker })]

        const copy = copiedCharacters(list) as Entry[]

        expect(copy[0].first).toBe(copy[0].second)
        expectSameCopy(copy, oracleCharacters(list))
    })

    test('guard: holes, Dates, Maps and Sets copy as the oracle copies them', () => {
        const sparse: unknown[] = [1, , 3]
        const list = [fullCharacter('a', [chat('c0')], { sparse, when: new Date(1000), map: new Map([['k', 1]]), set: new Set([1]) })]

        const copy = copiedCharacters(list) as Entry[]
        const expected = oracleCharacters(list) as Entry[]

        expect(1 in (copy[0].sparse as unknown[])).toBe(false)
        expect(copy[0].when).toEqual(expected[0].when)
        expect(copy[0].map).toEqual(expected[0].map)
        expect(copy[0].set).toEqual(expected[0].set)
        expect(copy[0].when).not.toBe(list[0].when)
    })
})
