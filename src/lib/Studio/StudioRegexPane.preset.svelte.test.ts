// @vitest-environment jsdom
/**
 * The regex pane hosted by a preset over the real history service on the memory doubles, the real preset adapter and the
 * real English `language`: the inactive note, add and delete on an inactive preset's own slot, and the selection keys that
 * follow the pinned preset when its row moves.
 * MOCKED: the page store (DBState is a `$state` object), the save-mark counter and the alert layer.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, saveAsset: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [], modules: [] } as unknown })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        selectedCharID: writable(0),
    }
})

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { resetPresetAckForTests, setPresetAckLoaderForTests } from '../../ts/studio/edit/presetAck.svelte'
import { createSaveAck, type SaveAckDeps } from '../../ts/studio/edit/saveAck.svelte'
import { presetOwnerKey } from '../../ts/studio/edit/presetTarget'
import { presetNamed, seedPresetDb } from '../../ts/studio/edit/tests/presetFixture.test-helpers'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { followStudioPreset, setStudioSelection, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { toastHost } from '../../ts/toast/toastHost.svelte'
import { click, mountInto, part, parts, setupRig, settle, teardownRig } from './StudioLorePane.rig.test-helpers'
import StudioRegexPane from './StudioRegexPane.svelte'

type Row = Record<string, unknown>

const row = (name: string): Row => ({ comment: name, in: `in ${name}`, out: `out ${name}`, type: 'editinput' })

let service: OwnerHistoryService
let ids: string[]

const slotRegex = (index: number): Row[] => (DBState.db.botPresets[index] as unknown as { regex: Row[] }).regex
const working = (): Row[] => DBState.db.presetRegex as unknown as Row[]

// A: active (its working list differs from its slot's). B and C: inactive, each with two rows.
async function start(): Promise<void> {
    ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B'), presetNamed('C', 'c=C')], 0, 'a=A')
    Object.assign(DBState.db.botPresets[0], { regex: [row('slotA0')] })
    Object.assign(DBState.db.botPresets[1], { regex: [row('B0'), row('B1')] })
    Object.assign(DBState.db.botPresets[2], { regex: [row('C0'), row('C1')] })
    DBState.db.presetRegex = [row('A0')] as unknown as typeof DBState.db.presetRegex
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    for (const id of ids) await service.whenReady(presetOwnerKey(id))
}

// Mounted the way StudioDetail mounts it for a preset: the item id is read from the selection at each use.
async function mountPreset(index: number): Promise<HTMLElement> {
    setStudioSelection(`preset:${index}`, 'regex', null)
    const props: Record<string, unknown> = { ownerType: 'preset', presetId: ids[index], ownerId: String(index), chaId: 'A', moduleId: null, moduleSlotIndex: null }
    Object.defineProperty(props, 'itemId', { enumerable: true, get: () => studioScreen.selectedItemId })
    const mounted = mountInto(StudioRegexPane, props)
    await settle()
    return mounted
}

// A fresh ack on its own fake clock for each factory call: the holder disposes the ack it built, so one shared object
// would be dead after the first end.
function freshAck() {
    const clock = createFakeClock()
    const deps: SaveAckDeps = {
        getMarkCount: () => 0,
        getCommittedMarkCount: () => 0,
        afterNextCommit: () => {},
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    return createSaveAck(deps, { kind: 'preset', verdict: () => 'saved' })
}

beforeEach(() => {
    setupRig()
    setPresetAckLoaderForTests(async () => () => freshAck())
})
afterEach(async () => {
    await teardownRig()
    resetPresetAckForTests()
})

describe('U1: the inactive note', () => {
    test('shows on an inactive preset with the English text and is absent on the active one', async () => {
        await start()
        await mountPreset(1)
        expect(part('studio-regex-preset-not-in-chat')?.textContent).toBe(language.studioRegexPresetNotInChat)
        expect(language.studioRegexPresetNotInChat).toBe('This preset is not active, so its regex does not run in this chat.')
        expect(parts('studio-regex-row')).toHaveLength(2)
        await teardownRig()
        setupRig()
        await start()
        await mountPreset(0)
        expect(part('studio-regex-preset-not-in-chat')).toBeNull()
        expect(parts('studio-regex-row')).toHaveLength(1)
    })
})

describe('U2: add and delete on an inactive preset', () => {
    test('Add appends to that slot only, Delete posts the toast, and the save chip is shown', async () => {
        await start()
        await mountPreset(1)
        const workingBefore = JSON.stringify(working())
        const otherBefore = JSON.stringify([slotRegex(0), slotRegex(2)])
        await click(part('studio-regex-add'))
        expect(slotRegex(1)).toHaveLength(3)
        expect(JSON.stringify(working())).toBe(workingBefore)
        expect(JSON.stringify([slotRegex(0), slotRegex(2)])).toBe(otherBefore)
        expect(part('studio-chip')).not.toBeNull()
        // The new row opened its editor; Back to the list is the selection of the list.
        setStudioSelection('preset:1', 'regex', null)
        await settle()
        expect(parts('studio-regex-row')).toHaveLength(3)
        await click(parts('studio-regex-row-menu')[0])
        await click(part('studio-regex-delete'))
        expect(slotRegex(1).map((entry) => entry.comment)).toEqual(['B1', ''])
        expect(toastHost.visible.some((toast) => toast.text.includes('B0'))).toBe(true)
        expect(JSON.stringify(working())).toBe(workingBefore)
    })
})

describe('U4: the selection follows the pinned preset when its row moves', () => {
    test('after a slot above it is removed, selection calls name the new row and never the preset now at the old one', async () => {
        await start()
        await mountPreset(2)
        const pinned = ids[2]
        expect(studioScreen.selectedPresetId).toBe(pinned)
        await click(parts('studio-regex-row')[0])
        expect(studioScreen.selectedItemId).toBe('2/regex:0')
        DBState.db.botPresets.splice(0, 1)
        DBState.db.botPresetsId = 0
        followStudioPreset(1)
        await settle()
        // The open item no longer parses under the new row, so the pane closes to the list for the pinned preset.
        expect(studioScreen.selectedOwnerKey).toBe('preset:1')
        expect(studioScreen.selectedPresetId).toBe(pinned)
        expect(studioScreen.selectedItemId).toBeNull()
        await click(parts('studio-regex-row')[1])
        expect(studioScreen.selectedOwnerKey).toBe('preset:1')
        expect(studioScreen.selectedPresetId).toBe(pinned)
        expect(studioScreen.selectedItemId).toBe('1/regex:1')
    })

    test('a selection that is not a preset key makes the pane select nothing', async () => {
        await start()
        await mountPreset(1)
        studioScreen.selectedOwnerKey = 'character:A'
        studioScreen.selectedPresetId = null
        studioScreen.selectedKind = 'regex'
        studioScreen.selectedItemId = null
        await settle()
        await click(parts('studio-regex-row')[0])
        expect(studioScreen.selectedOwnerKey).toBe('character:A')
        expect(studioScreen.selectedItemId).toBeNull()
    })
})
