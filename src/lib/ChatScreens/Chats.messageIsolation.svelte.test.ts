// @vitest-environment happy-dom

/**
 * The real `Chats.svelte` mounts one real `Chat` per message hash from inside its own effect. The roots one run of
 * that effect mounts must stay children of one parent, otherwise a later write that reaches several of them
 * leaves some root unable to update (its Edit opens no editor, with no error). The module doubles are the ones of
 * `Chats.bodyReload.svelte.test.ts`.
 *
 * "Detach" is one `ReloadChatPointer` bump at an index that is not displayed: every hash is kept and the Chats effect
 * re-runs, which detaches the roots mounted by earlier runs.
 *
 * Labels: R = regression reproducer (fails on the pre-fix base), G = guard (passes before and after).
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, ReloadChatPointer, ReloadGUIPointer, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import Chats from './Chats.svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'
import type { character, Chat as ChatData } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import { draftContentOrphanGate } from 'src/ts/draftContentOrphanGate'
import { resetLocalDraftsForTest } from 'src/ts/localDrafts'
import type { MountHolderRun, MountHolders } from './chatMountHolders'

//#region module mocks

interface Held {
    args: unknown[]
    resolve: (value: string) => void
}

const h = vi.hoisted(() => ({
    parses: [] as Held[],
    // Holders of mounted message roots that are attached and not yet destroyed.
    liveHolders: 0,
    // The display parser throws for a message with exactly this text (null: never).
    parseThrowOn: null as string | null,
    // The model lookup of the generation-info badge throws (null: never); it runs in Chat's template, outside displaya.
    modelThrows: false,
}))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
    // Every ParseMarkdown call gets a fresh deferred that the test answers.
    ParseMarkdown: vi.fn((...args: unknown[]) => new Promise<string>((resolve) => { h.parses.push({ args, resolve }) })),
    addMetadataToElement: vi.fn((html: string) => html),
    postTranslationParse: vi.fn((html: string) => html),
    trimMarkdown: vi.fn((html: string) => html),
    getDistance: vi.fn(() => 0),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as any })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CurrentTriggerIdStore: writable(null),
        popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: writable(false),
        createSimpleCharacter: vi.fn(() => ({ name: 'A' })),
        bookmarkListOpen: writable(false),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    return {
        aiLawApplies: vi.fn(() => false),
        changeChatTo: vi.fn((v: number | string) => {
            const char = (stores.DBState as unknown as { db: any }).db.characters[
                (stores.selIdState as unknown as { selId: number }).selId
            ]
            if (typeof v === 'number' && char) {
                char.chatPage = v
            }
        }),
        foldChatToMessage: vi.fn(),
        chatFoldedStateMessageIndex: { index: -1 },
        getFileSrc: vi.fn(async () => ''),
        createChatCopyName: vi.fn((name: string) => `${name} Branch`),
        downloadFile: vi.fn(),
        fetchNative: vi.fn(),
        readImage: vi.fn(),
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
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
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
    alertError: vi.fn(),
    alertSelect: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
    waitForTranslatorModules: vi.fn(async () => {}),
    translateHTML: vi.fn(() => new Promise<string>(() => {})),
}) as unknown as typeof import('src/ts/translator/translator'))

// The real parser reads chat and database state; reading one field here makes a write to it re-parse every message.
vi.mock(import('src/ts/process/scripts'), async () => {
    const stores = await import('src/ts/stores.svelte')
    return {
        risuChatParser: vi.fn((text: string) => {
            void (stores.DBState as unknown as { db: { zoomsize?: number } }).db.zoomsize
            if (h.parseThrowOn !== null && text === h.parseThrowOn) {
                throw new Error('parse boom')
            }
            return text ?? ''
        }),
    } as unknown as typeof import('src/ts/process/scripts')
})

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/gui/longtouch'), () => ({
    longpress: vi.fn(() => ({ destroy: () => {} })),
}) as unknown as typeof import('src/ts/gui/longtouch'))

vi.mock(import('src/ts/model/modellist'), async () => {
    const stores = await import('src/ts/stores.svelte')
    return {
        getModelInfo: vi.fn(() => {
            void (stores.DBState as unknown as { db: { zoomsize?: number } }).db.zoomsize
            if (h.modelThrows) {
                throw new Error('model boom')
            }
            return { shortName: 'test-model' }
        }),
    } as unknown as typeof import('src/ts/model/modellist')
})

vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
    findCharacterbyId: vi.fn(() => null),
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    checkPersonaBinded: vi.fn(() => false),
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'fail', result: 'not used' })),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/stableDiff'), () => ({
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenize: vi.fn(async () => 1),
}) as unknown as typeof import('src/ts/tokenizer'))

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

vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

// wasmoon cannot load under happy-dom; the button and form scripts are not part of these rows.
vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => undefined),
    runLuaInteractionTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/process/scriptings'))

// The real helper, with a count of the holders that were attached and not yet destroyed.
vi.mock(import('./chatMountHolders'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        createMountHolders: <K,>(): MountHolders<K> => {
            const real = original.createMountHolders<K>()
            return {
                ...real,
                begin: (): MountHolderRun<K> => {
                    const run = real.begin()
                    return {
                        ...run,
                        attach: (destroy) => {
                            h.liveHolders += 1
                            run.attach(() => {
                                h.liveHolders -= 1
                                destroy()
                            })
                        },
                    }
                },
            }
        },
    }
})

//#endregion

//#region fixtures

function makeChat(id: string, overrides: Record<string, unknown> = {}): ChatData {
    return {
        id,
        message: [] as unknown[],
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
        ...overrides,
    } as unknown as ChatData
}

function makeCharacter(chaId: string, chats: ChatData[], overrides: Record<string, unknown> = {}): character {
    return {
        chaId,
        name: chaId,
        type: 'character',
        ttsMode: 'none',
        chatPage: 0,
        chats,
        triggerscript: [] as unknown[],
        globalLore: [] as unknown[],
        desc: `${chaId}-original-desc`,
        modules: [] as string[],
        ...overrides,
    } as unknown as character
}

function baseDb(overrides: Record<string, unknown> = {}) {
    return {
        askRemoval: false, instantRemove: false, translatorType: 'none',
        translateBeforeHTMLFormatting: false, legacyTranslation: false,
        requestInfoInsideChat: false, clickToEdit: false, zoomsize: 100,
        lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false,
        useChatCopy: false, translator: '', swipe: false, showFirstMessagePages: false,
        enableBookmark: true, createFolderOnBranch: false, iconsize: 100,
        memoryLimitThickness: 2, theme: 'default', guiHTML: '', roundIcons: false,
        modules: [], enabledModules: [], moduleIntergration: '', templateDefaultVariables: '', personas: [], selectedPersona: 0,
        presetRegex: [], streamingDisplayOptimizationMode: 'off',
        ...overrides,
    }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function wait(ms = 0) {
    await new Promise((r) => setTimeout(r, ms))
    flushSync()
}

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    draftContentOrphanGate.clear()
    resetLocalDraftsForTest()
    vi.clearAllMocks()
})

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
    selIdState.selId = 0
    h.parses.length = 0
    h.liveHolders = 0
    h.parseThrowOn = null
    h.modelThrows = false
    ReloadGUIPointer.set(0)
    ReloadChatPointer.set({})
    clearChatBodyRenderCache()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

//#endregion

interface LiveMessage { role: 'user' | 'char', data: string, chatId?: string, generationInfo?: { model: string } }

// A message whose generation-info badge runs the model lookup that `h.modelThrows` makes throw.
const BADGED = { model: 'bad' }

let stopGuiReset: () => void = () => {}

beforeEach(() => {
    // The real store resets the chat pointer in the first subscriber of the GUI pointer.
    stopGuiReset = ReloadGUIPointer.subscribe(() => { ReloadChatPointer.set({}) })
})

afterEach(() => {
    stopGuiReset()
})

function mountChats(messages: LiveMessage[], dbOverrides: Record<string, unknown> = {}) {
    DBState.db = baseDb(dbOverrides) as never
    DBState.db.characters = [makeCharacter('a', [makeChat('cA', { message: messages })], { image: '' })] as never
    const live = (DBState.db.characters as unknown as Array<{ chats: Array<{ message: LiveMessage[], isStreaming?: boolean }> }>)[0]
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(Chats, {
        target,
        props: {
            messages: live.chats[0].message as never,
            currentCharacter: live as never,
            onReroll: () => {},
            unReroll: () => {},
            currentUsername: 'User',
            userIcon: '',
            loadPages: 10,
        },
    })
    mountedInstances.push(instance)
    flushSync()
    return { target, chat: live.chats[0] }
}

function messageRow(target: HTMLElement, index: number): HTMLElement {
    const row = target.querySelector<HTMLElement>(`.risu-chat[data-chat-index="${index}"]`)
    if (!row) throw new Error(`no row for message ${index}`)
    return row
}

/** Answers every parse asked so far, so each row has rendered its body. */
async function answerAllParses() {
    for (const parse of h.parses.slice()) {
        parse.resolve(`P:${parse.args[0] as string}`)
    }
    await wait(20)
    await tick()
}

