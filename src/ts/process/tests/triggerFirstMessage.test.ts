/**
 * The `v2GetFirstMessage` trigger effect reads the chat's first message through
 * the stale-index fallback: a chat whose `fmIndex` names no alternate greeting
 * yields the default first message.
 *
 * Runs the real `runTrigger` over a plain in-memory database; the harness is the
 * one of `triggerLegacyLorebook.test.ts`.
 *
 * The test titled `regression reproducer:` fails on the raw alternate-greeting
 * read (CHORE-456). The test titled `guard:` passes before and after.
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



async function firstMessageFor(fmIndex: number) {
    const A = {
        chaId: 'a', name: 'Alice', type: 'character', chatPage: 0, modules: [], customscript: [], globalLore: [], defaultVariables: '',
        firstMessage: 'Default hello', alternateGreetings: ['Alt0'],
        chats: [{ id: 'c1', note: '', name: '', localLore: [], fmIndex, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }],
        triggerscript: [{ comment: 't', type: 'manual', lowLevelAccess: false, conditions: [], effect: [{ type: 'v2GetFirstMessage', outputVar: 'first', indent: 0 }] }],
        lowLevelAccess: false,
    }
    DBState.db = { characters: [A], enabledModules: [], modules: [], templateDefaultVariables: '', personas: [], selectedPersona: 0, username: 'U' } as unknown as Database
    selectedCharID.set(0)
    const char = DBState.db.characters[0] as character
    await runTrigger(char, 'manual', { chat: char.chats[0], origin: { chaId: 'a', chatId: 'c1' }, manualName: 't' })
    return (char.chats[0].scriptstate as Record<string, string>)['$first']
}

describe('v2GetFirstMessage', () => {
    test('regression reproducer: a stale fmIndex yields the default first message', async () => {
        expect(await firstMessageFor(3)).toBe('Default hello')
    })

    test('guard (passes before and after): an in-range fmIndex yields that alternate greeting', async () => {
        expect(await firstMessageFor(0)).toBe('Alt0')
    })
})
