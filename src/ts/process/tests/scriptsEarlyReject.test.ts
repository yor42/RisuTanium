/**
 * The early rejection of leading-lazy-dot regexes inside `processScriptFull`
 * (`../scripts`, `../regexEarlyReject`).
 *
 * - A script whose regex cannot match skips the regex call and still runs the
 *   CBS parse on the unchanged text.
 * - The result equals the result with the helper switched off, for a plain
 *   script, an `@@repeat_back` that does not match, an `@@inject` that matches
 *   and the send-time modes `editinput` and `editprocess`.
 *
 * Runs the real `processScriptFull`; everything else it imports is mocked
 * inert. The helper is real unless a test switches it off.
 *
 * Tests titled `regression reproducer:` fail while the call sites do not skip
 * the regex; tests titled `guard:` pin behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { character, customscript } from '../../storage/database.svelte'
import type { ScriptMode } from '../scripts'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    helperOff: false,
    parserCalls: [] as string[],
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
    risuChatParser: (data: string) => {
        h.parserCalls.push(data)
        return data
    },
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
vi.mock('../regexEarlyReject', async (importOriginal) => {
    const real = await importOriginal<typeof import('../regexEarlyReject')>()
    return {
        leadingLazyDotCannotMatch: (input: string, flag: string, data: string) =>
            h.helperOff ? false : real.leadingLazyDotCannotMatch(input, flag, data),
    }
})

import { processScriptFull, resetScriptCache, scriptPassCountersForTests, resetScriptPassCountersForTests } from '../scripts'

// Leading lazy dot, a literal marker, a word alternation and `$`: it never matches text without the marker.
const realShapedPattern = '(.+?)#(alpha|beta|gamma|delta|omega)$'

const script = (v: Partial<customscript>): customscript => ({
    comment: '',
    in: '',
    out: '',
    type: 'editinput',
    ...v,
} as customscript)

const messages = [
    { role: 'user', data: 'zz#alpha' },
    { role: 'user', data: 'current' },
]

const run = async (data: string, s: Partial<customscript>, mode: ScriptMode, chatID = -1) => {
    const char = {
        type: 'simple', chaId: 'c', customscript: [script({ type: mode, ...s })],
        firstMessage: '', alternateGreetings: [],
    } as unknown as character
    return (await processScriptFull(char, data, mode, chatID)).data
}

const runBoth = async (data: string, s: Partial<customscript>, mode: ScriptMode, chatID = -1) => {
    const results: string[] = []
    const injected: string[] = []
    for(const off of [false, true]){
        h.helperOff = off
        resetScriptCache()
        messages[0].data = 'zz#alpha'
        messages[1].data = 'current'
        results.push(await run(data, s, mode, chatID))
        injected.push(messages[chatID === -1 ? 0 : chatID].data)
    }
    return { on: results[0], off: results[1], injectedOn: injected[0], injectedOff: injected[1] }
}

beforeEach(() => {
    resetScriptCache()
    resetScriptPassCountersForTests()
    h.helperOff = false
    h.parserCalls.length = 0
    messages[0].data = 'zz#alpha'
    messages[1].data = 'current'
    h.db = {
        presetRegex: [],
        dynamicAssets: false,
        characters: [{
            chatPage: 0, chats: [{ message: messages, fmIndex: -1 }],
            firstMessage: '', alternateGreetings: [],
        }],
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

/**
 * Counts the `test` and `replace` calls whose receiver is the script's full
 * pattern; the helper's own search runs through `exec` and is not counted.
 */
function watchFullRegexCalls(pattern: string): () => number {
    let calls = 0
    const originalTest = RegExp.prototype.test
    const originalReplace = RegExp.prototype[Symbol.replace]
    vi.spyOn(RegExp.prototype, 'test').mockImplementation(function(this: RegExp, text: string){
        if(this.source === pattern){
            calls++
        }
        return originalTest.call(this, text)
    })
    vi.spyOn(RegExp.prototype, Symbol.replace).mockImplementation(function(this: RegExp, text: string, replacement: Parameters<typeof originalReplace>[1]){
        if(this.source === pattern){
            calls++
        }
        return originalReplace.call(this, text, replacement)
    })
    return () => calls
}

