// @vitest-environment happy-dom

/**
 * `loadLoreBookV3Prompt` (`../lorebook.svelte`) and its optional `probe`.
 *
 * - `guard:` tests pin the engine without a probe: for the three argument
 *   shapes the callers use (`()`, `(subject)`, `(subject, promptView)`) the
 *   returned `actives` and `matchLog`, the final `scriptstate` and the ordered
 *   call log across `Math.random`, `getChatVar`, `setChatVar`,
 *   `markCharacterForSave` and `tokenize` equal a golden recorded on the engine
 *   as it was before the probe seam existed. They pass before and after.
 * - `regression reproducer:` tests fail on an engine that ignores the probe:
 *   a probe's `roll` replaces `Math.random`, a probe's subject never marks the
 *   character for save, and a probe without a subject is refused.
 * - `diagnostic:` tests describe what the probe reports.
 *
 * The real `chatVar` and `chatOrigin` run; the parser is an identity and the
 * tokenizer counts characters, so token arithmetic is the entry length.
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
import { markCharacterForSave } from '../../storage/characterSaveMarks'
import { selectedCharID } from '../../stores.svelte'

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

// One entry per engine rule the seam touches, in an order that makes recursion,
// the child link and the budget cut all fire.
function goldenEntries(): Entry[] {
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
    ]
}

function messages(): Message[] {
    return [
        { role: 'char', data: 'a dragon and a knight at the castle', time: 0 },
        { role: 'user', data: 'hidden alpha beta gamma', time: 0, disabled: true },
        { role: 'user', data: 'the knight said alpha, beta and castle', time: 0 },
        { role: 'char', data: 'a Dragon roars', time: 0 },
    ] as Message[]
}

function scene(lore: Entry[], tokenBudget = 60): { char: character, chat: Chat } {
    const chat = {
        id: 'chat-1',
        name: 'Chat',
        localLore: [],
        message: messages(),
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

type Shape = 'none' | 'subject' | 'subjectView'

async function runShape(shape: Shape, lore: Entry[], probe?: LoreScanProbe) {
    const { char, chat } = scene(lore)
    h.log.length = 0
    vi.mocked(markCharacterForSave).mockClear()
    if (shape === 'none') {
        const result = await loadLoreBookV3Prompt()
        return { result, chat, log: [...h.log] }
    }
    const origin = originOf(char, chat)
    if (!origin) {
        throw new Error('fixture has no origin')
    }
    const subject = createRunSubject(origin)
    if (shape === 'subject') {
        const result = await loadLoreBookV3Prompt(subject)
        return { result, chat, log: [...h.log] }
    }
    const split = splitSentMessages(chat.message)
    const view = promptViewOf(split, split.resetAt === -1)
    const result = await loadLoreBookV3Prompt(subject, view, probe)
    return { result, chat, log: [...h.log] }
}

beforeEach(() => {
    h.db.loreBookDepth = 5
    h.db.loreBookToken = 100000
    h.log.length = 0
})

afterEach(() => {
    vi.restoreAllMocks()
})

// Recorded by running this fixture against the engine before the probe seam
// existed; the seam must leave all three shapes byte-identical.
const GOLDEN_JSON: Record<Shape, string> = {
    none: String.raw`{"actives":[{"depth":0,"pos":"","prompt":"original","role":"system","order":100,"tokens":8,"priority":100,"source":"original","inject":null},{"depth":0,"pos":"","prompt":"regex dragon","role":"system","order":100,"tokens":12,"priority":100,"source":"/dra+gon/i","inject":null},{"depth":0,"pos":"","prompt":"forced","role":"system","order":100,"tokens":6,"priority":100,"source":"never","inject":null},{"depth":0,"pos":"","prompt":"spent","role":"system","order":100,"tokens":5,"priority":100,"source":"beta","inject":null},{"depth":0,"pos":"","prompt":"keeps","role":"system","order":100,"tokens":5,"priority":100,"source":"alpha","inject":null},{"depth":0,"pos":"","prompt":"budget filler entry","role":"system","order":200,"tokens":19,"priority":200,"source":"filler","inject":null}],"matchLog":[{"prompt":"\u0001{{user}}:hidden alpha beta gamma\u0001","source":"message 1 by user","activated":"alpha"},{"prompt":"\u0001{{user}}:hidden alpha beta gamma\u0001","source":"message 1 by user","activated":"beta"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"},{"prompt":"\u0001{{Char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"/dra+gon/i"},{"prompt":"secret word is here","source":"lorebook always one","activated":"secret"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"knight"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"castle"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"castle"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"castle"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"}],"scriptstate":{"$__internal_ka_33":"true","$__internal_da_33":"true"},"log":["random","getChatVar:__internal_ka_33","tokenize:keeps","setChatVar:__internal_ka_33=true","getChatVar:__internal_da_33","tokenize:spent","setChatVar:__internal_da_33=true","tokenize:forced","tokenize:regex dragon","tokenize:secret word is here","tokenize:recursion reached","tokenize:original","tokenize:injected text","tokenize:target body that is long enough to be cut by the budget","tokenize:budget filler entry","random","tokenize:roll one"]}`,
    subject: String.raw`{"actives":[{"depth":0,"pos":"","prompt":"original","role":"system","order":100,"tokens":8,"priority":100,"source":"original","inject":null},{"depth":0,"pos":"","prompt":"regex dragon","role":"system","order":100,"tokens":12,"priority":100,"source":"/dra+gon/i","inject":null},{"depth":0,"pos":"","prompt":"forced","role":"system","order":100,"tokens":6,"priority":100,"source":"never","inject":null},{"depth":0,"pos":"","prompt":"spent","role":"system","order":100,"tokens":5,"priority":100,"source":"beta","inject":null},{"depth":0,"pos":"","prompt":"keeps","role":"system","order":100,"tokens":5,"priority":100,"source":"alpha","inject":null},{"depth":0,"pos":"","prompt":"budget filler entry","role":"system","order":200,"tokens":19,"priority":200,"source":"filler","inject":null}],"matchLog":[{"prompt":"\u0001{{user}}:hidden alpha beta gamma\u0001","source":"message 1 by user","activated":"alpha"},{"prompt":"\u0001{{user}}:hidden alpha beta gamma\u0001","source":"message 1 by user","activated":"beta"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"},{"prompt":"\u0001{{Char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"/dra+gon/i"},{"prompt":"secret word is here","source":"lorebook always one","activated":"secret"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"knight"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"castle"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"castle"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"castle"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"}],"scriptstate":{"$__internal_ka_33":"true","$__internal_da_33":"true"},"log":["random","getChatVar:__internal_ka_33","tokenize:keeps","setChatVar:__internal_ka_33=true","mark:cha-1","getChatVar:__internal_da_33","tokenize:spent","setChatVar:__internal_da_33=true","mark:cha-1","tokenize:forced","tokenize:regex dragon","tokenize:secret word is here","tokenize:recursion reached","tokenize:original","tokenize:injected text","tokenize:target body that is long enough to be cut by the budget","tokenize:budget filler entry","random","tokenize:roll one"]}`,
    subjectView: String.raw`{"actives":[{"depth":0,"pos":"","prompt":"original","role":"system","order":100,"tokens":8,"priority":100,"source":"original","inject":null},{"depth":0,"pos":"","prompt":"regex dragon","role":"system","order":100,"tokens":12,"priority":100,"source":"/dra+gon/i","inject":null},{"depth":0,"pos":"","prompt":"forced","role":"system","order":100,"tokens":6,"priority":100,"source":"never","inject":null},{"depth":0,"pos":"","prompt":"spent","role":"system","order":100,"tokens":5,"priority":100,"source":"beta","inject":null},{"depth":0,"pos":"","prompt":"keeps","role":"system","order":100,"tokens":5,"priority":100,"source":"alpha","inject":null},{"depth":0,"pos":"","prompt":"budget filler entry","role":"system","order":200,"tokens":19,"priority":200,"source":"filler","inject":null}],"matchLog":[{"prompt":"\u0001{{user}}:the knight said alpha, beta and castle\u0001","source":"message 1 by user","activated":"alpha"},{"prompt":"\u0001{{user}}:the knight said alpha, beta and castle\u0001","source":"message 1 by user","activated":"beta"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"},{"prompt":"\u0001{{Char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"/dra+gon/i"},{"prompt":"secret word is here","source":"lorebook always one","activated":"secret"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"knight"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"castle"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"castle"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"castle"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"},{"prompt":"\u0001{{char}}:a dragon and a knight at the castle\u0001","source":"message 0 by char","activated":"dragon"}],"scriptstate":{"$__internal_ka_33":"true","$__internal_da_33":"true"},"log":["random","getChatVar:__internal_ka_33","tokenize:keeps","setChatVar:__internal_ka_33=true","mark:cha-1","getChatVar:__internal_da_33","tokenize:spent","setChatVar:__internal_da_33=true","mark:cha-1","tokenize:forced","tokenize:regex dragon","tokenize:secret word is here","tokenize:recursion reached","tokenize:original","tokenize:injected text","tokenize:target body that is long enough to be cut by the budget","tokenize:budget filler entry","random","tokenize:roll one"]}`,
}


describe('loadLoreBookV3Prompt without a probe', () => {
    for (const shape of ['none', 'subject', 'subjectView'] as Shape[]) {
        test(`guard: ${shape} -- actives, matchLog, scriptstate and the ordered call log equal the golden`, async () => {
            randomSequence([0.9, 0.1])
            const { result, chat, log } = await runShape(shape, goldenEntries())
            const snapshot = {
                actives: result.actives,
                matchLog: result.matchLog,
                scriptstate: chat.scriptstate ?? null,
                log,
            }
            expect(snapshot).toStrictEqual(JSON.parse(GOLDEN_JSON[shape]))
        })
    }
})

function recordingProbe(roll: () => number): { probe: LoreScanProbe, entries: unknown[] } {
    const entries: unknown[] = []
    const probe: LoreScanProbe = {
        roll,
        begin: () => {},
        entry: (record) => { entries.push(record) },
        final: () => {},
    }
    return { probe, entries }
}

function sandboxSubject(char: character, chat: Chat): RunSubject {
    const ctx = { owner: char, ownerIndex: 0, chat, chatIndex: 0, member: null, memberIndex: null }
    return {
        origin: { chaId: 'cha-1', chatId: 'chat-1' },
        resolve: () => ctx,
        status: () => 'ok',
        memberStatus: () => null,
        mark: () => {},
    }
}

describe('loadLoreBookV3Prompt with a probe', () => {
    test('regression reproducer: a probe subject never marks the character for save', async () => {
        const { char, chat } = scene([entry('alpha', '@@keep_activate_after_match\nkeeps')])
        const { probe } = recordingProbe(() => 0)
        vi.mocked(markCharacterForSave).mockClear()
        const result = await loadLoreBookV3Prompt(sandboxSubject(char, chat), undefined, probe)
        expect(result.actives).toHaveLength(1)
        expect(markCharacterForSave).not.toHaveBeenCalled()
    })

    test('regression reproducer: a probe without a subject is refused', async () => {
        scene([entry('alpha', 'body')])
        const { probe } = recordingProbe(() => 0)
        await expect(loadLoreBookV3Prompt(undefined, undefined, probe)).rejects.toThrow()
    })

    test('regression reproducer: the probe roll replaces Math.random in @@probability', async () => {
        const { char, chat } = scene([entry('dragon', '@@probability 50\nroll one')])
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.99)
        const { probe } = recordingProbe(() => 0)
        const result = await loadLoreBookV3Prompt(sandboxSubject(char, chat), undefined, probe)
        expect(result.actives).toHaveLength(1)
        expect(random).not.toHaveBeenCalled()
    })

    test('guard: without the probe @@probability still calls Math.random and can deactivate', async () => {
        const { char, chat } = scene([entry('dragon', '@@probability 50\nroll one')])
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.99)
        const result = await loadLoreBookV3Prompt(sandboxSubject(char, chat))
        expect(result.actives).toHaveLength(0)
        expect(random).toHaveBeenCalledTimes(1)
    })

    test('guard: a probe changes neither actives nor matchLog', async () => {
        const lore = goldenEntries().filter((e) => !String(e.content).includes('@@probability'))
        const plain = await runShape('subjectView', lore)
        const { probe } = recordingProbe(() => 0)
        const probed = await runShape('subjectView', lore, probe)
        expect(probed.result.actives).toStrictEqual(plain.result.actives)
        expect(probed.result.matchLog).toStrictEqual(plain.result.matchLog)
    })
})