/** One tap on the row's Edit button, then whether the editor is open. */
async function editOpens(target: HTMLElement, index: number) {
    messageRow(target, index).querySelector<HTMLElement>('.button-icon-edit')!.click()
    flushSync()
    await tick()
    return messageRow(target, index).querySelector('.message-edit-area') !== null
}

async function detach(target: HTMLElement) {
    ReloadChatPointer.update((v) => { v[99] = (v[99] ?? 0) + 1; return v })
    flushSync()
    await wait(0)
    expect(target.querySelectorAll('.risu-chat').length).toBeGreaterThan(1)
}

describe('S1 messages mounted by one run of the Chats effect share one parent', () => {
    test('R T1: after a detach and one shared write, the older message still opens its editor', async () => {
        const { target } = mountChats([{ role: 'user', data: 'A' }, { role: 'char', data: 'B' }])
        await wait(20)
        await answerAllParses()
        await detach(target)

        // Exactly one write to a field every row reads; a second write would flip the dead state back.
        DBState.db.zoomsize = 120
        flushSync()
        await tick()

        expect(await editOpens(target, 0)).toBe(true)
    })

    test('G T5: remounting one message leaves its run-sibling alive and editable', async () => {
        const { target, chat } = mountChats([{ role: 'user', data: 'A' }, { role: 'char', data: 'B' }])
        await wait(20)
        await answerAllParses()

        chat.message[1].data = 'B2'
        flushSync()
        await wait(20)
        await answerAllParses()
        expect(messageRow(target, 1).textContent).toContain('P:B2')

        expect(await editOpens(target, 0)).toBe(true)
    })
})

