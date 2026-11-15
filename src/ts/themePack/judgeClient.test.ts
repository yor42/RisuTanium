// @vitest-environment node
// The main-thread judge client over a fake worker channel. The channel answers by calling the real `handleJudgeRequest` on
// a later task, so verdicts are real; no real Worker is started (the WebView worker is a device row, not a unit test).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { judgeAreaSheet, judgePackSheets, type PackSheetsJudgement } from './index'
import { intakePackBytes, type IntakeResult } from './intake'
import {
    createJudgeClient, JUDGE_TIMEOUT_MS, JudgeProtocolError, JudgeTimeoutError, JudgeUnavailableError, readJudgement,
    type JudgeRequest, type JudgeWorkerLike,
} from './judgeClient'
import { handleJudgeRequest } from './worker/judgeHandler'
import { CHAT_SHEET, PLAIN_CHAT_SHEET, PNG_1X1, validPackFiles, zipPack } from './fixtures/packBuilder'

vi.mock('./index', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./index')>()
    return { ...actual, judgePackSheets: vi.fn(actual.judgePackSheets), judgeAreaSheet: vi.fn(actual.judgeAreaSheet) }
})

type Behaviour = 'real' | 'silent' | ((request: JudgeRequest) => unknown)

class FakeJudgeWorker implements JudgeWorkerLike {
    readonly posts: Array<{ message: JudgeRequest; argumentCount: number }> = []
    terminations = 0
    private readonly listeners: Record<string, Array<(event: Event) => void>> = {}

    constructor(private readonly behaviour: Behaviour = 'real') {}

    postMessage(...args: [JudgeRequest, ...unknown[]]): void {
        const message = args[0]
        this.posts.push({ message, argumentCount: args.length })
        if (this.behaviour === 'silent') return
        const answer = this.behaviour === 'real' ? handleJudgeRequest(message) : this.behaviour(message)
        setTimeout(() => this.emitMessage(answer), 0)
    }

    terminate(): void {
        this.terminations += 1
    }

    addEventListener(type: 'message' | 'messageerror' | 'error', listener: (event: Event) => void): void {
        (this.listeners[type] ??= []).push(listener)
    }

    emitMessage(data: unknown): void {
        for (const listener of this.listeners.message ?? []) listener(new MessageEvent('message', { data }))
    }

    emitPlain(type: 'messageerror' | 'error'): void {
        for (const listener of this.listeners[type] ?? []) listener(new Event(type))
    }
}

function clientOver(worker: FakeJudgeWorker, timeoutMs?: number) {
    return createJudgeClient({ spawn: () => worker, timeoutMs })
}

const FACE_SHEET = '@font-face{font-family:"pack-serif";src:url(fonts/serif.woff2) format("woff2"),url("fonts/serif.woff") format("woff")}'
const LEAF_SHEET = `${FACE_SHEET}[data-part="chat-message-avatar"]{background-image:url(images/a.png)}`

afterEach(() => {
    vi.useRealTimers()
})

