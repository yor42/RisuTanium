// @vitest-environment happy-dom

/**
 * Mounts the real `ChatBody.svelte` directly. The parser and the translator are held doubles: every `ParseMarkdown`
 * and `translateHTML` call returns a fresh deferred that the row answers, so the display between a call and its answer
 * can be sampled. `renderRevision`, `translated` and `retranslate` are props over this file's own `$state`.
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
import ChatBody from './ChatBody.svelte'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'

const ui = $state({ translated: false, retranslate: false, revision: 0, source: null as string | null })
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
        get msgDisplay() { return ui.source ?? msgDisplay },
        role: 'char',
        get translated() { return ui.translated },
        set translated(value: boolean) { ui.translated = value },
        translating: false,
        get retranslate() { return ui.retranslate },
        set retranslate(value: boolean) { ui.retranslate = value },
        get renderRevision() { return ui.revision },
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

async function answerTranslation(index: number, text: string) {
    h.translations[index].resolve(text)
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    flushSync()
}

beforeEach(() => {
    h.parses.length = 0
    h.translations.length = 0
    ui.translated = false
    ui.retranslate = false
    ui.revision = 0
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

describe('T7 row 1: a late result of a superseded run never becomes the seed', () => {
    test('R out-of-order runs of one instance leave the latest result for the next instance', async () => {
        setDb()
        const first = mountBody()
        await answerParse(0, 'A')
        expect(await sample(first.target)).toContain('A')

        ui.revision = 1
        flushSync()
        ui.revision = 2
        flushSync()
        expect(h.parses).toHaveLength(3)
        await answerParse(2, 'C')
        await answerParse(1, 'B')
        expect(await sample(first.target)).toContain('C')

        await first.unmountBody()
        const second = mountBody()
        expect(h.parses).toHaveLength(4)
        const seen = await sample(second.target)
        expect(seen).toContain('C')
        expect(seen).not.toContain('B')
    })
})

const SPINNER = 'animation: spin'

describe('G T21 a user-initiated translate keeps the translation spinner', () => {
    test('row 1: translate switched on over a rendered message shows the spinner, not the old text', async () => {
        setDb({ showTranslationLoading: true })
        const body = mountBody()
        await answerParse(0, 'P:FIRST')
        expect(await sample(body.target)).toContain('P:FIRST')

        ui.translated = true
        const seen = await sample(body.target)
        expect(seen).toContain(SPINNER)
        expect(seen).not.toContain('P:FIRST')
    })

    async function renderTranslated() {
        setDb({ showTranslationLoading: true, autoTranslate: true })
        const body = mountBody()
        // The first run decides to translate and flips `translated` after a timer; the second run translates.
        await new Promise<void>((resolve) => setTimeout(resolve, 30))
        await sample(body.target)
        await answerParse(0, 'P:FIRST')
        await sample(body.target)
        await answerTranslation(0, 'T:P:FIRST')
        expect(await sample(body.target)).toContain('T:P:FIRST')
        return body
    }

    test('row 2: retranslate over a rendered translation shows the spinner, not the old text', async () => {
        const body = await renderTranslated()
        const parsesBefore = h.parses.length
        ui.retranslate = true
        const seen = await sample(body.target)
        expect(h.parses.length).toBeGreaterThan(parsesBefore)
        expect(seen).toContain(SPINNER)
        expect(seen).not.toContain('T:P:FIRST')
    })

    test('row 3: a revision change keeps the old translated text and shows no spinner', async () => {
        const body = await renderTranslated()
        const parsesBefore = h.parses.length
        ui.revision = 1
        const seen = await sample(body.target)
        expect(h.parses.length).toBeGreaterThan(parsesBefore)
        expect(seen).toContain('T:P:FIRST')
        expect(seen).not.toContain(SPINNER)
    })
})

// Production scheduling: no flushSync() or tick() between a change and its sample, so Svelte's own queued pending
// check runs after the already-resolved gated run. flushSync() would run that check first and hide the defect.
async function settle(target: HTMLElement) {
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
    return { html: target.innerHTML, indicators: target.querySelectorAll('[role="status"]').length }
}

describe('R F1 an in-place source change during a gated load never shows the earlier source', () => {
    test('a gated run after a gated run that showed the cached html shows the indicator for the new source', async () => {
        setDb()
        const body = mountBody('X')
        h.parses[0].resolve('P:X')
        const rendered = await settle(body.target)
        expect(rendered.html).toContain('P:X')

        // A referenced module that has not loaded yet gates every run: the same source keeps its cached html.
        const db = DBState.db as unknown as { modules: unknown[], enabledModules: string[] }
        db.modules.push({ id: 'm1', name: 'm1', description: '', [MODULE_STUB_KEY]: 1 })
        db.enabledModules.push('m1')
        const gatedSame = await settle(body.target)
        expect(gatedSame.html).toContain('P:X')

        ui.source = 'Y'
        await settle(body.target)
        await new Promise<void>((resolve) => setTimeout(resolve, 200))
        const gatedChanged = await settle(body.target)
        expect(gatedChanged.html).not.toContain('P:X')
        expect(gatedChanged.indicators).toBe(1)
        expect(h.parses).toHaveLength(1)
    })
})
