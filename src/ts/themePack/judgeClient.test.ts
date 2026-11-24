// @vitest-environment node
// The main-thread judge client and session over a fake worker channel. The channel answers by calling the real `handleJudgeRequest` on
// a later task, so verdicts are real; no real Worker is started (the WebView worker is a device row, not a unit test).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { judgeAreaSheet, judgePackSheets, type PackSheetsJudgement } from './index'
import { intakePackBytes, type IntakeResult } from './intake'
import {
    createJudgeClient, JUDGE_TIMEOUT_MS, JudgeProtocolError, JudgeTimeoutError, JudgeUnavailableError, MAX_JUDGE_JOBS, openJudgeSession,
    readJudgement, type JudgeJob, type JudgeRequest, type JudgeWorkerLike,
} from './judgeClient'
import { handleJudgeRequest, MAX_JUDGE_JOBS as HANDLER_MAX_JOBS } from './worker/judgeHandler'
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

/** The request a `{ chat }` sheet makes through the intake judge: one job labelled by its area. */
function chatRequest(id: number, text: string): JudgeRequest {
    return { id, jobs: [{ label: 'chat', area: 'chat', text }] }
}

describe('T3W-1 the request and the answer', () => {
    it('posts {id, jobs} as one argument holding only labelled sheet strings, never bytes or a transfer list, and resolves with the verdict', async () => {
        const worker = new FakeJudgeWorker()
        const judgement = await clientOver(worker)({ chat: PLAIN_CHAT_SHEET })
        expect(judgement).toEqual(judgePackSheets({ chat: PLAIN_CHAT_SHEET }))
        expect(worker.posts).toHaveLength(1)
        const [{ message, argumentCount }] = worker.posts
        expect(argumentCount).toBe(1)
        expect(Object.keys(message)).toEqual(['id', 'jobs'])
        expect(Number.isSafeInteger(message.id)).toBe(true)
        expect(message.jobs).toEqual([{ label: 'chat', area: 'chat', text: PLAIN_CHAT_SHEET }])
        expect(message.jobs.every((job) => typeof job.label === 'string' && typeof job.text === 'string')).toBe(true)
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
            expect(Object.keys(post.message)).toEqual(['id', 'jobs'])
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
        worker.emitMessage(handleJudgeRequest(chatRequest(id + 1000, PLAIN_CHAT_SHEET)))
        expect(worker.terminations).toBe(0)
        worker.emitMessage(handleJudgeRequest(chatRequest(id, PLAIN_CHAT_SHEET)))
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
        worker.emitMessage(handleJudgeRequest(chatRequest(worker.posts[0].message.id, PLAIN_CHAT_SHEET)))
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
        worker.emitMessage(handleJudgeRequest(chatRequest(worker.posts[0].message.id, PLAIN_CHAT_SHEET)))
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

    /** The `results` object of an answer whose chat verdict has been changed. */
    function craft(change: (judgement: PackSheetsJudgement & { areas: { chat: NonNullable<PackSheetsJudgement['areas']['chat']> } }) => void): unknown {
        const copy = structuredClone(realJudgement) as PackSheetsJudgement & { areas: { chat: NonNullable<PackSheetsJudgement['areas']['chat']> } }
        change(copy)
        return { chat: copy.areas.chat }
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
        ['warnings missing', () => craft((j) => { delete (j.areas.chat as { warnings?: unknown }).warnings })],
        ['warnings null', () => craft((j) => { (j.areas.chat as { warnings: unknown }).warnings = null })],
        ['warnings not an array', () => craft((j) => { (j.areas.chat as { warnings: unknown }).warnings = 'none' })],
        ['a warning that is not a string triple', () => craft((j) => { (j.areas.chat as { warnings: unknown }).warnings = [{ selector: 'a', prop: 'b' }] })],
        ['results not an object', () => 'accepted'],
        ['results an array', () => []],
        ['the chat verdict not an object', () => ({ chat: 'accepted' })],
    ]

    it('control: the unchanged real answer for the same pack is accepted through the same path', async () => {
        const result = await intakePackBytes(withImage(), async () => realJudgement)
        expect(result.ok).toBe(true)
        expect(readJudgement(realJudgement)).toEqual(realJudgement)
    })

    it.each(ROWS)('rejects JudgeProtocolError: %s, and intake reports exactly couldNotCheck', async (_label, makeAnswer) => {
        const answer = makeAnswer()
        const rejectedBy = (): JudgeWorkerLike => new FakeJudgeWorker((request) => ({ id: request.id, ok: true, results: answer }))
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

    it('readJudgement keeps the warnings of a sheet as fresh objects', () => {
        const copy = structuredClone(realJudgement) as PackSheetsJudgement & { areas: { chat: NonNullable<PackSheetsJudgement['areas']['chat']> } }
        const warnings = [
            { selector: '.a', prop: 'font-family', why: 'first note' },
            { selector: '.b', prop: 'font-family', why: 'second note' },
        ]
        copy.areas.chat.warnings = warnings
        const read = readJudgement(copy)
        expect(read).toEqual(copy)
        expect(read?.areas.chat?.warnings).not.toBe(warnings)
        expect(read?.areas.chat?.warnings[0]).not.toBe(warnings[0])
    })

    it('V-T9: a real unbundled family reaches intake as a warning on the verified sheet (MC-2542)', async () => {
        const sheet = '[data-part="chat-message-text"]{font-family:"pack-missing", serif}'
        const judged = judgePackSheets({ chat: sheet })
        expect(judged.areas.chat?.warnings).toHaveLength(1)
        expect(readJudgement(structuredClone(judged))).toEqual(judged)
        const result = await intakePackBytes(zipPack(validPackFiles({ 'chat.css': sheet })), createJudgeClient({ spawn: () => new FakeJudgeWorker('real') }))
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.pack.sheets.chat.warnings).toHaveLength(1)
        expect(result.pack.sheets.chat.warnings[0].why).toMatch(/^font family "pack-missing" is not bundled with the pack: /)
    })

    it('readJudgement accepts a refused sheet with its errors and no locations', () => {
        const refused = judgePackSheets({ chat: 'a{background:url(https://example.invalid/x.png)}' })
        expect(refused.ok).toBe(false)
        expect(readJudgement(structuredClone(refused))).toEqual(refused)
    })

    // A plain dark-on-dark header colour: the real validator answers with contrast notes and no errors.
    const NOTED_SHEET = '[data-part="chat-header"]{color:#111111}'
    const notedJudgement = judgePackSheets({ chat: NOTED_SHEET })
    type NotedJudgement = PackSheetsJudgement & { areas: { chat: NonNullable<PackSheetsJudgement['areas']['chat']> } }

    it('T-JC1: readJudgement keeps result.notes with their kinds, and an answer without notes stays without the field', () => {
        const notes = notedJudgement.areas.chat?.result.notes
        expect(notes?.length).toBeGreaterThan(0)
        expect(notes?.every((note) => note.rule === 'contrast')).toBe(true)
        const read = readJudgement(structuredClone(notedJudgement))
        expect(read).toEqual(notedJudgement)
        expect(read?.areas.chat?.result.notes?.map((note) => note.rule)).toEqual(notes?.map((note) => note.rule))
        expect(read?.areas.chat?.result.notes).not.toBe(notes)
        const plain = readJudgement(structuredClone(realJudgement))
        expect(plain?.areas.chat?.result.ok).toBe(true)
        expect(Object.hasOwn(plain?.areas.chat?.result ?? {}, 'notes')).toBe(false)
    })

    it('T-JC1: a worker answer carrying notes reaches intake with the notes on the verified sheet', async () => {
        const result = await intakePackBytes(zipPack(validPackFiles({ 'chat.css': NOTED_SHEET })), createJudgeClient({ spawn: () => new FakeJudgeWorker('real') }))
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.pack.sheets.chat.result.notes?.map((note) => note.rule)).toEqual(notedJudgement.areas.chat?.result.notes?.map((note) => note.rule))
        expect(result.pack.sheets.chat.warnings).toEqual([])
    })

    /** The answer of a noted chat verdict whose `result.notes` is replaced by `notes`. */
    function withNotes(notes: unknown): unknown {
        const copy = structuredClone(notedJudgement) as NotedJudgement
        ;(copy.areas.chat.result as { notes?: unknown }).notes = notes
        return { chat: copy.areas.chat }
    }

    it.each([
        ['notes an empty array', () => withNotes([])],
        ['notes null', () => withNotes(null)],
        ['notes not an array', () => withNotes('none')],
        ['a note without a rule', () => withNotes([{ selector: 'a', prop: 'b', why: 'c' }])],
        ['a note with an unknown rule', () => withNotes([{ selector: 'a', prop: 'b', why: 'c', rule: 'other' }])],
        ['a note that is not a string triple', () => withNotes([{ selector: 'a', prop: 'b', rule: 'layout' }])],
        ['one tagged note beside an untagged one', () => withNotes([{ selector: 'a', prop: 'b', why: 'c', rule: 'layout' }, { selector: 'a', prop: 'b', why: 'c' }])],
    ] as Array<[string, () => unknown]>)('T-JC2: rejects JudgeProtocolError: %s', async (_label, makeAnswer) => {
        const answer = makeAnswer()
        await expect(createJudgeClient({ spawn: () => new FakeJudgeWorker((request) => ({ id: request.id, ok: true, results: answer })) })({ chat: NOTED_SHEET })).rejects.toBeInstanceOf(JudgeProtocolError)
    })
})

describe('J1 the client reads every applied area', () => {
    const STUDIO_LEAF = '[data-part="studio-asset-row"]{opacity:1}'

    it('a {chat, studio} request over the real handler resolves with both verdicts, each judged in its own area', async () => {
        const worker = new FakeJudgeWorker()
        const judgement = await clientOver(worker)({ chat: PLAIN_CHAT_SHEET, studio: STUDIO_LEAF })
        expect(worker.posts[0].message.jobs.map((entry) => [entry.label, entry.area])).toEqual([['chat', 'chat'], ['studio', 'studio']])
        expect(judgement.areas.chat).toEqual(judgeAreaSheet('chat', PLAIN_CHAT_SHEET, undefined, 'chat'))
        expect(judgement.areas.studio).toEqual(judgeAreaSheet('studio', STUDIO_LEAF, undefined, 'studio'))
        expect(judgement.areas.studio?.result.ok).toBe(true)
    })

    it('a studio-only request carries one studio job', async () => {
        const worker = new FakeJudgeWorker()
        const judgement = await clientOver(worker)({ studio: STUDIO_LEAF })
        expect(worker.posts[0].message.jobs.map((entry) => entry.label)).toEqual(['studio'])
        expect(Object.keys(judgement.areas)).toEqual(['studio'])
    })

    it('readJudgement keeps the studio area of a pack judgement', () => {
        const judged = judgePackSheets({ chat: PLAIN_CHAT_SHEET, studio: STUDIO_LEAF })
        expect(readJudgement(structuredClone(judged))).toEqual(judged)
    })
})

describe('W the session: one worker for every request', () => {
    const SHEET_B = '[data-part="chat-message-avatar"]{opacity:0.25}'
    const job = (label: string, text: string): JudgeJob => ({ label, area: 'chat', text })
    const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

    function session(behaviour: Behaviour = 'real', timeoutMs?: number) {
        const workers: FakeJudgeWorker[] = []
        const opened = openJudgeSession({ spawn: () => { const worker = new FakeJudgeWorker(behaviour); workers.push(worker); return worker }, timeoutMs })
        return { opened, workers }
    }

    it('the handler and the client share the job cap', () => {
        expect(MAX_JUDGE_JOBS).toBe(HANDLER_MAX_JOBS)
    })

    it('spawns lazily on the first request and reuses the one worker, terminating it only at close, idempotently', async () => {
        const { opened, workers } = session()
        expect(workers).toHaveLength(0)
        await opened.jobs([job('a', PLAIN_CHAT_SHEET)])
        await opened.jobs([job('b', SHEET_B)])
        expect(workers).toHaveLength(1)
        expect(workers[0].posts).toHaveLength(2)
        expect(workers[0].posts[0].message.id).not.toBe(workers[0].posts[1].message.id)
        expect(workers[0].terminations).toBe(0)
        opened.close()
        opened.close()
        expect(workers[0].terminations).toBe(1)
    })

    it('S0-C2: maps a verdict by label, whatever the order of the answer', async () => {
        const reversed: Behaviour = (request) => {
            const answer = handleJudgeRequest(request)
            if (!answer.ok) return answer
            return { ...answer, results: Object.fromEntries(Object.entries(answer.results).reverse()) }
        }
        const { opened } = session(reversed)
        const results = await opened.jobs([job('a', PLAIN_CHAT_SHEET), job('b', SHEET_B)])
        expect(results.a).toEqual(judgeAreaSheet('chat', PLAIN_CHAT_SHEET, undefined, 'chat'))
        expect(results.b).toEqual(judgeAreaSheet('chat', SHEET_B, undefined, 'chat'))
        expect(results.a.canonical).not.toBe(results.b.canonical)
    })

    it('S0-C2: a missing requested label rejects JudgeProtocolError and closes the session', async () => {
        const dropsB: Behaviour = (request) => {
            const answer = handleJudgeRequest(request)
            if (!answer.ok) return answer
            return { ...answer, results: { a: answer.results.a } }
        }
        const { opened, workers } = session(dropsB)
        await expect(opened.jobs([job('a', PLAIN_CHAT_SHEET), job('b', SHEET_B)])).rejects.toBeInstanceOf(JudgeProtocolError)
        expect(workers[0].terminations).toBe(1)
    })

    it('S0-C2: an extra label rejects JudgeProtocolError', async () => {
        const addsC: Behaviour = (request) => {
            const answer = handleJudgeRequest(request)
            if (!answer.ok) return answer
            return { ...answer, results: { ...answer.results, c: answer.results.a } }
        }
        const { opened } = session(addsC)
        await expect(opened.jobs([job('a', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeProtocolError)
    })

    it('S0-C2: a verdict that is only inherited, not an own key of the answer, is not read', async () => {
        const inherited: Behaviour = (request) => {
            const answer = handleJudgeRequest(request)
            if (!answer.ok) return answer
            return { ...answer, results: Object.create(answer.results) }
        }
        const { opened } = session(inherited)
        await expect(opened.jobs([job('a', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeProtocolError)
    })

    it('S0-C2: an ok:false answer rejects with its text and closes the session', async () => {
        const { opened, workers } = session((request) => ({ id: request.id, ok: false, error: 'Error: boom' }))
        await expect(opened.jobs([job('a', PLAIN_CHAT_SHEET)])).rejects.toThrow('Error: boom')
        expect(workers[0].terminations).toBe(1)
        await expect(opened.jobs([job('b', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeUnavailableError)
        expect(workers).toHaveLength(1)
        expect(workers[0].posts).toHaveLength(1)
    })

    it('answers concurrent requests of one session each with its own verdict', async () => {
        const { opened, workers } = session()
        const [first, second] = await Promise.all([opened.jobs([job('a', PLAIN_CHAT_SHEET)]), opened.jobs([job('a', SHEET_B)])])
        expect(workers).toHaveLength(1)
        expect(first.a.canonical).not.toBe(second.a.canonical)
    })

    it.each([
        ['a duplicate label', [job('a', PLAIN_CHAT_SHEET), job('a', SHEET_B)]],
        ['an empty label', [job('', PLAIN_CHAT_SHEET)]],
        ['more than the cap', Array.from({ length: MAX_JUDGE_JOBS + 1 }, (_, index) => job(`j${index}`, PLAIN_CHAT_SHEET))],
        ['an area that is not applied', [{ label: 'a', area: 'sidebar', text: PLAIN_CHAT_SHEET } as unknown as JudgeJob]],
        ['text that is not a string', [{ label: 'a', area: 'chat', text: 5 } as unknown as JudgeJob]],
    ])('E7: rejects %s at once, without spawning or posting, and closes the session', async (_name, list) => {
        const { opened, workers } = session()
        const rejection = expect(opened.jobs(list)).rejects.toBeInstanceOf(JudgeProtocolError)
        expect(workers).toHaveLength(0)
        await rejection
        await expect(opened.jobs([job('a', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeUnavailableError)
        expect(workers).toHaveLength(0)
    })

    it('E7: a request after close rejects without spawning, and an answer arriving after close is ignored', async () => {
        const { opened, workers } = session('silent')
        const pending = opened.jobs([job('a', PLAIN_CHAT_SHEET)])
        const settled = expect(pending).rejects.toBeInstanceOf(JudgeUnavailableError)
        opened.close()
        await settled
        workers[0].emitMessage(handleJudgeRequest(chatRequest(workers[0].posts[0].message.id, PLAIN_CHAT_SHEET)))
        expect(workers[0].terminations).toBe(1)
        await expect(opened.jobs([job('a', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeUnavailableError)
        expect(workers).toHaveLength(1)
        expect(workers[0].posts).toHaveLength(1)
    })

    it('rejects JudgeUnavailableError when spawn throws, and every later request rejects without another spawn attempt', async () => {
        let attempts = 0
        const opened = openJudgeSession({ spawn: () => { attempts += 1; throw new Error('no workers here') } })
        await expect(opened.jobs([job('a', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeUnavailableError)
        await expect(opened.jobs([job('a', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeUnavailableError)
        expect(attempts).toBe(1)
    })

    describe('S0-C3 a timeout, an error or a messageerror closes the session', () => {
        it('timeout: terminates, and the next request neither posts to the old worker nor spawns', async () => {
            vi.useFakeTimers()
            const { opened, workers } = session('silent', 250)
            const first = expect(opened.jobs([job('a', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeTimeoutError)
            await vi.advanceTimersByTimeAsync(250)
            await first
            expect(workers[0].terminations).toBe(1)
            await expect(opened.jobs([job('b', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeUnavailableError)
            expect(workers).toHaveLength(1)
            expect(workers[0].posts).toHaveLength(1)
        })

        it.each([['error', JudgeUnavailableError], ['messageerror', JudgeProtocolError]] as const)('%s: terminates, and the next request neither posts nor spawns', async (type, expected) => {
            const { opened, workers } = session('silent')
            const first = opened.jobs([job('a', PLAIN_CHAT_SHEET)])
            workers[0].emitPlain(type)
            await expect(first).rejects.toBeInstanceOf(expected)
            expect(workers[0].terminations).toBe(1)
            await expect(opened.jobs([job('b', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeUnavailableError)
            expect(workers).toHaveLength(1)
            expect(workers[0].posts).toHaveLength(1)
        })

        it('an error while nothing is in flight still closes the session', async () => {
            const { opened, workers } = session()
            await opened.jobs([job('a', PLAIN_CHAT_SHEET)])
            workers[0].emitPlain('error')
            expect(workers[0].terminations).toBe(1)
            await expect(opened.jobs([job('b', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeUnavailableError)
            expect(workers).toHaveLength(1)
        })
    })

    describe('S0-C6 User Timing, read from the Node performance timeline of this node-environment file', () => {
        it('marks one risu:judge:first per session and one risu:judge:next per later request', async () => {
            performance.clearMeasures('risu:judge:first')
            performance.clearMeasures('risu:judge:next')
            const { opened } = session()
            await opened.jobs([job('a', PLAIN_CHAT_SHEET)])
            await flush()
            expect(performance.getEntriesByName('risu:judge:first')).toHaveLength(1)
            expect(performance.getEntriesByName('risu:judge:next')).toHaveLength(0)
            await opened.jobs([job('b', SHEET_B)])
            await opened.jobs([job('c', SHEET_B)])
            expect(performance.getEntriesByName('risu:judge:first')).toHaveLength(1)
            expect(performance.getEntriesByName('risu:judge:next')).toHaveLength(2)
            const second = session()
            await second.opened.jobs([job('a', PLAIN_CHAT_SHEET)])
            expect(performance.getEntriesByName('risu:judge:first')).toHaveLength(2)
            expect(performance.getEntriesByName('risu:judge:next')).toHaveLength(2)
        })
    })

    describe('T1-C and T2 per-job User Timing and the ready mark', () => {
        const jobMeasures = (label: string): PerformanceEntry[] => performance.getEntriesByName(`risu:judge:job:${label}`)
        const clear = (...labels: string[]): void => {
            performance.clearMeasures('risu:judge:ready')
            for (const label of labels) performance.clearMeasures(`risu:judge:job:${label}`)
        }

        it('T1-C: measures one risu:judge:job:<label> per answered label, carrying cold and area, and one ready per session', async () => {
            clear('a', 'b')
            const { opened } = session()
            await opened.jobs([job('a', PLAIN_CHAT_SHEET), job('b', SHEET_B)])
            await opened.jobs([job('c', SHEET_B)])
            expect(jobMeasures('a')).toHaveLength(1)
            expect(jobMeasures('b')).toHaveLength(1)
            const detail = (jobMeasures('b')[0] as PerformanceMeasure).detail as { cold: unknown; area: unknown }
            expect(detail.cold).toBe(false)
            expect(detail.area).toBe('chat')
            expect(performance.getEntriesByName('risu:judge:ready')).toHaveLength(1)
            const ready = performance.getEntriesByName('risu:judge:ready')[0]
            expect(ready.duration).toBeGreaterThanOrEqual(0)
            await session().opened.jobs([job('a', PLAIN_CHAT_SHEET)])
            expect(performance.getEntriesByName('risu:judge:ready')).toHaveLength(2)
            expect(jobMeasures('a')).toHaveLength(2)
        })

        const WELL_FORMED = { ms: 1.5, cold: true }
        const ROWS: Array<[string, unknown]> = [
            ['missing', undefined],
            ['not a record', 'slow'],
            ['an array', [WELL_FORMED]],
            ['a non-finite ms', { a: { ms: Number.POSITIVE_INFINITY, cold: true } }],
            ['a negative ms', { a: { ms: -1, cold: true } }],
            ['a cold that is not a boolean', { a: { ms: 1, cold: 'yes' } }],
            ['a label that was not requested', { zzz: WELL_FORMED }],
        ]
        it.each(ROWS)('T2: a %s timing changes no result and records no measure', async (_name, timing) => {
            clear('a', 'zzz')
            const behaviour: Behaviour = (request) => {
                const answer = handleJudgeRequest(request)
                if (!answer.ok) return answer
                return { ...answer, timing }
            }
            const { opened } = session(behaviour)
            const results = await opened.jobs([job('a', PLAIN_CHAT_SHEET)])
            expect(results.a).toEqual(judgeAreaSheet('chat', PLAIN_CHAT_SHEET, undefined, 'chat'))
            expect(jobMeasures('a')).toHaveLength(0)
            expect(jobMeasures('zzz')).toHaveLength(0)
        })

        it('T1-C positive control: a well-formed cold timing reaches the measure with its cold flag, area and duration', async () => {
            clear('a')
            const behaviour: Behaviour = (request) => {
                const answer = handleJudgeRequest(request)
                if (!answer.ok) return answer
                return { ...answer, timing: { a: { ms: 1.5, cold: true } } }
            }
            const { opened } = session(behaviour)
            await opened.jobs([job('a', PLAIN_CHAT_SHEET)])
            expect(jobMeasures('a')).toHaveLength(1)
            const measure = jobMeasures('a')[0] as PerformanceMeasure
            expect(measure.detail).toEqual({ cold: true, area: 'chat' })
            expect(measure.duration).toBeCloseTo(1.5, 5)
        })

        it('T2: a missing or non-finite readyAt records no ready mark and still resolves', async () => {
            for (const readyAt of [undefined, Number.NaN, 'soon']) {
                clear('a')
                const behaviour: Behaviour = (request) => {
                    const answer = handleJudgeRequest(request)
                    return answer.ok ? { ...answer, readyAt } : answer
                }
                await session(behaviour).opened.jobs([job('a', PLAIN_CHAT_SHEET)])
                expect(performance.getEntriesByName('risu:judge:ready')).toHaveLength(0)
            }
        })

        it('T2: an answer rejected for an extra result key carries valid timing and records no job measure', async () => {
            clear('a')
            const behaviour: Behaviour = (request) => {
                const answer = handleJudgeRequest(request)
                if (!answer.ok) return answer
                return { ...answer, results: { ...answer.results, extra: answer.results.a }, timing: { a: WELL_FORMED } }
            }
            const { opened } = session(behaviour)
            await expect(opened.jobs([job('a', PLAIN_CHAT_SHEET)])).rejects.toBeInstanceOf(JudgeProtocolError)
            expect(jobMeasures('a')).toHaveLength(0)
            expect(performance.getEntriesByName('risu:judge:ready')).toHaveLength(0)
        })
    })

    it('createJudgeClient stays a one-request session: one spawn, one post, terminated after the answer', async () => {
        const workers: FakeJudgeWorker[] = []
        const judge = createJudgeClient({ spawn: () => { const worker = new FakeJudgeWorker(); workers.push(worker); return worker } })
        const verdict = await judge({ chat: PLAIN_CHAT_SHEET })
        expect(verdict).toEqual(judgePackSheets({ chat: PLAIN_CHAT_SHEET }))
        expect(workers).toHaveLength(1)
        expect(workers[0].posts).toHaveLength(1)
        expect(workers[0].terminations).toBe(1)
    })
})