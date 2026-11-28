/**
 * The pure Studio checks of a regex entry (`../regexCheck`): problems of the Find and flag text, and "Try it" on a sample.
 *
 * The parity tests run the real `processScriptFull` (everything it imports is mocked inert, the parser leaves CBS-free
 * text alone) and compare the Try it text with the engine's text.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { character, customscript } from '../../../storage/database.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock('../../../stores.svelte', () => ({
    CharEmotion: writable({}),
    selectedCharID: writable(0),
}))

vi.mock('../../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
    getCurrentCharacter: () => ({ type: 'simple' }),
    getCurrentChat: () => ({}),
}))

vi.mock('../../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('../../../util', () => ({ selectSingleFile: vi.fn() }))
vi.mock('../../../parser/parser.svelte', () => ({
    assetRegex: /{{(raw|path|img|image|video|audio|bgm|bgmloop|emotion|asset|video-img|source)::(.+?)}}/g,
    risuChatParser: (data: string) => data,
}))
vi.mock('../../../process/modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
}))
vi.mock('../../../process/memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('../../../process/scriptings', () => ({
    runLuaEditTrigger: async (_char: unknown, _mode: string, data: string) => data,
}))
vi.mock('../../../plugins/plugins.svelte', () => ({
    pluginV2: {
        editdisplay: new Set(),
        editoutput: new Set(),
        editprocess: new Set(),
        editinput: new Set(),
        chatOutput: new Set(),
    },
}))
vi.mock('../../../process/triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('../../../process/chatOrigin', () => ({ createRunSubject: vi.fn() }))

import { processScriptFull, resetScriptCache } from '../../../process/scripts'
import type { ScriptMode } from '../../../process/scripts'
import { CharEmotion } from '../../../stores.svelte'
import { regexProblems, tryRegexEntry } from '../regexCheck'
import type { RegexCheckEntry, RegexTryResult } from '../regexCheck'

const entry = (v: Partial<RegexCheckEntry>): RegexCheckEntry => ({
    in: '',
    out: '',
    type: 'editinput',
    ...v,
})

const engineText = async (e: RegexCheckEntry, sample: string) => {
    resetScriptCache()
    const char = {
        type: 'simple',
        chaId: 'c',
        customscript: [{ comment: '', ...e } as customscript],
    } as unknown as character
    return (await processScriptFull(char, sample, e.type as ScriptMode, -1)).data
}

const ran = (r: RegexTryResult) => {
    if (r.outcome !== 'ran') throw new Error('expected outcome ran, got ' + r.outcome)
    return r
}

beforeEach(() => {
    resetScriptCache()
    h.db = {
        presetRegex: [],
        dynamicAssets: false,
        characters: [{ chatPage: 0, chats: [{ message: [{ role: 'user', data: '' }] }] }],
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('regexProblems', () => {
    test('a pattern that does not compile reports the engine message', () => {
        const p = regexProblems(entry({ in: '(' }))
        expect(p.invalid).toBeTruthy()
        expect(p.emptyFind).toBe(false)
        expect(p.cbsFirst).toBe(false)
    })

    test('the compile uses the flags the engine uses: a move action leaves its u flag valid', () => {
        expect(regexProblems(entry({ in: 'a', ableFlag: true, flag: '<move_bottom>u' })).invalid).toBeNull()
    })

    test('a flag text is ignored while the flag box is off', () => {
        expect(regexProblems(entry({ in: 'a', flag: 'xyz' })).invalid).toBeNull()
    })

    test('uv together is an invalid flag combination', () => {
        expect(regexProblems(entry({ in: 'a', ableFlag: true, flag: 'uv' })).invalid).toBeTruthy()
    })

    test('an empty Find is a note, not an error', () => {
        expect(regexProblems(entry({ in: '' }))).toEqual({ invalid: null, emptyFind: true, cbsFirst: false })
    })

    test('a cbs entry is not compiled: its pattern exists only after CBS', () => {
        expect(regexProblems(entry({ in: '{{char}}', ableFlag: true, flag: '<cbs>u' })))
            .toEqual({ invalid: null, emptyFind: false, cbsFirst: true })
    })

    test('the stage does not change the result', () => {
        expect(regexProblems({ ...entry({ in: '(', type: 'disabled' }) }).invalid).toBeTruthy()
    })
})

describe('tryRegexEntry outcomes', () => {
    test('a stage that never runs says so', () => {
        expect(tryRegexEntry(entry({ in: 'a', type: 'disabled' }), 'a')).toEqual({ outcome: 'neverRuns' })
        expect(tryRegexEntry(entry({ in: 'a', type: 'edit_future' }), 'a')).toEqual({ outcome: 'neverRuns' })
    })

    test('an empty Find does nothing', () => {
        expect(tryRegexEntry(entry({ in: '' }), 'a')).toEqual({ outcome: 'emptyFind' })
    })

    test('an invalid pattern gives its message', () => {
        const r = tryRegexEntry(entry({ in: '(' }), 'a')
        expect(r.outcome).toBe('invalid')
    })

    test('a cbs entry is not compiled and not run', () => {
        expect(tryRegexEntry(entry({ in: '{{char}}', ableFlag: true, flag: '<cbs>u' }), 'a')).toEqual({ outcome: 'cbsFind' })
    })
})

describe('tryRegexEntry main engine parity', () => {
    const rows: { name: string, e: Partial<RegexCheckEntry>, sample: string }[] = [
        { name: 'plain global', e: { in: 'a', out: 'b' }, sample: 'xaay' },
        { name: 'out ending in > gets a line feed', e: { in: 'a', out: '<b>$&</b>' }, sample: 'xay' },
        { name: 'no_end_nl keeps the out as written', e: { in: 'a', out: '<b>$&</b>', ableFlag: true, flag: '<no_end_nl>' }, sample: 'xay' },
        { name: '$n becomes a line feed', e: { in: 'a', out: 'b$nc' }, sample: 'a' },
        { name: '{{data}} in out', e: { in: 'a', out: '[{{data}}]' }, sample: 'a' },
        { name: 'sticky flag replaces at the start only', e: { in: 'a', out: 'b', ableFlag: true, flag: 'y' }, sample: 'aa' },
        { name: 'sticky with an action tests first', e: { in: 'a', out: 'b', ableFlag: true, flag: '<no_end_nl>y' }, sample: 'aa' },
        { name: 'flag box off ignores the flag text', e: { in: 'a', out: 'b', flag: 'i' }, sample: 'aA' },
        { name: 'case flag', e: { in: 'a', out: 'b', ableFlag: true, flag: 'gi' }, sample: 'aA' },
        { name: 'an unknown @@ out is plain', e: { in: 'a', out: '@@foo' }, sample: 'xay' },
        { name: '@@emo without a space is plain', e: { in: 'a', out: '@@emo' }, sample: 'xay' },
        { name: 'no match under test-first leaves the sample', e: { in: 'z', out: '@@foo' }, sample: 'xay' },
        { name: 'editoutput', e: { in: 'a', out: 'b', type: 'editoutput' }, sample: 'aa' },
        { name: 'editdisplay', e: { in: 'a', out: 'b', type: 'editdisplay' }, sample: 'aa' },
        { name: 'editprocess', e: { in: 'a', out: 'b', type: 'editprocess' }, sample: 'aa' },
    ]

    for (const row of rows) {
        test(row.name, async () => {
            const e = entry(row.e)
            const r = ran(tryRegexEntry(e, row.sample))
            expect(r.engine).toBe('main')
            expect(r.directive).toBe(false)
            expect(r.text).toBe(await engineText(e, row.sample))
        })
    }

    test('the sticky action row keeps the advanced position: aa becomes ab', () => {
        const r = ran(tryRegexEntry(entry({ in: 'a', out: 'b', ableFlag: true, flag: '<no_end_nl>y' }), 'aa'))
        expect(r.text).toBe('ab')
    })

    test('the no_end_nl action is read: out ending in > keeps no line feed', () => {
        const r = ran(tryRegexEntry(entry({ in: 'a', out: '<b>$&</b>', ableFlag: true, flag: '<no_end_nl>' }), 'a'))
        expect(r.text).toBe('<b>$&</b>'.replace('$&', 'a'))
        const plain = ran(tryRegexEntry(entry({ in: 'a', out: '<b>$&</b>' }), 'a'))
        expect(plain.text).toBe('<b>a</b>\n')
    })

    test('matches are counted and shown as spans', () => {
        const r = ran(tryRegexEntry(entry({ in: 'a', out: 'b' }), 'xaya'))
        expect(r.count).toBe(2)
        expect(r.spans).toEqual([{ index: 1, text: 'a' }, { index: 3, text: 'a' }])
    })

    test('no more than twenty spans are listed, the count stays whole', () => {
        const r = ran(tryRegexEntry(entry({ in: 'a', out: 'b' }), 'a'.repeat(30)))
        expect(r.count).toBe(30)
        expect(r.spans).toHaveLength(20)
    })

    test('a directive shows matches and no text', () => {
        const rows: Partial<RegexCheckEntry>[] = [
            { out: '@@emo happy' },
            { out: '@@inject' },
            { out: '@@move_top' },
            { out: '@@move_bottom' },
            { out: '@@repeat_back' },
            { out: 'x', ableFlag: true, flag: '<inject>' },
            { out: 'x', ableFlag: true, flag: '<move_top>' },
            { out: 'x', ableFlag: true, flag: '<move_bottom>' },
            { out: 'x', ableFlag: true, flag: '<repeat_back>' },
        ]
        for (const row of rows) {
            const r = ran(tryRegexEntry(entry({ in: 'a', ...row }), 'xaya'))
            expect(r.directive, JSON.stringify(row)).toBe(true)
            expect(r.text).toBeNull()
            expect(r.count).toBe(2)
        }
    })

    test('a directive spans: a sticky move starts at 0, a sticky inject reads where the test stopped', () => {
        const move = ran(tryRegexEntry(entry({ in: 'a', out: 'x', ableFlag: true, flag: '<move_bottom>y' }), 'aa'))
        expect(move.spans).toEqual([{ index: 0, text: 'a' }])
        const inject = ran(tryRegexEntry(entry({ in: 'a', out: 'x', ableFlag: true, flag: '<inject>y' }), 'aa'))
        expect(inject.spans).toEqual([{ index: 1, text: 'a' }])
    })

    test('trying an emotion directive touches neither the emotion store nor the database', () => {
        const before = JSON.stringify(h.db)
        const emoBefore = JSON.stringify(get(CharEmotion))
        ran(tryRegexEntry(entry({ in: 'a', out: '@@emo happy' }), 'a'))
        expect(JSON.stringify(get(CharEmotion))).toBe(emoBefore)
        expect(JSON.stringify(h.db)).toBe(before)
    })
})
