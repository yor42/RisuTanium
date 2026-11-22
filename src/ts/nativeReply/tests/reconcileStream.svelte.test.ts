import { beforeEach, describe, expect, test, vi } from 'vitest'

// The parser module graph is not under test: the JSON extraction and the model catalog are replaced.
vi.mock('src/ts/model/modellist', () => ({ LLMFlags: { deepSeekThinkingOutput: 7 } }))
vi.mock('src/ts/process/templates/jsonSchema', () => ({ extractJSON: (data: unknown) => String(data) }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { characters: [] } } }))

import { DBState } from 'src/ts/stores.svelte'
import { createUsageMeter } from 'src/ts/usage/usageMeter'
import { encodeReplyBlob, encodeStreamReplyBlob, type ReplyBlobBase } from '../blob'
import { configurePageState, resetPageStateForTests } from '../pageState'
import { createReconciler, recoveredText, type ApplyOutcome, type ReconcileDeps, type RecoveredStreamInput } from '../reconcile'
import type { ReplyListing } from '../store'

/**
 * Reconcile rows of a stream record (`openai-chat-stream`) over a real DBState and a fake store. A finished record reads
 * `readBodyBytes`, one that did not finish reads `readPartialBytes`; the replay and the apply are fakes here (the replay is
 * tested with the transform, the apply with the real function). The reconcile never consumes a record whose message
 * exists: the apply holds it for the save. Mutants M12 and M29b (consume on `present` by the reconcile), M24 (`partialBytes`
 * ignored), M25 (empty replay applied), M26 (IO error consumes), M27 (`openai-chat` routed to the stream path), M28 (any
 * 2xx status accepted).
 */

const K1 = '0b9c1a7e-0000-4000-8000-000000000001'
const base: ReplyBlobBase = {
    target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha',
    generationInfo: { generationId: K1 }, promptInfo: {}, escape: false, requestedMs: 1,
}
const rule = { deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }
// Inlined in the producer's key order so the file loads on a build without the stream producer; the producer's output is
// checked against it inside a test.
const streamBlobText = JSON.stringify({
    format: 'risu-native-reply-blob', target: { chaId: base.target.chaId, chatId: base.target.chatId },
    targetName: base.targetName, saying: base.saying, generationInfo: base.generationInfo, promptInfo: base.promptInfo,
    parse: { kind: 'openai-chat-stream', ...rule }, usage: { modelKey: 'gpt-4o', inputEstimate: 120 },
    escape: base.escape, requestedMs: base.requestedMs,
})
const chatBlobText = encodeReplyBlob(base, { kind: 'openai-chat', ...rule })

function listing(extra: Partial<ReplyListing> = {}): ReplyListing {
    return { key: K1, state: 'terminal', parked: false, createdMs: 10, pageVersion: 1, blob: streamBlobText, outcome: 'done', status: 200, bodyBytes: 20, ...extra }
}
const done = (extra: Partial<ReplyListing> = {}) => listing(extra)
const dead = (extra: Partial<ReplyListing> = {}) => listing({ state: 'dead', outcome: undefined, status: 200, bodyBytes: undefined, partialBytes: 30, ...extra })

type Message = { chatId?: string, data: string, interrupted?: true }
function setChat(message: Message[], extraChar: Record<string, unknown> = {}): void {
    const chats = [{ id: 'chat', message }]
    ;(DBState as unknown as { db: { characters: unknown[] } }).db = {
        characters: [{ chaId: 'cha', name: 'Alice', type: 'character', chats, ...extraChar }],
    }
}
function setNoCharacters(): void {
    ;(DBState as unknown as { db: { characters: unknown[] } }).db = { characters: [] }
}

const BYTES = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello, world."}}]}\n\ndata: [DONE]\n\n')

interface Rig {
    deps: ReconcileDeps
    notices: string[]
    consume: ReturnType<typeof vi.fn>
    park: ReturnType<typeof vi.fn>
    readBody: ReturnType<typeof vi.fn>
    readBodyBytes: ReturnType<typeof vi.fn>
    readPartialBytes: ReturnType<typeof vi.fn>
    replayStream: ReturnType<typeof vi.fn>
    applyStream: ReturnType<typeof vi.fn>
    settleUsage: ReturnType<typeof vi.fn>
    showParked: ReturnType<typeof vi.fn>
}

