/**
 * The regex flag pipeline of `processScriptFull` (`../scripts`): which flags, custom
 * actions and order a script gets from its `ableFlag` / `flag` pair.
 *
 * Runs the real `processScriptFull`; everything it imports is mocked inert, so
 * only the script pass itself is under test.
 *
 * Tests titled `guard:` pin behaviour that must be preserved by the flag helper
 * extraction and pass before and after it.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { character, customscript } from '../../storage/database.svelte'

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
    risuChatParser: (data: string) => data.replaceAll('{{char}}', 'Risu'),
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

import { processScriptFull, resetScriptCache } from '../scripts'
import type { ScriptMode } from '../scripts'
import { effectiveRegexFlag } from '../effectiveRegexFlag'

const script = (v: Partial<customscript>): customscript => ({
    comment: '',
    in: '',
    out: '',
    type: 'editinput',
    ...v,
} as customscript)

const messages = [{ role: 'user', data: '' }]

const runAll = async (data: string, scripts: customscript[], mode: ScriptMode = 'editinput') => {
    const char = { type: 'simple', chaId: 'c', customscript: scripts } as unknown as character
    return (await processScriptFull(char, data, mode, -1)).data
}

const run = (data: string, s: Partial<customscript>) => runAll(data, [script(s)])

beforeEach(() => {
    resetScriptCache()
    messages[0].data = ''
    h.db = {
        presetRegex: [],
        dynamicAssets: false,
        characters: [{ chatPage: 0, chats: [{ message: messages }] }],
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('processScriptFull flag pipeline', () => {
    test('guard: an empty flag text with the flag box on is global', async () => {
        expect(await run('aaa', { in: 'a', out: 'b', ableFlag: true, flag: '' })).toBe('bbb')
    })

    test('guard: a sticky flag replaces only at the start of the text', async () => {
        expect(await run('baa', { in: 'a', out: 'b', ableFlag: true, flag: 'y' })).toBe('baa')
    })

    test('guard: repeated flag characters are de-duplicated', async () => {
        expect(await run('aaa', { in: 'a', out: 'b', ableFlag: true, flag: 'gg' })).toBe('bbb')
    })

    test('guard: the v flag is passed to the engine', async () => {
        expect(await run('aÄb', { in: '[\\p{L}--[a-z]]', out: 'X', ableFlag: true, flag: 'v' })).toBe('aXb')
    })

    test('guard: the cbs action parses the find text', async () => {
        expect(await run('Risu Risu', { in: '{{char}}', out: 'X', ableFlag: true, flag: '<cbs>' })).toBe('X X')
        expect(await run('Risu Risu', { in: '{{char}}', out: 'X', ableFlag: true, flag: '<order 2, cbs>' })).toBe('X X')
    })

    test('guard: an order action sorts higher first, no order keeps the declaration order', async () => {
        const a = script({ in: 'a', out: 'b' })
        const b = script({ in: 'b', out: 'c', ableFlag: true, flag: '<order 2>' })
        expect(await runAll('abab', [a, b])).toBe('bcbc')
        expect(await runAll('abab', [a, { ...b, flag: '' }])).toBe('cccc')
        expect(await runAll('abab', [a, { ...b, flag: 'u<order 2>' }])).toBe('bcbb')
    })

    test('guard: a move action with the u flag moves the first match to the bottom', async () => {
        expect(await run('abab', { in: 'a', out: 'X$&', ableFlag: true, flag: '<move_bottom>u' })).toBe('bab\nXa')
    })

    test('guard: the flag text is kept while the flag box is on, ignored while off', async () => {
        expect(await run('aA', { in: 'a', out: 'b', ableFlag: true, flag: 'gi<cbs>' })).toBe('bb')
        expect(await run('aA', { in: 'a', out: 'b', ableFlag: false, flag: 'i' })).toBe('bA')
    })

    test('guard: an absent flag with the flag box on is global', async () => {
        expect(await run('aaa', { in: 'a', out: 'b', ableFlag: true })).toBe('bbb')
    })

    test('guard: a flag text with no regex flag left falls back to u', async () => {
        expect(await run('aaa', { in: 'a', out: 'b', ableFlag: true, flag: 'z<cbs>' })).toBe('baa')
    })

    test('guard: empty actions still take the test-first path, which advances a sticky lastIndex', async () => {
        expect(await run('aa', { in: 'a', out: 'b', ableFlag: true, flag: '<,>y' })).toBe('ab')
    })
})

describe('effectiveRegexFlag', () => {
    const eff = (flags: string, actions: string[], order: number, orderSet: boolean) =>
        ({ flags, actions, order, orderSet })

    test('a flag box that is off gives the global default whatever the text says', () => {
        expect(effectiveRegexFlag('i', false)).toEqual(eff('g', [], 0, false))
        expect(effectiveRegexFlag('<order 2>', undefined)).toEqual(eff('g', [], 0, false))
    })

    test('an empty or absent flag text is global', () => {
        expect(effectiveRegexFlag('', true)).toEqual(eff('g', [], 0, false))
        expect(effectiveRegexFlag(undefined, true)).toEqual(eff('g', [], 0, false))
    })

    test('unsupported characters go, repeats are dropped, nothing left is u', () => {
        expect(effectiveRegexFlag('ggi z', true)).toEqual(eff('gi', [], 0, false))
        expect(effectiveRegexFlag('uv', true)).toEqual(eff('uv', [], 0, false))
        expect(effectiveRegexFlag('z', true)).toEqual(eff('u', [], 0, false))
    })

    test('tags are stripped before the global default applies', () => {
        expect(effectiveRegexFlag('<cbs>', true)).toEqual(eff('g', ['cbs'], 0, false))
        expect(effectiveRegexFlag('<order 2>', true)).toEqual(eff('g', [], 2, true))
        expect(effectiveRegexFlag('z<cbs>', true)).toEqual(eff('u', ['cbs'], 0, false))
        expect(effectiveRegexFlag('gi<cbs>', true)).toEqual(eff('gi', ['cbs'], 0, false))
    })

    test('actions and the order are read from one tag', () => {
        expect(effectiveRegexFlag('<order 2, cbs>', true)).toEqual(eff('g', ['cbs'], 2, true))
        expect(effectiveRegexFlag('<move_bottom>u', true)).toEqual(eff('u', ['move_bottom'], 0, false))
        expect(effectiveRegexFlag('<inject>g', true)).toEqual(eff('g', ['inject'], 0, false))
    })

    test('an empty tag adds nothing and empty parts are kept as empty actions', () => {
        expect(effectiveRegexFlag('<>g', true)).toEqual(eff('g', [], 0, false))
        expect(effectiveRegexFlag('<,>y', true)).toEqual(eff('y', ['', ''], 0, false))
    })

    test('a non numeric order is NaN and still counts as set', () => {
        const r = effectiveRegexFlag('<order x>', true)
        expect(r.order).toBeNaN()
        expect(r.orderSet).toBe(true)
    })

    test('a flag text that is not a string throws', () => {
        expect(() => effectiveRegexFlag(5 as unknown as string, true)).toThrow()
    })
})

describe('processScriptFull malformed entry', () => {
    test('regression reproducer: an entry with a non text flag is skipped and the others still apply', async () => {
        const good = script({ in: 'a', out: 'b' })
        const bad = script({ in: 'a', out: 'Z', ableFlag: true, flag: 5 as unknown as string })
        expect(await runAll('aaa', [good, bad])).toBe('bbb')
    })
})

describe('processScriptFull mixed list over every mode', () => {
    const list = (): customscript[] => [
        script({ in: 'a', out: 'b', ableFlag: true, flag: 'g<order 1>' }),
        script({ in: 'b', out: 'c', ableFlag: true, flag: '<order 2>' }),
        script({ in: 'x', out: 'y', type: 'editoutput' }),
        script({ in: 'd', out: '[$&]', type: 'editdisplay', ableFlag: true, flag: 'g<move_top>' }),
        script({ in: 'a', out: 'Z', type: 'disabled' }),
        script({ in: '(', out: 'W' }),
        script({ in: 'a', out: 'A', type: 'edittrans', ableFlag: true, flag: 'g<order 5>' }),
        script({ in: 'p', out: 'q', type: 'editprocess', ableFlag: true, flag: 'i' }),
    ]

    const recorded: Record<ScriptMode, string> = {
        editinput: 'bcdxpPbc',
        editoutput: 'abdypPab',
        editprocess: 'abdxqPab',
        editdisplay: '[d]\nabxpPab',
    }

    test.each(Object.keys(recorded) as ScriptMode[])('guard: %s result of the mixed list', async (mode) => {
        expect(await runAll('abdxpPab', list(), mode)).toBe(recorded[mode])
    })
})
