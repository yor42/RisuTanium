/**
 * The script caches of `processScriptFull` (`../scripts`).
 *
 * - A call with a `promptView` caches in its own map (cap 1,000); every other call shares a second map (cap 200).
 *   Traffic of one cannot evict the other, and `resetScriptCache` clears both.
 * - A call told to bypass the cache neither reads nor stores.
 *
 * Runs the real `processScriptFull`; everything else it imports is mocked inert.
 *
 * Tests titled `regression reproducer:` fail while one map serves every caller; tests titled `guard:` pin behaviour that
 * must be preserved.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { character, customscript } from '../../storage/database.svelte'
import type { PromptView } from '../../cbs'
import type { ScriptMode } from '../scripts'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock('../../stores.svelte', () => ({
    CharEmotion: writable({}),
    selectedCharID: writable(0),
}))

vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
    getCurrentCharacter: () => ({ type: 'simple' }),
    getCurrentChat: () => ({}),
}))

vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('../../util', () => ({ selectSingleFile: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({
    assetRegex: /{{(raw|path|img|image|video|audio|bgm|bgmloop|emotion|asset|video-img|source)::(.+?)}}/g,
    risuChatParser: (data: string) => data,
}))
vi.mock('../modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
}))
vi.mock('../memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('../scriptings', () => ({
    runLuaEditTrigger: async (_char: unknown, _mode: string, data: string) => data,
}))
vi.mock('../../plugins/plugins.svelte', () => ({
    pluginV2: {
        editdisplay: new Set(),
        editoutput: new Set(),
        editprocess: new Set(),
        editinput: new Set(),
        chatOutput: new Set(),
    },
}))
vi.mock('../triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('../chatOrigin', () => ({ createRunSubject: vi.fn() }))

import { processScriptFull, resetScriptCache, scriptPassCountersForTests, resetScriptPassCountersForTests } from '../scripts'

const PROMPT_CAP = 1000
const OTHER_CAP = 200

const promptView: PromptView = { hidden: () => false, firstSent: true }

const script = (v: Partial<customscript>): customscript => ({
    comment: '',
    in: '',
    out: '',
    type: 'editprocess',
    ...v,
} as customscript)

// Plain `in` and `out`, no `{` or `<`: every pass over plain data is key-determined.
const char = (mode: ScriptMode) => ({
    type: 'simple', chaId: 'c', customscript: [script({ type: mode, in: 'zzz', out: 'yyy' })],
    firstMessage: '', alternateGreetings: [],
} as unknown as character)

const promptCall = (data: string) =>
    processScriptFull(char('editprocess'), data, 'editprocess', -1, {}, undefined, undefined, undefined, promptView)

const otherCall = (data: string, mode: ScriptMode = 'editdisplay') =>
    processScriptFull(char(mode), data, mode, -1)

const bypassed = (data: string) =>
    processScriptFull(char('editoutput'), data, 'editoutput', -1, {}, undefined, undefined, undefined, undefined, 'bypass')

const plain = (data: string) =>
    processScriptFull(char('editoutput'), data, 'editoutput', -1)

const hits = () => scriptPassCountersForTests().cacheHits

async function fill(count: number, prefix: string, call: (data: string) => Promise<unknown>): Promise<void> {
    for (let i = 0; i < count; i++) {
        await call(`${prefix}${i}`)
    }
}

beforeEach(() => {
    resetScriptCache()
    resetScriptPassCountersForTests()
    h.db = { presetRegex: [], dynamicAssets: false, characters: [] }
})

describe('the prompt-pass cache and the cache of every other call', () => {
    test('regression reproducer: other traffic beyond the other cache\'s cap does not evict the prompt pass\'s entries', async () => {
        await fill(300, 'p', promptCall)
        await fill(OTHER_CAP + PROMPT_CAP, 'n', otherCall)
        resetScriptPassCountersForTests()
        await fill(300, 'p', promptCall)
        expect(hits()).toBe(300)
    })

    test('guard: below the shared total nothing is evicted either (passes before and after the split)', async () => {
        await fill(300, 'p', promptCall)
        await fill(700, 'n', otherCall)
        resetScriptPassCountersForTests()
        await fill(300, 'p', promptCall)
        expect(hits()).toBe(300)
    })

    test('guard: the prompt pass holds 1,000 entries and evicts the oldest at the 1,001st', async () => {
        await fill(PROMPT_CAP, 'p', promptCall)
        resetScriptPassCountersForTests()
        await promptCall('p0')
        expect(hits()).toBe(1)

        resetScriptCache()
        await fill(PROMPT_CAP + 1, 'p', promptCall)
        resetScriptPassCountersForTests()
        await promptCall('p0')
        expect(hits()).toBe(0)
        await promptCall(`p${PROMPT_CAP}`)
        expect(hits()).toBe(1)
    })

    test('regression reproducer: the other cache holds 200 entries and evicts the oldest at the 201st', async () => {
        await fill(OTHER_CAP, 'n', otherCall)
        resetScriptPassCountersForTests()
        await otherCall('n0')
        expect(hits()).toBe(1)

        resetScriptCache()
        await fill(OTHER_CAP + 1, 'n', otherCall)
        resetScriptPassCountersForTests()
        await otherCall('n0')
        expect(hits()).toBe(0)
        await otherCall(`n${OTHER_CAP}`)
        expect(hits()).toBe(1)
    })

    test('regression reproducer: prompt-pass traffic does not evict the other cache', async () => {
        await fill(50, 'n', otherCall)
        await fill(PROMPT_CAP + 1, 'p', promptCall)
        resetScriptPassCountersForTests()
        await fill(50, 'n', otherCall)
        expect(hits()).toBe(50)
    })

    test('guard: resetScriptCache clears both caches', async () => {
        await promptCall('p-kept')
        await otherCall('n-kept')
        resetScriptPassCountersForTests()
        await promptCall('p-kept')
        await otherCall('n-kept')
        expect(hits()).toBe(2)

        resetScriptCache()
        resetScriptPassCountersForTests()
        await promptCall('p-kept')
        await otherCall('n-kept')
        expect(hits()).toBe(0)
    })

    test('regression reproducer: a call without a prompt view and one with it do not serve each other', async () => {
        await promptCall('shared')
        await otherCall('shared', 'editprocess')
        expect(hits()).toBe(0)
        await promptCall('shared')
        await otherCall('shared', 'editprocess')
        expect(hits()).toBe(2)
    })
})

describe('the per-call cache bypass', () => {
    test('regression reproducer: a bypassed call does not read an entry stored under its key', async () => {
        await plain('text zzz')
        resetScriptPassCountersForTests()
        const result = await bypassed('text zzz')
        expect(result.data).toBe('text yyy')
        expect(hits()).toBe(0)
    })

    test('regression reproducer: a bypassed call does not store', async () => {
        await bypassed('text zzz')
        resetScriptPassCountersForTests()
        await plain('text zzz')
        expect(hits()).toBe(0)
    })

    test('guard: a call that does not bypass reads and stores', async () => {
        await plain('text zzz')
        resetScriptPassCountersForTests()
        await plain('text zzz')
        expect(hits()).toBe(1)
    })
})
