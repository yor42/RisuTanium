// @vitest-environment jsdom

/**
 * The Beta image repair (`checkImg`) writes nothing to the console: a chat with many images must not log every asset
 * name and the whole asset list on every render. The body is mounted with a `bodyRoot` and Beta on, because `checkImg`
 * returns before doing anything without both.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'

interface Held {
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
        selIdState: { selId: 0 },
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
    }
})

vi.mock('src/ts/parser/parser.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/parser/parser.svelte')>()
    return {
        ...actual,
        ParseMarkdown: vi.fn(() => new Promise<string>((resolve) => { h.parses.push({ resolve }) })),
    }
})

vi.mock('src/ts/translator/translator', () => ({
    getLLMCache: async () => null,
    waitForTranslatorModules: async () => {},
    translateHTML: vi.fn(() => new Promise<string>(() => {})),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertWait: vi.fn(),
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
    return { appVer: '1234.5.67', getDatabase: db, getCurrentCharacter, getCurrentChat }
})

vi.mock('src/ts/process/modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
    moduleUpdate: () => {},
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: async () => '',
    setUsingSw: vi.fn(),
    readImage: vi.fn(),
}))

vi.mock('src/ts/process/files/inlays', () => ({ getInlayRender: vi.fn(async () => null) }))

import { DBState } from 'src/ts/stores.svelte'
import ChatBody from './ChatBody.svelte'

const mounted: Array<{ target: HTMLElement, instance: Record<string, unknown> }> = []

function setDb() {
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
        newImageHandlingBeta: true,
        hideAllImages: false,
        assetMaxDifference: 4,
        characters: [{
            chaId: 'a', type: 'character', chatPage: 0, modules: [], customscript: [],
            chats: [{ id: 'cA', modules: [], message: [] }],
        }],
        modules: [],
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
    } as never
}

beforeEach(() => {
    h.parses.length = 0
    clearChatBodyRenderCache()
})

afterEach(async () => {
    for (const row of mounted.splice(0)) {
        await unmount(row.instance).catch(() => {})
        row.target.remove()
    }
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

test('the Beta repair of an unresolved image logs nothing, and still marks an image no asset matches', async () => {
    setDb()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = {
        character: 'char',
        idx: 0,
        msgDisplay: 'FIRST',
        role: 'char',
        translated: false,
        translating: false,
        retranslate: false,
        renderRevision: 0,
        modelShortName: '',
        bodyRoot: target,
    }
    const instance = mount(ChatBody, { target, props: props as never }) as Record<string, unknown>
    mounted.push({ target, instance })
    flushSync()

    h.parses[0].resolve('<img src="hero.png">')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    flushSync()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(target.querySelector('img')?.getAttribute('noimage')).toBe('true')
    expect(log).not.toHaveBeenCalled()
})
