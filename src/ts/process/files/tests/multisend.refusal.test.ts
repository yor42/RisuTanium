/**
 * `postChatFile` with an audio or video file over the attachment limit: the user
 * is told which file was refused and the limit, and the file is not attached.
 * A `.po` job posts its entries into its own chat unless that chat writes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('../../index.svelte'), async () => {
    const { activeUnits } = await import('../../activeUnits')
    return { doingChat: activeUnits.active, sendChat: vi.fn(async () => true) } as unknown as typeof import('../../index.svelte')
})
vi.mock(import('../../generationOwnership.svelte'), () => ({
    isComposerWindowOpen: vi.fn(() => false),
    composerWindowFor: vi.fn(() => false),
}) as unknown as typeof import('../../generationOwnership.svelte'))
vi.mock(import('../../../stores.svelte'), () => ({ DBState: { db: {} }, selectedCharID: { subscribe: (run: (value: number) => void) => { run(-1); return () => {} } } }) as unknown as typeof import('../../../stores.svelte'))
vi.mock(import('../../chatOrigin'), () => ({ createSendSubject: vi.fn(), registerWork: vi.fn() }) as unknown as typeof import('../../chatOrigin'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({ downloadFile: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false }) as unknown as typeof import('src/ts/platform'))
vi.mock(import('../../memory/hypamemory'), () => ({ HypaProcesser: vi.fn() }) as unknown as typeof import('../../memory/hypamemory'))
vi.mock(import('src/ts/util'), () => ({ BufferToText: vi.fn(), selectMultipleFile: vi.fn() }) as unknown as typeof import('src/ts/util'))
vi.mock(import('../../../alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('../../../alert'))
vi.mock(import('../inlays'), () => ({
    isInlayRefusal: (result: unknown) => result !== null && typeof result === 'object',
    postInlayAsset: vi.fn(),
}) as unknown as typeof import('../inlays'))

//#endregion

import { language } from 'src/lang'
import { alertError } from '../../../alert'
import { postInlayAsset } from '../inlays'
import { postChatFile } from '../multisend'
import { createSendSubject, registerWork } from '../../chatOrigin'
import { sendChat } from '../../index.svelte'
import { BufferToText } from 'src/ts/util'
import { clearRunningSends, simulateRunningSend } from '../../tests/activeUnits.test-helpers'

beforeEach(() => {
    vi.mocked(alertError).mockClear()
    vi.mocked(postInlayAsset).mockReset()
    vi.mocked(sendChat).mockClear()
    clearRunningSends()
})

afterEach(() => {
    clearRunningSends()
})

describe('an audio or video file over the attachment limit', () => {
    test('shows the file name and the limit in MiB, and attaches nothing', async () => {
        vi.mocked(postInlayAsset).mockResolvedValue({ refused: 'too-large', name: 'clip.mp4', limit: 200 * 1024 * 1024 })
        const results = await postChatFile({ name: 'clip.mp4', data: new Uint8Array(1) })
        expect(results).toEqual([])
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(language.inlayFileTooLarge.replace('{name}', 'clip.mp4').replace('{size}', '200'))
        expect(vi.mocked(alertError).mock.calls[0][0]).toContain('clip.mp4')
    })

    test('a file that is accepted is attached without a message', async () => {
        vi.mocked(postInlayAsset).mockResolvedValue('inlay-id')
        const results = await postChatFile({ name: 'clip.mp4', data: new Uint8Array(1) })
        expect(results).toEqual([{ data: 'inlay-id', type: 'asset' }])
        expect(alertError).not.toHaveBeenCalled()
    })
})

describe('a .po job and the per-chat send gate', () => {
    const PO = 'msgid "hello"\nmsgstr ""\n\n'
    const own = { chaId: 'char-a', chatId: 'chat-a' }

    function arrangeJob(): { message: { role: string, data: string }[] } {
        const chat = { message: [] as { role: string, data: string }[] }
        vi.mocked(BufferToText).mockReturnValue(PO)
        vi.mocked(registerWork).mockReturnValue({ end: vi.fn() } as unknown as ReturnType<typeof registerWork>)
        vi.mocked(createSendSubject).mockReturnValue({
            origin: own,
            resolve: () => ({ chat }),
            mark: vi.fn(),
        } as unknown as ReturnType<typeof createSendSubject>)
        return chat
    }

    // K2 (regression reproducer): another chat writing does not stop the job.
    test('K2: the job posts its entry while another chat writes', async () => {
        const chat = arrangeJob()
        simulateRunningSend({ chaId: 'char-b', chatId: 'chat-b' })

        await postChatFile({ name: 'a.po', data: new Uint8Array(1) }, own)

        expect(chat.message.map((message) => message.data)).toEqual(['hello'])
        expect(sendChat).toHaveBeenCalledTimes(1)
    })

    test('K2: guard: the job posts nothing while its own chat writes', async () => {
        const chat = arrangeJob()
        simulateRunningSend(own)

        await postChatFile({ name: 'a.po', data: new Uint8Array(1) }, own)

        expect(chat.message).toHaveLength(0)
        expect(sendChat).not.toHaveBeenCalled()
    })
})
