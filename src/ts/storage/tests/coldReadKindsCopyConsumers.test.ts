/**
 * The consumers that read an archived character as a copy
 * (`readColdCharacterCopy`) and only ask whether it could be read:
 * `exportAsDataset` (`../exportAsDataset`).
 *
 * A read that cannot succeed here (no storage on the page) and a read whose
 * copy is damaged reach them as an unreadable copy, exactly as a plain read
 * error does: the character is left out and named in the same neutral notice,
 * the rest of the work goes on, the stub stays in its slot and nothing is
 * marked for save. Only the restore messages tell the causes apart.
 *
 * Every cold-storage read goes through the mocked `readColdStorageItem`, which
 * answers with the read result each test names.
 *
 * Every test here is a guard: these consumers branch on the status of the copy
 * alone, so a no-storage or damaged copy must take the branch a plain read
 * error takes.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const readColdStorageItemMock = vi.hoisted(() => vi.fn())
const downloadFileMock = vi.hoisted(() => vi.fn(async () => true))
const alertNormalMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertToastMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const alertStoreSetMock = vi.hoisted(() => vi.fn())
const markCharacterForSaveMock = vi.hoisted(() => vi.fn())

interface FakeCharacter {
    type?: string
    image?: string
    emotionImages?: Array<[string, string]>
    additionalAssets?: Array<[string, string, string]>
    ccAssets?: Array<{ uri: string }>
}

interface FakeDb {
    customBackground?: string
    characters: FakeCharacter[]
}

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Record<string, unknown> },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: downloadFileMock,
    acquireExclusiveStorageMigrationLock: vi.fn(async () => vi.fn(async () => {})),
    getUncleanablesSync: vi.fn((db: FakeDb, options?: { chars: FakeCharacter[] }) => {
        const found = new Set<string>()
        const add = (path: string | undefined) => { if (path) { found.add(path) } }
        add(db.customBackground)
        for (const cha of options?.chars ?? db.characters) {
            add(cha.image)
            for (const emotion of cha.emotionImages ?? []) { add(emotion[1]) }
        }
        return Array.from(found)
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: alertNormalMock,
    alertError: alertErrorMock,
    alertToast: alertToastMock,
    alertMd: alertMdMock,
    alertConfirm: alertConfirmMock,
    alertWait: vi.fn(),
    alertStore: { set: alertStoreSetMock },
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: vi.fn(),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: markCharacterForSaveMock,
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ setItem: vi.fn(), removeItem: vi.fn() }) },
}))

vi.mock(import('src/ts/platform'), async (importOriginal) => ({
    ...await importOriginal(),
    isTauri: false,
}))

import { exportAsDataset } from 'src/ts/storage/exportAsDataset'
import { buildColdStub } from 'src/ts/process/tests/coldStubFixture'
import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'

//#region fixtures and helpers

type AnyCharacter = Record<string, unknown>

/** Every unreadable read the reader can report, by cause. */
const UNREADABLE_READS = [
    ['no storage on the page', { status: 'error', error: new Error('no storage'), kind: 'unavailable' }],
    ['a damaged copy', { status: 'error', error: new Error('unexpected EOF'), kind: 'damaged' }],
    ['a read error with no cause', { status: 'error', error: new Error('disk unavailable') }],
] as const

function chat(id: string, ...texts: string[]) {
    return { id, name: id, note: '', localLore: [], message: texts.map((data) => ({ role: 'char', data, time: 1 })) }
}

function fullCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): AnyCharacter {
    return { type: 'character', chaId, name, image: '', desc: `${name} description`, chats: [chat(`${chaId}-1`, `${name} text`)], globalLore: [], chatPage: 0, creatorNotes: '', ...extra }
}

function stubOf(source: AnyCharacter, key: string): AnyCharacter {
    return buildColdStub(source as never, key, []) as unknown as AnyCharacter
}

function installDb(characters: AnyCharacter[], extra: Record<string, unknown> = {}): void {
    DBState.db = { characters, ...extra } as never
}

function shownTexts(): string[] {
    return [alertNormalMock, alertErrorMock, alertToastMock, alertMdMock].flatMap((fn) => fn.mock.calls.map((args) => String(args[0])))
}

beforeEach(() => {
    for (const fn of [readColdStorageItemMock, downloadFileMock, alertNormalMock, alertErrorMock, alertToastMock, alertMdMock, alertConfirmMock, alertStoreSetMock, markCharacterForSaveMock]) {
        fn.mockReset()
    }
    downloadFileMock.mockResolvedValue(true)
    alertConfirmMock.mockResolvedValue(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

//#endregion

describe('exportAsDataset with an archived character that cannot be read', () => {
    test.each(UNREADABLE_READS)('%s: the character is skipped and named in the neutral notice, the others are exported, and the stub stays archived', async (_label, answer) => {
        const anna = fullCharacter('a', 'Anna', { chats: [chat('a1', 'a one')] })
        const unitB = fullCharacter('b', 'Bella', { chats: [chat('b1', 'b one')] })
        const stubB = stubOf(unitB, 'unit-b')
        installDb([anna, stubB])
        readColdStorageItemMock.mockResolvedValue(answer)

        await exportAsDataset()

        expect(downloadFileMock).toHaveBeenCalledTimes(1)
        const rows = JSON.parse((downloadFileMock.mock.calls[0] as unknown as [string, Buffer])[1].toString('utf-8')) as Array<{ name: string }>
        expect(rows.map((row) => row.name)).toEqual(['Anna'])
        expect(shownTexts()).toEqual([`${language.exportDownloadStarted}\n\n${language.errors.coldStorageDatasetExportSkipped('Bella')}`])
        expect(DBState.db.characters[1]).toBe(stubB)
        expect(stubB.coldstorage).toBe('unit-b')
        expect(markCharacterForSaveMock).not.toHaveBeenCalled()
    })
})
