// @vitest-environment jsdom
/**
 * The toggle builder of a bot preset under the real Studio screen, with the real history service on the memory doubles,
 * the real write hook, the real chat panel sources and the real `changeToPreset`. A preset's selection is pinned to its
 * id: the builder, the history owner and the star source follow the preset through a reorder and a switch, and a preset
 * that vanished clears the selection with its own notice.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => 0,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
    readImage: () => Promise.resolve(undefined),
    saveAsset: vi.fn(),
    downloadFile: vi.fn(),
    aiWatermarkingLawApplies: () => false,
}))
vi.mock('src/ts/studio/assets/assetFileState', () => ({
    openAssetFileReader: async () => ({ concurrency: 1, stateOf: async () => 'present' }),
}))

// Plain hoisted objects: the real `changeToPreset` import chain reads the stores while this file's own consts are still unset.
const selection = vi.hoisted(() => ({ selId: 0 }))
const quickSettings = vi.hoisted(() => ({ open: true }))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    // Built inside the factory: the real `changeToPreset` import chain reads the stores before this file's own consts exist.
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
import { changeToPreset } from 'src/ts/storage/database.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import { assignPresetIds } from 'src/ts/storage/presetMeta'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { presetOwnerKey } from 'src/ts/studio/edit/presetTarget'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { makeCharacter, makeInput, makePreset, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, selectedHistoryOwner, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { toastHost, resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { currentFavourites, syncFavourites, updateFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'
import { resetToggleCarrySessionForTests } from '../../ts/studio/toggleCarryPending'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import { DBState } from 'src/ts/stores.svelte'
import StudioScreen from './StudioScreen.svelte'

// Filled by `beforeEach`; the mock's reactive root, typed as the fixture.
const db = DBState as unknown as { db: ReturnType<typeof fixtureDb> }

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function fixtureDb(license?: 'private') {
    const input = makeInput({
        character: makeCharacter({ chaId: 'A', name: 'Secret Name', customModuleToggle: 'ch=Char', ...(license ? { license } : {}) } as Parameters<typeof makeCharacter>[0]),
        presets: [makePreset('P0', { toggles: 'a=Zero\n' }), makePreset('P1', { toggles: 'b=One\n' }), makePreset('P2', { toggles: 'c=Two\n' })],
        activePreset: 0,
    })
    const base = studioDbOf(input)
    // The working-setting fields `setPreset` reads on a switch; every preset carries the id the product mints at load.
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

function makeAck(clock: FakeClock): SaveAck {
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
    return createSaveAck(deps)
}

let rigCount = 0

function makeRig(): OwnerHistoryService {
    const clock = createFakeClock()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: `p${++rigCount}`,
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return service
}

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0]): HTMLElement {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(component, { target: host, props: {} })
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

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect(): void {}
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const slot = (index: number) => db.db.botPresets[index].customPromptTemplateToggle
const working = () => db.db.customPromptTemplateToggle
const idOf = (index: number) => db.db.botPresets[index].id as string

async function mountOn(target: Parameters<typeof openStudio>[0]): Promise<OwnerHistoryService> {
    const service = makeRig()
    openStudio(target, null)
    mountInto(StudioScreen)
    await settle()
    return service
}

async function showText(): Promise<void> {
    part('studio-toggle-view-text')?.click()
    await settle()
}

function typeInText(value: string): void {
    const area = part('studio-toggle-textarea') as HTMLTextAreaElement
    area.value = value
    area.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

async function openSheet(): Promise<void> {
    part('studio-toggle-preview-eye')?.click()
    flushSync()
    await vi.waitFor(() => expect(part('studio-toggle-preview')).not.toBeNull())
    await settle()
}

async function showAll(): Promise<void> {
    part('studio-tg-preview-scope-all')?.click()
    flushSync()
    await settle()
}

// The builder loads the sheet on the first opening; its first load transforms the chat panel's whole import chain.
beforeAll(async () => {
    await import('./StudioTogglePreview.svelte')
}, 120_000)

beforeEach(() => {
    tracker.character.length = 0
    tracker.botPreset = false
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
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

describe('T5 the builder of a preset', () => {
    test('an inactive preset mounts the builder with no chip and the page-only banner at mount; an edit lands in its slot only', async () => {
        await mountOn(presetToggles(1))
        expect(part('studio-toggle-builder')).not.toBeNull()
        expect(part('studio-chip')).toBeNull()
        expect(part('studio-detail-text')).toBeNull()
        expect(part('studio-form-banner')?.textContent).toBe('studioBannerPresetSession')
        await showText()
        typeInText('b=One\nz=Z')
        await settle()
        expect(slot(1)).toBe('b=One\nz=Z')
        expect(working()).toBe('a=Zero\n')
        expect(slot(2)).toBe('c=Two\n')
        expect(tracker.botPreset).toBe(true)
    })

    test('the active preset writes the working setting', async () => {
        await mountOn(presetToggles(0))
        expect(part('studio-toggle-builder')).not.toBeNull()
        expect(part('studio-chip')).toBeNull()
        await showText()
        typeInText('a=Zero\nz=Z')
        await settle()
        expect(working()).toBe('a=Zero\nz=Z')
        expect(slot(1)).toBe('b=One\n')
    })

    test('A3 a switch of the active preset between two edits sends each edit to the copy that is live', async () => {
        await mountOn(presetToggles(0))
        await showText()
        typeInText('a=Zero\nz=Z')
        await settle()
        changeToPreset(1)
        await settle()
        expect(working()).toBe('b=One\n')
        expect(slot(0)).toBe('a=Zero\nz=Z')
        typeInText('a=Zero\nz=Z\ny=Y')
        await settle()
        expect(slot(0)).toBe('a=Zero\nz=Z\ny=Y')
        expect(working()).toBe('b=One\n')
    })
})

describe('T5 a preset that vanished', () => {
    async function mountAndVanish(index: number, vanish: () => void): Promise<void> {
        await mountOn(presetToggles(index))
        expect(part('studio-toggle-builder')).not.toBeNull()
        vanish()
        await settle()
    }

    const cleared = () => {
        expect(studioScreen.selectedOwnerKey).toBeNull()
        expect(studioScreen.notice).toBe('studioRefusalPresetGone')
        expect(part('studio-toggle-builder')).toBeNull()
    }

    test('A6 deleted at a non-last index', async () => {
        await mountAndVanish(1, () => { db.db.botPresets.splice(1, 1) })
        cleared()
        expect(slot(1)).toBe('c=Two\n')
        expect(working()).toBe('a=Zero\n')
    })

    test('A6 deleted at the last index', async () => {
        await mountAndVanish(2, () => { db.db.botPresets.splice(2, 1) })
        cleared()
        expect(slot(1)).toBe('b=One\n')
    })

    test('A6 replaced by a preset with another id at the same index', async () => {
        await mountAndVanish(1, () => { db.db.botPresets[1] = { ...db.db.botPresets[1], id: 'replacement', customPromptTemplateToggle: 'r=R\n' } })
        cleared()
        expect(slot(1)).toBe('r=R\n')
        expect(slot(2)).toBe('c=Two\n')
    })

    test('A7 a reorder keeps the same builder and a later edit lands in the moved preset', async () => {
        await mountOn(presetToggles(1))
        const pinned = idOf(1)
        const before = part('studio-toggle-builder')
        await openSheet()
        expect(studioScreen.togglePreviewOpen).toBe(true)
        // movePreset keeps the same preset active: the active index follows P0 to its new row.
        const [moved] = db.db.botPresets.splice(1, 1)
        db.db.botPresets.splice(0, 0, moved)
        db.db.botPresetsId = 1
        await settle()
        expect(studioScreen.selectedOwnerKey).toBe('preset:0')
        expect(studioScreen.notice).toBeNull()
        expect(idOf(0)).toBe(pinned)
        expect(part('studio-toggle-builder')).toBe(before)
        expect(studioScreen.togglePreviewOpen).toBe(true)
        await showText()
        typeInText('b=One\nz=Z')
        await settle()
        expect(slot(0)).toBe('b=One\nz=Z')
        expect(working()).toBe('a=Zero\n')
    })
})

describe('T12 the history of a selected preset', () => {
    test('the history owner is the pinned id key, unchanged by a reorder, and null for a key that is no index', async () => {
        await mountOn(presetToggles(1))
        const key = presetOwnerKey(idOf(1))
        expect(selectedHistoryOwner()).toBe(key)
        const [moved] = db.db.botPresets.splice(1, 1)
        db.db.botPresets.splice(0, 0, moved)
        db.db.botPresetsId = 1
        await settle()
        expect(selectedHistoryOwner()).toBe(key)
        setStudioSelection('preset:x', 'toggles', null)
        expect(selectedHistoryOwner()).toBeNull()
    })

    test('the History panel lists the steps while the bound character is private', async () => {
        db.db = fixtureDb('private')
        const service = await mountOn(presetToggles(1))
        await showText()
        typeInText('b=One\nz=Z')
        await settle()
        expect(service.view(presetOwnerKey(idOf(1))).done).toHaveLength(1)
        part('studio-history-toggle')?.click()
        await settle()
        expect(parts('studio-history-step')).toHaveLength(1)
    })

    test('Ctrl+Z after a switch lands in the copy that is live, the heading names the preset and no toast is posted', async () => {
        await mountOn(presetToggles(1))
        await showText()
        typeInText('b=One\nz=Z')
        await settle()
        changeToPreset(1)
        await settle()
        expect(working()).toBe('b=One\nz=Z')
        expect(part('studio-detail-title')?.textContent).toBe('P1')
        part('studio')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
        await settle()
        expect(working()).toBe('b=One\n')
        expect(toastHost.visible).toEqual([])
    })
})

describe('T10 the star source of an active preset follows the active preset', () => {
    test('after a switch away, Carry renames the star of the preset and leaves the star of the preset that is active now', async () => {
        const first = idOf(0)
        updateFavourites({ type: 'add', ref: { s: 'prompt', k: 'a' } })
        updateFavourites({ type: 'add', ref: { s: `preset:${first}`, k: 'a' } })
        await mountOn(presetToggles(0))
        parts('studio-toggle-row')[0].click()
        flushSync()
        const key = part('studio-toggle-key') as HTMLInputElement
        key.value = 'c'
        key.dispatchEvent(new Event('input', { bubbles: true }))
        key.dispatchEvent(new FocusEvent('blur'))
        flushSync()
        expect(part('studio-toggle-carry')).not.toBeNull()
        changeToPreset(1)
        await settle()
        part('studio-toggle-carry-yes')?.click()
        await settle()
        expect(currentFavourites().items).toEqual([{ s: 'prompt', k: 'a' }, { s: `preset:${first}`, k: 'c' }])
        expect(db.db.globalChatVariables).toEqual({ toggle_a: '1', toggle_c: '1' })
    })
})

describe('T14 a character builder never names the active preset (compatibility guard; passes before and after)', () => {
    test('a rename of a key the active preset defines asks the question with no active-preset line', async () => {
        ;(db.db.characters[0] as { customModuleToggle?: string }).customModuleToggle = 'a=Mode\n'
        await mountOn({ owner: { type: 'character', id: 'A' }, kind: 'toggles', from: 'chat' })
        parts('studio-toggle-row')[0].click()
        flushSync()
        const key = part('studio-toggle-key') as HTMLInputElement
        key.value = 'c'
        key.dispatchEvent(new Event('input', { bubbles: true }))
        key.dispatchEvent(new FocusEvent('blur'))
        flushSync()
        expect(part('studio-toggle-carry')).not.toBeNull()
        expect(part('studio-toggle-carry-active-keeps')).toBeNull()
    })

})

describe('T13 the active-preset line and the page-only note in the preset builder', () => {
    test('the preset builder shows the line, and that the question is page-only, for an inactive preset that renames a key the active one defines', async () => {
        db.db.botPresets[1].customPromptTemplateToggle = 'a=One\n'
        await mountOn(presetToggles(1))
        parts('studio-toggle-row')[0].click()
        flushSync()
        const key = part('studio-toggle-key') as HTMLInputElement
        key.value = 'c'
        key.dispatchEvent(new Event('input', { bubbles: true }))
        key.dispatchEvent(new FocusEvent('blur'))
        flushSync()
        expect(part('studio-toggle-carry-active-keeps')?.textContent).toBe('studioTgCarryActiveKeeps(a,P0)')
        expect(part('studio-toggle-carry-not-kept')?.textContent).toBe('studioTgCarryNotKept')
        expect(Object.keys(localStorage).filter((name) => name.startsWith('risuStudio.toggleCarry:'))).toEqual([])
    })
})

describe('T9 the preview of a preset', () => {
    test('the active preset is in the chat and its rows are outlined', async () => {
        await mountOn(presetToggles(0))
        await openSheet()
        await showAll()
        expect(part('studio-tg-preview-not-in-chat')).toBeNull()
        const current = parts('studio-tg-preview-row').filter((row) => row.hasAttribute('data-current'))
        expect(current.map((row) => row.dataset.key)).toEqual(['a'])
    })

    test('an inactive preset shows the note, no outlined row, and its own scope still shows its rows', async () => {
        await mountOn(presetToggles(1))
        await openSheet()
        expect(parts('studio-tg-preview-row').map((row) => row.dataset.key)).toEqual(['b'])
        await showAll()
        expect(part('studio-tg-preview-not-in-chat')?.textContent).toBe('studioTgPreviewNotInChat')
        expect(parts('studio-tg-preview-row').filter((row) => row.hasAttribute('data-current'))).toEqual([])
        expect(parts('studio-tg-preview-row').map((row) => row.dataset.key)).toEqual(['a', 'ch'])
        expect(working()).toBe('a=Zero\n')
    })
})
