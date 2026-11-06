/**
 * `exportAsDataset` (`src/ts/storage/exportAsDataset.ts`) with archived
 * characters: a placeholder (the "stub") in `DBState.db.characters` whose
 * description, chats and lorebook live in a cold-storage unit; the stub's own
 * `desc`, `chats` and `globalLore` are not data.
 *
 * Invariants exercised here:
 * - A stub's rows come from a copy of its unit, never from the placeholder
 *   fields; an archived group yields no rows, including one whose placeholder
 *   is typed as a character, and is never reported as a character that could
 *   not be loaded.
 * - A unit that cannot be read is skipped without aborting the export, and the
 *   notice at the end names each skipped character.
 * - Units are read one at a time, the stub stays a stub in the character list
 *   and nothing is marked for save.
 * - With no stubs the output and the notice are the ones an export without
 *   archived characters always produced.
 *
 * Every cold-storage read goes through the mocked `readColdStorageItem`; the
 * download is a mock that captures the file.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const readColdStorageItemMock = vi.hoisted(() => vi.fn())
const downloadFileMock = vi.hoisted(() => vi.fn(async () => true))
const alertNormalMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertToastMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertStoreSetMock = vi.hoisted(() => vi.fn())
const markCharacterForSaveMock = vi.hoisted(() => vi.fn())

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
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: alertNormalMock,
    alertError: alertErrorMock,
    alertToast: alertToastMock,
    alertMd: alertMdMock,
    alertWait: vi.fn(),
    alertStore: { set: alertStoreSetMock },
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: markCharacterForSaveMock,
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock(import('src/ts/platform'), async (importOriginal) => ({
    ...await importOriginal(),
    isTauri: false,
}))

import { exportAsDataset } from 'src/ts/storage/exportAsDataset'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'

//#region fixtures and helpers

interface Row {
    name: string
    description?: string
    chats: Array<{ role: string, data: string }>
    lorebook: unknown[]
}

type AnyCharacter = Record<string, unknown>

function chat(id: string, ...texts: string[]) {
    return { id, name: id, note: '', localLore: [], message: texts.map((data) => ({ role: 'char', data, time: 1 })) }
}

function fullCharacter(chaId: string, name: string, description: string, chats: ReturnType<typeof chat>[], lore: unknown[] = []): AnyCharacter {
    return { type: 'character', chaId, name, image: '', desc: description, chats, globalLore: lore, chatPage: 0, creatorNotes: '' }
}

function stubOf(source: AnyCharacter, key: string): AnyCharacter {
    return buildColdStub(source as never, key, []) as unknown as AnyCharacter
}

function ok(character: AnyCharacter) {
    return { status: 'ok', value: { character } }
}

function installDb(characters: AnyCharacter[]): void {
    DBState.db = { characters } as never
}

function exportedRows(): Row[] {
    expect(downloadFileMock).toHaveBeenCalledTimes(1)
    const calls = downloadFileMock.mock.calls as unknown as Array<[string, Buffer]>
    expect(calls[0][0]).toBe('dataset.json')
    return JSON.parse(calls[0][1].toString('utf-8')) as Row[]
}

/** The text of every notice the user would have been shown, whichever alert function showed it. */
function shownTexts(): string[] {
    return [alertNormalMock, alertErrorMock, alertToastMock, alertMdMock].flatMap((fn) => fn.mock.calls.map((args) => String(args[0])))
}

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
    for (const fn of [readColdStorageItemMock, downloadFileMock, alertNormalMock, alertErrorMock, alertToastMock, alertMdMock, alertStoreSetMock, markCharacterForSaveMock]) {
        fn.mockReset()
    }
    downloadFileMock.mockResolvedValue(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

//#endregion

describe('exportAsDataset with archived characters', () => {
    test('rows of an archived character come from its unit, and an archived group yields none', async () => {
        const characterA = fullCharacter('a', 'Anna', 'A description', [chat('a1', 'a one'), chat('a2', 'a two')])
        const unitB = fullCharacter('b', 'Bella', 'B description from the unit', [chat('b1', 'b one'), chat('b2', 'b two')], [{ key: 'k', content: 'B lore' }])
        const groupG = { type: 'group', chaId: 'g', name: 'Group G', image: '', chats: [chat('g1', 'group text')], characters: ['a', 'b'] }
        installDb([characterA, stubOf(unitB, 'unit-b'), stubOf(groupG, 'unit-g')])
        readColdStorageItemMock.mockImplementation(async (key: string) => (key === 'unit-b' ? ok(unitB) : { status: 'missing' }))

        await exportAsDataset()

        const rows = exportedRows()
        expect(rows).toHaveLength(4)
        expect(rows.slice(0, 2).map((r) => r.name)).toEqual(['Anna', 'Anna'])
        expect(rows.slice(2).map((r) => r.name)).toEqual(['Bella', 'Bella'])
        expect(rows.slice(2).map((r) => r.description)).toEqual(['B description from the unit', 'B description from the unit'])
        expect(rows.slice(2).map((r) => r.chats.map((m) => m.data))).toEqual([['b one'], ['b two']])
        expect(rows.slice(2).map((r) => r.lorebook)).toEqual([[{ key: 'k', content: 'B lore' }], [{ key: 'k', content: 'B lore' }]])
        expect(rows.some((r) => r.name === 'Group G')).toBe(false)
        expect(readColdStorageItemMock).not.toHaveBeenCalledWith('unit-g')
    })

    test('a placeholder typed as a character whose readable unit holds a group yields no rows, is read at most once, and is not named in the end notice', async () => {
        const characterA = fullCharacter('a', 'Anna', 'A description', [chat('a1', 'a one')])
        // The shape another build of the app writes for an archived group: typed
        // as a character, with no `characters` list and no `coldVersion`.
        const placeholderG = { type: 'character', chaId: 'g', name: 'Guild', image: '', coldstorage: 'unit-g', lastInteraction: 1, chats: [], globalLore: [] }
        const unitG = { type: 'group', chaId: 'g', name: 'Guild', image: '', chats: [chat('g1', 'group text')], characters: ['a'] }
        installDb([characterA, placeholderG])
        readColdStorageItemMock.mockResolvedValue(ok(unitG))

        await exportAsDataset()

        expect(exportedRows().map((r) => r.name)).toEqual(['Anna'])
        expect(readColdStorageItemMock.mock.calls.length).toBeLessThanOrEqual(1)
        expect(shownTexts().some((text) => text.includes('Guild'))).toBe(false)
        expect(shownTexts()).toEqual([language.exportDownloadStarted])
    })

    test('an unreadable unit gives no rows, does not stop the export, and the end notice names the character', async () => {
        const characterA = fullCharacter('a', 'Anna', 'A description', [chat('a1', 'a one')])
        const unitC = fullCharacter('c', 'Cora', 'C description', [chat('c1', 'c one')])
        installDb([characterA, stubOf(unitC, 'unit-c')])
        readColdStorageItemMock.mockResolvedValue({ status: 'missing' })

        await exportAsDataset()

        const rows = exportedRows()
        expect(rows.map((r) => r.name)).toEqual(['Anna'])
        expect(shownTexts().some((text) => text.includes('Cora'))).toBe(true)
    })

    test('a read error gives no rows, does not stop the export, and the end notice names the character', async () => {
        const characterA = fullCharacter('a', 'Anna', 'A description', [chat('a1', 'a one')])
        const unitC = fullCharacter('c', 'Cora', 'C description', [chat('c1', 'c one')])
        installDb([characterA, stubOf(unitC, 'unit-c')])
        readColdStorageItemMock.mockResolvedValue({ status: 'error', error: new Error('disk unavailable') })

        await exportAsDataset()

        expect(exportedRows().map((r) => r.name)).toEqual(['Anna'])
        expect(shownTexts().some((text) => text.includes('Cora'))).toBe(true)
    })

    test('units are read one at a time, the archived characters stay archived, and nothing is marked for save', async () => {
        const unitB = fullCharacter('b', 'Bella', 'B description', [chat('b1', 'b one')])
        const unitD = fullCharacter('d', 'Dora', 'D description', [chat('d1', 'd one')])
        const stubB = stubOf(unitB, 'unit-b')
        const stubD = stubOf(unitD, 'unit-d')
        installDb([stubB, fullCharacter('a', 'Anna', 'A description', [chat('a1', 'a one')]), stubD])
        let inFlight = 0
        let maxInFlight = 0
        readColdStorageItemMock.mockImplementation(async (key: string) => {
            inFlight++
            maxInFlight = Math.max(maxInFlight, inFlight)
            await tick()
            inFlight--
            return ok(key === 'unit-b' ? unitB : unitD)
        })

        await exportAsDataset()

        expect(readColdStorageItemMock).toHaveBeenCalledTimes(2)
        expect(maxInFlight).toBe(1)
        expect(DBState.db.characters[0]).toBe(stubB)
        expect(DBState.db.characters[2]).toBe(stubD)
        expect((stubB as { coldstorage?: unknown }).coldstorage).toBe('unit-b')
        expect((stubD as { coldstorage?: unknown }).coldstorage).toBe('unit-d')
        expect(markCharacterForSaveMock).not.toHaveBeenCalled()
        expect(exportedRows().map((r) => r.name)).toEqual(['Bella', 'Anna', 'Dora'])
    })

    test('guard: with no archived characters the output is one row per chat and the notice is the plain success text', async () => {
        installDb([
            fullCharacter('a', 'Anna', 'A description', [chat('a1', 'a one'), chat('a2', 'a two')], [{ key: 'k', content: 'A lore' }]),
            { type: 'group', chaId: 'g', name: 'Group G', chats: [chat('g1', 'group text')], characters: ['a'] },
        ])

        await exportAsDataset()

        expect(exportedRows()).toEqual([
            { name: 'Anna', description: 'A description', chats: [{ role: 'char', data: 'a one', time: 1 }], lorebook: [{ key: 'k', content: 'A lore' }] },
            { name: 'Anna', description: 'A description', chats: [{ role: 'char', data: 'a two', time: 1 }], lorebook: [{ key: 'k', content: 'A lore' }] },
        ])
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(alertNormalMock).toHaveBeenCalledTimes(1)
        expect(alertNormalMock).toHaveBeenCalledWith(language.exportDownloadStarted)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(shownTexts()).toEqual([language.exportDownloadStarted])
    })
})
