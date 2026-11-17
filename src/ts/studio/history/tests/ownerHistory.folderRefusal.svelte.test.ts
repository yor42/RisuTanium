// @vitest-environment jsdom
/**
 * A folder action the folder rules refuse comes back with the rule that refused it, so the list can say which. The
 * refusal stays `precondition`; the folder rule rides beside it and a landed or unchanged action carries none.
 * Regression reproducers: before the service forwarded the rule, each refusal was a bare `precondition`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { ASSET_FOLDER_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function setCharacter(folders: unknown): void {
    DBState.db.characters = [
        {
            chaId: 'A',
            desc: '',
            alternateGreetings: [],
            chats: [{ id: 'c1', note: '' }],
            chatPage: 0,
            additionalAssets: [['smile', 'assets/smile.png', 'png'], ['grin', 'assets/grin.png', 'png']],
            emotionImages: [],
            extentions: folders === undefined ? {} : { [ASSET_FOLDER_KEY]: folders },
        },
    ] as unknown as typeof DBState.db.characters
}

let service: OwnerHistoryService

async function start(folders: unknown): Promise<void> {
    setCharacter(folders)
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
}

const listed = { v: 1, additional: { order: ['Poses', 'Props'], of: [['smile', 'Poses']] } }

function refusalOf(result: StudioResult): string | undefined {
    expect(result.ok).toBe(false)
    return result.ok === false ? result.folderRefusal : undefined
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('a refused folder action', () => {
    test.each([
        ['an empty name', () => service.assetFolder(A, { kind: 'create', name: '   ' }), 'emptyName'],
        ['the reserved name, in any case', () => service.assetFolder(A, { kind: 'create', name: 'NO FOLDER' }), 'noFolderName'],
        ['a name another folder has, ignoring case', () => service.assetFolder(A, { kind: 'rename', from: 'Props', to: ' poses ' }), 'nameTaken'],
        ['a folder that is not listed', () => service.assetFolder(A, { kind: 'delete', name: 'Gone' }), 'unknownFolder'],
        ['a move to a folder that is not listed', () => service.assetFolder(A, { kind: 'move', names: ['grin'], folder: 'Gone' }), 'unknownFolder'],
    ] as const)('names the rule that refused %s and stays a precondition refusal', async (_label, act, rule) => {
        await start(listed)
        const result = act()
        expect(refusalOf(result)).toBe(rule)
        expect(result.ok === false && result.reason).toBe('precondition')
        // Nothing was written or recorded.
        expect(service.view(A).done).toHaveLength(0)
        expect((DBState.db.characters[0] as unknown as { extentions: Record<string, unknown> }).extentions[ASSET_FOLDER_KEY]).toEqual(listed)
    })

    test.each([
        ['create', () => service.assetFolder(A, { kind: 'create', name: 'New' })],
        ['rename', () => service.assetFolder(A, { kind: 'rename', from: 'Poses', to: 'Stances' })],
        ['delete', () => service.assetFolder(A, { kind: 'delete', name: 'Poses' })],
        ['move', () => service.assetFolder(A, { kind: 'move', names: ['grin'], folder: null })],
    ] as const)('a folder list from a newer version refuses %s with the newer-version rule and keeps the list byte for byte', async (_label, act) => {
        const newer = { v: 2, additional: { order: ['Poses'], of: [] }, future: true }
        await start(newer)
        expect(refusalOf(act())).toBe('newerVersion')
        expect(service.view(A).done).toHaveLength(0)
        expect((DBState.db.characters[0] as unknown as { extentions: Record<string, unknown> }).extentions[ASSET_FOLDER_KEY]).toEqual(newer)
    })

    test('a row delete still lands under a list from a newer version', async () => {
        await start({ v: 2, additional: { order: [], of: [] } })
        const result = service.assetDelete(A, 'additionalAssets', [0])
        expect(result.ok).toBe(true)
        expect(DBState.db.characters[0].additionalAssets).toHaveLength(1)
    })
})

describe('a folder action that is not refused', () => {
    test('a move into the folder the name is already in lands nothing and carries no rule', async () => {
        await start(listed)
        const result = service.assetFolder(A, { kind: 'move', names: ['smile'], folder: 'Poses' })
        expect(result).toEqual({ ok: true, unchanged: true })
        expect(service.view(A).done).toHaveLength(0)
    })

    test('a landed action carries no rule and has its step', async () => {
        await start(listed)
        const result = service.assetFolder(A, { kind: 'delete', name: 'Poses' })
        expect(result.ok).toBe(true)
        expect(result).not.toHaveProperty('folderRefusal')
        expect(service.view(A).done.map((step) => step.label)).toEqual([{ kind: 'folderDelete', name: 'Poses' }])
    })
})
