/**
 * `processScriptFull` (`../scripts`) reports each call to the chat phase ring in a measurement build and reports nothing
 * otherwise. Runs the real `processScriptFull`; everything else it imports is mocked inert, and the early-reject helper is
 * the real one.
 *
 * - One call is one `script` entry carrying the mode, a finite non-negative duration, the cache outcome and the
 *   early-reject count of that call.
 * - The result of the call does not depend on the flag.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Chat, character, customscript, Message } from '../../storage/database.svelte'
import type { OriginContext, RunSubject } from '../chatOrigin'
import type { PromptView } from '../../cbs'
import type { ScriptMode } from '../scripts'
import type { ChatPhaseRingHandle } from '../chatPhaseRing'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    measure: true,
    modulesThrow: false,
}))

vi.mock('../memory/measureFlag', () => ({
    get MEASURE() {
        return h.measure
    },
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
    getModuleRegexScripts: () => {
        if (h.modulesThrow) {
            throw new Error('module scripts unavailable')
        }
        return []
    },
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

type RingGlobal = { __risuChatPhases?: ChatPhaseRingHandle }

function ringOf(): ChatPhaseRingHandle | undefined {
    return (globalThis as RingGlobal).__risuChatPhases
}

// Leading lazy dot, a literal marker and `$`: it never matches text without the marker. The `s` flag is what the
// early rejection requires.
const rejectedPattern = '(.+?)#(alpha|beta)$'
const rejectedScript = () => script({ in: rejectedPattern, out: 'x', ableFlag: true, flag: 'gs' })

const script = (v: Partial<customscript>): customscript => ({
    comment: '',
    in: '',
    out: '',
    type: 'editdisplay',
    ...v,
} as customscript)

const charWith = (scripts: customscript[]) => ({
    type: 'simple', chaId: 'c', customscript: scripts,
    firstMessage: '', alternateGreetings: [],
} as unknown as character)

const call = (scripts: customscript[], data: string, mode: ScriptMode) =>
    processScriptFull(charWith(scripts), data, mode, -1)

beforeEach(() => {
    h.measure = true
    h.modulesThrow = false
    resetScriptCache()
    h.db = { presetRegex: [], dynamicAssets: false, characters: [] }
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    ringOf()?.reset()
    delete (globalThis as RingGlobal).__risuChatPhases
    vi.restoreAllMocks()
})

describe('processScriptFull chat phase entries', () => {
    test('one call is one entry with mode, duration, cache outcome and early-reject count', async () => {
        const scripts = [rejectedScript()]
        const result = await call(scripts, 'plain text without marker', 'editdisplay')
        expect(result.data).toBe('plain text without marker')
        const entries = ringOf()!.snapshot()
        expect(entries).toHaveLength(1)
        const entry = entries[0]
        expect(entry.kind).toBe('script')
        if (entry.kind === 'script') {
            expect(entry.mode).toBe('editdisplay')
            expect(Number.isFinite(entry.ms) && entry.ms >= 0).toBe(true)
            expect(entry.cache).toBe('miss')
            expect(entry.earlyRejects).toBe(1)
            expect(entry.scans).toBe(0)
        }
    })

    test('a repeat of the same call is served from the cache and says so', async () => {
        const scripts = [rejectedScript()]
        await call(scripts, 'text', 'editdisplay')
        await call(scripts, 'text', 'editdisplay')
        const entries = ringOf()!.snapshot()
        expect(entries.map(entry => entry.kind === 'script' ? [entry.cache, entry.earlyRejects] : null))
            .toEqual([['miss', 1], ['hit', 0]])
    })

    test('a call with no scripts of the mode set reports an empty pass; the mode of the call is recorded', async () => {
        await call([], 'text', 'editinput')
        const entry = ringOf()!.snapshot()[0]
        expect(entry.kind === 'script' && [entry.mode, entry.cache]).toEqual(['editinput', 'empty'])
    })

    test('with the measurement flag off nothing is recorded and the result is the same', async () => {
        const scripts = [script({ in: 'a', out: 'b' })]
        const measured = await call(scripts, 'aaa', 'editdisplay')
        ringOf()?.reset()
        resetScriptCache()
        h.measure = false
        const plain = await call(scripts, 'aaa', 'editdisplay')
        expect(plain).toEqual(measured)
        expect(ringOf()!.snapshot()).toEqual([])
    })

    test('a message located by a scan is counted in that call only', async () => {
        const mine = { role: 'user', data: 'a' } as Message
        const chat = { message: [{ role: 'user', data: 'other' } as Message, mine] } as Chat
        const subject: Pick<RunSubject, 'resolve' | 'mark'> = {
            resolve: () => ({ chat } as Pick<OriginContext, 'chat'> as OriginContext),
            mark: () => {},
        }
        // `mine` is recorded at index 0 but sits at index 1, so the inject branch has to scan for it.
        await processScriptFull(charWith([script({ in: 'a', out: '@@inject' })]), 'a', 'editdisplay', 1, {}, undefined,
            subject as RunSubject, { message: mine, index: 0 })
        await call([], 'plain', 'editdisplay')
        const [scanning, quiet] = ringOf()!.snapshot()
        expect(scanning.kind === 'script' && [scanning.cache, scanning.scans]).toEqual(['miss', 1])
        expect(quiet.kind === 'script' && quiet.scans).toBe(0)
    })

    test('a send-time pass the cache must not serve is reported as uncached', async () => {
        const promptView: PromptView = { hidden: () => false, firstSent: true }
        // Text holding `{` is not key-determined, so a prompt pass neither reads nor fills the cache.
        await processScriptFull(charWith([script({ in: 'a', out: 'b', type: 'editprocess' })]), '{x} a', 'editprocess', -1, {},
            undefined, undefined, undefined, promptView)
        const entry = ringOf()!.snapshot()[0]
        expect(entry.kind === 'script' && entry.cache).toBe('uncached')
    })

    test('a call that throws before it decides is reported as aborted', async () => {
        h.modulesThrow = true
        await expect(call([], 'text', 'editinput')).rejects.toThrow('module scripts unavailable')
        const entry = ringOf()!.snapshot()[0]
        expect(entry.kind === 'script' && entry.cache).toBe('aborted')
    })
})

/**
 * Microtask ticks a caller's `await` of `promise` waits. Only the equality of two counts under the same counter means
 * anything.
 */
async function ticksUntilSettled(promise: Promise<unknown>): Promise<number> {
    let settled = false
    void promise.then(() => { settled = true }, () => { settled = true })
    let ticks = 0
    while (!settled) {
        await Promise.resolve()
        ticks++
    }
    return ticks
}

describe('processScriptFull timing of the caller', () => {
    // The shape of a pass with no script of the mode: one awaited async step, then a synchronous return.
    const reference = async () => {
        await (async (data: string) => data)('x')
        return { data: 'x', emoChanged: false }
    }

    test('guard: in a normal build a caller waits as many ticks as for the body alone', async () => {
        h.measure = false
        const real = await ticksUntilSettled(call([], 'text', 'editinput'))
        const base = await ticksUntilSettled(reference())
        expect(real).toBe(base)
    })

    test('with the flag on the caller waits at least as long', async () => {
        const base = await ticksUntilSettled(reference())
        h.measure = true
        const measured = await ticksUntilSettled(call([], 'text', 'editinput'))
        expect(measured).toBeGreaterThanOrEqual(base)
    })
})
