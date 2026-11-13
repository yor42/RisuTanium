/**
 * The dynamic-asset block of `processScriptFull` (`./scripts`) and its two caches: the script cache, keyed by the
 * pass's inputs, and the best-match cache, keyed by the missed asset name. Both must stop serving a name that a
 * rename, removal or merge of a character asset or a module asset has taken away.
 *
 * Runs the real `processScriptFull`; the similarity search is a stand-in that answers with the last live name it
 * was given, and everything else the module imports is mocked inert.
 *
 * Tests titled `regression reproducer:` fail while a cache key leaves out the asset names; tests titled `guard:`
 * pin behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { character, customscript } from '../storage/database.svelte'
import type { ScriptMode } from './scripts'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    moduleAssets: [] as string[][],
    searches: 0,
}))

vi.mock('../stores.svelte', () => ({
    CharEmotion: writable({}),
    selectedCharID: writable(0),
}))

vi.mock('../storage/database.svelte', () => ({
    getDatabase: () => h.db,
    getCurrentCharacter: () => ({ type: 'simple' }),
    getCurrentChat: () => ({}),
}))

vi.mock('../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('../util', () => ({ selectSingleFile: vi.fn() }))
vi.mock('../parser/parser.svelte', () => ({
    assetRegex: /{{(raw|path|img|image|video|audio|bgm|bgmloop|emotion|asset|video-img|source)::(.+?)}}/g,
    risuChatParser: (data: string) => data,
}))
vi.mock('./modules', () => ({
    getModuleAssets: () => h.moduleAssets,
    getModuleRegexScripts: () => [],
}))
vi.mock('./memory/hypamemory', () => ({
    HypaProcesser: class {
        names: string[] = []
        async addText(names: string[]) { this.names = names }
        async similaritySearch() { h.searches++; return [this.names[this.names.length - 1]] }
    },
}))
vi.mock('./scriptings', () => ({
    runLuaEditTrigger: async (_char: unknown, _mode: string, data: string) => data,
}))
vi.mock('../plugins/plugins.svelte', () => ({
    pluginV2: {
        editdisplay: new Set(),
        editoutput: new Set(),
        editprocess: new Set(),
        editinput: new Set(),
        chatOutput: new Set(),
    },
}))
vi.mock('./triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('./chatOrigin', () => ({ createRunSubject: vi.fn() }))

import { processScriptFull, resetScriptCache, scriptPassCountersForTests, resetScriptPassCountersForTests } from './scripts'

const script = (v: Partial<customscript>): customscript => ({
    comment: '',
    in: '',
    out: '',
    type: 'editoutput',
    ...v,
} as customscript)

// One script that matches nothing, so the pass runs its script loop and reaches the dynamic-asset block.
function makeChar(chaId: string, assetNames: string[]): character {
    return {
        type: 'character',
        chaId,
        customscript: [script({ type: 'editoutput', in: 'zzz', out: 'yyy' })],
        additionalAssets: assetNames.map((name) => [name, `assets/${name}.png`, 'png']),
        firstMessage: '',
        alternateGreetings: [],
    } as unknown as character
}

const run = (char: character, data: string, mode: ScriptMode = 'editoutput') =>
    processScriptFull(char, data, mode, -1)

const hits = () => scriptPassCountersForTests().cacheHits

beforeEach(() => {
    resetScriptCache()
    resetScriptPassCountersForTests()
    h.moduleAssets = []
    h.searches = 0
    h.db = { presetRegex: [], dynamicAssets: true, dynamicAssetsEditDisplay: false, characters: [] }
})

describe('a renamed asset and the script cache', () => {
    test('regression reproducer: a character asset renamed between two passes over the same text is matched again', async () => {
        expect((await run(makeChar('sc-char-rename', ['B']), '{{image::X}}')).data).toBe('{{image::B}}')

        const second = await run(makeChar('sc-char-rename', ['A']), '{{image::X}}')

        expect(second.data).toBe('{{image::A}}')
        expect(hits()).toBe(0)
    })

    test('regression reproducer: a module asset renamed between two passes over the same text is matched again', async () => {
        h.moduleAssets = [['B', 'assets/mod-B.png', 'png']]
        expect((await run(makeChar('sc-mod-rename', ['Z']), '{{image::X}}')).data).toBe('{{image::B}}')

        h.moduleAssets = [['A', 'assets/mod-A.png', 'png']]
        const second = await run(makeChar('sc-mod-rename', ['Z']), '{{image::X}}')

        expect(second.data).toBe('{{image::A}}')
        expect(hits()).toBe(0)
    })

    test('guard: unchanged asset names serve the second pass from the script cache', async () => {
        const first = await run(makeChar('sc-same', ['B']), '{{image::X}}')
        const second = await run(makeChar('sc-same', ['B']), '{{image::X}}')

        expect(first.data).toBe('{{image::B}}')
        expect(second.data).toBe('{{image::B}}')
        expect(hits()).toBe(1)
    })

    test('guard: a pass that cannot run the dynamic block keeps hitting the script cache across a rename', async () => {
        await run(makeChar('sc-skip', ['B']), '{{image::X}}', 'editprocess')
        await run(makeChar('sc-skip', ['A']), '{{image::X}}', 'editprocess')

        // The editprocess scripts are of type editoutput here, so nothing matches and the dynamic block is skipped.
        expect(hits()).toBe(1)
    })
})

describe('a renamed asset and the best-match cache', () => {
    test('regression reproducer: with the script cache cleared, a renamed asset is matched again rather than served from the best-match cache', async () => {
        expect((await run(makeChar('bm-rename', ['B']), '{{image::X}}')).data).toBe('{{image::B}}')
        resetScriptCache()

        const second = await run(makeChar('bm-rename', ['A']), '{{image::X}}')

        expect(second.data).toBe('{{image::A}}')
    })

    test('guard: with the script cache cleared and the names unchanged, the best-match cache still answers', async () => {
        await run(makeChar('bm-same', ['B']), '{{image::X}}')
        resetScriptCache()

        const second = await run(makeChar('bm-same', ['B']), '{{image::X}}')

        expect(second.data).toBe('{{image::B}}')
        expect(h.searches).toBe(1)
    })
})
