// @vitest-environment jsdom
/**
 * Every text field of the Playground screens is named through aria-labelledby to its visible label, with that label
 * first in aria-describedby (TalkBack speaks only the description in the field's own stop), and the CheckInput sites
 * that had no name carry aria-label. REAL: the eleven Playground screens, the inlay explorer, TextInput, TextAreaInput
 * (the highlight module is mocked, as TextAreaInput's own tests do), CheckInput and the real language table.
 * MOCKED: the stores, the request, parser, tokenizer, translator, MCP, embedding and inlay modules that the screens
 * import, with the shapes each screen reads at mount.
 * Excluded from the field assertion, with the reason: select and number controls belong to #334 (MC-2562), and the
 * helper's field selector does not list them.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { controlDescription, controlName, exposedIcons, unnamedControls } from '../a11yNames.test-helpers'

const h = vi.hoisted(() => ({
    db: {
        hotkeys: [], longPressToPopupEditor: false, modules: [], enabledModules: [], characters: [], personas: [], moduleIntergration: '',
        language: 'en', aiModel: 'test', useStreaming: true, openAIKey: 'key', translatorType: 'llm',
        hypaModel: 'MiniLM', supaMemoryKey: '', hypaCustomSettings: { url: '', key: '', model: '' },
    } as Record<string, unknown>,
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { get db() { return h.db } },
    disableHighlight: writable(false),
    popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    selectedCharID: writable(-1),
    ReloadGUIPointer: writable(0),
}))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => h.db, getCurrentCharacter: () => null, getCurrentChat: () => null }))
vi.mock('src/ts/gui/guisize', () => ({ textAreaSize: writable(0), textAreaTextSize: writable(1) }))
vi.mock('src/ts/gui/highlight', () => ({ highlighter: vi.fn(), getNewHighlightId: vi.fn(() => 1), removeHighlight: vi.fn(), AllCBS: ['random', 'randint'] }))
vi.mock('src/ts/platform', () => ({ isMobile: false }))
vi.mock('src/ts/hotkey', () => ({ hotkeyMatches: vi.fn(() => false) }))
vi.mock('src/ts/util', () => ({
    sleep: vi.fn(async () => {}), checkPersonaBinded: () => false, jsonOutputTrimmer: (value: string) => value,
    selectSingleFile: vi.fn(), selectFileByDom: vi.fn(), asBuffer: (value: ArrayBuffer) => value,
}))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertMd: vi.fn(), alertSelect: vi.fn(), alertConfirm: vi.fn(async () => true) }))
vi.mock('src/ts/translator/translator', () => ({ runTranslator: vi.fn(async (text: string) => text), LLMCacheStorage: { clear: vi.fn() } }))
vi.mock('src/ts/globalApi.svelte', () => ({ getLanguageCodes: () => [{ code: 'en', name: 'English' }], AppendableBuffer: class {}, downloadFile: vi.fn() }))
vi.mock('src/ts/tokenizer', () => ({ tokenize: async () => 0, encodeWithTokenizer: async () => [], tokenizerList: [['tik', 'Tiktoken']] }))
vi.mock('src/ts/parser/parser.svelte', () => ({ risuChatParser: (value: string) => value, ParseMarkdown: async (value: string) => value, parseMarkdownSafe: (value: string) => value }))
vi.mock('src/ts/process/request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('src/ts/process/subtitleRequest', () => ({ requestSubtitleModel: vi.fn() }))
vi.mock('src/ts/process/onnxRuntimeSource', () => ({ useBundledOnnxRuntime: vi.fn() }))
vi.mock('src/ts/process/request/secretKey', () => ({ currentKey: vi.fn() }))
vi.mock('src/ts/secretRef', () => ({ resolveSecret: vi.fn(), SecretRefError: class extends Error {} }))
vi.mock('src/ts/model/modellist', () => ({ getModelInfo: () => ({ flags: [] }), LLMFlags: { hasAudioInput: 'audio', hasVideoInput: 'video', hasStreaming: 'stream' } }))
vi.mock('src/ts/process/stableDiff', () => ({ generateAIImage: vi.fn() }))
vi.mock('src/ts/characters', () => ({ createBlankChar: vi.fn() }))
vi.mock('src/ts/process/mcp/mcp', () => ({
    initializeMCPs: vi.fn(), getMCPMeta: vi.fn(async () => ({})), getMCPTools: vi.fn(async () => []), callMCPTool: vi.fn(),
}))
vi.mock('src/ts/process/memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('src/ts/process/memory/embeddingModels', () => ({ DEFAULT_HYPA_MODEL: 'MiniLM' }))
vi.mock('src/ts/process/moduleEnsure', () => ({ ensurePlaygroundModulesOrAlert: vi.fn(async () => true) }))
vi.mock('src/ts/process/moduleRefList', () => ({ hasModuleStubs: () => false, unloadedModulesOf: () => [] }))
vi.mock('src/ts/cbs', () => ({ defaultCBSRegisterArg: {}, registerCBS: vi.fn() }))
vi.mock('src/ts/process/files/inlays', () => ({
    listInlayAssets: vi.fn(async () => [['inlay-1', { name: 'cat.png', type: 'audio', size: 1 }]]),
    getInlayRender: vi.fn(async () => null),
    removeInlayAsset: vi.fn(),
}))

import { language } from 'src/lang'
import PlaygroundDocs from './PlaygroundDocs.svelte'
import PlaygroundEmbedding from './PlaygroundEmbedding.svelte'
import PlaygroundImageGen from './PlaygroundImageGen.svelte'
import PlaygroundImageTrans from './PlaygroundImageTrans.svelte'
import PlaygroundInlayExplorer from './PlaygroundInlayExplorer.svelte'
import PlaygroundJinja from './PlaygroundJinja.svelte'
import PlaygroundMCP from './PlaygroundMCP.svelte'
import PlaygroundParser from './PlaygroundParser.svelte'
import PlaygroundSubtitle from './PlaygroundSubtitle.svelte'
import PlaygroundSyntax from './PlaygroundSyntax.svelte'
import PlaygroundTokenizer from './PlaygroundTokenizer.svelte'
import PlaygroundTranslation from './PlaygroundTranslation.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

async function show(component: Parameters<typeof mount>[0], settle = false): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(component, { target }))
    flushSync()
    if (settle) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        flushSync()
    }
    return target
}

const FIELDS = 'input[type="text"], input:not([type]), textarea, [role="textbox"]'
const fields = (target: HTMLElement) => [...target.querySelectorAll<HTMLElement>(FIELDS)]

/** The field's name, and whether its description starts with the label element that names it. */
function named(el: HTMLElement): string {
    const labelId = el.getAttribute('aria-labelledby') ?? ''
    expect(labelId).not.toBe('')
    expect(el.getAttribute('aria-describedby')!.split(' ')[0]).toBe(labelId)
    expect(controlDescription(el).startsWith(controlName(el))).toBe(true)
    return controlName(el)
}

