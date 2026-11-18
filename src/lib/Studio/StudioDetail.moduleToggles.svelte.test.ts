// @vitest-environment jsdom
/**
 * The toggle builder of a resident module under the real Studio screen, with the real publish of the open module's id,
 * the real history service on the memory doubles and the real write hook. The builder exists exactly while the detail
 * publishes the module's id; a module whose id several rows share keeps its read-only text and says why.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, getFileSrc: async (path: string, use: string) => `blob:${use}:${path}` }))
vi.mock('src/ts/studio/assets/assetFileState', () => ({
    openAssetFileReader: async () => ({ concurrency: 1, stateOf: async () => 'present' }),
}))

// Filled by `beforeEach`: the fixture's own constants are not defined yet at this point.
const db = $state({ db: {} as ReturnType<typeof fixtureDb> })
const selection = $state({ selId: 0 })
const quickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const stores = {
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        sideBarStore: writable(false),
        frozenSaveKeysStore: writable([]),
    }
    return {
        ...stores,
        get DBState() { return db },
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/process/modules', () => ({ refreshModules: vi.fn() }))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: vi.fn() }))
vi.mock('src/ts/process/moduleRefList', () => ({
    moduleRefIdsOf: () => db.db.modules.map((row: { id: string }) => row.id),
    moduleListOf: (ids: string[]) => db.db.modules.filter((row: { id: string }) => ids.includes(row.id)),
}))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const named: Record<string, unknown> = { sidebarUi: { notAllowed: 'notAllowed', noAssets: 'noAssets' } }
    for (const key of ['studioTgDeleted', 'studioTgMoved', 'studioTgOptionN', 'studioTgSummarySelect', 'studioTgSummaryGroup', 'studioTgUnreadableCount', 'studioTgLineN']) named[key] = call(key)
    return { language: new Proxy(named, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { RisuModule } from 'src/ts/process/modules'
import { openStudioModuleId, publishOpenModuleId, resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { createSaveAck, type ModuleCommitVerdict, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { compositionStart, composeText } from '../../ts/ime/tests/imeEventSequence'
import { makeCharacter, makeInput, makePreset, residentModule, studioDbOf, stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, setStudioSelection } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { createToastHost, resetToastHostForTests, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { currentVisitAck, resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioModuleAckForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import StudioScreen from './StudioScreen.svelte'
import StudioToggleBuilder from './StudioToggleBuilder.svelte'

const M1 = moduleOwnerKey('M1')
const M2 = moduleOwnerKey('M2')
const CHARACTER = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function fixtureDb() {
    const input = makeInput({
        character: makeCharacter({ chaId: 'A', customModuleToggle: 'ch=Char' } as Parameters<typeof makeCharacter>[0]),
        modules: [residentModule('M1', { customModuleToggle: 'm1=One' }), residentModule('M2', { customModuleToggle: 'm2=Two' })],
        enabledModules: ['M1', 'M2'],
    })
    return { ...studioDbOf(input), modules: [...input.modules] }
}

const moduleToggles = (id: string) => ({ owner: { type: 'module', id }, kind: 'toggles', from: 'chat' }) as const
const characterToggles = { owner: { type: 'character', id: 'A' }, kind: 'toggles', from: 'chat' } as const

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

// The module acks the accessor built, over deps the test drives: every accepted edit counts a mark, and a commit is
// reported by `commit` with the verdict the loop would give the module.
const moduleRig = {
    clock: createFakeClock(),
    built: [] as SaveAck[],
    callbacks: new Set<() => void>(),
    committed: 0,
    verdict: 'saved' as ModuleCommitVerdict,
}

function makeModuleAck(clock: FakeClock): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => 1,
        getCommittedMarkCount: () => moduleRig.committed,
        afterNextCommit: (callback) => { moduleRig.callbacks.add(callback) },
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
    const ack = createSaveAck(deps, { kind: 'module', verdict: () => moduleRig.verdict })
    vi.spyOn(ack, 'dispose')
    moduleRig.built.push(ack)
    return ack
}

function commit(verdict: ModuleCommitVerdict): void {
    moduleRig.committed = 1
    moduleRig.verdict = verdict
    for (const callback of [...moduleRig.callbacks]) {
        moduleRig.callbacks.delete(callback)
        callback()
    }
    flushSync()
}

let rigCount = 0

// The service as production builds it: it asks the detail which module is selected.
function makeRig(): OwnerHistoryService {
    const clock = createFakeClock()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: `p${++rigCount}`,
        registerLeaveFlush: () => () => {},
        openModuleId: openStudioModuleId,
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    moduleRig.clock = clock
    setStudioModuleAckForTests(() => makeModuleAck(clock))
    return service
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

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect(): void {}
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const rowNames = () => parts('studio-toggle-row').map((row) => row.querySelector('[data-part="studio-toggle-name"]')?.textContent)
const slotText = (index: number) => (db.db.modules[index] as RisuModule).customModuleToggle
const characterText = () => (db.db.characters[0] as { customModuleToggle?: string }).customModuleToggle

async function mountOn(target: Parameters<typeof openStudio>[0]): Promise<OwnerHistoryService> {
    const service = makeRig()
    openStudio(target, null)
    mountInto(StudioScreen)
    await settle()
    return service
}

async function select(ownerKey: string): Promise<void> {
    setStudioSelection(ownerKey, 'toggles', null)
    await settle()
}

function typeInText(value: string): void {
    const area = part('studio-toggle-textarea') as HTMLTextAreaElement
    area.value = value
    area.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

async function showText(): Promise<void> {
    part('studio-toggle-view-text')?.click()
    await settle()
}

function resetMarks(): void {
    tracker.modules = false
    tracker.character.length = 0
}

beforeEach(() => {
    moduleRig.built.length = 0
    moduleRig.callbacks.clear()
    moduleRig.committed = 0
    moduleRig.verdict = 'saved'
    tracker.character.length = 0
    tracker.modules = false
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

describe('R-C2 the toggles of a resident module', () => {
    test('mount the builder with its chip and no text dump, and an edit changes that module only, as one step', async () => {
        const service = await mountOn(moduleToggles('M1'))
        await service.whenReady(M1)
        expect(part('studio-toggle-builder')).not.toBeNull()
        expect(part('studio-chip')).not.toBeNull()
        expect(part('studio-detail-text')).toBeNull()
        expect(part('studio-toggle-module-shared')).toBeNull()
        expect(rowNames()).toEqual(['One'])
        await showText()
        resetMarks()
        typeInText('m1=One\nz=Z')
        await settle()
        expect(slotText(0)).toContain('z=Z')
        expect(slotText(1)).toBe('m2=Two')
        expect(characterText()).toBe('ch=Char')
        expect(service.view(M1).done).toHaveLength(1)
        expect(service.view(CHARACTER).done).toHaveLength(0)
        expect(tracker.modules).toBe(true)
        expect(tracker.character).toEqual([])
    })

    test('a character keeps the builder with its chip (compatibility guard; passes before and after)', async () => {
        await mountOn(characterToggles)
        expect(part('studio-toggle-builder')).not.toBeNull()
        expect(part('studio-chip')).not.toBeNull()
    })

    test('a module that is not loaded mounts no builder and publishes nothing (compatibility guard; passes before and after)', async () => {
        db.db.modules[0] = stubModule('M1')
        await mountOn({ owner: { type: 'module', id: 'M1' }, from: 'chat' })
        expect(part('studio-toggle-builder')).toBeNull()
        expect(openStudioModuleId()).toBeNull()
    })
})

describe('CG-C2m a preset keeps the read-only text of its toggles', () => {
    test('no builder, the preset text shown, and the character toggles untouched (compatibility guard; passes before and after)', async () => {
        const input = makeInput({
            character: makeCharacter({ chaId: 'A', customModuleToggle: 'ch=Char' } as Parameters<typeof makeCharacter>[0]),
            presets: [makePreset('P0', { toggles: 'p=Preset' })],
            activePreset: 0,
            modules: [residentModule('M1', { customModuleToggle: 'm1=One' })],
            enabledModules: ['M1'],
        })
        db.db = { ...studioDbOf(input), modules: [...input.modules] }
        await mountOn({ owner: { type: 'preset', id: '0' }, kind: 'toggles', from: 'chat' })
        expect(part('studio-toggle-builder')).toBeNull()
        expect(part('studio-detail-text')?.textContent).toContain('p=Preset')
        expect(characterText()).toBe('ch=Char')
    })
})

describe('R-C13d a module whose id several rows share', () => {
    test('keeps its read-only text, mounts no builder, publishes nothing and says why', async () => {
        db.db.modules[1] = residentModule('M1', { customModuleToggle: 'dup=Dup' })
        await mountOn(moduleToggles('M1'))
        expect(part('studio-toggle-builder')).toBeNull()
        expect(openStudioModuleId()).toBeNull()
        expect(part('studio-detail-text')?.textContent).toContain('m1=One')
        expect(part('studio-toggle-module-shared')?.textContent).toBe('studioRefusalModuleSharedId')
    })
})

describe('R-SW a change of the selected owner rebuilds the builder over the new owner', () => {
    test('character to M1 to M2 to character: each builder shows and writes its own owner, and pending text lands in the owner it was typed in', async () => {
        const service = await mountOn(characterToggles)
        await service.whenReady(CHARACTER)
        expect(rowNames()).toEqual(['Char'])
        await showText()
        typeInText('ch=Char\nc2=Two')
        await settle()
        expect(characterText()).toContain('c2=Two')
        const characterAfter = characterText()

        await select(M1)
        await service.whenReady(M1)
        expect(openStudioModuleId()).toBe('M1')
        expect(rowNames()).toEqual(['One'])
        await showText()
        resetMarks()
        typeInText('m1=One\nz=Z')
        await settle()
        expect(slotText(0)).toContain('z=Z')
        expect(characterText()).toBe(characterAfter)
        expect(tracker.character).toEqual([])
        expect(service.view(M1).done).toHaveLength(1)

        // Text typed in M1 and not yet written lands in M1 when the selection moves to M2.
        const area = part('studio-toggle-textarea') as HTMLTextAreaElement
        compositionStart(area)
        composeText(area, 'm1=One\nz=Z\ny=Y')
        await select(M2)
        expect(slotText(0)).toContain('y=Y')
        expect(slotText(1)).toBe('m2=Two')
        expect(part('studio-toggle-error')).toBeNull()
        expect(rowNames()).toEqual(['Two'])
        await service.whenReady(M2)
        await showText()
        typeInText('m2=Two\nw=W')
        await settle()
        expect(slotText(1)).toContain('w=W')
        expect(slotText(0)).toContain('y=Y')
        expect(slotText(0)).not.toContain('w=W')

        await select(CHARACTER)
        expect(rowNames()).toEqual(['Char', 'Two'])
        expect(characterText()).toBe(characterAfter)
        expect(openStudioModuleId()).toBeNull()

        // A step opened in the list view is closed when its builder is destroyed at the switch, so the same edit made after
        // coming back is a step of its own instead of merging into the earlier one.
        await select(M1)
        await service.whenReady(M1)
        const editLabel = (value: string): void => {
            parts('studio-toggle-row')[0].click()
            flushSync()
            const label = part('studio-toggle-label') as HTMLInputElement
            label.value = value
            label.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
        }
        const doneBefore = service.view(M1).done.length
        editLabel('One 2')
        await settle()
        expect(service.view(M1).done).toHaveLength(doneBefore + 1)
        await select(M2)
        await select(M1)
        await service.whenReady(M1)
        editLabel('One 3')
        await settle()
        expect(slotText(0)).toContain('One 3')
        expect(service.view(M1).done).toHaveLength(doneBefore + 2)
    })
})

// ---------------------------------------------------------------- the save chip of a module's toggles

const chipState = () => part('studio-chip')?.getAttribute('data-state')

describe('R3-M the chip of a resident module follows the module ack', () => {
    test('an edit commits to saved; a blocked commit is unconfirmed with Retry', async () => {
        const service = await mountOn(moduleToggles('M1'))
        await service.whenReady(M1)
        expect(chipState()).toBe('idle')
        await showText()
        typeInText('m1=One\nz=Z')
        await settle()
        commit('saved')
        expect(chipState()).toBe('saved')
        expect(part('studio-chip-retry')).toBeNull()
        typeInText('m1=One\nz=Z\ny=Y')
        await settle()
        commit('blocked')
        expect(chipState()).toBe('unconfirmed')
        expect(part('studio-chip-retry')).not.toBeNull()
    })

    test('an unsavable commit is a permanent failed with no Retry', async () => {
        const service = await mountOn(moduleToggles('M1'))
        await service.whenReady(M1)
        await showText()
        typeInText('m1=One\nz=Z')
        await settle()
        commit('unsavable')
        expect(chipState()).toBe('failed')
        expect(part('studio-chip-retry')).toBeNull()
    })
})

describe('R3-E4 the chip of a module never shows another owner\'s ack', () => {
    test('a failed character visit ack stays out of the module chip, and a switch disposes the module ack', async () => {
        const service = await mountOn(characterToggles)
        await service.whenReady(CHARACTER)
        currentVisitAck()?.noteEdit('A', 0)
        flushSync()
        expect(chipState()).toBe('failed')
        expect(moduleRig.built).toHaveLength(0)

        await select(M1)
        await service.whenReady(M1)
        expect(part('studio-toggle-builder')).not.toBeNull()
        expect(moduleRig.built).toHaveLength(1)
        expect(chipState()).toBe('idle')
        const timersWithModuleAck = moduleRig.clock.pendingTimers()

        await select(M2)
        await service.whenReady(M2)
        expect(moduleRig.built).toHaveLength(2)
        expect(moduleRig.built[0].dispose).toHaveBeenCalledTimes(1)
        expect(moduleRig.built[1].dispose).not.toHaveBeenCalled()
        expect(chipState()).toBe('idle')
        expect(moduleRig.clock.pendingTimers()).toBe(timersWithModuleAck)

        await select(CHARACTER)
        expect(moduleRig.built[1].dispose).toHaveBeenCalledTimes(1)
        expect(moduleRig.clock.pendingTimers()).toBeLessThan(timersWithModuleAck)
        expect(chipState()).toBe('failed')
    })
})

describe('CG3 no module chip outside the module toggle builder', () => {
    test('the module asset form builds no module ack and shows no chip', async () => {
        await mountOn({ owner: { type: 'module', id: 'M1' }, kind: 'display', from: 'chat' })
        expect(part('studio-module-asset-form')).not.toBeNull()
        expect(part('studio-chip')).toBeNull()
        expect(moduleRig.built).toHaveLength(0)
    })

    test('the toggles of a preset build no module ack and show no chip', async () => {
        const input = makeInput({
            character: makeCharacter({ chaId: 'A', customModuleToggle: 'ch=Char' } as Parameters<typeof makeCharacter>[0]),
            presets: [makePreset('P0', { toggles: 'p=Preset' })],
            activePreset: 0,
            modules: [residentModule('M1', { customModuleToggle: 'm1=One' })],
            enabledModules: ['M1'],
        })
        db.db = { ...studioDbOf(input), modules: [...input.modules] }
        await mountOn({ owner: { type: 'preset', id: '0' }, kind: 'toggles', from: 'chat' })
        expect(part('studio-detail-text')).not.toBeNull()
        expect(part('studio-chip')).toBeNull()
        expect(moduleRig.built).toHaveLength(0)
    })

    test('a stub module builds no module ack and shows no chip', async () => {
        db.db.modules[0] = stubModule('M1')
        await mountOn(moduleToggles('M1'))
        expect(part('studio-toggle-builder')).toBeNull()
        expect(part('studio-chip')).toBeNull()
        expect(moduleRig.built).toHaveLength(0)
    })

    test('a duplicate module id builds no module ack and shows no chip', async () => {
        db.db.modules[1] = residentModule('M1', { customModuleToggle: 'dup=Dup' })
        await mountOn(moduleToggles('M1'))
        expect(part('studio-toggle-module-shared')).not.toBeNull()
        expect(part('studio-chip')).toBeNull()
        expect(moduleRig.built).toHaveLength(0)
    })

    test('the character builder keeps its one chip and builds no module ack', async () => {
        await mountOn(characterToggles)
        expect(parts('studio-chip')).toHaveLength(1)
        expect(moduleRig.built).toHaveLength(0)
    })
})

describe('CG3-R a refused write leaves the module chip as it was', () => {
    test('a not-selected refusal shows inline and the chip state does not change', async () => {
        const service = await mountOn(moduleToggles('M1'))
        await service.whenReady(M1)
        await showText()
        typeInText('m1=One\nz=Z')
        await settle()
        commit('saved')
        expect(chipState()).toBe('saved')
        publishOpenModuleId(null)
        typeInText('m1=One\nz=Z\ny=Y')
        await settle()
        await moduleRig.clock.advance(1000)
        flushSync()
        expect(part('studio-toggle-text-error')?.textContent).toBe('studioRefusalModuleNotSelected')
        expect(chipState()).toBe('saved')
    })
})

// ---------------------------------------------------------------- refusals at component level

function makeToastHost(): ToastHost {
    let time = 0
    const clock: ToastClock = { now: () => time, after: () => () => {} }
    return createToastHost({ clock })
}

async function mountModuleBuilder(host?: ToastHost): Promise<OwnerHistoryService> {
    const service = makeRig()
    publishOpenModuleId('M1')
    mountInto(StudioToggleBuilder, { target: { kind: 'module', moduleId: 'M1' }, ...(host ? { host } : {}) })
    await settle()
    await service.whenReady(M1)
    await settle()
    return service
}

describe('R-C13 refusals of a module builder, in module wording', () => {
    test('(n) a module that is no longer the published one is refused in the text view and in the row editor, keeping the typed text', async () => {
        await mountModuleBuilder()
        publishOpenModuleId(null)
        await showText()
        typeInText('m1=One\nz=Z')
        await settle()
        expect(part('studio-toggle-text-error')?.textContent).toBe('studioRefusalModuleNotSelected')
        expect((part('studio-toggle-textarea') as HTMLTextAreaElement).value).toBe('m1=One\nz=Z')
        expect(slotText(0)).toBe('m1=One')

        part('studio-toggle-view-list')?.click()
        await settle()
        parts('studio-toggle-row')[0].click()
        flushSync()
        const label = part('studio-toggle-label') as HTMLInputElement
        label.value = 'One 2'
        label.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect(part('studio-toggle-error')?.textContent).toBe('studioRefusalModuleNotSelected')
        expect(slotText(0)).toBe('m1=One')
        expect(tracker.modules).toBe(false)
    })

    test('(d) a shared id is refused in the list with the shared-id wording and nothing is written', async () => {
        db.db.modules[1] = residentModule('M1', { customModuleToggle: 'dup=Dup' })
        await mountModuleBuilder()
        resetMarks()
        const row = parts('studio-toggle-row')[0]
        row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
        flushSync()
        expect(part('studio-toggle-error')?.textContent).toBe('studioRefusalModuleSharedId')
        expect(slotText(0)).toBe('m1=One')
        expect(tracker.modules).toBe(false)
    })

    test('(t) the Undo of a delete after the module stopped being the published one says so, and the module keeps its text', async () => {
        db.db.modules[0] = residentModule('M1', { customModuleToggle: 'a=A\nb=B\n' })
        const toasts = makeToastHost()
        await mountModuleBuilder(toasts)
        parts('studio-toggle-row')[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
        flushSync()
        await settle()
        const afterDelete = slotText(0)
        expect(afterDelete).not.toContain('b=B')
        expect(toasts.visible.map((entry) => entry.kind)).toEqual(['undo'])
        publishOpenModuleId(null)
        await toasts.activate(toasts.visible[0].id)
        await settle()
        expect(toasts.visible.at(-1)?.text).toBe('studioRefusalModuleNotSelected')
        expect(slotText(0)).toBe(afterDelete)
    })
})

describe('G-C4m an owner undo of a module step re-reads the open editor', () => {
    test('the text view shows the restored definition and the re-read writes nothing', async () => {
        db.db.modules[0] = residentModule('M1', { customModuleToggle: 'a=On\n' })
        const service = await mountModuleBuilder()
        await showText()
        typeInText('a=On\nb=Off\n')
        await settle()
        expect(slotText(0)).toContain('b=Off')
        expect(service.view(M1).done).toHaveLength(1)
        resetMarks()
        expect(service.undo(M1).ok).toBe(true)
        await settle()
        expect(slotText(0)).toBe('a=On\n')
        expect((part('studio-toggle-textarea') as HTMLTextAreaElement).value).toBe('a=On\n')
        expect(service.view(M1).done).toHaveLength(0)
        expect(service.view(M1).undone).toHaveLength(1)
    })
})