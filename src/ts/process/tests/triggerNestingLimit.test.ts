/**
 * How deep a trigger run may nest runs of other triggers.
 *
 * Drives the REAL `runTrigger` (`../triggers`) and the REAL command line
 * (`../command`, for `/trigger`) over a plain in-memory database and the real
 * run-origin machinery (`../chatOrigin`). The CBS parser is an identity
 * stand-in, the model call, Lua and every other heavy collaborator are stubbed.
 *
 * Every trigger here is a manual trigger that increments the chat variable `n`
 * and then runs itself, gated by the condition `n < STOP`. A run that nests
 * runs of itself therefore ends either at the nesting limit or, when none
 * applies, at `STOP` -- which is set far enough above the limit to tell the
 * two apart, and low enough for the run to terminate regardless.
 *
 * Run number `k` of the chain starts with a recursion count of `k`, increments
 * `n` to `k + 1` and starts run `k + 1` only while `k` is below the limit. So
 * `n` ends at `limit + 1`: runs `0..limit` all execute.
 *
 * Tests whose title starts with `guard:` pin behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeAll } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { character } from 'src/ts/storage/database.svelte'
import 'src/ts/polyfill'

//#region module mocks

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({ markCharacterForSave: vi.fn() }) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
    selectedCharID: writable(-1),
    selIdState: { selId: 0 },
    ReloadChatPointer: writable({} as Record<number, number>),
    ReloadGUIPointer: writable(0),
    CurrentTriggerIdStore: writable(null),
    HideIconStore: writable(false),
    moduleBackgroundEmbedding: writable(''),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertMd: vi.fn(), alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''), alertConfirm: vi.fn(async () => true), alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const live = stores.DBState as unknown as { db: { characters: Array<{ chatPage: number, chats: unknown[] }> } }
    const currentCharacter = () => live.db.characters[get(stores.selectedCharID)]
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => live.db),
        getCurrentCharacter: vi.fn(() => currentCharacter()),
        getCurrentChat: vi.fn(() => { const c = currentCharacter(); return c?.chats?.[c.chatPage] }),
        setCurrentChat: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/util'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const live = stores.DBState as unknown as { db: { characters: Array<{ chaId?: string, type?: string }> } }
    return {
        findCharacterbyId: (id: string) => live.db.characters.find((c) => c.type !== 'group' && c.chaId === id) ?? { name: 'Unknown Character' },
        parseKeyValue: (template: string) => {
            if (!template) return []
            const kv: [string, string][] = []
            for (const line of template.split('\n')) {
                const [key, value] = line.split('=')
                if (key && value) kv.push([key, value])
            }
            return kv
        },
        sleep: vi.fn(async () => {}),
        getUserName: vi.fn(() => 'User'),
        getPersonaPrompt: vi.fn(() => ''),
        getUserIcon: vi.fn(() => ''),
        checkPersonaBinded: vi.fn(() => false),
        pickHashRand: vi.fn(() => 0.5),
        replaceAsync: vi.fn(),
        asBuffer: vi.fn(),
        selectSingleFile: vi.fn(),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/parser/chatML'), () => ({ parseChatML: vi.fn(() => []) }) as unknown as typeof import('src/ts/parser/chatML'))
vi.mock(import('src/ts/cbs'), () => ({ promptViewOfMessages: vi.fn() }) as unknown as typeof import('src/ts/cbs'))
vi.mock(import('src/ts/tokenizer'), () => ({ tokenize: vi.fn(async () => 1) }) as unknown as typeof import('src/ts/tokenizer'))
vi.mock(import('src/ts/process/modules'), () => ({ getModuleTriggers: vi.fn(() => []) }) as unknown as typeof import('src/ts/process/modules'))
vi.mock(import('src/ts/process/memory/hypamemory'), () => ({ HypaProcesser: class {} }) as unknown as typeof import('src/ts/process/memory/hypamemory'))
vi.mock(import('src/ts/process/request/request'), () => ({ requestChatData: vi.fn() }) as unknown as typeof import('src/ts/process/request/request'))
vi.mock(import('src/ts/process/stableDiff'), () => ({ generateAIImage: vi.fn() }) as unknown as typeof import('src/ts/process/stableDiff'))
vi.mock(import('src/ts/process/files/inlays'), () => ({ writeInlayImage: vi.fn() }) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/process/scriptings'), () => ({ runScripted: vi.fn() }) as unknown as typeof import('src/ts/process/scriptings'))
vi.mock(import('src/ts/process/infunctions'), () => ({ calcString: vi.fn() }) as unknown as typeof import('src/ts/process/infunctions'))
vi.mock(import('src/ts/process/tts'), () => ({ sayTTS: vi.fn() }) as unknown as typeof import('src/ts/process/tts'))
vi.mock(import('src/ts/chatCopy'), () => ({ stripThoughtsForCopy: vi.fn((s: string) => s) }) as unknown as typeof import('src/ts/chatCopy'))
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: writable(false), sendChat: vi.fn() }) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock(import('src/ts/process/lorebook.svelte'), () => ({ loadLoreBookV3Prompt: vi.fn() }) as unknown as typeof import('src/ts/process/lorebook.svelte'))
vi.mock(import('src/ts/process/generationOwnership.svelte'), () => ({ isComposerWindowOpen: vi.fn(() => false) }) as unknown as typeof import('src/ts/process/generationOwnership.svelte'))

//#endregion

//#region fixtures

type Fixture = Record<string, unknown>

let runTrigger: typeof import('src/ts/process/triggers').runTrigger
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let LOW_LEVEL_NESTED_TRIGGER_LIMIT: number
let NORMAL_NESTED_TRIGGER_LIMIT: number

beforeAll(async () => {
    runTrigger = (await import('src/ts/process/triggers')).runTrigger
    const stores = await import('src/ts/stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    const limits = await import('src/ts/process/triggerLimits')
    LOW_LEVEL_NESTED_TRIGGER_LIMIT = limits.LOW_LEVEL_NESTED_TRIGGER_LIMIT
    NORMAL_NESTED_TRIGGER_LIMIT = limits.NORMAL_NESTED_TRIGGER_LIMIT
})

type Flavor = 'runtrigger' | 'v2RunTrigger' | '/trigger'

/** The effects of a manual trigger `self` that counts one level in `n` and then runs `self` the way `flavor` does. */
function selfCalling(flavor: Flavor, stop: number): Fixture {
    const count = flavor === 'v2RunTrigger'
        ? [{ type: 'v2SetVar', var: 'n', value: '1', valueType: 'value', operator: '+=', indent: 0 }]
        : [{ type: 'setvar', var: 'n', operator: '+=', value: '1' }]
    const call = flavor === 'runtrigger' ? { type: 'runtrigger', value: 'self' }
        : flavor === 'v2RunTrigger' ? { type: 'v2RunTrigger', target: 'self', indent: 0 }
        : { type: 'command', value: '/trigger self' }
    return {
        comment: 'self', type: 'manual', lowLevelAccess: false,
        conditions: [{ type: 'var', var: 'n', operator: '<', value: String(stop) }],
        effect: [...count, call],
    }
}