function rig(listings: ReplyListing[], options: { text?: string, apply?: ApplyOutcome } = {}): Rig {
    resetPageStateForTests()
    const notices: string[] = []
    const consume = vi.fn(async (_key: string) => ({ result: 'removed' as const, flushed: true }))
    configurePageState({
        store: { consume },
        waiter: { committedMarkCount: () => 0, markCount: () => 0, verdict: () => 'absent', afterNextCommit: () => {}, markCharacter: () => {}, requestSaveNow: () => {} },
        onUnreadable: () => {},
    })
    // A parked record lists as parked from the next pass on.
    const park = vi.fn(async (key: string) => {
        for (const item of listings) {
            if (item.key === key) {
                item.parked = true
            }
        }
    })
    const readBody = vi.fn(async (_key: string) => new TextDecoder().decode(BYTES))
    const readBodyBytes = vi.fn(async (_key: string) => BYTES)
    const readPartialBytes = vi.fn(async (_key: string) => BYTES)
    const meter = createUsageMeter()
    const replayStream = vi.fn(async () => ({ modelText: options.text ?? 'Hello, world.', meter, signatures: [] }))
    const applyStream = vi.fn(async (_input: RecoveredStreamInput): Promise<ApplyOutcome> => options.apply ?? 'applied')
    const settleUsage = vi.fn()
    const showParked = vi.fn(async () => {})
    const deps: ReconcileDeps = {
        store: {
            list: async () => listings, readBody, readBodyBytes, readPartialBytes, park,
            discard: async () => ({ result: 'removed' as const, flushed: true }),
        },
        gate: () => true,
        notice: (text) => notices.push(text),
        notes: {
            failedElsewhere: (name) => `failed:${name}`,
            stoppedElsewhere: (name) => `stopped:${name}`,
            interrupted: (name) => `interrupted:${name}`,
            unreadable: (key, problem) => `unreadable:${key}:${problem}`,
        },
        recoverText: async (item, blob, bodyText) => recoveredText(item.status, bodyText, blob, { escape: (text) => text, replacers: async (text) => text }),
        apply: async () => 'applied',
        replayStream,
        applyStream,
        settleUsage,
        restoreCharacter: async () => false,
        preLoadChat: async () => undefined,
        showParked,
    }
    return { deps, notices, consume, park, readBody, readBodyBytes, readPartialBytes, replayStream, applyStream, settleUsage, showParked }
}

async function pass(r: Rig, times = 1): Promise<void> {
    const reconciler = createReconciler(r.deps)
    for (let i = 0; i < times; i++) {
        await reconciler.request()
    }
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setChat([{ data: 'hi' }])
})

test('the inlined stream blob is what the producer writes', () => {
    expect(encodeStreamReplyBlob(base, { kind: 'openai-chat-stream', ...rule }, { modelKey: 'gpt-4o', inputEstimate: 120 })).toBe(streamBlobText)
})

