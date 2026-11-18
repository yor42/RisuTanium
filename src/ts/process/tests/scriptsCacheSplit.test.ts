/**
 * The script caches of `processScriptFull` (`../scripts`).
 *
 * - A call with a `promptView` caches in its own map; every other call shares a second map (cap 200).
 *   Traffic of one cannot evict the other, and `resetScriptCache` clears both.
 * - The prompt-pass map is keyed by a 128-bit digest of the cache key text, holds `null` for a result equal to the
 *   pass input, and is bounded by a byte budget of 8 MiB: 256 bytes per entry plus two bytes per character of a
 *   changed result. When full it evicts the entries of any other chat or script set first, then stops admitting.
 * - A prompt pass with no script of its mode (and no dynamic-asset rewrite) neither builds a key nor stores; its probe
 *   outcome is `empty` when there are no scripts at all and `uncached` otherwise.
 * - A call told to bypass the cache neither reads nor stores.
 *
 * Runs the real `processScriptFull`; everything else it imports is mocked inert.
 *
 * Tests titled `regression reproducer:` fail on the pre-budget implementation; tests titled `guard:` pin behaviour that
 * must be preserved and may pass before and after.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { character, customscript } from '../../storage/database.svelte'
import type { PromptView } from '../../cbs'
import type { RunSubject } from '../chatOrigin'
import type { ScriptMode } from '../scripts'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    lua: (data: string): string => data,
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
    runLuaEditTrigger: async (_char: unknown, _mode: string, data: string) => h.lua(data),
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

import {
    processScriptFull, resetScriptCache, scriptPassCountersForTests, resetScriptPassCountersForTests,
    promptPassCacheStatsForTests, promptPassDigestForTests,
} from '../scripts'

const TRAFFIC = 1000
const OTHER_CAP = 200
const ENTRY_BYTES = 256
const BIG = 999_990
const SLOW = 60_000

const promptView: PromptView = { hidden: () => false, firstSent: true }

const script = (v: Partial<customscript>): customscript => ({
    comment: '',
    in: '',
    out: '',
    type: 'editprocess',
    ...v,
} as customscript)

// Plain `in` and `out`, no `{` or `<`: every pass over plain data is key-determined.
const charOf = (scripts: customscript[]) => ({
    type: 'simple', chaId: 'c', customscript: scripts,
    firstMessage: '', alternateGreetings: [],
} as unknown as character)

const char = (mode: ScriptMode, out = 'yyy') => charOf([script({ type: mode, in: 'zzz', out })])

const promptCall = (data: string) =>
    processScriptFull(char('editprocess'), data, 'editprocess', -1, {}, undefined, undefined, undefined, promptView)

const otherCall = (data: string, mode: ScriptMode = 'editdisplay') =>
    processScriptFull(char(mode), data, mode, -1)

const bypassed = (data: string) =>
    processScriptFull(char('editoutput'), data, 'editoutput', -1, {}, undefined, undefined, undefined, undefined, 'bypass')

const plain = (data: string) =>
    processScriptFull(char('editoutput'), data, 'editoutput', -1)

// A chat identity as a send passes it: the chat is `origin`, the message index is the `chatID` argument.
const subjectOf = (chatId: string): RunSubject =>
    ({ origin: { chaId: 'c', chatId }, resolve: () => null, mark: () => {} } as Pick<RunSubject, 'origin' | 'resolve' | 'mark'> as RunSubject)

const sendCall = (c: character, data: string, chatId: string, index: number) =>
    processScriptFull(c, data, 'editprocess', index, {}, undefined, subjectOf(chatId), undefined, promptView)

const hits = () => scriptPassCountersForTests().cacheHits

async function fill(count: number, prefix: string, call: (data: string) => Promise<unknown>): Promise<void> {
    for (let i = 0; i < count; i++) {
        await call(`${prefix}${i}`)
    }
}

// Whether one call was served from the cache.
async function served(call: () => Promise<unknown>): Promise<boolean> {
    resetScriptPassCountersForTests()
    await call()
    return hits() === 1
}

const pad = 'a'.repeat(BIG)
// ~1,000,000 characters whose result differs from the input: charged 2 bytes per character.
const changedBig = (i: number | string) => `zzz${i}${pad}`
// ~400,000 characters the scripts leave as they are: charged the fixed entry cost only.
const unchangedBig = (i: number) => `u${i}${'b'.repeat(400_000)}`

beforeEach(() => {
    resetScriptCache()
    resetScriptPassCountersForTests()
    h.lua = (data) => data
    h.db = { presetRegex: [], dynamicAssets: false, characters: [] }
})

describe('the prompt-pass cache and the cache of every other call', () => {
    test('regression reproducer: other traffic beyond the other cache\'s cap does not evict the prompt pass\'s entries', async () => {
        await fill(300, 'p', promptCall)
        await fill(OTHER_CAP + TRAFFIC, 'n', otherCall)
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
        await fill(TRAFFIC + 1, 'p', promptCall)
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

describe('a prompt pass with no script of its mode', () => {
    test('regression reproducer: it stores nothing, with other-mode scripts and with none', async () => {
        const call = (c: character) =>
            processScriptFull(c, 'plain text', 'editprocess', -1, {}, undefined, undefined, undefined, promptView)
        const onlyDisplay = char('editdisplay')
        await call(onlyDisplay)
        await call(onlyDisplay)
        expect(hits()).toBe(0)
        const none = charOf([])
        await call(none)
        await call(none)
        expect(hits()).toBe(0)
        expect(promptPassCacheStatsForTests().entries).toBe(0)
    })

    test('guard: a prompt pass with a script of its mode, and a non-prompt call whose mode has no script, still cache', async () => {
        await promptCall('text zzz')
        await promptCall('text zzz')
        expect(hits()).toBe(1)

        resetScriptPassCountersForTests()
        const onlyProcess = char('editprocess')
        await processScriptFull(onlyProcess, 'text zzz', 'editdisplay', -1)
        await processScriptFull(onlyProcess, 'text zzz', 'editdisplay', -1)
        expect(hits()).toBe(1)
    })

    test('guard: the Lua edit trigger still runs before the early return', async () => {
        h.lua = (data) => data + '!'
        const result = await processScriptFull(char('editdisplay'), 'x', 'editprocess', -1, {}, undefined, undefined, undefined, promptView)
        expect(result.data).toBe('x!')
    })
})

describe('the prompt-pass cache budget', () => {
    test('regression reproducer: a chat far above the old entry cap hits on every repeated prompt pass', async () => {
        await fill(3000, 'p', promptCall)
        resetScriptPassCountersForTests()
        await fill(3000, 'p', promptCall)
        expect(hits()).toBe(3000)
    })

    test('regression reproducer: changed results stop being admitted at 8 MiB', async () => {
        for (let i = 0; i < 6; i++) {
            await promptCall(changedBig(i))
        }
        const repeated: boolean[] = []
        for (let i = 0; i < 6; i++) {
            repeated.push(await served(() => promptCall(changedBig(i))))
        }
        expect(repeated).toEqual([true, true, true, true, false, false])
    }, SLOW)

    test('guard: the stats charge a fixed cost per entry, and two bytes per character only for a changed result', async () => {
        await promptCall('u0')
        const one = promptPassCacheStatsForTests()
        expect(one.entries).toBe(1)
        expect(one.bytes).toBe(ENTRY_BYTES)

        await promptCall(`u1${'b'.repeat(100_000)}`)
        expect(promptPassCacheStatsForTests().bytes).toBe(2 * ENTRY_BYTES)

        const before = promptPassCacheStatsForTests().bytes
        const input = `zzz${'c'.repeat(997)}`
        await promptCall(input)
        const result = input.replace('zzz', 'yyy')
        expect(promptPassCacheStatsForTests().bytes - before).toBe(ENTRY_BYTES + 2 * result.length)
    })

    test('guard: unchanged results cost no length, so twelve 400,000-character inputs all fit', async () => {
        for (let i = 0; i < 12; i++) {
            await promptCall(unchangedBig(i))
        }
        resetScriptPassCountersForTests()
        for (let i = 0; i < 12; i++) {
            await promptCall(unchangedBig(i))
        }
        expect(hits()).toBe(12)
    }, SLOW)

    test('guard: a full cache gives way to another chat\'s passes by evicting the first chat\'s entries', async () => {
        const c = char('editprocess')
        for (let i = 0; i < 4; i++) {
            await sendCall(c, changedBig(i), 'A', i)
        }
        // Chat A holds the budget: a fifth entry of the same chat is not admitted.
        await sendCall(c, changedBig(4), 'A', 4)
        expect(promptPassCacheStatsForTests().entries).toBe(4)

        for (let i = 0; i < 4; i++) {
            await sendCall(c, changedBig(`B${i}`), 'B', i)
        }
        resetScriptPassCountersForTests()
        for (let i = 0; i < 4; i++) {
            const result = await sendCall(c, changedBig(`B${i}`), 'B', i)
            expect(result.data).toBe(changedBig(`B${i}`).replace('zzz', 'yyy'))
        }
        expect(hits()).toBe(4)
    }, SLOW)

    test('guard: a full cache gives way to an edited script of the same chat', async () => {
        for (let i = 0; i < 4; i++) {
            await sendCall(char('editprocess', 'yyy'), changedBig(i), 'A', i)
        }
        const edited = char('editprocess', 'xxx')
        for (let i = 0; i < 4; i++) {
            await sendCall(edited, changedBig(i), 'A', i)
        }
        resetScriptPassCountersForTests()
        for (let i = 0; i < 4; i++) {
            const result = await sendCall(edited, changedBig(i), 'A', i)
            expect(result.data).toBe(changedBig(i).replace('zzz', 'xxx'))
        }
        expect(hits()).toBe(4)
    }, SLOW)

    test('guard: the message index is not a chat; a later message of a full chat does not evict its earlier ones', async () => {
        const c = char('editprocess')
        for (let i = 0; i < 4; i++) {
            await sendCall(c, changedBig(i), 'A', i)
        }
        await sendCall(c, changedBig(4), 'A', 4)
        resetScriptPassCountersForTests()
        for (let i = 0; i < 4; i++) {
            await sendCall(c, changedBig(i), 'A', i)
        }
        expect(hits()).toBe(4)
    }, SLOW)

    test('guard: resetScriptCache clears the byte budget', async () => {
        for (let i = 0; i < 6; i++) {
            await promptCall(changedBig(i))
        }
        expect(promptPassCacheStatsForTests().bytes).toBeGreaterThan(0)
        resetScriptCache()
        expect(promptPassCacheStatsForTests()).toEqual({ entries: 0, bytes: 0, keys: [] })

        for (let i = 0; i < 4; i++) {
            await promptCall(changedBig(i))
        }
        resetScriptPassCountersForTests()
        for (let i = 0; i < 4; i++) {
            await promptCall(changedBig(i))
        }
        expect(hits()).toBe(4)
    }, SLOW)
})

describe('the prompt-pass cache keys and values', () => {
    test('guard: an unchanged pass hits and returns the caller\'s own text', async () => {
        const input = 'plain text'
        const first = await promptCall(input)
        expect(first.data).toBe(input)
        const second = await promptCall(input)
        expect(second.data).toBe(input)
        expect(hits()).toBe(1)
    })

    test('regression reproducer: distinct texts never share an entry, and every hit returns its own result', async () => {
        let state = 12345
        const next = () => {
            state = (state + 0x6D2B79F5) | 0
            let t = Math.imul(state ^ (state >>> 15), 1 | state)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
        const alphabet = 'abcdefghijklmnopqrstuvwx 0123456789가나다라마바사아자차카타파하'
        const texts = new Set<string>()
        const bases: string[] = []
        for (let i = 0; i < 5000; i++) {
            let body = ''
            const length = 20 + Math.floor(next() * 40)
            for (let j = 0; j < length; j++) {
                body += alphabet[Math.floor(next() * alphabet.length)]
            }
            const at = Math.floor(next() * body.length)
            const text = body.slice(0, at) + 'zzz' + body.slice(at)
            texts.add(text)
            if (i < 500) {
                bases.push(text)
            }
        }
        for (const base of bases) {
            const middle = base.length >> 1
            texts.add('Q' + base.slice(1))
            texts.add(base.slice(0, middle) + 'Q' + base.slice(middle + 1))
            texts.add(base.slice(0, -1) + 'Q')
            texts.add(base.slice(0, 2) + base[3] + base[2] + base.slice(4))
            texts.add(base.slice(0, -4) + base[base.length - 2] + base[base.length - 3] + base.slice(-2))
        }
        const list = [...texts]
        for (const text of list) {
            await promptCall(text)
        }
        resetScriptPassCountersForTests()
        for (const text of list) {
            const result = await promptCall(text)
            expect(result.data).toBe(text.replaceAll('zzz', 'yyy'))
        }
        expect(hits()).toBe(list.length)
        expect(promptPassCacheStatsForTests().entries).toBe(list.length)
    }, SLOW)

    test('guard: every key is a 32-character lower-case hex digest and none holds the input', async () => {
        const inputs = ['plain text', 'zzz inside', 'another one 가나다']
        for (const input of inputs) {
            await promptCall(input)
        }
        const { keys } = promptPassCacheStatsForTests()
        expect(keys).toHaveLength(inputs.length)
        for (const key of keys) {
            expect(key).toMatch(/^[0-9a-f]{32}$/)
            for (const input of inputs) {
                expect(key).not.toContain(input)
            }
        }
    })

    test('guard: the digest separates 20,000 near-duplicate texts, and each 64-bit half does too', () => {
        let state = 987654321
        const next = () => {
            state = (state + 0x6D2B79F5) | 0
            let t = Math.imul(state ^ (state >>> 15), 1 | state)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
        let base = ''
        for (let i = 0; i < 200; i++) {
            base += String.fromCharCode(32 + Math.floor(next() * 95))
        }
        const texts = new Set<string>([base])
        const middle = base.length >> 1
        for (let unit = 0; unit < 4500; unit++) {
            const c = String.fromCharCode(0x100 + unit)
            texts.add(c + base.slice(1))
            texts.add(base.slice(0, middle) + c + base.slice(middle + 1))
            texts.add(base.slice(0, -1) + c)
        }
        for (let i = 0; i < 20_000 && texts.size < 19_500; i++) {
            const a = Math.floor(next() * base.length)
            const b = Math.floor(next() * base.length)
            if (a === b || base[a] === base[b]) {
                continue
            }
            const lo = Math.min(a, b)
            const hi = Math.max(a, b)
            texts.add(base.slice(0, lo) + base[hi] + base.slice(lo + 1, hi) + base[lo] + base.slice(hi + 1))
        }
        for (let k = 1; k <= 1500; k++) {
            texts.add(base + '\u0000'.repeat(k))
        }
        const list = [...texts].slice(0, 20_000)
        expect(list.length).toBe(20_000)
        const digests = list.map((text) => promptPassDigestForTests(text))
        expect(new Set(digests).size).toBe(list.length)
        expect(new Set(digests.map((d) => d.slice(0, 16))).size).toBe(list.length)
        expect(new Set(digests.map((d) => d.slice(16))).size).toBe(list.length)
        for (const d of digests) {
            expect(d).toMatch(/^[0-9a-f]{32}$/)
        }
    }, SLOW)

    test('guard: the digest is the reference cyrb128, so no lane is dropped or miswired', () => {
        // Expected values come from the published cyrb128, run outside this repository.
        expect(promptPassDigestForTests('')).toBe('027ae52ecfc796215593990d4b41437c')
        expect(promptPassDigestForTests('a')).toBe('5eb8e4e408dee1678f5f05b958089485')
        expect(promptPassDigestForTests('hello world')).toBe('ee082b2a78cca642d67fd8eadaef144f')
        expect(promptPassDigestForTests('한글 text\u0000|||editprocess|||')).toBe('35f0e269c96d197634dc6655b14460f2')
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
