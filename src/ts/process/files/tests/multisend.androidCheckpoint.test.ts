/**
 * A `.po` job on Tauri writes a checkpoint file after every entry. On Android every `downloadFile` opens the
 * save picker, so the per-entry checkpoint is skipped there and the user is asked once, at the end.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const hoisted = vi.hoisted(() => ({ isTauri: true, osType: 'android' }))

vi.mock(import('../../index.svelte'), async () => {
    const { writable: makeWritable } = await import('svelte/store')
    return { doingChat: makeWritable(false), sendChat: vi.fn() } as unknown as typeof import('../../index.svelte')
})
vi.mock(import('../../generationOwnership.svelte'), () => ({ isComposerWindowOpen: vi.fn() }) as unknown as typeof import('../../generationOwnership.svelte'))
vi.mock(import('../../chatOrigin'), () => ({ createSendSubject: vi.fn(), registerWork: vi.fn() }) as unknown as typeof import('../../chatOrigin'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({ downloadFile: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return hoisted.isTauri },
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('@tauri-apps/plugin-os'), () => ({
    type: () => hoisted.osType,
}) as unknown as typeof import('@tauri-apps/plugin-os'))
vi.mock(import('../../memory/hypamemory'), () => ({ HypaProcesser: vi.fn() }) as unknown as typeof import('../../memory/hypamemory'))
vi.mock(import('src/ts/util'), () => ({
    BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
    selectMultipleFileObjects: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('../../../alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('../../../alert'))
vi.mock(import('../inlays'), () => ({
    isInlayRefusal: () => false,
    postInlayAsset: vi.fn(),
}) as unknown as typeof import('../inlays'))

//#endregion

import { downloadFile } from 'src/ts/globalApi.svelte'
import { sendChat } from '../../index.svelte'
import { isComposerWindowOpen } from '../../generationOwnership.svelte'
import { createSendSubject, registerWork } from '../../chatOrigin'
import { postChatFile } from '../multisend'

const TWO_ENTRIES = [
    'msgid "one"',
    'msgstr ""',
    '',
    'msgid "two"',
    'msgstr ""',
    '',
].join('\n')

beforeEach(() => {
    hoisted.isTauri = true
    hoisted.osType = 'android'
    vi.mocked(downloadFile).mockReset()
    vi.mocked(sendChat).mockReset().mockResolvedValue(true)
    vi.mocked(isComposerWindowOpen).mockReset().mockReturnValue(false)
    vi.mocked(registerWork).mockReset().mockReturnValue({ end: vi.fn() } as unknown as ReturnType<typeof registerWork>)
    const chat = { message: [] as { role: string, data: string }[] }
    vi.mocked(createSendSubject).mockReset().mockReturnValue({
        origin: {},
        resolve: () => ({ chat }),
        mark: vi.fn(),
    } as unknown as ReturnType<typeof createSendSubject>)
})

async function runJob() {
    await postChatFile(
        { name: 'job.po', data: new TextEncoder().encode(TWO_ENTRIES) },
        { chaId: 'cha', chatId: 'chat' } as unknown as Parameters<typeof postChatFile>[1],
    )
}

describe('the translated .po hand-over', () => {
    test('on Android the job saves once, at the end, not after every entry', async () => {
        await runJob()
        expect(sendChat).toHaveBeenCalledTimes(2)
        expect(downloadFile).toHaveBeenCalledTimes(1)
        expect(downloadFile).toHaveBeenCalledWith('translated.po', expect.any(String))
    })

    test('on desktop the job still writes a checkpoint after every entry and then the final file', async () => {
        hoisted.osType = 'windows'
        await runJob()
        expect(downloadFile).toHaveBeenCalledTimes(3)
    })

    test('on the web the job saves only the final file', async () => {
        hoisted.isTauri = false
        hoisted.osType = 'windows'
        await runJob()
        expect(downloadFile).toHaveBeenCalledTimes(1)
    })
})