describe('a finished stream record', () => {
    test('whose message is present and interrupted reaches the apply once, with no note and no consume', async () => {
        setChat([{ data: 'hi' }, { chatId: K1, data: 'Hel', interrupted: true }])
        const r = rig([done()])
        await pass(r)
        expect(r.readBodyBytes).toHaveBeenCalledWith(K1)
        expect(r.readPartialBytes).not.toHaveBeenCalled()
        expect(r.readBody).not.toHaveBeenCalled()
        expect(r.applyStream).toHaveBeenCalledTimes(1)
        expect(r.applyStream.mock.calls[0][0]).toMatchObject({ key: K1, complete: true, modelText: 'Hello, world.', outcome: 'done', how: 'finished' })
        expect(r.notices).toEqual([])
        expect(r.consume).not.toHaveBeenCalled()
    })

    test('an apply outcome of present is held by the apply: the reconcile does not consume, and posts no note', async () => {
        setChat([{ data: 'hi' }, { chatId: K1, data: 'Hello, world.' }])
        const r = rig([done()], { apply: 'present' })
        await pass(r, 2)
        expect(r.applyStream).toHaveBeenCalledTimes(2)
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.notices).toEqual([])
    })

    test('an absent message goes to the apply the same way, and applied or deferred consumes nothing', async () => {
        for (const apply of ['applied', 'deferred'] as const) {
            const r = rig([done()], { apply })
            await pass(r)
            expect(r.applyStream).toHaveBeenCalledTimes(1)
            expect(r.consume).not.toHaveBeenCalled()
            expect(r.notices).toEqual([])
            // The apply settles its own usage; the reconcile settles only a parked reply's.
            expect(r.settleUsage).not.toHaveBeenCalled()
        }
    })

    test('a failed apply posts the failed note once and keeps the record', async () => {
        const r = rig([done()], { apply: 'failed' })
        await pass(r, 2)
        expect(r.notices).toEqual(['failed:Alice'])
        expect(r.consume).not.toHaveBeenCalled()
    })

    test('the apply is told the usage rule: a failed outcome settles as failed', async () => {
        const r = rig([done({ outcome: 'failed' })], { text: 'x' })
        // A failed outcome has no body and no part: it is the no-body row.
        await pass(r)
        expect(r.applyStream).not.toHaveBeenCalled()
        const partial = rig([listing({ outcome: 'failed', partialBytes: 30, bodyBytes: undefined })])
        await pass(partial)
        expect(partial.applyStream.mock.calls[0][0]).toMatchObject({ complete: false, how: 'failed', outcome: 'failed' })
    })

    test('a chat that is gone parks the reply, queues the dialog, then settles usage once', async () => {
        setNoCharacters()
        const r = rig([done()])
        await pass(r, 2)
        expect(r.park).toHaveBeenCalledTimes(1)
        expect(r.showParked).toHaveBeenCalledTimes(1)
        expect(r.showParked.mock.calls[0][0]).toEqual([expect.objectContaining({ key: K1, name: 'Alice', text: 'Hello, world.' })])
        expect(r.settleUsage).toHaveBeenCalledTimes(1)
        expect(r.settleUsage.mock.calls[0][0]).toMatchObject({ usage: { modelKey: 'gpt-4o', inputEstimate: 120 } })
        expect(r.settleUsage.mock.calls[0][2]).toBe('finished')
        expect(r.settleUsage.mock.calls[0][3]).toBe('Hello, world.')
        expect(r.applyStream).not.toHaveBeenCalled()
        expect(r.consume).not.toHaveBeenCalled()
    })

    test('a park that fails settles no usage and keeps the record', async () => {
        setNoCharacters()
        const r = rig([done()])
        r.park.mockRejectedValue(new Error('park'))
        await pass(r)
        expect(r.settleUsage).not.toHaveBeenCalled()
        expect(r.showParked).not.toHaveBeenCalled()
        expect(r.consume).not.toHaveBeenCalled()
    })

    test('an already parked record shows its dialog without a park or a usage entry; with no text it is reported unreadable', async () => {
        setNoCharacters()
        const r = rig([done({ parked: true })])
        await pass(r)
        expect(r.park).not.toHaveBeenCalled()
        expect(r.settleUsage).not.toHaveBeenCalled()
        expect(r.showParked).toHaveBeenCalledTimes(1)

        const empty = rig([done({ parked: true })], { text: '  ' })
        await pass(empty)
        expect(empty.notices).toEqual([expect.stringContaining(`unreadable:${K1}:`)])
        expect(empty.consume).not.toHaveBeenCalled()
        expect(empty.showParked).not.toHaveBeenCalled()
    })

    test('an ambiguous chat is kept for a later pass', async () => {
        ;(DBState as unknown as { db: { characters: unknown[] } }).db = {
            characters: [{ chaId: 'cha', type: 'character', chats: [] }, { chaId: 'cha', type: 'character', chats: [] }],
        }
        const r = rig([done()])
        await pass(r)
        expect(r.applyStream).not.toHaveBeenCalled()
        expect(r.park).not.toHaveBeenCalled()
        expect(r.consume).not.toHaveBeenCalled()
    })
})