//#region S2 a failing message is contained

function failedPanel(target: HTMLElement, index: number) {
    return target.querySelector(`[data-chat-failed="${index}"]`)
}

function renderFailedNote(target: HTMLElement, index: number) {
    return messageRow(target, index).querySelector('.render-failed-note')
}

function bodyFontSize(target: HTMLElement, index: number) {
    return parseFloat(messageRow(target, index).querySelector<HTMLElement>('.chattext')!.style.fontSize)
}

async function typeInto(target: HTMLElement, index: number, value: string) {
    const area = messageRow(target, index).querySelector<HTMLTextAreaElement>('.message-edit-area')!
    area.value = value
    area.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    await tick()
}

function errorsAt(site: string) {
    return (window.__risuTaniumErrors ?? []).filter((entry) => entry.site === site)
}

describe('S2 a message that throws does not stop the other messages', () => {
    test('R T2: a throw in one message during a shared write is contained, recorded, and leaves the others updating', async () => {
        const { target, chat } = mountChats(
            [{ role: 'user', data: 'A' }, { role: 'char', data: 'BAD', chatId: 'c1', generationInfo: BADGED }],
            { requestInfoInsideChat: true },
        )
        await wait(20)
        await answerAllParses()
        await detach(target)
        chat.message.push({ role: 'char', data: 'C' })
        flushSync()
        await wait(20)
        await answerAllParses()
        await detach(target)

        const recordedBefore = errorsAt('chat.message').length
        h.modelThrows = true
        expect(() => {
            DBState.db.zoomsize = 120
            flushSync()
        }).not.toThrow()
        await tick()

        expect(failedPanel(target, 1)).not.toBeNull()
        expect(errorsAt('chat.message').length).toBeGreaterThan(recordedBefore)

        // A later write still reaches the other messages.
        DBState.db.zoomsize = 140
        flushSync()
        await tick()
        expect(bodyFontSize(target, 0)).toBeCloseTo(0.875 * 1.4, 5)
        expect(bodyFontSize(target, 2)).toBeCloseTo(0.875 * 1.4, 5)

        expect(await editOpens(target, 0)).toBe(true)
        expect(await editOpens(target, 2)).toBe(true)
    })

    test('R T3: a message that throws on its first render leaves the list mounted and the others editable', async () => {
        h.modelThrows = true
        let mounted: ReturnType<typeof mountChats> | undefined
        expect(() => {
            mounted = mountChats(
                [{ role: 'user', data: 'A' }, { role: 'char', data: 'BAD', generationInfo: BADGED }, { role: 'user', data: 'C' }],
                { requestInfoInsideChat: true },
            )
        }).not.toThrow()
        const { target } = mounted!
        await wait(20)
        await answerAllParses()

        expect(failedPanel(target, 1)).not.toBeNull()
        expect(target.querySelectorAll('.risu-chat').length).toBe(2)
        expect(await editOpens(target, 0)).toBe(true)
        expect(await editOpens(target, 2)).toBe(true)
        expect(errorsAt('chat.message').length).toBeGreaterThan(0)
    })

    test('G the fallback shows the raw message as plain text and Retry mounts the message again', async () => {
        h.modelThrows = true
        const { target } = mountChats(
            [{ role: 'user', data: 'A' }, { role: 'char', data: '<b>raw</b> text', generationInfo: BADGED }],
            { requestInfoInsideChat: true },
        )
        await wait(20)
        await answerAllParses()

        const panel = failedPanel(target, 1)!
        expect(panel.textContent).toContain('<b>raw</b> text')
        expect(panel.querySelector('b')).toBeNull()
        expect(panel.textContent).toContain(language.messageRenderFailed)

        h.modelThrows = false
        const retry = [...panel.querySelectorAll('button')].find((b) => b.textContent === language.messageRenderRetry)!
        retry.click()
        flushSync()
        await wait(20)
        await answerAllParses()
        expect(failedPanel(target, 1)).toBeNull()
        expect(await editOpens(target, 1)).toBe(true)
    })

    test('R T4: a parse failure keeps the whole message alive: raw text, a note, working Edit, and the note clears on the next good parse', async () => {
        h.parseThrowOn = 'BAD'
        let mounted: ReturnType<typeof mountChats> | undefined
        expect(() => {
            mounted = mountChats([{ role: 'user', data: 'A' }, { role: 'char', data: 'BAD' }, { role: 'user', data: 'C' }])
        }).not.toThrow()
        const { target } = mounted!
        await wait(20)
        await answerAllParses()

        expect(messageRow(target, 1).textContent).toContain('P:BAD')
        expect(renderFailedNote(target, 1)).not.toBeNull()
        expect(renderFailedNote(target, 0)).toBeNull()
        expect(errorsAt('chat.parse').length).toBeGreaterThan(0)

        h.parseThrowOn = null
        ReloadGUIPointer.set(1)
        flushSync()
        await wait(20)
        await answerAllParses()
        expect(renderFailedNote(target, 1)).toBeNull()
    })

    test('R T4: a message whose parse failed still opens its editor with the raw text', async () => {
        h.parseThrowOn = 'BAD'
        const { target } = mountChats([{ role: 'user', data: 'A' }, { role: 'char', data: 'BAD' }])
        await wait(20)
        await answerAllParses()

        expect(await editOpens(target, 1)).toBe(true)
        expect(messageRow(target, 1).querySelector<HTMLTextAreaElement>('.message-edit-area')!.value).toBe('BAD')
    })

    test('R D: a parse failure while the editor is open does not close it or lose the typed text', async () => {
        const { target } = mountChats([{ role: 'user', data: 'A' }, { role: 'char', data: 'X' }])
        await wait(20)
        await answerAllParses()
        expect(await editOpens(target, 1)).toBe(true)
        await typeInto(target, 1, 'typed text')

        h.parseThrowOn = 'X'
        ReloadGUIPointer.set(1)
        flushSync()
        await wait(20)

        const area = messageRow(target, 1).querySelector<HTMLTextAreaElement>('.message-edit-area')
        expect(area).not.toBeNull()
        expect(area!.value).toBe('typed text')
    })

    test('R D: a boundary trip while the editor is open loses only the textarea; after Retry the restore marker offers the typed text', async () => {
        const { target } = mountChats(
            [{ role: 'user', data: 'A' }, { role: 'char', data: 'original', chatId: 'c1', generationInfo: BADGED }],
            { requestInfoInsideChat: true },
        )
        await wait(20)
        await answerAllParses()
        expect(await editOpens(target, 1)).toBe(true)
        await typeInto(target, 1, 'typed before the trip')

        h.modelThrows = true
        DBState.db.zoomsize = 120
        flushSync()
        await tick()
        const panel = failedPanel(target, 1)
        expect(panel).not.toBeNull()
        expect(messageRow(target, 0)).not.toBeNull()

        h.modelThrows = false
        const retry = [...panel!.querySelectorAll('button')].find((b) => b.textContent === language.messageRenderRetry)!
        retry.click()
        flushSync()
        await wait(20)
        await answerAllParses()

        messageRow(target, 1).querySelector<HTMLElement>('.button-icon-edit')!.click()
        flushSync()
        await tick()
        const row = messageRow(target, 1)
        expect(row.querySelector('[role="status"]')?.textContent).toContain(language.draftRestored)
        expect(row.querySelector<HTMLTextAreaElement>('.message-edit-area')!.value).toBe('typed before the trip')
    })

    test('R X1: a throw from a script-level effect of one message is contained; the list mounts and the other messages edit', async () => {
        // The second matchMedia call is the reduced-motion effect in Chat's script, not its template.
        const recordedBefore = errorsAt('chat.message').length
        let calls = 0
        const real = window.matchMedia.bind(window)
        const spy = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
            calls += 1
            if (calls === 2) throw new Error('script boom')
            return real(query)
        })
        let mounted: ReturnType<typeof mountChats> | undefined
        let thrown: unknown = null
        try {
            mounted = mountChats([{ role: 'user', data: 'A' }, { role: 'char', data: 'B' }, { role: 'user', data: 'C' }])
            await wait(20)
        } catch (error) {
            thrown = error
        } finally {
            spy.mockRestore()
        }
        expect(thrown).toBeNull()
        const { target } = mounted!
        await answerAllParses()
        expect(calls).toBeGreaterThanOrEqual(3)
        expect(target.querySelectorAll('[data-chat-failed]').length).toBe(1)
        const failedIndex = Number(target.querySelector('[data-chat-failed]')!.getAttribute('data-chat-failed'))
        for (const index of [0, 1, 2].filter((i) => i !== failedIndex)) {
            expect(await editOpens(target, index)).toBe(true)
        }
        expect(errorsAt('chat.message').length).toBeGreaterThan(recordedBefore)
    })
})

