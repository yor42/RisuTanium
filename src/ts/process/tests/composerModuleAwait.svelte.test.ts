// @vitest-environment node

/**
 * The composer waits for the module stubs its chat references before anything of the sent line runs, above the
 * slash-command branch: a slash command, the input triggers and the regex scripts all read module bodies. A failed
 * load leaves the taken text in the draft (commands included) and shows one alert naming the module; the busy button
 * aborts the wait silently and the draft goes back exactly once. Drives the REAL `composerActions.svelte.ts`, the real
 * `moduleEnsure` and the real `moduleAcquire` with the module mocks of `composerActions.svelte.test.ts` (copied, not
 * shared: each suite mocks its own graph); `./command` is a spy, so "the command ran" means the spy was called.
 *
 * The `/trigger` command goes through the same composer await as every other command, so the slash-command rows
 * cover it; `command.ts` itself is not edited.
 * Labels: R = regression reproducer (the base runs the command at once and never waits), G = guard.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, Chat, Database } from '../../storage/database.svelte'
import type { SendChatArg } from '../index.svelte'
import { alertError } from '../../alert'
import { MODULE_STUB_KEY } from '../../storage/moduleStub'
import { ModuleLoadError, registerModuleLoader, unregisterModuleLoader } from '../../storage/store2/moduleAcquire'

//#region module mocks

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as any })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        CharEmotion: writable({}),
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
    downloadFile: vi.fn(),
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
    selectSingleFile: vi.fn(),
    parseKeyValue: () => [],
    sleep: (ms: number) => new Promise<void>((res) => setTimeout(res, Math.min(ms, 1))),
}) as unknown as typeof import('../../util'))

const processMultiCommandMock = vi.hoisted(() => vi.fn(async (_cmd: string): Promise<string | false> => false))

vi.mock(import('../command'), () => ({
    processMultiCommand: processMultiCommandMock,
}) as unknown as typeof import('../command'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
    snapshotSubject: vi.fn(),
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

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: {
        editinput: new Set(),
        editoutput: new Set(),
        editdisplay: new Set(),
        editprocess: new Set(),
    },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

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
        setCurrentCharacter: vi.fn((char: unknown) => {
            DBState.db.characters ??= []
            DBState.db.characters[get(selectedCharID)] = char
        }),
        setCurrentChat: vi.fn((chat: unknown) => {
            const char = getCurrentCharacter()
            char.chats[char.chatPage] = chat
        }),
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('../modules'))

const sendChatMock = vi.hoisted(() => vi.fn(async (_index: number, _arg: SendChatArg) => true))
const doingChatMock = vi.hoisted(() => ({
    subscribe(run: (v: boolean) => void) {
        run(false)
        return () => {}
    },
    set() {},
}))

vi.mock(import('../index.svelte'), () => ({
    doingChat: doingChatMock,
    sendChat: sendChatMock,
}) as unknown as typeof import('../index.svelte'))

vi.mock(import('../../translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
}) as unknown as typeof import('../../translator/translator'))

//#endregion

let send: typeof import('../composerActions.svelte').send
let abortChat: typeof import('../composerActions.svelte').abortChat
let resetComposerActionsForTests: typeof import('../composerActions.svelte').resetComposerActionsForTests
type ComposerActionsSource = import('../composerActions.svelte').ComposerActionsSource
let composerDraftsPeek: typeof import('../composerDrafts.svelte').peek
let composerDraftsWrite: typeof import('../composerDrafts.svelte').write
let resetLocalDraftsForTest: typeof import('../../localDrafts').resetLocalDraftsForTest
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
    const actions = await import('../composerActions.svelte')
    send = actions.send
    abortChat = actions.abortChat
    resetComposerActionsForTests = actions.resetComposerActionsForTests
    const drafts = await import('../composerDrafts.svelte')
    composerDraftsPeek = drafts.peek
    composerDraftsWrite = drafts.write
    resetLocalDraftsForTest = (await import('../../localDrafts')).resetLocalDraftsForTest
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never
})

//#region fixtures

function makeCharacter(chaId: string): character {
    return {
        chaId, name: chaId, type: 'character', chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], scriptstate: {}, note: '', localLore: [] } as unknown as Chat],
        triggerscript: [], customscript: [], globalLore: [], desc: '',
    } as unknown as character
}

function installStubbedDb(char: character): void {
    DBState.db = {
        characters: [char],
        modules: [{ id: 'm1', name: 'Alpha', description: '', [MODULE_STUB_KEY]: 1 }],
        enabledModules: ['m1'], moduleIntergration: '',
        templateDefaultVariables: '', personas: [], selectedPersona: 0, presetRegex: [],
        useSayNothing: false, playMessage: false, useAutoTranslateInput: false, translatorType: '',
    } as unknown as Database
    selectedCharID.set(0)
}

function seedDraft(char: character, text: string): void {
    composerDraftsWrite({ chaId: char.chaId, chatId: char.chats[0].id! }, (record) => { record.messageInput = text })
}

function draftText(char: character): string {
    return composerDraftsPeek({ chaId: char.chaId, chatId: char.chats[0].id! }).messageInput
}

const source: ComposerActionsSource = { closeMenu: () => {} }

let loaderCalls: string[] = []
let releaseLoad: () => void = () => {}

/** A loader that waits for `releaseLoad` (or an abort), then installs a resident module in the slot, or fails. */
function registerGatedLoader(failure: Error | null = null): void {
    loaderCalls = []
    registerModuleLoader(async (handle, signal) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        loaderCalls.push(id)
        await new Promise<void>((res) => {
            releaseLoad = res
            signal?.addEventListener('abort', () => res(), { once: true })
        })
        if (signal?.aborted) {
            throw signal.reason
        }
        if (failure) {
            throw failure
        }
        const modules = DBState.db.modules as Array<Record<string, unknown>>
        const index = modules.findIndex((m) => m.id === id)
        modules[index] = { id, name: id, description: '', lorebook: [] }
        return modules[index] as never
    })
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((res) => setTimeout(res, 0))
    }
}

