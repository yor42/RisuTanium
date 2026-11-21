// @vitest-environment jsdom
/**
 * `StudioAssetMergePreview.svelte`: the keep-name select sits in a wrapping label; the name comes from the inner text span,
 * never from the wrapping label (whose text would include the select's value). REAL: the preview over the real history
 * service on the memory doubles, the preview model producer, the language table and the checker. MOCKED: the stores module
 * and the save-mark counter, as in `StudioAssetMergePreview.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))

const db = $state({ db: { characters: [] as unknown[], modules: [] as unknown[], useAdditionalAssetsPreview: false } })
const selection = $state({ selId: 0 })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
        clearCharEmotionCache: () => {},
    }
})

import { language } from 'src/lang'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { assetRow, DEFAULT_SETTINGS } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { groupDuplicates, type DuplicateGroup } from 'src/ts/studio/assets/duplicateGroups'
import type { MergeSource } from 'src/ts/studio/assets/mergeCommit'
import type { SurvivorDeps } from 'src/ts/studio/edit/assetSetters'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { fieldNameProblems, unnamedControls } from '../../a11yNames.test-helpers'
import type { FinderRow } from './StudioAssetFinder.svelte'
import StudioAssetMergePreview from './StudioAssetMergePreview.svelte'

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const byPathOnly: SurvivorDeps = { hashOf: () => undefined }
const rows = [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png'), assetRow('other', 'assets/o.png')]

const source: MergeSource = {
    targetOwner: () => ({ kind: 'character', source: db.db.characters[0] as never }),
    modules: () => [],
    settings: () => DEFAULT_SETTINGS,
    countChats: () => new Promise(() => {}),
    countCharacters: async () => ({ state: 'done', characters: [], archivedCharacters: 0 }),
    enabledEverywhere: () => false,
    characterName: (id) => id,
}

let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []
let group: DuplicateGroup<FinderRow>

beforeEach(async () => {
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetStudioScreenForTests()
    db.db.characters = [{
        chaId: 'A', type: 'character', desc: 'a {{image::grin}} b', exampleMessage: 'ex', alternateGreetings: [],
        globalLore: [], chats: [{ id: 'c1', note: '' }], chatPage: 0, additionalAssets: rows, emotionImages: [], extentions: {},
    }]
    selection.selId = 0
    studioScreen.chaId = 'A'
    const found = groupDuplicates(rows.map((row, index): FinderRow => ({ name: row[0], path: row[1], index, folder: null })))
        .find((candidate) => candidate.cls === 'sameFileDifferentNames')
    if (!found) throw new Error('no candidate group')
    group = found
})

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
})

async function show(): Promise<HTMLElement> {
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => null,
    })
    await service.whenReady(A)
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({
        host,
        app: mount(StudioAssetMergePreview, {
            target: host,
            props: {
                owner: A, ownerKind: 'character', ownerId: 'A', kind: 'asset', group, deps: byPathOnly, service,
                toasts: { postAssetAction: () => 1 }, source,
                references: (name: string) => (name === 'smile' ? 1 : 0),
                onclose: () => {},
            },
        }),
    })
    flushSync()
    await drainMicrotasks()
    flushSync()
    return host
}

const KNOWN_UNNAMED: string[] = []

describe('StudioAssetMergePreview value-control names', () => {
    test('regression reproducer: the keep-name select is named by its inner text span, not by the wrapping label', async () => {
        const host = await show()
        expect(host.querySelectorAll('[data-part="studio-asset-merge-keep"]').length).toBe(1)
        expect(fieldNameProblems(host, [{ name: language.studioAssetMergeKeep }])).toEqual([])
        expect(unnamedControls(host, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
