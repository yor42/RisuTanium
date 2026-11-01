// @vitest-environment happy-dom

/**
 * Mounts the real `ChatBody.svelte` directly. An equal parse result keeps the DOM the seed already made and does not
 * sanitize the string a second time; a different result replaces it. The parser and the translator are held doubles
 * (every call returns a fresh deferred the row answers). `trimMarkdown` is a counting identity: these rows prove render
 * identity and call counts only and no sanitizer behavior; the real sanitizer rows are in
 * `ChatBody.sanitizeTracking.svelte.test.ts`.
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
    trimCalls: 0,
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
    trimMarkdown: (html: string) => {
        h.trimCalls++
        return html
    },
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
vi.mock('src/ts/globalApi.svelte', () => ({ getFileSrc: async () => 'blob:x' }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import ChatBody from './ChatBody.svelte'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'

const ui = $state({
    translated: false, retranslate: false, revision: 0, source: null as string | null, raw: false, rawText: '',
})
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
            additionalAssets: [['pic.png', 'assets/pic.png']], prebuiltAssetStyle: '',
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
        get renderRawStreaming() { return ui.raw },
        get rawStreamingText() { return ui.rawText },
        bodyRoot: target,
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

// Production scheduling: no flushSync() or tick() between a change and its sample.
async function settle(target: HTMLElement) {
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
    return { html: target.innerHTML, indicators: target.querySelectorAll('[role="status"]').length }
}

async function answerParse(index: number, text: string) {
    h.parses[index].resolve(text)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    flushSync()
}

function gateOnUnloadedModule() {
    const db = DBState.db as unknown as { modules: unknown[], enabledModules: string[] }
    db.modules.push({ id: 'm1', name: 'm1', description: '', [MODULE_STUB_KEY]: 1 })
    db.enabledModules.push('m1')
}

beforeEach(() => {
    h.parses.length = 0
    h.translations.length = 0
    h.trimCalls = 0
    ui.translated = false
    ui.retranslate = false
    ui.revision = 0
    ui.source = null
    ui.raw = false
    ui.rawText = ''
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

const MARKED = '<p id="k">A</p>'

describe('S1 a remount whose parse returns the seeded string keeps the seeded DOM', () => {
    async function remountWithSameResult() {
        setDb()
        const first = mountBody()
        await answerParse(0, MARKED)
        expect(await sample(first.target)).toContain('id="k"')
        await first.unmountBody()

        h.trimCalls = 0
        const second = mountBody()
        expect(h.parses).toHaveLength(2)
        await sample(second.target)
        const seeded = second.target.querySelector('#k')
        expect(seeded).not.toBeNull()

        await answerParse(1, MARKED)
        await sample(second.target)
        return { target: second.target, seeded }
    }

    test('R1: the second body keeps the element its seed made', async () => {
        const { target, seeded } = await remountWithSameResult()
        expect(target.querySelector('#k')).toBe(seeded)
    })

    test('R1: the second body sanitizes the string once', async () => {
        await remountWithSameResult()
        expect(h.trimCalls).toBe(1)
    })

    test('G2: every remount starts exactly one parse even when the cache holds the html', async () => {
        setDb()
        const first = mountBody()
        await answerParse(0, MARKED)
        await sample(first.target)
        await first.unmountBody()
        expect(h.parses).toHaveLength(1)

        mountBody()
        expect(h.parses).toHaveLength(2)
    })

    test('G a different result replaces the seed once and the old render is gone', async () => {
        setDb()
        const first = mountBody()
        await answerParse(0, MARKED)
        await sample(first.target)
        await first.unmountBody()

        h.trimCalls = 0
        const second = mountBody()
        await sample(second.target)
        await answerParse(1, '<p id="k">B</p>')
        const seen = await sample(second.target)
        expect(seen).toContain('>B<')
        expect(seen).not.toContain('>A<')
        expect(h.trimCalls).toBe(2)
    })
})

describe('S5 image repair follows the DOM that holds the markup', () => {
    const IMG = '<img src="pic.png">'

    test('G4: an image in a newly committed string is repaired', async () => {
        setDb({ newImageHandlingBeta: true })
        const body = mountBody()
        await answerParse(0, 'A')
        await sample(body.target)

        ui.revision = 1
        flushSync()
        await answerParse(1, IMG)
        await sample(body.target)
        await settle(body.target)
        expect(body.target.querySelector('img')?.getAttribute('src')).toBe('blob:x')
    })

    test('G6: the same string shown again after an indicator is repaired on the re-created DOM', async () => {
        setDb({ newImageHandlingBeta: true })
        const body = mountBody('FIRST')
        await answerParse(0, IMG)
        await settle(body.target)
        expect(body.target.querySelector('img')?.getAttribute('src')).toBe('blob:x')

        // A gated run has no render for another source: the html site is replaced by the indicator.
        gateOnUnloadedModule()
        ui.source = 'OTHER'
        const gated = await settle(body.target)
        expect(gated.indicators).toBe(1)
        expect(body.target.querySelector('img')).toBeNull()

        ui.source = null
        await settle(body.target)
        const db = DBState.db as unknown as { modules: unknown[], enabledModules: string[] }
        db.modules.pop()
        db.enabledModules.pop()
        await settle(body.target)
        expect(h.parses).toHaveLength(2)
        await answerParse(1, IMG)
        await settle(body.target)
        const again = body.target.querySelector('img')
        expect(again).not.toBeNull()
        expect(again?.getAttribute('src')).toBe('blob:x')
    })
})

describe('S3 gated and raw-streaming bodies', () => {
    test('G5: two consecutive gated runs show the indicator for the new source', async () => {
        setDb({
            modules: [{ id: 'm1', name: 'm1', description: '', [MODULE_STUB_KEY]: 1 }],
            enabledModules: ['m1'],
        })
        const body = mountBody('X')
        expect((await settle(body.target)).indicators).toBe(1)

        ui.source = 'Y'
        const second = await settle(body.target)
        expect(second.indicators).toBe(1)
        expect(h.parses).toHaveLength(0)
    })

    test('G M10: a gated run after a rendered source never shows the earlier render', async () => {
        setDb()
        const body = mountBody('X')
        h.parses[0].resolve('P:X')
        expect((await settle(body.target)).html).toContain('P:X')

        gateOnUnloadedModule()
        expect((await settle(body.target)).html).toContain('P:X')

        ui.source = 'Y'
        const gated = await settle(body.target)
        expect(gated.html).not.toContain('P:X')
        expect(gated.indicators).toBe(1)
    })

    test('G C1: raw streaming never starts a parse', async () => {
        setDb()
        ui.raw = true
        ui.rawText = 'a'
        const body = mountBody('X')
        for (const next of ['Xa', 'Xab', 'Xabc']) {
            ui.source = next
            ui.rawText = next
            await sample(body.target)
        }
        expect(body.target.textContent).toContain('Xabc')
        expect(h.parses).toHaveLength(0)
    })
})
