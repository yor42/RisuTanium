// @vitest-environment node
// The worker's request handler: real verdicts from the merged validator, one per labelled job, and the isolation of the
// applied areas. T3W-6 and S0-C1.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { judgeAreaSheet } from '../index'
import { handleJudgeRequest, MAX_JUDGE_JOBS } from './judgeHandler'
import { PLAIN_CHAT_SHEET } from '../fixtures/packBuilder'

vi.mock('../index', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../index')>()
    return { ...actual, judgeAreaSheet: vi.fn(actual.judgeAreaSheet) }
})

const STUDIO_SHEET = '[data-part="studio-asset-row"]{opacity:1}'
const HOME_SHEET = '[data-home-part]{padding-inline:60px}'

function chatJob(label: string, text = PLAIN_CHAT_SHEET): { label: string; area: string; text: string } {
    return { label, area: 'chat', text }
}

afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(judgeAreaSheet).mockClear()
})

describe('T3W-6 the judge worker handler', () => {
    it('S0-C1: answers a valid chat job with exactly the validator verdict of that sheet, under its label', () => {
        const answer = handleJudgeRequest({ id: 7, jobs: [chatJob('chat')] })
        expect(answer).toEqual({
            id: 7, ok: true, results: { chat: judgeAreaSheet('chat', PLAIN_CHAT_SHEET, undefined, 'chat') },
            timing: { chat: { ms: expect.any(Number), cold: expect.any(Boolean) } }, readyAt: expect.any(Number),
        })
        if (answer.ok === false) throw new Error('expected an answer')
        expect(answer.results.chat.result.ok).toBe(true)
        expect(vi.mocked(judgeAreaSheet).mock.calls.at(0)).toEqual(['chat', PLAIN_CHAT_SHEET, undefined, 'chat'])
    })

    it('S0-C1: answers every labelled job of an applied area, the same sheet under two labels included', () => {
        const answer = handleJudgeRequest({ id: 1, jobs: [chatJob('chat#light'), chatJob('chat#shape', '[data-part="chat-message-avatar"]{opacity:1}')] })
        if (answer.ok === false) throw new Error('expected an answer')
        expect(Object.keys(answer.results)).toEqual(['chat#light', 'chat#shape'])
        expect(vi.mocked(judgeAreaSheet)).toHaveBeenCalledTimes(2)
    })

    it('S0-C1: a job of a non-applied area is dropped and never judged; the studio and settings jobs are judged in their own areas', () => {
        vi.mocked(judgeAreaSheet).mockClear()
        const answer = handleJudgeRequest({
            id: 8,
            jobs: [
                chatJob('chat'),
                { label: 'studio', area: 'studio', text: STUDIO_SHEET },
                { label: 'home', area: 'home', text: HOME_SHEET },
                { label: 'settings', area: 'settings', text: 'a{}' },
            ],
        })
        if (answer.ok === false) throw new Error('expected an answer')
        expect(Object.keys(answer.results)).toEqual(['chat', 'studio', 'settings'])
        expect(answer.results.studio).toEqual(judgeAreaSheet('studio', STUDIO_SHEET, undefined, 'studio'))
        expect(vi.mocked(judgeAreaSheet).mock.calls.slice(0, 3)).toEqual([
            ['chat', PLAIN_CHAT_SHEET, undefined, 'chat'],
            ['studio', STUDIO_SHEET, undefined, 'studio'],
            ['settings', 'a{}', undefined, 'settings'],
        ])
    })

    it('W-1: a popups job and a popups#shape job are judged in the popups area, under their labels', () => {
        const sheet = '[data-part="toast"]{border-radius:4px}'
        const answer = handleJudgeRequest({
            id: 9,
            jobs: [{ label: 'popups', area: 'popups', text: sheet }, { label: 'popups#shape', area: 'popups', text: sheet }],
        })
        if (answer.ok === false) throw new Error('expected an answer')
        expect(Object.keys(answer.results)).toEqual(['popups', 'popups#shape'])
        expect(answer.results.popups).toEqual(judgeAreaSheet('popups', sheet, undefined, 'popups'))
        expect(answer.results.popups.result.ok).toBe(true)
    })

    it('S0-C1: an empty job list is a valid request with no results', () => {
        expect(handleJudgeRequest({ id: 2, jobs: [] })).toEqual({ id: 2, ok: true, results: {}, timing: {}, readyAt: expect.any(Number) })
    })

    it('S0-C1: a label such as __proto__ is an own result, never a prototype write', () => {
        const answer = handleJudgeRequest({ id: 3, jobs: [chatJob('__proto__')] })
        if (answer.ok === false) throw new Error('expected an answer')
        expect(Object.hasOwn(answer.results, '__proto__')).toBe(true)
        expect(Object.getPrototypeOf(answer.results)).toBe(Object.prototype)
    })

    it(`S0-C1: accepts exactly ${MAX_JUDGE_JOBS} jobs and refuses one more`, () => {
        const jobs = (count: number) => Array.from({ length: count }, (_, index) => chatJob(`job-${index}`))
        expect(handleJudgeRequest({ id: 4, jobs: jobs(MAX_JUDGE_JOBS) }).ok).toBe(true)
        vi.mocked(judgeAreaSheet).mockClear()
        const over = handleJudgeRequest({ id: 4, jobs: jobs(MAX_JUDGE_JOBS + 1) })
        expect(over).toEqual({ id: -1, ok: false, error: 'malformed judge request' })
        expect(vi.mocked(judgeAreaSheet)).not.toHaveBeenCalled()
    })

    it.each([
        ['null', null],
        ['a string', 'chat'],
        ['an array', [1, {}]],
        ['no jobs', { id: 1 }],
        ['jobs that is not an array', { id: 1, jobs: 'a{}' }],
        ['jobs that is an object', { id: 1, jobs: { chat: 'a{}' } }],
        ['the old sheets shape', { id: 1, sheets: { chat: PLAIN_CHAT_SHEET } }],
        ['a fractional id', { id: 1.5, jobs: [] }],
        ['a string id', { id: '1', jobs: [] }],
        ['an id beyond the safe integers', { id: 2 ** 53, jobs: [] }],
        ['a job that is not an object', { id: 1, jobs: ['a{}'] }],
        ['an empty label', { id: 1, jobs: [chatJob('')] }],
        ['a label that is not a string', { id: 1, jobs: [{ label: 5, area: 'chat', text: 'a{}' }] }],
        ['a duplicate label', { id: 1, jobs: [chatJob('x'), chatJob('x')] }],
        ['a text that is not a string', { id: 1, jobs: [{ label: 'chat', area: 'chat', text: 5 }] }],
        ['an area that is not a string', { id: 1, jobs: [{ label: 'chat', area: 5, text: 'a{}' }] }],
        ['a text that is not a string on a non-applied area', { id: 1, jobs: [{ label: 'x', area: 'studio', text: 5 }] }],
    ])('S0-C1: answers %s with id -1 and never calls the validator', (_label, message) => {
        vi.mocked(judgeAreaSheet).mockClear()
        const answer = handleJudgeRequest(message)
        expect(answer.id).toBe(-1)
        expect(answer.ok).toBe(false)
        expect(vi.mocked(judgeAreaSheet)).not.toHaveBeenCalled()
    })

    // T1-W: per-job timing; `cold` is the first job of an area in one worker module.
    it('T1-W: times every answered job, cold for the first job of each area only, and a second request is warm in both areas', async () => {
        vi.resetModules()
        const fresh = await import('./judgeHandler')
        const first = fresh.handleJudgeRequest({
            id: 1,
            jobs: [{ label: 'studio', area: 'studio', text: STUDIO_SHEET }, { label: 'studio#2', area: 'studio', text: STUDIO_SHEET }, chatJob('chat'), { label: 'home', area: 'home', text: HOME_SHEET }],
        })
        if (first.ok === false) throw new Error('expected an answer')
        expect(Object.keys(first.results)).toEqual(['studio', 'studio#2', 'chat'])
        expect(Object.keys(first.timing)).toEqual(['studio', 'studio#2', 'chat'])
        expect(first.timing.studio.cold).toBe(true)
        expect(first.timing['studio#2'].cold).toBe(false)
        expect(first.timing.chat.cold).toBe(true)
        for (const timing of Object.values(first.timing)) {
            expect(Number.isFinite(timing.ms) && timing.ms >= 0).toBe(true)
        }
        expect(Number.isFinite(first.readyAt)).toBe(true)
        const second = fresh.handleJudgeRequest({ id: 2, jobs: [chatJob('chat'), { label: 'studio', area: 'studio', text: STUDIO_SHEET }] })
        if (second.ok === false) throw new Error('expected an answer')
        expect(second.timing.chat.cold).toBe(false)
        expect(second.timing.studio.cold).toBe(false)
        expect(second.readyAt).toBe(first.readyAt)
    })

    it('answers a validator throw with ok:false and its text, logging once in development', () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.mocked(judgeAreaSheet).mockImplementationOnce(() => { throw new Error('boom') })
        const answer = handleJudgeRequest({ id: 11, jobs: [chatJob('chat')] })
        expect(answer).toEqual({ id: 11, ok: false, error: 'Error: boom' })
        expect(logged).toHaveBeenCalledTimes(1)
        expect(logged.mock.calls[0][0]).toBe('theme pack judge failed')
    })
})