describe('processScriptFull early rejection', () => {
    test('regression reproducer: a real-shaped script over long text without a match skips the regex and still parses the unchanged text', async () => {
        const text = 'lorem ipsum dolor sit amet '.repeat(600).slice(0, 16000)
        const result = await run(text, { in: realShapedPattern, out: 'X', ableFlag: true, flag: 'sm' }, 'editprocess')
        expect(result).toBe(text)
        expect(scriptPassCountersForTests().earlyRejects).toBe(1)
        expect(h.parserCalls.at(-1)).toBe(text)
    })

    test('regression reproducer: a rejected plain script never runs its full regex, matching text does', async () => {
        const fullCalls = watchFullRegexCalls(realShapedPattern)
        const text = 'lorem ipsum dolor sit amet '.repeat(600).slice(0, 16000)
        await run(text, { in: realShapedPattern, out: 'X', ableFlag: true, flag: 'sm' }, 'editprocess')
        expect(fullCalls()).toBe(0)
        await run('lead\n#beta', { in: realShapedPattern, out: 'X', ableFlag: true, flag: 'sm' }, 'editprocess')
        expect(fullCalls()).toBeGreaterThan(0)
    })

    test('regression reproducer: a rejected @@ script never tests its full regex, matching text does', async () => {
        const fullCalls = watchFullRegexCalls(realShapedPattern)
        const text = 'lorem ipsum dolor sit amet '.repeat(600).slice(0, 16000)
        await run(text, { in: realShapedPattern, out: '@@inject', ableFlag: true, flag: 'sm' }, 'editinput', 0)
        expect(fullCalls()).toBe(0)
        await run('lead\n#beta', { in: realShapedPattern, out: '@@inject', ableFlag: true, flag: 'sm' }, 'editinput', 0)
        expect(fullCalls()).toBeGreaterThan(0)
    })

    test('regression reproducer: an anchored greedy lead is skipped without its full regex and gives the same output as with the helper off', async () => {
        const anchoredPattern = '^(.*)#(alpha|beta)$'
        const fullCalls = watchFullRegexCalls(anchoredPattern)
        const text = 'lorem ipsum\ndolor sit amet '.repeat(600).slice(0, 16000)
        const rejected = await runBoth(text, { in: anchoredPattern, out: 'X', ableFlag: true, flag: 'ms' }, 'editprocess')
        expect(rejected.on).toBe(text)
        expect(rejected.off).toBe(text)
        expect(scriptPassCountersForTests().earlyRejects).toBe(1)
        // Only the helper-off run reaches the full regex.
        expect(fullCalls()).toBe(1)
        const matched = await runBoth('first\nx#beta', { in: anchoredPattern, out: '[$2]', ableFlag: true, flag: 'ms' }, 'editprocess')
        expect(matched.on).toBe(matched.off)
        expect(matched.on).toBe('[beta]')
        const injected = await runBoth(text, { in: anchoredPattern, out: '@@inject', ableFlag: true, flag: 'ms' }, 'editinput', 0)
        expect(injected.on).toBe(text)
        expect(injected.off).toBe(text)
    })

    test('guard: with the helper switched off the same script skips nothing and gives the same text', async () => {
        h.helperOff = true
        const text = 'lorem ipsum dolor sit amet '.repeat(40)
        const result = await run(text, { in: realShapedPattern, out: 'X', ableFlag: true, flag: 'sm' }, 'editprocess')
        expect(result).toBe(text)
        expect(scriptPassCountersForTests().earlyRejects).toBe(0)
    })

    test('guard: text that holds a match is replaced, nothing is skipped', async () => {
        const result = await run('lead\n#beta', { in: realShapedPattern, out: 'X', ableFlag: true, flag: 'sm' }, 'editprocess')
        expect(result).toBe('X')
        expect(scriptPassCountersForTests().earlyRejects).toBe(0)
    })

    test('guard: a plain script gives the same output with the helper on and off', async () => {
        for(const data of ['no marker here', 'zz#alpha', 'a\n#omega\nb', '']){
            const { on, off } = await runBoth(data, { in: realShapedPattern, out: 'X', ableFlag: true, flag: 'sm' }, 'editinput')
            expect(on).toBe(off)
        }
        expect((await runBoth('zz#alpha', { in: realShapedPattern, out: 'X', ableFlag: true, flag: 'sm' }, 'editinput')).on).toBe('X')
    })

    test('guard: a send-time mode gives the same output with the helper on and off', async () => {
        for(const data of ['no marker here', 'zz#gamma', 'a\n#delta\nb']){
            const { on, off } = await runBoth(data, { in: realShapedPattern, out: '[$2]', ableFlag: true, flag: 'sm' }, 'editprocess')
            expect(on).toBe(off)
        }
        expect((await runBoth('zz#gamma', { in: realShapedPattern, out: '[$2]', ableFlag: true, flag: 'sm' }, 'editprocess')).on).toBe('[gamma]')
    })

    test('guard: an @@repeat_back that does not match behaves as with the helper off', async () => {
        const { on, off } = await runBoth('current', { in: realShapedPattern, out: '@@repeat_back end', ableFlag: true, flag: 's' }, 'editinput', 1)
        expect(on).toBe(off)
        expect(on).toBe('currentzz#alpha')
    })

    test('guard: an @@inject that matches behaves as with the helper off', async () => {
        const { on, off, injectedOn, injectedOff } = await runBoth('zz#alpha', { in: realShapedPattern, out: '@@inject', ableFlag: true, flag: 's' }, 'editinput', 0)
        expect(on).toBe(off)
        expect(on).toBe('')
        expect(injectedOn).toBe(injectedOff)
        expect(injectedOn).toBe('zz#alpha')
    })

    test('guard: an @@inject that does not match leaves the message and the text alone', async () => {
        const { on, off, injectedOn, injectedOff } = await runBoth('current', { in: realShapedPattern, out: '@@inject', ableFlag: true, flag: 's' }, 'editinput', 0)
        expect(on).toBe(off)
        expect(on).toBe('current')
        expect(injectedOn).toBe(injectedOff)
    })
})

describe('@@repeat_back first-message fallback', () => {
    const repeatBackWithFirstMessage = async (fmIndex: number): Promise<string> => {
        const owner = h.db.characters as { firstMessage: string, alternateGreetings: string[], chats: { fmIndex: number }[] }[]
        owner[0].firstMessage = 'DEFAULT#alpha'
        owner[0].alternateGreetings = ['ALT0#beta']
        owner[0].chats[0].fmIndex = fmIndex
        return run('current', { in: realShapedPattern, out: '@@repeat_back end', ableFlag: true, flag: 's' }, 'editinput', 0)
    }

    test('regression reproducer: a stale fmIndex repeats the default first message', async () => {
        expect(await repeatBackWithFirstMessage(3)).toBe('currentDEFAULT#alpha')
    })

    test('guard: an in-range fmIndex repeats that alternate greeting', async () => {
        expect(await repeatBackWithFirstMessage(0)).toBe('currentALT0#beta')
    })
})