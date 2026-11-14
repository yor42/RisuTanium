// @vitest-environment node
// The worker's request handler: real verdicts from the merged validator, and the isolation of the applied areas. T3W-6.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { judgePackSheets } from '../index'
import { handleJudgeRequest } from './judgeHandler'
import { PLAIN_CHAT_SHEET } from '../fixtures/packBuilder'

vi.mock('../index', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../index')>()
    return { ...actual, judgePackSheets: vi.fn(actual.judgePackSheets) }
})

const STUDIO_SHEET = '[data-studio-part]{padding-inline:60px}'
const HOME_SHEET = '[data-home-part]{padding-inline:60px}'

afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(judgePackSheets).mockClear()
})

describe('T3W-6 the judge worker handler', () => {
    it('answers a valid chat request with exactly the validator verdict of that sheet', () => {
        const answer = handleJudgeRequest({ id: 7, sheets: { chat: PLAIN_CHAT_SHEET } })
        expect(answer).toEqual({ id: 7, ok: true, judgement: judgePackSheets({ chat: PLAIN_CHAT_SHEET }) })
        if (answer.ok === false) throw new Error('expected an answer')
        expect(answer.judgement.areas.chat?.result.ok).toBe(true)
    })

    it('judges the chat sheet only: a request that also carries studio and home sheets never reaches them', () => {
        vi.mocked(judgePackSheets).mockClear()
        const answer = handleJudgeRequest({ id: 8, sheets: { chat: PLAIN_CHAT_SHEET, studio: STUDIO_SHEET, home: HOME_SHEET, settings: 'a{}' } })
        if (answer.ok === false) throw new Error('expected an answer')
        expect(Object.keys(answer.judgement.areas)).toEqual(['chat'])
        expect(vi.mocked(judgePackSheets).mock.calls).toEqual([[{ chat: PLAIN_CHAT_SHEET }]])
    })

    it('ignores a chat entry that is not a string and judges nothing for it', () => {
        const answer = handleJudgeRequest({ id: 9, sheets: { chat: 5 } })
        expect(answer).toEqual({ id: 9, ok: true, judgement: { ok: true, areas: {} } })
    })

    it.each([
        ['null', null],
        ['a string', 'chat'],
        ['an array', [1, {}]],
        ['no sheets', { id: 1 }],
        ['sheets that is not an object', { id: 1, sheets: 'a{}' }],
        ['sheets that is an array', { id: 1, sheets: ['a{}'] }],
        ['a fractional id', { id: 1.5, sheets: {} }],
        ['a string id', { id: '1', sheets: {} }],
        ['an id beyond the safe integers', { id: 2 ** 53, sheets: {} }],
    ])('answers %s with id -1 and never calls the validator', (_label, message) => {
        vi.mocked(judgePackSheets).mockClear()
        const answer = handleJudgeRequest(message)
        expect(answer.id).toBe(-1)
        expect(answer.ok).toBe(false)
        expect(vi.mocked(judgePackSheets)).not.toHaveBeenCalled()
    })

    it('answers a validator throw with ok:false and its text, logging once in development', () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.mocked(judgePackSheets).mockImplementationOnce(() => { throw new Error('boom') })
        const answer = handleJudgeRequest({ id: 11, sheets: { chat: PLAIN_CHAT_SHEET } })
        expect(answer).toEqual({ id: 11, ok: false, error: 'Error: boom' })
        expect(logged).toHaveBeenCalledTimes(1)
        expect(logged.mock.calls[0][0]).toBe('theme pack judge failed')
    })
})
