/**
 * The move actions of `processScriptFull` (`../scripts`): `@@move_top`,
 * `@@move_bottom` and the `move_top` / `move_bottom` flag actions.
 *
 * - A move whose effective flags include `g` moves every match; one without
 *   `g` moves the first match only.
 * - A script whose flag box is off, or whose flag text has no regex flags once
 *   its `<...>` tags are removed, is global.
 * - move_bottom keeps source order, move_top ends with the last match on top.
 * - `$<name>` follows String.replace: literal without named groups, empty for a
 *   group that did not participate or does not exist.
 *
 * Runs the real `processScriptFull`; everything it imports is mocked inert, so
 * only the script pass itself is under test.
 *
 * Tests titled `regression reproducer:` fail against the unfixed script pass;
 * tests titled `guard:` pin behaviour that must be preserved.
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

import { processScriptFull, resetScriptCache } from '../scripts'

const script = (v: Partial<customscript>): customscript => ({
    comment: '',
    in: '',
    out: '',
    type: 'editinput',
    ...v,
} as customscript)

const messages = [{ role: 'user', data: '' }]

const run = async (data: string, s: Partial<customscript>, chatID = -1) => {
    const char = { type: 'simple', chaId: 'c', customscript: [script(s)] } as unknown as character
    return (await processScriptFull(char, data, 'editinput', chatID)).data
}

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

describe('processScriptFull move actions', () => {
    test('regression reproducer: a global @@move_top moves every match, the last match on top', async () => {
        expect(await run('a1 b a2 c a3', { in: 'a\\d', out: '@@move_top $&', ableFlag: true, flag: 'g' }))
            .toBe('a3\na2\na1\n b  c ')
    })

    test('regression reproducer: a global @@move_bottom moves every match once, in source order', async () => {
        // Three matches: the first one is lost when the earlier `test` leaves lastIndex advanced.
        expect(await run('a1 b a2 c a3', { in: 'a\\d', out: '@@move_bottom $&', ableFlag: true, flag: 'g' }))
            .toBe(' b  c \na1\na2\na3')
    })

    test('regression reproducer: a script with the flag box off is global for a move', async () => {
        expect(await run('a1 b a2', { in: 'a\\d', out: '@@move_bottom [$&]', ableFlag: false, flag: 'i' }))
            .toBe(' b \n[a1]\n[a2]')
    })

    test('regression reproducer: a flag box on with an empty flag is global for a move', async () => {
        expect(await run('a1 b a2', { in: 'a\\d', out: '@@move_bottom $&', ableFlag: true, flag: '' }))
            .toBe(' b \na1\na2')
    })

    test('regression reproducer: a flag text with only a move tag is global', async () => {
        expect(await run('a1 b a2', { in: 'a\\d', out: '$&', ableFlag: true, flag: '<move_top>' }))
            .toBe('a2\na1\n b ')
        expect(await run('a1 b a2', { in: 'a\\d', out: '$&', ableFlag: true, flag: '<order 1, move_bottom>' }))
            .toBe(' b \na1\na2')
    })

    test('regression reproducer: g<move_top> moves every match', async () => {
        expect(await run('a1 b a2', { in: 'a\\d', out: '$&', ableFlag: true, flag: 'g<move_top>' }))
            .toBe('a2\na1\n b ')
    })

    test('guard: a flag text without g moves the first match only', async () => {
        expect(await run('a1 b a2', { in: 'a\\d', out: '$&', ableFlag: true, flag: 'i<move_top>' }))
            .toBe('a1\n b a2')
        expect(await run('a1 b a2', { in: 'a\\d', out: '@@move_bottom $&', ableFlag: true, flag: 'i' }))
            .toBe(' b a2\na1')
    })

    test('regression reproducer: $<name> resolves a participating group, empty when it did not participate or does not exist', async () => {
        expect(await run('a', { in: '(?<n>a)|(?<m>b)', out: '@@move_bottom [$<n>|$<m>|$<z>]', ableFlag: true, flag: 'g' }))
            .toBe('\n[a||]')
        expect(await run('b', { in: '(?<n>a)|(?<m>b)', out: '@@move_bottom [$<n>|$<m>]', ableFlag: true, flag: 'g' }))
            .toBe('\n[|b]')
    })

    test('regression reproducer: $<name> of a participating empty group is empty', async () => {
        expect(await run('a', { in: '(?<n>)a', out: '@@move_bottom [$<n>]', ableFlag: true, flag: 'g' }))
            .toBe('\n[]')
    })

    test('guard: $<name> stays literal when the regex has no named groups, positional groups resolve', async () => {
        expect(await run('a', { in: '(a)', out: '@@move_bottom [$<n>|$1|$&]', ableFlag: true, flag: 'g' }))
            .toBe('\n[$<n>|a|a]')
    })

    test('regression reproducer: a pattern matching at every position terminates and moves every match', async () => {
        const text = 'y'.repeat(100000)
        const start = performance.now()
        const bottom = await run(text, { in: 'x*', out: '@@move_bottom $&', ableFlag: true, flag: 'g' })
        const top = await run(text, { in: 'x*', out: '@@move_top $&', ableFlag: true, flag: 'g' })
        expect(performance.now() - start).toBeLessThan(2000)
        expect(bottom.length).toBe(text.length + 100001)
        expect(top.length).toBe(text.length + 100001)
    })

    test('regression reproducer: inject combined with a move removes every match and keeps the original in the message', async () => {
        const result = await run('a1 b a2', { in: 'a\\d', out: '$&', ableFlag: true, flag: 'g<inject, move_top>' }, 0)
        expect(result).toBe(' b ')
        expect(messages[0].data).toBe('a1 b a2')
    })

    test('guard: a plain replace is unchanged by a move-free flag text', async () => {
        expect(await run('a1 b a2', { in: 'a\\d', out: 'X', ableFlag: true, flag: 'i' })).toBe('X b a2')
        expect(await run('a1 b a2', { in: 'a\\d', out: 'X', ableFlag: false })).toBe('X b X')
    })
})
