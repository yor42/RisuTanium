/**
 * An image-prompt request that a Stop abandons raises no alert and starts no image generation: `stableDiff` checks
 * the unit's signal right after its request returns, and passes it to the request.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../alert', () => ({ alertError: vi.fn() }))
vi.mock('../../globalApi.svelte', () => ({ globalFetch: vi.fn(), fetchNative: vi.fn(), readImage: vi.fn() }))
vi.mock('../../storage/database.svelte', () => ({ getDatabase: vi.fn() }))
vi.mock('../../stores.svelte', () => ({ CharEmotion: { set: vi.fn() } }))
vi.mock('../processzip', () => ({ processZip: vi.fn() }))
vi.mock('../request/request', () => ({ requestChatData: vi.fn() }))

import { stableDiff } from '../stableDiff'
import { getDatabase, type character } from '../../storage/database.svelte'
import { alertError } from '../../alert'
import { globalFetch } from '../../globalApi.svelte'
import { requestChatData } from '../request/request'

type ChatResult = Awaited<ReturnType<typeof requestChatData>>

const currentChar = { chaId: 'cha', newGenData: { instructions: 'i', prompt: 'p {{slot}}', negative: 'n' } } as unknown as character

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDatabase).mockReturnValue({ sdProvider: 'dalle', openAIKey: 'sk-test', dallEQuality: '' } as unknown as ReturnType<typeof getDatabase>)
})

describe('stableDiff after a Stop', () => {
    test('SD-1: a request that fails with Aborted after the abort raises no alert and starts no image', async () => {
        let finish: (value: ChatResult) => void = () => {}
        vi.mocked(requestChatData).mockImplementation(() => new Promise<ChatResult>((resolve) => { finish = resolve }))
        const controller = new AbortController()

        const run = stableDiff(currentChar, 'p', undefined, controller.signal)
        controller.abort()
        finish({ type: 'fail', result: 'Aborted' })

        expect(await run).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
        expect(globalFetch).not.toHaveBeenCalled()
    })

    test('SD-1: the request receives the signal', async () => {
        vi.mocked(requestChatData).mockResolvedValue({ type: 'fail', result: 'x' } as ChatResult)
        const controller = new AbortController()

        await stableDiff(currentChar, 'p', undefined, controller.signal)

        expect(vi.mocked(requestChatData).mock.calls[0][2]).toBe(controller.signal)
    })

    test('guard: a failed request without a Stop still raises its alert', async () => {
        vi.mocked(requestChatData).mockResolvedValue({ type: 'fail', result: 'model said no' } as ChatResult)

        expect(await stableDiff(currentChar, 'p')).toBe(false)
        expect(alertError).toHaveBeenCalledWith('model said no')
    })
})
