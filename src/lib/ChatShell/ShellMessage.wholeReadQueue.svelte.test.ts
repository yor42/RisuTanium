// @vitest-environment jsdom

/**
 * The shell message row's avatar on Android: the row asks for its avatar through `getCharImage`, and a file of 8 MiB or
 * more waits in the app-wide whole-read queue (held until the row is destroyed or asks again) instead of being put on
 * the `<img>` together with the other rows.
 *
 * The real `ShellMessage.svelte` is mounted with the doubles of `ShellMessage.svelte.test.ts`. `getCharImage` is the kit's
 * mirror of the real one (`wholeReadQueue.testKit.ts`; `util.wholeReadQueue.svelte.test.ts` checks the mirror against the
 * real function) behind a spy; the queue, the size verdict and the detached `Image` are the real ones, `Image` being the
 * kit's fake.
 *
 * Labels: `(R)` is a regression reproducer (fails at the pre-fix row), `(G)` a compatibility guard.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Message } from '../../ts/storage/database.svelte'

const { getCharImageSpy } = vi.hoisted(() => ({ getCharImageSpy: vi.fn() }))

vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: {} })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ rebuildEpoch: 0, closeEpoch: 0 })
    return { chatSurface, isChatSurfaceInstalled: () => false }
})
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: () => false, readImage: vi.fn(), getFileSrc: vi.fn() }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn() }))
vi.mock('../../ts/process/messageActions.svelte', () => ({ handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn() }))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false,
    dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/characters', () => ({ getCharImage: getCharImageSpy }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: { messageInterrupted: 'Interrupted' } }))
vi.mock('../../ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../ts/storage/tauriByteTransport')>()),
    isAndroidTransport: () => androidTransport.android,
    statStoredSize: async (key: string) => androidTransport.sizes[key] ?? 0,
}))

import ShellMessage from './ShellMessage.svelte'
import { resetAssetUrlGateForTest } from '../../ts/storage/assetUrlGate'
import { heldQueuedWholeReadsForTest, resetQueuedWholeReadsForTest } from '../../ts/media/queuedWholeRead'
import {
    FakeImage, MIB, WHOLE_READ_BUDGET_BYTES, androidTransport, createMirroredGetCharImage, domUrls, exposedBytes, resetAndroidTransport,
    seedSizes, unsettledSources, urlOf,
} from '../../ts/media/wholeReadQueue.testKit'

const READ_MIN = 8 * MIB
const bigOf = (i: number): string => `assets/avatar${i}.webp`

interface Row {
    target: HTMLElement
    app: ReturnType<typeof ShellMessage>
}
let rows: Row[] = []

function showRow(idx: number, img: string): Row {
    const message: Message = { role: 'char', data: 'Hello', chatId: `m${idx}` }
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ShellMessage, { target, props: { idx, chatId: message.chatId, name: 'Ari', message, img } })
    const row = { target, app }
    rows.push(row)
    return row
}

async function removeRow(row: Row): Promise<void> {
    await unmount(row.app)
    row.target.remove()
    rows = rows.filter((candidate) => candidate !== row)
}

async function settleReads(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        await Promise.resolve()
        flushSync()
    }
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

const exposed = (options: { perElement?: boolean } = {}): number => exposedBytes(document.body, { minBytes: READ_MIN, ...options })

/** Fires `load` on the oldest unsettled fake image until none is left, checking the cap after every step. */
async function drainReads(): Promise<void> {
    for (let guard = 0; guard < 40; guard++) {
        const next = FakeImage.all.find((image) => !image.settled)
        if (!next) {
            return
        }
        next.fire('load')
        await settleReads()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)
    }
    throw new Error('reads never drained')
}

beforeEach(() => {
    resetAndroidTransport(true)
    FakeImage.all = []
    vi.stubGlobal('Image', FakeImage)
    resetAssetUrlGateForTest()
    resetQueuedWholeReadsForTest()
    getCharImageSpy.mockReset()
    getCharImageSpy.mockImplementation(createMirroredGetCharImage(() => false))
})

afterEach(async () => {
    for (const row of [...rows]) {
        await removeRow(row)
    }
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
})

describe('shell message avatars on Android', () => {
    test('(R) T8 four rows with different 20 MiB avatars: at most 64 MiB in flight, all paint in the end, no read is held after unmount', async () => {
        const files = [0, 1, 2, 3].map(bigOf)
        seedSizes(files, 20)
        files.forEach((file, i) => showRow(i, file))
        await settleReads()

        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)
        expect(unsettledSources()).toHaveLength(3)

        await drainReads()
        const painted = domUrls(document.body)
        for (const file of files) {
            expect(painted).toContain(urlOf(file))
        }

        for (const row of [...rows]) {
            await removeRow(row)
        }
        await settleReads()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T8s four rows that share one 20 MiB avatar: each DOM use counts, and at most 64 MiB is in flight', async () => {
        seedSizes([bigOf(0)], 20)
        for (let i = 0; i < 4; i++) {
            showRow(i, bigOf(0))
        }
        await settleReads()

        expect(exposed({ perElement: true })).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)

        await drainReads()
        expect(domUrls(document.body).filter((url) => url === urlOf(bigOf(0)))).toHaveLength(4)
    })

    test('(G) T8u a row removed while its read waits gets no Image, and its hold is given back', async () => {
        const files = [0, 1, 2, 3].map(bigOf)
        seedSizes(files, 20)
        const created = files.map((file, i) => showRow(i, file))
        await settleReads()
        expect(FakeImage.all.length).toBeLessThanOrEqual(3)

        await removeRow(created[3])
        await settleReads()
        await drainReads()
        expect(FakeImage.all.map((image) => image.src)).not.toContain(urlOf(bigOf(3)))
        expect(domUrls(document.body)).not.toContain(urlOf(bigOf(3)))

        for (const row of [...rows]) {
            await removeRow(row)
        }
        await settleReads()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })
})

describe('shell message avatars off Android', () => {
    test('(G) T17 every avatar paints at once with no Image, and getCharImage gets the same two-argument call', async () => {
        resetAndroidTransport(false)
        const files = [0, 1, 2, 3].map(bigOf)
        seedSizes(files, 20)
        files.forEach((file, i) => showRow(i, file))
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        const calls = getCharImageSpy.mock.calls as unknown[][]
        expect(calls).toHaveLength(4)
        expect(calls.every((call) => call.length === 2 && call[1] === 'plain')).toBe(true)
        expect(calls.map((call) => call[0]).sort()).toEqual([...files].sort())
        for (const file of files) {
            expect(domUrls(document.body)).toContain(urlOf(file))
        }
    })
})