//#endregion

//#region S3 streaming forwarding, message order and holder lifetime

function domOrder(target: HTMLElement) {
    return [...target.querySelectorAll<HTMLElement>('.risu-chat')].map((row) => Number(row.dataset.chatIndex))
}

describe('S3 the Chats effect keeps its streaming, order and holder behaviour', () => {
    test('G X2: in strong streaming mode a new chunk reaches the mounted message without a remount (passes before and after)', async () => {
        const { target, chat } = mountChats(
            [{ role: 'user', data: 'A' }, { role: 'char', data: 'chunk1' }],
            { streamingDisplayOptimizationMode: 'strong' },
        )
        await wait(20)
        await answerAllParses()
        chat.isStreaming = true
        flushSync()
        await wait(20)
        await answerAllParses()
        const rowBefore = messageRow(target, 1)
        chat.message[1].data = 'chunk1 chunk2'
        flushSync()
        await tick()
        expect(messageRow(target, 1)).toBe(rowBefore)
        expect(messageRow(target, 1).textContent).toContain('chunk1 chunk2')
    })

    test('G X4: a message that is retried while it streams shows the current streaming text at once (guard for the boundary forwarder)', async () => {
        const { target, chat } = mountChats(
            [{ role: 'user', data: 'A' }, { role: 'char', data: 'chunk1', generationInfo: BADGED }],
            { streamingDisplayOptimizationMode: 'strong', requestInfoInsideChat: true },
        )
        await wait(20)
        await answerAllParses()
        chat.isStreaming = true
        flushSync()
        await wait(20)
        await answerAllParses()

        h.modelThrows = true
        DBState.db.zoomsize = 120
        flushSync()
        await tick()
        const panel = failedPanel(target, 1)
        expect(panel).not.toBeNull()

        chat.message[1].data = 'chunk1 chunk2'
        flushSync()
        await tick()

        h.modelThrows = false
        const retry = [...panel!.querySelectorAll('button')].find((b) => b.textContent === language.messageRenderRetry)!
        retry.click()
        flushSync()
        await wait(20)
        await answerAllParses()
        expect(messageRow(target, 1).textContent).toContain('chunk1 chunk2')
    })

    test('G X3: the newest message stays first in the DOM after the first mount, a middle remount and appends (passes before and after)', async () => {
        const { target, chat } = mountChats([{ role: 'user', data: 'A' }, { role: 'char', data: 'B' }, { role: 'user', data: 'C' }])
        await wait(20)
        await answerAllParses()
        expect(domOrder(target)).toEqual([2, 1, 0])

        chat.message[1].data = 'B2'
        flushSync()
        await wait(20)
        await answerAllParses()
        expect(domOrder(target)).toEqual([2, 1, 0])

        chat.message.push({ role: 'char', data: 'D' }, { role: 'user', data: 'E' })
        flushSync()
        await wait(20)
        await answerAllParses()
        expect(domOrder(target)).toEqual([4, 3, 2, 1, 0])

        chat.message[0].data = 'A2'
        chat.message[3].data = 'D2'
        flushSync()
        await wait(20)
        await answerAllParses()
        expect(domOrder(target)).toEqual([4, 3, 2, 1, 0])
        expect(target.querySelectorAll('.chat-message-container').length).toBe(5)
    })

    test('G E1: a holder is destroyed once all its roots are remounted, and every holder is destroyed with Chats', async () => {
        const { chat } = mountChats([{ role: 'user', data: 'A' }, { role: 'char', data: 'B' }])
        await wait(20)
        await answerAllParses()
        expect(h.liveHolders).toBe(1)

        chat.message[0].data = 'A2'
        chat.message[1].data = 'B2'
        flushSync()
        await wait(20)
        await answerAllParses()
        expect(h.liveHolders).toBe(1)

        await unmount(mountedInstances.pop() as never)
        expect(h.liveHolders).toBe(0)
    })
})

//#endregion

