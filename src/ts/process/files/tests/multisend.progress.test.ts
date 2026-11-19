/**
 * `postChatFile` and the progress of an image, audio or video file's write: the
 * callback hears what `postInlayAsset` reports, then `null` when that file's write
 * is over, whether it succeeded, was refused or failed. A text file reports nothing,
 * and a callback that throws changes neither the results nor the loop.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('../../index.svelte'), () => ({ doingChat: vi.fn(), sendChat: vi.fn() }) as unknown as typeof import('../../index.svelte'))
vi.mock(import('../../generationOwnership.svelte'), () => ({ isComposerWindowOpen: vi.fn() }) as unknown as typeof import('../../generationOwnership.svelte'))
vi.mock(import('../../chatOrigin'), () => ({ createSendSubject: vi.fn(), registerWork: vi.fn() }) as unknown as typeof import('../../chatOrigin'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({ downloadFile: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false }) as unknown as typeof import('src/ts/platform'))
vi.mock(import('../../memory/hypamemory'), () => ({
    HypaProcesser: class {
        addText() { }
        async similaritySearch() { return ['hit'] }
    },
}) as unknown as typeof import('../../memory/hypamemory'))
vi.mock(import('src/ts/util'), () => ({
    BufferToText: () => 'hit',
    selectMultipleFileObjects: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('../../../alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('../../../alert'))
vi.mock(import('../inlays'), () => ({
    isInlayRefusal: (result: unknown) => result !== null && typeof result === 'object',
    postInlayAsset: vi.fn(),
}) as unknown as typeof import('../inlays'))

//#endregion

import { alertError } from '../../../alert'
import { selectMultipleFileObjects } from 'src/ts/util'
import { postInlayAsset, type InlayWriteProgress } from '../inlays'
import { postChatFile } from '../multisend'

const MIB = 1024 * 1024

beforeEach(() => {
    vi.mocked(alertError).mockClear()
    vi.mocked(postInlayAsset).mockReset()
    vi.mocked(selectMultipleFileObjects).mockReset()
})

function clip(name = 'clip.mp4') {
    return { name, data: new Uint8Array(1) }
}

describe('postChatFile progress', () => {
    // Regression reproducer: the fourth parameter did not exist, so nothing was heard.
    test('passes postInlayAsset a progress function and relays its reports, then null', async () => {
        const first: InlayWriteProgress = { name: 'clip.mp4', written: 0, total: 8 * MIB }
        const second: InlayWriteProgress = { name: 'clip.mp4', written: 4 * MIB, total: 8 * MIB }
        vi.mocked(postInlayAsset).mockImplementation(async (_file, report) => {
            report?.(first)
            report?.(second)
            return 'id'
        })
        const heard: Array<InlayWriteProgress | null> = []

        const results = await postChatFile(clip(), null, null, (progress) => { heard.push(progress) })

        expect(heard).toEqual([first, second, null])
        expect(vi.mocked(postInlayAsset).mock.calls[0][1]).toBeTypeOf('function')
        expect(results).toEqual([{ data: 'id', type: 'asset' }])
    })

    // Regression reproducer: a refused file still ends with the null report.
    test('a refused file ends with null, shows the alert once and attaches nothing', async () => {
        vi.mocked(postInlayAsset).mockResolvedValue({ refused: 'too-large', name: 'clip.mp4', limit: 1024 * MIB })
        const heard: Array<InlayWriteProgress | null> = []

        const results = await postChatFile(clip(), null, null, (progress) => { heard.push(progress) })

        expect(heard).toEqual([null])
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(results).toEqual([])
    })

    // Regression reproducer: a failed write also ends with null, and the failure reaches the caller as it is.
    test('a write that fails rejects with that error after the null report', async () => {
        const failure = new Error('disk full')
        vi.mocked(postInlayAsset).mockRejectedValue(failure)
        const heard: Array<InlayWriteProgress | null> = []

        await expect(postChatFile(clip(), null, null, (progress) => { heard.push(progress) })).rejects.toBe(failure)

        expect(heard.at(-1)).toBeNull()
    })

    // Compatibility guard: passes before and after; a callback that throws was never called before.
    test('a callback that throws changes neither the results nor the loop over the picked files', async () => {
        vi.mocked(selectMultipleFileObjects).mockResolvedValue([new File(['v'], 'a.mp4'), new File(['t'], 'b.txt')])
        vi.mocked(postInlayAsset).mockResolvedValue('id')

        const results = await postChatFile('query', null, null, () => {
            throw new Error('progress callback failure')
        })

        expect(vi.mocked(postInlayAsset)).toHaveBeenCalledTimes(1)
        expect(results.map((result) => result.type)).toEqual(['asset', 'text'])
        expect(results[0]).toEqual({ data: 'id', type: 'asset' })
    })

    // Compatibility guard: passes before and after.
    test('a text file makes no progress report', async () => {
        const heard: Array<InlayWriteProgress | null> = []

        const results = await postChatFile(clip('notes.txt'), null, null, (progress) => { heard.push(progress) })

        expect(heard).toEqual([])
        expect(postInlayAsset).not.toHaveBeenCalled()
        expect(results.map((result) => result.type)).toEqual(['text'])
    })
})
