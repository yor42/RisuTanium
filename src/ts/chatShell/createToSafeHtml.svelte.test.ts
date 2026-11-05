// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

const law = vi.hoisted(() => ({ applies: false }))
const mutant = vi.hoisted(() => ({ identitySanitize: false, dropWatermark: false }))
const calls = vi.hoisted(() => ({ markdown: [] as unknown[][], display: [] as unknown[][] }))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [], hideAllImages: false } })
    return {
        DBState: state,
        selIdState: { selId: -1 },
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({}),
    }
})

vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => law.applies,
    getFileSrc: async () => '',
    setUsingSw: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
    getModules: () => [],
    moduleUpdate: () => {},
}))

vi.mock('src/ts/process/files/inlays', () => ({ getInlayRender: vi.fn(async () => null) }))

// The factory is run for real; only the identity and watermark mutants wrap the real parser functions.
vi.mock('../parser/parser.svelte', async (importOriginal) => {
    const original = await importOriginal<typeof import('../parser/parser.svelte')>()
    return {
        ...original,
        ParseMarkdown: async (...args: Parameters<typeof original.ParseMarkdown>) => {
            calls.markdown.push(args)
            return original.ParseMarkdown(...args)
        },
        trimMarkdown: (html: string) => mutant.identitySanitize ? html : original.trimMarkdown(html),
        addMetadataToElement: (html: string, model: string) => mutant.dropWatermark ? html : original.addMetadataToElement(html, model),
    }
})

vi.mock('../process/scripts', () => ({
    risuChatParser: (text: string, options: unknown) => {
        calls.display.push([text, options])
        return text.replace('{{user}}', 'Ari')
    },
}))

import { createToSafeHtml } from './streamingSafe'

let parser: typeof import('../parser/parser.svelte')
beforeAll(async () => { parser = await import('../parser/parser.svelte') })
afterEach(() => {
    law.applies = false
    mutant.identitySanitize = false
    mutant.dropWatermark = false
    calls.markdown = []
    calls.display = []
})

const hostile = '<img src=x onerror="alert(1)"> hi'

// The guard the production wiring must satisfy: handlers stripped and, when the law applies, the metadata present.
let reference: typeof import('../parser/parser.svelte')
beforeAll(async () => { reference = await vi.importActual<typeof import('../parser/parser.svelte')>('../parser/parser.svelte') })

async function assertWiring(html: string): Promise<void> {
    const element = document.createElement('div')
    element.innerHTML = html
    expect(element.querySelector('img')).not.toBeNull()
    expect(element.querySelector('img')?.hasAttribute('onerror')).toBe(false)
    const displayed = await reference.ParseMarkdown(hostile, null, 'notrim')
    expect(html).toBe(reference.addMetadataToElement(reference.trimMarkdown(displayed), 'model'))
    expect(html.length).toBeGreaterThan(reference.trimMarkdown(displayed).length)
}

describe('createToSafeHtml production wiring (MC-239)', () => {
    test('strips handlers and watermarks the sanitized markup when the law applies', async () => {
        law.applies = true
        const convert = await createToSafeHtml('model')
        await assertWiring(await convert(hostile))
    })

    test('passes no watermark when the law does not apply', async () => {
        const convert = await createToSafeHtml('model')
        const html = await convert(hostile)
        expect(html).toBe(parser.trimMarkdown(await parser.ParseMarkdown(hostile, null, 'notrim')))
    })

    test('an identity sanitize mutant in the factory fails the wiring guard', async () => {
        law.applies = true
        mutant.identitySanitize = true
        const convert = await createToSafeHtml('model')
        const html = await convert(hostile)
        expect(html).toContain('onerror')
        await expect(assertWiring(html)).rejects.toThrow()
    })

    test('a dropped watermark mutant in the factory fails the wiring guard', async () => {
        law.applies = true
        mutant.dropWatermark = true
        const convert = await createToSafeHtml('model')
        const html = await convert(hostile)
        await expect(assertWiring(html)).rejects.toThrow()
    })

    test('the display parse and the markdown parse receive the message index and the chat conditions', async () => {
        const cbsConditions = { firstmsg: false, chatRole: 'char' }
        const displayOptions = { chara: 'Ari', chatID: 7, rmVar: true, visualize: true, cbsConditions }
        const convert = await createToSafeHtml('model', null, { chatID: 7, cbsConditions, displayOptions })
        const html = await convert('hello {{user}}')
        expect(html).toContain('hello Ari')
        expect(calls.display).toEqual([['hello {{user}}', displayOptions]])
        expect(calls.markdown[0].slice(2)).toEqual(['notrim', 7, cbsConditions])
    })
})