describe('a stream record that holds no reply', () => {
    test.each([
        ['an error-only or empty replay', { text: '' }, {}],
        ['a status of 500', {}, { status: 500 }],
        ['a status of 201: only 200 is a stream the live request keeps', {}, { status: 201 }],
    ])('%s: failed note once, consume, no apply, message untouched', async (_name, options, extra) => {
        setChat([{ data: 'hi' }, { chatId: K1, data: 'Hel', interrupted: true }])
        const r = rig([done(extra)], options)
        await pass(r, 2)
        expect(r.applyStream).not.toHaveBeenCalled()
        expect(r.notices).toEqual(['failed:Alice'])
        expect(r.consume).toHaveBeenCalledTimes(2)
        expect(r.consume).toHaveBeenCalledWith(K1)
        const message = (DBState as unknown as { db: { characters: Array<{ chats: Array<{ message: Message[] }> }> } }).db.characters[0].chats[0].message[1]
        expect(message).toEqual({ chatId: K1, data: 'Hel', interrupted: true })
    })

    test('a bad status never replays the bytes', async () => {
        const r = rig([done({ status: 500 })])
        await pass(r)
        expect(r.replayStream).not.toHaveBeenCalled()
    })

    test('a partial with no text gets its own note and is consumed', async () => {
        const r = rig([dead()], { text: '' })
        await pass(r)
        expect(r.notices).toEqual(['interrupted:Alice'])
        expect(r.consume).toHaveBeenCalledWith(K1)
        expect(r.applyStream).not.toHaveBeenCalled()
    })
})

describe('a stream record that did not finish', () => {
    test.each([
        ['dead', dead(), 'interrupted:Alice'],
        ['incomplete', dead({ state: 'incomplete' }), 'interrupted:Alice'],
        ['failed', listing({ outcome: 'failed', bodyBytes: undefined, partialBytes: 30 }), 'failed:Alice'],
        ['stopped', listing({ outcome: 'stopped', bodyBytes: undefined, partialBytes: 30 }), 'stopped:Alice'],
    ])('%s with a part reads the partial bytes, applies as partial and posts its note once', async (_name, item, note) => {
        const r = rig([item])
        await pass(r, 2)
        expect(r.readPartialBytes).toHaveBeenCalledWith(K1)
        expect(r.readBodyBytes).not.toHaveBeenCalled()
        expect(r.replayStream.mock.calls[0][2]).toBe(false)
        expect(r.applyStream).toHaveBeenCalledTimes(2)
        expect(r.applyStream.mock.calls[0][0]).toMatchObject({ complete: false })
        expect(r.notices).toEqual([note])
        expect(r.consume).not.toHaveBeenCalled()
    })

    test('an apply outcome of present on a partial posts the note once and consumes nothing', async () => {
        const r = rig([dead()], { apply: 'present' })
        await pass(r, 2)
        expect(r.notices).toEqual(['interrupted:Alice'])
        expect(r.consume).not.toHaveBeenCalled()
    })

    test('a deferred partial posts no note yet', async () => {
        const r = rig([dead()], { apply: 'deferred' })
        await pass(r)
        expect(r.notices).toEqual([])
        expect(r.consume).not.toHaveBeenCalled()
    })

    test.each([
        ['dead', listing({ state: 'dead', outcome: undefined, partialBytes: undefined, bodyBytes: undefined }), 'interrupted:Alice'],
        ['incomplete', listing({ state: 'incomplete', outcome: undefined, partialBytes: undefined, bodyBytes: undefined }), 'interrupted:Alice'],
        ['failed', listing({ outcome: 'failed', partialBytes: undefined }), 'failed:Alice'],
        ['stopped', listing({ outcome: 'stopped', partialBytes: undefined }), 'stopped:Alice'],
    ])('%s without a part is today\'s row: note once, consume, no read', async (_name, item, note) => {
        const r = rig([item])
        await pass(r, 2)
        expect(r.notices).toEqual([note])
        expect(r.consume).toHaveBeenCalledWith(K1)
        expect(r.readPartialBytes).not.toHaveBeenCalled()
        expect(r.readBodyBytes).not.toHaveBeenCalled()
        expect(r.applyStream).not.toHaveBeenCalled()
    })

    test('a partial whose chat is gone gets its note and is consumed, never parked or counted', async () => {
        setNoCharacters()
        const r = rig([dead()])
        await pass(r)
        expect(r.park).not.toHaveBeenCalled()
        expect(r.settleUsage).not.toHaveBeenCalled()
        expect(r.notices).toEqual(['interrupted:Alice'])
        expect(r.consume).toHaveBeenCalledWith(K1)
    })
})

