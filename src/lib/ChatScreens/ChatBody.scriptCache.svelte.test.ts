// @vitest-environment happy-dom

/**
 * Mounts the real `ChatBody.svelte` with the parser as a held double and reads the script cache mode each display
 * parse receives. A run that starts on the streaming tail is a streamed partial and bypasses the cache; every other
 * run keeps the default.
 *
 * Labels: R = regression reproducer (fails on the base at an assertion), G = guard (passes before and after).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'

//#region module mocks

interface Held {
    args: unknown[]
    resolve: (value: string) => void
}

const h = vi.hoisted(() => ({
    parses: [] as Held[],
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
    }
})

vi.mock('src/ts/parser/parser.svelte', () => ({
    applyMarkdownToNode: () => {},
    risuChatParser: (data: string) => data,
    ParseMarkdown: vi.fn((...args: unknown[]) => new Promise<string>((resolve) => { h.parses.push({ args, resolve }) })),
    addMetadataToElement: (html: string) => html,
    postTranslationParse: (html: string) => html,
    trimMarkdown: (html: string) => html,
    getDistance: () => 0,
}))

vi.mock('src/ts/translator/translator', () => ({
    getLLMCache: async () => null,
    waitForTranslatorModules: async () => {},
    translateHTML: vi.fn((..._args: unknown[]) => new Promise<string>(() => {})),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertWait: vi.fn(),
}))

vi.mock('src/ts/util', () => ({
    checkPersonaBinded: vi.fn(() => false),
    sleep: vi.fn(async () => {}),
}))

vi.mock('src/ts/storage/database.svelte', async () => {
    const stores = await import('src/ts/stores.svelte')
    type CharShape = { chats?: unknown[], chatPage?: number }
    const db = () => (stores.DBState as unknown as { db: Record<string, unknown> }).db
    const getCurrentCharacter = () => (db().characters as CharShape[] | undefined)?.[0]
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage ?? 0]
    }
    return { getDatabase: db, getCurrentCharacter, getCurrentChat }
})

vi.mock('src/ts/process/modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
    moduleUpdate: () => {},
}))
vi.mock('src/ts/globalApi.svelte', () => ({ getFileSrc: async () => '' }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import ChatBody from './ChatBody.svelte'

const mounted: Array<{ target: HTMLElement, instance: Record<string, unknown> }> = []

/** The current chat holds `messages` replies; `streaming` marks it as streaming its last message. */
function setDb(messages: number, streaming: boolean, over: Record<string, unknown> = {}) {
    DBState.db = {
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
        characters: [{
            chaId: 'a', type: 'character', chatPage: 0, modules: [], customscript: [],
            chats: [{
                id: 'cA',
                modules: [],
                message: Array.from({ length: messages }, (_, n) => ({ role: 'char', data: `M${n}` })),
                isStreaming: streaming,
            }],
        }],
        modules: [],
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
        ...over,
    } as never
}

function mountBody(idx: number, deferAutoTranslate?: boolean) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props: Record<string, unknown> = {
        character: 'char',
        idx,
        msgDisplay: 'FIRST',
        role: 'char',
        translated: false,
        translating: false,
        retranslate: false,
        renderRevision: 0,
        modelShortName: '',
    }
    if (deferAutoTranslate !== undefined) {
        props.deferAutoTranslate = deferAutoTranslate
    }
    const instance = mount(ChatBody, { target, props: props as never }) as Record<string, unknown>
    flushSync()
    mounted.push({ target, instance })
}

async function pause(ms: number) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
    flushSync()
    await tick()
}

/** The script cache mode of the first display parse; an absent argument is the default, which is 'use'. */
function firstParseCacheMode(): unknown {
    expect(h.parses.length).toBeGreaterThan(0)
    return h.parses[0].args[5]
}

beforeEach(() => {
    h.parses.length = 0
    clearChatBodyRenderCache()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    for (const row of mounted.splice(0)) {
        await unmount(row.instance).catch(() => {})
        row.target.remove()
    }
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('the display parse bypasses the script cache only for a streamed partial', () => {
    test('R T3a the streaming tail row bypasses the cache', async () => {
        setDb(1, true)
        mountBody(0)
        await pause(30)
        expect(firstParseCacheMode()).toBe('bypass')
    })

    test('G T3b a row that is not the tail keeps the default while the chat streams', async () => {
        setDb(2, true)
        mountBody(0)
        await pause(30)
        expect(firstParseCacheMode() ?? 'use').toBe('use')
    })

    test('G T3c a tail row of a chat that is not streaming keeps the default', async () => {
        setDb(1, false)
        mountBody(0)
        await pause(30)
        expect(firstParseCacheMode() ?? 'use').toBe('use')
    })

    test('R T3d a deferred auto-translate run on the streaming tail bypasses the cache', async () => {
        setDb(1, true, { autoTranslate: true })
        mountBody(0, true)
        await pause(30)
        expect(firstParseCacheMode()).toBe('bypass')
    })
})
