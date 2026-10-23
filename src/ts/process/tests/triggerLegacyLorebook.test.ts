/**
 * The five deprecated V2 lorebook effects of `runTrigger` (`../triggers`):
 * `v2GetLorebook`, `v2GetLorebookEntry`, `v2GetLorebookIndexViaName`,
 * `v2ModifyLorebook` and `v2SetLorebookActivation`.
 *
 * They are inert: lookups answer `null` / `-1`, the modify does nothing, and
 * the activation effect neither writes onto a lore entry nor throws, whatever
 * its index. `v2GetLorebookCount` is the one that works.
 *
 * Runs the real `runTrigger` over a plain in-memory database; the CBS parser is
 * an identity stand-in and every heavy collaborator is stubbed.
 *
 * Tests titled `regression reproducer:` fail when the activation effect writes
 * a stray key or throws (CHORE-09 item 4, MC-710). Tests titled `guard:` pin
 * behaviour that must be preserved and pass before and after.
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

let runTrigger: typeof import('src/ts/process/triggers').runTrigger
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
beforeAll(async () => {
    runTrigger = (await import('src/ts/process/triggers')).runTrigger
    const stores = await import('src/ts/stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
})

const lore = () => [
    { key: 'k1', comment: 'alpha', content: 'ALPHA-CONTENT', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false },
    { key: 'k2', comment: 'beta', content: 'BETA-CONTENT', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false },
]

async function run(effect: unknown[]) {
    const A = {
        chaId: 'a', name: 'Alice', type: 'character', chatPage: 0, modules: [], customscript: [], globalLore: lore(), defaultVariables: '',
        chats: [{ id: 'c1', note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }],
        triggerscript: [{ comment: 't', type: 'manual', lowLevelAccess: false, conditions: [], effect }], lowLevelAccess: false,
    }
    DBState.db = { characters: [A], enabledModules: [], modules: [], templateDefaultVariables: '', personas: [], selectedPersona: 0, username: 'U' } as unknown as Database
    selectedCharID.set(0)
    const char = DBState.db.characters[0] as character
    let err: unknown = null
    try { await runTrigger(char, 'manual', { chat: char.chats[0], origin: { chaId: 'a', chatId: 'c1' }, manualName: 't' }) } catch (e) { err = e }
    return { vars: char.chats[0].scriptstate as Record<string, string>, lore: char.globalLore as unknown as Record<string, unknown>[], err: err ? String(err) : null }
}

const setActivation = (index: string) => run([{ type: 'v2SetLorebookActivation', index, indexType: 'value', value: true, indent: 0 }])

describe('deprecated V2 lorebook effects', () => {
    test('guard: the lookups answer null / -1, the modify changes nothing and the count works', async () => {
        const r = await run([
            { type: 'v2GetLorebookCount', outputVar: 'count', indent: 0 },
            { type: 'v2GetLorebook', target: 'alpha', targetType: 'value', outputVar: 'byComment', indent: 0 },
            { type: 'v2GetLorebook', target: 'k1', targetType: 'value', outputVar: 'byKey', indent: 0 },
            { type: 'v2GetLorebookEntry', index: '0', indexType: 'value', outputVar: 'entry0', indent: 0 },
            { type: 'v2GetLorebookIndexViaName', name: 'alpha', nameType: 'value', outputVar: 'idxAlpha', indent: 0 },
            { type: 'v2ModifyLorebook', target: 'alpha', targetType: 'value', value: 'NEW', valueType: 'value', indent: 0 },
        ])
        expect(r.err).toBeNull()
        expect(r.vars['$count']).toBe('2')
        expect(r.vars['$byComment']).toBe('null')
        expect(r.vars['$byKey']).toBe('null')
        expect(r.vars['$entry0']).toBe('null')
        expect(r.vars['$idxAlpha']).toBe('-1')
        expect(r.lore[0].content).toBe('ALPHA-CONTENT')
        expect(r.lore[1].content).toBe('BETA-CONTENT')
    })

    test('guard: the activation effect leaves the entry content and always-active flag unchanged', async () => {
        const r = await setActivation('0')
        expect(r.lore[0].content).toBe('ALPHA-CONTENT')
        expect(r.lore[0].alwaysActive).toBe(false)
    })

    test('regression reproducer: the activation effect writes no stray key onto a lore entry', async () => {
        const r = await setActivation('0')
        expect(Object.keys(r.lore[0]).sort()).toEqual(Object.keys(lore()[0]).sort())
    })

    test('regression reproducer: the activation effect does not throw for an out-of-range index', async () => {
        const r = await setActivation('5')
        expect(r.err).toBeNull()
    })

    test('regression reproducer: the activation effect does not throw for a non-numeric index', async () => {
        const r = await setActivation('abc')
        expect(r.err).toBeNull()
    })
})