describe('T3W-1 the request and the answer', () => {
    it('posts {id, sheets} as one argument holding only sheet strings, never bytes or a transfer list, and resolves with the verdict', async () => {
        const worker = new FakeJudgeWorker()
        const judgement = await clientOver(worker)({ chat: PLAIN_CHAT_SHEET })
        expect(judgement).toEqual(judgePackSheets({ chat: PLAIN_CHAT_SHEET }))
        expect(worker.posts).toHaveLength(1)
        const [{ message, argumentCount }] = worker.posts
        expect(argumentCount).toBe(1)
        expect(Object.keys(message)).toEqual(['id', 'sheets'])
        expect(Number.isSafeInteger(message.id)).toBe(true)
        expect(message.sheets).toEqual({ chat: PLAIN_CHAT_SHEET })
        expect(Object.values(message.sheets).every((sheet) => typeof sheet === 'string')).toBe(true)
    })

    it('leaves the archive bytes handed to intake whole: nothing is transferred or mutated during verification', async () => {
        const bytes = zipPack(validPackFiles())
        const before = Uint8Array.from(bytes)
        const worker = new FakeJudgeWorker()
        const result = await intakePackBytes(bytes, clientOver(worker))
        expect(result.ok).toBe(true)
        expect(bytes.buffer.byteLength).toBeGreaterThan(0)
        expect(Array.from(bytes)).toEqual(Array.from(before))
        for (const post of worker.posts) {
            expect(post.argumentCount).toBe(1)
            expect(Object.keys(post.message)).toEqual(['id', 'sheets'])
        }
    })

    it('gives every call its own worker and its own request id', async () => {
        const workers: FakeJudgeWorker[] = []
        const judge = createJudgeClient({ spawn: () => { const worker = new FakeJudgeWorker(); workers.push(worker); return worker } })
        await Promise.all([judge({ chat: PLAIN_CHAT_SHEET }), judge({ chat: PLAIN_CHAT_SHEET })])
        expect(workers).toHaveLength(2)
        expect(workers[0].posts[0].message.id).not.toBe(workers[1].posts[0].message.id)
    })

    it('ignores an answer carrying another id and keeps waiting for its own', async () => {
        const worker = new FakeJudgeWorker('silent')
        const pending = clientOver(worker)({ chat: PLAIN_CHAT_SHEET })
        const { id } = worker.posts[0].message
        worker.emitMessage(handleJudgeRequest({ id: id + 1000, sheets: { chat: PLAIN_CHAT_SHEET } }))
        expect(worker.terminations).toBe(0)
        worker.emitMessage(handleJudgeRequest({ id, sheets: { chat: PLAIN_CHAT_SHEET } }))
        await expect(pending).resolves.toEqual(judgePackSheets({ chat: PLAIN_CHAT_SHEET }))
        expect(worker.terminations).toBe(1)
    })

    it('rejects with the worker text when the worker answers ok:false', async () => {
        const worker = new FakeJudgeWorker((request) => ({ id: request.id, ok: false, error: 'Error: boom' }))
        await expect(clientOver(worker)({ chat: PLAIN_CHAT_SHEET })).rejects.toThrow('Error: boom')
        expect(worker.terminations).toBe(1)
    })
})

