/**
 * The similarity processor of the dynamic-asset block in `processScriptFull` (`./scripts`) is built only when a pass
 * needs a fuzzy lookup: passes without asset tags, exact asset names and best-match cache hits never construct it, and
 * a pass with several fuzzy tags builds it once with every name loaded before the first search.
 *
 * Runs the real `processScriptFull`; the processor is a stand-in that counts constructions and `addText` calls and
 * yields a macrotask inside `addText`, so a search that does not await it sees no names (a real embedding pass is
 * asynchronous in the same way).
 *
 * Tests titled `regression reproducer:` fail while the processor is built eagerly; `guard:` tests pin output that
 * must not change.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { character, customscript } from '../storage/database.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    built: 0,
    added: [] as string[][],
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
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
}))
vi.mock('./memory/hypamemory', () => ({
    HypaProcesser: class {
        names: string[] = []
        constructor() { h.built++ }
        async addText(names: string[]) {
            h.added.push(names)
            await new Promise<void>((r) => setTimeout(r, 0))
            this.names = names
        }
        async similaritySearch() { return [this.names[this.names.length - 1]] }
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

import { processScriptFull, resetScriptCache } from './scripts'

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

const run = (char: character, data: string) => processScriptFull(char, data, 'editoutput', -1)

beforeEach(() => {
    resetScriptCache()
    h.built = 0
    h.added = []
    h.db = { presetRegex: [], dynamicAssets: true, dynamicAssetsEditDisplay: false, characters: [] }
})

describe('the similarity processor of the dynamic-asset block', () => {
    test('regression reproducer: a pass without asset tags builds no processor and loads no names', async () => {
        const out = await run(makeChar('lazy-none', ['A', 'B']), 'plain text without tags')

        expect(out.data).toBe('plain text without tags')
        expect(h.built).toBe(0)
        expect(h.added.length).toBe(0)
    })

    test('regression reproducer: a second pass served by the best-match cache builds nothing', async () => {
        const char = makeChar('lazy-cache', ['A', 'B'])
        const first = await run(char, '{{image::X}} one')
        expect(first.data).toBe('{{image::B}} one')
        expect(h.built).toBe(1)

        const second = await run(char, '{{image::X}} two')

        expect(second.data).toBe('{{image::B}} two')
        expect(h.built).toBe(1)
        expect(h.added.length).toBe(1)
    })

    test('regression reproducer: an exact asset name builds no processor', async () => {
        const out = await run(makeChar('lazy-exact', ['A', 'B']), '{{image::A}}')

        expect(out.data).toBe('{{image::A}}')
        expect(h.built).toBe(0)
        expect(h.added.length).toBe(0)
    })

    test('guard: two fuzzy tags in one pass build one processor, loaded with every name before the first search', async () => {
        const out = await run(makeChar('lazy-two', ['A', 'B', 'C']), '{{image::X}} {{asset::Y}}')

        expect(out.data).toBe('{{image::C}} {{asset::C}}')
        expect(h.built).toBe(1)
        expect(h.added).toEqual([['A', 'B', 'C']])
    })
})
