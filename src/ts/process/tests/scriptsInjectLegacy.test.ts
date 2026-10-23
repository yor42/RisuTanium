/**
 * The legacy branch of `@@inject` in `processScriptFull` (`../scripts`), taken
 * when the call has no subject: it writes the processed text into the selected
 * chat's message at `chatID`, and only when that character, chat and message
 * exist. A missing target leaves the data and the database as they are.
 *
 * Runs the real `processScriptFull`; everything it imports is mocked inert.
 *
 * The script pass catches a throw of a script and logs it, so the unguarded
 * branch shows as a logged TypeError, not as an escaped one. `regression
 * reproducer:` tests fail against it on that log; `guard:` tests pin the
 * selected-chat write, which passes before and after.
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

const injectScript = (): customscript => ({
    comment: '',
    in: '\\[inject\\]',
    out: '@@inject',
    type: 'editprocess',
} as customscript)

const run = async (data: string, chatID: number) => {
    const char = { type: 'simple', chaId: 'c', customscript: [injectScript()] } as unknown as character
    return (await processScriptFull(char, data, 'editprocess', chatID)).data
}

const message = { role: 'user', data: 'original' }
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    resetScriptCache()
    message.data = 'original'
    h.db = {
        presetRegex: [],
        dynamicAssets: false,
        characters: [{ chatPage: 0, chats: [{ message: [message] }] }],
    }
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    errorSpy.mockClear()
})

describe('processScriptFull legacy @@inject', () => {
    test('guard: the selected chat message at chatID receives the processed text, and the match is removed from the result', async () => {
        const out = await run('hello [inject]', 0)
        expect(message.data).toBe('hello [inject]')
        expect(out).toBe('hello ')
        expect(errorSpy).not.toHaveBeenCalled()
    })

    test('regression reproducer: a chatID past the end of the selected chat writes nothing and logs no error', async () => {
        const out = await run('hello [inject]', 5)
        expect(message.data).toBe('original')
        expect(out).toBe('hello [inject]')
        expect((h.db.characters as { chats: { message: unknown[] }[] }[])[0].chats[0].message).toHaveLength(1)
        expect(errorSpy).not.toHaveBeenCalled()
    })

    test('regression reproducer: a selected chat page with no chat writes nothing and logs no error', async () => {
        ;(h.db.characters as { chatPage: number }[])[0].chatPage = 3
        const out = await run('hello [inject]', 0)
        expect(message.data).toBe('original')
        expect(out).toBe('hello [inject]')
        expect(errorSpy).not.toHaveBeenCalled()
    })

    test('regression reproducer: no selected character writes nothing and logs no error', async () => {
        h.db.characters = []
        const out = await run('hello [inject]', 0)
        expect(message.data).toBe('original')
        expect(out).toBe('hello [inject]')
        expect(errorSpy).not.toHaveBeenCalled()
    })
})