describe('read and replay errors', () => {
    test('an IO error on either read keeps the record with no note', async () => {
        const a = rig([done()])
        a.readBodyBytes.mockRejectedValue(new Error('io'))
        await pass(a)
        const b = rig([dead()])
        b.readPartialBytes.mockRejectedValue(new Error('io'))
        await pass(b)
        for (const r of [a, b]) {
            expect(r.notices).toEqual([])
            expect(r.consume).not.toHaveBeenCalled()
            expect(r.applyStream).not.toHaveBeenCalled()
        }
    })

    test('a replay that throws reports the record unreadable once and keeps it', async () => {
        const r = rig([done()])
        r.replayStream.mockRejectedValue(new Error('replay'))
        await pass(r, 2)
        expect(r.notices).toEqual([expect.stringContaining(`unreadable:${K1}:`)])
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.applyStream).not.toHaveBeenCalled()
    })
})

describe('the kind decides the path', () => {
    test('an openai-chat record whose body is SSE stays on the non-stream path: failed note, consume, no stream read', async () => {
        const r = rig([listing({ blob: chatBlobText })])
        await pass(r)
        expect(r.readBody).toHaveBeenCalledWith(K1)
        expect(r.readBodyBytes).not.toHaveBeenCalled()
        expect(r.replayStream).not.toHaveBeenCalled()
        expect(r.applyStream).not.toHaveBeenCalled()
        expect(r.notices).toEqual(['failed:Alice'])
        expect(r.consume).toHaveBeenCalledWith(K1)
    })

    // The blob texts of the two new kinds, inlined in the producer's key order so a build that does not know the kind
    // reads them as unreadable and fails the apply assertions below.
    const newKindBlob = (parse: Record<string, unknown>) => JSON.stringify({
        format: 'risu-native-reply-blob', target: { chaId: base.target.chaId, chatId: base.target.chatId },
        targetName: base.targetName, saying: base.saying, generationInfo: base.generationInfo, promptInfo: base.promptInfo,
        parse, usage: { modelKey: 'gpt-4o', inputEstimate: 120 },
        escape: base.escape, requestedMs: base.requestedMs,
    })
    const NEW_KIND_BLOBS: [string, string, Record<string, unknown>][] = [
        ['openai-responses-stream', newKindBlob({ kind: 'openai-responses-stream', extractJson: null, jsonSchema: false }), { kind: 'openai-responses-stream', extractJson: null, jsonSchema: false }],
        ['anthropic-stream', newKindBlob({ kind: 'anthropic-stream' }), { kind: 'anthropic-stream' }],
    ]

    test.each(NEW_KIND_BLOBS)('T11: a finished %s record whose message is interrupted reaches the apply once and is not consumed', async (_kind, blobText, parse) => {
        setChat([{ chatId: K1, data: 'part', interrupted: true }])
        const r = rig([done({ blob: blobText })])
        await pass(r)
        expect(r.applyStream).toHaveBeenCalledTimes(1)
        expect(r.applyStream.mock.calls[0][0]).toMatchObject({ key: K1, modelText: 'Hello, world.', complete: true, signatures: [], blob: { parse } })
        expect(r.replayStream.mock.calls[0][0]).toMatchObject({ parse })
        expect(r.notices).toEqual([])
        expect(r.consume).not.toHaveBeenCalled()
    })

    test.each(NEW_KIND_BLOBS)('T19: a dead %s record with a part reads the partial bytes, applies as partial and posts the note once', async (_kind, blobText) => {
        setChat([{ chatId: K1, data: 'part', interrupted: true }])
        const r = rig([dead({ blob: blobText })])
        await pass(r, 2)
        expect(r.readPartialBytes).toHaveBeenCalledWith(K1)
        expect(r.readBodyBytes).not.toHaveBeenCalled()
        expect(r.applyStream.mock.calls[0][0]).toMatchObject({ complete: false })
        expect(r.notices).toEqual(['interrupted:Alice'])
        expect(r.consume).not.toHaveBeenCalled()
    })

    test('a stream record that decodes badly is unreadable, kept and reported', async () => {
        const broken = JSON.stringify({ ...JSON.parse(streamBlobText), usage: { modelKey: 1, inputEstimate: 1 } })
        const r = rig([listing({ blob: broken })])
        await pass(r)
        expect(r.notices).toEqual([expect.stringContaining(`unreadable:${K1}:`)])
        expect(r.consume).not.toHaveBeenCalled()
    })
})