function makeChar(lowLevelAccess: boolean, trigger: Fixture): Fixture {
    return {
        chaId: 'a', name: 'Alice', type: 'character', chatPage: 0, modules: [], customscript: [], globalLore: [], defaultVariables: '',
        chats: [{ id: 'c1', note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }],
        triggerscript: [trigger], lowLevelAccess,
    }
}

/** Runs `self` as a manual trigger in a fresh chat and returns the final value of `n`. */
async function levelsReached(flavor: Flavor, lowLevelAccess: boolean, stop: number): Promise<number> {
    const A = makeChar(lowLevelAccess, selfCalling(flavor, stop))
    DBState.db = {
        characters: [A], enabledModules: [], modules: [], templateDefaultVariables: '', personas: [], selectedPersona: 0, username: 'U',
    } as unknown as Database
    selectedCharID.set(0)
    const char = DBState.db.characters[0] as character
    await runTrigger(char, 'manual', { chat: char.chats[0], origin: { chaId: 'a', chatId: 'c1' }, manualName: 'self' })
    return Number((char.chats[0].scriptstate as Record<string, string>)['$n'])
}

//#endregion

describe('a low-level trigger\'s nested runs stop at the low-level limit', () => {
    for (const flavor of ['runtrigger', 'v2RunTrigger', '/trigger'] as const) {
        test(`${flavor} nests LOW + 1 runs deep in a low-level run and no further`, async () => {
            const reached = await levelsReached(flavor, true, 3 * LOW_LEVEL_NESTED_TRIGGER_LIMIT)
            expect(reached).toBe(LOW_LEVEL_NESTED_TRIGGER_LIMIT + 1)
        })

        test(`guard: ${flavor} nests 11 runs deep in a run without low-level access and no further`, async () => {
            const reached = await levelsReached(flavor, false, 3 * LOW_LEVEL_NESTED_TRIGGER_LIMIT)
            expect(reached).toBe(NORMAL_NESTED_TRIGGER_LIMIT + 1)
            expect(reached).toBe(11)
        })
    }
})
