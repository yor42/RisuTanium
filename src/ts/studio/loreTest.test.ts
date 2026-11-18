/**
 * The lorebook rule tester's runner (`./loreTest`) over the REAL lorebook scan
 * (`../process/lorebook.svelte`), `../parser/chatVar.svelte` and `../cbs`.
 *
 * Tests titled `regression reproducer:` fail on the rule they name when that
 * rule is broken (each names the mutant that must turn it red); `guard:` tests
 * pin behaviour that must keep holding. The parser is an identity and the
 * tokenizer counts characters, so an entry's tokens are its content length.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, character, loreBook, Message } from '../storage/database.svelte'
import type { RunSubject } from '../process/chatOrigin'
import '../polyfill'

const h = vi.hoisted(() => ({
    db: {
        characters: [] as unknown[],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
        templateDefaultVariables: '',
    },
    // What `getModules` lists, and what the scan's `getModuleLorebooks` returns when it must differ.
    modules: [] as unknown[],
    engineModuleLore: null as unknown[] | null,
}))

vi.mock('../stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { DBState: { db: h.db }, selectedCharID: writable(0) }
})
vi.mock('../storage/database.svelte', () => ({
    getDatabase: () => h.db,
    getCurrentChat: () => undefined,
    getCurrentCharacter: () => undefined,
}))
vi.mock('../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../lang', () => ({ language: {} }))
vi.mock('../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../util', () => ({
    findCharacterbyId: vi.fn(() => undefined),
    pickHashRand: (_cid: number, word: string) => word.length,
    selectSingleFile: vi.fn(),
    parseKeyValue: () => [],
}))
vi.mock('../parser/parser.svelte', () => ({ risuChatParser: vi.fn((text: string) => text) }))
vi.mock('../tokenizer', () => ({ tokenize: async (text: string) => text.length }))
vi.mock('../process/modules', () => ({
    getModules: vi.fn(() => h.modules),
    getModuleLorebooks: vi.fn(() => {
        if (h.engineModuleLore) {
            return h.engineModuleLore
        }
        const lore: unknown[] = []
        for (const module of h.modules as { lorebook?: unknown[], 'moduleStub'?: number }[]) {
            if (module['moduleStub'] === 1) {
                continue
            }
            lore.push(...(module.lorebook ?? []))
        }
        return lore
    }),
}))
vi.mock('../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../process/memory/busyActions', () => ({ beginBusy: vi.fn() }))
vi.mock('../process/lorebook.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../process/lorebook.svelte')>()
    return { ...actual, loadLoreBookV3Prompt: vi.fn(actual.loadLoreBookV3Prompt) }
})

import { runLoreTest, copyOwnFields, type LoreTestEntry, type LoreTestResult } from './loreTest'
import { CHAT_SKIP, OWNER_SKIP } from './loreTestFields'
import { loadLoreBookV3Prompt } from '../process/lorebook.svelte'
import { markCharacterForSave } from '../storage/characterSaveMarks'

function lore(key: string, content: string, over: Partial<loreBook> & Record<string, unknown> = {}): loreBook {
    return {
        key,
        comment: over.comment ?? (key || 'entry'),
        content,
        mode: 'normal',
        insertorder: 100,
        alwaysActive: false,
        secondkey: '',
        selective: false,
        ...over,
    } as loreBook
}

function say(data: string, over: Partial<Message> = {}): Message {
    return { role: 'user', data, time: 0, ...over }
}

interface Scene {
    lore?: loreBook[]
    chatLore?: loreBook[]
    messages?: Message[]
    noChat?: boolean
    depth?: number
    budget?: number
    scriptstate?: Record<string, string>
    license?: string
}

function build(scene: Scene): { char: character, chat: Chat } {
    const chat = {
        id: 'chat-1',
        name: 'Chat One',
        note: '',
        localLore: scene.chatLore ?? [],
        message: scene.messages ?? [],
        ...(scene.scriptstate ? { scriptstate: scene.scriptstate } : {}),
    } as unknown as Chat
    const char = {
        type: 'character',
        chaId: 'cha-1',
        name: 'Char',
        chatPage: 0,
        globalLore: scene.lore ?? [],
        loreSettings: {
            scanDepth: scene.depth ?? 10,
            tokenBudget: scene.budget ?? 100000,
            fullWordMatching: false,
            recursiveScanning: true,
        },
        chats: scene.noChat ? [] : [chat],
        ...(scene.license ? { license: scene.license } : {}),
    } as unknown as character
    h.db.characters = [char]
    return { char, chat }
}

async function runOk(scene: Scene, text = ''): Promise<LoreTestResult> {
    build(scene)
    const outcome = await runLoreTest({ chaId: 'cha-1', text })
    if (outcome.status !== 'ok') {
        throw new Error(`refused: ${outcome.reason}`)
    }
    return outcome
}

function byLabel(result: LoreTestResult, label: string): LoreTestEntry {
    const found = result.entries.find((entry) => entry.label === label)
    if (!found) {
        throw new Error(`no entry labelled ${label}`)
    }
    return found
}

beforeEach(() => {
    h.db.loreBookDepth = 5
    h.db.loreBookToken = 100000
    h.modules = []
    h.engineModuleLore = null
    vi.mocked(loadLoreBookV3Prompt).mockClear()
    vi.mocked(markCharacterForSave).mockClear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('where a key was found', () => {
    test('regression reproducer (M-R4, M-R5): a hit names the stored 1-based message position, hidden and beyond-depth messages are not scanned, a typed hit is "typed"', async () => {
        const messages = [
            say('ancient scroll'),
            say('hidden treasure', { disabled: true }),
            say('plain'),
            say('a dragon sleeps'),
            say('plain again'),
            say('plain last'),
        ]
        const result = await runOk({
            depth: 4,
            messages,
            lore: [
                lore('dragon', 'dragon lore', { comment: 'dragon' }),
                lore('treasure', 'hidden lore', { comment: 'treasure' }),
                lore('ancient', 'deep lore', { comment: 'ancient' }),
                lore('wizard', 'typed lore', { comment: 'wizard' }),
            ],
        }, 'a wizard arrives')
        expect(byLabel(result, 'dragon').reason).toStrictEqual({ kind: 'matched', key: 'dragon', at: { kind: 'message', position: 4 } })
        expect(byLabel(result, 'treasure').activated).toBe(false)
        expect(byLabel(result, 'ancient').activated).toBe(false)
        expect(byLabel(result, 'wizard').reason).toStrictEqual({ kind: 'matched', key: 'wizard', at: { kind: 'typed' } })
        expect(result.messageAdded).toBe(true)
        expect(result.contextChat).toStrictEqual({ name: 'Chat One' })
        expect(result.scanDepth).toBe(4)
    })

    test('regression reproducer (M-S5): a recursion hit names the entry whose text it was found in', async () => {
        const result = await runOk({
            lore: [
                lore('', 'a secret word', { alwaysActive: true, comment: 'A' }),
                lore('secret', 'B body', { comment: 'B' }),
            ],
        })
        expect(byLabel(result, 'B').reason).toStrictEqual({ kind: 'matched', key: 'secret', at: { kind: 'entry', index: 0, label: 'A' } })
    })
})

describe('why an entry is active or not', () => {
    test('regression reproducer (M-R8): forced, always and kept each show their own reason', async () => {
        const result = await runOk({
            scriptstate: { $__internal_ka_kk: 'true' },
            lore: [
                lore('', '@@activate\nforced body', { alwaysActive: true, comment: 'forced' }),
                lore('', 'always body', { alwaysActive: true, comment: 'always' }),
                lore('alpha', '@@keep_activate_after_match\nkept body', { id: 'kk', comment: 'kept' }),
            ],
        })
        expect(byLabel(result, 'forced').reason).toStrictEqual({ kind: 'forced', decorator: 'activate' })
        expect(byLabel(result, 'always').reason).toStrictEqual({ kind: 'always', linked: false })
        expect(byLabel(result, 'kept').reason).toStrictEqual({ kind: 'kept' })
    })

    test('regression reproducer (M-R8b, M-R12, M-R16): each not-active reason, and no label says "undefined"', async () => {
        const result = await runOk({
            scriptstate: { $__internal_da_dd: 'true' },
            messages: [say('a dragon and a knight')],
            lore: [
                lore('', 'no key body', { comment: 'nokey' }),
                lore('zzz', 'x', { comment: 'nomatch' }),
                lore('dragon', 'x', { comment: 'nosecond', secondkey: 'qqq', selective: true }),
                lore('dragon', '@@additional_keys qqq\nx', { comment: 'noadditional' }),
                lore('knight', '@@exclude_keys dragon\nx', { comment: 'excluded' }),
                lore('knight', '@@exclude_keys_all\nx', { comment: 'excludedNoHit' }),
                lore('dragon', '@@dont_activate\nx', { comment: 'dontactivate' }),
                lore('dragon', '@@activate_only_after 99\nx', { comment: 'late' }),
                lore('dragon', '@@dont_activate_after_match\nx', { id: 'dd', comment: 'spent' }),
                lore('/(/', 'x', { comment: 'badregex', useRegex: true }),
                lore('dragon', 'orig body', { id: 'L1', comment: 'orig' }),
                lore('qqq', 'x', { id: 'L1', mode: 'child', comment: 'child' }),
            ],
        })
        const reason = (label: string) => byLabel(result, label).reason
        expect(reason('nokey')).toStrictEqual({ kind: 'noKey' })
        expect(reason('nomatch')).toStrictEqual({ kind: 'noMatch', query: 'key' })
        expect(reason('nosecond')).toStrictEqual({ kind: 'noMatch', query: 'secondkey' })
        expect(reason('noadditional')).toStrictEqual({ kind: 'noMatch', query: 'additional' })
        expect(reason('excluded')).toStrictEqual({ kind: 'excluded', key: 'dragon', at: { kind: 'message', position: 1 } })
        expect(reason('excludedNoHit')).toStrictEqual({ kind: 'excludedNoHit', decorator: 'exclude_keys_all' })
        expect(reason('dontactivate')).toStrictEqual({ kind: 'decorator', name: 'dont_activate' })
        expect(reason('late')).toStrictEqual({ kind: 'decorator', name: 'activate_only_after' })
        expect(reason('spent')).toStrictEqual({ kind: 'spent' })
        expect(reason('badregex')).toStrictEqual({ kind: 'invalidRegex', key: '/(/' })
        expect(reason('child')).toStrictEqual({ kind: 'linkedOff' })
        expect(JSON.stringify(result.entries)).not.toContain('undefined')
    })

    test('regression reproducer (M-R16): @@exclude_keys_all with nothing scanned excludes by the decorator, with no key', async () => {
        const result = await runOk({ noChat: true, lore: [lore('x', '@@exclude_keys_all a\nbody', { comment: 'all' })] })
        expect(byLabel(result, 'all').reason).toStrictEqual({ kind: 'excludedNoHit', decorator: 'exclude_keys_all' })
    })

    test('regression reproducer (M-R11): an invalid regex in an exclude query leaves the entry Active with a warning', async () => {
        const result = await runOk({
            messages: [say('a dragon')],
            lore: [lore('dragon', '@@exclude_keys /(/\nbody', { comment: 'warn', useRegex: true })],
        })
        const row = byLabel(result, 'warn')
        expect(row.activated).toBe(true)
        expect(row.warnings).toStrictEqual([{ kind: 'invalidRegex', key: '/(/' }])
    })
})

describe('the token budget and @@inject_lore', () => {
    test('regression reproducer (M-S6): kept entries are numbered in prompt order, cut ones keep their tokens, injectors merge or are dropped', async () => {
        const result = await runOk({
            budget: 22,
            lore: [
                lore('', '@@priority 3\naaaaaaaaaa', { alwaysActive: true, comment: 'A', insertorder: 10 }),
                lore('', '@@priority 2\nbbbbbbbbbb', { alwaysActive: true, comment: 'B', insertorder: 20 }),
                lore('', '@@priority 1\ncccccccccc', { alwaysActive: true, comment: 'C', insertorder: 30 }),
                lore('', '@@priority 99\n@@inject_lore A\nii', { alwaysActive: true, comment: 'inj' }),
                lore('', '@@priority 98\n@@inject_lore Missing\njj', { alwaysActive: true, comment: 'dead' }),
            ],
        })
        const a = byLabel(result, 'A')
        const b = byLabel(result, 'B')
        const c = byLabel(result, 'C')
        expect([a.outcome, a.order]).toStrictEqual(['kept', 1])
        expect([b.outcome, b.order]).toStrictEqual(['kept', 2])
        expect([c.outcome, c.tokens, c.order]).toStrictEqual(['cut', 10, null])
        expect(byLabel(result, 'inj').outcome).toBe('merged')
        expect(byLabel(result, 'inj').mergedInto).toBe('A')
        expect(byLabel(result, 'dead').outcome).toBe('injectTargetMissing')
        expect(result.budget).toStrictEqual({ used: 22, limit: 22 })
    })
})

describe('@@probability', () => {
    test('regression reproducer (M-R9): a probability entry is Active with its chance and the run never rolls Math.random', async () => {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.99)
        const result = await runOk({
            messages: [say('a dragon')],
            lore: [
                lore('dragon', '@@probability 30\nx', { comment: 'thirty' }),
                lore('dragon', '@@probability 0\nx', { comment: 'zero' }),
            ],
        })
        expect(byLabel(result, 'thirty')).toMatchObject({ activated: true, chance: 30 })
        expect(byLabel(result, 'zero')).toMatchObject({ activated: true, chance: 0 })
        expect(random).not.toHaveBeenCalled()
    })
})

describe('the typed message and the context chat', () => {
    test('regression reproducer (M-R10): with no context chat only the typed message is scanned', async () => {
        const result = await runOk({ noChat: true, lore: [lore('wizard', 'x', { comment: 'w' })] }, 'a wizard')
        expect(result.contextChat).toBeNull()
        expect(result.messageAdded).toBe(true)
        expect(byLabel(result, 'w').reason).toStrictEqual({ kind: 'matched', key: 'wizard', at: { kind: 'typed' } })
    })

    test.each(['', '   \n'])('regression reproducer (M-R13): blank text %j adds no message, with a chat or without', async (text) => {
        for (const noChat of [false, true]) {
            const { chat } = build({
                noChat,
                messages: [say('dragon here')],
                lore: [lore('/^$/', 'x', { comment: 'empty', useRegex: true }), lore('dragon', 'x', { comment: 'dragon' })],
            })
            const outcome = await runLoreTest({ chaId: 'cha-1', text })
            if (outcome.status !== 'ok') {
                throw new Error('refused')
            }
            expect(outcome.messageAdded).toBe(false)
            expect(byLabel(outcome, 'empty').activated).toBe(false)
            expect(byLabel(outcome, 'dragon').activated).toBe(!noChat)
            expect(chat.message).toHaveLength(1)
        }
    })
})

describe('who owns an entry', () => {
    const modules = () => [
        { id: 'm1', lorebook: [lore('mk1', 'm1 body', { comment: 'm1e' })] },
        { id: 'stub', 'moduleStub': 1, lorebook: [lore('zz', 'never read', { comment: 'stubbed' })] },
        { id: 'm2', lorebook: [lore('mk2', 'm2 body', { comment: 'm2e' })] },
    ]

    test('regression reproducer (M-R6): character, chat and module entries get their own owner; a stub contributes none', async () => {
        h.modules = modules()
        const result = await runOk({
            messages: [say('mk1 mk2 c1 c2 k1')],
            lore: [lore('c1', 'x', { comment: 'c1e' }), lore('c2', 'x', { comment: 'c2e' })],
            chatLore: [lore('k1', 'x', { comment: 'k1e' })],
        })
        expect(result.attribution).toBe('ok')
        expect(byLabel(result, 'c2e').owner).toStrictEqual({ type: 'character', id: null, index: 1 })
        expect(byLabel(result, 'k1e').owner).toStrictEqual({ type: 'chat', id: 'chat-1', index: 0 })
        expect(byLabel(result, 'm1e').owner).toStrictEqual({ type: 'module', id: 'm1', index: 0 })
        expect(byLabel(result, 'm2e').owner).toStrictEqual({ type: 'module', id: 'm2', index: 0 })
        expect(result.entries.find((entry) => entry.label === 'stubbed')).toBeUndefined()
    })

    test('guard: owners that do not add up to the scan are reported as unavailable, never guessed', async () => {
        h.modules = modules()
        h.engineModuleLore = [lore('only', 'x', { comment: 'lonely' })]
        const result = await runOk({ messages: [say('only')], lore: [lore('c1', 'x', { comment: 'c1e' })] })
        expect(result.attribution).toBe('unavailable')
        expect(result.entries.every((entry) => entry.owner === null)).toBe(true)
    })
})

describe('refusals', () => {
    test.each([
        ['restricted', { license: 'private' }],
        ['cold', {}],
        ['group', {}],
    ] as const)('regression reproducer (M-R7): a %s character is refused and the scan is never called', async (reason, extra) => {
        const { char } = build({ ...extra, lore: [lore('x', 'y')] })
        if (reason === 'cold') {
            ;(char as unknown as Record<string, unknown>).coldstorage = 'pointer'
        }
        if (reason === 'group') {
            ;(char as unknown as Record<string, unknown>).type = 'group'
        }
        const outcome = await runLoreTest({ chaId: 'cha-1', text: 'x' })
        expect(outcome).toStrictEqual({ status: 'refused', reason })
        expect(loadLoreBookV3Prompt).not.toHaveBeenCalled()
    })

    test('guard: a missing character is refused', async () => {
        build({})
        expect(await runLoreTest({ chaId: 'nobody', text: '' })).toStrictEqual({ status: 'refused', reason: 'missing' })
        expect(loadLoreBookV3Prompt).not.toHaveBeenCalled()
    })
})

describe('what a run reads', () => {
    interface Access { kind: string, key: string }

    function recording<T extends object>(target: T, log: Access[]): T {
        return new Proxy(target, {
            get(object, key, receiver) {
                log.push({ kind: 'get', key: String(key) })
                return Reflect.get(object, key, receiver)
            },
            has(object, key) {
                log.push({ kind: 'has', key: String(key) })
                return Reflect.has(object, key)
            },
            ownKeys(object) {
                log.push({ kind: 'ownKeys', key: '' })
                return Reflect.ownKeys(object)
            },
            getOwnPropertyDescriptor(object, key) {
                log.push({ kind: 'descriptor', key: String(key) })
                return Reflect.getOwnPropertyDescriptor(object, key)
            },
        })
    }

    test('regression reproducer (M-R14, M-R15): other chats are never touched and the context chat\'s memory fields are neither read nor copied', async () => {
        const other0: Access[] = []
        const other2: Access[] = []
        const chatsLog: Access[] = []
        const contextLog: Access[] = []
        const ownerLog: Access[] = []
        const sentinel = { sentinel: true }
        const chat0 = recording({ id: 'c0', name: 'c0', note: '', localLore: [], message: [say('other zero')] }, other0)
        const context = recording({
            id: 'c1',
            name: 'Context',
            note: '',
            localLore: [],
            message: [say('a dragon')],
            alt: [sentinel],
            hypaV2Data: sentinel,
            hypaV3Data: sentinel,
            supaMemoryData: 'memory',
            supaMemoryCoveredId: 'covered',
            lastMemory: 'last',
            sdData: 'sd',
            suggestMessages: ['s'],
            bookmarks: ['b'],
            bookmarkNames: { b: 'n' },
        }, contextLog)
        const chat2 = recording({ id: 'c2', name: 'c2', note: '', localLore: [], message: [say('other two')] }, other2)
        const chats = recording([chat0, context, chat2], chatsLog)
        const live = recording({
            type: 'character',
            chaId: 'cha-1',
            name: 'Char',
            chatPage: 1,
            globalLore: [lore('dragon', 'x', { comment: 'd' })],
            loreSettings: { scanDepth: 5, tokenBudget: 1000, recursiveScanning: true },
            chats,
        }, ownerLog)
        h.db.characters = [live]
        const outcome = await runLoreTest({ chaId: 'cha-1', text: '' })
        expect(outcome.status).toBe('ok')

        expect(other0).toStrictEqual([])
        expect(other2).toStrictEqual([])
        expect(chatsLog).toStrictEqual([{ kind: 'get', key: '1' }])
        expect(ownerLog.filter((access) => access.key === 'chats' && access.kind === 'get')).toHaveLength(1)
        // Enumerating keys asks for descriptors, which does not read a value; only a get does.
        const read = new Set(contextLog.filter((access) => access.kind === 'get').map((access) => access.key))
        for (const key of CHAT_SKIP) {
            expect(read.has(key)).toBe(false)
        }

        const subject = vi.mocked(loadLoreBookV3Prompt).mock.calls[0][0] as RunSubject
        const ctx = subject.resolve()
        expect(Object.keys(ctx.chat).filter((key) => CHAT_SKIP.has(key))).toStrictEqual([])
        expect(ctx.owner.chats).toHaveLength(2)
        expect(Object.keys(ctx.owner.chats)).toStrictEqual(['1'])
    })

    test('guard: copyOwnFields never reads a skipped key and copies the others deeply', () => {
        const log: Access[] = []
        const source = { keep: { nested: [1] }, skipMe: { deep: true }, plain: 3 }
        const copy = copyOwnFields(recording(source, log), new Set(['skipMe']))
        expect(log.filter((access) => access.key === 'skipMe' && access.kind === 'get')).toStrictEqual([])
        expect(Object.keys(copy)).toStrictEqual(['keep', 'plain'])
        expect(copy.keep).toStrictEqual({ nested: [1] })
        expect(copy.keep).not.toBe(source.keep)
        expect(OWNER_SKIP.has('chats')).toBe(true)
    })
})