describe('T3W-2 the timeout', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    it('rejects JudgeTimeoutError after JUDGE_TIMEOUT_MS, terminates once and ignores a late answer', async () => {
        const worker = new FakeJudgeWorker('silent')
        let outcome: 'pending' | 'resolved' | Error = 'pending'
        const pending = clientOver(worker)({ chat: PLAIN_CHAT_SHEET }).then(() => { outcome = 'resolved' }, (error: Error) => { outcome = error })
        await vi.advanceTimersByTimeAsync(JUDGE_TIMEOUT_MS - 1)
        expect(outcome).toBe('pending')
        expect(worker.terminations).toBe(0)
        await vi.advanceTimersByTimeAsync(1)
        await pending
        expect(outcome).toBeInstanceOf(JudgeTimeoutError)
        expect(worker.terminations).toBe(1)
        worker.emitMessage(handleJudgeRequest({ id: worker.posts[0].message.id, sheets: { chat: PLAIN_CHAT_SHEET } }))
        expect(worker.terminations).toBe(1)
        expect(outcome).toBeInstanceOf(JudgeTimeoutError)
    })

    it('honours a shorter timeoutMs option', async () => {
        const worker = new FakeJudgeWorker('silent')
        const settled = expect(clientOver(worker, 250)({ chat: PLAIN_CHAT_SHEET })).rejects.toBeInstanceOf(JudgeTimeoutError)
        await vi.advanceTimersByTimeAsync(250)
        await settled
    })

    it('clears the timer once answered, so no timeout fires later', async () => {
        const worker = new FakeJudgeWorker('real')
        const pending = clientOver(worker)({ chat: PLAIN_CHAT_SHEET })
        await vi.advanceTimersByTimeAsync(1)
        await pending
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('T3W-3 the worker is terminated exactly once', () => {
    it('after an answer, and a second answer is ignored', async () => {
        const worker = new FakeJudgeWorker()
        await clientOver(worker)({ chat: PLAIN_CHAT_SHEET })
        expect(worker.terminations).toBe(1)
        worker.emitMessage(handleJudgeRequest({ id: worker.posts[0].message.id, sheets: { chat: PLAIN_CHAT_SHEET } }))
        expect(worker.terminations).toBe(1)
    })

    it('after an error event', async () => {
        const worker = new FakeJudgeWorker('silent')
        const pending = clientOver(worker)({ chat: PLAIN_CHAT_SHEET })
        worker.emitPlain('error')
        await expect(pending).rejects.toBeInstanceOf(JudgeUnavailableError)
        worker.emitPlain('error')
        expect(worker.terminations).toBe(1)
    })

    it('after a messageerror event', async () => {
        const worker = new FakeJudgeWorker('silent')
        const pending = clientOver(worker)({ chat: PLAIN_CHAT_SHEET })
        worker.emitPlain('messageerror')
        await expect(pending).rejects.toBeInstanceOf(JudgeProtocolError)
        worker.emitPlain('messageerror')
        expect(worker.terminations).toBe(1)
    })

    it('when the request cannot be posted', async () => {
        const worker = new FakeJudgeWorker('silent')
        worker.postMessage = () => { throw new Error('DataCloneError') }
        await expect(clientOver(worker)({ chat: PLAIN_CHAT_SHEET })).rejects.toBeInstanceOf(JudgeUnavailableError)
        expect(worker.terminations).toBe(1)
    })
})

describe('T3W-4 no main-thread fallback', () => {
    it('rejects JudgeUnavailableError when spawn throws, and the validator is never called on the main thread', async () => {
        vi.mocked(judgePackSheets).mockClear()
        vi.mocked(judgeAreaSheet).mockClear()
        const judge = createJudgeClient({ spawn: () => { throw new Error('no workers here') } })
        await expect(judge({ chat: PLAIN_CHAT_SHEET })).rejects.toBeInstanceOf(JudgeUnavailableError)
        expect(vi.mocked(judgePackSheets)).not.toHaveBeenCalled()
        expect(vi.mocked(judgeAreaSheet)).not.toHaveBeenCalled()
    })

    it('does not fall back for a timeout, an error or a malformed answer either', async () => {
        vi.mocked(judgePackSheets).mockClear()
        const worker = new FakeJudgeWorker('silent')
        const pending = clientOver(worker)({ chat: PLAIN_CHAT_SHEET })
        worker.emitPlain('error')
        await expect(pending).rejects.toBeInstanceOf(JudgeUnavailableError)
        expect(vi.mocked(judgePackSheets)).not.toHaveBeenCalled()
    })
})

describe('T3W-5 malformed answers', () => {
    const realJudgement = judgePackSheets({ chat: CHAT_SHEET })
    const withImage = (): Uint8Array => zipPack(validPackFiles({ 'chat.css': CHAT_SHEET, 'images/a.png': PNG_1X1 }))

    function craft(change: (judgement: PackSheetsJudgement & { areas: { chat: NonNullable<PackSheetsJudgement['areas']['chat']> } }) => void): unknown {
        const copy = structuredClone(realJudgement) as PackSheetsJudgement & { areas: { chat: NonNullable<PackSheetsJudgement['areas']['chat']> } }
        change(copy)
        return copy
    }

    const ROWS: Array<[string, () => unknown]> = [
        ['areas.chat.result.ok a string', () => craft((j) => { (j.areas.chat.result as { ok: unknown }).ok = 'true' })],
        ['canonical missing', () => craft((j) => { delete (j.areas.chat as { canonical?: string }).canonical })],
        ['a span with end beyond the canonical text', () => craft((j) => { j.areas.chat.resources[0].end = j.areas.chat.canonical.length + 1 })],
        ['two overlapping spans', () => craft((j) => { j.areas.chat.resources = [j.areas.chat.resources[0], { ...j.areas.chat.resources[0] }] })],
        ['a span with an unknown form', () => craft((j) => { (j.areas.chat.resources[0] as { form: string }).form = 'other' })],
        ['a url-token span whose text does not start with url(', () => craft((j) => { j.areas.chat.resources[0].start += 1 })],
        ['a string span whose text does not start with a quote', () => craft((j) => { j.areas.chat.resources[0].form = 'string' })],
        ['a span with a fractional offset', () => craft((j) => { j.areas.chat.resources[0].start = 0.5 })],
        ['a span with a negative start', () => craft((j) => { j.areas.chat.resources[0].start = -1 })],
        ['a span with start not before end', () => craft((j) => { j.areas.chat.resources[0].end = j.areas.chat.resources[0].start })],
        ['spans out of order', () => craft((j) => {
            const [first] = j.areas.chat.resources
            j.areas.chat.resources = [{ ...first, start: first.end + 1, end: first.end + 2 }, first]
        })],
        ['resources not an array', () => craft((j) => { (j.areas.chat as { resources: unknown }).resources = {} })],
        ['fontFaceBlocks missing', () => craft((j) => { delete (j.areas.chat as { fontFaceBlocks?: unknown }).fontFaceBlocks })],
        ['a font-face block without text', () => craft((j) => { (j.areas.chat as { fontFaceBlocks: unknown }).fontFaceBlocks = [{ start: 0, end: 1 }] })],
        ['errors not an array', () => craft((j) => { (j.areas.chat.result as { errors: unknown }).errors = 'none' })],
        ['an error that is not a string triple', () => craft((j) => { (j.areas.chat.result as { errors: unknown }).errors = [{ selector: 'a', prop: 'b' }] })],
        ['overall ok not a boolean', () => craft((j) => { (j as { ok: unknown }).ok = 1 })],
        ['areas not an object', () => craft((j) => { (j as { areas: unknown }).areas = [] })],
        ['a judgement that is not an object', () => 'accepted'],
    ]

    it('control: the unchanged real answer for the same pack is accepted through the same path', async () => {
        const result = await intakePackBytes(withImage(), async () => realJudgement)
        expect(result.ok).toBe(true)
        expect(readJudgement(realJudgement)).toEqual(realJudgement)
    })

    it.each(ROWS)('rejects JudgeProtocolError: %s, and intake reports exactly couldNotCheck', async (_label, makeAnswer) => {
        const answer = makeAnswer()
        const rejectedBy = (): JudgeWorkerLike => new FakeJudgeWorker((request) => ({ id: request.id, ok: true, judgement: answer }))
        await expect(createJudgeClient({ spawn: rejectedBy })({ chat: CHAT_SHEET })).rejects.toBeInstanceOf(JudgeProtocolError)
        const result: IntakeResult = await intakePackBytes(withImage(), createJudgeClient({ spawn: rejectedBy }))
        expect(result).toEqual({ ok: false, refusals: [{ code: 'couldNotCheck' }] })
    })

    it('readJudgement keeps every field of a judgement holding both resource forms and a font-face block', () => {
        const judged = judgePackSheets({ chat: LEAF_SHEET })
        const chat = judged.areas.chat
        expect(chat?.result.ok).toBe(true)
        expect(chat?.resources.map((span) => span.form)).toEqual(['url-token', 'string', 'url-token'])
        expect(readJudgement(structuredClone(judged))).toEqual(judged)
    })

    it('readJudgement accepts a refused sheet with its errors and no locations', () => {
        const refused = judgePackSheets({ chat: 'a{background:url(https://example.invalid/x.png)}' })
        expect(refused.ok).toBe(false)
        expect(readJudgement(structuredClone(refused))).toEqual(refused)
    })
})