beforeEach(() => {
    h.db.hypaModel = 'MiniLM'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('Playground field names', () => {
    test('Docs: the search field is named by its placeholder text', async () => {
        const target = await show(PlaygroundDocs)
        expect(fields(target).map(named)).toEqual([language.playground.docsSearchPlaceholder])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('ImageGen: prompt and negative prompt are named by their visible labels', async () => {
        const target = await show(PlaygroundImageGen)
        expect(fields(target).map(named)).toEqual([language.prompt, language.playground.negPrompt])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('Embedding: the query and each added data row are named; the custom endpoint fields are named', async () => {
        const target = await show(PlaygroundEmbedding)
        const add = [...target.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent!.trim() === '+')!
        add.click()
        add.click()
        flushSync()
        expect(fields(target).map(named)).toEqual([language.playground.query, language.playground.data, language.playground.data])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('Embedding: the custom model shows the URL, key and request-model fields, each named', async () => {
        h.db.hypaModel = 'custom'
        const target = await show(PlaygroundEmbedding)
        expect(fields(target).map(named)).toEqual(['URL', language.proxyAPIKey, language.playground.requestModel, language.playground.query])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('Embedding: an OpenAI model shows the API key field, named', async () => {
        h.db.hypaModel = 'openai3small'
        const target = await show(PlaygroundEmbedding)
        expect(fields(target).map(named)).toEqual(['OpenAI API Key', language.playground.query])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('ImageTrans: language, prompt and font are named; the JSON field is absent until there is output', async () => {
        const target = await show(PlaygroundImageTrans)
        expect(fields(target).map(named)).toEqual([language.destinationLanguage, language.prompt, language.font])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('Jinja: template, data and result are named', async () => {
        const target = await show(PlaygroundJinja)
        expect(fields(target).map(named)).toEqual(['Jinja', language.playground.jinjaData, language.playground.result])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('MCP: the metadata field is named; each tool input is named by the tool name', async () => {
        const mcp = await import('src/ts/process/mcp/mcp')
        vi.mocked(mcp.getMCPTools).mockResolvedValueOnce([
            { name: 'search', description: 'd', inputSchema: {}, url: 'u' },
            { name: 'fetch', description: 'd', inputSchema: {}, url: 'u' },
        ] as never)
        const target = await show(PlaygroundMCP)
        expect(fields(target).map(named)).toEqual([language.playground.metadatas])
        ;[...target.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent!.trim() === language.playground.refresh)!.click()
        await new Promise((resolve) => setTimeout(resolve, 10))
        flushSync()
        expect(fields(target).map(named)).toEqual([language.playground.metadatas, 'search', 'fetch'])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('Parser: input and output are named', async () => {
        const target = await show(PlaygroundParser)
        expect(fields(target).map(named)).toEqual([language.input, language.playground.outputHtml])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('Subtitle: the destination language and prompt are named', async () => {
        const target = await show(PlaygroundSubtitle)
        expect(fields(target).map(named)).toEqual([language.destinationLanguage, language.prompt])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('Syntax: the highlighted input (contenteditable) and the result are named', async () => {
        const target = await show(PlaygroundSyntax)
        expect(target.querySelector('[role="textbox"]')).not.toBeNull()
        expect(fields(target).map(named)).toEqual([language.input, language.playground.result])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('Tokenizer: input and result are named', async () => {
        const target = await show(PlaygroundTokenizer)
        expect(fields(target).map(named)).toEqual([language.input, language.playground.result])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('Translation: both text areas are named by their language labels, and both checkboxes by their text', async () => {
        const target = await show(PlaygroundTranslation)
        expect(fields(target).map(named)).toEqual([language.sourceLanguage, language.translatorLanguage])
        const bulk = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        expect(bulk.getAttribute('aria-label')).toBe(language.playground.bulk)
        bulk.click()
        flushSync()
        const boxes = [...target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual([language.playground.bulk, language.playground.keepContext])
        expect(boxes.every((box) => !box.hasAttribute('aria-labelledby'))).toBe(true)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('InlayExplorer: the selection checkbox of each asset is named by the asset name', async () => {
        const target = await show(PlaygroundInlayExplorer, true)
        const boxes = [...target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual(['cat.png'])
        expect(boxes[0].hasAttribute('aria-labelledby')).toBe(false)
        expect(controlName(boxes[0])).toBe('cat.png')
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })
})
