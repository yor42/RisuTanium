// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { renderOpenParagraphSource, toSafeHtml } from './streamingSafe'

const law = vi.hoisted(() => ({ applies: false }))

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

let parser: typeof import('../parser/parser.svelte')

beforeAll(async () => {
    parser = await import('../parser/parser.svelte')
})

describe('T12 / MC-239 streaming sanitizer', () => {
    test('partial image tag is cut and a completed event handler is stripped by real DOMPurify', () => {
        const partial = renderOpenParagraphSource('before <img src=x onerror=alert(1)')
        const deps = { display: (source: string) => source, sanitize: parser.trimMarkdown, watermark: (html: string) => html }
        const partialHtml = toSafeHtml(partial, deps)
        expect(partialHtml).toBe('before ')
        expect(partialHtml).not.toContain('onerror')

        const complete = toSafeHtml('<img src=x onerror="alert(1)">', deps)
        const element = document.createElement('div')
        element.innerHTML = complete
        expect(element.querySelector('img')).not.toBeNull()
        expect(element.querySelector('img')?.hasAttribute('onerror')).toBe(false)
    })

    test('identity sanitizer makes the completed-handler assertion fail', () => {
        const unsafe = toSafeHtml('<img src=x onerror="alert(1)">', {
            display: (source) => source,
            sanitize: (html) => html,
            watermark: (html) => html,
        })
        expect(unsafe).toContain('onerror=')
        expect(unsafe).not.toBe(parser.trimMarkdown(unsafe))
    })

    test('watermark follows first sanitize and final sanitize runs last', () => {
        law.applies = true
        const log: string[] = []
        const sanitize = vi.fn((html: string) => {
            log.push('sanitize')
            return parser.trimMarkdown(html)
        })
        const watermark = vi.fn((html: string) => {
            log.push('watermark')
            return parser.addMetadataToElement(html, 'model')
        })
        const display = vi.fn((source: string) => {
            log.push('display')
            return source
        })
        try {
            const result = toSafeHtml('<p>Hello</p>', { display, sanitize, watermark })
            expect(log).toEqual(['display', 'sanitize', 'watermark', 'sanitize'])
            expect(result).toContain('<p>')
            expect(result.length).toBeGreaterThan('<p>Hello</p>'.length)
        } finally {
            law.applies = false
        }
    })
})
