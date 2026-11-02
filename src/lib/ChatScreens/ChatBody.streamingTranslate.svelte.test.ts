// @vitest-environment happy-dom

/**
 * Mounts the real `ChatBody.svelte` directly, with the parser and the translator as held doubles. Deferral is the
 * mount-time prop `deferAutoTranslate`: the body decides nothing from its own context, so a body mounted without the
 * prop translates a streaming tail as it always did.
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
    translations: [] as Held[],
    llmCacheCalls: 0,
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
    getLLMCache: async () => {
        h.llmCacheCalls++
        return null
    },
    waitForTranslatorModules: async () => {},
    translateHTML: vi.fn((...args: unknown[]) => new Promise<string>((resolve) => { h.translations.push({ args, resolve }) })),
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
import { ParseMarkdown } from 'src/ts/parser/parser.svelte'
import ChatBody from './ChatBody.svelte'

const ui = $state({ translated: false, retranslate: false, source: null as string | null })
const mounted: Array<{ target: HTMLElement, instance: Record<string, unknown> }> = []

/** The current chat holds one reply and streams it, so a body at idx 0 is the streaming tail. */
function setDb(over: Record<string, unknown> = {}, streaming = true) {
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
            chats: [{ id: 'cA', modules: [], message: [{ role: 'char', data: 'FIRST' }], isStreaming: streaming }],
        }],
        modules: [],
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
        ...over,
    } as never
}

function mountBody(deferAutoTranslate?: boolean) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props: Record<string, unknown> = {
        character: 'char',
        idx: 0,
        get msgDisplay() { return ui.source ?? 'FIRST' },
        role: 'char',
        get translated() { return ui.translated },
        set translated(value: boolean) { ui.translated = value },
        translating: false,
        get retranslate() { return ui.retranslate },
        set retranslate(value: boolean) { ui.retranslate = value },
        renderRevision: 0,
        modelShortName: '',
    }
    if (deferAutoTranslate !== undefined) {
        props.deferAutoTranslate = deferAutoTranslate
    }
    const instance = mount(ChatBody, { target, props: props as never }) as Record<string, unknown>
    flushSync()
    mounted.push({ target, instance })
    return { target }
}

async function pause(ms: number) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
    flushSync()
    await tick()
}

/** Answers every parse asked so far, three rounds: the decision run, the translate run and any rerun. */
async function answerEveryParse() {
    for (let round = 0; round < 3; round++) {
        for (const parse of h.parses.slice()) {
            parse.resolve(`P:${parse.args[0] as string}`)
        }
        await pause(30)
    }
}

beforeEach(() => {
    h.parses.length = 0
    h.translations.length = 0
    h.llmCacheCalls = 0
    ui.translated = false
    ui.retranslate = false
    ui.source = null
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

describe('S5 a body mounted with deferAutoTranslate shows the parse and does not translate', () => {
    test('R T5.1 auto-translate on, deferred tail: the parse is shown and translateHTML is never called', async () => {
        setDb({ autoTranslate: true })
        const body = mountBody(true)
        await pause(30)
        await answerEveryParse()
        expect(h.translations).toHaveLength(0)
        expect(body.target.innerHTML).toContain('P:FIRST')
    })

    test('R T5.2 three source changes of a deferred tail never translate', async () => {
        setDb({ autoTranslate: true })
        const body = mountBody(true)
        for (const source of ['FIRST a', 'FIRST ab', 'FIRST abc']) {
            ui.source = source
            await pause(30)
            await answerEveryParse()
        }
        expect(h.translations).toHaveLength(0)
        expect(body.target.innerHTML).toContain('P:FIRST abc')
    })

    test('R T5.3 cached-only llm: a deferred tail makes no cache lookup', async () => {
        setDb({ autoTranslate: true, autoTranslateCachedOnly: true, translatorType: 'llm', translateBeforeHTMLFormatting: true })
        mountBody(true)
        await pause(30)
        await answerEveryParse()
        expect(h.llmCacheCalls).toBe(0)
        expect(h.translations).toHaveLength(0)
    })
})

describe('S5 guards: nothing but the prop defers', () => {
    test('G T5.9 auto-translate off: flipping isStreaming adds no parse', async () => {
        setDb({ autoTranslate: false })
        mountBody()
        await pause(30)
        await answerEveryParse()
        const before = vi.mocked(ParseMarkdown).mock.calls.length
        const chat = (DBState.db.characters as unknown as Array<{ chats: Array<{ isStreaming: boolean }> }>)[0].chats[0]
        chat.isStreaming = false
        await pause(30)
        expect(vi.mocked(ParseMarkdown).mock.calls.length).toBe(before)
    })

    test('G T5.10 no prop, auto-translate on, the current chat streaming at the tail: a source change translates', async () => {
        setDb({ autoTranslate: true })
        mountBody()
        await pause(30)
        await answerEveryParse()
        ui.source = 'FIRST more'
        await pause(30)
        await answerEveryParse()
        expect(h.translations.length).toBeGreaterThan(0)
    })
})
