/**
 * The Utility conversation: how a request's result becomes turns, the refusals, the page gate and New. The request
 * itself is a stub here; the request body is covered by `request/tests/utilityOverrides.test.ts`.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    request: vi.fn(),
    desktop: true,
    models: {} as Record<string, { id: string, format: number }>,
}))

vi.mock('../../request/request', () => ({ requestChatDataMain: h.request }))
vi.mock('../../../storage/tauriByteTransport', () => ({ isDesktopTransport: () => h.desktop }))
vi.mock('../../../stores.svelte', () => ({ DBState: { db: {} } }))
vi.mock('../../../model/modellist', async () => {
    const types = await import('../../../model/types')
    return {
        LLMFormat: types.LLMFormat,
        getModelInfo: (id: string) => h.models[id] ?? { id, format: types.LLMFormat.OpenAICompatible },
    }
})

import { LLMFormat } from '../../../model/types'
import { setPageStorageMode } from '../../../storage/pageStorageMode'
import { DBState } from '../../../stores.svelte'
import { newUtilityConversation, sendUtility, stopUtility, utilityAvailable, utilityConversation, utilityRefusal } from '../utilityConversation.svelte'

type Db = { taskPresets?: Array<Record<string, unknown>>, customAPIFormat?: number, useInstructPrompt?: boolean }
const db = () => DBState.db as unknown as Db

function preset(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: 'p1', name: 'Fixer', instructions: 'Fix it.', model: 'gpt4o', ...extra }
}

function lastTurn() {
    return utilityConversation.turns[utilityConversation.turns.length - 1]
}

function streamOf(chunks: Array<Record<string, string>>, hold?: Promise<void>): ReadableStream<Record<string, string>> {
    let index = 0
    return new ReadableStream({
        async pull(controller) {
            if (index < chunks.length) {
                controller.enqueue(chunks[index])
                index += 1
                return
            }
            if (hold) {
                await hold
            }
            controller.close()
        },
    })
}

beforeEach(async () => {
    h.request.mockReset()
    h.desktop = true
    h.models = {}
    DBState.db = { taskPresets: [preset()], customAPIFormat: LLMFormat.OpenAICompatible, useInstructPrompt: false } as never
    setPageStorageMode({ kind: 'store2' })
    await newUtilityConversation(async () => true)
})

describe('result handling', () => {
    test('a success result is one assistant turn', async () => {
        h.request.mockResolvedValue({ type: 'success', result: 'fixed' })

        await sendUtility('p1', 'broken')

        expect(utilityConversation.turns).toEqual([
            { role: 'user', content: 'broken' },
            { role: 'assistant', content: 'fixed', state: 'done' },
        ])
        expect(utilityConversation.runId).toBeNull()
    })

    test('a streamed reply shows the cumulative text of the last chunk', async () => {
        h.request.mockResolvedValue({ type: 'streaming', result: streamOf([{ '0': 'fi' }, { '0': 'fixed' }]) })

        await sendUtility('p1', 'broken')

        expect(lastTurn()).toMatchObject({ content: 'fixed', state: 'done' })
    })

    test('a failed reply is left out of the next request', async () => {
        h.request.mockResolvedValue({ type: 'fail', result: 'boom' })
        await sendUtility('p1', 'first')
        h.request.mockResolvedValue({ type: 'success', result: 'ok' })

        await sendUtility('p1', 'second')

        expect(h.request.mock.calls[1][0].formated.map((message: { role: string }) => message.role)).toEqual(['system', 'user', 'user'])
    })

    test('stopping a streamed reply keeps the partial text and marks it stopped', async () => {
        let release: () => void = () => {}
        const hold = new Promise<void>((resolve) => { release = resolve })
        h.request.mockResolvedValue({ type: 'streaming', result: streamOf([{ '0': 'par' }], hold) })

        const sending = sendUtility('p1', 'broken')
        await vi.waitFor(() => expect(lastTurn().content).toBe('par'))
        stopUtility()
        await sending
        release()

        expect(lastTurn()).toMatchObject({ content: 'par', state: 'stopped' })
        expect(utilityConversation.runId).toBeNull()
    })

    test('a non-streamed reply that arrives after a stop is discarded and shown as stopped', async () => {
        let deliver: (value: unknown) => void = () => {}
        h.request.mockReturnValue(new Promise((resolve) => { deliver = resolve }))

        const sending = sendUtility('p1', 'broken')
        await vi.waitFor(() => expect(utilityConversation.runId).not.toBeNull())
        stopUtility()
        deliver({ type: 'success', result: 'late text' })
        await sending

        expect(lastTurn()).toMatchObject({ content: '', state: 'stopped' })
    })

    test('a failure result is an inline failure on the turn', async () => {
        h.request.mockResolvedValue({ type: 'fail', result: 'rate limited' })

        await sendUtility('p1', 'broken')

        expect(lastTurn()).toMatchObject({ state: 'failed', error: 'rate limited' })
    })

    test('a multi-line result cannot be produced by a Utility request and is a failure', async () => {
        h.request.mockResolvedValue({ type: 'multiline', result: [['user', 'a']] })

        await sendUtility('p1', 'broken')

        expect(lastTurn().state).toBe('failed')
    })

    test('a throw becomes an inline failure with its message and frees the conversation', async () => {
        h.request.mockRejectedValue(new Error('separate parameters missing for x'))

        await sendUtility('p1', 'broken')

        expect(lastTurn()).toMatchObject({ state: 'failed', error: 'separate parameters missing for x' })
        expect(utilityConversation.runId).toBeNull()
    })

    test('a throw after a stop is shown as stopped', async () => {
        let fail: (error: Error) => void = () => {}
        h.request.mockReturnValue(new Promise((_resolve, reject) => { fail = reject }))

        const sending = sendUtility('p1', 'broken')
        await vi.waitFor(() => expect(utilityConversation.runId).not.toBeNull())
        stopUtility()
        fail(new Error('aborted fetch'))
        await sending

        expect(lastTurn().state).toBe('stopped')
    })
})

describe('the request', () => {
    test('the request carries the preset snapshot, the pinned model and no tools, schema or extraction', async () => {
        db().taskPresets = [preset({ temperature: 0.4, maxTokens: 500, model: 'claude-x' })]
        h.models['claude-x'] = { id: 'claude-x', format: LLMFormat.Anthropic }
        h.request.mockResolvedValue({ type: 'success', result: 'ok' })

        await sendUtility('p1', 'text')

        const [arg, mode] = h.request.mock.calls[0]
        expect(mode).toBe('model')
        expect(arg).toMatchObject({
            formated: [{ role: 'system', content: 'Fix it.' }, { role: 'user', content: 'text' }],
            staticModel: 'claude-x',
            tools: [],
            maxTokens: 500,
            temperatureOverride: 0.4,
            extractJson: '',
            noJsonSchema: true,
            noMultiGen: true,
            blockPlugins: true,
        })
    })

    test('later sends carry the earlier turns', async () => {
        h.request.mockResolvedValue({ type: 'success', result: 'first answer' })
        await sendUtility('p1', 'first')
        h.request.mockResolvedValue({ type: 'success', result: 'second answer' })

        await sendUtility('p1', 'second')

        expect(h.request.mock.calls[1][0].formated).toEqual([
            { role: 'system', content: 'Fix it.' },
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'first answer' },
            { role: 'user', content: 'second' },
        ])
    })

    test('a send while a run is live is ignored', async () => {
        let deliver: (value: unknown) => void = () => {}
        h.request.mockReturnValue(new Promise((resolve) => { deliver = resolve }))
        const first = sendUtility('p1', 'one')
        await vi.waitFor(() => expect(utilityConversation.runId).not.toBeNull())

        await sendUtility('p1', 'two')
        deliver({ type: 'success', result: 'ok' })
        await first

        expect(h.request).toHaveBeenCalledTimes(1)
        expect(utilityConversation.turns).toHaveLength(2)
    })
})

describe('refusals', () => {
    test('a preset that was deleted refuses the send, by name', async () => {
        h.request.mockResolvedValue({ type: 'success', result: 'ok' })
        await sendUtility('p1', 'hello')
        db().taskPresets = []

        await sendUtility('p1', 'again')

        expect(lastTurn().state).toBe('failed')
        expect(lastTurn().error).toContain('Fixer')
        expect(h.request).toHaveBeenCalledTimes(1)
    })

    test('the send uses the preset as it was when the send started', async () => {
        let deliver: (value: unknown) => void = () => {}
        h.request.mockReturnValue(new Promise((resolve) => { deliver = resolve }))
        const sending = sendUtility('p1', 'one')
        await vi.waitFor(() => expect(utilityConversation.runId).not.toBeNull())
        db().taskPresets = []
        deliver({ type: 'success', result: 'ok' })
        await sending

        expect(lastTurn()).toMatchObject({ state: 'done', content: 'ok' })
    })

    test('formats outside the allowlist, plugin models and a blank model are refused', () => {
        h.models['mistral-m'] = { id: 'mistral-m', format: LLMFormat.Mistral }
        h.models['pluginmodel:::a'] = { id: 'pluginmodel:::a', format: LLMFormat.Plugin }
        const base = { customAPIFormat: LLMFormat.OpenAICompatible, useInstructPrompt: false }

        expect(utilityRefusal({ model: 'mistral-m' }, base)).not.toBeNull()
        expect(utilityRefusal({ model: 'pluginmodel:::a' }, base)).toContain('plugin')
        expect(utilityRefusal({ model: '' }, base)).not.toBeNull()
        expect(utilityRefusal({ model: 'gpt4o' }, base)).toBeNull()
    })

    test('each allowlisted format is accepted', () => {
        for (const format of [LLMFormat.OpenAICompatible, LLMFormat.Anthropic, LLMFormat.GoogleCloud, LLMFormat.VertexAIGemini]) {
            h.models['m'] = { id: 'm', format }
            expect(utilityRefusal({ model: 'm' }, { customAPIFormat: 0, useInstructPrompt: false })).toBeNull()
        }
    })

    test('a reverse proxy is judged by the configured API format, not by its catalog entry', () => {
        h.models['reverse_proxy'] = { id: 'reverse_proxy', format: LLMFormat.OpenAICompatible }

        expect(utilityRefusal({ model: 'reverse_proxy' }, { customAPIFormat: LLMFormat.Cohere, useInstructPrompt: false })).not.toBeNull()
        expect(utilityRefusal({ model: 'reverse_proxy' }, { customAPIFormat: LLMFormat.Anthropic, useInstructPrompt: false })).toBeNull()
    })

    test('OpenRouter with the instruct prompt on is refused and accepted with it off', () => {
        h.models['openrouter'] = { id: 'openrouter', format: LLMFormat.OpenAICompatible }

        expect(utilityRefusal({ model: 'openrouter' }, { customAPIFormat: 0, useInstructPrompt: true })).not.toBeNull()
        expect(utilityRefusal({ model: 'openrouter' }, { customAPIFormat: 0, useInstructPrompt: false })).toBeNull()
    })

    test('a refused send makes no request and shows the reason on the turn', async () => {
        h.models['mistral-m'] = { id: 'mistral-m', format: LLMFormat.Mistral }
        db().taskPresets = [preset({ model: 'mistral-m' })]

        await sendUtility('p1', 'hello')

        expect(h.request).not.toHaveBeenCalled()
        expect(lastTurn().state).toBe('failed')
    })
})

describe('the page gate', () => {
    test('only the desktop app on a store2 page may use Utility', () => {
        expect(utilityAvailable()).toBe(true)

        h.desktop = false
        expect(utilityAvailable()).toBe(false)

        h.desktop = true
        for (const kind of ['unset', 'block', 'legacy'] as const) {
            setPageStorageMode(kind === 'legacy' ? { kind, convertedFrom: null } : { kind })
            expect(utilityAvailable()).toBe(false)
        }
        setPageStorageMode({ kind: 'read-only', reason: 'too-new', source: 'manifest' } as never)
        expect(utilityAvailable()).toBe(false)
    })

    test('a send outside the gate makes no request', async () => {
        h.desktop = false

        await sendUtility('p1', 'hello')

        expect(h.request).not.toHaveBeenCalled()
        expect(lastTurn().state).toBe('failed')
    })
})

describe('New', () => {
    test('a decline keeps the conversation and its live run', async () => {
        h.request.mockResolvedValue({ type: 'success', result: 'ok' })
        await sendUtility('p1', 'hello')

        const cleared = await newUtilityConversation(async () => false)

        expect(cleared).toBe(false)
        expect(utilityConversation.turns).toHaveLength(2)
    })

    test('an empty conversation clears without asking', async () => {
        const confirmDiscard = vi.fn(async () => false)

        expect(await newUtilityConversation(confirmDiscard)).toBe(true)
        expect(confirmDiscard).not.toHaveBeenCalled()
    })

    test('accepting aborts the live run, and its late text never reaches the new conversation', async () => {
        let signal: AbortSignal | undefined
        let deliver: (value: unknown) => void = () => {}
        h.request.mockImplementation((_arg: unknown, _mode: string, given: AbortSignal) => {
            signal = given
            return new Promise((resolve) => { deliver = resolve })
        })
        const sending = sendUtility('p1', 'hello')
        await vi.waitFor(() => expect(utilityConversation.runId).not.toBeNull())

        const cleared = await newUtilityConversation(async () => true)
        deliver({ type: 'success', result: 'late text' })
        await sending

        expect(cleared).toBe(true)
        expect(signal?.aborted).toBe(true)
        expect(utilityConversation.turns).toEqual([])
        expect(utilityConversation.runId).toBeNull()
    })

    test('a new send may start as soon as New has aborted the old run', async () => {
        let deliver: (value: unknown) => void = () => {}
        h.request.mockReturnValueOnce(new Promise((resolve) => { deliver = resolve }))
        const old = sendUtility('p1', 'old')
        await vi.waitFor(() => expect(utilityConversation.runId).not.toBeNull())
        await newUtilityConversation(async () => true)
        h.request.mockResolvedValue({ type: 'success', result: 'fresh' })

        await sendUtility('p1', 'new')
        deliver({ type: 'success', result: 'late' })
        await old

        expect(utilityConversation.turns).toEqual([
            { role: 'user', content: 'new' },
            { role: 'assistant', content: 'fresh', state: 'done' },
        ])
    })

    test('the old run unwinding late does not release the new run', async () => {
        let deliverOld: (value: unknown) => void = () => {}
        let deliverNew: (value: unknown) => void = () => {}
        h.request.mockReturnValueOnce(new Promise((resolve) => { deliverOld = resolve }))
        h.request.mockReturnValueOnce(new Promise((resolve) => { deliverNew = resolve }))
        const old = sendUtility('p1', 'old')
        await vi.waitFor(() => expect(utilityConversation.runId).not.toBeNull())
        await newUtilityConversation(async () => true)
        const fresh = sendUtility('p1', 'new')
        await vi.waitFor(() => expect(utilityConversation.runId).not.toBeNull())
        const freshRun = utilityConversation.runId

        deliverOld({ type: 'success', result: 'late' })
        await old

        expect(utilityConversation.runId).toBe(freshRun)
        deliverNew({ type: 'success', result: 'fresh' })
        await fresh
        expect(utilityConversation.runId).toBeNull()
    })
})
