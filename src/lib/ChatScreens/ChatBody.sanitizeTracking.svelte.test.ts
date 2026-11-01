// @vitest-environment jsdom

/**
 * Mounts the real `ChatBody.svelte` with the real `trimMarkdown` (DOMPurify under jsdom). Only `ParseMarkdown` is a held
 * double: every call returns a fresh deferred the row answers. What the body shows is always the sanitized string, whether
 * it is the cache seed or a resolved result, and a mounted body re-sanitizes when `hideAllImages` flips because the
 * sanitizer hooks read it.
 *
 * Labels: G = guard (passes before and after the single-render-site change); each row also fails with an identity
 * `trimMarkdown`, which is the sanitizer mutant these rows exist to kill.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'

//#region module mocks

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

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import ChatBody from './ChatBody.svelte'

const mounted: Array<{ target: HTMLElement, instance: Record<string, unknown> }> = []

function setDb(over: Record<string, unknown> = {}) {
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
        hideAllImages: false,
        characters: [{
            chaId: 'a', type: 'character', chatPage: 0, modules: [], customscript: [],
            chats: [{ id: 'cA', modules: [], message: [] }],
        }],
        modules: [],
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
        ...over,
    } as never
}

function mountBody(msgDisplay = 'FIRST') {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = {
        character: 'char',
        idx: 0,
        msgDisplay,
        role: 'char',
        translated: false,
        translating: false,
        retranslate: false,
        renderRevision: 0,
        modelShortName: '',
    }
    const instance = mount(ChatBody, { target, props: props as never }) as Record<string, unknown>
    flushSync()
    mounted.push({ target, instance })
    return { target, unmountBody: () => unmount(instance) }
}

async function sample(target: HTMLElement): Promise<string> {
    flushSync()
    await tick()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    flushSync()
    await tick()
    return target.innerHTML
}

async function answerParse(index: number, text: string) {
    h.parses[index].resolve(text)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    flushSync()
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

describe('S4 a mounted body re-sanitizes when hideAllImages flips', () => {
    test('G3: the image source becomes the placeholder and a flip back restores it', async () => {
        setDb()
        const body = mountBody()
        await answerParse(0, '<img src="x.png">')
        await sample(body.target)
        expect(body.target.querySelector('img')?.getAttribute('src')).toBe('x.png')

        ;(DBState.db as unknown as { hideAllImages: boolean }).hideAllImages = true
        await sample(body.target)
        expect(body.target.querySelector('img')?.getAttribute('src')).toBe('/none.webp')

        ;(DBState.db as unknown as { hideAllImages: boolean }).hideAllImages = false
        await sample(body.target)
        expect(body.target.querySelector('img')?.getAttribute('src')).toBe('x.png')
    })
})

describe('no path shows unsanitized markup', () => {
    const SEED = '<p>ok</p><img src=x onerror=alert(1)><script>1</script>'
    const RESOLVED = '<p>new</p><img src=y onerror=alert(2)><script>2</script>'

    function expectSanitized(target: HTMLElement, text: string) {
        expect(target.textContent).toContain(text)
        expect(target.querySelector('script')).toBeNull()
        expect(target.querySelector('[onerror]')).toBeNull()
        expect(target.innerHTML).not.toContain('onerror')
    }

    test('G7: the first resolved string, the cache seed and the replacing string are all sanitized', async () => {
        setDb()
        const first = mountBody()
        await answerParse(0, SEED)
        await sample(first.target)
        expectSanitized(first.target, 'ok')
        await first.unmountBody()

        const second = mountBody()
        expect(h.parses).toHaveLength(2)
        await sample(second.target)
        expectSanitized(second.target, 'ok')

        await answerParse(1, RESOLVED)
        await sample(second.target)
        expectSanitized(second.target, 'new')
    })
})
