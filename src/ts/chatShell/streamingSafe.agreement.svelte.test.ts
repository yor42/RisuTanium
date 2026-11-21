// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { COLD_TRANSFORM_HOOK_MS } from '../tests/coldTransform.test-helpers'
import { splitStreamingText } from './streamingSafe'

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
    aiWatermarkingLawApplies: () => false,
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

// The parser's graph is slow to transform cold; this hook pays that before any test starts.
beforeAll(async () => {
    parser = await import('../parser/parser.svelte')
}, COLD_TRANSFORM_HOOK_MS)

async function render(source: string): Promise<HTMLElement> {
    const host = document.createElement('div')
    host.innerHTML = parser.trimMarkdown(await parser.ParseMarkdown(source, null, 'notrim'))
    return host
}

async function counts(source: string): Promise<{ breaks: number, pre: number }> {
    const host = await render(source)
    return { breaks: host.querySelectorAll('hr[data-risu-scene-break]').length, pre: host.querySelectorAll('pre').length }
}

// Line-shaped pieces: every top-level line decision is one the splitter and markdown-it must make the same way.
const LINES = ['~~~', '~~~ts', '~~~~', '```', 'word', 'more words', '', '', '- item', '# head']

function makeRng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 4294967296
    }
}

function makeText(rng: () => number): string {
    const count = 1 + Math.floor(rng() * 10)
    return Array.from({ length: count }, () => LINES[Math.floor(rng() * LINES.length)]).join('\n')
}

describe('T-SB-11 the streaming split and the finished render agree on fences and scene breaks', () => {
    test('rendering the finished blocks one by one equals rendering the whole text, over 200 seeded texts', async () => {
        const rng = makeRng(444)
        for (let n = 0; n < 200; n++) {
            const text = makeText(rng) + '\n\nEND'
            const split = splitStreamingText(text)
            const blockwise = { breaks: 0, pre: 0 }
            for (const piece of [...split.finished, split.open]) {
                const part = await counts(piece)
                blockwise.breaks += part.breaks
                blockwise.pre += part.pre
            }
            expect({ text, ...blockwise }, JSON.stringify(text)).toEqual({ text, ...(await counts(text)) })
        }
    }, 60000)

    test('a blockquote form is split at its quote lines, so the splitter never holds it as a fence', async () => {
        const text = '> ~~~\n>\n> x'
        const split = splitStreamingText(text)
        expect(split.finished[0]).toBe('> ~~~\n')
        expect(await counts(text)).toEqual({ breaks: 1, pre: 0 })
    })
})
