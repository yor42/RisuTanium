// @vitest-environment jsdom
/**
 * The session-only record of refused generations. Everything here is new, so before the fix each case fails on the
 * missing module (diagnostic). MOCKED: the generation entry points (`composerActions.svelte`), the model catalog and
 * `stores.svelte`. U2 holds the "nothing is stored" rule (mutant: the store writes web storage or a chat field);
 * the pass-clears-entry case holds M12.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const sendMainMock = vi.hoisted(() => vi.fn(async () => {}))
const regenerateNewestMock = vi.hoisted(() => vi.fn(async () => {}))
const modelInfoMock = vi.hoisted(() => vi.fn((_id: string): { provider: number, keyIdentifier?: string } => ({ provider: 1 })))
const dbBox = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))

vi.mock(import('src/ts/process/composerActions.svelte'), () => ({
    sendMain: sendMainMock,
    regenerateNewest: regenerateNewestMock,
}) as unknown as typeof import('src/ts/process/composerActions.svelte'))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: modelInfoMock }) as unknown as typeof import('src/ts/model/modellist'))
vi.mock(import('src/ts/stores.svelte'), () => ({ DBState: dbBox }) as unknown as typeof import('src/ts/stores.svelte'))

import { failureOf, resetSendFailuresForTests, retrySendFailure, shellGenerationSource } from './sendFailure.svelte'

const ORIGIN = { chaId: 'cha-a', chatId: 'chat-a' }
const OTHER = { chaId: 'cha-a', chatId: 'chat-b' }

function install(overrides: Record<string, unknown> = {}): void {
    dbBox.db = {
        aiModel: 'claude-test', customModels: [], presetChain: '', fallbackModels: { model: [] },
        openAIKey: '', openrouterKey: '', claudeAPIKey: '', mistralKey: '', cohereAPIKey: '', OaiCompAPIKeys: {},
        google: { accessToken: '' }, novelai: { token: '' },
        ...overrides,
    }
}

beforeEach(() => {
    sendMainMock.mockClear()
    regenerateNewestMock.mockClear()
    resetSendFailuresForTests()
    localStorage.clear()
    sessionStorage.clear()
    install()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('shellGenerationSource', () => {
    test('a missing key refuses, records the reason for that chat and keeps the menu hook', () => {
        const closeMenu = vi.fn()
        const source = shellGenerationSource(closeMenu)

        expect(source.refuseGeneration?.({ origin: ORIGIN, action: 'send' })).toBe(true)

        expect(failureOf(ORIGIN.chaId, ORIGIN.chatId)).toMatchObject({ reason: 'key', fix: 'botSettings', action: 'send', provider: 'Anthropic' })
        source.closeMenu()
        expect(closeMenu).toHaveBeenCalledTimes(1)
    })

    test('a pass returns false and clears that chat\'s entry, leaving other chats alone', () => {
        const source = shellGenerationSource(() => {})
        source.refuseGeneration?.({ origin: ORIGIN, action: 'send' })
        source.refuseGeneration?.({ origin: OTHER, action: 'continue' })
        install({ claudeAPIKey: 'synthetic-key' })

        expect(source.refuseGeneration?.({ origin: ORIGIN, action: 'send' })).toBe(false)

        expect(failureOf(ORIGIN.chaId, ORIGIN.chatId)).toBeNull()
        expect(failureOf(OTHER.chaId, OTHER.chatId)).toMatchObject({ action: 'continue' })
    })

    test('a later refusal replaces the recorded reason and action', () => {
        const source = shellGenerationSource(() => {})
        source.refuseGeneration?.({ origin: ORIGIN, action: 'send' })
        install({ aiModel: '' })

        expect(source.refuseGeneration?.({ origin: ORIGIN, action: 'regenerate' })).toBe(true)

        expect(failureOf(ORIGIN.chaId, ORIGIN.chatId)).toMatchObject({ reason: 'model', action: 'regenerate' })
    })

    test('a chat without an id has no entry', () => {
        expect(failureOf('cha-a', undefined)).toBeNull()
    })
})

describe('retrySendFailure', () => {
    test.each([
        ['send', sendMainMock, false],
        ['continue', sendMainMock, true],
    ] as const)('a recorded %s runs sendMain again through the same gate', async (action, mock, continued) => {
        const source = shellGenerationSource(() => {})
        source.refuseGeneration?.({ origin: ORIGIN, action })

        await retrySendFailure(ORIGIN)

        expect(mock).toHaveBeenCalledTimes(1)
        const calls = mock.mock.calls as unknown as Array<[{ refuseGeneration?: unknown }, boolean]>
        expect(calls[0][1]).toBe(continued)
        expect(typeof calls[0][0].refuseGeneration).toBe('function')
    })

    test('a recorded regenerate runs the new reply again', async () => {
        const source = shellGenerationSource(() => {})
        source.refuseGeneration?.({ origin: ORIGIN, action: 'regenerate' })

        await retrySendFailure(ORIGIN)

        expect(regenerateNewestMock).toHaveBeenCalledTimes(1)
        expect(sendMainMock).not.toHaveBeenCalled()
    })

    test('with nothing recorded it does nothing', async () => {
        await retrySendFailure(ORIGIN)

        expect(sendMainMock).not.toHaveBeenCalled()
        expect(regenerateNewestMock).not.toHaveBeenCalled()
    })
})

describe('U2 nothing is stored', () => {
    test('a refusal writes no web storage and no chat field', () => {
        const chat = { id: ORIGIN.chatId, message: [{ role: 'user', data: 'hi' }], note: '' }
        const snapshot = JSON.stringify(chat)
        const setItem = vi.spyOn(Storage.prototype, 'setItem')

        const source = shellGenerationSource(() => {})
        source.refuseGeneration?.({ origin: ORIGIN, action: 'send' })

        expect(setItem).not.toHaveBeenCalled()
        expect(localStorage.length).toBe(0)
        expect(sessionStorage.length).toBe(0)
        expect(JSON.stringify(chat)).toBe(snapshot)
    })

    test('the record is session-only: a reset leaves nothing behind', () => {
        shellGenerationSource(() => {}).refuseGeneration?.({ origin: ORIGIN, action: 'send' })
        resetSendFailuresForTests()

        expect(failureOf(ORIGIN.chaId, ORIGIN.chatId)).toBeNull()
    })
})
