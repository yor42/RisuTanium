/**
 * `postChatFile` with an audio or video file over the attachment limit: the user
 * is told which file was refused and the limit, and the file is not attached.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('../../index.svelte'), () => ({ doingChat: vi.fn(), sendChat: vi.fn() }) as unknown as typeof import('../../index.svelte'))
vi.mock(import('../../generationOwnership.svelte'), () => ({ isComposerWindowOpen: vi.fn() }) as unknown as typeof import('../../generationOwnership.svelte'))
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

beforeEach(() => {
    vi.mocked(alertError).mockClear()
    vi.mocked(postInlayAsset).mockReset()
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