beforeEach(() => {
    processMultiCommandMock.mockReset()
    processMultiCommandMock.mockImplementation(async () => false)
    sendChatMock.mockClear()
    vi.mocked(alertError).mockClear()
    resetLocalDraftsForTest()
})

afterEach(() => {
    unregisterModuleLoader()
    resetComposerActionsForTests()
})

//#endregion

describe('the composer waits for the referenced module stubs', () => {
    test('R slash-command-waits-for-module-then-runs', async () => {
        const char = makeCharacter('c-slash')
        installStubbedDb(char)
        seedDraft(char, '/mycommand')
        registerGatedLoader()

        const outcome = send(source)
        await settle()
        expect(loaderCalls).toEqual(['m1'])
        expect(processMultiCommandMock).not.toHaveBeenCalled()

        releaseLoad()
        await outcome
        expect(processMultiCommandMock).toHaveBeenCalledTimes(1)
    })

    test('R slash-command-load-failure-does-not-run-and-puts-draft-back', async () => {
        const char = makeCharacter('c-slash-fail')
        installStubbedDb(char)
        seedDraft(char, '/mycommand')
        registerGatedLoader(new ModuleLoadError('unreadable', 'm1', 'Alpha'))

        const outcome = send(source)
        await settle()
        releaseLoad()
        await outcome

        expect(processMultiCommandMock).not.toHaveBeenCalled()
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(String(vi.mocked(alertError).mock.calls[0][0])).toContain('Alpha')
        expect(draftText(char)).toBe('/mycommand')
    })

    test('R composer-load-failure-puts-draft-back-naming-module', async () => {
        const char = makeCharacter('c-plain-fail')
        installStubbedDb(char)
        seedDraft(char, 'hello there')
        registerGatedLoader(new ModuleLoadError('unreadable', 'm1', 'Alpha'))

        const outcome = send(source)
        await settle()
        releaseLoad()
        await outcome

        expect(char.chats[0].message).toHaveLength(0)
        expect(sendChatMock).not.toHaveBeenCalled()
        expect(String(vi.mocked(alertError).mock.calls[0][0])).toContain('Alpha')
        expect(draftText(char)).toBe('hello there')
    })

    test('R busy-button-during-ensure-puts-draft-back-once', async () => {
        const char = makeCharacter('c-busy')
        installStubbedDb(char)
        seedDraft(char, 'hello there')
        registerGatedLoader()

        const outcome = send(source)
        await settle()
        abortChat()
        expect(draftText(char)).toBe('hello there')
        await outcome

        expect(draftText(char)).toBe('hello there')
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(sendChatMock).not.toHaveBeenCalled()
    })

    test('G composer-without-stubs-adds-no-load', async () => {
        const char = makeCharacter('c-nostub')
        installStubbedDb(char)
        ;(DBState.db.modules as unknown[]).splice(0)
        seedDraft(char, '/mycommand')
        registerGatedLoader()

        await send(source)
        expect(loaderCalls).toEqual([])
        expect(processMultiCommandMock).toHaveBeenCalledTimes(1)
    })
})

describe('the composer names the sending character when another character shares its id', () => {
    /**
     * Only the selected character references the module and nothing enables it globally, so the module is found only
     * through the owner the composer passes; a twin with the same `chaId` and no modules comes after it.
     */
    function installDuplicatedDb(char: character): void {
        installStubbedDb(char)
        DBState.db.enabledModules = []
        ;(char as unknown as { modules: string[] }).modules = ['m1']
        const twin = makeCharacter(char.chaId)
        twin.chats[0].id = `${char.chaId}-twin-chat-0`
        DBState.db.characters.push(twin)
    }

    test('guard: composer-loads-the-stub-of-a-duplicated-character-id', async () => {
        const char = makeCharacter('c-dup')
        installDuplicatedDb(char)
        seedDraft(char, 'hello there')
        registerGatedLoader()

        const outcome = send(source)
        await settle()
        expect(loaderCalls).toEqual(['m1'])
        expect(sendChatMock).not.toHaveBeenCalled()

        releaseLoad()
        await outcome
        expect(sendChatMock).toHaveBeenCalledTimes(1)
    })

    test('guard: slash-command-loads-the-stub-of-a-duplicated-character-id-before-it-runs', async () => {
        const char = makeCharacter('c-dup-slash')
        installDuplicatedDb(char)
        seedDraft(char, '/mycommand')
        registerGatedLoader()

        const outcome = send(source)
        await settle()
        expect(loaderCalls).toEqual(['m1'])
        expect(processMultiCommandMock).not.toHaveBeenCalled()

        releaseLoad()
        await outcome
        expect(processMultiCommandMock).toHaveBeenCalledTimes(1)
    })
})
