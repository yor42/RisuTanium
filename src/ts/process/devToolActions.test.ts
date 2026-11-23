/**
 * `runAutopilot` against the per-chat send gate, through the real `activeUnits` registry and the real selection.
 *
 * Test kinds: "guard:" rows pass before and after the change; the other row is a regression reproducer that fails
 * while the gate is one flag for every chat.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, character } from 'src/ts/storage/database.svelte'

vi.mock(import('./index.svelte'), async () => {
    const { activeUnits } = await import('./activeUnits')
    return {
        doingChat: activeUnits.active,
        sendChat: vi.fn(async () => true),
    } as unknown as typeof import('./index.svelte')
})
vi.mock(import('./previewRunner'), () => ({
    memberLabel: vi.fn(),
    previewMayStart: vi.fn(() => true),
    renderPromptResult: vi.fn(),
    runPreview: vi.fn(),
}) as unknown as typeof import('./previewRunner'))
vi.mock(import('../parser/parser.svelte'), () => ({
    risuChatParser: vi.fn((text: string) => text),
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('../parser/parser.svelte'))
vi.mock(import('./templates/chatTemplate'), () => ({
    applyChatTemplate: vi.fn(),
}) as unknown as typeof import('./templates/chatTemplate'))

import { DBState, selectedCharID } from '../stores.svelte'
import { sendChat } from './index.svelte'
import { runAutopilot } from './devToolActions'
import { resetRunningRepliesForTests } from '../nativeReply/runningReplies.svelte'
import { clearRunningSends, simulateRunningSend } from './tests/activeUnits.test-helpers'

function makeCharacter(chaId: string): character {
    return {
        type: 'character',
        name: chaId,
        chaId,
        chatPage: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: 'Chat', localLore: [] }],
    } as unknown as character
}

const A = { chaId: 'char-a', chatId: 'char-a-chat' }

beforeEach(() => {
    DBState.db = { characters: [makeCharacter('char-a'), makeCharacter('char-b')] } as unknown as Database
    vi.mocked(sendChat).mockClear()
    clearRunningSends()
    resetRunningRepliesForTests()
})

afterEach(() => {
    clearRunningSends()
    resetRunningRepliesForTests()
})

describe('runAutopilot and the per-chat send gate', () => {
    test('K3: autopilot in chat B pushes and sends while chat A writes', async () => {
        simulateRunningSend(A)
        selectedCharID.set(1)

        await runAutopilot(['go'])

        expect(sendChat).toHaveBeenCalledTimes(1)
        expect(DBState.db.characters[1].chats[0].message.map((message) => message.data)).toEqual(['go'])
    })

    test('guard: autopilot in chat A pushes nothing and sends nothing while chat A writes', async () => {
        simulateRunningSend(A)
        selectedCharID.set(0)

        await runAutopilot(['go'])

        expect(sendChat).not.toHaveBeenCalled()
        expect(DBState.db.characters[0].chats[0].message).toHaveLength(0)
    })
})
