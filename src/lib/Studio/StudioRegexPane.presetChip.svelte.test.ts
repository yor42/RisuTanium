// @vitest-environment jsdom
/**
 * The save chip of a preset's regex pane under the real Studio screen, with the real write hook, the real marks and the
 * production ack holder, ack and commit verdict (the lazily imported save ack machine runs unmocked). Only the save
 * loop's observation surface (`globalApi.svelte`) is a controllable seam: a mark counts when the installed schedule is
 * called, a commit is fired by the test, and the unsavable items are switchable.
 *
 * Labels: P1-P5 and P8 are regression reproducers (before the change the preset regex pane renders no chip and begins no
 * ack). P7 is a regression reproducer for the holder rule: the toggle builder's end must leave a joined regex pane's ack
 * alone. P6 is a compatibility guard (it passes where no pane ack exists) that binds the pane's end on destroy.
 * Mocked loop: not native evidence.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

// The seam's state is hoisted: the mock factories run before this file's own consts exist.
const seam = vi.hoisted(() => ({
    marks: 0,
    committed: 0,
    callbacks: new Set<() => void>(),
    unsavable: new Set<string>(),
    stopped: new Set<() => void>(),
    stopFlag: false,
}))

vi.mock('src/ts/globalApi.svelte', () => {
    const saving = $state({ state: false })
    return {
        getSaveMarkCount: () => seam.marks,
        getCommittedSaveMarkCount: () => seam.committed,
        afterNextSaveCommit: (callback: () => void) => { seam.callbacks.add(callback) },
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        isCharacterUnsavable: () => false,
        isItemUnsavable: (scope: string, key: string) => seam.unsavable.has(`${scope}:${key}`),
        isSavingStopped: () => seam.stopFlag,
        onSavingStopped: (callback: () => void) => {
            seam.stopped.add(callback)
            return () => { seam.stopped.delete(callback) }
        },
        moduleCommitVerdict: () => 'saved',
        saving,
        getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
        readImage: () => Promise.resolve(undefined),
        saveAsset: vi.fn(),
        downloadFile: vi.fn(),
        aiWatermarkingLawApplies: () => false,
    }
})
vi.mock('src/ts/studio/assets/assetFileState', () => ({
    openAssetFileReader: async () => ({ concurrency: 1, stateOf: async () => 'present' }),
}))

// Plain hoisted objects: the real `changeToPreset` import chain reads the stores while this file's own consts are still unset.
const selection = vi.hoisted(() => ({ selId: 0 }))
const quickSettings = vi.hoisted(() => ({ open: true }))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as unknown })
    const stores = {
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        sideBarStore: writable(false),
        frozenSaveKeysStore: writable([]),
        selectedCharID: writable(0),
        clearCharEmotionCache: vi.fn(),
    }
    return {
        ...stores,
        DBState: state,
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/process/modules', () => ({ refreshModules: vi.fn(), getModules: () => [], getModuleToggles: () => '', getModuleAssets: () => [] }))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: vi.fn() }))
vi.mock('src/ts/process/moduleRefList', () => ({
    moduleRefIdsOf: () => [],
    moduleListOf: () => [],
}))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertMd: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const named: Record<string, unknown> = { sidebarUi: { notAllowed: 'notAllowed', noAssets: 'noAssets' } }
    return { language: new Proxy(named, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import { assignPresetIds } from 'src/ts/storage/presetMeta'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { makeCharacter, makeInput, makePreset, regexBody, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { currentPresetAck, resetPresetAckForTests } from '../../ts/studio/edit/presetAck.svelte'
import { createOwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { syncFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'
import { resetToggleCarrySessionForTests } from '../../ts/studio/toggleCarryPending'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import { DBState } from 'src/ts/stores.svelte'
import StudioRegexPane from './StudioRegexPane.svelte'
import StudioScreen from './StudioScreen.svelte'

const db = DBState as unknown as { db: ReturnType<typeof fixtureDb> }
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function fixtureDb() {
    const input = makeInput({
        character: makeCharacter({ chaId: 'A', name: 'Secret Name', customModuleToggle: 'ch=Char' } as Parameters<typeof makeCharacter>[0]),
        presets: [
            makePreset('P0', { toggles: 'a=Zero\n' }),
            makePreset('P1', { toggles: 'b=One\n', regex: [regexBody('slot1', 'IN1', 'OUT1')] }),
            makePreset('P2', { toggles: 'c=Two\n' }),
        ],
        activePreset: 0,
    })
    const base = studioDbOf(input)
    const built = {
        ...base,
        botPresets: base.botPresets as ((typeof base.botPresets)[number] & { id?: string })[],
        presetRegex: [regexBody('working0', 'WIN', 'WOUT')] as unknown[],
        globalChatVariables: { toggle_a: '1' },
        NAIsettings: {},
        mainPrompt: '',
        apiType: 'working-api',
    }
    assignPresetIds(built as unknown as Parameters<typeof assignPresetIds>[0])
    return built
}

const presetKind = (index: number, kind: 'toggles' | 'regex') => ({ owner: { type: 'preset', id: String(index) }, kind, from: 'chat' }) as const
const presetIdOf = (index: number): string => db.db.botPresets[index].id ?? ''
const slotRegex = (index: number): unknown[] => (db.db.botPresets[index] as unknown as { regex: unknown[] }).regex

let rigCount = 0

function makeRig(): void {
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: `p${++rigCount}`,
        registerLeaveFlush: () => () => {},
        getMarkCount: () => seam.marks,
    })
    setStudioHistoryServiceForTests(service)
}

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(component, { target: host, props })
    mounted.push({ app, host })
    flushSync()
    return host
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

// Lets the lazily imported ack arrive and render.
async function settleImport(): Promise<void> {
    await settle()
    await vi.dynamicImportSettled()
    await settle()
}

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve(): void {}
    disconnect(): void {}
}

const part = (name: string, root: ParentNode = document) => root.querySelector<HTMLElement>(`[data-part="${name}"]`)
const chipText = (root: ParentNode = document) => part('studio-chip-text', root)?.textContent ?? null

// Opens Studio on the preset at `index` in the given kind and lets its first ack arrive.
async function mountOn(index: number, kind: 'toggles' | 'regex'): Promise<void> {
    makeRig()
    openStudio(presetKind(index, kind), null)
    mountInto(StudioScreen)
    await settleImport()
}

// Mounted the way StudioDetail mounts a preset pane, in a host of its own.
async function mountStandalonePane(index: number): Promise<HTMLElement> {
    const props: Record<string, unknown> = { ownerType: 'preset', presetId: presetIdOf(index), ownerId: String(index), chaId: 'A', moduleId: null, moduleSlotIndex: null }
    Object.defineProperty(props, 'itemId', { enumerable: true, get: () => studioScreen.selectedItemId })
    const host = mountInto(StudioRegexPane, props)
    await settleImport()
    return host
}

async function addRegex(): Promise<void> {
    part('studio-regex-add')?.click()
    await settle()
}

// A commit whose snapshot covers every mark so far.
function commit(): void {
    seam.committed = seam.marks
    for (const callback of [...seam.callbacks]) {
        seam.callbacks.delete(callback)
        callback()
    }
    flushSync()
}

function countMarks(): void {
    installCharacterSaveMarks({ tracker, schedule: () => { seam.marks += 1 } })
}

beforeAll(async () => {
    await import('./StudioTogglePreview.svelte')
}, 120_000)

beforeEach(() => {
    seam.marks = 0
    seam.committed = 0
    seam.callbacks.clear()
    seam.unsavable.clear()
    seam.stopped.clear()
    seam.stopFlag = false
    tracker.character.length = 0
    tracker.botPreset = false
    resetCharacterSaveMarksForTest()
    countMarks()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetOpenModuleIdForTests()
    db.db = fixtureDb()
    installDbWriteHook(db, { selectedChaId: () => 'A' })
    selection.selId = 0
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests({ peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true } satisfies AssetSizeJob)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(async () => {
    await unmountAll()
    resetPresetAckForTests()
    uninstallDbWriteHook()
    localStorage.clear()
    resetToggleCarrySessionForTests()
    syncFavourites()
    setSessionAssetSizeJobForTests(undefined)
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetOpenModuleIdForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.unstubAllGlobals()
})

describe('the save chip of a preset regex edit', () => {
    test('P1 the preset regex pane carries a save chip, for the active and for an inactive preset', async () => {
        await mountOn(0, 'regex')
        expect(part('studio-regex-pane')).not.toBeNull()
        expect(part('studio-chip')).not.toBeNull()
        await unmountAll()
        resetPresetAckForTests()
        resetStudioScreenForTests()
        await mountOn(1, 'regex')
        expect(part('studio-regex-pane')).not.toBeNull()
        expect(part('studio-chip')).not.toBeNull()
    })

    test('P2 an add on the active preset lands in the working list and reads Saved after a covering commit, not before', async () => {
        await mountOn(0, 'regex')
        const before = db.db.presetRegex.length
        await addRegex()
        expect(db.db.presetRegex.length).toBe(before + 1)
        expect(chipText()).not.toBe('studioChipSaved')
        commit()
        expect(chipText()).toBe('studioChipSaved')
    })

    test('P3 an add on an inactive preset lands in its slot and reads Saved after a covering commit, not before', async () => {
        await mountOn(1, 'regex')
        const workingBefore = db.db.presetRegex.length
        const before = slotRegex(1).length
        await addRegex()
        expect(slotRegex(1).length).toBe(before + 1)
        expect(db.db.presetRegex.length).toBe(workingBefore)
        expect(chipText()).not.toBe('studioChipSaved')
        commit()
        expect(chipText()).toBe('studioChipSaved')
    })

    test('P4 a working regex list that cannot be encoded reads Not saved with no Retry, never Saved', async () => {
        await mountOn(0, 'regex')
        seam.unsavable.add('settings:presetRegex')
        await addRegex()
        commit()
        expect(chipText()).toBe('studioChipFailed')
        expect(chipText()).not.toBe('studioChipSaved')
        expect(part('studio-chip-retry')).toBeNull()
    })

    test('P5 a carried preset list on an inactive edit reads Save not confirmed with Retry', async () => {
        await mountOn(1, 'regex')
        seam.unsavable.add('presets:presets')
        await addRegex()
        commit()
        expect(chipText()).toBe('studioChipUnconfirmed')
        expect(part('studio-chip-retry')).not.toBeNull()
    })

    test('P6 leaving the regex kind ends the pane ack', async () => {
        await mountOn(0, 'regex')
        const id = presetIdOf(0)
        await addRegex()
        expect(currentPresetAck(id)).not.toBeNull()
        setStudioSelection('character:A', 'toggles', null)
        await settleImport()
        expect(part('studio-regex-pane')).toBeNull()
        expect(currentPresetAck(id)).toBeNull()
    })

    test('P7 the toggle builder ending late leaves the ack a joined regex pane holds', async () => {
        await mountOn(0, 'toggles')
        const id = presetIdOf(0)
        const a0 = currentPresetAck(id)
        expect(a0).not.toBeNull()
        const dispose = vi.spyOn(a0!, 'dispose')
        const paneHost = await mountStandalonePane(0)
        // The pane joined the builder's ack: one ack, not a replacement.
        expect(currentPresetAck(id)).toBe(a0)
        // The builder is destroyed by leaving to a character kind that begins no preset ack.
        setStudioSelection('character:A', 'toggles', null)
        await settleImport()
        expect(currentPresetAck(id)).toBe(a0)
        expect(dispose).not.toHaveBeenCalled()
        // The pane's chip shows that ack's state after an edit and a covering commit.
        seam.marks += 1
        a0!.noteEdit(id, seam.marks - 1)
        flushSync()
        expect(chipText(paneHost)).not.toBe('studioChipSaved')
        commit()
        expect(chipText(paneHost)).toBe('studioChipSaved')
    })

    test('P8 toggles to regex of the same preset in one visit leaves a live pane ack whose edit reads Saved after commit', async () => {
        await mountOn(0, 'toggles')
        const id = presetIdOf(0)
        setStudioSelection('preset:0', 'regex', null)
        await settleImport()
        expect(part('studio-regex-pane')).not.toBeNull()
        expect(currentPresetAck(id)).not.toBeNull()
        await addRegex()
        commit()
        expect(chipText()).toBe('studioChipSaved')
    })
})
