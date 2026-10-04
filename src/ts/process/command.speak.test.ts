// @vitest-environment happy-dom

/**
 * The `/speak` command of the REAL `processMultiCommand` (`./command`).
 *
 * Invariants pinned here:
 *  - the argument is parsed once by the command line and spoken as that parse,
 *    with closed `<Thoughts>` blocks removed and a thinking-only argument
 *    spoken whole;
 *  - the character that speaks is the chat owner, and the command passes the
 *    pipe on unchanged.
 *
 * `sayTTS`, the parser, the alert, generation and the trigger engine are
 * fakes; the parser fake replaces `{{user}}` with `Ann` and counts its calls.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const sayTTSMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))
const parserMock = vi.hoisted(() => vi.fn((text: string, _options?: unknown) => text.replaceAll('{{user}}', 'Ann')))
const dbBox = vi.hoisted(() => ({ db: { characters: [] as unknown[] } }))

vi.mock(import('../alert'), () => ({
    alertInput: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
}) as unknown as typeof import('../alert'))

vi.mock(import('./tts'), () => ({
    sayTTS: sayTTSMock,
}) as unknown as typeof import('./tts'))

vi.mock(import('../parser/parser.svelte'), () => ({
    risuChatParser: parserMock,
}) as unknown as typeof import('../parser/parser.svelte'))

vi.mock(import('./index.svelte'), () => ({
    doingChat: { subscribe: (run: (value: boolean) => void) => { run(false); return () => {} } },
    sendChat: vi.fn(),
}) as unknown as typeof import('./index.svelte'))

vi.mock(import('./lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(),
}) as unknown as typeof import('./lorebook.svelte'))

vi.mock(import('./triggers'), () => ({
    runTrigger: vi.fn(),
}) as unknown as typeof import('./triggers'))

vi.mock(import('./generationOwnership.svelte'), () => ({
    isComposerWindowOpen: vi.fn(() => false),
}) as unknown as typeof import('./generationOwnership.svelte'))

vi.mock(import('../stores.svelte'), () => ({
    get DBState() { return dbBox },
    selectedCharID: { subscribe: (run: (value: number) => void) => { run(0); return () => {} } },
}) as unknown as typeof import('../stores.svelte'))

vi.mock(import('../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
    getCurrentCharacter: vi.fn(() => dbBox.db.characters[0]),
    getCurrentChat: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('../storage/database.svelte'))

import { processMultiCommand } from './command'

function install(type: 'character' | 'group'): { chaId: string, chatId: string } {
    dbBox.db = {
        characters: [{
            chaId: 'char-a',
            name: 'Alpha',
            type,
            chatPage: 0,
            chats: [{ id: 'chat-a', message: [], scriptstate: {} }],
            characters: [],
        }],
    }
    return { chaId: 'char-a', chatId: 'chat-a' }
}

beforeEach(() => {
    sayTTSMock.mockClear()
    parserMock.mockClear()
})

describe('/speak', () => {
    test('guard: the argument is parsed once and the parse is what is spoken, by the chat owner', async () => {
        const origin = install('character')

        const pipe = await processMultiCommand('/speak Hello {{user}}.', { origin })

        expect(parserMock).toHaveBeenCalledTimes(1)
        expect(sayTTSMock).toHaveBeenCalledTimes(1)
        expect(sayTTSMock.mock.calls[0][0]).toBe(dbBox.db.characters[0])
        expect(sayTTSMock.mock.calls[0][1]).toBe('Hello Ann.')
        expect(pipe).toBe('')
    })

    test('regression reproducer: a closed thinking block in the argument is not spoken', async () => {
        const origin = install('character')

        await processMultiCommand('/speak Plan.\n\n<Thoughts>private</Thoughts>\n\nHello {{user}}.', { origin })

        expect(parserMock).toHaveBeenCalledTimes(1)
        expect(sayTTSMock.mock.calls[0][1]).toBe('Plan.\n\nHello Ann.')
    })

    test('guard: an argument that is only thinking is spoken whole', async () => {
        const origin = install('character')

        await processMultiCommand('/speak <Thoughts>only thinking</Thoughts>', { origin })

        expect(sayTTSMock.mock.calls[0][1]).toBe('<Thoughts>only thinking</Thoughts>')
    })

    test('guard: a group owner speaks nothing and the command still passes the pipe on', async () => {
        const origin = install('group')

        const pipe = await processMultiCommand('/pass kept|/speak ignored', { origin })

        expect(sayTTSMock).not.toHaveBeenCalled()
        expect(pipe).toBe('kept')
    })
})
