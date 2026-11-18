// @vitest-environment node

/**
 * T4.11: the REAL `runTrigger` and the real `./scriptings.ts` with real Lua.
 * One pass runs the character's and the enabled modules' `triggerlua` scripts
 * in one mode; each of them must keep its own engine across passes even when
 * together they exceed the per-mode floor. Only network-facing modules are
 * mocked; the module trigger list is a stand-in over `DBState.db.modules`.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { LuaEngine } from 'wasmoon'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, Chat } from '../../storage/database.svelte'
import type { triggerscript } from '../triggers'

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as any })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        HideIconStore: writable(false),
        moduleBackgroundEmbedding: writable(''),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../tokenizer'), () => ({
    tokenize: vi.fn(async () => 1),
}) as unknown as typeof import('../../tokenizer'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
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

vi.mock(import('../../util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    parseKeyValue: () => [] as [string, string][],
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
}) as unknown as typeof import('../../util'))

vi.mock(import('../command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('../command'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'fail', result: 'not used' })),
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('../stableDiff'))

vi.mock(import('../../storage/database.svelte'), async () => {
    const stores = await import('../../stores.svelte')
    const DBState = stores.DBState as unknown as { db: any }
    const selectedCharID = stores.selectedCharID
    const getCurrentCharacter = () => {
        DBState.db.characters ??= []
        return DBState.db.characters[get(selectedCharID)]
    }
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage]
    }
    return {
        presetTemplate: {},
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn((d: unknown) => { DBState.db = d }),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        setCurrentCharacter: vi.fn(),
        setCurrentChat: vi.fn(),
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../modules'), async () => {
    const stores = await import('../../stores.svelte')
    const DBState = stores.DBState as unknown as { db: any }
    return {
        getModuleLorebooks: vi.fn(() => []),
        getModuleTriggers: vi.fn(() => {
            const modules = DBState.db.modules ?? []
            let triggers: any[] = []
            for (const module of modules) {
                if (module?.trigger) {
                    triggers = triggers.concat(module.trigger.map((t: any) => {
                        t.lowLevelAccess = module.lowLevelAccess
                        return t
                    }))
                }
            }
            return triggers
        }),
    } as unknown as typeof import('../modules')
})

const createdEngines = vi.hoisted((): LuaEngine[] => [])
vi.mock('wasmoon', async (importOriginal) => {
    const wasmoon = await importOriginal<typeof import('wasmoon')>()
    class RecordingLuaFactory extends wasmoon.LuaFactory {
        async createEngine(...args: Parameters<InstanceType<typeof wasmoon.LuaFactory>['createEngine']>) {
            const engine = await super.createEngine(...args)
            createdEngines.push(engine)
            return engine
        }
    }
    return { ...wasmoon, LuaFactory: RecordingLuaFactory }
})

// The long budget covers only the module reload of the hook; a test body that
// stalls surfaces at the shorter test budget.
const RELOAD_HOOK_TIMEOUT = 60000
vi.setConfig({ testTimeout: 20000 })

let runTrigger: typeof import('../triggers').runTrigger
let scriptings: typeof import('../scriptings')
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let jsonLua = ''

beforeEach(async () => {
    if (!jsonLua) {
        jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    }
    vi.resetModules()
    createdEngines.length = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    runTrigger = (await import('../triggers')).runTrigger
    scriptings = await import('../scriptings')
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never
}, RELOAD_HOOK_TIMEOUT)

function luaTrigger(code: string): triggerscript {
    return {
        comment: 'c',
        type: 'input',
        conditions: [],
        effect: [{ type: 'triggerlua', code }],
    } as unknown as triggerscript
}

describe('runTrigger passes its own script count', () => {
    test('T4.11 character plus module scripts above the floor keep their globals across passes', async () => {
        const floor = scriptings.LUA_ENGINES_PER_MODE_FLOOR
        expect(Number.isInteger(floor) && floor >= 2 && floor % 2 === 0).toBe(true)
        const h = floor / 2
        const script = (group: string, k: number) =>
            `function onInput(id) n = (n or 0) + 1 end -- T4.11 ${group} ${k}`
        const chat = { id: 'chat-0', message: [], scriptstate: {}, note: '', localLore: [] } as unknown as Chat
        const char = {
            chaId: 'char-t411',
            name: 'char-t411',
            type: 'character',
            chatPage: 0,
            chats: [chat],
            triggerscript: Array.from({ length: h + 1 }, (_, k) => luaTrigger(script('char', k))),
            globalLore: [],
            lowLevelAccess: false,
        } as unknown as character
        DBState.db = {
            characters: [char],
            modules: [{
                lowLevelAccess: false,
                trigger: Array.from({ length: h }, (_, k) => luaTrigger(script('module', k))),
            }],
            botPresets: [],
            templateDefaultVariables: '',
            personas: [],
            selectedPersona: 0,
        }
        selectedCharID.set(0)

        for (let pass = 0; pass < 3; pass++) {
            await runTrigger(char, 'input', { chat } as never)
        }

        expect(createdEngines.length).toBe(floor + 1)
        const open = createdEngines.filter((engine) => !engine.global.isClosed())
        expect(open.length).toBe(floor + 1)
        for (const engine of open) {
            expect(engine.global.get('n')).toBe(3)
        }
    })
})
