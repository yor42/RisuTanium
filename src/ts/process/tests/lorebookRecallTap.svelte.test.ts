// @vitest-environment happy-dom

/**
 * The recall tap of `loadLoreBookV3Prompt` (`../lorebook.svelte`): an optional fourth argument that records which entries
 * missed on their primary key on the final pass and lets a step place some of them.
 *
 * - `guard:` tests pin that a tap which places nothing leaves actives, matchLog, scriptstate and the ordered call log
 *   (`Math.random`, `getChatVar`, `setChatVar`, `markCharacterForSave`, `tokenize`) equal to the scan without a tap.
 * - `regression reproducer:` tests fail on a scan that ignores the fourth argument (the step is never called and
 *   `recalled` is undefined).
 *
 * The real `chatVar` and `chatOrigin` run; the parser is an identity and the tokenizer counts characters, so token
 * arithmetic is the entry length.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, character, Message } from '../../storage/database.svelte'
import type { RunSubject } from '../chatOrigin'
import type { LoreScanProbe } from '../lorebook.svelte'
import '../../polyfill'

const h = vi.hoisted(() => ({
    db: {
        characters: [] as unknown[],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
        templateDefaultVariables: '',
    },
    log: [] as string[],
}))

vi.mock('../../stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { db: h.db },
        selectedCharID: store(0),
    }
})
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
    getCurrentChat: () => undefined,
    getCurrentCharacter: () => undefined,
}))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../../lang', () => ({ language: {} }))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../util', () => ({
    findCharacterbyId: vi.fn(() => undefined),
    pickHashRand: (_cid: number, word: string) => word.length,
    selectSingleFile: vi.fn(),
    parseKeyValue: () => [],
}))
vi.mock('../../parser/chatVar.svelte', async () => {
    const real = await vi.importActual<typeof import('../../parser/chatVar.svelte')>('../../parser/chatVar.svelte')
    return {
        ...real,
        getChatVar: (key: string, subject?: RunSubject) => {
            h.log.push(`getChatVar:${key}`)
            return real.getChatVar(key, subject)
        },
        setChatVar: (key: string, value: string, subject?: RunSubject) => {
            h.log.push(`setChatVar:${key}=${value}`)
            return real.setChatVar(key, value, subject)
        },
    }
})
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn((text: string) => text) }))
vi.mock('../../tokenizer', () => ({
    tokenize: async (text: string) => {
        h.log.push(`tokenize:${text}`)
        return text.length
    },
}))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({
    markCharacterForSave: vi.fn((chaId: string) => {
        h.log.push(`mark:${chaId}`)
    }),
}))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { loadLoreBookV3Prompt } from '../lorebook.svelte'
import { createRunSubject, originOf } from '../chatOrigin'
import { promptViewOf, splitSentMessages } from '../../cbs'
import { selectedCharID } from '../../stores.svelte'
import { risuChatParser } from '../../parser/parser.svelte'
import { createLoreIndexStore } from '../memory/chroMemory/loreIndex'
import { createLoreRecallStep, type LoreRecallTap, type LoreRecallView } from '../memory/chroMemory/loreRecall'
import { chroLoreTrace } from '../memory/chroMemory/traceStore'
import { get } from 'svelte/store'

type Entry = Record<string, unknown>

function entry(key: string, content: string, over: Entry = {}): Entry {
    return {
        key,
        comment: key || 'always',
        content,
        mode: 'normal',
        insertorder: 100,
        alwaysActive: false,
        secondkey: '',
        selective: false,
        ...over,
    }
}

function messages(extra = ''): Message[] {
    return [
        { role: 'char', data: 'a dragon and a knight at the castle', time: 0 },
        { role: 'user', data: 'hidden alpha beta gamma', time: 0, disabled: true },
        { role: 'user', data: 'the knight said alpha, beta and castle' + extra, time: 0 },
        { role: 'char', data: 'a Dragon roars', time: 0 },
    ] as Message[]
}

function scene(lore: Entry[], tokenBudget = 100000, chatLore: Entry[] = [], extra = ''): { char: character, chat: Chat } {
    const chat = {
        id: 'chat-1',
        name: 'Chat',
        localLore: chatLore,
        message: messages(extra),
    } as unknown as Chat
    const char = {
        name: 'Char',
        chaId: 'cha-1',
        chatPage: 0,
        globalLore: lore,
        loreSettings: { scanDepth: 5, tokenBudget, fullWordMatching: false, recursiveScanning: true },
        chats: [chat],
    } as unknown as character
    h.db.characters = [char]
    selectedCharID.set(0)
    return { char, chat }
}

function randomSequence(values: number[]): void {
    let next = 0
    vi.spyOn(Math, 'random').mockImplementation(() => {
        h.log.push('random')
        const value = values[next % values.length]
        next++
        return value
    })
}

interface RunOptions {
    tap?: LoreRecallTap
    probe?: LoreScanProbe
    tokenBudget?: number
    chatLore?: Entry[]
    extra?: string
}

async function runScan(lore: Entry[], options: RunOptions = {}) {
    const { char, chat } = scene(lore, options.tokenBudget, options.chatLore, options.extra)
    h.log.length = 0
    const origin = originOf(char, chat)
    if (!origin) {
        throw new Error('fixture has no origin')
    }
    const subject = createRunSubject(origin)
    const split = splitSentMessages(chat.message)
    const view = promptViewOf(split, split.resetAt === -1)
    const result = await loadLoreBookV3Prompt(subject, view, options.probe, options.tap)
    return { result, chat, char, log: [...h.log] }
}

interface Stub {
    tap: LoreRecallTap
    views: LoreRecallView[]
}

function stub(run: (view: LoreRecallView) => number[] | Promise<number[]>, cap = 100000): Stub {
    const views: LoreRecallView[] = []
    return {
        views,
        tap: {
            cap,
            run(view) {
                views.push(view)
                return run(view)
            },
        },
    }
}

const comparable = (r: Awaited<ReturnType<typeof runScan>>) => ({
    actives: r.result.actives,
    matchLog: r.result.matchLog,
    used: r.result.used,
    scriptstate: r.chat.scriptstate ?? null,
    log: r.log,
})

beforeEach(() => {
    h.db.loreBookDepth = 5
    h.db.loreBookToken = 100000
    h.log.length = 0
})

afterEach(() => {
    vi.restoreAllMocks()
})

// One entry per rule the recorder must follow: the key never appears in the chat except for the blocked and
// exclude-first entries, whose keys do.
function recorderEntries(): Entry[] {
    return [
        entry('zebra', 'plain zebra body'),
        entry('secretword', 'late a'),
        entry('', 'has secretword inside', { alwaysActive: true, comment: 'always one' }),
        entry('knight', '@@activate_only_after 99\nblocked body'),
        entry('zebra', '@@exclude_keys dragon\nexcl body'),
        entry('zzz', '@@activate\nforced body'),
        entry('', 'nokey body'),
        entry('quokka', '@@priority 5\n@@match_full_word\nquokka body'),
    ]
}

// The golden entries of lorebookProbe.compat plus two more: a decorator-blocked entry whose key is in the chat and an
// exclude-first entry.
function parityEntries(): Entry[] {
    return [
        entry('dragon', '@@probability 50\nroll one'),
        entry('alpha', '@@keep_activate_after_match\nkeeps'),
        entry('beta', '@@dont_activate_after_match\nspent'),
        entry('gamma', '@@activate_only_after 99\nlate'),
        entry('never', '@@activate\nforced'),
        entry('dragon', '@@dont_activate\noff'),
        entry('knight', '@@exclude_keys dragon\nexcluded knight'),
        entry('/dra+gon/i', 'regex dragon', { useRegex: true }),
        entry('/(/', 'broken regex', { useRegex: true }),
        entry('', 'secret word is here', { alwaysActive: true, comment: 'always one' }),
        entry('secret', 'recursion reached', { comment: 'recursion one' }),
        entry('knight', 'original', { id: 'L1', comment: 'original' }),
        entry('x', 'child body', { id: 'L1', mode: 'child', comment: 'child' }),
        entry('castle', 'injected text', { comment: 'injector', insertorder: 50, content: '@@inject_lore target\ninjected text' }),
        entry('castle', 'target body that is long enough to be cut by the budget', { comment: 'target', insertorder: 10 }),
        entry('castle', 'budget filler entry', { comment: 'filler', insertorder: 200 }),
        entry('castle', '@@activate_only_every 7\nblocked castle'),
        entry('dragon', '@@exclude_keys knight\nexclude first'),
        entry('zebra', 'plain zebra body'),
        // A key miss that carries both observable decorator effects: the recorder must not draw or read chat variables for it.
        entry('unseenword', '@@probability 100\n@@keep_activate_after_match\nmissed with decorators', { id: 'M1X' }),
    ]
}

describe('recall tap parity', () => {
    test('guard (passes without the tap argument too): a tap whose step places nothing leaves actives, matchLog, used, scriptstate and the call log equal to the scan without a tap', async () => {
        randomSequence([0.9, 0.1])
        const off = comparable(await runScan(parityEntries(), { tokenBudget: 60 }))
        randomSequence([0.9, 0.1])
        const { tap } = stub(() => [])
        const on = comparable(await runScan(parityEntries(), { tokenBudget: 60, tap }))
        expect(on).toStrictEqual(off)
        expect(on.log.filter((l) => l === 'random')).toHaveLength(4)
    })

    test('guard: the same holds with every entry of the golden set but no budget cut', async () => {
        randomSequence([0.9, 0.1])
        const off = comparable(await runScan(parityEntries(), { tokenBudget: 100000 }))
        randomSequence([0.9, 0.1])
        const { tap } = stub(() => [])
        const on = comparable(await runScan(parityEntries(), { tokenBudget: 100000, tap }))
        expect(on).toStrictEqual(off)
    })

    test('guard: a probe run never calls the step and the tap result shape is absent', async () => {
        const { char, chat } = scene(recorderEntries())
        const subject = createRunSubject(originOf(char, chat)!)
        const { tap, views } = stub(() => [0])
        const probe: LoreScanProbe = { roll: () => 0, begin: () => {}, entry: () => {}, final: () => {} }
        const result = await loadLoreBookV3Prompt(subject, undefined, probe, tap)
        expect(views).toHaveLength(0)
        expect(result.recalled).toBeUndefined()
    })

    test('guard: without a tap the result carries no recalled field', async () => {
        const { result } = await runScan(recorderEntries())
        expect(result.recalled).toBeUndefined()
    })
})

describe('recall tap recorder', () => {
    test('regression reproducer: the step is called once with exactly the final-pass keyword misses', async () => {
        const { tap, views } = stub(() => [])
        await runScan(recorderEntries(), { tap })
        expect(views).toHaveLength(1)
        expect([...views[0].missed.keys()].sort((a, b) => a - b)).toEqual([0, 7])
    })

    test('regression reproducer: a plain miss carries its stripped body and the decorator names the scan saw', async () => {
        const { tap, views } = stub(() => [])
        await runScan(recorderEntries(), { tap })
        const { missed } = views[0]
        expect(missed.get(0)).toEqual({ body: 'plain zebra body', decorators: [] })
        expect(missed.get(7)).toEqual({ body: 'quokka body', decorators: ['priority', 'match_full_word'] })
    })

    test('regression reproducer: not recorded are a pass-2 recursion activation, decorator-blocked, exclude-first, forced, alwaysActive and noKey entries', async () => {
        const { tap, views } = stub(() => [])
        const { result } = await runScan(recorderEntries(), { tap })
        const missed = views[0].missed
        // 1 recursion activation, 2 alwaysActive, 3 blocked, 4 exclude-first, 5 forced, 6 noKey
        for (const i of [1, 2, 3, 4, 5, 6]) {
            expect(missed.has(i), `entry ${i}`).toBe(false)
        }
        expect(result.actives.map((a) => a.prompt)).toContain('late a')
    })

    test('regression reproducer: the view carries the scan context', async () => {
        const { tap, views } = stub(() => [])
        await runScan(recorderEntries(), { tap, tokenBudget: 5000 })
        const view = views[0]
        expect(view.entries).toHaveLength(recorderEntries().length)
        expect(view.characterCount).toBe(recorderEntries().length)
        expect(view.chatCount).toBe(0)
        expect(view.loreToken).toBe(5000)
        expect(view.cutForBudget).toBe(false)
        expect(view.limit).toBe(Math.min(view.unusedTokens, 100000))
    })
})

describe('recall tap budget cut', () => {
    test('regression reproducer: a filler cut for budget gives cutForBudget and a valid miss placed by the step is ignored', async () => {
        const { tap, views } = stub((view) => [...view.missed.keys()])
        const { result } = await runScan(parityEntries(), { tap, tokenBudget: 60 })
        expect(views[0].cutForBudget).toBe(true)
        expect(result.recalled).toEqual([])
    })

    test('new-rule test: a dead injector with no budget cut is not a cut and its tokens are not counted', async () => {
        const lore = [
            entry('knight', 'knight body'),
            entry('castle', '@@inject_lore nowhere\ninjected text', { comment: 'injector' }),
            entry('zebra', 'plain zebra body'),
        ]
        const { tap, views } = stub(() => [])
        await runScan(lore, { tap, tokenBudget: 100000 })
        expect(views[0].cutForBudget).toBe(false)
        expect(views[0].unusedTokens).toBe(100000 - 'knight body'.length)
    })
})

// 0 knight (activated, 11 tokens), 1 twenty-char miss, 2 ten-char miss, 3 ten-char miss.
function budgetEntries(): Entry[] {
    return [
        entry('knight', 'knight body'),
        entry('zebra', 'zebra twenty chars!!'),
        entry('quokka', 'quokka ten', { insertorder: 150 }),
        entry('okapi', 'okapi nine', { insertorder: 50 }),
    ]
}

describe('recall tap enforcement of the lore budget', () => {
    test('regression reproducer: row 1, U binding -- an index over the unused tokens is dropped and the next one that fits is kept', async () => {
        const { tap } = stub(() => [1, 2, 3])
        const { result } = await runScan(budgetEntries(), { tap, tokenBudget: 21 })
        expect(result.recalled!.map((r) => r.index)).toEqual([2])
        expect(result.actives.reduce((sum, a) => sum + a.tokens, 0)).toBeLessThanOrEqual(21)
    })

    test('regression reproducer: row 2, cap binding -- tap.cap below the unused tokens drops what fits U', async () => {
        const { tap } = stub(() => [1, 2, 3], 15)
        const { result } = await runScan(budgetEntries(), { tap, tokenBudget: 100000 })
        expect(result.recalled!.map((r) => r.index)).toEqual([2])
    })

    test('new-rule test: row 3, NaN budget with no activated entry places nothing (kills a NaN-admitting comparison)', async () => {
        const lore = [entry('quokka', 'quokka ten')]
        const { tap, views } = stub(() => [0], 5000)
        const { result } = await runScan(lore, { tap, tokenBudget: Number.NaN })
        expect(views[0].cutForBudget).toBe(false)
        expect(views[0].limit).toBeNaN()
        expect(result.recalled).toEqual([])
        expect(result.actives).toEqual([])
    })

    test('regression reproducer: row 4, recalled plus survivor tokens never exceed loreToken', async () => {
        const { tap } = stub(() => [2, 3], 100000)
        const { result } = await runScan(budgetEntries(), { tap, tokenBudget: 31 })
        expect(result.recalled!.map((r) => r.index)).toEqual([2, 3])
        expect(result.actives.reduce((sum, a) => sum + a.tokens, 0)).toBeLessThanOrEqual(31)
    })
})

describe('recall tap placement', () => {
    test('regression reproducer: recalled entries are normal-position actives ordered by insertorder, in used, and listed in rank order', async () => {
        const { tap } = stub(() => [2, 3])
        const { result } = await runScan(budgetEntries(), { tap })
        expect(result.recalled!.map((r) => r.index)).toEqual([2, 3])
        expect(result.actives.map((a) => a.prompt)).toEqual(['okapi nine', 'knight body', 'quokka ten'])
        expect(result.used.map((u) => u.index)).toEqual([3, 0, 2])
        const placed = result.recalled![0].active
        expect(placed).toEqual({ depth: 0, pos: '', prompt: 'quokka ten', role: 'system', order: 150, tokens: 10, priority: 150, source: 'quokka', inject: null })
        expect(result.actives).toContain(placed)
    })

    test('guard: a step that returns [] leaves the result equal to the scan without a tap', async () => {
        const off = comparable(await runScan(budgetEntries()))
        const on = await runScan(budgetEntries(), { tap: stub(() => []).tap })
        expect(comparable(on)).toStrictEqual(off)
        expect(on.result.recalled).toEqual([])
    })

    test('new-rule test: the render uses the scan options (no runVar, the prompt view) and is cached per index', async () => {
        vi.mocked(risuChatParser).mockClear()
        const { tap } = stub(async (view) => {
            await view.render(2)
            await view.render(2)
            return [2]
        })
        await runScan(budgetEntries(), { tap })
        const calls = vi.mocked(risuChatParser).mock.calls.filter((c) => c[0] === 'quokka ten')
        expect(calls).toHaveLength(1)
        const options = calls[0][1] as Record<string, unknown>
        expect(Object.keys(options).sort()).toEqual(['chara', 'promptView', 'subject'])
        expect(options.runVar).toBeUndefined()
    })
})

describe('recall tap scan-side enforcement of the miss rule', () => {
    // 0 A (pass-2 recursion), 1 alwaysActive, 2 B noKey, 3 C blocked, 4 D exclude-first, 5 M plain miss
    function enforceEntries(): Entry[] {
        return [
            entry('secretword', 'late a'),
            entry('', 'has secretword inside', { alwaysActive: true, comment: 'always one' }),
            entry('', 'nokey body'),
            entry('knight', '@@activate_only_after 99\nblocked body'),
            entry('zebra', '@@exclude_keys dragon\nexcl body'),
            entry('quokka', 'quokka ten'),
        ]
    }

    test('regression reproducer: only the valid miss is kept, once, and the others place nothing (T29a)', async () => {
        const { tap, views } = stub(() => [0, 2, 3, 4, 5, 5])
        const { result } = await runScan(enforceEntries(), { tap })
        // Sizing self-check: the budget cannot be what rejects an index.
        const bodies = ['late a', 'nokey body', 'blocked body', 'excl body', 'quokka ten', 'quokka ten', 'has secretword inside']
        expect(views[0].limit).toBeGreaterThan(bodies.reduce((sum, b) => sum + b.length, 0))
        expect(result.recalled!.map((r) => r.index)).toEqual([5])
        const prompts = result.actives.map((a) => a.prompt)
        expect(prompts.filter((p) => p === 'quokka ten')).toHaveLength(1)
        expect(prompts.filter((p) => p === 'late a')).toHaveLength(1)
        for (const absent of ['nokey body', 'blocked body', 'excl body']) {
            expect(prompts).not.toContain(absent)
        }
    })

    test('new-rule test: out-of-range, negative and non-integer indexes are rejected before any entry is read (T29b)', async () => {
        const { tap } = stub((view) => [-1, view.entries.length, 1.5, 5])
        const { result } = await runScan(enforceEntries(), { tap })
        expect(result.recalled!.map((r) => r.index)).toEqual([5])
    })
})

describe('recall tap errors', () => {
    test('guard: a step that throws leaves the result equal to the scan without a tap and keeps nothing', async () => {
        const off = comparable(await runScan(budgetEntries()))
        const on = await runScan(budgetEntries(), { tap: stub(() => { throw new Error('boom') }).tap })
        expect(comparable(on)).toStrictEqual(off)
        expect(on.result.recalled).toEqual([])
    })

    test('guard: a step that rejects keeps nothing', async () => {
        const on = await runScan(budgetEntries(), { tap: stub(() => Promise.reject(new Error('boom'))).tap })
        expect(on.result.recalled).toEqual([])
    })
})

describe('recall tap with the real step and index', () => {
    function realStep(query: string, scheduled: Array<() => void>, store = createLoreIndexStore({
        hash: (c) => c.length,
        schedule: (run) => { scheduled.push(run) },
        now: () => 0,
    })) {
        const step = createLoreRecallStep({
            mode: 'inject',
            settings: { loreRecallCap: 5000 },
            query,
            ownerKey: 'cha-1',
            chatKey: 'chat-1',
            deps: { store, hash: (c) => c.length, now: () => 0 },
        })
        return { step, store }
    }
    const drain = (queue: Array<() => void>) => { while (queue.length) queue.shift()!() }
    const fillerLore = (n: number): Entry[] => Array.from({ length: n }, (_, i) => entry(`nokey${i}`, `filler number ${i} market weather harvest road`))

    test('new-rule test: a parent linked by a child entry is never recalled (R-L) and the link text appears once (T9c)', async () => {
        const queue: Array<() => void> = []
        const lore = [entry('frostwyrm', '@@unrecursive\nfrostwyrm lair deep', { id: 'X1', comment: 'parent' }), ...fillerLore(25)]
        // The link in the field set the lore editor writes for a linked copy.
        const link = entry('', '', { id: 'X1', mode: 'child', alwaysActive: true, comment: 'link' })
        const { step } = realStep('frostwyrm', queue)
        await runScan(lore, { chatLore: [link], tap: step })
        drain(queue)
        const second = await runScan(lore, { chatLore: [link], tap: step })
        expect(second.result.recalled).toEqual([])
        expect(get(chroLoreTrace)!.candidates.linked).toBe(1)
        expect(second.result.actives.filter((a) => a.prompt === 'frostwyrm lair deep')).toHaveLength(1)
    })

    test('new-rule test: a child link filled by one scan and left empty by the next never changes the index (T16c)', async () => {
        const queue: Array<() => void> = []
        const lore = [entry('zebra', '@@unrecursive\nzebra lair deep', { id: 'X1', comment: 'parent' }), ...fillerLore(5)]
        const link = entry('', '', { id: 'X1', mode: 'child', alwaysActive: true, comment: 'link' })
        const { step, store } = realStep('anything', queue)
        // Send 1: the parent misses, so the scan fills the link; the first build starts.
        await runScan(lore, { chatLore: [link], tap: step })
        expect(get(chroLoreTrace)!.index.state).toBe('building')
        drain(queue)
        const built = store.info()
        expect(built.state).toBe('ready')
        // Send 2: the parent misses again and the link is filled again.
        await runScan(lore, { chatLore: [link], tap: step })
        expect(queue).toHaveLength(0)
        expect(get(chroLoreTrace)!.index.state).toBe('ready')
        // Send 3: the key now matches, so the parent activates and the link stays empty.
        await runScan(lore, { chatLore: [link], tap: step, extra: ' zebra' })
        expect(queue).toHaveLength(0)
        expect(get(chroLoreTrace)!.index.state).toBe('ready')
        expect(store.info()).toEqual(built)
    })
})
