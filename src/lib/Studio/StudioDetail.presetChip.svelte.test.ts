// @vitest-environment jsdom
/**
 * The save chip of a preset's toggle builder under the real Studio screen, with the real write hook, the real marks and
 * the production ack holder, ack and commit verdict (the lazily imported save ack machine runs unmocked). Only the save
 * loop's observation surface (`globalApi.svelte`) is a controllable seam: a mark counts when the installed schedule is
 * called, a commit is fired by the test, and the unsavable items and the stop signal are switchable.
 *
 * Labels: regression reproducers R1-R5 and R2b. Before the change the preset builder renders no chip, so each fails on
 * the chip assertion itself. Only exports that exist before the change are imported here; the holder's reset is reached
 * through a glob that is empty before the change, so the file loads there too. Mocked loop: not native evidence.
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
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
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
import { makeCharacter, makeInput, makePreset, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { syncFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'
import { resetToggleCarrySessionForTests } from '../../ts/studio/toggleCarryPending'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import { DBState } from 'src/ts/stores.svelte'
import StudioScreen from './StudioScreen.svelte'

// Empty before the change (the holder does not exist), so no literal import of a missing file is needed.
const holderModules = import.meta.glob<{ resetPresetAckForTests?: () => void }>('../../ts/studio/edit/presetAck.svelte.ts', { eager: true })

const db = DBState as unknown as { db: ReturnType<typeof fixtureDb> }
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function fixtureDb() {
    const input = makeInput({
        character: makeCharacter({ chaId: 'A', name: 'Secret Name', customModuleToggle: 'ch=Char' } as Parameters<typeof makeCharacter>[0]),
        presets: [makePreset('P0', { toggles: 'a=Zero\n' }), makePreset('P1', { toggles: 'b=One\n' }), makePreset('P2', { toggles: 'c=Two\n' })],
        activePreset: 0,
    })
    const base = studioDbOf(input)
    const built = {
        ...base,
        botPresets: base.botPresets as ((typeof base.botPresets)[number] & { id?: string })[],
        globalChatVariables: { toggle_a: '1' },
        NAIsettings: {},
        mainPrompt: '',
        apiType: 'working-api',
    }
    assignPresetIds(built as unknown as Parameters<typeof assignPresetIds>[0])
    return built
}

const presetToggles = (index: number) => ({ owner: { type: 'preset', id: String(index) }, kind: 'toggles', from: 'chat' }) as const

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

function mountInto(component: Parameters<typeof mount>[0]): void {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(component, { target: host, props: {} })
    mounted.push({ app, host })
    flushSync()
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

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect(): void {}
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const chipText = () => part('studio-chip-text')?.textContent ?? null

// Mounts the toggle builder of the preset at `index`, lets the lazily imported ack arrive, and shows the text view.
async function mountOn(index: number): Promise<void> {
    makeRig()
    openStudio(presetToggles(index), null)
    mountInto(StudioScreen)
    await settle()
    await vi.dynamicImportSettled()
    await settle()
    part('studio-toggle-view-text')?.click()
    await settle()
}

function typeInText(value: string): void {
    const area = part('studio-toggle-textarea') as HTMLTextAreaElement
    area.value = value
    area.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
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

function stopSaving(): void {
    seam.stopFlag = true
    for (const callback of [...seam.stopped]) {
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
    for (const loaded of Object.values(holderModules)) {
        loaded.resetPresetAckForTests?.()
    }
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

describe('the save chip of a preset toggle edit', () => {
    test('R1 the preset toggle builder carries a save chip', async () => {
        await mountOn(1)
        expect(part('studio-toggle-builder')).not.toBeNull()
        expect(part('studio-chip')).not.toBeNull()
    })

    test('R2 an edit of an inactive preset reads Saved after a covering commit, and not before', async () => {
        await mountOn(1)
        typeInText('b=One\nz=Z')
        await settle()
        expect(db.db.botPresets[1].customPromptTemplateToggle).toBe('b=One\nz=Z')
        expect(chipText()).not.toBe('studioChipSaved')
        commit()
        expect(chipText()).toBe('studioChipSaved')
    })

    test('R2b an edit of the active preset, which lands in the working setting, reads Saved after a covering commit', async () => {
        await mountOn(0)
        typeInText('a=Zero\nz=Z')
        await settle()
        expect(db.db.customPromptTemplateToggle).toBe('a=Zero\nz=Z')
        commit()
        expect(chipText()).toBe('studioChipSaved')
    })

    test('R3 a carried preset list reads Save not confirmed, never Saved', async () => {
        await mountOn(1)
        seam.unsavable.add('presets:presets')
        typeInText('b=One\nz=Z')
        await settle()
        commit()
        expect(chipText()).toBe('studioChipUnconfirmed')
        expect(chipText()).not.toBe('studioChipSaved')
    })

    test('R4 a stopped save loop reads Not saved', async () => {
        await mountOn(0)
        typeInText('a=Zero\nz=Z')
        await settle()
        stopSaving()
        expect(chipText()).toBe('studioChipFailed')
    })

    test('R5 an edit whose mark was not counted reads Not saved at once', async () => {
        await mountOn(1)
        installCharacterSaveMarks({ tracker, schedule: () => {} })
        typeInText('b=One\nz=Z')
        await settle()
        expect(seam.marks).toBe(0)
        expect(chipText()).toBe('studioChipFailed')
    })
})
